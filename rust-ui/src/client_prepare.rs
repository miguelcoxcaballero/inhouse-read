//! `prepare()` of the two synthesis clients (client.js `SynthClient`, native-client.js
//! `NativeSynthClient`): the promise bookkeeping around the preparation flow each already had in
//! Rust (synth_client_prepare, native_client_prepare). One preparation at a time, queued behind the
//! previous one; a second call for the voice being prepared gets the same promise; the ledger
//! (`plan`) is told when a preparation begins and when its promise settles. The promise reactions
//! are the same ones, attached in the same order, so every continuation runs at the microtask it
//! did. The callbacks are bound exports (`bound`), owned by the page.
//! The frozen originals are tests/unit/helpers/reference-client-prepare.js.
use js_sys::{Function, Object, Promise};
use wasm_bindgen::prelude::*;
use crate::host::{absent, method, read, set};
use crate::reader_experience_policy::bound;

type R<T = JsValue> = Result<T, JsValue>;

thread_local! { static NOOP: Closure<dyn FnMut(JsValue)> = Closure::new(|_| {}); }
fn noop() -> JsValue { NOOP.with(|function| function.as_ref().clone()) }
fn truthy(value: &JsValue) -> bool { value.is_truthy() }
/// `{[name]: key, promise}`, what `loading` holds while a voice is prepared.
fn loading(name: &str, key: &JsValue, promise: &JsValue) -> R {
    let entry = Object::new();
    set(&entry, name, key)?;
    set(&entry, "promise", promise)?;
    Ok(entry.into())
}
/// `if (client.loading?.promise === promise) { client.loading = null; client.plan.finishPreparation() }`.
fn finish(client: &JsValue, promise: &JsValue) -> R<()> {
    let current = read(client, "loading")?;
    if !absent(&current) && read(&current, "promise")? == *promise {
        set(client, "loading", &JsValue::NULL)?;
        method(&read(client, "plan")?, "finishPreparation", &[])?;
    }
    Ok(())
}

/// `SynthClient.prototype.prepare.call(client, piperId)`: starts the worker if needed and makes
/// `piperId` the voice it holds. Resolves with the voice's config.
#[wasm_bindgen]
pub fn synth_client_begin(client: JsValue, piper_id: JsValue, ui: JsValue) -> R {
    let plan = read(&client, "plan")?;
    if truthy(&method(&plan, "preparing", &[&piper_id])?) { return read(&read(&client, "loading")?, "promise"); }
    let generation = method(&plan, "capture", &[])?;
    let work = method(&read(&client, "preparationChain")?, "then", &[bound(&ui, "synth_client_prepare", &[&client, &piper_id, &generation])?.as_ref()])?;
    // A release rejects every preparation it finds in `preparations`, queued or running.
    let mut rejecter = JsValue::UNDEFINED;
    let promise: JsValue = Promise::new(&mut |resolve: Function, reject: Function| {
        rejecter = reject.clone().into();
        let started = (|| -> R<()> {
            method(&read(&client, "preparations")?, "add", &[reject.as_ref()])?;
            method(&work, "then", &[resolve.as_ref(), reject.as_ref()]).map(drop)
        })();
        if let Err(error) = started { let _ = reject.call1(&JsValue::UNDEFINED, &error); }
    }).into();
    set(&client, "preparationChain", &method(&promise, "catch", &[&noop()])?)?;
    set(&client, "loading", &loading("piperId", &piper_id, &promise)?)?;
    method(&plan, "beginPreparation", &[&piper_id])?;
    let finished = bound(&ui, "synth_client_prepared", &[&client, &rejecter, &promise])?;
    method(&promise, "then", &[finished.as_ref(), finished.as_ref()])?;
    Ok(promise)
}
#[wasm_bindgen]
pub fn synth_client_prepared(client: &JsValue, rejecter: &JsValue, promise: &JsValue) -> R<()> {
    method(&read(client, "preparations")?, "delete", &[rejecter])?;
    finish(client, promise)
}

/// `NativeSynthClient.prototype.prepare.call(client, key)`.
#[wasm_bindgen]
pub fn native_client_begin(client: JsValue, key: JsValue, kit: JsValue, ui: JsValue) -> R {
    let plan = read(&client, "plan")?;
    if truthy(&method(&plan, "model", &[&JsValue::from_f64(8.0), &key])?) { return Ok(Promise::resolve(&read(&client, "config")?).into()); }
    if truthy(&method(&plan, "preparing", &[&key])?) { return read(&read(&client, "loading")?, "promise"); }
    let generation = method(&plan, "capture", &[])?;
    let promise = method(&read(&client, "preparationChain")?, "then", &[bound(&ui, "native_client_prepare", &[&client, &key, &generation, &kit])?.as_ref()])?;
    set(&client, "preparationChain", &method(&promise, "catch", &[&noop()])?)?;
    set(&client, "loading", &loading("key", &key, &promise)?)?;
    method(&plan, "beginPreparation", &[&key])?;
    let settled = method(&promise, "finally", &[bound(&ui, "native_client_prepared", &[&client, &promise])?.as_ref()])?;
    method(&settled, "catch", &[&noop()])?;
    Ok(promise)
}
#[wasm_bindgen]
pub fn native_client_prepared(client: &JsValue, promise: &JsValue) -> R<()> { finish(client, promise) }
