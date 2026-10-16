//! Reading of EPUB, MOBI, AZW3, FB2 and CBZ on foliate-js. The library paginates and renders;
//! every decision about how its pages are laid out, turned, followed, spoken and captured is
//! made here. The reader's state is the plain object `s` its JavaScript class holds (view,
//! container, cursor, turn queues), and every document, range and event keeps its identity.
use wasm_bindgen::{prelude::*, JsCast};
use js_sys::{Array, Function, Object, Promise};
use crate::eager::{eager, settled};
use crate::host::{absent, call, clock, construct, get, get_at, global, jmax, jmin, js_round, method, method_opt, num, number_string, read, set, truthy};

fn document() -> JsValue { get(&global(), "document") }
fn window() -> JsValue { get(&global(), "window") }
fn integer(value: &JsValue) -> bool { value.as_f64().is_some_and(|number| number.is_finite() && number.fract() == 0.0) }
fn plain(entries: &[(&str, JsValue)]) -> Result<JsValue, JsValue> {
    let object = Object::new();
    for (name, value) in entries { set(&object, name, value)?; }
    Ok(object.into())
}
fn or_text(value: JsValue, otherwise: &str) -> JsValue { if truthy(&value) { value } else { otherwise.into() } }
fn nonzero(value: f64) -> bool { value != 0.0 && !value.is_nan() }
/// A function that does nothing, for promise handlers that only mean "carry on".
fn noop() -> JsValue {
    thread_local! { static NOOP: JsValue = Closure::<dyn FnMut()>::new(|| {}).into_js_value(); }
    NOOP.with(JsValue::clone)
}
/// `new Promise(resolve => setTimeout(resolve, ms))`.
fn pause(milliseconds: f64) -> Promise { Promise::new(&mut |resolve, _| { let _ = crate::host::set_timeout(&resolve, milliseconds); }) }
fn cursor_of(s: &JsValue) -> JsValue { get(s, "speechCursor") }

/// Reset the reader for a new book and put its (still empty) view into the container.
#[wasm_bindgen]
pub fn foliate_attach(s: &JsValue, container: &JsValue, on_relocate: &JsValue) -> Result<JsValue, JsValue> {
    set(s, "lengthMetadata", &JsValue::NULL)?;
    set(s, "lastReaderStyles", &JsValue::NULL)?;
    set(s, "turns", &plain(&[("followPending", 0.into()), ("pageTurnPending", 0.into())])?)?;
    set(s, "pageTurn", &Promise::resolve(&JsValue::UNDEFINED))?;
    set(s, "container", container)?;
    set(s, "onRelocate", on_relocate)?;
    set(container, "innerHTML", &"".into())?;
    let classes = get(container, "classList");
    method(&classes, "add", &[&"foliate-reader".into()])?;
    method(&classes, "remove", &[&"pdf-reader".into()])?;
    let view = method(&document(), "createElement", &[&"foliate-view".into()])?;
    method(&get(&view, "classList"), "add", &[&"foliate-view-el".into()])?;
    method(container, "append", &[&view])?;
    set(s, "view", &view)?;
    Ok(view)
}

/// Foliate answers every touchend with snap(), which settles the paginator on the page
/// under the finger a frame later. A finger always drifts a few pixels during a tap, so
/// that snap starts a 300 ms animation back to the OLD page while our own page turn is
/// already running: the two fight and the page stops between pages (or stays put). The
/// tap's page turn replaces that snap, so the single snap that belongs to the tap is skipped.
#[wasm_bindgen]
pub fn foliate_skip_snap(s: &JsValue) -> Result<(), JsValue> { set(s, "skipSnapUntil", &(clock()? + 250.0).into()) }

/// Is a snap due right now the one a tap replaces? Consumes the allowance when it is.
#[wasm_bindgen]
pub fn foliate_snap_skipped(s: &JsValue) -> Result<bool, JsValue> {
    if clock()? < num(&get(s, "skipSnapUntil")) { set(s, "skipSnapUntil", &0.into())?; return Ok(true); }
    Ok(false)
}

/// A paginated section is one wide document that the paginator slides sideways, so measuring
/// a tap against it classified every tap by where the page sits in the chapter (all of them
/// turned forward). Judge the tap against the visible reader instead; right-to-left books turn
/// on the left.
#[wasm_bindgen]
pub fn foliate_tap_zone(s: &JsValue, event: &JsValue) -> Result<String, JsValue> {
    let outer = method(&get(s, "container"), "getBoundingClientRect", &[])?;
    let frame = get(&get(&get(&get(event, "target"), "ownerDocument"), "defaultView"), "frameElement");
    let left = if truthy(&frame) { num(&get(&method(&frame, "getBoundingClientRect", &[])?, "left")) } else { num(&get(&outer, "left")) };
    let zone = crate::gestures::classify_tap_zone(left + num(&get(event, "clientX")) - num(&get(&outer, "left")), num(&get(&outer, "width")));
    if zone == "center" || get(&get(&get(s, "view"), "book"), "dir") != "rtl" { return Ok(zone); }
    Ok(if zone == "prev" { "next" } else { "prev" }.into())
}

/// A selection made inside a section: the reader panel offers it as a quote.
#[wasm_bindgen]
pub fn foliate_selected(s: &JsValue, detail: &JsValue) -> Result<(), JsValue> {
    let selection = method(&get(&get(detail, "doc"), "defaultView"), "getSelection", &[])?;
    if absent(&selection) { return Ok(()); }
    let text = method(&method(&selection, "toString", &[])?, "trim", &[])?;
    if !truthy(&text) || !truthy(&get(&selection, "rangeCount")) { return Ok(()); }
    let range = method(&selection, "getRangeAt", &[&0.into()])?;
    let value = method(&get(s, "view"), "getCFI", &[&get(detail, "index"), &range])?;
    let locator = plain(&[("kind", "cfi".into()), ("value", value)])?;
    // `selection.toString().trim()` is read again for the event, as before.
    let text = method(&method(&selection, "toString", &[])?, "trim", &[])?;
    let event = construct("CustomEvent", &[&"inhouse-reader-selection".into(), &plain(&[("detail", plain(&[("text", text), ("locator", locator)])?)])?])?;
    method(&window(), "dispatchEvent", &[&event])?;
    Ok(())
}

/// The location Foliate reports, as the reader's own record.
#[wasm_bindgen]
pub fn foliate_relocated(s: &JsValue, detail: &JsValue) -> Result<(), JsValue> {
    // A visual catch-up must not overwrite the more recent audible CFI.
    let cursor = cursor_of(s);
    if truthy(&get(&cursor, "active")) && !truthy(&get(&cursor, "browsing")) { return Ok(()); }
    // View.lastLocation contains SectionProgress.section.current, not a top-level index.
    // Retain a valid explicit index for older adapters; never turn a missing index into chapter zero.
    let explicit = get(detail, "index");
    let section = get(&get(detail, "section"), "current");
    let index = if integer(&explicit) && num(&explicit) >= 0.0 { explicit }
        else if integer(&section) && num(&section) >= 0.0 { section } else { JsValue::UNDEFINED };
    let fraction = get(detail, "fraction");
    let record = plain(&[("index", index), ("fraction", if fraction.is_null() || fraction.is_undefined() { 0.into() } else { fraction }),
        ("cfi", get(detail, "cfi")), ("section", or_text(get(&get(detail, "tocItem"), "label"), "")), ("page", or_text(get(&get(detail, "pageItem"), "label"), ""))])?;
    call(&get(s, "onRelocate"), "onRelocate", &[&record])?;
    Ok(())
}

/// The geometry Foliate paginates with: the page box, the gap, the measure of a wide spread.
#[wasm_bindgen]
pub fn foliate_layout(s: &JsValue, announce: &Function) -> Result<(), JsValue> {
    let view = get(s, "view");
    let renderer = get(&view, "renderer");
    if !truthy(&renderer) { return Ok(()); }
    let container = get(s, "container");
    let bounds = method(&container, "getBoundingClientRect", &[])?;
    let measure = |client: &str, side: &str, fallback: f64| -> Result<f64, JsValue> {
        let mut value = num(&get(&container, client));
        if !nonzero(value) { value = num(&get(&bounds, side)); }
        if !nonzero(value) { value = num(&get(&method(&view, "getBoundingClientRect", &[])?, side)); }
        Ok(if nonzero(value) { value } else { fallback })
    };
    let width = measure("clientWidth", "width", 360.0)?;
    let height = measure("clientHeight", "height", 720.0)?;
    let preferences = get(s, "preferences");
    let scrolled = get(&preferences, "flow") == "scrolled";
    // A paginated page sits on the bottom of the reader (see .is-paginated).
    method(&get(&container, "classList"), "toggle", &[&"is-paginated".into(), &(!scrolled).into()])?;
    let style = get(&view, "style");
    if scrolled { set(&style, "height", &"".into())?; }
    else {
        // Audio shares the existing header. Opening audio, hiding chrome or showing Return never changes the viewport's dimensions.
        let measured = num(&get(&container, "clientWidth")) > 0.0 && num(&get(&container, "clientHeight")) > 0.0;
        let storage = if measured { get(&global(), "localStorage") } else { JsValue::NULL };
        let value = format!("{}px", number_string(crate::page_box::page_box_height(width, height + 52.0, height, &storage, &JsValue::UNDEFINED)?));
        if get(&style, "height") != value.as_str() { set(&style, "height", &value.into())?; set(s, "pageBoxChanged", &JsValue::TRUE)?; }
    }
    // Foliate's margin is the vertical gutter, in CSS lengths; its horizontal gutter is a
    // percentage named gap. Scrolled mode has a different grid, so convert pixels using that
    // mode's gap formula instead of introducing wider margins when switching flow. Wide
    // landscape windows show a two-page spread that ran edge to edge: cap each page at a
    // book-like measure so the spread centres under the reader chrome. Phones and portrait are unchanged.
    let margin = num(&get(&preferences, "margin"));
    let wide = width >= 960.0 && width > height;
    let gutter = if wide { 48.0 + margin } else { margin };
    let gap = gutter / (width + if scrolled { gutter } else { 0.0 }) * 100.0;
    let column = if wide { js_round(jmin(580.0, (width - 96.0) / 2.0)) } else { 720.0 };
    let fixed = js_sys::Number::from(gap).to_fixed(4)?.as_string().unwrap_or_default();
    let attributes = [("flow", get(&preferences, "flow")), ("margin", "4px".into()), ("gap", format!("{fixed}%").into()),
        ("max-inline-size", format!("{}px", number_string(column)).into()), ("max-block-size", format!("{}px", number_string(jmax(jmax(width, height), 1440.0))).into())];
    let mut changed = false;
    for (name, value) in &attributes {
        let current = method_opt(&renderer, "getAttribute", &[&(*name).into()])?.unwrap_or(JsValue::UNDEFINED);
        if current != *value { method(&renderer, "setAttribute", &[&(*name).into(), value])?; changed = true; }
    }
    if changed || truthy(&get(s, "pageBoxChanged")) { set(s, "pageBoxChanged", &JsValue::FALSE)?; announce.call0(&JsValue::UNDEFINED)?; }
    let query = method_opt(&window(), "matchMedia", &[&"(prefers-reduced-motion: reduce)".into()])?;
    let animated = match query { Some(list) => !truthy(&get(&list, "matches")), None => true };
    if animated { method(&renderer, "setAttribute", &[&"animated".into(), &"".into()])?; } else { method(&renderer, "removeAttribute", &[&"animated".into()])?; }
    Ok(())
}

/// Foliate lets us inject our own CSS into every rendered document, so the typography of
/// the book uses our base font and the columns breathe like the rest of the UI.
#[wasm_bindgen]
pub fn foliate_styles(s: &JsValue, reading_css: &Function) -> Result<(), JsValue> {
    let css = reading_css.call1(&JsValue::UNDEFINED, &get(s, "preferences"))?;
    if css == get(s, "lastReaderStyles") { return Ok(()); }
    set(s, "lastReaderStyles", &css)?;
    method_opt(&get(&get(s, "view"), "renderer"), "setStyles", &[&css])?;
    Ok(())
}

/// Foliate silently discards a turn while its previous one is locked. Even without
/// animation it holds that lock for 100 ms AFTER moving the page. Preserve rapid
/// tap/button order through the full promise, not just until the new offset becomes
/// visible; a closed/replaced book drops pending turns.
#[wasm_bindgen]
pub fn foliate_turn(s: &JsValue, direction: &str, is_active: &Function) -> Result<JsValue, JsValue> {
    let view = get(s, "view");
    // Speech follows the last fragment with the same paginator as manual navigation. Its relocate
    // event fires before the animation releases Foliate's lock. At a chapter boundary, wait for that
    // whole follow turn: otherwise next() silently does nothing and the voice mistakes the unchanged
    // location for the end of the book.
    let following = get(s, "followTurn");
    let turns = get(s, "turns");
    set(&turns, "pageTurnPending", &(num(&get(&turns, "pageTurnPending")) + 1.0).into())?;
    let (state, direction, is_active, queue) = (s.clone(), direction.to_owned(), is_active.clone(), get(s, "pageTurn"));
    let step = Closure::once_into_js(move || -> Result<JsValue, JsValue> {
        Ok(eager(async move {
            settled(method(&following, "catch", &[&noop()])?).await?; // a highlight/follow failure stays cosmetic
            let current = |state: &JsValue| -> Result<bool, JsValue> { Ok(truthy(&view) && view == get(state, "view") && is_active.call0(&JsValue::UNDEFINED)?.is_truthy()) };
            let cursor = cursor_of(&state);
            if current(&state)? && !truthy(&get(&cursor, "browsing")) {
                if !truthy(&get(&document(), "hidden")) && truthy(&get(&cursor, "active")) { settled(method(&cursor, "reveal", &[])?).await?; }
                method_opt(&cursor_of(&state), "reset", &[])?;
            }
            if current(&state)? { return method(&view, &direction, &[]); }
            Ok(JsValue::UNDEFINED)
        }).into())
    });
    let turn = method(&queue, "then", &[&step])?;
    set(s, "pageTurn", &method(&turn, "catch", &[&noop()])?)?;
    crate::promises::after(&turn, move || { let _ = set(&turns, "pageTurnPending", &(num(&get(&turns, "pageTurnPending")) - 1.0).into()); })?;
    Ok(turn)
}

/// Where a spoken fragment starts relative to the page foliate shows: -1 before, 0 on it, 1 after.
fn page_side(visible: &JsValue, range: &JsValue) -> Result<f64, JsValue> {
    let (node, offset) = (get(range, "startContainer"), get(range, "startOffset"));
    let side = num(&method(visible, "comparePoint", &[&node, &offset])?);
    Ok(if side == 0.0 && node == get(visible, "endContainer") && num(&offset) >= num(&get(visible, "endOffset")) { 1.0 } else { side })
}

/// Scroll flow: glide only when the sentence leaves the screen, landing it a quarter down so the next lines stay visible.
async fn follow_scroll(s: JsValue, doc: JsValue, range: JsValue) -> Result<(), JsValue> {
    let view = get(&s, "view");
    let renderer = get(&view, "renderer");
    let mode = get(&method(&get(&doc, "defaultView"), "getComputedStyle", &[&get(&doc, "documentElement")])?, "writingMode");
    if method(&mode, "startsWith", &[&"vertical".into()])?.is_truthy() { return Ok(()); }
    let rect = get_at(&method(&range, "getClientRects", &[])?, 0);
    if !truthy(&rect) { return Ok(()); }
    let size = num(&get(&renderer, "size"));
    let top = num(&get(&rect, "top")) - num(&get(&renderer, "start"));
    if top >= 0.0 && top <= size * 0.62 { return Ok(()); }
    let delta = top - size * 0.25;
    if delta > 0.0 && num(&get(&renderer, "viewSize")) - num(&get(&renderer, "end")) > 2.0 { settled(method(&view, "next", &[&delta.into()])?).await?; }
    else if delta < 0.0 && num(&get(&renderer, "start")) > 0.0 { settled(method(&view, "prev", &[&(-delta).into()])?).await?; }
    Ok(())
}

/// Turns pages with foliate's own animated paging (programmatic: it never goes through the
/// gesture callbacks that stop the voice) until the fragment being spoken is on screen. Only
/// the newest request matters; older ones yield.
#[wasm_bindgen]
pub fn foliate_follow(s: &JsValue, doc: &JsValue, range: &JsValue) -> Result<JsValue, JsValue> {
    if truthy(&get(&document(), "hidden")) { return Ok(JsValue::UNDEFINED); }
    // Text that is not rendered (a hidden note) has no boxes: there is no page to show it on, so never turn pages for it.
    if !truthy(range) || num(&get(&method(range, "getClientRects", &[])?, "length")) == 0.0 { return Ok(JsValue::UNDEFINED); }
    let ticket = num(&get(s, "followTicket")) + 1.0;
    set(s, "followTicket", &ticket.into())?;
    let turns = get(s, "turns");
    set(&turns, "followPending", &(num(&get(&turns, "followPending")) + 1.0).into())?;
    let (state, doc, range) = (s.clone(), doc.clone(), range.clone());
    let queue = method(&get(s, "followTurn"), "catch", &[&noop()])?;
    let step = Closure::once_into_js(move || -> Result<JsValue, JsValue> {
        Ok(eager(async move {
            let view = get(&state, "view");
            let renderer = get(&view, "renderer");
            let rendered = |renderer: &JsValue| -> Result<bool, JsValue> { Ok(Array::from(&method(renderer, "getContents", &[])?).iter().any(|item| get(&item, "doc") == doc)) };
            if ticket != num(&get(&state, "followTicket")) || !truthy(&renderer) || !rendered(&renderer)? { return Ok(JsValue::UNDEFINED); }
            if truthy(&get(&renderer, "scrolled")) { follow_scroll(state.clone(), doc.clone(), range.clone()).await?; return Ok(JsValue::UNDEFINED); }
            for _ in 0..4 {
                let visible = get(&get(&view, "lastLocation"), "range");
                if ticket != num(&get(&state, "followTicket")) || get(&get(&visible, "startContainer"), "ownerDocument") != doc { return Ok(JsValue::UNDEFINED); }
                let side = page_side(&visible, &range)?;
                if side == 0.0 { return Ok(JsValue::UNDEFINED); }
                let before = get(&view, "lastLocation");
                settled(method(&view, if side > 0.0 { "next" } else { "prev" }, &[])?).await?;
                // A turn requested while another one animates is ignored by foliate: retry.
                if get(&view, "lastLocation") == before { settled(pause(150.0).into()).await?; }
            }
            if ticket == num(&get(&state, "followTicket")) { settled(method(&renderer, "scrollToAnchor", &[&range])?).await?; }
            Ok(JsValue::UNDEFINED)
        }).into())
    });
    let turn = method(&queue, "then", &[&step])?;
    set(s, "followTurn", &turn)?;
    crate::promises::after(&turn, move || { let _ = set(&turns, "followPending", &(num(&get(&turns, "followPending")) - 1.0).into()); })?;
    Ok(turn)
}

/// Everything `getSpeechSource` needs that precedes the source itself: the early answers and the
/// visible section's text map and page breaks. Resolves `{ done, value }` with an early answer or
/// `{ view, doc, map, content, pageBreaks, start }`.
#[wasm_bindgen]
pub fn foliate_speech_prepare(s: JsValue, visible_only: bool, map_text: Function, page_breaks: Function) -> Promise {
    eager(async move {
        let cursor = cursor_of(&s);
        if !visible_only && truthy(&get(&document(), "hidden")) && truthy(&get(&cursor, "active")) {
            return plain(&[("done", JsValue::TRUE), ("value", method(&cursor, "currentSource", &[])?)]);
        }
        if !visible_only && truthy(&get(&cursor, "active")) && !truthy(&get(&cursor, "browsing")) { settled(method(&cursor, "reveal", &[])?).await?; }
        if !visible_only { method_opt(&cursor_of(&s), "reset", &[])?; }
        let view = get(&s, "view");
        let visible = get(&get(&view, "lastLocation"), "range");
        let doc = get(&get(&visible, "startContainer"), "ownerDocument");
        let contents = method_opt(&get(&view, "renderer"), "getContents", &[])?;
        let content = contents.and_then(|items| Array::from(&items).iter().find(|item| get(item, "doc") == doc)).unwrap_or(JsValue::UNDEFINED);
        if !truthy(&content) || !truthy(&get(&doc, "body")) { return plain(&[("done", JsValue::TRUE), ("value", JsValue::NULL)]); }
        crate::speech_highlight::speech_style(doc.clone(), &crate::host::text_of(&get(&get(&s, "preferences"), "theme")))?;
        let map = map_text.call1(&JsValue::UNDEFINED, &get(&doc, "body"))?;
        let renderer = get(&view, "renderer");
        let live = {
            let (state, view, doc) = (s.clone(), view.clone(), doc.clone());
            Closure::<dyn FnMut() -> Result<JsValue, JsValue>>::new(move || Ok(foliate_live(&state, &view, &doc)?.into()))
        };
        let measured = settled(page_breaks.call3(&JsValue::UNDEFINED, &map, &renderer, &plain(&[("isCurrent", live.as_ref().clone())])?)?).await;
        let page_breaks = measured?;
        if !foliate_live(&s, &view, &doc)? { return plain(&[("done", JsValue::TRUE), ("value", JsValue::NULL)]); }
        let start = method(&map, "offsetOf", &[&get(&visible, "startContainer"), &get(&visible, "startOffset")])?;
        plain(&[("done", JsValue::FALSE), ("view", view), ("doc", doc), ("map", map), ("content", content), ("pageBreaks", page_breaks), ("start", start)])
    })
}

/// Is the document of this speech source still the one on screen?
#[wasm_bindgen]
pub fn foliate_live(s: &JsValue, view: &JsValue, doc: &JsValue) -> Result<bool, JsValue> {
    Ok(get(s, "view") == *view && Array::from(&method(&read(view, "renderer")?, "getContents", &[])?).iter().any(|item| get(&item, "doc") == *doc))
}

/// Clearing also cancels a page turn still queued for a sentence nobody is reading any more.
#[wasm_bindgen]
pub fn foliate_clear_speech(s: &JsValue, doc: &JsValue, content: &JsValue) -> Result<(), JsValue> {
    set(s, "followTicket", &(num(&get(s, "followTicket")) + 1.0).into())?;
    crate::speech_highlight::speech_clear(doc.clone())?;
    let _ = method_opt(&get(content, "overlayer"), "remove", &[&"inhouse-speech".into()]); // overlay already gone
    Ok(())
}

/// Paint the sentence being spoken; old WebViews without the Highlight API still get the same
/// wash, drawn by foliate's own overlay.
#[wasm_bindgen]
pub fn foliate_speech_highlight(s: &JsValue, live: &Function, map: &JsValue, content: &JsValue, clear: &Function, start: &JsValue, end: &JsValue, draw: &JsValue) -> Result<(), JsValue> {
    if !live.call0(&JsValue::UNDEFINED)?.is_truthy() { return Ok(()); }
    let range = method(map, "rangeFor", &[start, end])?;
    if !truthy(&range) { clear.call0(&JsValue::UNDEFINED)?; return Ok(()); }
    if !crate::speech_highlight::speech_paint(range.clone())? {
        let theme = crate::host::text_of(&get(&get(s, "preferences"), "theme"));
        let color = plain(&[("color", crate::speech_highlight::speech_overlay(&theme).into())])?;
        method_opt(&get(content, "overlayer"), "add", &[&"inhouse-speech".into(), &range, draw, &color])?;
    }
    Ok(())
}

/// The text offset under a tap on this chapter, for ReadingVoice.jumpToPoint().
#[wasm_bindgen]
pub fn foliate_offset_at_point(live: &Function, tapped: &JsValue, doc: &JsValue, map: &JsValue, x: &JsValue, y: &JsValue) -> Result<f64, JsValue> {
    if tapped != doc || !live.call0(&JsValue::UNDEFINED)?.is_truthy() { return Ok(f64::NAN); }
    let caret = method_opt(doc, "caretPositionFromPoint", &[x, y])?.unwrap_or(JsValue::UNDEFINED);
    let at = |name: &str| -> Result<JsValue, JsValue> { Ok(method_opt(doc, "caretRangeFromPoint", &[x, y])?.map(|range| get(&range, name)).unwrap_or(JsValue::UNDEFINED)) };
    let node = if truthy(&caret) { get(&caret, "offsetNode") } else { at("startContainer")? };
    let offset = if truthy(&caret) { get(&caret, "offset") } else { at("startOffset")? };
    if !truthy(&node) { return Ok(f64::NAN); }
    Ok(num(&method(map, "offsetOf", &[&node, &offset])?))
}

/// Snapshot the current paginated column/scroll viewport after CFI restore.
#[wasm_bindgen]
pub fn foliate_snapshot(s: JsValue, deps: JsValue) -> Promise {
    eager(async move {
        let cursor = cursor_of(&s);
        if !truthy(&get(&document(), "hidden")) && truthy(&get(&cursor, "active")) { settled(method(&cursor, "reveal", &[])?).await?; }
        let view = get(&s, "view");
        let initial = match method_opt(&get(&view, "renderer"), "getContents", &[])? { Some(items) => Array::from(&items), None => Array::new() };
        let drawable = |item: &JsValue| { let doc = get(item, "doc"); truthy(&get(&doc, "body")) || get(&get(&doc, "documentElement"), "localName") == "svg" };
        if !initial.iter().any(|item| drawable(&item)) { return Ok(JsValue::NULL); }
        let settle = get(&deps, "settlePageLayout");
        let waits = Array::new();
        for item in initial.iter() { if truthy(&get(&item, "doc")) { waits.push(&call(&settle, "settlePageLayout", &[&get(&item, "doc")])?); } }
        settled(method(&get(&global(), "Promise"), "all", &[&waits])?).await?;
        if view != get(&s, "view") { return Ok(JsValue::NULL); }
        let viewport = method(&view, "getBoundingClientRect", &[])?;
        if !truthy(&get(&viewport, "width")) || !truthy(&get(&viewport, "height")) { return Ok(JsValue::NULL); }
        // Fixed-layout renderers expose both spread frames, including the hidden side on portrait
        // phones. Select actual visible frames, not array[0].
        let (vl, vt, vr, vb) = (num(&get(&viewport, "left")), num(&get(&viewport, "top")), num(&get(&viewport, "right")), num(&get(&viewport, "bottom")));
        let mut contents = Vec::new();
        let items = match method_opt(&get(&view, "renderer"), "getContents", &[])? { Some(items) => Array::from(&items), None => Array::new() };
        for item in items.iter() {
            let frame = get(&get(&get(&item, "doc"), "defaultView"), "frameElement");
            let rect = if truthy(&frame) { method(&frame, "getBoundingClientRect", &[])? } else { JsValue::UNDEFINED };
            if !truthy(&get(&rect, "width")) || !truthy(&get(&rect, "height")) { continue; }
            let (rl, rt, rr, rb) = (num(&get(&rect, "left")), num(&get(&rect, "top")), num(&get(&rect, "right")), num(&get(&rect, "bottom")));
            let (left, top, right, bottom) = (jmax(vl, rl), jmax(vt, rt), jmin(vr, rr), jmin(vb, rb));
            if right <= left || bottom <= top { continue; }
            let style = || method(&get(&get(&frame, "ownerDocument"), "defaultView"), "getComputedStyle", &[&frame]);
            let mut width = num(&get(&frame, "clientWidth"));
            if !nonzero(width) { width = crate::host::parse_float(&get(&style()?, "width")); }
            if !nonzero(width) { width = num(&get(&rect, "width")); }
            let mut height = num(&get(&frame, "clientHeight"));
            if !nonzero(height) { height = crate::host::parse_float(&get(&style()?, "height")); }
            if !nonzero(height) { height = num(&get(&rect, "height")); }
            contents.push((item.clone(), rect.clone(), num(&get(&rect, "width")) / width, num(&get(&rect, "height")) / height,
                plain(&[("left", left.into()), ("top", top.into()), ("width", (right - left).into()), ("height", (bottom - top).into())])?));
        }
        if contents.is_empty() { return Ok(JsValue::NULL); }
        let location = get(&view, "lastLocation");
        let theme = get(&get(&deps, "themes"), &crate::host::text_of(&get(&get(&s, "preferences"), "theme")));
        let background = get(&theme, "background");
        // The physical book starts with white paper even when the reader uses sepia.
        let paper = plain(&[("background", "#ffffff".into()), ("color", "#292821".into()), ("themeColor", get(&theme, "color"))])?;
        let filter = call(&get(&deps, "renderedPageFilter"), "renderedPageFilter", &[&get(&s, "container")])?;
        let deadline = JsValue::from_f64(clock()? + 1500.0);
        let pages = Array::new();
        for (item, rect, scale_x, scale_y, clip) in &contents {
            let doc = get(item, "doc");
            let root = if truthy(&get(&doc, "body")) { get(&doc, "body") } else if get(&get(&doc, "documentElement"), "localName") == "svg" { get(&doc, "documentElement") } else { JsValue::NULL };
            let range = if get(&get(&get(&location, "range"), "startContainer"), "ownerDocument") == doc { get(&location, "range") } else { JsValue::UNDEFINED };
            let options = plain(&[("viewport", viewport.clone()), ("offsetX", ((vl - num(&get(rect, "left"))) / scale_x).into()),
                ("offsetY", ((vt - num(&get(rect, "top"))) / scale_y).into()), ("coordinateScaleX", (*scale_x).into()), ("coordinateScaleY", (*scale_y).into()),
                ("clipBounds", clip.clone()), ("background", background.clone()), ("filter", filter.clone()), ("deadline", deadline.clone()), ("paper", paper.clone()), ("range", range)])?;
            let page = settled(call(&get(&deps, "snapshotDOMPage"), "snapshotDOMPage", &[&root, &options])?).await?;
            if truthy(&page) { pages.push(&page); }
        }
        let options = plain(&[("viewport", viewport.clone()), ("background", background), ("filter", filter), ("paperBackground", get(&paper, "background"))])?;
        let snapshot = call(&get(&deps, "compositePageSnapshots"), "compositePageSnapshots", &[&pages, &options])?;
        if !truthy(&snapshot) || view != get(&s, "view") || location != get(&view, "lastLocation") { return Ok(JsValue::NULL); }
        let page_label = get(&get(&location, "pageItem"), "label");
        let label = if truthy(&page_label) { page_label } else { or_text(get(&get(&location, "tocItem"), "label"), "") };
        let fraction = num(&get(&location, "fraction"));
        let fraction = if nonzero(fraction) { jmin(1.0, jmax(0.0, fraction)) } else { 0.0 };
        let cfi = get(&location, "cfi");
        let locator = if truthy(&cfi) { plain(&[("kind", "cfi".into()), ("value", cfi)])? } else { JsValue::NULL };
        let result = Object::assign(&Object::new(), &snapshot.unchecked_into());
        set(&result, "engine", &"foliate".into())?;
        set(&result, "sourceType", &"epub-page".into())?;
        set(&result, "label", &label)?;
        set(&result, "location", &plain(&[("fraction", fraction.into()), ("locator", locator)])?)?;
        Ok(result.into())
    })
}

/// Search the book; the first 200 hits, each with its excerpt split around the match.
#[wasm_bindgen]
pub fn foliate_search(s: JsValue, query: JsValue) -> Promise {
    eager(async move {
        let view = get(&s, "view");
        let text = |value: &JsValue| -> Result<JsValue, JsValue> { method(&crate::host::text_value(value), "trim", &[]) };
        if !truthy(&view) || !truthy(&text(&or_text(query.clone(), ""))?) { return Ok(Array::new().into()); }
        let results = Array::new();
        let hit = |label: JsValue, excerpt: &JsValue, cfi: &JsValue| -> Result<JsValue, JsValue> {
            let parts = if excerpt.is_string() { plain(&[("pre", excerpt.clone()), ("match", "".into()), ("post", "".into())])? } else {
                let part = |name: &str| { let value = get(excerpt, name); if absent(&value) { JsValue::from_str("") } else { crate::host::text_value(&value) } };
                plain(&[("pre", part("pre")), ("match", part("match")), ("post", part("post"))])?
            };
            let joined = format!("{}{}{}", crate::host::text_of(&get(&parts, "pre")), crate::host::text_of(&get(&parts, "match")), crate::host::text_of(&get(&parts, "post")));
            plain(&[("label", label), ("parts", parts), ("excerpt", joined.into()), ("locator", plain(&[("kind", "cfi".into()), ("value", cfi.clone())])?)])
        };
        let iterator = method(&view, "search", &[&plain(&[("query", text(&query)?)])?])?;
        let symbol = js_sys::Symbol::async_iterator();
        let cursor = js_sys::Reflect::get(&iterator, &symbol)?.dyn_into::<Function>()?.call0(&iterator)?;
        loop {
            let step = settled(method(&cursor, "next", &[])?).await?;
            if truthy(&get(&step, "done")) { break; }
            let item = get(&step, "value");
            if truthy(&get(&item, "cfi")) { results.push(&hit("".into(), &get(&item, "excerpt"), &get(&item, "cfi"))?); }
            for sub in Array::from(&or_array(get(&item, "subitems"))).iter() { results.push(&hit(or_text(get(&item, "label"), ""), &get(&sub, "excerpt"), &get(&sub, "cfi"))?); }
            if results.length() >= 200 {
                // Leaving a `for await` early closes the iterator.
                if let Some(closing) = method_opt(&cursor, "return", &[])? { settled(closing).await?; }
                break;
            }
        }
        Ok(results.into())
    })
}
fn or_array(value: JsValue) -> JsValue { if truthy(&value) { value } else { Array::new().into() } }

/// The text selected in any rendered section, with the CFI it starts at.
#[wasm_bindgen]
pub fn foliate_selection(s: &JsValue) -> Result<JsValue, JsValue> {
    let view = get(s, "view");
    let items = match method_opt(&get(&view, "renderer"), "getContents", &[])? { Some(items) => Array::from(&items), None => Array::new() };
    for item in items.iter() {
        let window = get(&get(&item, "doc"), "defaultView");
        let Some(selection) = method_opt(&window, "getSelection", &[])? else { continue };
        let text = method(&method(&selection, "toString", &[])?, "trim", &[])?;
        if truthy(&text) {
            let range = method(&method(&window, "getSelection", &[])?, "getRangeAt", &[&0.into()])?;
            let value = method(&view, "getCFI", &[&get(&item, "index"), &range])?;
            return plain(&[("text", text), ("locator", plain(&[("kind", "cfi".into()), ("value", value)])?)]);
        }
    }
    Ok(JsValue::NULL)
}

/// foliate marks search hits with Overlayer.outline (a 3px red box that looked like a debugging
/// layer). It is replaced once by a soft amber marker-pen wash, gentle in all five reading themes.
#[wasm_bindgen]
pub fn foliate_outline(rects: &JsValue, options: &JsValue) -> Result<JsValue, JsValue> {
    const SVG: &str = "http://www.w3.org/2000/svg";
    let color = get(options, "color");
    let group = method(&document(), "createElementNS", &[&SVG.into(), &"g".into()])?;
    method(&group, "setAttribute", &[&"fill".into(), &if color.is_undefined() { "#d9a23a".into() } else { color }])?;
    set(&get(&group, "style"), "opacity", &".34".into())?;
    for rect in Array::from(rects).iter() {
        let (left, top, width, height) = (num(&get(&rect, "left")), num(&get(&rect, "top")), num(&get(&rect, "width")), num(&get(&rect, "height")));
        let node = method(&document(), "createElementNS", &[&SVG.into(), &"rect".into()])?;
        for (name, value) in [("x", left - 1.5), ("y", top + height * 0.08), ("width", width + 3.0), ("height", height * 0.9), ("rx", 3.0)] {
            method(&node, "setAttribute", &[&name.into(), &value.into()])?;
        }
        method(&group, "append", &[&node])?;
    }
    Ok(group)
}
