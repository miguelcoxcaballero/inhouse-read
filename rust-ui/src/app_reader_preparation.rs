//! Selection-owned reader preparation. Browser factories only adapt Promise
//! callbacks and idle scheduling; cancellation, ownership and cache decisions
//! live here. No native registry retains the host or its DOM after a task ends.
use wasm_bindgen::prelude::*;
use js_sys::{Array, Object, Promise};
use crate::host::{read, set, method, truthy, absent};
use crate::cloud_host as c;
type R<T> = Result<T, JsValue>;

fn object(fields: &[(&str, JsValue)]) -> R<JsValue> {
    let entries = Array::new();
    for (key, value) in fields { c::data_entry(&entries, &(*key).into(), value); }
    Ok(Object::from_entries(entries.as_ref())?.into())
}
fn or(value: JsValue, fallback: impl FnOnce() -> R<JsValue>) -> R<JsValue> {
    if truthy(&value) { Ok(value) } else { fallback() }
}
fn optional(value: &JsValue, key: &str) -> R<JsValue> {
    if absent(value) { Ok(JsValue::UNDEFINED) } else { read(value, key) }
}
fn ignore(host: &JsValue, task: &JsValue) -> R<JsValue> {
    method(task, "catch", &[&read(host, "ignorePreparationError")?])
}
fn current(host: &JsValue, id: &JsValue, generation: &JsValue) -> R<bool> {
    let state = read(host, "state")?;
    Ok(read(&state, "preparationGeneration")? == *generation
        && read(&state, "activePreparedBookId")? == *id
        && read(&state, "currentBookId")? == *id)
}

#[wasm_bindgen]
pub fn app_open_page_gate(host: JsValue, id: JsValue, settled: JsValue) -> R<JsValue> {
    let gate = method(&host, "createStageGate", &[&settled])?;
    set(&read(&host, "state")?, "pageGate", &object(&[("bookId", id), ("gate", gate.clone())])?)?;
    Ok(gate)
}

#[wasm_bindgen]
pub fn app_release_page_gate(host: JsValue, reason: JsValue, id: JsValue) -> R<()> {
    let entry = read(&read(&host, "state")?, "pageGate")?;
    if truthy(&entry) && (!truthy(&id) || read(&entry, "bookId")? == id) {
        method(&read(&entry, "gate")?, "release", &[&reason])?;
    }
    Ok(())
}

#[wasm_bindgen]
pub fn app_supersede_preparation(host: JsValue, reason: JsValue) -> R<()> {
    let state = read(&host, "state")?;
    let generation = c::number(&read(&state, "preparationGeneration")?) + 1.0;
    set(&state, "preparationGeneration", &generation.into())?;
    method(&read(&host, "preparedPages")?, "invalidate", &[&reason])?;
    app_release_page_gate(host, reason, JsValue::UNDEFINED)
}

#[wasm_bindgen]
pub fn app_dismiss_prepared_page(host: JsValue) -> R<()> {
    method(&read(&host, "preparedPages")?, "invalidate", &[&"dismissed".into()])?;
    app_release_page_gate(host, "dismissed".into(), JsValue::UNDEFINED)
}

#[wasm_bindgen]
pub fn app_prepare_book(host: JsValue, book: JsValue, settled: JsValue) -> R<JsValue> {
    let state = read(&host, "state")?;
    let books = read(&host, "preparedBooks")?;
    if read(&state, "requestedPreparationId")? == read(&book, "id")?
        && truthy(&method(&books, "has", &[&read(&book, "id")?])?) {
        let generation = read(&state, "preparationGeneration")?;
        let gate = app_open_page_gate(host.clone(), read(&book, "id")?, settled)?;
        let existing = method(&books, "get", &[&read(&book, "id")?])?;
        let callback = method(&host, "reprepareRunner", &[&book, &generation, &gate])?;
        let again = method(&existing, "then", &[&callback])?;
        set(&state, "readerPreparationQueue", &ignore(&host, &again)?)?;
        method(&books, "set", &[&read(&book, "id")?, &again])?;
        return Ok(again);
    }
    app_supersede_preparation(host.clone(), "new-selection".into())?;
    let generation = read(&state, "preparationGeneration")?;
    set(&state, "requestedPreparationId", &read(&book, "id")?)?;
    method(&books, "clear", &[])?;
    let file_task = if truthy(&read(&book, "content")?)
        && (read(&book, "sourceType")? == JsValue::from_str("local")
            || read(&book, "sourceType")? == JsValue::from_str("drive")) {
        let parts = Array::new(); parts.push(&read(&book, "content")?);
        let name = or(read(&book, "name")?, || or(read(&book, "title")?, || Ok("libro".into())))?;
        let mime = or(read(&book, "mimeType")?, || or(read(&read(&book, "content")?, "type")?, || Ok("".into())))?;
        let file = c::construct("File", &[parts.as_ref(), &name, &object(&[("type", mime)])?])?;
        Promise::resolve(&file).into()
    } else if truthy(&method(&host, "needsDriveDownload", &[&book])?)
        && truthy(&method(&host, "hasDriveSession", &[])?) {
        method(&read(&host, "cloudSync")?, "downloadForOffline", &[&book])?
    } else { JsValue::NULL };
    if !truthy(&file_task) { return Ok(JsValue::UNDEFINED); }
    let files_ready: JsValue = Promise::resolve(&file_task).into();
    ignore(&host, &files_ready)?;
    let gate = app_open_page_gate(host.clone(), read(&book, "id")?, settled)?;
    let queued = ignore(&host, &read(&state, "readerPreparationQueue")?)?;
    let callback = method(&host, "preparationRunner", &[&book, &generation, &gate, &files_ready])?;
    let task = method(&queued, "then", &[&callback])?;
    set(&state, "readerPreparationQueue", &ignore(&host, &task)?)?;
    method(&books, "set", &[&read(&book, "id")?, &task])?;
    Ok(task)
}

#[wasm_bindgen]
pub fn app_reprepare_page(host: JsValue, book: JsValue, generation: JsValue, gate: JsValue, ready: JsValue) -> Promise {
    c::start(async move {
        let state = read(&host, "state")?;
        if truthy(&ready) && generation == read(&state, "preparationGeneration")?
            && read(&state, "activePreparedBookId")? == read(&book, "id")? {
            c::settle(Ok(app_prepare_page_stage(host, read(&book, "id")?, generation, gate).into())).await?;
        }
        Ok(ready)
    })
}

#[wasm_bindgen]
pub fn app_run_preparation(host: JsValue, book: JsValue, generation: JsValue, gate: JsValue, files: JsValue) -> Promise {
    c::start(async move {
        let file = c::settle(Ok(files)).await?;
        let state = read(&host, "state")?;
        if generation != read(&state, "preparationGeneration")? { return Ok(JsValue::FALSE); }
        let pending = method(&read(&host, "progressWrites")?, "get", &[&read(&book, "id")?])?;
        let pending = if absent(&pending) { JsValue::UNDEFINED } else { ignore(&host, &pending)? };
        c::settle(Ok(pending)).await?;
        let updated = c::settle(method(&read(&host, "library")?, "get", &[&read(&book, "id")?])).await?;
        if !truthy(&updated) || generation != read(&state, "preparationGeneration")? { return Ok(JsValue::FALSE); }
        let options = object(&[("existingRecord", updated), ("forcedId", read(&book, "id")?),
            ("preparing", JsValue::TRUE), ("reuseStoredContent", JsValue::TRUE)])?;
        let opened = c::settle(method(&host, "openFile", &[&file, &options])).await?;
        if generation != read(&state, "preparationGeneration")? { return Ok(JsValue::FALSE); }
        set(&state, "activePreparedBookId", &if truthy(&opened) { read(&book, "id")? } else { JsValue::NULL })?;
        method(&host, "markTiming", &[&"engine-opened".into()])?;
        if truthy(&opened) {
            c::settle(Ok(app_prepare_page_stage(host, read(&book, "id")?, generation, gate).into())).await?;
        }
        Ok(opened)
    })
}

#[wasm_bindgen]
pub fn app_page_key(host: JsValue, id: JsValue, record: JsValue) -> R<JsValue> {
    let viewport = read(&read(&host, "els")?, "readerViewport")?;
    let bounds = method(&viewport, "getBoundingClientRect", &[])?;
    let reader = read(&host, "reader")?;
    let location = read(&reader, "location")?;
    let fraction = read(&location, "fraction")?;
    let locator = read(&location, "locator")?;
    let saved_locator = optional(&record, "locator")?;
    let mut size = Vec::new();
    for key in ["left", "top", "width", "height"] { size.push((key, read(&bounds, key)?)); }
    object(&[("bookId", id), ("epoch", read(&reader, "epoch")?),
        ("locator", if absent(&saved_locator) { JsValue::NULL } else { saved_locator }),
        ("fraction", or(optional(&record, "progressFraction")?, || Ok(0.0.into()))?),
        ("location", object(&[("fraction", fraction), ("locator", locator)])?),
        ("viewport", object(&size)?),
        ("pixelRatio", or(read(&read(&host, "window")?, "devicePixelRatio")?, || Ok(1.0.into()))?),
        ("preferences", method(&read(&c::global(), "JSON")?, "stringify", &[&read(&read(&host, "readingExperience")?, "preferences")?])?),
        ("theme", or(method(&read(&read(&host, "document")?, "documentElement")?, "getAttribute", &[&"data-theme".into()])?, || Ok("".into()))?),
        ("filter", read(&method(&host, "getComputedStyle", &[&viewport])?, "filter")?)])
}

#[wasm_bindgen]
pub fn app_restore_and_snapshot(host: JsValue, record: JsValue) -> Promise {
    c::start(async move {
        let state = read(&host, "state")?; let reader = read(&host, "reader")?;
        set(&state, "restoringProgress", &JsValue::TRUE)?;
        let restored = c::settle((|| method(&reader, "goToLocator", &[&read(&record, "locator")?,
            &or(read(&record, "progressFraction")?, || Ok(0.0.into()))?]))()).await;
        set(&state, "restoringProgress", &JsValue::FALSE)?;
        restored?;
        method(&host, "markTiming", &[&"page-restored".into()])?;
        let snapshot = c::settle(method(&reader, "getPageSnapshot", &[&object(&[("reuseSettledLayout", JsValue::TRUE)])?])).await?;
        method(&host, "markTiming", &[&"page-snapshot".into()])?;
        Ok(snapshot)
    })
}

async fn page_stage(host: &JsValue, id: &JsValue, generation: &JsValue, gate: &JsValue) -> R<JsValue> {
    if !truthy(&c::settle(method(gate, "wait", &[])).await?) || !current(host, id, generation)? { return Ok(JsValue::FALSE); }
    let pages = read(host, "preparedPages")?;
    if !truthy(&method(&pages, "isReady", &[])?) && !truthy(&c::settle(method(&pages, "whenReady", &[])).await?) { return Ok(JsValue::FALSE); }
    let record = c::settle(method(&read(host, "library")?, "get", &[id])).await?;
    if !truthy(&record) || !current(host, id, generation)? { return Ok(JsValue::FALSE); }
    let ticket = method(&pages, "begin", &[id])?;
    let started = app_page_key(host.clone(), id.clone(), record.clone())?;
    let snapshot = c::settle(Ok(app_restore_and_snapshot(host.clone(), record.clone()).into())).await?;
    if !truthy(&snapshot) || !current(host, id, generation)? || !truthy(&method(&pages, "isCurrent", &[&ticket])?) { return Ok(JsValue::FALSE); }
    let key = app_page_key(host.clone(), id.clone(), record)?;
    let entries = Array::new(); c::copy_data_entries(&entries, &key)?;
    c::data_entry(&entries, &"location".into(), &read(&started, "location")?);
    let comparison: JsValue = Object::from_entries(entries.as_ref())?.into();
    if truthy(&method(host, "pageKeyMismatch", &[&comparison, &started])?) { return Ok(JsValue::FALSE); }
    if !truthy(&method(&pages, "store", &[&ticket, &key, &snapshot])?) { return Ok(JsValue::FALSE); }
    let shelf = read(&read(host, "state")?, "shelf")?;
    let prepared = if absent(&shelf) { JsValue::UNDEFINED } else { method(&shelf, "prepareOpeningPage", &[id, &snapshot, &read(host, "idleSlice")?])? };
    c::settle(Ok(prepared)).await?;
    Ok(JsValue::TRUE)
}

#[wasm_bindgen]
pub fn app_prepare_page_stage(host: JsValue, id: JsValue, generation: JsValue, gate: JsValue) -> Promise {
    c::start(async move {
        match page_stage(&host, &id, &generation, &gate).await {
            Ok(value) => Ok(value),
            Err(error) => { method(&host, "warnPagePreparation", &[&error])?; Ok(JsValue::FALSE) }
        }
    })
}

#[wasm_bindgen]
pub fn app_opening_page_snapshot(host: JsValue, id: JsValue, record: JsValue) -> Promise {
    c::start(async move {
        let key = app_page_key(host.clone(), id, record.clone())?;
        let prepared = method(&read(&host, "preparedPages")?, "take", &[&key])?;
        if truthy(&prepared) { method(&host, "markTiming", &[&"page-reused".into()])?; return Ok(prepared); }
        c::settle(Ok(app_restore_and_snapshot(host, record).into())).await
    })
}
