//! Metadata-only refresh keeps exact layout/texture ownership. Unknown fields,
//! bookmark changes and unstamped Blob replacement retain the original path.
use wasm_bindgen::{prelude::*, JsCast};
use js_sys::{Array, Object, Reflect, Function, Set};
use crate::host::{read, truthy, finite, method};
use crate::cloud_host::data_entry;
type R<T> = Result<T, JsValue>;
#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_namespace = Object, js_name = is, catch)] fn same(a: &JsValue, b: &JsValue) -> R<bool>;
    #[wasm_bindgen(js_namespace = Object, js_name = keys, catch)] fn keys(value: &JsValue) -> R<Array>;
    #[wasm_bindgen(js_namespace = Object, js_name = entries, catch)] fn entries(value: &JsValue) -> R<Array>;
    #[wasm_bindgen(js_namespace = Object, js_name = getPrototypeOf, catch)] fn prototype(value: &JsValue) -> R<JsValue>;
    #[wasm_bindgen(js_namespace = ["Object", "prototype", "toString"], js_name = call, catch)] fn tag(value: &JsValue) -> R<JsValue>;
    #[wasm_bindgen(js_namespace = JSON, js_name = stringify, catch)] fn stringify(value: &JsValue) -> R<JsValue>;
    #[wasm_bindgen(js_name = String, catch)] fn string(value: &JsValue) -> R<JsValue>;
}
fn s(value: &str) -> JsValue { value.into() }
fn metadata(key: &JsValue) -> bool {
    ["progressUpdatedAt", "progressDirty", "progressStateFileId", "lengthDirty", "readingHistory", "bookmarks", "quotes", "locator"]
        .iter().any(|item| *key == s(item))
}
fn blob(value: &JsValue) -> R<bool> { let value = tag(value)?; Ok(value == s("[object Blob]") || value == s("[object File]")) }
struct Frame { before: JsValue, after: JsValue, keys: Array, index: u32 }
fn identical_blobs(mut before: JsValue, mut after: JsValue) -> R<bool> {
    let mut stack: Vec<Frame> = Vec::new();
    'visit: loop {
        if !same(&before, &after)? {
            if blob(&before)? || blob(&after)? { return Ok(false); }
            if truthy(&before) && truthy(&after) && before.is_object() && after.is_object() {
                if stack.iter().any(|frame| frame.before == before && frame.after == after) {
                    return Err(js_sys::RangeError::new("Maximum call stack size exceeded").into());
                }
                let own = keys(&before)?;
                stack.push(Frame { before, after, keys: own, index: 0 });
            }
        }
        loop {
            let Some(frame) = stack.last_mut() else { return Ok(true); };
            if frame.index == frame.keys.length() { stack.pop(); continue; }
            let key = frame.keys.get(frame.index); frame.index += 1;
            before = Reflect::get(&frame.before, &key)?; after = Reflect::get(&frame.after, &key)?;
            continue 'visit;
        }
    }
}
fn committed(before: &JsValue, after: &JsValue) -> R<bool> {
    for pair in entries(before)?.iter() {
        let pair: &Array = pair.unchecked_ref(); let key = pair.get(0); let value = pair.get(1);
        if metadata(&key) || same(&value, &Reflect::get(after, &key)?)? { continue; }
        if blob(&value)? && blob(&Reflect::get(after, &key)?)? {
            if key == s("content") && read(before, "contentRevision")?.is_string()
                && truthy(&method(&read(before, "contentRevision")?, "trim", &[])?)
                && read(before, "contentRevision")? == read(after, "contentRevision")? { continue; }
            if (key == s("cover") || key == s("coverBlob")) && finite(&read(before, "coverUpdatedAt")?)
                && read(before, "coverUpdatedAt")?.as_f64().unwrap_or(0.0) > 0.0
                && read(before, "coverUpdatedAt")? == read(after, "coverUpdatedAt")? { continue; }
        }
        if !identical_blobs(value, Reflect::get(after, &key)?)? { return Ok(false); }
    }
    Ok(true)
}
fn without_metadata(record: &JsValue) -> R<JsValue> {
    let kept = Array::new();
    for pair in entries(record)?.iter() {
        let pair: &Array = pair.unchecked_ref(); if !metadata(&pair.get(0)) { data_entry(&kept, &pair.get(0), &pair.get(1)); }
    }
    Ok(Object::from_entries(kept.as_ref())?.into())
}
#[wasm_bindgen]
pub fn shelf_can_adopt_metadata(previous: JsValue, next: JsValue, bookmark: Function, compare: Function) -> R<bool> {
    if !Array::is_array(&previous) || !Array::is_array(&next) { return Ok(false); }
    let previous: &Array = previous.unchecked_ref(); let next: &Array = next.unchecked_ref();
    if previous.length() == 0 || previous.length() != next.length() { return Ok(false); }
    let plain = read(&read(&crate::host::global(), "Object")?, "prototype")?;
    let ids = Set::new(&JsValue::UNDEFINED);
    for index in 0..previous.length() {
        let before = previous.get(index); let after = next.get(index);
        if !truthy(&before) || !truthy(&after) || prototype(&before)? != plain || prototype(&after)? != plain
            || !truthy(&read(&before, "id")?) || read(&before, "id")? != read(&after, "id")?
            || ids.has(&string(&read(&before, "id")?)?) { return Ok(false); }
        ids.add(&string(&read(&before, "id")?)?);
        if !committed(&before, &after)? { return Ok(false); }
        if stringify(&bookmark.call1(&JsValue::UNDEFINED, &before)?)? != stringify(&bookmark.call1(&JsValue::UNDEFINED, &after)?)? { return Ok(false); }
    }
    if truthy(&compare.call2(&JsValue::UNDEFINED, previous.as_ref(), next.as_ref())?) { return Ok(false); }
    let before = Array::new(); let after = Array::new();
    for value in previous.iter() { before.push(&without_metadata(&value)?); }
    for value in next.iter() { after.push(&without_metadata(&value)?); }
    Ok(truthy(&compare.call2(&JsValue::UNDEFINED, before.as_ref(), after.as_ref())?))
}
