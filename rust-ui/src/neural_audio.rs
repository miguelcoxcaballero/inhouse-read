//! The one audio output of the neural voices (neural-voice/audio.js): the shared AudioContext of the page or, inside
//! the Android app, the native PCM session behind `InhousePcm`. The context has to be created (or resumed)
//! synchronously inside a user gesture (the play tap) or the browser keeps it suspended, so `audio_unlock` is a plain
//! export the tap calls directly.
//!
//! The state is what the JavaScript module kept in three variables: the context, the native session
//! (`{bridge, session, paused?}`, an object the players read and mark) and the session counter. No borrow of it is
//! held while the bridge or a context is called: they may come back here.
use std::cell::{Cell, RefCell};
use js_sys::{Function, Object, Promise, Reflect};
use wasm_bindgen::prelude::*;
use crate::host::{global, method, number_string, read, set};

type R<T = JsValue> = Result<T, JsValue>;

thread_local! {
    static CONTEXT: RefCell<JsValue> = const { RefCell::new(JsValue::NULL) };
    static NATIVE: RefCell<JsValue> = const { RefCell::new(JsValue::NULL) };
    static SEQUENCE: Cell<f64> = const { Cell::new(0.0) };
    static NOTHING: Function = Closure::<dyn FnMut()>::new(|| {}).into_js_value().unchecked_into();
}
#[wasm_bindgen]
extern "C" {
    /// `Number(value)`; a symbol makes it throw, like the JavaScript conversion.
    #[wasm_bindgen(js_name = Number, catch)]
    fn to_number(value: &JsValue) -> R<f64>;
}
fn context() -> JsValue { CONTEXT.with(|context| context.borrow().clone()) }
fn native() -> JsValue { NATIVE.with(|native| native.borrow().clone()) }
fn keep_context(value: JsValue) { CONTEXT.with(|context| *context.borrow_mut() = value); }
fn keep_native(value: JsValue) { NATIVE.with(|native| *native.borrow_mut() = value); }
/// `if (context?.native) context = null`.
fn forget_native_context() -> R<()> {
    let current = context();
    if !current.is_null() && !current.is_undefined() && read(&current, "native")?.is_truthy() { keep_context(JsValue::NULL); }
    Ok(())
}

/// The native PCM bridge of the environment when it speaks protocol 1, else null.
#[wasm_bindgen]
pub fn audio_bridge(env: JsValue) -> R {
    let env = if env.is_undefined() { global() } else { env };
    let bridge = read(&env, "InhousePcm")?;
    if !bridge.is_truthy() { return Ok(JsValue::NULL); }
    let protocol = method(&bridge, "getProtocol", &[]).and_then(|protocol| to_number(&protocol));
    Ok(if protocol.is_ok_and(|protocol| protocol == 1.0) { bridge } else { JsValue::NULL })
}
#[wasm_bindgen]
pub fn audio_native() -> JsValue { native() }
/// The shared context, if unlock() has created one.
#[wasm_bindgen]
pub fn audio_context() -> JsValue { context() }
#[wasm_bindgen]
pub fn audio_stop_native() -> R<()> {
    let previous = native();
    keep_native(JsValue::NULL);
    forget_native_context()?;
    if previous.is_truthy() { let _ = read(&previous, "bridge").and_then(|bridge| method(&bridge, "stop", &[&read(&previous, "session")?])); } // bridge already closed
    Ok(())
}
#[wasm_bindgen]
pub fn audio_pause_native() -> R<()> {
    let previous = native();
    if previous.is_truthy() { set(&previous, "paused", &JsValue::TRUE)?; }
    forget_native_context()?;
    if previous.is_truthy() { let _ = read(&previous, "bridge").and_then(|bridge| method(&bridge, "pause", &[&read(&previous, "session")?])); } // bridge already closed
    Ok(())
}
/// Creates/resumes the shared AudioContext. Call it synchronously from a click/tap handler. Returns it (or null
/// without Web Audio).
#[wasm_bindgen]
pub fn audio_unlock(env: JsValue) -> R {
    let env = if env.is_undefined() { global() } else { env };
    let bridge = audio_bridge(env.clone())?;
    if bridge.is_truthy() {
        let current = native();
        if !current.is_truthy() || read(&current, "paused")?.is_truthy() {
            let now = js_sys::Date::now();
            let sequence = SEQUENCE.with(|sequence| { sequence.set(sequence.get() + 1.0); sequence.get() });
            let session = JsValue::from_str(&format!("{}-{}", number_string(now), number_string(sequence)));
            method(&bridge, "begin", &[&session, &JsValue::from_str("Audiolibro")])?;
            let started = Object::new();
            set(&started, "bridge", &bridge)?;
            set(&started, "session", &session)?;
            keep_native(started.into());
            let stand_in = Object::new();
            set(&stand_in, "native", &JsValue::TRUE)?;
            set(&stand_in, "state", &JsValue::from_str("running"))?;
            set(&stand_in, "session", &session)?;
            set(&stand_in, "currentTime", &JsValue::from_f64(0.0))?;
            keep_context(stand_in.into());
        }
        return Ok(context());
    }
    let mut class = read(&env, "AudioContext")?;
    if !class.is_truthy() { class = read(&env, "webkitAudioContext")?; }
    if !class.is_truthy() { return Ok(JsValue::NULL); }
    let mut current = context();
    if !current.is_truthy() || read(&current, "state")? == JsValue::from_str("closed") {
        let options = Object::new();
        set(&options, "latencyHint", &JsValue::from_str("playback"))?;
        current = Reflect::construct(class.unchecked_ref(), &js_sys::Array::of1(&options))?;
        keep_context(current.clone());
    }
    if read(&current, "state")? != JsValue::from_str("running") {
        // resumes with the next gesture
        let _ = method(&current, "resume", &[]).and_then(|resumed| NOTHING.with(|nothing| method(&Promise::resolve(&resumed), "catch", &[nothing.as_ref()])));
    }
    Ok(context())
}
/// Forget the context (tests).
#[wasm_bindgen]
pub fn audio_reset() { keep_context(JsValue::NULL); keep_native(JsValue::NULL); }
