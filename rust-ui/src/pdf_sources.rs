//! The spoken sources of a PDF page (pdf-reader.js `makeSource`, `stage`, `detach`) and the liveness check of a
//! length count: plain objects whose handlers the audiobook calls, over the state `q` they share. Each handler is one
//! closure per realm with no captured state, bound to its reader, its state and (for `follow`) its own source with
//! `Function.prototype.bind`; the source owns them and the garbage collector frees them with it, as it freed the
//! arrow functions of the JavaScript class.
use js_sys::{Array, Function, Object};
use wasm_bindgen::prelude::*;
use crate::host::{absent, method, read, set};
use crate::pdf_speech::{pdf_source_activate, pdf_source_clear, pdf_source_valid, pdf_speech_begin, pdf_speech_clear, pdf_speech_current, pdf_speech_follow,
    pdf_speech_highlight, pdf_speech_offset};

type R<T = JsValue> = Result<T, JsValue>;

fn function<F: ?Sized + wasm_bindgen::closure::WasmClosure>(closure: Closure<F>) -> Function { closure.into_js_value().unchecked_into() }
thread_local! {
    static CLEAR: Function = function(Closure::<dyn FnMut(JsValue) -> R<()>>::new(|q: JsValue| pdf_speech_clear(&q)));
    static OFFSET: Function = function(Closure::<dyn FnMut(JsValue, JsValue, JsValue, JsValue, JsValue) -> R<f64>>::new(
        |s: JsValue, q: JsValue, tapped: JsValue, x: JsValue, y: JsValue| pdf_speech_offset(&s, &q, &tapped, &x, &y)));
    static HIGHLIGHT: Function = function(Closure::<dyn FnMut(JsValue, JsValue, JsValue, JsValue) -> R<()>>::new(
        |s: JsValue, q: JsValue, start: JsValue, end: JsValue| pdf_speech_highlight(&s, &q, &start, &end)));
    static FOLLOW: Function = function(Closure::<dyn FnMut(JsValue, JsValue, JsValue, JsValue, JsValue) -> R<()>>::new(
        |s: JsValue, q: JsValue, source: JsValue, start: JsValue, end: JsValue| pdf_speech_follow(&s, &q, &source, &start, &end)));
    static CURRENT: Function = function(Closure::<dyn FnMut(JsValue, JsValue) -> R>::new(|s: JsValue, q: JsValue| pdf_speech_current(&s, &q)));
    static VALID: Function = function(Closure::<dyn FnMut(JsValue, JsValue) -> R>::new(|s: JsValue, q: JsValue| pdf_source_valid(&s, &q)));
    static ACTIVATE: Function = function(Closure::<dyn FnMut(JsValue, JsValue) -> R>::new(|s: JsValue, q: JsValue| pdf_source_activate(&s, &q)));
    static STAGED_CLEAR: Function = function(Closure::<dyn FnMut(JsValue, JsValue) -> R<()>>::new(|s: JsValue, q: JsValue| pdf_source_clear(&s, &q)));
    /// `() => s.doc === pdf && isActive()`.
    static DETACHED_VALID: Function = function(Closure::<dyn FnMut(JsValue, JsValue, JsValue) -> R>::new(|s: JsValue, pdf: JsValue, is_active: JsValue| {
        if read(&s, "doc")? != pdf { return Ok(JsValue::FALSE); }
        crate::host::call(&is_active, "isActive", &[])
    }));
    /// `() => source.isValid()`.
    static DETACHED_ACTIVATE: Function = function(Closure::<dyn FnMut(JsValue) -> R>::new(|source: JsValue| method(&source, "isValid", &[])));
    /// `() => s.doc === pdf`: the document whose length is being counted is still the open one.
    static SAME_DOCUMENT: Function = function(Closure::<dyn FnMut(JsValue, JsValue) -> R<bool>>::new(|s: JsValue, pdf: JsValue| Ok(read(&s, "doc")? == pdf)));
}
fn bind1(function: &'static std::thread::LocalKey<Function>, a: &JsValue) -> JsValue { function.with(|function| function.bind1(&JsValue::NULL, a).into()) }
fn bind2(function: &'static std::thread::LocalKey<Function>, a: &JsValue, b: &JsValue) -> JsValue { function.with(|function| function.bind2(&JsValue::NULL, a, b).into()) }
fn bind3(function: &'static std::thread::LocalKey<Function>, a: &JsValue, b: &JsValue, c: &JsValue) -> JsValue { function.with(|function| function.bind3(&JsValue::NULL, a, b, c).into()) }

/// A spoken source of page `page` and what tells whether it is still the visible one: `{ source, current }`.
pub fn make_source(s: &JsValue, page: &JsValue, first: &JsValue, layout: &JsValue) -> R {
    let q = pdf_speech_begin(s, page, first)?;
    let source: JsValue = Object::new().into();
    set(&source, "text", &read(first, "text")?)?;
    set(&source, "start", &JsValue::from_f64(0.0))?;
    set(&source, "clear", &bind1(&CLEAR, &q))?;
    set(&source, "physicalPage", page)?;
    set(&source, "offsetAtPoint", &bind2(&OFFSET, s, &q))?;
    // Geometric paragraphs are real body text, including repeated dialogue. No marginal header is confirmed by
    // page-local layout alone: preserve those paragraphs even when the legacy header-skipping option is on.
    let geometric = if absent(layout) { JsValue::UNDEFINED } else { read(layout, "geometric")? };
    if geometric.is_truthy() || read(&read(s, "preferences")?, "pdfMode")? == JsValue::from_str("text") {
        set(&source, "headerRanges", &Object::freeze(&Array::new()))?;
    }
    set(&source, "highlight", &bind2(&HIGHLIGHT, s, &q))?;
    set(&source, "follow", &bind3(&FOLLOW, s, &q, &source))?;
    let made = Object::new();
    set(&made, "source", &source)?;
    set(&made, "current", &bind2(&CURRENT, s, &q))?;
    Ok(made.into())
}
/// The page prepared off screen becomes the visible one only when its voice starts.
pub fn stage(s: &JsValue, source: &JsValue, q: &JsValue) -> R<()> {
    set(source, "isValid", &bind2(&VALID, s, q))?;
    set(source, "activate", &bind2(&ACTIVATE, s, q))?;
    set(source, "clear", &bind2(&STAGED_CLEAR, s, q))
}
/// The text of a page that is not drawn: valid while its document is open and its request is the current one.
pub fn detach(s: &JsValue, source: &JsValue, pdf: &JsValue, is_active: &JsValue) -> R<()> {
    set(source, "isValid", &bind3(&DETACHED_VALID, s, pdf, is_active))?;
    set(source, "activate", &bind1(&DETACHED_ACTIVATE, source))
}
/// `{ isActive: () => s.doc === pdf }`.
pub fn length_options(s: &JsValue, pdf: &JsValue) -> R {
    let options = Object::new();
    set(&options, "isActive", &bind2(&SAME_DOCUMENT, s, pdf))?;
    Ok(options.into())
}
