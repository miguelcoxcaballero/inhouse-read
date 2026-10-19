//! The words the reader shows about a place and a book: a saved place's label, the size of the
//! file, the panel's document description and the name/type of a shared copy. Template literals
//! of the original are `String.prototype.concat` (ToString, which throws for a Symbol), and the
//! numbers are formatted by the engine (`toFixed`, `Math.round`, `Number#toString`). The frozen
//! JavaScript originals are in tests/unit/helpers/reference-reader-labels.js.
use wasm_bindgen::{prelude::*, JsCast};
use js_sys::{Array, JsString};
use crate::host::{absent, js_round, jmax, num, number_string, read, truthy};
use crate::book_title::{book_display_title, book_normalize_author};

fn concat(parts: &[&JsValue]) -> Result<JsValue, JsValue> {
    let mut text = JsString::from("");
    for part in parts { text = text.concat(part); }
    Ok(text.into())
}
fn literal(value: &str) -> JsValue { JsValue::from_str(value) }

/// `Página 3 de 120`, `Capítulo 2 · Página 4` or `37 % del libro`.
#[wasm_bindgen]
pub fn reader_place_label(place: &JsValue, reader: &JsValue) -> Result<JsValue, JsValue> {
    let locator = read(place, "locator")?;
    if !absent(&locator) && read(&locator, "kind")?.as_string().as_deref() == Some("pdf-page") {
        let value = read(&locator, "value")?;
        let count = read(reader, "pageCount")?;
        return if truthy(&count) { concat(&[&literal("Página "), &value, &literal(" de "), &count]) } else { concat(&[&literal("Página "), &value]) };
    }
    let section = read(place, "section")?;
    if truthy(&section) {
        let page = read(place, "page")?;
        return if truthy(&page) { concat(&[&section, &literal(" · Página "), &page]) } else { concat(&[&section]) };
    }
    let percent = js_round(num(&read(place, "fraction")?) * 100.0);
    concat(&[&number_string(percent).into(), &literal(" % del libro")])
}

/// `2.4 MB` from a mebibyte on, else `37 KB` (never below 1 KB); an absent size is 0.
#[wasm_bindgen]
pub fn reader_format_size(bytes: &JsValue) -> Result<String, JsValue> {
    let bytes = if bytes.is_undefined() { 0.0 } else { num(bytes) };
    if bytes >= 1_048_576.0 {
        let fixed = js_sys::Number::from(bytes / 1_048_576.0).to_fixed(1)?.as_string().unwrap_or_default();
        Ok(format!("{fixed} MB"))
    } else {
        Ok(format!("{} KB", number_string(jmax(1.0, js_round(bytes / 1024.0)))))
    }
}

/// `[title, author, "Title · Author\nEPUB · 2.4 MB"]` for the reading panel's header.
#[wasm_bindgen]
pub fn reader_description(record: &JsValue) -> Result<Array, JsValue> {
    let title = book_display_title(record.clone())?;
    let mut author = book_normalize_author(read(record, "author")?)?;
    if !truthy(&author) {
        let metadata = read(record, "metadata")?;
        author = book_normalize_author(if absent(&metadata) { JsValue::UNDEFINED } else { read(&metadata, "creator")? })?;
    }
    let format = read(record, "format")?;
    let format = if truthy(&format) { format } else { literal("Documento") };
    let size: JsValue = reader_format_size(&read(record, "sizeBytes")?)?.into();
    let byline = if truthy(&author) { concat(&[&literal(" · "), &author])? } else { literal("") };
    let text = concat(&[&title, &byline, &literal("\n"), &format, &literal(" · "), &size])?;
    Ok(Array::of3(&title, &author, &text))
}

/// The file name and media type of the shared original: its own name, else `title.format`.
#[wasm_bindgen]
pub fn reader_share_file(book: &JsValue, content: &JsValue) -> Result<Array, JsValue> {
    let mut name = read(book, "fileName")?;
    if !truthy(&name) {
        let title = read(book, "title")?;
        let format = read(book, "format")?;
        let format = if truthy(&format) { format } else { literal("pdf") };
        let extension = crate::host::text_value(&format).unchecked_into::<JsString>().to_lower_case();
        name = concat(&[&title, &literal("."), &extension.into()])?;
    }
    let mut kind = read(book, "mimeType")?;
    if !truthy(&kind) { kind = read(content, "type")?; }
    if !truthy(&kind) { kind = literal("application/octet-stream"); }
    Ok(Array::of2(&name, &kind))
}
