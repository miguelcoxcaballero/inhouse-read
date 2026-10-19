//! Persisted reading places/quotes and shelf lamp records. Host strings retain
//! exact UTF-16 (including lone surrogates); Rust owns normalization decisions.
use wasm_bindgen::{prelude::*, JsCast};
use js_sys::{Array, Object, Reflect};
use crate::host::{absent, method, read, truthy, finite, jmax, jmin, js_round, number_string};
use crate::cloud_host::{copy_data_entries, data_entry};
type R<T> = Result<T, JsValue>;
#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_name = Number, catch)] fn number(value: &JsValue) -> R<f64>;
    #[wasm_bindgen(js_name = String, catch)] fn string(value: &JsValue) -> R<JsValue>;
}
fn s(value: &str) -> JsValue { value.into() }
fn n(value: f64) -> JsValue { JsValue::from_f64(value) }
fn zero(value: f64) -> f64 { if value == 0.0 || value.is_nan() { 0.0 } else { value } }
fn fallback(value: JsValue, other: JsValue) -> JsValue { if truthy(&value) { value } else { other } }
fn optional(value: &JsValue, key: &str) -> R<JsValue> { if absent(value) { Ok(JsValue::UNDEFINED) } else { read(value, key) } }
fn object(fields: &[(&str, JsValue)]) -> R<JsValue> {
    let entries = Array::new();
    for (key, value) in fields { data_entry(&entries, &s(key), value); }
    Ok(Object::from_entries(entries.as_ref())?.into())
}
fn trim(value: &JsValue) -> R<JsValue> { method(value, "trim", &[]) }
fn cut(value: &JsValue, count: f64) -> R<JsValue> { method(value, "slice", &[&n(0.0), &n(count)]) }
fn label(record: &JsValue) -> R<JsValue> { cut(&string(&fallback(read(record, "label")?, s("")))?, 140.0) }
fn locator(record: &JsValue) -> R<JsValue> {
    if optional(&read(record, "locator")?, "kind")? == s("pdf-page") {
        let locator = read(record, "locator")?;
        let v = number(&read(&locator, "value")?)?;
        let result = object(&[("kind", s("pdf-page")), ("value", n(jmax(1.0, js_round(if v == 0.0 || v.is_nan() { 1.0 } else { v }))))])?;
        let offset = read(&locator, "textOffset")?;
        if offset.as_f64().is_some_and(|v| v.is_finite() && v.fract() == 0.0)
            && number(&read(&locator, "textOffset")?)? > 0.0 {
            crate::host::set(&result, "textOffset", &n(jmin(10_000_000.0, number(&read(&locator, "textOffset")?)?)))?;
        }
        Ok(result)
    } else if optional(&read(record, "locator")?, "kind")? == s("cfi")
        && read(&read(record, "locator")?, "value")?.is_string() {
        object(&[("kind", s("cfi")), ("value", cut(&read(&read(record, "locator")?, "value")?, 4096.0)?)])
    } else { Ok(JsValue::NULL) }
}
#[wasm_bindgen]
pub fn record_clone_place(place: JsValue) -> R<JsValue> {
    let fraction = fallback(read(&place, "fraction")?, n(0.0));
    let locator = if truthy(&read(&place, "locator")?) {
        let entries = Array::new(); copy_data_entries(&entries, &read(&place, "locator")?)?;
        Object::from_entries(entries.as_ref())?.into()
    } else { JsValue::NULL };
    object(&[("fraction", fraction), ("locator", locator)])
}
#[wasm_bindgen]
pub fn record_clean_places(value: JsValue, limit: JsValue, quotes: bool) -> R<JsValue> {
    let filtered = Array::new();
    if Array::is_array(&value) {
        let length = read(&value, "length")?.as_f64().unwrap_or(0.0) as u32;
        // filter completes before slice/map, including malformed entries beyond
        // the requested limit. Sparse entries are skipped like Array.filter.
        for index in 0..length {
            let key = n(index as f64);
            if !Reflect::has(&value, &key)? { continue; }
            let record = Reflect::get(&value, &key)?;
            if !truthy(&record) { continue; }
            let accepted = if quotes {
                read(&record, "text")?.is_string() && truthy(&trim(&read(&record, "text")?)?)
            } else { number(&read(&record, "fraction")?)?.is_finite() };
            if accepted { filtered.push(&record); }
        }
    }
    let sliced = method(filtered.as_ref(), "slice", &[&n(0.0), &limit])?;
    let sliced: &Array = sliced.unchecked_ref();
    let out = Array::new();
    for (index, record) in sliced.iter().enumerate() {
        let entries = Array::new();
        if quotes {
            let id = read(&record, "id")?;
            let id = if truthy(&id) { id } else {
                s(&format!("{}-{index}", number_string(zero(number(&read(&record, "createdAt")?)?))))
            };
            data_entry(&entries, &s("id"), &cut(&string(&id)?, 80.0)?);
            data_entry(&entries, &s("text"), &cut(&trim(&read(&record, "text")?)?, 1200.0)?);
        }
        let fraction = number(&read(&record, "fraction")?)?;
        data_entry(&entries, &s("fraction"), &n(jmin(1.0, jmax(0.0, if quotes { zero(fraction) } else { fraction }))));
        data_entry(&entries, &s("locator"), &locator(&record)?);
        data_entry(&entries, &s("label"), &label(&record)?);
        if quotes {
            let color = read(&record, "color")?;
            let recognized = ["yellow", "green", "blue", "pink"].iter().any(|v| color == s(v));
            data_entry(&entries, &s("color"), &if recognized { read(&record, "color")? } else { s("yellow") });
        }
        data_entry(&entries, &s("createdAt"), &n(zero(number(&read(&record, "createdAt")?)?)));
        out.push(&Object::from_entries(entries.as_ref())?.into());
    }
    Ok(out.into())
}
fn nonempty_string_field(record: &JsValue, key: &str) -> R<bool> {
    Ok(read(record, key)?.is_string() && truthy(&trim(&read(record, key)?)?))
}
#[wasm_bindgen]
pub fn record_normalize_lamp(candidate: JsValue, catalogue: JsValue, kelvins: JsValue) -> R<JsValue> {
    if !truthy(&candidate) || !candidate.is_object() { return Ok(JsValue::NULL); }
    let lamp = method(&catalogue, "get", &[&string(&fallback(read(&candidate, "lampId")?, s("")))?])?;
    let key = if nonempty_string_field(&candidate, "key")? { trim(&read(&candidate, "key")?)? }
        else if nonempty_string_field(&candidate, "seed")? { trim(&read(&candidate, "seed")?)? }
        else { JsValue::NULL };
    if !truthy(&lamp) || !truthy(&key) { return Ok(JsValue::NULL); }
    let seed = if nonempty_string_field(&candidate, "seed")? { trim(&read(&candidate, "seed")?)? } else { key.clone() };
    let entries = Array::new();
    for (key, value) in [("key", key), ("seed", seed), ("lampId", read(&lamp, "id")?),
        ("isOn", JsValue::from_bool(read(&candidate, "isOn")? != JsValue::FALSE))] { data_entry(&entries, &s(key), &value); }
    if finite(&read(&candidate, "shelf")?) && number(&read(&candidate, "shelf")?)? >= 0.0 {
        data_entry(&entries, &s("shelf"), &n(jmin(999.0, number(&read(&candidate, "shelf")?)?.floor())));
    }
    if finite(&read(&candidate, "x")?) {
        data_entry(&entries, &s("x"), &n(jmin(1.0, jmax(0.0, number(&read(&candidate, "x")?)?))));
    }
    if truthy(&method(&kelvins, "includes", &[&read(&candidate, "kelvin")?])?) {
        data_entry(&entries, &s("kelvin"), &read(&candidate, "kelvin")?);
    }
    Ok(Object::from_entries(entries.as_ref())?.into())
}
