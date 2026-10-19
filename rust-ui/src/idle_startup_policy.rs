//! Optional work belongs to its original document and parks without polling
//! while reading or hidden. The host can start before this module is ready;
//! adoption uses the same state and callbacks, never a second queue.
use wasm_bindgen::prelude::*;
use wasm_bindgen_futures::JsFuture;
use js_sys::{Array, Promise, Reflect, Symbol};
use crate::host::*;
type R<T> = Result<T, JsValue>;

fn hidden(owner: &JsValue) -> R<bool> {
    Ok(!absent(owner) && read(owner, "visibilityState")? == JsValue::from_str("hidden"))
}

#[wasm_bindgen]
pub fn startup_work_active(state: &JsValue, active: &JsValue) -> R<()> {
    let active = truthy(active);
    set(state, "active", &active.into())?;
    if active {
        // Snapshot first: callbacks may add/remove waiters or change ownership.
        let callbacks = method(&read(&global(), "Array")?, "from", &[&read(state, "waiters")?])?;
        for callback in callbacks.unchecked_into::<Array>().iter() {
            call(&callback, "resume", &[])?;
        }
    }
    Ok(())
}

#[wasm_bindgen]
pub fn startup_work_allowed(state: &JsValue, owner: &JsValue, allow_discarded: bool) -> R<bool> {
    if allow_discarded && *owner != read(&global(), "document")? { return Ok(true); }
    Ok(truthy(&read(state, "active")?) && !hidden(owner)?)
}

#[wasm_bindgen]
pub fn startup_presented_cached(state: &JsValue, owner: &JsValue) -> R<JsValue> {
    if !truthy(owner) { return Ok(JsValue::FALSE); }
    if read(state, "presentedDocument")? != *owner {
        set(state, "presented", &JsValue::NULL)?;
        set(state, "presentedDocument", owner)?;
    }
    read(state, "presented")
}

#[wasm_bindgen]
pub fn startup_presented_check(owner: &JsValue, started: f64) -> R<i32> {
    if read(&global(), "document")? != *owner { return Ok(-1); }
    let canvas = method(owner, "querySelector", &[&"canvas.ihr-bookshelf-scene".into()])?;
    let count = if absent(&canvas) { JsValue::UNDEFINED } else { read(&read(&canvas, "dataset")?, "renderCount")? };
    // Number() may invoke a user-defined conversion. Catch it before leaving
    // Rust so an error cannot bypass destruction of borrowed host handles.
    let count = method(&global(), "Number", &[&count])?.as_f64().unwrap_or(f64::NAN);
    Ok(if count > 0.0 || clock()? - started > 8000.0 { 1 } else { 0 })
}

async fn wait(value: JsValue) -> R<JsValue> {
    // Promise.resolve can throw on a Promise with a failing constructor getter.
    // Keep it behind the caught host boundary just like task() itself.
    let promise = method(&read(&global(), "Promise")?, "resolve", &[&value])?;
    JsFuture::from(promise.unchecked_into::<Promise>()).await
}
fn close_iterator(iterator: &JsValue) -> R<()> {
    let finish = read(iterator, "return")?;
    if !absent(&finish) {
        let finish = finish.dyn_ref::<js_sys::Function>().ok_or_else(|| js_sys::TypeError::new("Iterator return is not callable"))?;
        let result = finish.call0(iterator)?;
        if !result.is_object() && !result.is_function() { return Err(js_sys::TypeError::new("Iterator result is not an object").into()); }
    }
    Ok(())
}

/// Promise/idle callbacks are supplied by the browser adapter. Task order,
/// original-document ownership, and failure isolation stay in Rust.
#[wasm_bindgen]
pub async fn startup_run_tasks(owner: JsValue, presented: JsValue, tasks: JsValue, slice: JsValue) -> R<()> {
    if !truthy(&wait(presented).await?) { return Ok(()); }
    let factory = Reflect::get(&boxed(&tasks), Symbol::iterator().as_ref())?;
    let factory = factory.dyn_ref::<js_sys::Function>().ok_or_else(|| js_sys::TypeError::new("tasks is not iterable"))?;
    let iterator = factory.call0(&tasks)?;
    if !iterator.is_object() && !iterator.is_function() { return Err(js_sys::TypeError::new("Iterator is not an object").into()); }
    // JavaScript caches next on entry to a for-of loop.
    let next = read(&iterator, "next")?.dyn_into::<js_sys::Function>().map_err(|_| js_sys::TypeError::new("Iterator next is not callable"))?;
    loop {
        let item = next.call0(&iterator)?;
        if !item.is_object() && !item.is_function() { return Err(js_sys::TypeError::new("Iterator result is not an object").into()); }
        if truthy(&read(&item, "done")?) { return Ok(()); }
        let task = read(&item, "value")?;
        let idle = match call(&slice, "idleSlice", &[]) {
            Ok(value) => wait(value).await,
            Err(error) => Err(error),
        };
        if let Err(error) = idle { let _ = close_iterator(&iterator); return Err(error); }
        let current = match read(&global(), "document") { Ok(value) => value, Err(error) => { let _ = close_iterator(&iterator); return Err(error); } };
        if current != owner { close_iterator(&iterator)?; return Ok(()); }
        let outcome = match call(&task, "task", &[]) {
            Ok(value) => wait(value).await,
            Err(error) => Err(error),
        };
        if let Err(error) = outcome {
            let warning = read(&global(), "console").and_then(|console| method(&console, "warn", &[&"Carga diferida omitida:".into(), &error]));
            if let Err(error) = warning {
                let _ = close_iterator(&iterator); return Err(error);
            }
        }
    }
}
