//! The doorways the audiobook's session (reading-voice.js `ReadingVoice`) used to be handed by a
//! JavaScript kit: its timers, the wait for a sentence that continues on the next page and the
//! deferred report of a synthesis that failed. Each callback handed to the browser is a bound export
//! of this module (`bound`), owned by the page. The session's own listeners, `add` and `ignore` (both
//! reached while a word is being presented) stay with the class.
//! The frozen originals are tests/unit/helpers/reference-reading-voice-kit.js.
use js_sys::{Function, Object, Promise};
use wasm_bindgen::prelude::*;
use crate::host::{global, method, read, set, set_timeout};
use crate::reader_experience_policy::bound;

type R<T = JsValue> = Result<T, JsValue>;

/// `(owner, promise, generation, index) => { void promise.then(() => voice_join_ready(owner, generation, index)) }`.
#[wasm_bindgen]
pub fn voice_join_wait(ui: &JsValue, owner: &JsValue, promise: &JsValue, generation: &JsValue, index: &JsValue) -> R<()> {
    method(promise, "then", &[bound(ui, "voice_join_ready", &[owner, generation, index])?.as_ref()]).map(drop)
}
/// `(owner, id) => setTimeout(() => voice_wait_started(owner, id), 900)`.
#[wasm_bindgen]
pub fn voice_wait_timer(ui: &JsValue, owner: &JsValue, id: &JsValue) -> R { set_timeout(bound(ui, "voice_wait_started", &[owner, id])?.as_ref(), 900.0) }
/// `(owner, id) => queueMicrotask(() => owner.engineFailed({id, reason:'synth-failed'}))`.
#[wasm_bindgen]
pub fn voice_synth_failed(ui: &JsValue, owner: &JsValue, id: &JsValue) -> R {
    method(&global(), "queueMicrotask", &[bound(ui, "voice_synth_failed_now", &[owner, id])?.as_ref()])
}
#[wasm_bindgen]
pub fn voice_synth_failed_now(owner: &JsValue, id: &JsValue) -> R {
    let failure = Object::new();
    set(&failure, "id", id)?;
    set(&failure, "reason", &JsValue::from_str("synth-failed"))?;
    method(owner, "engineFailed", &[&failure])
}
/// `(owner, ms) => setTimeout(() => voice_sleep_expired(owner), ms)`.
#[wasm_bindgen]
pub fn voice_sleep_timer(ui: &JsValue, owner: &JsValue, ms: &JsValue) -> R {
    method(&global(), "setTimeout", &[bound(ui, "voice_sleep_expired", &[owner])?.as_ref(), ms])
}
/// `ms => new Promise(resolve => setTimeout(resolve, ms))`.
#[wasm_bindgen]
pub fn voice_sleep(ms: &JsValue) -> Promise {
    Promise::new(&mut |resolve: Function, reject: Function| {
        if let Err(error) = method(&global(), "setTimeout", &[resolve.as_ref(), ms]) { let _ = reject.call1(&JsValue::UNDEFINED, &error); }
    })
}
/// `id => clearTimeout(id)`.
#[wasm_bindgen]
pub fn voice_clear_timer(id: &JsValue) -> R { method(&global(), "clearTimeout", &[id]) }
/// `() => true`, the check of a preparation nobody can make stale.
#[wasm_bindgen]
pub fn voice_always() -> bool { true }
/// `() => navigator.language`.
#[wasm_bindgen]
pub fn voice_device_language() -> R { read(&read(&global(), "navigator")?, "language") }
