//! Reading indicators use cached complete text counts, never a second paginator.
//! EPUB reference pages share the shelf's 300 words/page convention. Duration
//! is explicitly an estimate (180 words/minute at 1x), not synthesised audio.
use wasm_bindgen::prelude::*;
use crate::host::{get, num, truthy, method};
use crate::pdf_reader::plain;
fn finite(v: &JsValue) -> Option<f64> { v.as_f64().filter(|n| n.is_finite()) }
fn fraction(n: f64) -> f64 { if n.is_finite() { n.clamp(0.0, 1.0) } else { 0.0 } }
#[wasm_bindgen]
pub fn reader_reading_metrics(s: &JsValue, location: &JsValue, metadata: &JsValue, rate: f64, active: bool) -> Result<JsValue, JsValue> {
 let words = if truthy(&get(metadata, "wordCountComplete")) { finite(&get(metadata, "wordCount")).filter(|v| *v >= 0.0) } else { None };
 let engine = get(&get(s, "reader"), "s");
 let pdf = get(&get(location, "locator"), "kind") == "pdf-page";
 let f = fraction(num(&get(location, "fraction")));
 let physical_total = finite(&get(&get(&engine, "doc"), "numPages"));
 let total = if pdf { physical_total.or_else(|| finite(&get(metadata, "pageCount"))) } else { words.map(|w| (w / 300.0).ceil().max(1.0)) };
 let page = total.map(|n| if pdf { num(&get(&get(location, "locator"), "value")).max(1.0).min(n) } else { (f * n).floor().max(0.0).min(n - 1.0) + 1.0 });
 let pages = match (page, total) { (Some(p), Some(n)) if n > 0.0 => format!("{p:.0}/{n:.0}"), _ => "—/—".to_owned() };
 let compact = format!("{:.0} % · {pages}", (f * 100.0).round());
 let description = if pdf { format!("Página {pages}") } else { format!("Páginas de referencia {pages} (300 palabras por página)") };
 // PDF's saved fraction reaches 100% at the START of its final page. Keep
 // that final page in the duration, including single-page documents.
 let mut audio_fraction = if pdf { match (page, total) { (Some(p),Some(n)) if n > 0.0 => (p - 1.0) / n, _ => f } } else { f };
 if active {
  let cursor = get(&engine, "speechCursor");
  if pdf {
   if let (Some(p),Some(n)) = (finite(&get(&cursor,"page")), total) {
    let len = num(&get(&get(&get(&cursor,"source"),"text"),"length")).max(1.0);
    audio_fraction = (p - 1.0 + fraction(num(&get(&cursor,"start")) / len)) / n.max(1.0);
   }
  } else {
   let current = get(&cursor,"current");
   if finite(&get(&current,"index")).is_some() {
    let len = num(&get(&get(&get(&current,"map"),"text"),"length")).max(1.0);
    let ratio = fraction(num(&get(&current,"offset")) / len);
    let progress = method(&get(&cursor,"progress"),"getProgress",&[&get(&current,"index"),&ratio.into()])?;
    if let Some(value) = finite(&get(&progress,"fraction")) { audio_fraction = value; }
   }
  }
 }
 let speed = if rate.is_finite() && rate > 0.0 { rate } else { 1.0 };
 let time = words.map(|w| {
  let minutes = (w * (1.0 - fraction(audio_fraction)) / (180.0 * speed)).ceil() as u64;
  format!("{}h {:02}min", minutes / 60, minutes % 60)
 }).unwrap_or_else(|| "—h —min".to_owned());
 plain(&[("compact",compact.into()),("pagesDescription",description.into()),("time",time.into())])
}
