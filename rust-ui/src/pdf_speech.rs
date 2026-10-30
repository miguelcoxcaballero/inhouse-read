//! What the audiobook and the library ask of an open PDF: the page's text mapped onto the
//! rendered text layer, the next page drawn off screen until its voice starts, the cursor that
//! follows the sentence, and the snapshot the opening book is painted from. The sources are
//! plain objects whose few callbacks the JavaScript class creates and hand back here, with the
//! state they share (`q`) as the first argument.
use std::{cell::RefCell, rc::Rc};
use wasm_bindgen::{prelude::*, JsCast};
use js_sys::{Array, Object, Promise};
use crate::eager::{eager, settled};
use crate::host::{absent, call, construct, get, get_at, global, jmax, method, method_opt, num, number_string, read, set, text_of, truthy};
use crate::pdf_reader::{always_true, cancel_render, cancelled, destructure, dep, draw_page, emit_location, invalidate_staged, invoke, noop, plain, prefs, release_original,
    remember_text_position, render, render_is_intact, same_render_key, settle_text_resize, speech_geometry, text_mode, use_rendered_page, window, Valid};

const SPEECH_SPAN_CLASS: &str = "inhouse-speech-current";
const MAX_EMPTY_SPEECH_PAGES: f64 = 12.0;

fn page_count(s: &JsValue) -> f64 { let count = get(&get(s, "doc"), "numPages"); if absent(&count) { 0.0 } else { num(&count) } }
fn scale_one() -> Result<JsValue, JsValue> { plain(&[("scale", 1.into())]) }
fn frozen() -> Result<JsValue, JsValue> { Ok(Object::freeze(&Object::new()).into()) }

/// May the page staged for the voice still be shown? Nothing it was drawn for has changed.
pub(crate) fn staged_valid(s: &JsValue, staged: &JsValue) -> Result<bool, JsValue> {
    if truthy(&get(staged, "invalid")) || get(s, "stagedSpeech") != *staged { return Ok(false); }
    guard_holds(s, &get(staged, "guard"))
}

fn speech_map(s: &JsValue) -> Result<JsValue, JsValue> {
    if text_mode(s) { return invoke(s, "mapTextNodes", &[&get(s, "reflow")]); }
    let mapped = invoke(s, "mapPDFTextLayer", &[&get(s, "textLayerEl"), &get(&get(s, "renderState"), "textLayout")])?;
    if truthy(&mapped) { Ok(mapped) } else { invoke(s, "mapTextLayer", &[&get(s, "textLayerEl")]) }
}

/// The text of a page as the voice reads it, which is not always the page on the screen.
fn page_text(s: &JsValue, content: &JsValue, page: &JsValue) -> Result<JsValue, JsValue> {
    Ok(get(&invoke(s, "extractPDFText", &[content, &method(page, "getViewport", &[&scale_one()?])?])?, "text"))
}

#[wasm_bindgen]
pub fn pdf_speech_text(s: JsValue) -> Promise {
    eager(async move {
        if !truthy(&get(&s, "doc")) { return Ok("".into()); }
        let page = settled(method(&get(&s, "doc"), "getPage", &[&get(&s, "pageNum")])?).await?;
        let content = settled(method(&page, "getTextContent", &[])?).await?;
        page_text(&s, &content, &page)
    })
}

/// The page's text as the audiobook reads it, mapped onto the rendered text layer (or the reflow text) it is highlighted in.
#[wasm_bindgen]
pub fn pdf_speech_source(s: JsValue, options: JsValue) -> Promise {
    eager(async move {
        let options = destructure(&options)?;
        if !truthy(&get(&s, "doc")) { return Ok(JsValue::NULL); }
        loop {
            let pending = get(&s, "renderReady");
            settled(pending.clone()).await?;
            if !(truthy(&get(&s, "doc")) && pending != get(&s, "renderReady")) { break; }
        }
        if !truthy(&get(&s, "doc")) { return Ok(JsValue::NULL); }
        let (pdf, number) = (get(&s, "doc"), get(&s, "pageNum"));
        let made = crate::reader_assembly::pdf_make_source(&s, &number, &speech_map(&s)?, &get(&get(&s, "renderState"), "textLayout"))?;
        let source = get(&made, "source");
        if truthy(&get(&options, "completeSentences")) {
            set(&source, "start", &if text_mode(&s) { visible_offset(&s)? } else { 0.0 }.into())?;
            if num(&number) > 1.0 && num(&get(&source, "start")) == 0.0 {
                let previous = settled(method(&pdf, "getPage", &[&(num(&number) - 1.0).into()])?).await?;
                let content = settled(method(&previous, "getTextContent", &[])?).await?;
                if pdf != get(&s, "doc") || number != get(&s, "pageNum") { return Err(cancelled()); }
                set(&source, "previousText", &page_text(&s, &content, &previous)?)?;
            }
        }
        Ok(source)
    })
}

fn visible_offset(s: &JsValue) -> Result<f64, JsValue> { crate::pdf_reader::visible_text_offset(s) }

// ---- one spoken source -----------------------------------------------------------------------

/// The state a source shares with its callbacks: its document, page and the text map it follows.
#[wasm_bindgen]
pub fn pdf_speech_begin(s: &JsValue, page: &JsValue, first: &JsValue) -> Result<JsValue, JsValue> {
    let doc = get(&get(s, "container"), "ownerDocument");
    crate::speech_highlight::speech_style(doc.clone(), &text_of(&get(&prefs(s), "theme")))?;
    plain(&[("pdf", get(s, "doc")), ("doc", doc), ("page", page.clone()), ("first", first.clone()), ("map", first.clone()), ("marked", Array::new().into())])
}

fn mapped_to_visible(s: &JsValue, q: &JsValue) -> Result<bool, JsValue> {
    let node = get(&get_at(&get(&get(q, "map"), "spans"), 0), "node");
    let root = if text_mode(s) { get(s, "reflow") } else { get(s, "textLayerEl") };
    Ok(truthy(&node) && truthy(&get(&node, "isConnected")) && truthy(&method(&root, "contains", &[&node])?))
}

/// A zoom or view change re-renders the layer under a paused voice: re-map it, but only if it is still this page's text.
#[wasm_bindgen]
pub fn pdf_speech_current(s: &JsValue, q: &JsValue) -> Result<JsValue, JsValue> {
    let (pdf, page) = (get(q, "pdf"), get(q, "page"));
    if get(s, "doc") == pdf && page == get(s, "pageNum") && !mapped_to_visible(s, q)? {
        let again = speech_map(s)?;
        // TextLayer omits the final item's separator; reflow retains it. Only this
        // trailing whitespace may differ: every spoken character keeps its raw offset.
        if method(&get(&again, "text"), "trimEnd", &[])? == method(&get(&get(q, "first"), "text"), "trimEnd", &[])? { set(q, "map", &again)?; }
    }
    Ok(if get(s, "doc") == pdf && page == get(s, "pageNum") && mapped_to_visible(s, q)? { get(q, "map") } else { JsValue::NULL })
}

#[wasm_bindgen]
pub fn pdf_speech_clear(q: &JsValue) -> Result<(), JsValue> {
    crate::speech_highlight::speech_clear(get(q, "doc"))?;
    for element in Array::from(&get(q, "marked")).iter() { method(&get(&element, "classList"), "remove", &[&SPEECH_SPAN_CLASS.into()])?; }
    set(q, "marked", &Array::new())
}

#[wasm_bindgen]
pub fn pdf_speech_highlight(s: &JsValue, q: &JsValue, start: &JsValue, end: &JsValue) -> Result<(), JsValue> {
    if truthy(&get(s, "speechBrowsing")) { return Ok(()); }
    let live = pdf_speech_current(s, q)?;
    let range = method_opt(&live, "rangeFor", &[start, end])?.unwrap_or(JsValue::UNDEFINED);
    pdf_speech_clear(q)?;
    if !truthy(&range) { return Ok(()); }
    if crate::speech_highlight::speech_paint(range)? { return Ok(()); }
    // Fallback for WebViews without the Highlight API: tint the text-layer spans (or reflow page) the sentence touches.
    let marked = Array::new();
    let (from, to) = (num(start), num(end));
    for span in Array::from(&get(&live, "spans")).iter() {
        if num(&get(&span, "end")) > from && num(&get(&span, "start")) < to { marked.push(&get(&get(&span, "node"), "parentElement")); }
    }
    set(q, "marked", &marked)?;
    for element in marked.iter() { method(&get(&element, "classList"), "add", &[&SPEECH_SPAN_CLASS.into()])?; }
    Ok(())
}

#[wasm_bindgen]
pub fn pdf_speech_follow(s: &JsValue, q: &JsValue, source: &JsValue, start: &JsValue, end: &JsValue) -> Result<(), JsValue> {
    let page = get(q, "page");
    set(s, "speechCursor", &plain(&[("page", page.clone()), ("start", start.clone()), ("end", end.clone()), ("source", source.clone())])?)?;
    if truthy(&get(s, "speechBrowsing")) { return Ok(()); }
    if page != get(s, "pageNum") { method(&reveal_speech(s)?, "catch", &[&noop()])?; return Ok(()); }
    settle_text_resize(s)?;
    let found = pdf_speech_current(s, q)?;
    let range = method_opt(&found, "rangeFor", &[start, end])?.unwrap_or(JsValue::UNDEFINED);
    let rects = method_opt(&range, "getClientRects", &[])?.unwrap_or(JsValue::UNDEFINED);
    let container = get(s, "container");
    let bounds = method(&container, "getBoundingClientRect", &[])?;
    let offset = crate::speech_highlight::speech_follow(rects, bounds)?;
    if !truthy(&offset) { return Ok(()); }
    let target = Object::assign(&Object::new(), offset.unchecked_ref::<Object>());
    let reduced = match method_opt(&window(), "matchMedia", &[&"(prefers-reduced-motion: reduce)".into()])? { Some(list) => truthy(&read(&list, "matches")?), None => false };
    set(&target, "behavior", &if reduced { "instant" } else { "smooth" }.into())?;
    method(&container, "scrollBy", &[&target])?;
    Ok(())
}

/// The text offset under a tap on this page, for ReadingVoice.jumpToPoint().
#[wasm_bindgen]
pub fn pdf_speech_offset(s: &JsValue, q: &JsValue, tapped: &JsValue, x: &JsValue, y: &JsValue) -> Result<f64, JsValue> {
    let doc = get(q, "doc");
    if *tapped != doc { return Ok(f64::NAN); }
    let caret = method_opt(&doc, "caretPositionFromPoint", &[x, y])?.unwrap_or(JsValue::UNDEFINED);
    let range = if truthy(&caret) { JsValue::NULL } else { method_opt(&doc, "caretRangeFromPoint", &[x, y])?.unwrap_or(JsValue::UNDEFINED) };
    let node = get(&caret, "offsetNode");
    let node = if truthy(&node) { node } else { get(&range, "startContainer") };
    let live = pdf_speech_current(s, q)?;
    if !truthy(&node) || !truthy(&live) { return Ok(f64::NAN); }
    let known = Array::from(&get(&live, "spans")).iter().any(|span| get(&span, "node") == node);
    if !known { return Ok(f64::NAN); }
    let offset = get(&caret, "offset");
    let offset = if absent(&offset) { read(&range, "startOffset")? } else { offset };
    Ok(num(&method(&live, "offsetOf", &[&node, &offset])?))
}

// ---- following the voice ---------------------------------------------------------------------

#[wasm_bindgen]
pub fn pdf_speech_browse(s: &JsValue) -> Result<(), JsValue> { set(s, "speechBrowsing", &JsValue::TRUE)?; set(s, "speechDetached", &JsValue::TRUE) }

#[wasm_bindgen]
pub fn pdf_speech_stop(s: &JsValue) -> Result<(), JsValue> {
    set(s, "speechBrowsing", &JsValue::FALSE)?;
    set(s, "speechDetached", &JsValue::FALSE)?;
    set(s, "speechCursor", &JsValue::NULL)?;
    invalidate_staged(s)
}

#[wasm_bindgen]
pub fn pdf_speech_return(s: JsValue) -> Promise {
    eager(async move {
        set(&s, "speechBrowsing", &JsValue::FALSE)?;
        settled(reveal_speech(&s)?).await?;
        Ok(JsValue::UNDEFINED)
    })
}

/// Bring the page being read back to the screen and the sentence into view, once.
fn reveal_speech(s: &JsValue) -> Result<JsValue, JsValue> {
    let running = get(s, "speechReveal");
    if truthy(&running) { return Ok(running); }
    let (pdf, owner) = (get(s, "doc"), s.clone());
    let work = eager(async move {
        let s = owner;
        while !truthy(&get(&s, "speechBrowsing")) && pdf == get(&s, "doc") && truthy(&get(&s, "speechCursor")) {
            let target = get(&s, "speechCursor");
            if get(&target, "page") != get(&s, "pageNum") {
                settled(method(&get(&s, "owner"), "goToPage", &[&get(&target, "page"), &plain(&[("textOffset", get(&target, "start"))])?])?).await?;
            }
            if pdf != get(&s, "doc") || truthy(&get(&s, "speechBrowsing")) { return Ok(JsValue::UNDEFINED); }
            if target != get(&s, "speechCursor") && get(&target, "page") != get(&get(&s, "speechCursor"), "page") { continue; }
            let current = get(&s, "speechCursor");
            let source = get(&current, "source");
            for action in ["highlight", "follow"] {
                if truthy(&current) { method_opt(&source, action, &[&get(&current, "start"), &get(&current, "end")])?; }
            }
            return Ok(JsValue::UNDEFINED);
        }
        Ok(JsValue::UNDEFINED)
    });
    let slot: Rc<RefCell<JsValue>> = Rc::new(RefCell::new(JsValue::UNDEFINED));
    let finish = {
        let (owner, slot) = (s.clone(), slot.clone());
        Closure::once_into_js(move || { if get(&owner, "speechReveal") == *slot.borrow() { let _ = set(&owner, "speechReveal", &JsValue::NULL); } })
    };
    let task = method(&work, "finally", &[&finish])?;
    *slot.borrow_mut() = task.clone();
    set(s, "speechReveal", &task)?;
    Ok(task)
}

/// The source after the one being read while the reader is browsing elsewhere: no page is drawn.
fn next_detached(s: JsValue, is_active: JsValue, after: JsValue) -> Promise {
  eager(async move {
    let pdf = get(&s, "doc");
    let previous = if !absent(&after) { num(&after) } else {
        let cursor = get(&get(&s, "speechCursor"), "page");
        if !absent(&cursor) { num(&cursor) } else { num(&get(&s, "pageNum")) }
    };
    let mut number = previous + 1.0;
    while number <= crate::host::jmin(num(&get(&pdf, "numPages")), previous + MAX_EMPTY_SPEECH_PAGES) {
        let page = settled(method(&pdf, "getPage", &[&number.into()])?).await?;
        let content = settled(method(&page, "getTextContent", &[])?).await?;
        if get(&s, "doc") != pdf || !truthy(&call(&is_active, "isActive", &[])?) { return Err(cancelled()); }
        let layout = invoke(&s, "extractPDFText", &[&content, &method(&page, "getViewport", &[&scale_one()?])?])?;
        if truthy(&method(&get(&layout, "text"), "trim", &[])?) {
            let made = crate::reader_assembly::pdf_make_source(&s, &number.into(), &plain(&[("text", get(&layout, "text")), ("spans", Array::new().into())])?, &layout)?;
            let source = get(&made, "source");
            crate::reader_assembly::pdf_detach(&s, &source, &pdf, &is_active)?;
            return Ok(source);
        }
        number += 1.0;
    }
    Ok(JsValue::NULL)
  })
}

/// Draw the next readable PDF page without relocating or replacing the visible page.
/// Only activate(), called on the engine's audible start, commits its pixels and exact
/// text mapping. This avoids showing the next page throughout neural synthesis.
#[wasm_bindgen]
pub fn pdf_next_speech(s: JsValue, options: JsValue) -> Promise {
    eager(async move {
        let options = destructure(&options)?;
        let active = get(&options, "isActive");
        let active = if active.is_undefined() { always_true() } else { active };
        let after = get(&options, "afterPage");
        let integer = after.as_f64().is_some_and(|value| value.is_finite() && value.fract() == 0.0);
        if truthy(&get(&s, "doc")) && (truthy(&get(&s, "speechDetached")) || integer && after != get(&s, "pageNum")) { return Ok(next_detached(s, active, after).into()); }
        invalidate_staged(&s)?;
        if !truthy(&get(&s, "doc")) || !truthy(&call(&active, "isActive", &[])?) { return Err(cancelled()); }
        let (pdf, previous, token, preferences) = (get(&s, "doc"), get(&s, "pageNum"), get(&s, "renderToken"), get(&s, "preferences"));
        let request = num(&get(&s, "speechRequest")) + 1.0;
        set(&s, "speechRequest", &request.into())?;
        let (geometry, pending) = (speech_geometry(&s)?, get(&s, "renderReady"));
        let guard = plain(&[("pdf", pdf.clone()), ("previousPage", previous.clone()), ("token", token), ("preferences", preferences.clone()), ("request", request.into()),
            ("geometry", geometry.into()), ("isActive", active)])?;
        settled(pending.clone()).await?;
        if !guard_holds(&s, &guard)? || pending != get(&s, "renderReady") { return Err(cancelled()); }
        if num(&previous) == num(&get(&pdf, "numPages")) { return Ok(JsValue::NULL); }
        let staged = plain(&[("pageWrap", method(&get(&s, "pageWrap"), "cloneNode", &[&JsValue::FALSE])?), ("canvas", method(&get(&s, "canvas"), "cloneNode", &[&JsValue::FALSE])?),
            ("textLayerEl", method(&get(&s, "textLayerEl"), "cloneNode", &[&JsValue::FALSE])?), ("reflow", method(&get(&s, "reflow"), "cloneNode", &[&JsValue::FALSE])?),
            ("invalid", JsValue::FALSE), ("guard", guard.clone())])?;
        method(&get(&get(&staged, "reflow"), "classList"), "remove", &[&SPEECH_SPAN_CLASS.into()])?;
        method(&get(&staged, "pageWrap"), "append", &[&get(&staged, "canvas"), &get(&staged, "textLayerEl")])?;
        set(&s, "stagedSpeech", &staged)?;
        let attempt: Result<JsValue, JsValue> = async {
            let mut number = num(&previous) + 1.0;
            while number <= num(&get(&pdf, "numPages")) && number <= num(&previous) + MAX_EMPTY_SPEECH_PAGES {
                let page = settled(method(&pdf, "getPage", &[&number.into()])?).await?;
                if !staged_valid(&s, &staged)? { return Err(cancelled()); }
                let content = settled(method(&page, "getTextContent", &[])?).await?;
                if !staged_valid(&s, &staged)? { return Err(cancelled()); }
                let readable = Closure::<dyn FnMut(JsValue) -> bool>::new(|item: JsValue| { let text = get(&item, "str"); text.is_string() && truthy(&method(&text, "trim", &[]).unwrap_or(JsValue::UNDEFINED)) });
                if !truthy(&method(&get(&content, "items"), "some", &[readable.as_ref()])?) {
                    if number == num(&get(&pdf, "numPages")) { invalidate_staged(&s)?; return Ok(JsValue::NULL); }
                    number += 1.0;
                    continue;
                }
                if !truthy(&settled(draw_page(&s, &page, &staged, Valid::Staged(staged.clone()), content).into()).await?) { return Err(cancelled()); }
                let layer = get(&staged, "textLayerEl");
                let first = if get(&preferences, "pdfMode") == "text" { invoke(&s, "mapTextNodes", &[&get(&staged, "reflow")])? } else {
                    let mapped = invoke(&s, "mapPDFTextLayer", &[&layer, &get(&staged, "textLayout")])?;
                    if truthy(&mapped) { mapped } else { invoke(&s, "mapTextLayer", &[&layer])? }
                };
                if !truthy(&method(&get(&first, "text"), "trim", &[])?) { return Err(js_sys::Error::new("No se pudo preparar el texto de la página siguiente.").into()); }
                let made = crate::reader_assembly::pdf_make_source(&s, &number.into(), &first, &get(&staged, "textLayout"))?;
                let source = get(&made, "source");
                let shared = plain(&[("staged", staged.clone()), ("pdf", pdf.clone()), ("number", number.into()), ("current", get(&made, "current")), ("clear", get(&source, "clear")),
                    ("source", source.clone()), ("activated", JsValue::FALSE)])?;
                crate::reader_assembly::pdf_stage(&s, &source, &shared)?;
                return Ok(source);
            }
            Err(js_sys::Error::new("Página siguiente sin texto legible.").into())
        }.await;
        match attempt {
            Ok(source) => Ok(source),
            Err(error) => {
                let stale = !staged_valid(&s, &staged)?;
                if get(&s, "stagedSpeech") == staged { invalidate_staged(&s)?; }
                Err(if stale { cancelled() } else { error })
            }
        }
    })
}

/// The conditions a prepared page was drawn under, all still true?
fn guard_holds(s: &JsValue, guard: &JsValue) -> Result<bool, JsValue> {
    if get(s, "doc") != get(guard, "pdf") || get(s, "pageNum") != get(guard, "previousPage") || get(s, "renderToken") != get(guard, "token")
        || get(s, "preferences") != get(guard, "preferences") || get(guard, "request") != get(s, "speechRequest") { return Ok(false); }
    if !truthy(&call(&get(guard, "isActive"), "isActive", &[])?) { return Ok(false); }
    let geometry = get(guard, "geometry");
    for index in 0..num(&get(&geometry, "length")) as u32 {
        let now = speech_geometry(s)?;
        if get_at(&geometry, index) != now.get(index) { return Ok(false); }
    }
    Ok(true)
}

#[wasm_bindgen]
pub fn pdf_source_valid(s: &JsValue, q: &JsValue) -> Result<JsValue, JsValue> {
    let staged = get(q, "staged");
    if get(s, "doc") != get(q, "pdf") { return Ok(JsValue::FALSE); }
    if truthy(&get(s, "speechDetached")) { return call(&get(&get(&staged, "guard"), "isActive"), "isActive", &[]); }
    if truthy(&get(q, "activated")) { return Ok(truthy(&call(&get(q, "current"), "current", &[])?).into()); }
    Ok(staged_valid(s, &staged)?.into())
}

#[wasm_bindgen]
pub fn pdf_source_activate(s: &JsValue, q: &JsValue) -> Result<JsValue, JsValue> {
    let (staged, source) = (get(q, "staged"), get(q, "source"));
    if truthy(&get(q, "activated")) { return method(&source, "isValid", &[]); }
    if truthy(&get(s, "speechDetached")) && get(s, "doc") == get(q, "pdf") && truthy(&call(&get(&get(&staged, "guard"), "isActive"), "isActive", &[])?) {
        set(q, "activated", &JsValue::TRUE)?;
        return Ok(JsValue::TRUE);
    }
    if !staged_valid(s, &staged)? { method(&source, "clear", &[])?; return Ok(JsValue::FALSE); }
    set(s, "stagedSpeech", &JsValue::NULL)?;
    let state = get(s, "renderState");
    cancel_render(&state)?;
    release_original(&state)?;
    crate::pdf_reflow::clear(&get(s, "reflow"))?;
    set(s, "renderToken", &(num(&get(s, "renderToken")) + 1.0).into())?;
    let old = get(s, "canvas");
    method(&get(s, "pageWrap"), "replaceWith", &[&get(&staged, "pageWrap")])?;
    method(&get(s, "reflow"), "replaceWith", &[&get(&staged, "reflow")])?;
    for name in ["pageWrap", "canvas", "textLayerEl", "reflow"] { set(s, name, &get(&staged, name))?; }
    set(s, "renderState", &staged)?;
    crate::pdf_reader::cancel_resize(s)?;
    set(s, "renderRequest", &JsValue::NULL)?;
    set(s, "renderReady", &Promise::resolve(&JsValue::TRUE))?;
    set(s, "pageNum", &get(q, "number"))?;
    use_rendered_page(s, &staged)?;
    crate::pdf_reader::clear_slot(s, "scrollTimer")?;
    set(&get(s, "container"), "scrollTop", &0.into())?;
    set(s, "textOffset", &0.into())?;
    set(&old, "height", &0.into())?;
    set(&old, "width", &0.into())?;
    set(q, "activated", &JsValue::TRUE)?;
    emit_location(s)?;
    Ok(JsValue::TRUE)
}

#[wasm_bindgen]
pub fn pdf_source_clear(s: &JsValue, q: &JsValue) -> Result<(), JsValue> {
    if truthy(&get(q, "activated")) { call(&get(q, "clear"), "clear", &[])?; return Ok(()); }
    let staged = get(q, "staged");
    if get(s, "stagedSpeech") == staged { invalidate_staged(s) } else { set(&staged, "invalid", &JsValue::TRUE) }
}

// ---- the opening snapshot --------------------------------------------------------------------

/// The restored reading page, copied only after its latest render settles.
pub(crate) fn snapshot(s: JsValue, options: JsValue) -> Promise {
    eager(async move {
        let options = destructure(&options)?;
        let reuse_value = get(&options, "reuseSettledLayout");
        let reuse_value = if reuse_value.is_undefined() { JsValue::FALSE } else { reuse_value };
        let reuse = truthy(&reuse_value);
        let again = |s: &JsValue| -> Result<JsValue, JsValue> { method(&get(s, "owner"), "getPageSnapshot", &[&plain(&[("reuseSettledLayout", reuse_value.clone())])?]) };
        if !truthy(&get(&s, "doc")) { return Ok(JsValue::NULL); }
        let mut pending;
        loop {
            pending = get(&s, "renderReady");
            settled(pending.clone()).await?;
            if !(truthy(&get(&s, "doc")) && pending != get(&s, "renderReady")) { break; }
        }
        if !truthy(&get(&s, "doc")) { return Ok(JsValue::NULL); }
        let text = text_mode(&s);
        let current = |s: &JsValue| -> Result<bool, JsValue> {
            let state = get(s, "renderState");
            Ok(same_render_key(&get(&state, "key"), &crate::pdf_reader::render_key(s)?) && render_is_intact(s, &state))
        };
        // An explicit snapshot can arrive before ResizeObserver's delayed render.
        // Finish that exact render first, preserving the page, text and resolution.
        if reuse && !text && !current(&s)? {
            crate::pdf_reader::cancel_resize(&s)?;
            settled(render(&s)?).await?;
            return again(&s);
        }
        // Completed physical pixels need no additional paints when their layout
        // and text are intact. DOM text still waits for fonts and both frames.
        let settled_physical = reuse && !text && absent(&get(&s, "resizeTimer")) && current(&s)?;
        if !settled_physical {
            settled(invoke(&s, "settlePageLayout", &[&get(&get(&s, "container"), "ownerDocument"), &plain(&[("waitForFonts", text.into())])?])?).await?;
        }
        if !truthy(&get(&s, "doc")) || pending != get(&s, "renderReady") || text != text_mode(&s) { return again(&s); }
        let page = get(&s, "pageNum");
        if text { settle_text_resize(&s)?; remember_text_position(&s)?; }
        // Physical white pages blend into the current reader theme on opening.
        let theme = crate::pdf_reader::at(&dep(&s, "READING_THEMES"), &get(&prefs(&s), "theme"));
        let canvas = get(&s, "canvas");
        let canvas_filter = if text { JsValue::NULL } else { invoke(&s, "renderedPageFilter", &[&canvas])? };
        let snapshot = if text {
            let (container, reflow) = (get(&s, "container"), get(&s, "reflow"));
            let paper = plain(&[("background", "#ffffff".into()), ("color", "#292821".into()), ("themeColor", get(&theme, "color"))])?;
            let viewport = method(&container, "getBoundingClientRect", &[])?;
            let offset_x = get(&method(&container, "getBoundingClientRect", &[])?, "left");
            let offset_y = get(&method(&container, "getBoundingClientRect", &[])?, "top");
            let background = get(&call(&get(&global(), "getComputedStyle"), "getComputedStyle", &[&reflow])?, "backgroundColor");
            let filter = invoke(&s, "renderedPageFilter", &[&reflow])?;
            let request = plain(&[("paper", paper), ("viewport", viewport), ("offsetX", offset_x), ("offsetY", offset_y), ("background", background), ("filter", filter)])?;
            settled(invoke(&s, "snapshotDOMPage", &[&reflow, &request])?).await?
        } else {
            let origin = get(&get(&s, "renderState"), "originalCanvas");
            let request = plain(&[("filter", canvas_filter.clone()), ("displayBounds", method(&canvas, "getBoundingClientRect", &[])?), ("paper", JsValue::TRUE),
                ("paperSource", if truthy(&origin) { origin } else { canvas.clone() })])?;
            invoke(&s, "snapshotCanvas", &[&canvas, &request])?
        };
        if !truthy(&snapshot) || !truthy(&get(&s, "doc")) || page != get(&s, "pageNum") { return Ok(JsValue::NULL); }
        if !text {
            // Each snapshot still owns fresh copies of the exact page pixels. Reuse
            // only its margin-colour measurement while the settled raster, source
            // dimensions and applied filter remain identical. Navigation, rendering,
            // zoom, theme or brightness changes invalidate both opaque tokens.
            let origin = get(&get(&s, "renderState"), "originalCanvas");
            let original = if truthy(&origin) { origin } else { canvas.clone() };
            let facts = Array::new();
            for fact in [get(&s, "doc"), pending.clone(), get(&s, "renderToken"), canvas.clone(), get(&canvas, "width"), get(&canvas, "height"), original.clone(),
                get(&original, "width"), get(&original, "height"), canvas_filter.clone()] { facts.push(&fact); }
            let known = get(&s, "snapshotToneState");
            let stale = !truthy(&known) || (0..10u32).any(|index| facts.get(index) != get_at(&get(&known, "facts"), index));
            if stale {
                if truthy(&known) { method(&get(&known, "controller"), "abort", &[])?; }
                let fresh = plain(&[("facts", facts.clone().into()), ("theme", frozen()?), ("paper", frozen()?), ("themeRaster", frozen()?), ("paperRaster", frozen()?),
                    ("controller", construct("AbortController", &[])?)])?;
                set(&s, "snapshotToneState", &fresh)?;
            }
            let state = get(&s, "snapshotToneState");
            set(&snapshot, "toneKey", &get(&state, "theme"))?;
            if truthy(&get(&snapshot, "paper")) { set(&get(&snapshot, "paper"), "toneKey", &get(&state, "paper"))?; }
            // Both copies use the exact same source, filter and resampling when the
            // physical page is already unfiltered white paper. Share only that proven
            // raster's tone and texture revision; changed themes retain separate maps.
            let same_paper = original == canvas && canvas_filter == "none";
            if same_paper && truthy(&get(&snapshot, "paper")) { invoke(&s, "sharePaperTone", &[&get(&state, "paper"), &get(&state, "theme")])?; }
            settled(invoke(&s, "prepareSnapshotPaperTones", &[&snapshot, &plain(&[("signal", get(&get(&state, "controller"), "signal"))])?])?).await?;
            if !truthy(&get(&s, "doc")) { return Ok(JsValue::NULL); }
            let now = get(&s, "canvas");
            if state != get(&s, "snapshotToneState") || pending != get(&s, "renderReady") || page != get(&s, "pageNum")
                || facts.get(2) != get(&s, "renderToken") || text_mode(&s)
                || facts.get(4) != get(&now, "width") || facts.get(5) != get(&now, "height")
                || facts.get(7) != get(&original, "width") || facts.get(8) != get(&original, "height")
                || canvas_filter != invoke(&s, "renderedPageFilter", &[&now])?
                || settled_physical && !current(&s)? { return again(&s); }
            invoke(&s, "registerPageRaster", &[&get(&snapshot, "source"), &get(&state, "themeRaster")])?;
            if truthy(&get(&snapshot, "paper")) {
                invoke(&s, "registerPageRaster", &[&get(&get(&snapshot, "paper"), "source"), &if same_paper { get(&state, "themeRaster") } else { get(&state, "paperRaster") }])?;
            }
        } else {
            let known = get(&s, "snapshotToneState");
            if !absent(&known) { method(&get(&known, "controller"), "abort", &[])?; }
            set(&s, "snapshotToneState", &JsValue::UNDEFINED)?;
        }
        let result = Object::assign(&Object::new(), snapshot.unchecked_ref::<Object>());
        let count = page_count(&s);
        let own = get(&snapshot, "text");
        let number = num(&page);
        set(&result, "engine", &"pdf".into())?;
        set(&result, "sourceType", &if text { "pdf-text" } else { "pdf-canvas" }.into())?;
        set(&result, "text", &if truthy(&own) { own } else { get(&s, "pageText") })?;
        set(&result, "label", &format!("Página {} de {}", number_string(number), number_string(count)).into())?;
        let locator = plain(&[("kind", "pdf-page".into()), ("value", page.clone())])?;
        let offset = num(&get(&s, "textOffset"));
        if offset > 0.0 { set(&locator, "textOffset", &offset.into())?; }
        set(&result, "location", &plain(&[("fraction", ((number - 1.0) / jmax(1.0, count - 1.0)).into()), ("locator", locator)])?)?;
        Ok(result.into())
    })
}
