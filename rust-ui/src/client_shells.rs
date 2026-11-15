//! What the constructors of the two synthesis clients build: client.js `SynthClient` (the page-side handle of the
//! synthesis worker) and native-client.js `NativeSynthClient` (Android's native executor), and which of the two an
//! engine makes when it was given none (engine.js `defaultCreateClient`). A client is made once per engine start; everything a fragment passes through stays a closure of those files, where it measured faster
//! (medians of interleaved rounds): `synth()` and its `cancel` 4.4 us in client.js against 4.9 us made here, 0.11 us in
//! native-client.js against 3.1 us; a chunk message through the worker's `onmessage` arrow 0.61 us against 0.79 us
//! through a bound handler; a whole job of three sentences of the Android client 103 us against 140 us with the Piper
//! run (its BigInt64Array tensors) made here.
//!
//! `released`, what a ledger throws once its client was released, is one closure per realm with no captured state, as
//! the arrow of each constructor was.
//! The frozen originals are tests/unit/helpers/reference-client-shells.js and, for the default client,
//! reference-neural-engine-shell.js.
use js_sys::{Array, Function, Map, Object, Promise, Reflect, Set};
use wasm_bindgen::prelude::*;
use crate::host::{absent, call, construct, global, method, method_opt, read, set};
use crate::neural_audio::{audio_bridge, audio_native};
use crate::synth_client::synth_client_error;

type R<T = JsValue> = Result<T, JsValue>;
fn st(value: &str) -> JsValue { JsValue::from_str(value) }
fn function<F: ?Sized + wasm_bindgen::closure::WasmClosure>(closure: Closure<F>) -> Function { closure.into_js_value().unchecked_into() }

thread_local! {
    /// `() => synth_client_error('init-failed', 'worker was released')`.
    static WORKER_RELEASED: Function = function(Closure::<dyn FnMut() -> R>::new(|| synth_client_error(st("init-failed"), st("worker was released"), JsValue::UNDEFINED)));
    /// `() => Object.assign(new Error('Voice released'), {code: 'init-failed'})`.
    static VOICE_RELEASED: Function = function(Closure::<dyn FnMut() -> R>::new(|| {
        let error = construct("Error", &[&st("Voice released")])?;
        set(&error, "code", &st("init-failed"))?;
        Ok(error)
    }));
}
thread_local! {
    /// `id => store.readModel(id)` and `id => store.readConfig(id)`: the name travels as its index in READS.
    static READ: Function = function(Closure::<dyn FnMut(JsValue, f64, JsValue) -> R>::new(|store: JsValue, name: f64, id: JsValue|
        method(&store, READS[name as usize], &[&id])));
    /// `id => store.readPhonemizerModel?.(id) || null` and the same for `readRuntimeAssets`.
    static READ_OPTIONAL: Function = function(Closure::<dyn FnMut(JsValue, f64, JsValue) -> R>::new(|store: JsValue, name: f64, id: JsValue| {
        let answer = method_opt(&store, READS[name as usize], &[&id])?.unwrap_or(JsValue::UNDEFINED);
        Ok(if answer.is_truthy() { answer } else { JsValue::NULL })
    }));
    /// A stage receipt of the worker, handed to the native diagnostic bridge of the audio session that is open:
    /// `(domain, stage, request, part) => { const audio = nativeAudio(); if (audio) audio.bridge.reportSynthesisStage(audio.session, domain, stage, request, part) }`.
    static STAGE: Function = function(Closure::<dyn FnMut(JsValue, JsValue, JsValue, JsValue) -> R<()>>::new(|domain: JsValue, stage: JsValue, request: JsValue, part: JsValue| {
        let audio = audio_native();
        if audio.is_truthy() { method(&read(&audio, "bridge")?, "reportSynthesisStage", &[&read(&audio, "session")?, &domain, &stage, &request, &part])?; }
        Ok(())
    }));
}
const READS: [&str; 4] = ["readModel", "readConfig", "readPhonemizerModel", "readRuntimeAssets"];

/// The client an engine makes when it was given none (engine.js `defaultCreateClient(store)`): Android's native
/// executor where the app offers it (`InhouseInference`, protocol 1), else the worker. `kit.base()` is the page's
/// neural-voice folder and `kit.createWorker` starts the worker: both name what the bundler must see. The worker client
/// reads the voice's files through `store`, looked up at each read, and forwards stage receipts only where the native
/// audio bridge takes them.
#[wasm_bindgen]
pub fn neural_default_client(store: JsValue, kit: JsValue) -> R {
    let base = call(&read(&kit, "base")?, "base", &[])?;
    let text = |tail: &str| -> JsValue { &base + &st(tail) };
    let options: JsValue = Object::new().into();
    let make = |class: &str, options: &JsValue| -> R { Reflect::construct(read(&kit, class)?.unchecked_ref(), &Array::of1(options)) };
    let inference = read(&global(), "InhouseInference")?;
    if method_opt(&inference, "getProtocol", &[])?.is_some_and(|protocol| protocol == JsValue::from_f64(1.0)) {
        set(&options, "store", &store)?;
        set(&options, "phonBase", &text("phon/"))?;
        return make("NativeSynthClient", &options);
    }
    set(&options, "createWorker", &read(&kit, "createWorker")?)?;
    set(&options, "ortBase", &text("ort/"))?;
    set(&options, "phonBase", &text("phon/"))?;
    for (index, name) in READS.iter().enumerate() {
        let reader = if index < 2 { &READ } else { &READ_OPTIONAL };
        set(&options, name, &reader.with(|reader| reader.bind2(&JsValue::NULL, &store, &JsValue::from_f64(index as f64))))?;
    }
    let bridge = audio_bridge(JsValue::UNDEFINED)?;
    let reports = !absent(&bridge) && read(&bridge, "reportSynthesisStage")?.is_function();
    set(&options, "onStage", &if reports { STAGE.with(|stage| stage.clone()).into() } else { JsValue::NULL })?;
    make("SynthClient", &options)
}

fn ledger(kit: &JsValue, arguments: &Array) -> R { Reflect::construct(read(kit, "VoiceClientPlan")?.unchecked_ref(), arguments) }

/// `new SynthClient({createWorker, ortBase, phonBase, readModel, readConfig, readPhonemizerModel = async () => null,
/// readRuntimeAssets = async () => null, onStage = null})`: `kit.none` is that `async () => null` and `kit.VoiceClientPlan`
/// the ledger's class.
#[wasm_bindgen]
pub fn synth_client_construct(s: JsValue, deps: JsValue, kit: JsValue) -> R<()> {
    if absent(&deps) { return Err(js_sys::TypeError::new("Cannot destructure the dependencies of SynthClient: none were given.").into()); }
    for name in ["createWorker", "ortBase", "phonBase", "readModel", "readConfig"] { set(&s, name, &read(&deps, name)?)?; }
    for name in ["readPhonemizerModel", "readRuntimeAssets"] {
        let given = read(&deps, name)?;
        set(&s, name, &if given.is_undefined() { read(&kit, "none")? } else { given })?;
    }
    let on_stage = read(&deps, "onStage")?;
    set(&s, "onStage", &if on_stage.is_undefined() { JsValue::NULL } else { on_stage })?;
    set(&s, "worker", &JsValue::NULL)?;
    set(&s, "plan", &ledger(&kit, &Array::of1(&WORKER_RELEASED.with(|released| released.clone())))?)?;
    set(&s, "calls", &Map::new())?;   // id -> {resolve, reject} for init/load/free
    set(&s, "jobs", &Map::new())?;    // id -> handlers of a running synth
    set(&s, "loaded", &JsValue::NULL)?;  // piperId whose session the worker holds
    set(&s, "ready", &JsValue::NULL)?;   // promise of init
    set(&s, "loading", &JsValue::NULL)?; // {piperId, promise}
    set(&s, "preparationChain", &Promise::resolve(&JsValue::UNDEFINED))?;
    set(&s, "preparations", &Set::new(&JsValue::UNDEFINED))
}

/// `new NativeSynthClient({store, phonBase, env = globalThis, createOrt = createNativeOrt, createPhon = createPhonemizer} = {})`.
#[wasm_bindgen]
pub fn native_client_construct(s: JsValue, deps: JsValue, kit: JsValue) -> R<()> {
    let deps = if deps.is_undefined() { Object::new().into() } else { deps };
    if deps.is_null() { return Err(js_sys::TypeError::new("Cannot destructure the dependencies of NativeSynthClient: they are null.").into()); }
    let or = |value: JsValue, fallback: &dyn Fn() -> R| -> R { if value.is_undefined() { fallback() } else { Ok(value) } };
    let (store, phon_base) = (read(&deps, "store")?, read(&deps, "phonBase")?);
    let env = or(read(&deps, "env")?, &|| Ok(global()))?;
    let create_ort = or(read(&deps, "createOrt")?, &|| read(&kit, "createNativeOrt"))?;
    let create_phon = or(read(&deps, "createPhon")?, &|| read(&kit, "createPhonemizer"))?;
    for (name, value) in [("store", &store), ("phonBase", &phon_base), ("env", &env), ("createOrt", &create_ort), ("createPhon", &create_phon)] { set(&s, name, value)?; }
    // `kernels`: this realm synthesises, so the ledger's ready() also brings the voice module in.
    set(&s, "plan", &ledger(&kit, &Array::of3(&VOICE_RELEASED.with(|released| released.clone()), &Object::new(), &JsValue::TRUE))?)?;
    set(&s, "jobs", &Map::new())?;
    for name in ["loading", "loaded", "config", "ort"] { set(&s, name, &JsValue::NULL)?; }
    set(&s, "chain", &Promise::resolve(&JsValue::UNDEFINED))?;
    set(&s, "preparationChain", &Promise::resolve(&JsValue::UNDEFINED))
}
