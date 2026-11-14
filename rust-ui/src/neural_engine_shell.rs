//! The shell of the neural engine (engine.js `NeuralEngine`): its limits, what its constructor builds, and the functions
//! it hands to the browser (timers, synthesis handlers, the event of the reader, the audio context's state changes,
//! the abort of a download, the player's notifications).
//!
//! How reading flows: the reader calls speak(fragment k, upcoming = [k+1, k+2...]) when fragment k-1 is 'done'. The
//! engine already synthesised (and scheduled, back to back on the audio clock) those upcoming fragments while k-1
//! played, so that speak(k) just ADOPTS the entry it has prepared for k (same text, voice and rate) and the sound never
//! stops. Anything else (another voice/rate/text, a jump) is a clean restart. Synthesis runs ahead of playback by up to
//! ~30 s of audio / 6 fragments (memory-bounded). If the voice cannot keep up it waits (buffering: silence, never
//! garbage); after repeated underruns, or a compute speed far below real time, it buffers complete fragments and keeps
//! the selected natural voice.
//!
//! Every such function is one closure per realm with no captured state, bound to its arguments with
//! `Function.prototype.bind`: the function the browser holds is made by the engine and collected with what it is
//! bound to, as the arrow functions of engine.js were. Nothing here is retained by this module.
//!
//! The limits of the engine (`LIMITS` in engine.js, a literal there because that module is evaluated without this
//! one; `limits` of the constructor overrides any of them):
//! - `idleMs` 90 000: without speech for this long the worker (and its ~0.6 GB) is terminated; the next speak rebuilds it.
//! - `lookaheadSec` 30: synthesise ahead while less than this much audio is waiting to be played,
//! - `maxAhead` 6: ... and at most this many fragments ahead of the one playing.
//! - `maxUpcoming` 6: fragments of `upcoming` the engine looks at.
//! - `maxHoldMs` 5000: never stay silent longer than this just to get a better head start.
//! - `underrunLimit` 3 underruns within `underrunWindowMs` 120 000 switch to complete-fragment buffering;
//!   `cleanFragments` 8 fragments in a row without an underrun forgive the earlier ones.
//! - `slowRtf` 1.6: compute seconds per audio second above which (after `minRtfSamples` 3 chunks) it cannot keep up at
//!   all; one chunk counts for no more than `maxRtfSample` 3.2 (a stall of a few seconds, the worker descheduled or
//!   the app in the background, is not a slow device).
//! - `coldStartMs` 5000: assumed cost of rebuilding the worker (replaced by what the first build measured); a jump that
//!   would wait longer for the running segment rebuilds it instead. `rtfPrior` 0.7: assumed compute speed before
//!   anything was measured.
//! - `lruEntries` 40, `lruSamples` 6 000 000: synthesised fragments kept for replays (~24 MB of Float32 at most).
use js_sys::{Array, Function, Map, Object, Reflect, Set};
use wasm_bindgen::prelude::*;
use crate::host::{absent, call, clear_timeout, construct, global, method, read, set};
use crate::neural_engine::{neural_fire, neural_job_chunk, neural_job_end, neural_job_error, neural_job_plan, neural_player_error, neural_state_change,
    neural_unit_ended, neural_unit_mark, neural_unit_started};

type R<T = JsValue> = Result<T, JsValue>;

fn function<F: ?Sized + wasm_bindgen::closure::WasmClosure>(closure: Closure<F>) -> Function { closure.into_js_value().unchecked_into() }
thread_local! {
    /// `() => neural_fire(this, run, kind, timer)`: the kind travels as its index in KINDS and the timer's id in a
    /// one-slot array filled once the page has answered `setTimer`.
    static FIRE: Function = function(Closure::<dyn FnMut(JsValue, JsValue, f64, Array) -> R<()>>::new(|e, run, kind: f64, cell: Array|
        neural_fire(e, run, KINDS.get(kind as usize).copied().unwrap_or("idle").to_string(), cell.get(0))));
    static JOB_PLAN: Function = function(Closure::<dyn FnMut(JsValue, JsValue) -> R<()>>::new(neural_job_plan));
    static JOB_CHUNK: Function = function(Closure::<dyn FnMut(JsValue, JsValue, JsValue, JsValue) -> R<()>>::new(neural_job_chunk));
    static JOB_END: Function = function(Closure::<dyn FnMut(JsValue, JsValue, JsValue) -> R<()>>::new(neural_job_end));
    static JOB_ERROR: Function = function(Closure::<dyn FnMut(JsValue, JsValue, JsValue, JsValue) -> R<()>>::new(neural_job_error));
    static UNIT_STARTED: Function = function(Closure::<dyn FnMut(JsValue, JsValue) -> R<()>>::new(neural_unit_started));
    static UNIT_ENDED: Function = function(Closure::<dyn FnMut(JsValue, JsValue) -> R<()>>::new(neural_unit_ended));
    static UNIT_MARK: Function = function(Closure::<dyn FnMut(JsValue, JsValue, JsValue) -> R<()>>::new(neural_unit_mark));
    static PLAYER_ERROR: Function = function(Closure::<dyn FnMut(JsValue, JsValue) -> R<()>>::new(neural_player_error));
    static STATE: Function = function(Closure::<dyn FnMut(JsValue, JsValue) -> R<()>>::new(neural_state_change));
    /// `() => this.env.dispatchEvent?.(new CustomEvent('inhouse-tts', { detail }))`, one microtask after the decision.
    static EMIT: Function = function(Closure::<dyn FnMut(JsValue, JsValue) -> R>::new(|e: JsValue, detail: JsValue| {
        let env = read(&e, "env")?;
        let dispatch = read(&env, "dispatchEvent")?;
        if absent(&dispatch) { return Ok(JsValue::UNDEFINED); }
        let init = Object::new();
        set(&init, "detail", &detail)?;
        let event = construct("CustomEvent", &[&JsValue::from_str("inhouse-tts"), &init])?;
        let dispatch: &Function = dispatch.dyn_ref().ok_or_else(|| JsValue::from(js_sys::TypeError::new("this.env.dispatchEvent is not a function")))?;
        dispatch.call1(&env, &event)
    }));
    /// `() => abort.abort()`: never with the event of the signal as its reason.
    static ABORT: Function = function(Closure::<dyn FnMut(JsValue) -> R>::new(|abort: JsValue| method(&abort, "abort", &[])));
    /// `() => this.audio.context()`.
    static CONTEXT: Function = function(Closure::<dyn FnMut(JsValue) -> R>::new(|e: JsValue| method(&read(&e, "audio")?, "context", &[])));
    /// `() => unlockAudio(env)`.
    static UNLOCK: Function = function(Closure::<dyn FnMut(JsValue, JsValue) -> R>::new(|unlock: JsValue, env: JsValue| call(&unlock, "unlockAudio", &[&env])));
    /// `() => defaultCreateClient(this.store)`.
    static CLIENT: Function = function(Closure::<dyn FnMut(JsValue, JsValue) -> R>::new(|create: JsValue, e: JsValue| call(&create, "defaultCreateClient", &[&read(&e, "store")?])));
    /// `(fn, ms) => setTimeout(fn, ms)` and `id => clearTimeout(id)`: the timers of the page at the time of the call.
    static SET_TIMER: Function = function(Closure::<dyn FnMut(JsValue, JsValue) -> R>::new(|task: JsValue, ms: JsValue|
        call(&read(&global(), "setTimeout")?, "setTimeout", &[&task, &ms])));
    static CLEAR_TIMER: Function = function(Closure::<dyn FnMut(JsValue) -> R<()>>::new(|id: JsValue| clear_timeout(&id)));
}
#[wasm_bindgen]
extern "C" {
    type Bindable;
    /// `function.bind(null, a, b, c, d)`: js_sys stops at three bound arguments.
    #[wasm_bindgen(method, js_name = bind)]
    fn bind4(this: &Bindable, receiver: &JsValue, a: &JsValue, b: &JsValue, c: &JsValue, d: &JsValue) -> JsValue;
}
/// `function.bind(null, ...args)` in one call into the engine, without an argument list.
fn bound(function: &'static std::thread::LocalKey<Function>, args: &[&JsValue]) -> R {
    function.with(|function| Ok(match args {
        [a] => function.bind1(&JsValue::NULL, a).into(),
        [a, b] => function.bind2(&JsValue::NULL, a, b).into(),
        [a, b, c] => function.bind3(&JsValue::NULL, a, b, c).into(),
        [a, b, c, d] => function.unchecked_ref::<Bindable>().bind4(&JsValue::NULL, a, b, c, d),
        _ => return Err(js_sys::RangeError::new("A callback of the engine is bound to one to four values").into()),
    }))
}
const KINDS: [&str; 4] = ["pump", "feed", "hold", "idle"];

/// `_arm(run, kind, ms)`: a timer of the run; firing it tells the engine which timer it was.
#[wasm_bindgen]
pub fn neural_arm(e: &JsValue, run: &JsValue, kind: &str, ms: f64) -> R {
    let cell = Array::new();
    let index = KINDS.iter().position(|known| *known == kind).unwrap_or(3);
    let timer = method(e, "setTimer", &[&bound(&FIRE, &[e, run, &JsValue::from_f64(index as f64), &cell])?, &JsValue::from_f64(ms)])?;
    cell.set(0, timer.clone());
    Ok(timer)
}
/// `_handlers(run, entry)`: what the worker client calls back for one synthesis job.
#[wasm_bindgen]
pub fn neural_handlers(e: &JsValue, run: &JsValue, entry: &JsValue) -> R {
    let handlers = Object::new();
    set(&handlers, "onPlan", &bound(&JOB_PLAN, &[entry])?)?;
    set(&handlers, "onChunk", &bound(&JOB_CHUNK, &[e, run, entry])?)?;
    set(&handlers, "onEnd", &bound(&JOB_END, &[e, run, entry])?)?;
    set(&handlers, "onError", &bound(&JOB_ERROR, &[e, run, entry])?)?;
    Ok(handlers.into())
}
/// `_emit(detail)`: the reader hears about it one microtask later, on the environment.
#[wasm_bindgen]
pub fn neural_emit(e: &JsValue, detail: &JsValue) -> R<()> {
    call(&read(&global(), "queueMicrotask")?, "queueMicrotask", &[&bound(&EMIT, &[e, detail])?])?;
    Ok(())
}
/// `_listen(ctx)`: `ctx.addEventListener?.('statechange', ...)`.
#[wasm_bindgen]
pub fn neural_listen(e: &JsValue, ctx: &JsValue) -> R<()> {
    let add = read(ctx, "addEventListener")?;
    if absent(&add) { return Ok(()); }
    let add: &Function = add.dyn_ref().ok_or_else(|| JsValue::from(js_sys::TypeError::new("ctx.addEventListener is not a function")))?;
    add.call2(ctx, &JsValue::from_str("statechange"), &bound(&STATE, &[e, ctx])?)?;
    Ok(())
}
/// `_aborter(abort)`.
#[wasm_bindgen]
pub fn neural_aborter(abort: &JsValue) -> R { bound(&ABORT, &[abort]) }

/// `{ name = fallback }` of the constructor's parameter.
fn dependency(deps: &JsValue, name: &str, fallback: impl FnOnce() -> R) -> R {
    let value = read(deps, name)?;
    if value.is_undefined() { fallback() } else { Ok(value) }
}
fn create(class: &JsValue, args: &[&JsValue]) -> R {
    let list = Array::new();
    for argument in args { list.push(argument); }
    Reflect::construct(class.unchecked_ref(), &list)
}

/// The body of `new NeuralEngine(deps)`. Everything environmental is injectable (tests use fakes for the worker, the
/// audio context, Cache Storage and timers); `kit` holds what the JavaScript module imports: the catalogue, the
/// stores' and players' classes, the worker client factory (the Worker URL has to be JavaScript) and the audio doorways.
#[wasm_bindgen]
pub fn neural_construct(e: JsValue, deps: JsValue, kit: JsValue) -> R<()> {
    let deps: JsValue = if deps.is_undefined() { Object::new().into() } else { deps };
    if deps.is_null() { return Err(js_sys::TypeError::new("Cannot destructure property 'voices' of 'object null' as it is null.").into()); }
    let voices = dependency(&deps, "voices", || read(&kit, "neuralVoices"))?;
    let store = read(&deps, "store")?;
    let create_client = read(&deps, "createClient")?;
    let audio = read(&deps, "audio")?;
    let env = dependency(&deps, "env", || Ok(global()))?;
    let set_timer = dependency(&deps, "setTimer", || Ok(SET_TIMER.with(|timer| timer.clone().into())))?;
    let clear_timer = dependency(&deps, "clearTimer", || Ok(CLEAR_TIMER.with(|timer| timer.clone().into())))?;
    let limits = dependency(&deps, "limits", || Ok(Object::new().into()))?;

    set(&e, "voices", &voices)?;
    set(&e, "models", &call(&read(&kit, "modelsOf")?, "modelsOf", &[&voices])?)?;
    set(&e, "store", &if store.is_truthy() { store } else { create(&read(&kit, "NeuralPackageStore")?, &[])? })?;
    set(&e, "createClient", &if create_client.is_truthy() { create_client } else { bound(&CLIENT, &[&read(&kit, "defaultCreateClient")?, &e])? })?;
    let own_audio = audio.is_truthy();
    let audio = if own_audio { audio } else {
        let audio = Object::new();
        set(&audio, "context", &read(&kit, "audioContext")?)?;
        set(&audio, "unlock", &bound(&UNLOCK, &[&read(&kit, "unlockAudio")?, &env])?)?;
        audio.into()
    };
    set(&e, "audio", &audio)?;
    set(&e, "env", &env)?;
    set(&e, "setTimer", &set_timer)?;
    set(&e, "clearTimer", &clear_timer)?;
    let merged = Object::assign2(&Object::new(), read(&kit, "LIMITS")?.unchecked_ref(), &crate::host::boxed(&limits).unchecked_into());
    set(&e, "limits", &merged)?;
    set(&e, "cache", &create(&read(&kit, "FragmentCache")?, &[&read(&merged, "lruEntries")?, &read(&merged, "lruSamples")?])?)?;
    let options = Object::new();
    let native = !own_audio && call(&read(&kit, "nativePcmBridge")?, "nativePcmBridge", &[&env])?.is_truthy();
    if native { set(&options, "env", &env)?; } else { set(&options, "context", &bound(&CONTEXT, &[&e])?)?; }
    set(&options, "onStart", &bound(&UNIT_STARTED, &[&e])?)?;
    set(&options, "onEnd", &bound(&UNIT_ENDED, &[&e])?)?;
    set(&options, "onMark", &bound(&UNIT_MARK, &[&e])?)?;
    if native { set(&options, "onError", &bound(&PLAYER_ERROR, &[&e])?)?; }
    else { set(&options, "setTimer", &set_timer)?; set(&options, "clearTimer", &clear_timer)?; }
    set(&e, "player", &create(&read(&kit, if native { "NativePcmPlayer" } else { "GaplessPlayer" })?, &[&options])?)?;
    set(&e, "_installed", &Set::new(&JsValue::UNDEFINED))?;
    set(&e, "_downloads", &Map::new())?;
    set(&e, "installing", &Map::new())?; // piperId -> promise
    set(&e, "aborts", &Map::new())?;     // piperId -> AbortController of the download in progress
    set(&e, "client", &JsValue::NULL)?;
    set(&e, "run", &JsValue::NULL)?;
    set(&e, "unitSeq", &JsValue::from_f64(0.0))?;
    set(&e, "currentId", &JsValue::NULL)?;
    set(&e, "idleTimer", &JsValue::NULL)?;
    set(&e, "_status", &JsValue::from_str("idle"))?;
    set(&e, "underrunTimes", &Array::new())?;
    set(&e, "cleanStreak", &JsValue::from_f64(0.0))?;
    let stats = Object::new();
    for key in ["rtf", "underruns", "firstAudioMs", "cacheHits", "prefetchHits", "tooSlow"] { set(&stats, key, &JsValue::from_f64(0.0))?; }
    set(&e, "stats", &stats)?;
    Ok(())
}
