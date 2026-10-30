//! Book format detection by byte signature (magic numbers), with the file name's extension as the
//! fallback when the signature is not enough (an EPUB and a CBZ are both ZIP archives). The reader
//! only needs two routes: 'pdf' (PDF.js) or 'foliate' (foliate-js, which tells EPUB, MOBI, AZW3,
//! FB2 and CBZ apart itself); a readable `label` is exposed for the interface. Reading the file's
//! head stays with the host (format-detect.js); the frozen original is
//! tests/unit/helpers/reference-format-detect.js.
use js_sys::{JsString, Object, Reflect, Uint8Array};
use wasm_bindgen::{prelude::*, JsCast};
use crate::core_bridge::required;
use crate::host::{absent, call, construct, get, method, truthy};

const PDF: &str = "pdf";
const FOLIATE: &str = "foliate";
const UNKNOWN: &str = "unknown";

fn record(fields: &[(&str, JsValue)]) -> Result<JsValue, JsValue> {
    let target = Object::new();
    for (name, value) in fields { Reflect::set(&target, &JsValue::from_str(name), value)?; }
    Ok(target.into())
}
fn text(value: &str) -> JsValue { JsValue::from_str(value) }

/// The extension labels, as a plain object (a lookup sees its prototype too, as the original's did).
fn labels() -> Result<JsValue, JsValue> {
    record(&[("pdf", text("PDF")), ("epub", text("EPUB")), ("mobi", text("MOBI")), ("azw", text("AZW")), ("azw3", text("AZW3")),
        ("kf8", text("AZW3")), ("fb2", text("FB2")), ("cbz", text("CBZ"))])
}

/// `/\.([a-z0-9]+)$/i.exec(name.trim())`, lower-cased; '' without one.
fn extension(name: &JsValue) -> Result<String, JsValue> {
    let trimmed = method(name, "trim", &[])?;
    let Some(trimmed) = trimmed.dyn_ref::<JsString>() else { return Ok(String::new()) };
    let length = trimmed.length();
    let mut start = length;
    while start > 0 {
        let unit = trimmed.char_code_at(start - 1) as u32;
        if (b'0' as u32..=b'9' as u32).contains(&unit) || (b'a' as u32..=b'z' as u32).contains(&unit) || (b'A' as u32..=b'Z' as u32).contains(&unit) { start -= 1; } else { break; }
    }
    if start == length || start == 0 || trimmed.char_code_at(start - 1) != f64::from(b'.') { return Ok(String::new()); }
    Ok((start..length).map(|at| char::from(trimmed.char_code_at(at) as u8).to_ascii_lowercase()).collect())
}

/// The first bytes of a buffer or byte view decide the most probable format; ~200 bytes are
/// enough for PDF, ZIP (EPUB/CBZ) and PalmDOC/MOBI. `scan` is the numeric core's scanner of the
/// remaining headers (book-format-wasm.js); a scanner with no answer is an error.
#[wasm_bindgen]
pub fn format_sniff(bytes: &JsValue, scan: &JsValue, core: &JsValue) -> Result<JsValue, JsValue> {
    let view: Uint8Array = if bytes.is_instance_of::<Uint8Array>() { bytes.clone().unchecked_into() } else { construct("Uint8Array", &[bytes])?.unchecked_into() };
    let head = view.subarray(0, 5).to_vec();
    if head == b"%PDF-" {
        return record(&[("engine", text(PDF)), ("label", text("PDF")), ("confidence", text("high"))]);
    }
    // ZIP local file header: PK\x03\x04 — EPUB, CBZ and FBZ are ZIP archives.
    if head.len() >= 4 && head[..4] == [0x50, 0x4b, 0x03, 0x04] {
        return record(&[("engine", text(FOLIATE)), ("label", text("EPUB")), ("confidence", text("medium"))]);
    }
    // The numeric core scans every remaining header (PalmDOC and raw FB2).
    let code = call(scan, "rustBookFormat", &[view.as_ref()])?;
    if code.is_undefined() { return Err(required(core, "No se pudo reconocer el formato del libro.")); }
    if code == JsValue::from_f64(3.0) { return record(&[("engine", text(FOLIATE)), ("label", text("MOBI")), ("confidence", text("high"))]); }
    if code == JsValue::from_f64(4.0) { return record(&[("engine", text(FOLIATE)), ("label", text("FB2")), ("confidence", text("medium"))]); }
    record(&[("engine", text(UNKNOWN)), ("label", JsValue::NULL), ("confidence", text("none"))])
}

/// The format of a file from its name and its head (read by the host): the signature decides the
/// engine, a known extension refines the label (cbz, mobi, azw3, fb2 are all foliate) or, without a
/// recognisable signature, decides on its own.
#[wasm_bindgen]
pub fn format_detect(file: &JsValue, head: &JsValue, scan: &JsValue, core: &JsValue) -> Result<JsValue, JsValue> {
    let name = if absent(file) { JsValue::UNDEFINED } else { crate::host::read(file, "name")? };
    let name = if truthy(&name) { name } else { text("") };
    let ext = extension(&name)?;
    let sniffed = format_sniff(head, scan, core)?;
    let engine = get(&sniffed, "engine");
    if engine == text(PDF) { return record(&[("engine", text(PDF)), ("label", text("PDF")), ("source", text("bytes"))]); }
    let table = labels()?;
    let known = Reflect::get(&table, &text(&ext))?;
    if engine == text(FOLIATE) {
        let label = if absent(&known) { get(&sniffed, "label") } else { known };
        return record(&[("engine", text(FOLIATE)), ("label", label), ("source", text("bytes+ext"))]);
    }
    if !ext.is_empty() && truthy(&known) {
        return record(&[("engine", text(if ext == "pdf" { PDF } else { FOLIATE })), ("label", known), ("source", text("ext"))]);
    }
    record(&[("engine", text(UNKNOWN)), ("label", JsValue::NULL), ("source", text("none"))])
}
