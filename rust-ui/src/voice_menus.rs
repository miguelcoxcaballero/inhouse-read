//! The rows of the reader's language and voice menus for a book and a device (was
//! readers/voice-menus.js, a JavaScript module the voice flow called back into this one through).
//! The grouping, order and labels are voice_options.rs; this is the argument preparation that
//! module did: the language of a tag, its region and the Spanish names still come from the
//! browser-backed helpers of readers/voice-catalog.js (`catalog`), which exist before this module
//! loads. The frozen original is tests/unit/helpers/reference-voice-menus.js; voice-flow-wasm.test.js
//! compares the menus of 500 scenarios through it.
use js_sys::{Array, Function};
use wasm_bindgen::{prelude::*, JsCast};
use crate::host::read;
use crate::js_string;

type R<T> = Result<T, JsValue>;

fn helper(catalog: &JsValue, name: &str) -> R<Function> {
    read(catalog, name)?.dyn_into().map_err(|_| js_sys::TypeError::new(&format!("{name} is not a function")).into())
}
/// `{bookLang = '', deviceLang = ''}`: only a missing tag becomes the empty one.
fn tag(value: &JsValue) -> JsValue { if value.is_undefined() { "".into() } else { value.clone() } }
/// `normalizeLang(tag).split('-')[1] || ''`.
fn region(normalize: &Function, tag: &JsValue) -> R<String> {
    Ok(js_string(&normalize.call1(&JsValue::UNDEFINED, tag)?).split('-').nth(1).unwrap_or("").to_owned())
}

/// `languageOptions(voices, {bookLang, deviceLang})`.
pub(crate) fn languages(voices: &JsValue, book: &JsValue, device: &JsValue, catalog: &JsValue) -> R<Array> {
    let (book, device) = (tag(book), tag(device));
    let list: Array = if Array::is_array(voices) { voices.clone().unchecked_into() }
        else if voices.is_truthy() { Array::from(voices) } else { Array::new() };
    let base = helper(catalog, "langBase")?;
    let book_base = js_string(&base.call1(&JsValue::UNDEFINED, &book)?);
    let device_base = js_string(&base.call1(&JsValue::UNDEFINED, &device)?);
    let name = helper(catalog, "baseLanguageName")?;
    let book_label = js_string(&name.call1(&JsValue::UNDEFINED, &book)?);
    crate::voice_options::language_options(list, &book_base, &device_base, &book_label, name)
}

/// `voiceOptions(voices, base, {bookLang, deviceLang})`.
pub(crate) fn voices(voices: &JsValue, shown: &JsValue, book: &JsValue, device: &JsValue, catalog: &JsValue) -> R<Array> {
    let (book, device) = (tag(book), tag(device));
    let base = helper(catalog, "langBase")?;
    let language = if shown.is_truthy() { shown.clone() } else { base.call1(&JsValue::UNDEFINED, &book)? };
    let target = if language == base.call1(&JsValue::UNDEFINED, &book)? { book.clone() } else { language };
    let home = base.call1(&JsValue::UNDEFINED, &target)?;
    let list: Array = if voices.is_truthy() { voices.clone().unchecked_into() } else { Array::new() };
    let normalize = helper(catalog, "normalizeLang")?;
    let near = region(&normalize, &target)?;
    let device_region = if base.call1(&JsValue::UNDEFINED, &device)? == home { region(&normalize, &device)? } else { String::new() };
    crate::voice_options::voice_options(list, &js_string(&home), &near, &device_region, helper(catalog, "regionName")?)
}
