//! The one place a book is opened: the format decides the engine (PDF.js or foliate-js) and every
//! question the rest of the app asks of the open book is answered through the same few methods,
//! whichever engine is underneath. The controller's state is the plain object `s` its JavaScript
//! class holds (engine, reader, format, location, the epoch that outdates anything derived from an
//! earlier engine); `s.kit` carries the format detector and the two engines to load.
use wasm_bindgen::{prelude::*, JsCast};
use js_sys::{Array, Function, Object, Promise, Reflect};
use crate::eager::{eager, settled};
use crate::host::{absent, call, get, global, jmax, jmin, js_round, method, method_opt, num, set, truthy};
use crate::pdf_reader::{destructure, plain};

const PDF: &str = "pdf";
const FOLIATE: &str = "foliate";

fn reader_of(s: &JsValue) -> JsValue { get(s, "reader") }
fn engine_is(s: &JsValue, engine: &str) -> bool { get(s, "engine") == engine }
fn integer(value: &JsValue) -> bool { value.as_f64().is_some_and(|number| number.is_finite() && number.fract() == 0.0) }
/// `reader?.name?.(...args)`: undefined when there is no reader or the engine has no such method.
fn ask(s: &JsValue, name: &str, args: &[&JsValue]) -> Result<JsValue, JsValue> { Ok(method_opt(&reader_of(s), name, args)?.unwrap_or(JsValue::UNDEFINED)) }
fn or_value(value: JsValue, otherwise: JsValue) -> JsValue { if truthy(&value) { value } else { otherwise } }
fn clean_location() -> Result<JsValue, JsValue> { plain(&[("fraction", 0.into()), ("locator", JsValue::NULL)]) }

/// The record of where the engine says it is, kept as the controller's location and speech position.
#[wasm_bindgen]
pub fn controller_relocated(s: &JsValue, data: &JsValue, on_relocate: &JsValue) -> Result<(), JsValue> {
    let pdf = engine_is(s, PDF);
    let index = get(data, "index");
    set(s, "speechPosition", &if integer(&index) && num(&index) >= 0.0 { plain(&[("kind", if pdf { "page" } else { "chapter" }.into()), ("index", index.clone())])? } else { JsValue::NULL })?;
    let wanted = num(&get(data, "fraction"));
    let fraction = if wanted != 0.0 && !wanted.is_nan() { wanted } else { 0.0 };
    let cfi = get(data, "cfi");
    let locator = if truthy(&cfi) { plain(&[("kind", "cfi".into()), ("value", cfi)])? } else if pdf {
        // `(data.index || 0) + 1`, with the engine's own `+`: a string index concatenates.
        let place = plain(&[("kind", "pdf-page".into()), ("value", &or_value(index, 0.into()) + &JsValue::from_f64(1.0))])?;
        let offset = get(data, "textOffset");
        if integer(&offset) && num(&offset) > 0.0 { set(&place, "textOffset", &offset)?; }
        place
    } else { JsValue::NULL };
    set(s, "location", &plain(&[("fraction", jmin(1.0, jmax(0.0, fraction)).into()), ("locator", locator), ("section", or_value(get(data, "section"), "".into())), ("page", or_value(get(data, "page"), "".into()))])?)?;
    if !absent(on_relocate) { call(on_relocate, "onRelocate", &[data])?; }
    Ok(())
}

/// Detect the format, load the engine for it and open the book in the container. `relocate` is
/// the engine's callback; it forwards to `controller_relocated`.
#[wasm_bindgen]
pub fn controller_open(s: JsValue, container: JsValue, file: JsValue, options: JsValue, relocate: JsValue) -> Promise {
    eager(async move {
        let options = destructure(&options)?;
        controller_close(&s)?;
        let kit = get(&s, "kit");
        let format = settled(call(&get(&kit, "detectFormat"), "detectFormat", &[&file])?).await?;
        set(&s, "format", &format)?;
        if !truthy(&call(&get(&kit, "isSupported"), "isSupported", &[&format])?) {
            let name = get(&file, "name");
            let message = format!("Formato no soportado: {}", crate::host::text_of(&if absent(&name) { "archivo desconocido".into() } else { name }));
            return Err(Reflect::construct(get(&kit, "UnsupportedFormatError").unchecked_ref::<Function>(), &Array::of1(&message.into()))?);
        }
        set(&s, "engine", &get(&format, "engine"))?;
        let pick = |names: &[&str]| -> Result<JsValue, JsValue> {
            let entries: Vec<(&str, JsValue)> = names.iter().map(|name| (*name, get(&options, name))).collect();
            let mut all = vec![("onRelocate", relocate.clone())];
            all.extend(entries);
            plain(&all)
        };
        if get(&format, "engine") == PDF {
            let module = settled(call(&get(&kit, "loadPdf"), "loadPdf", &[])?).await?;
            let reader = Reflect::construct(get(&module, "PdfReader").unchecked_ref::<Function>(), &Array::new())?;
            set(&s, "reader", &reader)?;
            let buffer = settled(method(&file, "arrayBuffer", &[])?).await?;
            let settings = pick(&["onToggleChrome", "onUserNavigation", "initialPage", "initialLocator", "initialFraction", "preferences"])?;
            // The reader is read again here, after the wait: a book opened meanwhile has replaced it.
            settled(method(&reader_of(&s), "open", &[&container, &buffer, &settings])?).await?;
        } else {
            let module = settled(call(&get(&kit, "loadFoliate"), "loadFoliate", &[])?).await?;
            let reader = Reflect::construct(get(&module, "FoliateReader").unchecked_ref::<Function>(), &Array::new())?;
            set(&s, "reader", &reader)?;
            let settings = pick(&["onToggleChrome", "onUserNavigation", "onFollowLink"])?;
            settled(method(&reader, "open", &[&container, &file, &settings])?).await?;
        }
        // Read again, not the local: a book opened meanwhile has replaced the format.
        let current = get(&s, "format");
        set(&s, "engine", &get(&current, "engine"))?;
        Ok(current)
    })
}

#[wasm_bindgen]
pub fn controller_close(s: &JsValue) -> Result<(), JsValue> {
    set(s, "epoch", &(num(&get(s, "epoch")) + 1.0).into())?;
    let reader = reader_of(s);
    if !absent(&reader) { method(&reader, "close", &[])?; }
    set(s, "reader", &JsValue::NULL)?;
    set(s, "speechPosition", &JsValue::NULL)?;
    set(s, "location", &clean_location()?)
}

/// Metadatos del libro cuando el motor los expone (foliate); {} en PDF.
#[wasm_bindgen]
pub fn controller_metadata(s: &JsValue) -> JsValue { let metadata = get(&reader_of(s), "metadata"); if absent(&metadata) { Object::new().into() } else { metadata } }

/// Numeric native media progress; no text, CFI, credentials or persisted cursor changes.
#[wasm_bindgen]
pub fn controller_speech_position(s: &JsValue) -> JsValue {
    let position = get(s, "speechPosition");
    if truthy(&position) { Object::assign(&Object::new(), position.unchecked_ref::<Object>()).into() } else { JsValue::NULL }
}

/// Diagnostic state for the native callback receipt; position remains read-only.
#[wasm_bindgen]
pub fn controller_diagnostic(s: &JsValue) -> Result<JsValue, JsValue> {
    let reader = reader_of(s);
    let turns = get(&reader, "speechDiagnosticState");
    let count = |name: &str| { let value = get(&turns, name); if absent(&value) { 0.into() } else { value } };
    let index = get(&get(s, "speechPosition"), "index");
    let state = plain(&[("kind", if truthy(&reader) { get(s, "engine") } else { "none".into() }), ("index", if absent(&index) { JsValue::NULL } else { index }),
        ("followPending", count("followPending")), ("pageTurnPending", count("pageTurnPending"))])?;
    let paginator = get(&turns, "paginator");
    if truthy(&paginator) { set(&state, "paginator", &paginator)?; }
    Ok(state)
}

#[wasm_bindgen]
pub fn controller_language(s: &JsValue) -> JsValue {
    let language = get(&controller_metadata(s), "language");
    let first = if Array::is_array(&language) { crate::host::get_at(&language, 0) } else { language };
    or_value(first, get(&get(&global(), "navigator"), "language"))
}

#[wasm_bindgen]
pub fn controller_toc(s: &JsValue) -> JsValue { let toc = get(&reader_of(s), "toc"); if absent(&toc) { Array::new().into() } else { toc } }

#[wasm_bindgen]
pub fn controller_page_count(s: &JsValue) -> JsValue {
    if !engine_is(s, PDF) { return JsValue::NULL; }
    let count = get(&reader_of(s), "pageCount");
    if absent(&count) { JsValue::NULL } else { count }
}

#[wasm_bindgen]
pub fn controller_next_source(s: &JsValue) -> Result<JsValue, JsValue> {
    let reader = reader_of(s);
    let found = get(&reader, "getNextSpeechSource");
    if absent(&found) { return Ok(JsValue::UNDEFINED); }
    method(&found, "bind", &[&reader])
}

/// `await reader?.name?.(...args)` as a promise of the answer (`otherwise` when it is falsy, if given).
fn ask_async(s: &JsValue, name: &'static str, args: Vec<JsValue>, otherwise: Option<JsValue>) -> Promise {
    let s = s.clone();
    eager(async move {
        let refs: Vec<&JsValue> = args.iter().collect();
        let answer = settled(ask(&s, name, &refs)?).await?;
        Ok(match otherwise { Some(fallback) => or_value(answer, fallback), None => answer })
    })
}

#[wasm_bindgen]
pub fn controller_go_to_target(s: &JsValue, target: JsValue) -> Promise { wait_for(s, "goToTarget", target) }
#[wasm_bindgen]
pub fn controller_apply_preferences(s: &JsValue, preferences: JsValue) -> Promise { wait_for(s, "applyPreferences", preferences) }
#[wasm_bindgen]
pub fn controller_speech_text(s: &JsValue) -> Promise { ask_async(s, "getSpeechText", vec![], Some("".into())) }
#[wasm_bindgen]
pub fn controller_speech_source(s: &JsValue, options: JsValue) -> Promise { ask_async(s, "getSpeechSource", vec![options], Some(JsValue::NULL)) }
#[wasm_bindgen]
pub fn controller_search(s: &JsValue, query: JsValue) -> Promise { ask_async(s, "search", vec![query], Some(Array::new().into())) }
#[wasm_bindgen]
pub fn controller_next(s: &JsValue, options: JsValue) -> Promise {
    let s = s.clone();
    eager(async move { let reader = reader_of(&s); settled(if absent(&reader) { JsValue::UNDEFINED } else { method(&reader, "next", &[&options])? }).await?; Ok(JsValue::UNDEFINED) })
}
#[wasm_bindgen]
pub fn controller_prev(s: &JsValue) -> Promise {
    let s = s.clone();
    eager(async move { let reader = reader_of(&s); settled(if absent(&reader) { JsValue::UNDEFINED } else { method(&reader, "prev", &[])? }).await?; Ok(JsValue::UNDEFINED) })
}
/// An `async` method whose body only waits for the engine: the promise settles with nothing.
fn wait_for(s: &JsValue, name: &'static str, argument: JsValue) -> Promise {
    let s = s.clone();
    eager(async move { settled(ask(&s, name, &[&argument])?).await?; Ok(JsValue::UNDEFINED) })
}

#[wasm_bindgen]
pub fn controller_browse_speech(s: &JsValue) -> Result<(), JsValue> { ask(s, "browseSpeech", &[])?; Ok(()) }
#[wasm_bindgen]
pub fn controller_return_to_speech(s: &JsValue) -> Result<JsValue, JsValue> { ask(s, "returnToSpeech", &[]) }
#[wasm_bindgen]
pub fn controller_stop_speech(s: &JsValue) -> Result<(), JsValue> { ask(s, "stopSpeech", &[])?; Ok(()) }
#[wasm_bindgen]
pub fn controller_clear_search(s: &JsValue) -> Result<(), JsValue> { ask(s, "clearSearch", &[])?; Ok(()) }
#[wasm_bindgen]
pub fn controller_selection(s: &JsValue) -> Result<JsValue, JsValue> { Ok(or_value(ask(s, "getSelection", &[])?, JsValue::NULL)) }
#[wasm_bindgen]
pub fn controller_quote(s: &JsValue, add: bool, quote: &JsValue) -> Result<(), JsValue> { ask(s, if add { "addQuoteAnnotation" } else { "removeQuoteAnnotation" }, &[quote])?; Ok(()) }

/// The snapshot of the page on screen, with the controller's own location folded in.
#[wasm_bindgen]
pub fn controller_page_snapshot(s: JsValue, options: JsValue) -> Promise {
    eager(async move {
        let reader = reader_of(&s);
        let snapshot = settled(ask(&s, "getPageSnapshot", &[&options])?).await?;
        // A selection can replace this shared reader while an ebook layout awaits
        // its fonts. Never give the newly selected book a previous book's bitmap.
        if !truthy(&snapshot) || reader != reader_of(&s) { return Ok(JsValue::NULL); }
        let location = Object::assign(&Object::new(), get(&s, "location").unchecked_ref::<Object>());
        let own = get(&snapshot, "location");
        if truthy(&own) { Object::assign(&location, own.unchecked_ref::<Object>()); }
        let result = Object::assign(&Object::new(), snapshot.unchecked_ref::<Object>());
        set(&result, "location", &location)?;
        Ok(result.into())
    })
}

/// The cover as a Blob: the thumbnail of page 1 in PDF, the embedded one in EPUB/MOBI.
#[wasm_bindgen]
pub fn controller_cover(s: JsValue, options: JsValue) -> Promise {
    eager(async move {
        let options = if options.is_undefined() { Object::new().into() } else { options };
        let (reader, epoch) = (reader_of(&s), get(&s, "epoch"));
        let signal = get(&options, "signal");
        if truthy(&get(&signal, "aborted")) { return Ok(JsValue::NULL); }
        let blob = settled(ask(&s, "getCoverBlob", &[&options])?).await?;
        let signal = get(&options, "signal");
        let wanted = !truthy(&get(&signal, "aborted")) && (get(&options, "retainOnClose") == JsValue::TRUE || reader == reader_of(&s) && epoch == get(&s, "epoch"));
        Ok(if wanted && !absent(&blob) { blob } else { JsValue::NULL })
    })
}

/// A stale background count cannot be attributed to a subsequently opened book.
#[wasm_bindgen]
pub fn controller_length(s: JsValue) -> Promise {
    eager(async move {
        let (reader, epoch) = (reader_of(&s), get(&s, "epoch"));
        if !truthy(&reader) { return Ok(JsValue::NULL); }
        let result = settled(ask(&s, "getLengthMetadata", &[])?).await?;
        Ok(if reader == reader_of(&s) && epoch == get(&s, "epoch") { or_value(result, JsValue::NULL) } else { JsValue::NULL })
    })
}

#[wasm_bindgen]
pub fn controller_go_to_fraction(s: JsValue, fraction: JsValue) -> Promise {
    eager(async move {
        let reader = reader_of(&s);
        if engine_is(&s, FOLIATE) {
            settled(if truthy(&reader) { method(&reader, "goToFraction", &[&fraction])? } else { JsValue::UNDEFINED }).await?;
        } else if engine_is(&s, PDF) {
            let count = get(&reader, "pageCount");
            let count = if absent(&count) { 1.0 } else { num(&count) };
            settled(if truthy(&reader) { method(&reader, "goToPage", &[&(js_round(num(&fraction) * (count - 1.0)) + 1.0).into()])? } else { JsValue::UNDEFINED }).await?;
        }
        Ok(JsValue::UNDEFINED)
    })
}

#[wasm_bindgen]
pub fn controller_go_to_locator(s: JsValue, locator: JsValue, fallback: JsValue) -> Promise {
    eager(async move {
        let kind = get(&locator, "kind");
        let reader = reader_of(&s);
        if kind == "cfi" && engine_is(&s, FOLIATE) {
            let attempt = async {
                settled(if truthy(&reader) { method(&reader, "goToCfi", &[&get(&locator, "value")])? } else { JsValue::UNDEFINED }).await
            };
            if attempt.await.is_ok() { return Ok(JsValue::UNDEFINED); } // an error is a changed edition: fall back to the fraction
        }
        if kind == "pdf-page" && engine_is(&s, PDF) {
            let offset = get(&locator, "textOffset");
            let pending = if !truthy(&reader) { JsValue::UNDEFINED } else if integer(&offset) && num(&offset) > 0.0 {
                method(&reader, "goToPage", &[&get(&locator, "value"), &plain(&[("textOffset", offset)])?])?
            } else { method(&reader, "goToPage", &[&get(&locator, "value")])? };
            settled(pending).await?;
            return Ok(JsValue::UNDEFINED);
        }
        let fallback = if fallback.is_undefined() { JsValue::from_f64(0.0) } else { fallback };
        settled(method(&get(&s, "owner"), "goToFraction", &[&fallback])?).await?;
        Ok(JsValue::UNDEFINED)
    })
}
