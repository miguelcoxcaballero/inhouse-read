//! How the EPUB/MOBI/AZW3/FB2/CBZ reader (readers/foliate-reader.js `FoliateReader`) mounts a book
//! and hands the audiobook a chapter: the gestures, the view's event listeners, the paginator's
//! snap guard, the speech cursor, the resize observer and the handlers of a spoken source. The
//! callbacks that come back later are this module's own exports bound to their state
//! (`ui[name].bind(null, ...)`), so they keep no Rust closure alive and are collected with the view,
//! as the arrow functions they replace were. The JavaScript method keeps its awaits (`view.open`,
//! `view.init`) so the number of microtasks before `open()` settles is unchanged. `kit` holds the
//! doorways the module imported: attachSwipeNavigation, speechHold, the speech cursor class,
//! speechPageBreaks, readingCSS, announceSpeechLayout, Overlayer (read when used) and the two
//! arrows that stay JavaScript because they run on every pointer move or spoken sentence
//! (canSwipe, theme) or forward any number of arguments (the snap guard). The frozen original is
//! tests/unit/helpers/reference-foliate-reader.js; foliate-reader-wasm.test.js compares both.
use js_sys::{Array, Function, Object, Reflect};
use wasm_bindgen::{prelude::*, JsCast};
use crate::foliate_reader::{foliate_attach, foliate_follow, foliate_layout, foliate_offset_at_point,
    foliate_relocated, foliate_reset_cursor, foliate_skip_snap, foliate_speech_highlight, foliate_styles};
use crate::host::{absent, call, call_opt, clear_timeout, construct, get, global, method, read, set, set_timeout, text, truthy};

type R<T> = Result<T, JsValue>;

/// `ui[name].bind(null, ...args)`: a callback that runs one of this module's exports.
fn bound(ui: &JsValue, name: &str, args: &[&JsValue]) -> R<JsValue> {
    let function = read(ui, name)?;
    let list = Array::new();
    list.push(&JsValue::NULL);
    for argument in args { list.push(argument); }
    let bind: Function = read(&function, "bind")?.dyn_into().map_err(|_| JsValue::from(js_sys::TypeError::new("bind is not a function")))?;
    bind.apply(&function, &list)
}
fn door(kit: &JsValue, name: &str) -> R<JsValue> { read(kit, name) }
/// A function that does nothing: `onRelocate ?? (() => {})`.
fn noop() -> JsValue {
    thread_local! { static NOOP: JsValue = Closure::<dyn FnMut()>::new(|| {}).into_js_value(); }
    NOOP.with(JsValue::clone)
}
fn destructure_error(property: &str, of: &str, value: &JsValue) -> JsValue {
    let what = if value.is_null() { "null" } else { "undefined" };
    js_sys::TypeError::new(&format!("Cannot destructure property '{property}' of '{of}' as it is {what}.")).into()
}

/// The first half of `open()`, up to `await view.open(file)`: an empty view in the container, the
/// swipe/tap gestures on it and the listeners of its events. Returns the view.
#[wasm_bindgen]
#[allow(clippy::too_many_arguments)]
pub fn foliate_open(owner: &JsValue, s: &JsValue, container: &JsValue, on_relocate: &JsValue, on_toggle_chrome: &JsValue,
    on_user_navigation: &JsValue, on_follow_link: &JsValue, kit: &JsValue, ui: &JsValue) -> R<JsValue> {
    let relocate = if absent(on_relocate) { noop() } else { on_relocate.clone() };
    let view = foliate_attach(s, container, &relocate)?;
    // foliate-js is deliberately low level and has no touch gestures of its own: the same swipe/tap
    // detector as the PDF reader keeps both formats feeling the same under the finger.
    let gestures: JsValue = Object::new().into();
    set(&gestures, "onNext", &bound(ui, "foliate_gesture", &[owner, s, &"next".into(), on_user_navigation])?)?;
    set(&gestures, "onPrev", &bound(ui, "foliate_gesture", &[owner, s, &"prev".into(), on_user_navigation])?)?;
    set(&gestures, "onToggleChrome", on_toggle_chrome)?;
    // Foliate already tracks touch drag/velocity and snaps to the next page.
    // A second pointerup navigation here used to advance twice per swipe.
    set(&gestures, "nativeTouchSwipes", &JsValue::TRUE)?;
    set(&gestures, "onNativeSwipe", &bound(ui, "foliate_gesture", &[owner, s, &"native".into(), on_user_navigation])?)?;
    set(&gestures, "onManualPan", &bound(ui, "foliate_gesture", &[owner, s, &"pan".into(), on_user_navigation])?)?;
    set(&gestures, "canSwipe", &call(&door(kit, "canSwipe")?, "canSwipe", &[s])?)?;
    set(s, "detachGestures", &call(&door(kit, "attach")?, "attachSwipeNavigation", &[container, &gestures])?)?;
    let tap_zone = bound(ui, "foliate_tap_zone", &[s])?;
    // Events inside the book iframe do not bubble to the outer viewport.
    method(&view, "addEventListener", &[&"load".into(), &bound(ui, "foliate_load_event", &[s, &gestures, &tap_zone, kit, ui])?])?;
    method(&view, "addEventListener", &[&"link".into(), &bound(ui, "foliate_link_event", &[on_follow_link])?])?;
    method(&view, "addEventListener", &[&"draw-annotation".into(), &bound(ui, "foliate_draw_event", &[kit])?])?;
    method(&view, "addEventListener", &[&"relocate".into(), &bound(ui, "foliate_relocate_event", &[s])?])?;
    Ok(view)
}

/// A gesture of the outer viewport: a swipe or tap that turns the page (`next`/`prev`), a native
/// touch swipe that moved it (`native`) or a manual pan of a scrolled book (`pan`).
#[wasm_bindgen]
pub fn foliate_gesture(owner: &JsValue, s: &JsValue, which: &str, on_user_navigation: &JsValue) -> R<JsValue> {
    match which {
        "next" | "prev" => {
            call_opt(on_user_navigation, "onUserNavigation", &[])?;
            foliate_skip_snap(s)?;
            method(owner, which, &[])
        }
        "native" => {
            call_opt(on_user_navigation, "onUserNavigation", &[])?;
            foliate_reset_cursor(s)?;
            Ok(JsValue::UNDEFINED)
        }
        _ => {
            if text(&read(&read(s, "preferences")?, "flow")?, "scrolled") { call_opt(on_user_navigation, "onUserNavigation", &[])?; }
            Ok(JsValue::UNDEFINED)
        }
    }
}

/// A section loaded into its iframe: the same gestures inside it, with the hold that starts
/// narration and the tap zones judged against the visible reader, and its selections as quotes.
#[wasm_bindgen]
pub fn foliate_load_event(s: &JsValue, gestures: &JsValue, tap_zone: &JsValue, kit: &JsValue, ui: &JsValue, event: &JsValue) -> R<()> {
    let detail = read(event, "detail")?;
    let doc = read(&detail, "doc")?;
    let list = read(s, "documentGestures")?;
    let push = read(&list, "push")?;
    let element = read(&doc, "documentElement")?;
    let options: JsValue = Object::new().into();
    Object::assign(options.unchecked_ref(), gestures.unchecked_ref());
    let hold = call(&door(kit, "hold")?, "speechHold", &[&doc])?;
    Object::assign(options.unchecked_ref(), hold.unchecked_ref());
    set(&options, "tapZone", tap_zone)?;
    let detach = call(&door(kit, "attach")?, "attachSwipeNavigation", &[&element, &options])?;
    push.dyn_ref::<Function>().ok_or_else(|| JsValue::from(js_sys::TypeError::new("s.documentGestures.push is not a function")))?.call1(&list, &detach)?;
    method(&doc, "addEventListener", &[&"selectionchange".into(), &bound(ui, "foliate_selected", &[s, &detail])?])?;
    Ok(())
}

/// A link inside the book: the reader follows it itself when it was given a way to.
#[wasm_bindgen]
pub fn foliate_link_event(on_follow_link: &JsValue, event: &JsValue) -> R<()> {
    if truthy(on_follow_link) {
        method(event, "preventDefault", &[])?;
        let href = read(&read(event, "detail")?, "href")?;
        call(on_follow_link, "onFollowLink", &[&href])?;
    }
    Ok(())
}

/// A quote highlighted in its colour (yellow for anything else).
#[wasm_bindgen]
pub fn foliate_draw_event(kit: &JsValue, event: &JsValue) -> R<()> {
    let detail = read(event, "detail")?;
    if absent(&detail) { return Err(destructure_error("draw", "event.detail", &detail)); }
    let draw = read(&detail, "draw")?;
    let annotation = read(&detail, "annotation")?;
    let colors: JsValue = Object::new().into();
    for (name, color) in [("green", "#75ad6b66"), ("blue", "#74a6d866"), ("pink", "#df8dad66"), ("yellow", "#f2d35d77")] { set(&colors, name, &color.into())?; }
    let highlight = read(&door(kit, "Overlayer")?, "highlight")?;
    let chosen = Reflect::get(&colors, &read(&annotation, "color")?)?;
    let color = if truthy(&chosen) { chosen } else { get(&colors, "yellow") };
    let options: JsValue = Object::new().into();
    set(&options, "color", &color)?;
    call(&draw, "draw", &[&highlight, &options])?;
    Ok(())
}

/// Where Foliate went, as the reader's own record.
#[wasm_bindgen]
pub fn foliate_relocate_event(s: &JsValue, event: &JsValue) -> R<()> { foliate_relocated(s, &read(event, "detail")?) }

/// After `await view.open(file)`: the paginator's snap guard, then its geometry and styles before
/// the first page is laid out (its defaults reserve 48 px above/below the text even though our
/// chrome has its own space; the first visible page must use the same geometry as later pages).
#[wasm_bindgen]
pub fn foliate_opened(s: &JsValue, view: &JsValue, kit: &JsValue, ui: &JsValue) -> R<()> {
    let renderer = read(view, "renderer")?;
    if !absent(&renderer) {
        let snap = read(&renderer, "snap")?;
        if !absent(&snap) {
            let snap = method(&snap, "bind", &[&renderer])?;
            if truthy(&snap) { set(&renderer, "snap", &call(&door(kit, "guardSnap")?, "guardSnap", &[ui, s, &snap])?)?; }
        }
    }
    foliate_layout(s, door(kit, "announce")?.unchecked_ref())?;
    foliate_styles(s, door(kit, "readingCSS")?.unchecked_ref())
}

/// After `await view.init(...)`: the audiobook's cursor over the book and a relayout 80 ms after
/// the container stops resizing.
#[wasm_bindgen]
pub fn foliate_ready(s: &JsValue, view: &JsValue, container: &JsValue, kit: &JsValue, ui: &JsValue) -> R<()> {
    let options: JsValue = Object::new().into();
    set(&options, "onRelocate", &read(s, "onRelocate")?)?;
    set(&options, "theme", &call(&door(kit, "theme")?, "theme", &[s])?)?;
    let cursor = door(kit, "SpeechCursor")?;
    let cursor: Function = cursor.dyn_into().map_err(|_| JsValue::from(js_sys::TypeError::new("FoliateSpeechCursor is not a constructor")))?;
    let list = Array::new();
    list.push(view);
    list.push(&options);
    set(s, "speechCursor", &Reflect::construct(&cursor, &list)?)?;
    if !get(&global(), "ResizeObserver").is_undefined() {
        let observer = construct("ResizeObserver", &[&bound(ui, "foliate_resized", &[s, &door(kit, "announce")?, ui])?])?;
        set(s, "resizeObserver", &observer)?;
        method(&observer, "observe", &[container])?;
    }
    Ok(())
}

/// The container was resized: lay the book out again once it has been still for 80 ms.
#[wasm_bindgen]
pub fn foliate_resized(s: &JsValue, announce: &JsValue, ui: &JsValue) -> R<()> {
    clear_timeout(&get(s, "resizeTimer"))?;
    set(s, "resizeTimer", &set_timeout(&bound(ui, "foliate_layout", &[s, announce])?, 80.0)?)
}

/// The rest of `getSpeechSource()` once the chapter is prepared (see foliate_speech_prepare): the
/// audiobook reads from the visible page to the end of its section, so a sentence keeps one
/// highlight across page breaks, and its audio fragments end at actual page boundaries, so the next
/// audible fragment turns the page. Offsets index the returned text; the DOM is only read (ranges
/// for the highlight), never changed.
#[wasm_bindgen]
pub fn foliate_speech_source(s: &JsValue, prepared: &JsValue, kit: &JsValue, ui: &JsValue) -> R<JsValue> {
    let view = read(prepared, "view")?;
    let doc = read(prepared, "doc")?;
    let map = read(prepared, "map")?;
    let content = read(prepared, "content")?;
    let page_breaks = read(prepared, "pageBreaks")?;
    let start = read(prepared, "start")?;
    let live = bound(ui, "foliate_live", &[s, &view, &doc])?;
    let clear = bound(ui, "foliate_clear_speech", &[s, &doc, &content])?;
    let source: JsValue = Object::new().into();
    set(&source, "text", &read(&map, "text")?)?;
    set(&source, "start", &start)?;
    set(&source, "pageBreaks", &page_breaks)?;
    set(&source, "clear", &clear)?;
    set(&source, "highlight", &bound(ui, "foliate_source_highlight", &[s, &live, &map, &content, &clear, kit])?)?;
    set(&source, "follow", &bound(ui, "foliate_source_follow", &[s, &live, &doc, &map])?)?;
    // The text offset under a tap on this chapter, for ReadingVoice.jumpToPoint().
    set(&source, "offsetAtPoint", &bound(ui, "foliate_source_offset", &[&live, &doc, &map])?)?;
    // Measured again after a relayout: see ReadingVoice.refreshPageBreaks().
    set(&source, "measurePageBreaks", &bound(ui, "foliate_source_breaks", &[&live, &map, &view, kit])?)?;
    // Web fonts arriving after the cuts were measured move lines between pages.
    if truthy(&read(&doc, "fonts")?) && !text(&read(&read(&doc, "fonts")?, "status")?, "loaded") {
        method(&read(&read(&doc, "fonts")?, "ready")?, "then", &[&door(kit, "announce")?])?;
    }
    let cursor = read(s, "speechCursor")?;
    let wrapped = if absent(&cursor) { JsValue::UNDEFINED } else {
        let wrap = read(&cursor, "wrap")?;
        let index = read(&content, "index")?;
        wrap.dyn_ref::<Function>().ok_or_else(|| JsValue::from(js_sys::TypeError::new("s.speechCursor?.wrap is not a function")))?
            .call3(&cursor, &source, &map, &index)?
    };
    Ok(if truthy(&wrapped) { wrapped } else { source })
}

/// `source.highlight(from, to)`: paint the sentence being spoken (Overlayer.highlight is read now).
#[wasm_bindgen]
#[allow(clippy::too_many_arguments)]
pub fn foliate_source_highlight(s: &JsValue, live: &Function, map: &JsValue, content: &JsValue, clear: &Function, kit: &JsValue,
    from: &JsValue, to: &JsValue) -> R<()> {
    let draw = read(&door(kit, "Overlayer")?, "highlight")?;
    foliate_speech_highlight(s, live, map, content, clear, from, to, &draw)
}

/// `source.follow(from, to)`: keep the spoken sentence on screen while its chapter is shown.
#[wasm_bindgen]
pub fn foliate_source_follow(s: &JsValue, live: &Function, doc: &JsValue, map: &JsValue, from: &JsValue, to: &JsValue) -> R<JsValue> {
    if !live.call0(&JsValue::UNDEFINED)?.is_truthy() { return Ok(JsValue::UNDEFINED); }
    let range = method(map, "rangeFor", &[from, to])?;
    foliate_follow(s, doc, &range)
}

/// `source.offsetAtPoint(tapped, x, y)`.
#[wasm_bindgen]
pub fn foliate_source_offset(live: &Function, doc: &JsValue, map: &JsValue, tapped: &JsValue, x: &JsValue, y: &JsValue) -> R<f64> {
    foliate_offset_at_point(live, tapped, doc, map, x, y)
}

/// `source.measurePageBreaks()`: the page cuts again, while the chapter is the one on screen and
/// the page is visible; otherwise a promise of null.
#[wasm_bindgen]
pub fn foliate_source_breaks(live: &Function, map: &JsValue, view: &JsValue, kit: &JsValue) -> R<JsValue> {
    if live.call0(&JsValue::UNDEFINED)?.is_truthy() && !truthy(&read(&get(&global(), "document"), "hidden")?) {
        let options: JsValue = Object::new().into();
        set(&options, "isCurrent", live)?;
        return call(&door(kit, "pageBreaks")?, "speechPageBreaks", &[map, &read(view, "renderer")?, &options]);
    }
    Ok(js_sys::Promise::resolve(&JsValue::NULL).into())
}

// --- The audiobook's cursor over an EPUB (readers/foliate-speech-cursor.js `FoliateSpeechCursor`) ---------------------
// Audiobook chapter text must not wait for a hidden WebView to navigate an iframe: Foliate's own
// detached documents and CFI parser give the same source text and exact saved position, and
// rendering is only needed on return. The decisions are foliate_cursor.rs; these build the cursor
// and the handlers of the sources it gives out.

/// The cursor's constructor: its view and book, the chapter progress, and a reveal of the audible
/// position when the page becomes visible again.
#[wasm_bindgen]
#[allow(clippy::too_many_arguments)]
pub fn cursor_construct(host: &JsValue, view: &JsValue, env: &JsValue, on_relocate: &JsValue, theme: &JsValue, kit: &JsValue, ui: &JsValue) -> R<()> {
    set(host, "view", view)?;
    set(host, "env", env)?;
    set(host, "onRelocate", on_relocate)?;
    set(host, "theme", theme)?;
    set(host, "book", &read(view, "book")?)?;
    set(host, "epoch", &0.into())?;
    set(host, "current", &JsValue::NULL)?;
    set(host, "revealing", &JsValue::NULL)?;
    set(host, "closed", &JsValue::FALSE)?;
    set(host, "browsing", &JsValue::FALSE)?;
    let book = read(host, "book")?;
    let sections = if absent(&book) { JsValue::UNDEFINED } else { read(&book, "sections")? };
    let sections = if truthy(&sections) { sections } else { Array::new().into() };
    let progress: Function = door(kit, "SectionProgress")?.dyn_into().map_err(|_| JsValue::from(js_sys::TypeError::new("SectionProgress is not a constructor")))?;
    let list = Array::new();
    list.push(&sections);
    list.push(&1500.into());
    list.push(&1600.into());
    set(host, "progress", &Reflect::construct(&progress, &list)?)?;
    set(host, "onVisibility", &bound(ui, "cursor_visibility", &[host, env])?)?;
    method(env, "addEventListener", &[&"visibilitychange".into(), &read(host, "onVisibility")?])?;
    Ok(())
}

/// The page became visible: show the audible position (a failure leaves it for the next reveal).
#[wasm_bindgen]
pub fn cursor_visibility(host: &JsValue, env: &JsValue) -> R<()> {
    if !truthy(&read(env, "hidden")?) {
        let revealed = method(host, "reveal", &[])?;
        method(&revealed, "catch", &[&noop()])?;
    }
    Ok(())
}

/// `wrap(source, map, index)`: a precise logical position attached to the chapter already on
/// screen, whose ordinary page cuts and highlighting stay in use while it is visible.
#[wasm_bindgen]
pub fn cursor_wrap(host: &JsValue, source: &JsValue, map: &JsValue, index: &JsValue, kit: &JsValue, ui: &JsValue) -> R<JsValue> {
    let highlight = read(source, "highlight")?;
    let follow = read(source, "follow")?;
    let clear = read(source, "clear")?;
    let state = crate::foliate_cursor::cursor_state(host, source, map, index, door(kit, "mapText")?.unchecked_ref())?;
    set(source, "adopt", &bound(ui, "cursor_adopt", &[host, &state])?)?;
    set(source, "highlight", &bound(ui, "cursor_highlight", &[host, &state, &highlight])?)?;
    set(source, "follow", &bound(ui, "cursor_follow", &[host, &state, map, &follow])?)?;
    set(source, "clear", &bound(ui, "cursor_clear", &[&state, &clear])?)?;
    Ok(source.clone())
}

/// `source.adopt()`: the wrapped chapter belongs to the cursor's current epoch.
#[wasm_bindgen]
pub fn cursor_adopt(host: &JsValue, state: &JsValue) -> R<()> { set(state, "epoch", &read(host, "epoch")?) }

/// The handlers of a detached chapter `next()` found (`found` is `{ source, state, epoch, previous }`):
/// it becomes the cursor's current chapter only when its voice starts (`activate`), and once on
/// screen its pages break where the rendered copy of the same text does.
#[wasm_bindgen]
pub fn cursor_source(host: &JsValue, found: &JsValue, is_active: &JsValue, kit: &JsValue, ui: &JsValue) -> R<JsValue> {
    let source = read(found, "source")?;
    let state = read(found, "state")?;
    let epoch = read(found, "epoch")?;
    let previous = read(found, "previous")?;
    let map = read(&state, "map")?;
    let valid = bound(ui, "cursor_check", &[host, &epoch, &previous, is_active])?;
    let flag: JsValue = Object::new().into();
    set(&flag, "activated", &JsValue::FALSE)?;
    set(&source, "isValid", &bound(ui, "cursor_source_valid", &[host, &state, &flag, &valid])?)?;
    set(&source, "activate", &bound(ui, "cursor_activate", &[host, &state, &flag, &valid, &source])?)?;
    set(&source, "measurePageBreaks", &bound(ui, "cursor_source_breaks", &[host, &state, &source, &flag, &map, kit])?)?;
    set(&source, "highlight", &bound(ui, "cursor_sentence", &[&state])?)?;
    set(&source, "follow", &bound(ui, "cursor_source_follow", &[host, &state, &source, &flag])?)?;
    set(&source, "clear", &bound(ui, "cursor_source_clear", &[host, &state])?)?;
    Ok(source)
}
fn activated(flag: &JsValue) -> bool { truthy(&get(flag, "activated")) }

/// `source.isValid()`: before activation, the epoch/position check of the search; afterwards,
/// whether the cursor is still valid and this chapter is still its current one.
#[wasm_bindgen]
pub fn cursor_source_valid(host: &JsValue, state: &JsValue, flag: &JsValue, valid: &Function) -> R<JsValue> {
    if !activated(flag) { return valid.call0(&JsValue::UNDEFINED); }
    let still = method(host, "valid", &[])?;
    if !truthy(&still) { return Ok(still); }
    Ok((read(host, "current")? == *state).into())
}

/// `source.activate()`: the chapter whose voice starts becomes the cursor's current one.
#[wasm_bindgen]
pub fn cursor_activate(host: &JsValue, state: &JsValue, flag: &JsValue, valid: &Function, source: &JsValue) -> R<JsValue> {
    if activated(flag) { return method(source, "isValid", &[]); }
    if !valid.call0(&JsValue::UNDEFINED)?.is_truthy() { return Ok(JsValue::FALSE); }
    set(flag, "activated", &JsValue::TRUE)?;
    set(host, "current", state)?;
    Ok(JsValue::TRUE)
}

/// `source.measurePageBreaks()` of a detached chapter.
#[wasm_bindgen]
pub fn cursor_source_breaks(host: &JsValue, state: &JsValue, source: &JsValue, flag: &JsValue, map: &JsValue, kit: &JsValue) -> R<JsValue> {
    Ok(crate::foliate_cursor::cursor_measure(host.clone(), state.clone(), source.clone(), activated(flag), map.clone(),
        door(kit, "mapText")?.unchecked_into(), door(kit, "pageBreaks")?.unchecked_into()).into())
}

/// `source.highlight(start, end)` of a detached chapter: only remembered, shown on return.
#[wasm_bindgen]
pub fn cursor_sentence(state: &JsValue, start: &JsValue, end: &JsValue) -> R<()> {
    let sentence = Array::new();
    sentence.push(start);
    sentence.push(end);
    set(state, "sentence", &sentence)
}

/// `source.follow(start, end)` of a detached chapter: remember the audible position and show it
/// when the page is visible.
#[wasm_bindgen]
pub fn cursor_source_follow(host: &JsValue, state: &JsValue, source: &JsValue, flag: &JsValue, start: &JsValue, end: &JsValue) -> R<JsValue> {
    if !activated(flag) || !method(source, "isValid", &[])?.is_truthy() { return Ok(JsValue::UNDEFINED); }
    method(host, "remember", &[state, start, end])?;
    if !truthy(&read(&read(host, "env")?, "hidden")?) { return method(host, "reveal", &[]); }
    Ok(JsValue::UNDEFINED)
}

/// `source.clear()` of a detached chapter: forget its sentence and wipe the highlight from every
/// section on screen (a closed document has nothing left to wipe).
#[wasm_bindgen]
pub fn cursor_source_clear(host: &JsValue, state: &JsValue) -> R<()> {
    set(state, "sentence", &JsValue::NULL)?;
    let renderer = read(&read(host, "view")?, "renderer")?;
    let contents = crate::host::method_opt(&renderer, "getContents", &[])?.unwrap_or(JsValue::UNDEFINED);
    let contents = if truthy(&contents) { contents } else { Array::new().into() };
    for content in Array::from(&contents).iter() {
        crate::speech_highlight::speech_clear(read(&content, "doc")?)?;
        let _ = read(&content, "overlayer").and_then(|overlayer| crate::host::method_opt(&overlayer, "remove", &[&"inhouse-speech".into()]));
    }
    Ok(())
}

