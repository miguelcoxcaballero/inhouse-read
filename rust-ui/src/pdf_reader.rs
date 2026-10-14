//! Reading of PDF on PDF.js. The library decodes and rasterises; every decision about which page
//! is drawn, how a page is fitted, adapted to a text mode, re-themed, restored, searched and
//! captured is made here. The reader's state is the plain object `s` its JavaScript class holds
//! (document, page wrappers, render bookkeeping, timers) and `s.kit` carries the JavaScript
//! functions it calls (PDF.js, the text extractor, the reflow builder, the snapshot painter).
//! Every function that was `async` is still a promise that runs to its first wait at once and
//! goes on in the microtask in which what it waits for settles (see `eager`).
use std::{cell::RefCell, rc::Rc};
use wasm_bindgen::{prelude::*, JsCast};
use js_sys::{Array, Function, Object, Promise, Reflect, JSON};
use crate::eager::{eager, settled};
use crate::host::{absent, adopt, call, call_opt, clamp, clear_timeout, construct, finite, get, get_at, global, jmax, jmin, js_round, method, method_opt, next_key, num, number_string, read, release, set, set_timeout, text_of, truthy};

const ZOOM_STEP_SCALE: f64 = 2.2;
const IMAGE_OPS: [&str; 8] = ["paintImageXObject", "paintInlineImageXObject", "paintImageXObjectRepeat", "paintInlineImageXObjectGroup",
    "paintImageMaskXObject", "paintImageMaskXObjectRepeat", "paintImageMaskXObjectGroup", "paintSolidColorImageMask"];

pub(crate) fn document() -> JsValue { get(&global(), "document") }
pub(crate) fn window() -> JsValue { get(&global(), "window") }
pub(crate) fn plain(entries: &[(&str, JsValue)]) -> Result<JsValue, JsValue> {
    let object = Object::new();
    for (name, value) in entries { set(&object, name, value)?; }
    Ok(object.into())
}
pub(crate) fn nonzero(value: f64) -> bool { value != 0.0 && !value.is_nan() }
/// A function that does nothing, for promise handlers and callbacks that only mean "carry on".
pub(crate) fn noop() -> JsValue {
    thread_local! { static NOOP: JsValue = Closure::<dyn FnMut()>::new(|| {}).into_js_value(); }
    NOOP.with(JsValue::clone)
}
/// `() => true`, the default of the callers' `isActive`.
pub(crate) fn always_true() -> JsValue {
    thread_local! { static YES: JsValue = Closure::<dyn FnMut() -> bool>::new(|| true).into_js_value(); }
    YES.with(JsValue::clone)
}
pub(crate) fn dep(s: &JsValue, name: &str) -> JsValue { get(&get(s, "kit"), name) }
pub(crate) fn invoke(s: &JsValue, name: &str, args: &[&JsValue]) -> Result<JsValue, JsValue> { call(&dep(s, name), name, args) }
pub(crate) fn prefs(s: &JsValue) -> JsValue { get(s, "preferences") }
pub(crate) fn text_mode(s: &JsValue) -> bool { get(&prefs(s), "pdfMode") == "text" }
pub(crate) fn pixel_ratio() -> f64 { let ratio = num(&get(&window(), "devicePixelRatio")); if nonzero(ratio) { ratio } else { 1.0 } }
fn px(value: f64) -> JsValue { format!("{}px", number_string(value)).into() }
pub(crate) fn at(object: &JsValue, key: &JsValue) -> JsValue { Reflect::get(object, key).unwrap_or(JsValue::UNDEFINED) }
fn scale_of(value: f64) -> Result<JsValue, JsValue> { plain(&[("scale", value.into())]) }
pub(crate) fn cancelled() -> JsValue {
    construct("DOMException", &[&"La preparación de la página ha cambiado.".into(), &"AbortError".into()]).unwrap_or_else(|error| error)
}
/// `{ a, b } = options` where the parameter defaults to `{}`: only `undefined` falls back.
pub(crate) fn destructure(options: &JsValue) -> Result<JsValue, JsValue> {
    if options.is_undefined() { Ok(Object::new().into()) }
    else if options.is_null() { Err(js_sys::TypeError::new("Cannot destructure 'undefined' or 'null'.").into()) }
    else { Ok(options.clone()) }
}
fn scroll_to(container: &JsValue, entries: &[(&str, JsValue)]) -> Result<(), JsValue> {
    let target = plain(entries)?;
    set(&target, "behavior", &"instant".into())?;
    method(container, "scrollTo", &[&target])?;
    Ok(())
}

/// A one-shot timer kept in `s[slot]`; its callback is owned until it runs or the slot is cleared.
pub(crate) fn schedule(s: &JsValue, slot: &str, delay: f64, task: impl FnOnce(&JsValue) -> Result<(), JsValue> + 'static) -> Result<(), JsValue> {
    let (key, owner, mut task) = (next_key(), s.clone(), Some(task));
    let callback = adopt(key, Closure::wrap(Box::new(move |_: JsValue| {
        release(key);
        if let Some(task) = task.take() { if let Err(error) = task(&owner) { wasm_bindgen::throw_val(error) } }
    }) as Box<dyn FnMut(JsValue)>));
    set(s, slot, &set_timeout(&callback, delay)?)?;
    set(s, &format!("{slot}Key"), &(key as f64).into())
}
/// `clearTimeout(s[slot])`, letting go of the callback it would have run.
pub(crate) fn clear_slot(s: &JsValue, slot: &str) -> Result<(), JsValue> {
    clear_timeout(&get(s, slot))?;
    if let Some(key) = get(s, &format!("{slot}Key")).as_f64() { release(key as u64); set(s, &format!("{slot}Key"), &JsValue::UNDEFINED)?; }
    Ok(())
}

pub(crate) fn container_width(s: &JsValue) -> Result<f64, JsValue> {
    let container = get(s, "container");
    let width = num(&get(&container, "clientWidth"));
    if nonzero(width) { return Ok(width); }
    let width = num(&get(&method(&container, "getBoundingClientRect", &[])?, "width"));
    Ok(if nonzero(width) { width } else { 360.0 })
}

pub(crate) fn speech_geometry(s: &JsValue) -> Result<Array, JsValue> {
    let container = get(s, "container");
    let bounds = method(&container, "getBoundingClientRect", &[])?;
    let width = container_width(s)?;
    let height = get(&container, "clientHeight");
    Ok(Array::of3(&width.into(), &if truthy(&height) { height } else { get(&bounds, "height") }, &pixel_ratio().into()))
}

// ---- where the reader is inside a page ------------------------------------------------------

pub(crate) fn visible_text_offset(s: &JsValue) -> Result<f64, JsValue> {
    let reflow = get(s, "reflow");
    let map = invoke(s, "mapTextNodes", &[&reflow])?;
    let doc = get(&reflow, "ownerDocument");
    let length_of = |text: &JsValue| num(&get(text, "length"));
    let (text, offset) = (get(&map, "text"), num(&get(s, "textOffset")));
    if !text_mode(s) || !truthy(&text) || !truthy(&get(&doc, "createRange")) { return Ok(offset); }
    let edge = num(&get(&method(&get(s, "container"), "getBoundingClientRect", &[])?, "top"));
    let range = method(&doc, "createRange", &[])?;
    if !get(&range, "getClientRects").is_function() { return Ok(offset); }
    let (mut low, mut high) = (0u32, length_of(&text) as u32);
    while low < high {
        let middle = (low + high) >> 1;
        let found = method(&map, "rangeFor", &[&middle.into(), &(middle + 1).into()])?;
        let first = match method_opt(&found, "getClientRects", &[])? { Some(rects) => get_at(&rects, 0), None => JsValue::UNDEFINED };
        if !truthy(&first) || num(&get(&first, "bottom")) <= edge + 1.0 { low = middle + 1; } else { high = middle; }
    }
    Ok(jmin(length_of(&text), low.into()))
}

fn restore_text_offset(s: &JsValue, offset: &JsValue) -> Result<(), JsValue> {
    if !text_mode(s) { return Ok(()); }
    let map = invoke(s, "mapTextNodes", &[&get(s, "reflow")])?;
    let text = get(&map, "text");
    let length = num(&get(&text, "length"));
    let wanted = num(offset);
    let wanted = if nonzero(wanted) { wanted.trunc() } else { 0.0 };
    let clamped = jmin(length, jmax(0.0, wanted));
    set(s, "textOffset", &clamped.into())?;
    if !truthy(&text) || !nonzero(clamped) { return Ok(()); }
    let range = method(&map, "rangeFor", &[&jmin(clamped, length - 1.0).into(), &jmin(clamped + 1.0, length).into()])?;
    let first = match method_opt(&range, "getClientRects", &[])? { Some(rects) => get_at(&rects, 0), None => JsValue::UNDEFINED };
    if truthy(&first) {
        let container = get(s, "container");
        let top = num(&get(&container, "scrollTop")) + num(&get(&first, "top")) - num(&get(&method(&container, "getBoundingClientRect", &[])?, "top"));
        scroll_to(&container, &[("top", top.into())])?;
    }
    Ok(())
}

fn text_layout_changed(s: &JsValue) -> Result<bool, JsValue> {
    Ok((container_width(s)? - num(&get(s, "layoutWidth"))).abs() >= 1.0 || get(&get(s, "container"), "clientHeight") != get(s, "textHeight"))
}

pub(crate) fn cancel_resize(s: &JsValue) -> Result<(), JsValue> { clear_slot(s, "resizeTimer")?; set(s, "resizeTimer", &JsValue::NULL) }

pub(crate) fn settle_text_resize(s: &JsValue) -> Result<(), JsValue> {
    if !truthy(&get(s, "doc")) || !text_mode(s) || absent(&get(s, "resizeTimer")) && !text_layout_changed(s)? { return Ok(()); }
    cancel_resize(s)?;
    clear_slot(s, "scrollTimer")?;
    set(s, "layoutWidth", &container_width(s)?.into())?;
    set(s, "textHeight", &get(&get(s, "container"), "clientHeight"))?;
    restore_text_offset(s, &get(s, "textOffset"))
}

pub(crate) fn emit_location(s: &JsValue) -> Result<(), JsValue> {
    let doc = get(s, "doc");
    if !truthy(&doc) { return Ok(()); }
    let page = num(&get(s, "pageNum"));
    let offset = num(&get(s, "textOffset"));
    let location = plain(&[("index", (page - 1.0).into()), ("fraction", ((page - 1.0) / jmax(1.0, num(&get(&doc, "numPages")) - 1.0)).into())])?;
    if offset > 0.0 { set(&location, "textOffset", &offset.into())?; }
    call(&get(s, "onRelocate"), "onRelocate", &[&location])?;
    Ok(())
}

pub(crate) fn remember_text_position(s: &JsValue) -> Result<(), JsValue> {
    if !truthy(&get(s, "doc")) || !text_mode(s) || truthy(&get(&get(s, "reflow"), "hidden")) { return Ok(()); }
    // A queued scroll event can arrive before ResizeObserver after rotation.
    // Those pixels belong to the new layout, not a new reading position.
    if !absent(&get(s, "resizeTimer")) { return Ok(()); }
    if text_layout_changed(s)? { return on_resize(s); }
    let offset = visible_text_offset(s)?;
    if get(s, "textOffset") == offset { return Ok(()); }
    set(s, "textOffset", &offset.into())?;
    emit_location(s)
}

fn move_text_viewport(s: &JsValue, direction: f64) -> Result<bool, JsValue> {
    if !text_mode(s) { return Ok(false); }
    settle_text_resize(s)?;
    let container = get(s, "container");
    let height = num(&get(&container, "clientHeight"));
    if !(height > 0.0) { return Ok(false); }
    let end = jmax(0.0, num(&get(&container, "scrollHeight")) - height);
    let current = jmin(end, jmax(0.0, num(&get(&container, "scrollTop"))));
    if if direction > 0.0 { current >= end - 1.0 } else { current <= 1.0 } { return Ok(false); }
    // One line of overlap makes words on a viewport boundary readable in full.
    let line = (num(&get(&prefs(s), "fontSize")) * num(&get(&prefs(s), "lineHeight"))).ceil();
    let top = jmin(end, jmax(0.0, current + direction * jmax(1.0, height - line)));
    scroll_to(&container, &[("top", top.into())])?;
    remember_text_position(s)?;
    Ok(true)
}

/// The reader's box changed: refit the page (or the text position) after the layout has settled.
pub(crate) fn on_resize(s: &JsValue) -> Result<(), JsValue> {
    let staged = get(s, "stagedSpeech");
    if truthy(&staged) && !crate::pdf_speech::staged_valid(s, &staged)? { invalidate_staged(s)?; }
    if !truthy(&get(s, "doc")) { return Ok(()); }
    if text_mode(s) {
        if !text_layout_changed(s)? { return Ok(()); }
        let (offset, pdf, page) = (get(s, "textOffset"), get(s, "doc"), get(s, "pageNum"));
        clear_slot(s, "scrollTimer")?;
        set(s, "layoutWidth", &container_width(s)?.into())?;
        set(s, "textHeight", &get(&get(s, "container"), "clientHeight"))?;
        cancel_resize(s)?;
        return schedule(s, "resizeTimer", 80.0, move |s| {
            set(s, "resizeTimer", &JsValue::NULL)?;
            if get(s, "doc") != pdf || get(s, "pageNum") != page || !text_mode(s) { return Ok(()); }
            restore_text_offset(s, &offset)
        });
    }
    if (container_width(s)? - num(&get(s, "layoutWidth"))).abs() < 1.0 { return Ok(()); }
    clear_slot(s, "resizeTimer")?;
    schedule(s, "resizeTimer", 80.0, |s| {
        set(s, "resizeTimer", &JsValue::NULL)?;
        if !truthy(&get(s, "doc")) { return Ok(()); }
        let owner = s.clone();
        let warn = Closure::once_into_js(move |error: JsValue| {
            if truthy(&get(&owner, "doc")) { let _ = method(&get(&global(), "console"), "warn", &[&"No se pudo adaptar la página al nuevo tamaño.".into(), &error]); }
        });
        method(&render(s)?, "catch", &[&warn])?;
        Ok(())
    })
}

/// The scroll position of an adaptable page, remembered once the finger or wheel has rested.
#[wasm_bindgen]
pub fn pdf_scrolled(s: &JsValue) -> Result<(), JsValue> {
    if !truthy(&get(s, "doc")) || !text_mode(s) { return Ok(()); }
    clear_slot(s, "scrollTimer")?;
    schedule(s, "scrollTimer", 150.0, |s| remember_text_position(s))
}

#[wasm_bindgen]
pub fn pdf_resized(s: &JsValue) -> Result<(), JsValue> { on_resize(s) }

// ---- what is on the screen, and whether it is still right ------------------------------------

fn render_preferences(s: &JsValue) -> Result<JsValue, JsValue> {
    let p = prefs(s);
    let list = Array::new();
    for value in [get(&p, "pdfMode"), get(&p, "zoom"), get(s, "zoomed"), get(&p, "theme")] { list.push(&value); }
    if text_mode(s) { for name in ["font", "fontSize", "lineHeight", "fontWeight", "margin", "align"] { list.push(&get(&p, name)); } }
    Ok(JSON::stringify(&list)?.into())
}

pub(crate) fn render_key(s: &JsValue) -> Result<JsValue, JsValue> {
    plain(&[("doc", get(s, "doc")), ("page", get(s, "pageNum")), ("geometry", speech_geometry(s)?.into()), ("preferences", render_preferences(s)?)])
}

pub(crate) fn same_render_key(a: &JsValue, b: &JsValue) -> bool {
    if !truthy(a) || !truthy(b) || get(a, "doc") != get(b, "doc") || get(a, "page") != get(b, "page") || get(a, "preferences") != get(b, "preferences") { return false; }
    let (first, second) = (get(a, "geometry"), get(b, "geometry"));
    (0..num(&get(&first, "length")) as u32).all(|index| get_at(&first, index) == get_at(&second, index))
}

fn render_roots_match(s: &JsValue, state: &JsValue) -> bool {
    if !truthy(state) { return false; }
    let (container, wrap, canvas, layer) = (get(s, "container"), get(state, "pageWrap"), get(state, "canvas"), get(state, "textLayerEl"));
    let reflow = get(state, "reflow");
    canvas == get(s, "canvas") && layer == get(s, "textLayerEl") && wrap == get(s, "pageWrap") && reflow == get(s, "reflow")
        && get(&wrap, "parentNode") == container && get(&reflow, "parentNode") == container
        && get(&canvas, "parentNode") == wrap && get(&layer, "parentNode") == wrap
}

pub(crate) fn remember_rendered_page(s: &JsValue, state: &JsValue) -> Result<(), JsValue> {
    set(state, "complete", &JsValue::TRUE)?;
    if absent(&get(state, "key")) { set(state, "key", &render_key(s)?)?; }
    let (canvas, layer, reflow, original) = (get(state, "canvas"), get(state, "textLayerEl"), get(state, "reflow"), get(state, "originalCanvas"));
    let (canvas_style, layer_style, reflow_style) = (get(&canvas, "style"), get(&layer, "style"), get(&reflow, "style"));
    let painted = plain(&[("width", get(&canvas, "width")), ("height", get(&canvas, "height")), ("cssWidth", get(&canvas_style, "width")), ("cssHeight", get(&canvas_style, "height")),
        ("original", original.clone()), ("originalWidth", get(&original, "width")), ("originalHeight", get(&original, "height")),
        ("text", get(&layer, "textContent")), ("layerStyle", get(&layer_style, "cssText")), ("nodes", Array::from(&get(&layer, "childNodes")).into()),
        ("reflowText", get(&reflow, "textContent")), ("reflowStyle", get(&reflow_style, "cssText"))])?;
    set(state, "painted", &painted)
}

pub(crate) fn render_is_intact(s: &JsValue, state: &JsValue) -> bool {
    let saved = get(state, "painted");
    if !truthy(state) || !truthy(&get(state, "complete")) || !truthy(&saved) || !render_roots_match(s, state) { return false; }
    let (reflow, canvas, layer, original) = (get(state, "reflow"), get(state, "canvas"), get(state, "textLayerEl"), get(state, "originalCanvas"));
    if text_mode(s) {
        return get(&reflow, "textContent") == get(&saved, "reflowText") && get(&get(&reflow, "style"), "cssText") == get(&saved, "reflowStyle");
    }
    let (canvas_style, nodes, kept) = (get(&canvas, "style"), get(&layer, "childNodes"), get(&saved, "nodes"));
    get(state, "layoutWidth") == get_at(&get(&get(state, "key"), "geometry"), 0) && get(&canvas, "width") == get(&saved, "width") && get(&canvas, "height") == get(&saved, "height")
        && get(&canvas_style, "width") == get(&saved, "cssWidth") && get(&canvas_style, "height") == get(&saved, "cssHeight")
        && original == get(&saved, "original") && get(&original, "width") == get(&saved, "originalWidth")
        && get(&original, "height") == get(&saved, "originalHeight") && get(&layer, "textContent") == get(&saved, "text")
        && get(&get(&layer, "style"), "cssText") == get(&saved, "layerStyle") && get(&nodes, "length") == get(&kept, "length")
        && (0..num(&get(&kept, "length")) as u32).all(|index| get_at(&kept, index) == get_at(&nodes, index))
}

pub(crate) fn track_render(s: &JsValue, promise: &JsValue, key: &JsValue) -> Result<JsValue, JsValue> {
    let request = plain(&[("key", key.clone())])?;
    set(s, "renderRequest", &request)?;
    let owner = s.clone();
    let pending = request.clone();
    let done = Closure::once_into_js(move || { if get(&owner, "renderRequest") == pending { let _ = set(&owner, "renderRequest", &JsValue::NULL); } });
    let ready = method(promise, "finally", &[&done])?;
    set(s, "renderReady", &ready)?;
    Ok(ready)
}

/// Draw the current page unless the pixels and text already on the screen are exactly right.
pub(crate) fn render(s: &JsValue) -> Result<JsValue, JsValue> {
    let key = render_key(s)?;
    let state = get(s, "renderState");
    // A restore can arrive while the same page or its theme is still settling.
    // Await that work; only completed, unchanged pixels and text are reusable.
    if same_render_key(&get(&get(s, "renderRequest"), "key"), &key) && render_roots_match(s, &state) { return Ok(get(s, "renderReady")); }
    if same_render_key(&get(&state, "key"), &key) && render_is_intact(s, &state) { return Ok(get(s, "renderReady")); }
    let page = render_page(s, key.clone());
    track_render(s, &page.into(), &key)
}

// ---- drawing a page --------------------------------------------------------------------------

/// Does the work still matter? The caller's own test of whether the page it was drawing is wanted.
#[derive(Clone)]
pub(crate) enum Valid { Render(f64), Staged(JsValue), Retheme(JsValue, JsValue) }

pub(crate) fn live(s: &JsValue, valid: &Valid) -> Result<bool, JsValue> {
    match valid {
        Valid::Render(token) => Ok(*token == num(&get(s, "renderToken")) && truthy(&get(s, "doc"))),
        Valid::Staged(staged) => crate::pdf_speech::staged_valid(s, staged),
        Valid::Retheme(state, wanted) => {
            let current = prefs(s);
            Ok(truthy(&get(s, "doc")) && get(s, "renderState") == *state && get(wanted, "theme") == get(&current, "theme")
                && get(wanted, "pdfMode") == get(&current, "pdfMode") && get(wanted, "zoom") == get(&current, "zoom"))
        }
    }
}

/// The same test as a JavaScript function, for the library calls that poll it while they work.
fn validity(s: &JsValue, valid: &Valid) -> Closure<dyn FnMut() -> bool> {
    let (s, valid) = (s.clone(), valid.clone());
    Closure::new(move || live(&s, &valid).unwrap_or_else(|error| wasm_bindgen::throw_val(error)))
}

fn render_page(s: &JsValue, key: JsValue) -> Promise {
    let s = s.clone();
    eager(async move {
        let token = num(&get(&s, "renderToken")) + 1.0;
        set(&s, "renderToken", &token.into())?;
        method(&get(&s, "container"), "setAttribute", &[&"aria-busy".into(), &"true".into()])?;
        invalidate_staged(&s)?;
        let previous = get(&s, "renderState");
        cancel_render(&previous)?;
        release_original(&previous)?;
        let state = plain(&[("pageWrap", get(&s, "pageWrap")), ("canvas", get(&s, "canvas")), ("textLayerEl", get(&s, "textLayerEl")), ("reflow", get(&s, "reflow")), ("key", key)])?;
        set(&s, "renderState", &state)?;
        let page = settled(method(&get(&s, "doc"), "getPage", &[&get(&s, "pageNum")])?).await?;
        if token != num(&get(&s, "renderToken")) { return Ok(JsValue::FALSE); }
        let drawn = settled(draw_page(&s, &page, &state, Valid::Render(token), JsValue::UNDEFINED).into()).await?;
        if !truthy(&drawn) { return Ok(JsValue::FALSE); }
        use_rendered_page(&s, &state)?;
        Ok(JsValue::TRUE)
    })
}

pub(crate) fn cancel_render(state: &JsValue) -> Result<(), JsValue> {
    for task in ["renderTask", "textTask"] {
        let task = get(state, task);
        if !absent(&task) { method(&task, "cancel", &[])?; }
    }
    Ok(())
}

pub(crate) fn release_original(state: &JsValue) -> Result<(), JsValue> {
    let original = get(state, "originalCanvas");
    if truthy(&original) && original != get(state, "canvas") { set(&original, "height", &0.into())?; set(&original, "width", &0.into())?; }
    if truthy(state) { set(state, "originalCanvas", &JsValue::NULL)?; }
    Ok(())
}

pub(crate) fn use_rendered_page(s: &JsValue, state: &JsValue) -> Result<(), JsValue> {
    set(s, "pageText", &get(state, "pageText"))?;
    let scale = get(state, "baseScale");
    if !absent(&scale) { set(s, "baseScale", &scale)?; }
    let width = get(state, "layoutWidth");
    if !absent(&width) { set(s, "layoutWidth", &width)?; }
    let container = get(s, "container");
    set(&get(&container, "dataset"), "readerZoomed", &crate::host::text_value(&get(state, "zoomed")))?;
    method(&container, "setAttribute", &[&"aria-busy".into(), &"false".into()])?;
    remember_rendered_page(s, state)
}

pub(crate) fn invalidate_staged(s: &JsValue) -> Result<(), JsValue> {
    let staged = get(s, "stagedSpeech");
    if !truthy(&staged) { return Ok(()); }
    set(s, "stagedSpeech", &JsValue::NULL)?;
    set(&staged, "invalid", &JsValue::TRUE)?;
    cancel_render(&staged)?;
    release_original(&staged)?;
    let canvas = get(&staged, "canvas");
    set(&canvas, "height", &0.into())?;
    set(&canvas, "width", &0.into())?;
    method(&get(&staged, "pageWrap"), "replaceChildren", &[])?;
    invoke(s, "clearPDFReflow", &[&get(&staged, "reflow")])?;
    Ok(())
}

fn image_layout(s: &JsValue, page: &JsValue) -> Promise {
    let (s, page) = (s.clone(), page.clone());
    eager(async move {
        let layouts = get(&s, "imageLayouts");
        if !truthy(&method(&layouts, "has", &[&page])?) {
            let layout = if truthy(&get(&page, "getOperatorList")) {
                let owner = s.clone();
                let classify = Closure::once_into_js(move |list: JsValue| -> Result<JsValue, JsValue> {
                    Ok((!truthy(&invoke(&owner, "hasUntrackedPDFImages", &[&list, &get(&dep(&owner, "pdfjs"), "OPS")])?)).into())
                });
                method(&method(&page, "getOperatorList", &[])?, "then", &[&classify])?
            } else { Promise::resolve(&JsValue::FALSE).into() };
            method(&layouts, "set", &[&page, &layout])?;
        }
        method(&layouts, "get", &[&page])
    })
}

/// The same PDF.js rendering and mapping produce visible and staged pages. A staged
/// canvas/TextLayer stays detached until the engine reports its first audible sample.
pub(crate) fn draw_page(s: &JsValue, page: &JsValue, state: &JsValue, valid: Valid, content: JsValue) -> Promise {
    let (s, page, state) = (s.clone(), page.clone(), state.clone());
    eager(async move {
        set(&state, "page", &page)?;
        let text = text_mode(&s);
        set(&get(&state, "pageWrap"), "hidden", &text.into())?;
        set(&get(&state, "reflow"), "hidden", &(!text).into())?;
        let drawn = if text { draw_text(&s, &page, &state, &valid, content).await? } else { draw_canvas(&s, &page, &state, &valid, content).await? };
        Ok(drawn.into())
    })
}

async fn draw_text(s: &JsValue, page: &JsValue, state: &JsValue, valid: &Valid, content: JsValue) -> Result<bool, JsValue> {
    let reflow = get(state, "reflow");
    let content = if absent(&content) { settled(method(page, "getTextContent", &[])?).await? } else { content };
    if !live(s, valid)? { return Ok(false); }
    let viewport = method(page, "getViewport", &[&scale_of(1.0)?])?;
    let layout = invoke(s, "extractPDFText", &[&content, &viewport])?;
    set(state, "textLayout", &layout)?;
    let page_text = get(&layout, "text");
    set(state, "pageText", &page_text)?;
    // An EOL in a stream with unusable geometry is a physical line, not
    // evidence of a paragraph. The offsets remain verbatim for narration.
    set(&get(&reflow, "style"), "whiteSpace", &if truthy(&get(&layout, "geometric")) { "pre-wrap" } else { "normal" }.into())?;
    let operators = settled(match method_opt(page, "getOperatorList", &[])? { Some(list) => list, None => JsValue::UNDEFINED }).await?;
    if !live(s, valid)? { return Ok(false); }
    let ops = get(&dep(s, "pdfjs"), "OPS");
    let image_ops: Vec<f64> = IMAGE_OPS.iter().map(|name| get(&ops, name)).filter(finite).map(|value| num(&value)).collect();
    let marks = Closure::<dyn FnMut(JsValue) -> bool>::new(move |op: JsValue| op.as_f64().is_some_and(|op| image_ops.contains(&op)));
    let list = get(&operators, "fnArray");
    let has_images = !absent(&list) && truthy(&method(&list, "some", &[marks.as_ref()])?);
    let blank = |state: &JsValue| -> Result<bool, JsValue> { Ok(!truthy(&method(&get(state, "pageText"), "trim", &[])?)) };
    if has_images || blank(state)? {
        let source = method(&document(), "createElement", &[&"canvas".into()])?;
        // Bound the temporary page buffer, keeping original composite pixels
        // at mobile DPR without retaining another full page after cropping.
        let width = jmin(1600.0, jmax(1.0, container_width(s)?) * jmin(2.0, pixel_ratio()));
        let (page_width, page_height) = (num(&get(&viewport, "width")), num(&get(&viewport, "height")));
        let scale = jmin(width / page_width, (4_000_000.0 / (page_width * page_height)).sqrt());
        let drawn = method(page, "getViewport", &[&scale_of(scale)?])?;
        set(&source, "width", &jmax(1.0, num(&get(&drawn, "width")).ceil()).into())?;
        set(&source, "height", &jmax(1.0, num(&get(&drawn, "height")).ceil()).into())?;
        let attempt: Result<bool, JsValue> = async {
            let task = method(page, "render", &[&plain(&[("canvasContext", method(&source, "getContext", &[&"2d".into()])?), ("viewport", drawn.clone()), ("recordImages", JsValue::TRUE)])?])?;
            set(state, "renderTask", &task)?;
            settled(get(&get(state, "renderTask"), "promise")).await?;
            if !live(s, valid)? { return Ok(false); }
            let coordinates = get(page, "imageCoordinates");
            let coordinates = if truthy(&coordinates) { coordinates } else { Array::new().into() };
            let mut rects = invoke(s, "pdfImageRects", &[&coordinates, &get(&source, "width"), &get(&source, "height")])?;
            if blank(state)? || truthy(&invoke(s, "hasUntrackedPDFImages", &[&operators, &ops])?) || !truthy(&get(&rects, "length")) {
                rects = Array::of1(&plain(&[("x0", 0.into()), ("y0", 0.into()), ("x1", get(&source, "width")), ("y1", get(&source, "height"))])?).into();
            }
            let isolated = validity(s, valid);
            let prepared = invoke(s, "preparePDFReflow", &[&reflow, &get(state, "textLayout"), &source, &rects, &viewport, isolated.as_ref()])?;
            Ok(truthy(&settled(prepared).await?))
        }.await;
        let outcome = match attempt {
            Err(error) => match live(s, valid) { Ok(true) if get(&error, "name") != "RenderingCancelledException" => Err(error), Ok(_) => Ok(false), Err(other) => Err(other) },
            done => done,
        };
        set(&source, "height", &0.into())?;
        set(&source, "width", &0.into())?;
        if !outcome? { return Ok(false); }
    } else {
        let isolated = validity(s, valid);
        let prepared = invoke(s, "preparePDFReflow", &[&reflow, &get(state, "textLayout"), &JsValue::UNDEFINED, &Array::new().into(), &JsValue::UNDEFINED, isolated.as_ref()])?;
        if !truthy(&settled(prepared).await?) { return Ok(false); }
    }
    set(state, "zoomed", &JsValue::FALSE)?;
    set(state, "layoutWidth", &container_width(s)?.into())?;
    set(s, "textHeight", &get(&get(s, "container"), "clientHeight"))?;
    Ok(true)
}

async fn draw_canvas(s: &JsValue, page: &JsValue, state: &JsValue, valid: &Valid, content: JsValue) -> Result<bool, JsValue> {
    let (canvas, layer, reflow) = (get(state, "canvas"), get(state, "textLayerEl"), get(state, "reflow"));
    let width = container_width(s)?;
    let unscaled = method(page, "getViewport", &[&scale_of(1.0)?])?;
    // Fit the entire original page width. A minimum scale of .6 overflowed
    // ordinary A4 PDFs on narrow phones and made text/selection disagree.
    let base = width / num(&get(&unscaled, "width"));
    set(state, "baseScale", &base.into())?;
    set(state, "layoutWidth", &width.into())?;
    let zoomed = truthy(&get(s, "zoomed"));
    let zoom = num(&get(&prefs(s), "zoom"));
    let scale = base * if zoomed { ZOOM_STEP_SCALE } else { zoom / 100.0 };
    set(state, "zoomed", &(zoomed || zoom > 100.0).into())?;

    let ratio = pixel_ratio();
    let viewport = method(page, "getViewport", &[&scale_of(scale * ratio)?])?;
    let (view_width, view_height) = (num(&get(&viewport, "width")), num(&get(&viewport, "height")));
    set(&canvas, "width", &get(&viewport, "width"))?;
    set(&canvas, "height", &get(&viewport, "height"))?;
    set(&get(&canvas, "style"), "width", &px(view_width / ratio))?;
    set(&get(&canvas, "style"), "height", &px(view_height / ratio))?;

    let filter = at(&dep(s, "PDF_PAGE_FILTERS"), &get(&prefs(s), "theme"));
    let original = if filter == "none" { canvas.clone() } else { method(&document(), "createElement", &[&"canvas".into()])? };
    set(state, "originalCanvas", &original)?;
    set(&original, "width", &get(&canvas, "width"))?;
    set(&original, "height", &get(&canvas, "height"))?;
    set(&get(&original, "style"), "width", &get(&get(&canvas, "style"), "width"))?;
    set(&get(&original, "style"), "height", &get(&get(&canvas, "style"), "height"))?;
    let context = method(&original, "getContext", &[&"2d".into()])?;
    let task = method(page, "render", &[&plain(&[("canvasContext", context), ("viewport", viewport.clone()), ("recordImages", JsValue::TRUE)])?])?;
    set(state, "renderTask", &task)?;
    if let Err(error) = settled(get(&get(state, "renderTask"), "promise")).await {
        if get(&error, "name") == "RenderingCancelledException" { return Ok(false); }
        return Err(error);
    }
    if !live(s, valid)? { return Ok(false); }
    if original != canvas {
        let painted = settled(paint_theme(s, state, &get(&prefs(s), "theme"), valid.clone()).into()).await?;
        if !truthy(&painted) { return Ok(false); }
    }

    // Capa de texto seleccionable, alineada 1:1 con el canvas ya renderizado.
    method(&layer, "replaceChildren", &[])?;
    set(&get(&layer, "style"), "width", &px(view_width / ratio))?;
    set(&get(&layer, "style"), "height", &px(view_height / ratio))?;
    let css_viewport = method(page, "getViewport", &[&scale_of(scale)?])?;
    let text_content = if absent(&content) { settled(method(page, "getTextContent", &[])?).await? } else { content };
    if !live(s, valid)? { return Ok(false); }
    let layout = invoke(s, "extractPDFText", &[&text_content, &unscaled])?;
    set(state, "textLayout", &layout)?;
    set(state, "pageText", &get(&layout, "text"))?;
    let source = if truthy(&get(&layout, "geometric")) {
        let copy = Object::assign(&Object::new(), text_content.unchecked_ref::<Object>());
        set(&copy, "items", &get(&layout, "items"))?;
        copy.into()
    } else { text_content };
    let options = plain(&[("textContentSource", source), ("container", layer.clone()), ("viewport", css_viewport)])?;
    let constructor = dep(s, "TextLayer");
    let text_layer = Reflect::construct(constructor.dyn_ref::<Function>().ok_or_else(|| js_sys::TypeError::new("TextLayer is not a constructor"))?, &Array::of1(&options))?;
    set(state, "textTask", &text_layer)?;
    // TextLayer sizes the container and every span through CSS variables (--total-scale-factor, --font-height, --scale-x,
    // --rotate; see .pdf-text-layer in app.css). Without the scale the spans were as wide as the fallback font made them,
    // not as wide as the glyphs on the canvas: selections and the read-aloud highlight were bars wider than the text.
    method(&get(&layer, "style"), "setProperty", &[&"--total-scale-factor".into(), &number_string(scale).into()])?;
    set(&get(&layer, "style"), "width", &px(view_width / ratio))?;
    set(&get(&layer, "style"), "height", &px(view_height / ratio))?;
    if let Err(error) = settled(method(&text_layer, "render", &[])?).await {
        if !live(s, valid)? { return Ok(false); }
        return Err(error);
    }
    if !live(s, valid)? { return Ok(false); }
    invoke(s, "clearPDFReflow", &[&reflow])?;
    Ok(true)
}

/// Repaint the page in a theme from its original pixels, once the images that must stay
/// untouched are known.
pub(crate) fn paint_theme(s: &JsValue, state: &JsValue, theme: &JsValue, valid: Valid) -> Promise {
    let (s, state, theme) = (s.clone(), state.clone(), theme.clone());
    eager(async move {
        let filter = at(&dep(&s, "PDF_PAGE_FILTERS"), &theme);
        let (canvas, page) = (get(&state, "canvas"), get(&state, "page"));
        if get(&state, "originalCanvas") == canvas && filter == "none" { return Ok(live(&s, &valid)?.into()); }
        let tracked = filter == "none" || truthy(&settled(image_layout(&s, &page).into()).await?);
        if !live(&s, &valid)? { return Ok(JsValue::FALSE); }
        if get(&state, "originalCanvas") == canvas {
            let original = method(&document(), "createElement", &[&"canvas".into()])?;
            set(&original, "width", &get(&canvas, "width"))?;
            set(&original, "height", &get(&canvas, "height"))?;
            method(&method(&original, "getContext", &[&"2d".into()])?, "drawImage", &[&canvas, &0.into(), &0.into()])?;
            set(&state, "originalCanvas", &original)?;
        }
        let coordinates = get(&page, "imageCoordinates");
        let applied = if tracked && !absent(&coordinates) { filter } else { "none".into() };
        invoke(&s, "paintPDFTheme", &[&get(&state, "originalCanvas"), &canvas, &applied, &if truthy(&coordinates) { coordinates } else { Array::new().into() }])?;
        Ok(live(&s, &valid)?.into())
    })
}

/// A theme switch reuses decoded PDF pixels and the selectable text layer.
/// The canvas is repainted synchronously only when everything is ready, so
/// changing the paper colour never clears the visible page for a new render.
fn retheme(s: &JsValue, ready: JsValue, preferences: JsValue) -> Promise {
    let s = s.clone();
    eager(async move {
        settled(ready).await?;
        let state = get(&s, "renderState");
        let valid = Valid::Retheme(state.clone(), preferences.clone());
        if !live(&s, &valid)? || !truthy(&get(&state, "originalCanvas")) { return Ok(JsValue::FALSE); }
        let painted = settled(paint_theme(&s, &state, &get(&preferences, "theme"), valid).into()).await?;
        if truthy(&painted) {
            let key = Object::assign(&Object::new(), get(&state, "key").unchecked_ref::<Object>());
            set(&key, "preferences", &render_preferences(&s)?)?;
            set(&state, "key", &key)?;
            remember_rendered_page(&s, &state)?;
            method(&get(&s, "container"), "setAttribute", &[&"aria-busy".into(), &"false".into()])?;
        }
        Ok(painted)
    })
}

// ---- the reader's public surface ---------------------------------------------------------------

/// Open a document into the container: page, text layer, adaptable page, then the saved place.
/// `hooks` carries the listeners the page owns: `scroll()` and `gestures()` return the function
/// that removes them again, `resize` is the observer's callback.
#[wasm_bindgen]
pub fn pdf_open(s: JsValue, container: JsValue, buffer: JsValue, options: JsValue, hooks: JsValue) -> Promise {
    eager(async move {
        let options = destructure(&options)?;
        set(&s, "container", &container)?;
        let relocate = get(&options, "onRelocate");
        set(&s, "onRelocate", &if absent(&relocate) { noop() } else { relocate })?;
        let loading = method(&dep(&s, "pdfjs"), "getDocument", &[&plain(&[("data", buffer)])?])?;
        set(&s, "loadingTask", &loading)?;
        let pdf = settled(get(&loading, "promise")).await?;
        if loading != get(&s, "loadingTask") { return Ok(JsValue::UNDEFINED); }
        set(&s, "doc", &pdf)?;
        set(&s, "lengthMetadata", &JsValue::NULL)?;
        set(&s, "textOffset", &0.into())?;
        set(&s, "zoomed", &JsValue::FALSE)?;
        let preferences = get(&options, "preferences");
        if truthy(&preferences) { set(&s, "preferences", &invoke(&s, "normalizeReadingPreferences", &[&preferences])?)?; }

        set(&container, "innerHTML", &"".into())?;
        let classes = get(&container, "classList");
        method(&classes, "add", &[&"pdf-reader".into()])?;
        method(&classes, "remove", &[&"foliate-reader".into()])?;
        let create = |tag: &str, class: &str| -> Result<JsValue, JsValue> {
            let element = method(&document(), "createElement", &[&tag.into()])?;
            set(&element, "className", &class.into())?;
            Ok(element)
        };
        let (wrap, canvas, layer) = (create("div", "pdf-page-wrap")?, create("canvas", "pdf-page-canvas")?, create("div", "pdf-text-layer")?);
        set(&s, "pageWrap", &wrap)?;
        set(&s, "canvas", &canvas)?;
        set(&s, "textLayerEl", &layer)?;
        method(&wrap, "append", &[&canvas, &layer])?;
        method(&container, "append", &[&wrap])?;
        let reflow = create("article", "pdf-reflow-page")?;
        set(&s, "reflow", &reflow)?;
        set(&reflow, "hidden", &JsValue::TRUE)?;
        method(&container, "append", &[&reflow])?;
        apply_text_styles(&s)?;
        set(&s, "detachScroll", &method(&hooks, "scroll", &[])?)?;
        set(&s, "detachGestures", &method(&hooks, "gestures", &[])?)?;

        let locator = get(&options, "initialLocator");
        let first = get(&options, "initialPage");
        let target = if !absent(&first) { first } else {
            let saved = if get(&locator, "kind") == "pdf-page" { get(&locator, "value") } else { JsValue::UNDEFINED };
            if !absent(&saved) { saved } else {
                let fraction = get(&options, "initialFraction");
                let fraction = num(&if fraction.is_undefined() { JsValue::from_f64(0.0) } else { fraction });
                let fraction = if nonzero(fraction) { fraction } else { 0.0 };
                (js_round(fraction * (num(&get(&pdf, "numPages")) - 1.0)) + 1.0).into()
            }
        };
        settled(method(&get(&s, "owner"), "goToPage", &[&target, &plain(&[("textOffset", get(&locator, "textOffset"))])?])?).await?;
        if loading != get(&s, "loadingTask") { return Ok(JsValue::UNDEFINED); }
        // The reader lives inside the actual usable viewport. A phone rotation,
        // split view or browser resize must refit both pixels and selection, without
        // treating that layout change as navigation or losing the saved page.
        if !get(&global(), "ResizeObserver").is_undefined() {
            let observer = construct("ResizeObserver", &[&get(&hooks, "resize")])?;
            set(&s, "resizeObserver", &observer)?;
            method(&observer, "observe", &[&container])?;
        }
        Ok(JsValue::UNDEFINED)
    })
}

#[wasm_bindgen]
pub fn pdf_go_to_page(s: JsValue, n: JsValue, options: JsValue) -> Promise {
    eager(async move {
        let options = destructure(&options)?;
        if !truthy(&get(&s, "doc")) { return Ok(JsValue::UNDEFINED); }
        cancel_resize(&s)?;
        invalidate_staged(&s)?;
        let wanted = num(&n);
        let wanted = if nonzero(wanted) { wanted } else { 1.0 };
        let clamped = jmin(jmax(1.0, js_round(wanted)), num(&get(&get(&s, "doc"), "numPages")));
        set(&s, "pageNum", &clamped.into())?;
        let rendered = settled(render(&s)?).await?;
        if !truthy(&rendered) || num(&get(&s, "pageNum")) != clamped { return Ok(JsValue::UNDEFINED); }
        cancel_resize(&s)?;
        clear_slot(&s, "scrollTimer")?;
        let container = get(&s, "container");
        let edge = get(&options, "edge") == "end";
        set(&container, "scrollTop", &if edge && text_mode(&s) { jmax(0.0, num(&get(&container, "scrollHeight")) - num(&get(&container, "clientHeight"))) } else { 0.0 }.into())?;
        let offset = get(&options, "textOffset");
        let offset = num(&if offset.is_undefined() { JsValue::from_f64(0.0) } else { offset });
        let offset = if offset.is_finite() { jmax(0.0, offset.trunc()) } else { 0.0 };
        set(&s, "textOffset", &jmin(num(&get(&get(&s, "pageText"), "length")), offset).into())?;
        if edge { set(&s, "textOffset", &visible_text_offset(&s)?.into())?; } else { restore_text_offset(&s, &get(&s, "textOffset"))?; }
        emit_location(&s)?;
        Ok(JsValue::UNDEFINED)
    })
}

#[wasm_bindgen]
pub fn pdf_next(s: JsValue, options: JsValue) -> Promise {
    eager(async move {
        let options = destructure(&options)?;
        let active = get(&options, "isActive");
        if !truthy(&get(&s, "doc")) || call_opt(&active, "isActive", &[])? == JsValue::FALSE { return Ok(JsValue::UNDEFINED); }
        // The voice has already read the entire physical page. Manual navigation
        // instead traverses every screen of an adaptable page before leaving it.
        if !truthy(&get(&options, "source")) && move_text_viewport(&s, 1.0)? { return Ok(JsValue::UNDEFINED); }
        let (page, count) = (num(&get(&s, "pageNum")), num(&get(&get(&s, "doc"), "numPages")));
        if page < count { settled(method(&get(&s, "owner"), "goToPage", &[&(page + 1.0).into()])?).await?; }
        Ok(JsValue::UNDEFINED)
    })
}

#[wasm_bindgen]
pub fn pdf_prev(s: JsValue) -> Promise {
    eager(async move {
        if !truthy(&get(&s, "doc")) || move_text_viewport(&s, -1.0)? { return Ok(JsValue::UNDEFINED); }
        let page = num(&get(&s, "pageNum"));
        if page > 1.0 { settled(method(&get(&s, "owner"), "goToPage", &[&(page - 1.0).into(), &plain(&[("edge", "end".into())])?])?).await?; }
        Ok(JsValue::UNDEFINED)
    })
}

/// Cached physical-length metadata of the open document, counted outside the visible page.
#[wasm_bindgen]
pub fn pdf_length(s: JsValue) -> Promise {
    eager(async move {
        let pdf = get(&s, "doc");
        if !truthy(&pdf) { return Ok(JsValue::NULL); }
        if get(&get(&s, "lengthMetadata"), "pdf") != pdf {
            let measured = invoke(&s, "measurePDFBookLength", &[&pdf, &invoke(&s, "lengthOptions", &[&s, &pdf])?])?;
            set(&s, "lengthMetadata", &plain(&[("pdf", pdf.clone()), ("promise", measured)])?)?;
        }
        let result = settled(get(&get(&s, "lengthMetadata"), "promise")).await?;
        Ok(if get(&s, "doc") == pdf { result } else { JsValue::NULL })
    })
}

/// Double tap or double click: fit the page to the width, or enlarge it around the tapped point.
#[wasm_bindgen]
pub fn pdf_toggle_zoom(s: JsValue, client_x: JsValue, client_y: JsValue) -> Promise {
    eager(async move {
        if !truthy(&get(&s, "doc")) || text_mode(&s) { return Ok(JsValue::UNDEFINED); }
        invalidate_staged(&s)?;
        let (container, canvas) = (get(&s, "container"), get(&s, "canvas"));
        let (bounds, page) = (method(&container, "getBoundingClientRect", &[])?, method(&canvas, "getBoundingClientRect", &[])?);
        let x = if absent(&client_x) { num(&get(&bounds, "left")) + num(&get(&bounds, "width")) / 2.0 } else { num(&client_x) };
        let y = if absent(&client_y) { num(&get(&bounds, "top")) + num(&get(&bounds, "height")) / 2.0 } else { num(&client_y) };
        let size = |measured: f64, side: &str| -> f64 { if nonzero(measured) { measured } else { crate::host::parse_float(&get(&get(&canvas, "style"), side)) } };
        let (width, height) = (size(num(&get(&page, "width")), "width"), size(num(&get(&page, "height")), "height"));
        let focal_x = clamp((x - num(&get(&page, "left"))) / width, 0.0, 1.0);
        let focal_y = clamp((y - num(&get(&page, "top"))) / height, 0.0, 1.0);
        set(&s, "zoomed", &(!truthy(&get(&s, "zoomed"))).into())?;
        if !truthy(&settled(render(&s)?).await?) || !truthy(&get(&s, "doc")) { return Ok(JsValue::UNDEFINED); }
        // Keep the same printed point under the tap, including an already scrolled
        // page and the PDF's desk margins, instead of jumping toward its corner.
        let updated = method(&canvas, "getBoundingClientRect", &[])?;
        let (updated_width, updated_height) = (size(num(&get(&updated, "width")), "width"), size(num(&get(&updated, "height")), "height"));
        let left = num(&get(&container, "scrollLeft")) + num(&get(&updated, "left")) + focal_x * updated_width - x;
        let top = num(&get(&container, "scrollTop")) + num(&get(&updated, "top")) + focal_y * updated_height - y;
        scroll_to(&container, &[("left", left.into()), ("top", top.into())])?;
        Ok(JsValue::UNDEFINED)
    })
}

fn apply_text_styles(s: &JsValue) -> Result<(), JsValue> {
    let p = prefs(s);
    let style = read(&get(s, "reflow"), "style")?;
    let change = plain(&[("fontFamily", at(&dep(s, "READING_FONTS"), &get(&p, "font"))), ("fontSize", format!("{}px", text_of(&get(&p, "fontSize"))).into()),
        ("lineHeight", crate::host::text_value(&get(&p, "lineHeight"))), ("fontWeight", crate::host::text_value(&get(&p, "fontWeight"))),
        ("padding", format!("12px {}px", text_of(&get(&p, "margin"))).into()), ("textAlign", get(&p, "align"))])?;
    Object::assign(style.unchecked_ref::<Object>(), change.unchecked_ref::<Object>());
    Ok(())
}

#[wasm_bindgen]
pub fn pdf_apply_preferences(s: JsValue, preferences: JsValue) -> Promise {
    eager(async move {
        invalidate_staged(&s)?;
        let previous = prefs(&s);
        settle_text_resize(&s)?;
        cancel_resize(&s)?;
        let was_text = get(&previous, "pdfMode") == "text";
        let offset = if was_text { visible_text_offset(&s)? } else { num(&get(&s, "textOffset")) };
        if truthy(&get(&s, "doc")) && was_text && get(&s, "textOffset") != offset { set(&s, "textOffset", &offset.into())?; emit_location(&s)?; }
        set(&s, "preferences", &invoke(&s, "normalizeReadingPreferences", &[&preferences])?)?;
        let p = prefs(&s);
        apply_text_styles(&s)?;
        if truthy(&get(&s, "doc")) && (get(&previous, "pdfMode") != get(&p, "pdfMode") || get(&previous, "zoom") != get(&p, "zoom")) { settled(render(&s)?).await?; }
        else if truthy(&get(&s, "doc")) && get(&p, "pdfMode") != "text" && get(&previous, "theme") != get(&p, "theme") {
            method(&get(&s, "container"), "setAttribute", &[&"aria-busy".into(), &"true".into()])?;
            let ready = get(&s, "renderReady");
            let key = render_key(&s)?;
            settled(track_render(&s, &retheme(&s, ready, p.clone()).into(), &key)?).await?;
        }
        set(&s, "textOffset", &offset.into())?;
        if truthy(&get(&s, "doc")) && get(&p, "pdfMode") == "text" { clear_slot(&s, "scrollTimer")?; restore_text_offset(&s, &offset.into())?; }
        Ok(JsValue::UNDEFINED)
    })
}

/// Every page with the query in it: at most 500 hits, each with its excerpt cut at word boundaries.
#[wasm_bindgen]
pub fn pdf_search(s: JsValue, query: JsValue) -> Promise {
    eager(async move {
        let wanted = if truthy(&query) { query } else { "".into() };
        let term = method(&method(&crate::host::text_value(&wanted), "trim", &[])?, "toLocaleLowerCase", &[])?;
        let doc = get(&s, "doc");
        if !truthy(&term) || !truthy(&doc) { return Ok(Array::new().into()); }
        let results = Array::new();
        let count = num(&get(&doc, "numPages"));
        let term_length = num(&get(&term, "length"));
        let whitespace = js_sys::RegExp::new("\\s+", "g");
        let mut number = 1.0;
        while number <= count {
            let page = settled(method(&get(&s, "doc"), "getPage", &[&number.into()])?).await?;
            let content = settled(method(&page, "getTextContent", &[])?).await?;
            let layout = invoke(&s, "extractPDFText", &[&content, &method(&page, "getViewport", &[&scale_of(1.0)?])?])?;
            let text = method(&method(&get(&layout, "text"), "replace", &[&whitespace, &" ".into()])?, "trim", &[])?;
            let haystack = method(&text, "toLocaleLowerCase", &[])?;
            let text_length = num(&get(&text, "length"));
            let mut at = num(&method(&haystack, "indexOf", &[&term, &0.into()])?);
            while at >= 0.0 && results.length() < 500 {
                // Context cut at word boundaries, so an excerpt never starts mid-word.
                let stop = at + term_length;
                let (mut start, mut end) = (jmax(0.0, at - 60.0), jmin(text_length, stop + 80.0));
                if start > 0.0 {
                    let space = num(&method(&text, "indexOf", &[&" ".into(), &start.into()])?);
                    start = if space >= 0.0 && space < at { space + 1.0 } else { at };
                }
                if end < text_length {
                    let space = num(&method(&text, "lastIndexOf", &[&" ".into(), &end.into()])?);
                    end = if space > stop { space } else { stop };
                }
                let slice = |from: f64, to: f64| -> Result<String, JsValue> { Ok(text_of(&method(&text, "slice", &[&from.into(), &to.into()])?)) };
                let pre = format!("{}{}", if start > 0.0 { "…" } else { "" }, slice(start, at)?);
                let post = format!("{}{}", slice(stop, end)?, if end < text_length { "…" } else { "" });
                let hit = slice(at, stop)?;
                let parts = plain(&[("pre", pre.clone().into()), ("match", hit.clone().into()), ("post", post.clone().into())])?;
                results.push(&plain(&[("label", format!("Página {}", number_string(number)).into()), ("parts", parts), ("excerpt", format!("{pre}{hit}{post}").into()),
                    ("locator", plain(&[("kind", "pdf-page".into()), ("value", number.into())])?), ("fraction", ((number - 1.0) / jmax(1.0, count - 1.0)).into())])?);
                at = num(&method(&haystack, "indexOf", &[&term, &(at + jmax(1.0, term_length)).into()])?);
            }
            if results.length() >= 500 { break; }
            number += 1.0;
        }
        Ok(results.into())
    })
}

/// Miniatura de la página 1 como Blob, para la portada de la estantería.
#[wasm_bindgen]
pub fn pdf_cover(s: JsValue, options: JsValue) -> Promise {
    eager(async move {
        let options = destructure(&options)?;
        let (doc, loading, signal) = (get(&s, "doc"), get(&s, "loadingTask"), get(&options, "signal"));
        let aborted = |signal: &JsValue| truthy(&get(signal, "aborted"));
        if !truthy(&doc) || aborted(&signal) { return Ok(JsValue::NULL); }
        // A first cover belongs to this captured document, even if its reader UI
        // closes. Other optional HD jobs keep their original cancellation policy.
        let mut retained = JsValue::UNDEFINED;
        if truthy(&get(&options, "retainOnClose")) && truthy(&loading) {
            let covers = get(&s, "retainedCovers");
            retained = method(&covers, "get", &[&loading])?;
            if !truthy(&retained) { retained = plain(&[("count", 0.into()), ("closing", JsValue::FALSE)])?; method(&covers, "set", &[&loading, &retained])?; }
            set(&retained, "count", &(num(&get(&retained, "count")) + 1.0).into())?;
        }
        let current = |s: &JsValue, retained: &JsValue| !aborted(&signal) && (get(s, "doc") == doc || get(retained, "closing") == JsValue::TRUE);
        let task: Rc<RefCell<JsValue>> = Rc::new(RefCell::new(JsValue::UNDEFINED));
        let cancel = {
            let task = task.clone();
            Closure::<dyn FnMut() -> Result<(), JsValue>>::new(move || { let task = task.borrow().clone(); method_opt(&task, "cancel", &[]).map(|_| ()) })
        };
        let attempt: Result<JsValue, JsValue> = async {
            let page = settled(method(&doc, "getPage", &[&1.into()])?).await?;
            if !current(&s, &retained) { return Ok(JsValue::NULL); }
            let viewport = method(&page, "getViewport", &[&scale_of(1.0)?])?;
            // La portada se ve a casi tamaño real durante la apertura. 300 px daba
            // miniaturas blandas en pantallas móviles; renderizamos hasta 1200 px,
            // con un límite de 1600 px por el lado mayor y sin ampliar el PDF más de 3×.
            let (width, height) = (num(&get(&viewport, "width")), num(&get(&viewport, "height")));
            let scale = jmin(jmin(3.0, 1600.0 / jmax(width, height)), 1200.0 / width);
            let thumb = method(&page, "getViewport", &[&scale_of(scale)?])?;
            let canvas = method(&document(), "createElement", &[&"canvas".into()])?;
            set(&canvas, "width", &get(&thumb, "width"))?;
            set(&canvas, "height", &get(&thumb, "height"))?;
            method_opt(&signal, "addEventListener", &[&"abort".into(), cancel.as_ref(), &plain(&[("once", JsValue::TRUE)])?])?;
            if !current(&s, &retained) { return Ok(JsValue::NULL); }
            *task.borrow_mut() = method(&page, "render", &[&plain(&[("canvasContext", method(&canvas, "getContext", &[&"2d".into()])?), ("viewport", thumb)])?])?;
            if !current(&s, &retained) { method_opt(&task.borrow(), "cancel", &[])?; }
            let promise = get(&task.borrow(), "promise");
            settled(promise).await?;
            *task.borrow_mut() = JsValue::NULL;
            if !current(&s, &retained) { return Ok(JsValue::NULL); }
            // The worker keeps this exact raster and JPEG quality, while its GPU
            // readback/encoding leaves the UI thread free for the book animation.
            let blob = settled(invoke(&s, "encodePdfCover", &[&canvas, &plain(&[("signal", signal.clone())])?])?).await?;
            Ok(if current(&s, &retained) { blob } else { JsValue::NULL })
        }.await;
        let outcome = match attempt { Err(error) => if !current(&s, &retained) { Ok(JsValue::NULL) } else { Err(error) }, done => done };
        method_opt(&signal, "removeEventListener", &[&"abort".into(), cancel.as_ref()])?;
        if truthy(&retained) {
            let left = num(&get(&retained, "count")) - 1.0;
            set(&retained, "count", &left.into())?;
            if left == 0.0 {
                method(&get(&s, "retainedCovers"), "delete", &[&loading])?;
                if truthy(&get(&retained, "closing")) {
                    let destroyed = match method(&loading, "destroy", &[]) { Ok(promise) => settled(promise).await, Err(error) => Err(error) };
                    if let Err(error) = destroyed {
                        let _ = method(&get(&global(), "console"), "warn", &[&"No se pudo liberar el PDF de la portada:".into(), &error]);
                    }
                }
            }
        }
        outcome
    })
}

/// The text the person has selected, trimmed; nothing when no selection exists.
#[wasm_bindgen]
pub fn pdf_selection() -> Result<JsValue, JsValue> {
    let selection = method_opt(&window(), "getSelection", &[])?.unwrap_or(JsValue::UNDEFINED);
    let text = method_opt(&selection, "toString", &[])?.unwrap_or(JsValue::UNDEFINED);
    let trimmed = method_opt(&text, "trim", &[])?.unwrap_or(JsValue::UNDEFINED);
    Ok(if truthy(&trimmed) { trimmed } else { "".into() })
}

#[wasm_bindgen]
pub fn pdf_close(s: &JsValue) -> Result<(), JsValue> {
    let observer = get(s, "resizeObserver");
    method_opt(&observer, "disconnect", &[])?;
    set(s, "resizeObserver", &JsValue::NULL)?;
    clear_slot(s, "resizeTimer")?;
    set(s, "resizeTimer", &JsValue::NULL)?;
    clear_slot(s, "scrollTimer")?;
    set(s, "scrollTimer", &JsValue::NULL)?;
    call(&get(s, "detachScroll"), "detachScroll", &[])?;
    set(s, "detachScroll", &noop())?;
    set(s, "textOffset", &0.into())?;
    set(s, "textHeight", &0.into())?;
    set(s, "lengthMetadata", &JsValue::NULL)?;
    set(s, "layoutWidth", &0.into())?;
    set(s, "renderToken", &(num(&get(s, "renderToken")) + 1.0).into())?;
    invalidate_staged(s)?;
    let state = get(s, "renderState");
    cancel_render(&state)?;
    release_original(&state)?;
    if truthy(&get(s, "reflow")) { invoke(s, "clearPDFReflow", &[&get(s, "reflow")])?; }
    set(s, "renderState", &JsValue::NULL)?;
    set(s, "renderRequest", &JsValue::NULL)?;
    call(&get(s, "detachGestures"), "detachGestures", &[])?;
    // PDFDocumentProxy no expone destroy(): la limpieza vive en el
    // loadingTask (ver pdfjs-dist/build/pdf.mjs, PDFDocumentLoadingTask).
    let loading = get(s, "loadingTask");
    let retained = method(&get(s, "retainedCovers"), "get", &[&loading])?;
    if truthy(&retained) { set(&retained, "closing", &JsValue::TRUE)?; } else { method_opt(&loading, "destroy", &[])?; }
    set(s, "loadingTask", &JsValue::NULL)?;
    set(s, "doc", &JsValue::NULL)?;
    set(s, "imageLayouts", &construct("WeakMap", &[])?)?;
    let tones = get(s, "snapshotToneState");
    if !absent(&tones) { method(&get(&tones, "controller"), "abort", &[])?; }
    set(s, "snapshotToneState", &JsValue::UNDEFINED)?;
    set(s, "pageText", &"".into())?;
    let container = get(s, "container");
    if truthy(&container) {
        set(&container, "innerHTML", &"".into())?;
        method(&get(&container, "classList"), "remove", &[&"pdf-reader".into()])?;
        method(&container, "removeAttribute", &[&"aria-busy".into()])?;
        Reflect::delete_property(&get(&container, "dataset").unchecked_into::<Object>(), &"readerZoomed".into())?;
    }
    Ok(())
}

/// The restored reading page, copied only after its latest render settles.
#[wasm_bindgen]
pub fn pdf_snapshot(s: JsValue, options: JsValue) -> Promise { crate::pdf_speech::snapshot(s, options) }
