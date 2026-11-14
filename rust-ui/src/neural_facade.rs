//! The facade of the on-device natural voices (neural-voice/index.js `NeuralVoiceEngine`): the CONTRACT between the
//! engine and the reading integration (reading-voice.js, voice-catalog.js, the voice picker). The facade exists from
//! the moment the picker needs the catalogue and loads the real engine (engine.js, with the downloader, the player and
//! the worker client) with a dynamic import the first time it is needed; the worker, onnxruntime-web and the
//! phonemizer are loaded even later, on the first speak(), inside the worker.
//!
//! The object stays the JavaScript one (an EventTarget with `options`, `core`, `loading`, `queue`, `resourceToken` and
//! `plan`, which the reader, the diagnostics and the tests look at); its members are answered here, each the way the
//! JavaScript method ran: `eager` runs a body like an `async function`, at once up to its first wait and on in the
//! reaction job of what it waits for, so a caller sees every effect at the microtask it had. The functions the
//! browser calls back (the two relayed events, the adoption of the loaded modules, a failed load) are exports of this
//! module bound to the facade with `Function.prototype.bind`: the garbage collector owns them, as it owned the arrows.
//!
//! The contract, for the integration:
//! - `installed` / `downloads` / `status` / `stats` (getters, JavaScript): the state of the loaded engine, empty until
//!   it is loaded (call refresh() first). `status` is 'idle' | 'loading' | 'buffering' | 'speaking' and fires 'status'.
//! - `preload()` starts loading the engine code (not the worker, not a model) and resolves when it is ready.
//! - `refresh()` re-reads Cache Storage; fires 'change' when the installed set differs.
//! - `install(id, {signal})` downloads a voice into Cache Storage with progress ('change' events and `downloads`),
//!   asks for persistent storage, and resolves when it is usable. Rejects with an Error whose `code` is 'offline' |
//!   'http' | 'storage' | 'aborted' ('unsupported' for an unknown voice or a browser without the pieces). Never starts
//!   by itself: only the user asks for a download.
//! - `cancel(id)` aborts the download of `id`; `remove(id)` deletes a downloaded voice (if it is the one being read,
//!   the current id gets an 'error' event with reason 'not-installed').
//! - `warmUp(voiceId)` / `prime(request)`: explicit playback preparation only; a reader closed while the module
//!   loaded gets `false` and nothing starts.
//! - `unlock()` must run synchronously inside a user gesture (the play tap): creates/resumes the AudioContext.
//! - `speak(request)` speaks `text` with an installed voice and returns at once. Progress is reported on `window` as
//!   CustomEvent('inhouse-tts', {detail:{type, id, reason?}}) exactly like the Android bridge: 'start' (the first
//!   sample of THIS text is audible now), 'done', 'error' (reason 'not-installed' | 'init-failed' | 'synth-failed')
//!   and 'interrupted' (stopped from outside, not by stop()). `upcoming` are the next fragments the reader will ask
//!   for, same voice and rate: the engine synthesises them while this one plays so the voice is gapless.
//! - `extendUpcoming(request)` adds deferred page fragments only to a running core; it never starts playback.
//! - `stop()` stops playback and drops queued synthesis, firing no event for the cancelled id; `pause()`;
//!   `cancelCurrent()`; `release()` on an explicit reader close: never loads the module or waits for native disposal.
use js_sys::{Array, Function, Map, Object, Promise, Reflect};
use wasm_bindgen::prelude::*;
use crate::eager::eager;
use crate::quick_wait::wait;
use crate::host::{absent, call, construct, get_at, global, method, read, set};

type R<T = JsValue> = Result<T, JsValue>;

thread_local! {
    /// `() => {}`: nobody looks at a failed load here, the caller that needs the engine does.
    static NOTHING: Function = Closure::<dyn FnMut()>::new(|| {}).into_js_value().unchecked_into();
    /// `() => new Error('Voice released')`, the error of a plan whose facade was released.
    static RELEASED: Function = Closure::<dyn FnMut() -> JsValue>::new(|| js_sys::Error::new("Voice released").into()).into_js_value().unchecked_into();
}

/// `ui[name].bind(null, ...args)`.
fn bound(ui: &JsValue, name: &str, args: &[&JsValue]) -> R {
    let function = read(ui, name)?;
    let list = Array::of1(&JsValue::NULL);
    for argument in args { list.push(argument); }
    Reflect::apply(read(&function, "bind")?.unchecked_ref(), &function, &list)
}
/// `this.options.env || globalThis`.
fn env_of(host: &JsValue) -> R {
    let env = read(&read(host, "options")?, "env")?;
    Ok(if env.is_truthy() { env } else { global() })
}
/// `{ name = fallback } = {}` of a parameter.
fn option(options: &JsValue, name: &str) -> R {
    if options.is_undefined() { return Ok(JsValue::UNDEFINED); }
    if options.is_null() { return Err(js_sys::TypeError::new(&format!("Cannot destructure property '{name}' of 'object null' as it is null.")).into()); }
    read(options, name)
}
/// `this.queue.length = 0; this.plan?.clearQueue()`.
fn forget(host: &JsValue, plan_method: &str) -> R<()> {
    if plan_method == "invalidate" { set(host, "resourceToken", &Object::new())?; }
    else { set(&read(host, "queue")?, "length", &JsValue::from_f64(0.0))?; }
    let plan = read(host, "plan")?;
    if !absent(&plan) { method(&plan, plan_method, &[])?; }
    if plan_method == "invalidate" { set(&read(host, "queue")?, "length", &JsValue::from_f64(0.0))?; }
    Ok(())
}
fn kit_call(kit: &JsValue, name: &str, args: &[&JsValue]) -> R { call(&read(kit, name)?, name, args) }

/// What the bridge diagnostics read while no engine is loaded; reading it loads nothing.
fn unloaded_state(host: &JsValue) -> R {
    let state = Object::new();
    let put = |key: &str, value: JsValue| set(&state, key, &value);
    put("loaded", JsValue::FALSE)?;
    put("moduleLoading", JsValue::from_bool(read(host, "loading")?.is_truthy()))?;
    put("queuedRequests", read(&read(host, "queue")?, "length")?)?;
    put("status", JsValue::from_str("idle"))?;
    put("run", JsValue::FALSE)?; put("job", JsValue::FALSE)?;
    put("prepared", JsValue::from_str("none"))?;
    put("workerAlive", JsValue::FALSE)?;
    put("currentUnit", JsValue::NULL)?;
    for key in ["entryCount", "queued", "synth", "done", "started", "ended", "deferred"] { put(key, JsValue::from_f64(0.0))?; }
    put("gateOpen", JsValue::FALSE)?; put("buffered", JsValue::FALSE)?;
    put("scheduledChunks", JsValue::from_f64(0.0))?; put("availableChunks", JsValue::from_f64(0.0))?;
    let timers = Object::new();
    for key in ["pump", "feed", "hold", "idle"] { set(&timers, key, &JsValue::FALSE)?; }
    put("timers", timers.into())?;
    Ok(state.into())
}

/// `preload()`: one load at a time; a failed one is forgotten so that the next call tries again.
fn preload(host: &JsValue, kit: &JsValue, ui: &JsValue) -> R {
    let loading = read(host, "loading")?;
    if loading.is_truthy() { return Ok(loading); }
    let modules = Array::of2(&method(kit, "engine", &[])?, &method(kit, "plan", &[])?);
    let adopted = method(&Promise::all(&modules), "then", &[&bound(ui, "facade_adopt", &[host, ui])?])?;
    let loading = method(&adopted, "catch", &[&bound(ui, "facade_load_failed", &[host])?])?;
    set(host, "loading", &loading)?;
    Ok(loading)
}

/// The engine and the planner arrived: wait for the voice core, build the engine and hand it what was asked meanwhile.
#[wasm_bindgen]
pub fn facade_adopt(host: JsValue, ui: JsValue, modules: JsValue) -> Promise {
    eager(async move {
        let engine_class = read(&get_at(&modules, 0), "NeuralEngine")?;
        let plan_class = read(&get_at(&modules, 1), "VoiceClientPlan")?;
        // Requested voice code owns its small voice-domain planner. The cold facade has no WASM dependency, Worker or
        // model before this explicit use.
        let mut plan = read(&host, "plan")?;
        if !plan.is_truthy() {
            let released: JsValue = RELEASED.with(|released| released.clone().into());
            plan = Reflect::construct(plan_class.unchecked_ref(), &Array::of2(&released, &read(&host, "resourceToken")?))?;
            set(&host, "plan", &plan)?;
        }
        loop {
            let attempt = method(&plan, "capture", &[])?;
            let ready = match method(&plan, "ready", &[]) { Ok(ready) => wait(&ready).await, Err(error) => Err(error) };
            match ready {
                Ok(_) => break,
                Err(error) => if method(&plan, "pending", &[&attempt])?.is_truthy() { return Err(error); },
            }
        }
        let core = Reflect::construct(engine_class.unchecked_ref(), &Array::of1(&read(&host, "options")?))?;
        for kind in ["change", "status"] {
            let kind = JsValue::from_str(kind);
            method(&core, "addEventListener", &[&kind, &bound(&ui, "facade_relay", &[&host, &kind])?])?;
        }
        set(&host, "core", &core)?;
        // Browser callbacks remain handles; the planner owns ordered admission and cancellation once readiness allows
        // the bootstrap queue to be adopted.
        let tasks = Map::new();
        let queued = method(&read(&host, "queue")?, "splice", &[&JsValue::from_f64(0.0)])?;
        let handle = JsValue::from_str("handle");
        let mut index = 0;
        loop {
            if f64::from(index) >= read(&queued, "length")?.as_f64().unwrap_or(0.0) { break; }
            let id = method(&plan, "next", &[&handle])?;
            tasks.set(&id, &get_at(&queued, index));
            method(&plan, "enqueue", &[&id])?;
            index += 1;
        }
        let drained: R<()> = (|| {
            loop {
                let id = method(&plan, "take", &[])?;
                if id.as_f64().is_some_and(f64::is_nan) { return Ok(()); }
                let task = tasks.get(&id);
                tasks.delete(&id);
                if method(&plan, "workerActive", &[&id])?.is_truthy() {
                    method(&plan, "cancel", &[&id])?;
                    call(&task, "task", &[&core])?;
                }
            }
        })();
        method(&plan, "clearQueue", &[])?;
        drained?;
        Ok(core)
    })
}
/// `error => { this.loading = null; throw error }`.
#[wasm_bindgen]
pub fn facade_load_failed(host: JsValue, error: JsValue) -> R<()> {
    set(&host, "loading", &JsValue::NULL)?;
    Err(error)
}
/// A 'change' or 'status' of the engine is one of the facade.
#[wasm_bindgen]
pub fn facade_relay(host: JsValue, kind: JsValue) -> R {
    method(&host, "dispatchEvent", &[&construct("Event", &[&kind])?])
}
/// What a speak() before the engine was loaded left in the queue: `core => core.speak(request)`.
#[wasm_bindgen]
pub fn facade_task(request: JsValue, core: JsValue) -> R { method(&core, "speak", &[&request]) }
/// The engine could not be loaded for a speak(): nothing stays queued and its fragment gets an 'error'.
#[wasm_bindgen]
pub fn facade_speak_failed(host: JsValue, kit: JsValue, ui: JsValue, request: JsValue) -> R<()> {
    set(&read(&host, "queue")?, "length", &JsValue::from_f64(0.0))?;
    kit_call(&kit, "stopNativeAudio", &[])?;
    call(&read(&global(), "queueMicrotask")?, "queueMicrotask", &[&bound(&ui, "facade_speak_error", &[&host, &request])?])?;
    Ok(())
}
#[wasm_bindgen]
pub fn facade_speak_error(host: JsValue, request: JsValue) -> R {
    let env = env_of(&host)?;
    let dispatch = read(&env, "dispatchEvent")?;
    if absent(&dispatch) { return Ok(JsValue::UNDEFINED); }
    let detail = Object::new();
    set(&detail, "type", &JsValue::from_str("error"))?;
    set(&detail, "id", &read(&request, "id")?)?;
    set(&detail, "reason", &JsValue::from_str("init-failed"))?;
    let init = Object::new();
    set(&init, "detail", &detail)?;
    let event = construct("CustomEvent", &[&JsValue::from_str("inhouse-tts"), &init])?;
    let dispatch: &Function = dispatch.dyn_ref().ok_or_else(|| JsValue::from(js_sys::TypeError::new("(this.options.env || globalThis).dispatchEvent is not a function")))?;
    dispatch.call1(&env, &event)
}

/// `(await this.preload()).name(...args)`.
async fn loaded(host: JsValue) -> R { wait(&method(&host, "preload", &[])?).await }
/// warmUp() and prime() while the module loads: a release meanwhile replaced the resource ticket (and invalidated the
/// plan), and then nothing starts.
async fn guarded(host: JsValue, name: &'static str, argument: JsValue) -> R {
    let plan = read(&host, "plan")?;
    let generation = if plan.is_truthy() { method(&plan, "capture", &[])? } else {
        let generation = Object::new();
        set(&generation, "ticket", &read(&host, "resourceToken")?)?;
        set(&generation, "generation", &JsValue::from_f64(0.0))?;
        generation.into()
    };
    let core = loaded(host.clone()).await?;
    if !method(&host, "current", &[&generation])?.is_truthy() { return Ok(JsValue::FALSE); }
    method(&core, name, &[&argument])
}

/// `NeuralVoiceEngine.prototype[name].apply(host, args)`. `kit` holds what must be JavaScript: the two dynamic imports
/// (`engine`, `plan`) and the audio doorways; `ui` is this module as JavaScript sees it.
#[wasm_bindgen]
pub fn facade_method(host: JsValue, name: &str, args: Array, kit: JsValue, ui: JsValue) -> R {
    let (a0, a1) = (args.get(0), args.get(1));
    Ok(match name {
        "getDiagnosticState" => {
            let core = read(&host, "core")?;
            let state = if absent(&core) { JsValue::UNDEFINED } else { method(&core, "getDiagnosticState", &[])? };
            if absent(&state) { unloaded_state(&host)? } else { state }
        }
        "preload" => preload(&host, &kit, &ui)?,
        "refresh" => eager(async move { method(&loaded(host).await?, "refresh", &[]) }).into(),
        "install" => eager(async move {
            let signal = option(&a1, "signal")?;
            let core = loaded(host).await?;
            let request = Object::new();
            set(&request, "signal", &signal)?;
            method(&core, "install", &[&a0, &request])
        }).into(),
        "cancel" => {
            let core = read(&host, "core")?;
            if !absent(&core) { method(&core, "cancel", &[&a0])?; }
            JsValue::UNDEFINED
        }
        "remove" => eager(async move { method(&loaded(host).await?, "remove", &[&a0]) }).into(),
        "warmUp" => eager(async move {
            let core = read(&host, "core")?;
            if core.is_truthy() { return method(&core, "warmUp", &[&a0]); }
            guarded(host, "warmUp", a0).await
        }).into(),
        "prime" => eager(guarded(host, "prime", a0)).into(),
        "current" => {
            let plan = read(&host, "plan")?;
            if plan.is_truthy() { method(&plan, "current", &[&a0])? }
            else { JsValue::from_bool(read(&a0, "ticket")? == read(&host, "resourceToken")?) }
        }
        "unlock" => {
            let playback = option(&a0, "playback")?;
            let playback = if playback.is_undefined() { JsValue::TRUE } else { playback };
            let env = env_of(&host)?;
            if playback.is_truthy() || !kit_call(&kit, "nativePcmBridge", &[&env])?.is_truthy() { kit_call(&kit, "unlockAudio", &[&env])?; }
            // speak() follows: have the engine code on its way
            method(&method(&host, "preload", &[])?, "catch", &[&NOTHING.with(|nothing| JsValue::from(nothing.clone()))])?;
            JsValue::UNDEFINED
        }
        "speak" => {
            let core = read(&host, "core")?;
            if core.is_truthy() { return method(&core, "speak", &[&a0]); }
            method(&read(&host, "queue")?, "push", &[&bound(&ui, "facade_task", &[&a0])?])?;
            method(&method(&host, "preload", &[])?, "catch", &[&bound(&ui, "facade_speak_failed", &[&host, &kit, &ui, &a0])?])?;
            JsValue::UNDEFINED
        }
        "extendUpcoming" => {
            let core = read(&host, "core")?;
            let extended = if absent(&core) { JsValue::UNDEFINED } else { method(&core, "extendUpcoming", &[&a0])? };
            if absent(&extended) { JsValue::FALSE } else { extended }
        }
        "stop" | "pause" => {
            forget(&host, "clearQueue")?;
            let core = read(&host, "core")?;
            if core.is_truthy() { return method(&core, name, &[]); }
            kit_call(&kit, if name == "stop" { "stopNativeAudio" } else { "pauseNativeAudio" }, &[])?;
            JsValue::UNDEFINED
        }
        // Explicit reader close: never load the module/client or wait for native disposal.
        "release" => {
            forget(&host, "invalidate")?;
            let core = read(&host, "core")?;
            if core.is_truthy() { method(&core, "release", &[])?; } else { kit_call(&kit, "stopNativeAudio", &[])?; }
            JsValue::UNDEFINED
        }
        "cancelCurrent" => {
            forget(&host, "clearQueue")?;
            let core = read(&host, "core")?;
            if !absent(&core) { method(&core, "cancelCurrent", &[])?; }
            JsValue::UNDEFINED
        }
        _ => return Err(js_sys::TypeError::new(&format!("The voice facade has no method {name}")).into()),
    })
}
