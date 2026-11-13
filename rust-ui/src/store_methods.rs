//! The members of the two voice stores (store.js, supertonic-store.js) that were one-line doorways to this module:
//! `Store.prototype[name].apply(store, args)`, with `kit.part` saying which store is asking. Each arm is
//! the export its JavaScript method called, started the way the generated binding of an async export starts it
//! (`future_to_promise`), so a caller sees the same promise at the same turn. The stores keep their constructors (the
//! injected browser services and their defaults) and the members with JavaScript promise plumbing in JavaScript. The
//! package store's members stay JavaScript: they only choose between two stores, and measured 0.01 us there against
//! 1.4 us through this dispatcher.
use js_sys::Array;
use wasm_bindgen::prelude::*;
use wasm_bindgen_futures::future_to_promise;
use crate::host::read;
use crate::{supertonic_store::*, voice_store::*};

#[wasm_bindgen]
pub fn store_method(store: JsValue, name: &str, args: Array, kit: JsValue, _ui: JsValue) -> Result<JsValue, JsValue> {
    let (a0, a1) = (args.get(0), args.get(1));
    let which = read(&kit, "part")?.as_string().unwrap_or_default();
    let unit = |_: ()| JsValue::UNDEFINED;
    Ok(match (which.as_str(), name) {
        // VoiceStore: the downloaded Piper voices in Cache Storage.
        ("piper", "list") => { let voices = read(&kit, "voices")?; future_to_promise(store_list(store, voices)).into() }
        ("piper", "has") => future_to_promise(async move { store_has(store, a0).await.map(JsValue::from) }).into(),
        ("piper", "readConfig") => future_to_promise(store_read_config(store, a0)).into(),
        ("piper", "readModel") => future_to_promise(store_read_model(store, a0)).into(),
        ("piper", "readPhonemizerModel") => future_to_promise(store_read_phonemizer(store, a0)).into(),
        ("piper", "remove") => future_to_promise(async move { store_remove(store, a0).await.map(unit) }).into(),
        ("piper", "persist") => future_to_promise(async move { Ok(JsValue::from(store_persist(store).await)) }).into(),
        ("piper", "expectedSize") => future_to_promise(async move { store_expected_size(store, a0, a1).await.map(JsValue::from) }).into(),
        ("piper", "download") => future_to_promise(store_download(store, a0, a1)).into(),
        // SupertonicStore: the one pack shared by every language and style.
        ("supertonic", "cache") => future_to_promise(supertonic_cache(store)).into(),
        ("supertonic", "committedAssets") => { let revision = read(&kit, "revision")?; future_to_promise(supertonic_committed(store, revision)).into() }
        ("supertonic", "installed") => { let revision = read(&kit, "revision")?; future_to_promise(async move { supertonic_installed(store, revision).await.map(JsValue::from) }).into() }
        ("supertonic", "availableStyles") => { let revision = read(&kit, "revision")?; future_to_promise(supertonic_styles(store, revision)).into() }
        ("supertonic", "readAssets") => { let revision = read(&kit, "revision")?; future_to_promise(supertonic_read_assets(store, revision)).into() }
        ("supertonic", "readConfig") => { let revision = read(&kit, "revision")?; future_to_promise(supertonic_read_config(store, revision)).into() }
        ("supertonic", "remove") => future_to_promise(async move { supertonic_remove(store).await.map(unit) }).into(),
        _ => return Err(js_sys::TypeError::new(&format!("The {which} voice store has no method {name}")).into()),
    })
}
