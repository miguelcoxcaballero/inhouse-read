//! What the constructors of the two voice stores build (store.js `VoiceStore`, supertonic-store.js `SupertonicStore`),
//! the default pause between two attempts of a download, and the one install job of the Supertonic pack. All of it
//! runs once per engine start or once per download.
//!
//! Everything the browser provides is injectable so the logic can be tested without a network or a real cache; a
//! default is read only when its dependency was not given, as a default parameter is. The defaults that need the
//! page's own modules (the voice repository, the bundler's base URL, the Supertonic catalogue) come in `kit`.
//! The functions the browser keeps (a timer, an 'abort' listener, the end of a job) are one closure per realm with no
//! captured state, bound to their arguments with `Function.prototype.bind`: they are collected with what they are
//! bound to, as the arrow functions of the stores were.
//! The frozen originals are tests/unit/helpers/reference-store-shells.js.
use js_sys::{Array, Function, Object, Promise, Reflect};
use wasm_bindgen::prelude::*;
use wasm_bindgen_futures::future_to_promise;
use crate::host::{absent, call, global, method, num, read, set};
use crate::supertonic_store::{supertonic_install, supertonic_manifest};
use crate::voice_store::store_error;

type R<T = JsValue> = Result<T, JsValue>;
fn st(value: &str) -> JsValue { JsValue::from_str(value) }
fn n(value: f64) -> JsValue { JsValue::from_f64(value) }
fn function<F: ?Sized + wasm_bindgen::closure::WasmClosure>(closure: Closure<F>) -> Function { closure.into_js_value().unchecked_into() }
fn aborted() -> JsValue { store_error(st("aborted"), st("aborted"), JsValue::UNDEFINED) }
/// `{ once: true }`.
fn once() -> R { let options: JsValue = Object::new().into(); set(&options, "once", &JsValue::TRUE)?; Ok(options) }
/// `signal?.[name]('abort', listener, options)`.
fn listening(signal: &JsValue, name: &str, listener: &JsValue, options: Option<&JsValue>) -> R<()> {
    if absent(signal) { return Ok(()); }
    match options { Some(options) => method(signal, name, &[&st("abort"), listener, options]), None => method(signal, name, &[&st("abort"), listener]) }.map(drop)
}
/// `globalThis.name?.member`.
fn of_global(name: &str, member: &str) -> R { let owner = read(&global(), name)?; if absent(&owner) { Ok(JsValue::UNDEFINED) } else { read(&owner, member) } }
/// `globalThis.fetch?.bind(globalThis)`.
fn bound_fetch() -> R {
    let fetch = read(&global(), "fetch")?;
    if absent(&fetch) { Ok(JsValue::UNDEFINED) } else { method(&fetch, "bind", &[&global()]) }
}
/// The dependencies object of a constructor whose parameter is `{...} = {}`.
fn dependencies(deps: JsValue, class: &str) -> R {
    if deps.is_undefined() { return Ok(Object::new().into()); }
    if deps.is_null() { return Err(js_sys::TypeError::new(&format!("Cannot destructure the dependencies of {class}: they are null.")).into()); }
    Ok(deps)
}
/// `deps[name]`, or its default when it is undefined.
fn dependency(deps: &JsValue, name: &str, fallback: impl FnOnce() -> R) -> R { let given = read(deps, name)?; if given.is_undefined() { fallback() } else { Ok(given) } }

thread_local! {
    /// `() => globalThis.navigator?.onLine !== false`.
    static ONLINE: Function = function(Closure::<dyn FnMut() -> R<bool>>::new(|| Ok(of_global("navigator", "onLine")? != JsValue::FALSE)));
    static SLEEP: Function = function(Closure::<dyn FnMut(JsValue, JsValue) -> Promise>::new(sleep));
    /// The timer of a pause ran out: `() => { cleanup(); resolve() }`.
    static SLEPT: Function = function(Closure::<dyn FnMut(JsValue) -> R<()>>::new(|pause: JsValue| {
        listening(&read(&pause, "signal")?, "removeEventListener", &read(&pause, "onAbort")?, None)?;
        call(&read(&pause, "resolve")?, "resolve", &[]).map(drop)
    }));
    /// The download was given up during a pause: `() => { clearTimeout(timer); cleanup(); reject(storeError('aborted', 'aborted')) }`.
    static WOKEN: Function = function(Closure::<dyn FnMut(JsValue) -> R<()>>::new(|pause: JsValue| {
        method(&global(), "clearTimeout", &[&read(&pause, "timer")?])?;
        listening(&read(&pause, "signal")?, "removeEventListener", &read(&pause, "onAbort")?, None)?;
        call(&read(&pause, "reject")?, "reject", &[&aborted()]).map(drop)
    }));
    /// `() => controller.abort()`.
    static ABORT: Function = function(Closure::<dyn FnMut(JsValue) -> R<()>>::new(|controller: JsValue| method(&controller, "abort", &[]).map(drop)));
    /// The install job settled: `() => { signal?.removeEventListener('abort', abort); if (this.job === promise) { this.job = null; this.controller = null } }`.
    static INSTALLED: Function = function(Closure::<dyn FnMut(JsValue, JsValue, JsValue, Array) -> R<()>>::new(|s: JsValue, signal: JsValue, abort: JsValue, job: Array| {
        listening(&signal, "removeEventListener", &abort, None)?;
        if read(&s, "job")? == job.get(0) { set(&s, "job", &JsValue::NULL)?; set(&s, "controller", &JsValue::NULL)?; }
        Ok(())
    }));
}

/// The default `sleep(ms, signal)` of a VoiceStore: resolves after `ms`, rejects with the store's 'aborted' error as
/// soon as `signal` aborts, and leaves neither a timer nor a listener behind.
fn sleep(ms: JsValue, signal: JsValue) -> Promise {
    Promise::new(&mut |resolve: Function, reject: Function| {
        let started = (|| -> R<()> {
            if !absent(&signal) && read(&signal, "aborted")?.is_truthy() { reject.call1(&JsValue::UNDEFINED, &aborted())?; return Ok(()); }
            let pause: JsValue = Object::new().into();
            set(&pause, "signal", &signal)?; set(&pause, "resolve", &resolve)?; set(&pause, "reject", &reject)?;
            let on_abort: JsValue = WOKEN.with(|woken| woken.bind1(&JsValue::NULL, &pause)).into();
            set(&pause, "onAbort", &on_abort)?;
            let timer = method(&global(), "setTimeout", &[SLEPT.with(|slept| slept.bind1(&JsValue::NULL, &pause)).as_ref(), &ms])?;
            set(&pause, "timer", &timer)?;
            listening(&signal, "addEventListener", &on_abort, Some(&once()?))
        })();
        if let Err(error) = started { let _ = reject.call1(&JsValue::UNDEFINED, &error); }
    })
}

/// `new VoiceStore({caches = globalThis.caches, fetch = globalThis.fetch?.bind(globalThis), base = () => neuralVoiceBase(),
/// dictionaryBase = () => (the phonemizer folder of this page), storage = globalThis.navigator?.storage, sleep = defaultSleep,
/// maxRetries = 4, online = () => globalThis.navigator?.onLine !== false, stallMs = 20_000} = {})`: `kit.base` and
/// `kit.dictionaryBase` are those two defaults.
#[wasm_bindgen]
pub fn voice_store_construct(s: JsValue, deps: JsValue, kit: JsValue) -> R<()> {
    let deps = dependencies(deps, "VoiceStore")?;
    let caches = dependency(&deps, "caches", || read(&global(), "caches"))?;
    let fetch = dependency(&deps, "fetch", bound_fetch)?;
    let base = dependency(&deps, "base", || read(&kit, "base"))?;
    let dictionary_base = dependency(&deps, "dictionaryBase", || read(&kit, "dictionaryBase"))?;
    let storage = dependency(&deps, "storage", || of_global("navigator", "storage"))?;
    let sleep = dependency(&deps, "sleep", || Ok(SLEEP.with(|sleep| sleep.clone()).into()))?;
    let max_retries = dependency(&deps, "maxRetries", || Ok(n(4.0)))?;
    let online = dependency(&deps, "online", || Ok(ONLINE.with(|online| online.clone()).into()))?;
    let stall_ms = dependency(&deps, "stallMs", || Ok(n(20_000.0)))?;
    for (name, value) in [("caches", caches), ("fetchFn", fetch), ("baseFn", base), ("dictionaryBase", dictionary_base), ("storage", storage), ("sleep", sleep),
        ("maxRetries", max_retries), ("online", online), ("stallMs", stall_ms)] { set(&s, name, &value)?; }
    Ok(())
}

/// `new SupertonicStore({caches = globalThis.caches, fetch = globalThis.fetch?.bind(globalThis), storage = globalThis.navigator?.storage,
/// crypto = globalThis.crypto, base = supertonicBase(), assets = SUPERTONIC_ASSETS,
/// legacyAssets = assets === SUPERTONIC_ASSETS ? SUPERTONIC_LEGACY_ASSETS : [], stallMs = 20000} = {})`: `kit.base` is
/// `supertonicBase`, `kit.assets` and `kit.legacyAssets` the two catalogues.
#[wasm_bindgen]
pub fn supertonic_store_construct(s: JsValue, deps: JsValue, kit: JsValue) -> R<()> {
    let deps = dependencies(deps, "SupertonicStore")?;
    let caches = dependency(&deps, "caches", || read(&global(), "caches"))?;
    let fetch = dependency(&deps, "fetch", bound_fetch)?;
    let storage = dependency(&deps, "storage", || of_global("navigator", "storage"))?;
    let crypto = dependency(&deps, "crypto", || read(&global(), "crypto"))?;
    let base = dependency(&deps, "base", || call(&read(&kit, "base")?, "supertonicBase", &[]))?;
    let assets = dependency(&deps, "assets", || read(&kit, "assets"))?;
    let legacy = dependency(&deps, "legacyAssets", || if assets == read(&kit, "assets")? { read(&kit, "legacyAssets") } else { Ok(Array::new().into()) })?;
    let stall_ms = dependency(&deps, "stallMs", || Ok(n(20000.0)))?;
    for (name, value) in [("caches", &caches), ("fetchFn", &fetch), ("storage", &storage), ("crypto", &crypto), ("base", &base), ("assets", &assets),
        ("legacyAssets", &legacy), ("stallMs", &stall_ms)] { set(&s, name, value)?; }
    // `base + '.inhouse-complete.json'`.
    set(&s, "marker", &(&base + &st(".inhouse-complete.json")))?;
    set(&s, "manifest", &st(&supertonic_manifest(assets, base)?))?;
    set(&s, "job", &JsValue::NULL)?;
    set(&s, "generation", &n(0.0))?;
    set(&s, "controller", &JsValue::NULL)
}

/// `SupertonicStore.prototype.install.call(store, {signal, onProgress = () => {}} = {})`: the one install job of the
/// pack; a second call while it runs gets the same promise. `kit.noop` is that default, `kit.revision` and `kit.url`
/// the pack's revision and where an asset comes from.
#[wasm_bindgen]
pub fn supertonic_store_install(s: JsValue, options: JsValue, kit: JsValue) -> R {
    let options = dependencies(options, "an install")?;
    let signal = read(&options, "signal")?;
    let on_progress = dependency(&options, "onProgress", || read(&kit, "noop"))?;
    let running = read(&s, "job")?;
    if running.is_truthy() { return Ok(running); }
    let controller = Reflect::construct(read(&global(), "AbortController")?.unchecked_ref(), &Array::new())?;
    let generation = read(&s, "generation")?;
    set(&s, "controller", &controller)?;
    let abort: JsValue = ABORT.with(|abort| abort.bind1(&JsValue::NULL, &controller)).into();
    listening(&signal, "addEventListener", &abort, Some(&once()?))?;
    if !absent(&signal) && read(&signal, "aborted")?.is_truthy() { method(&controller, "abort", &[])?; }
    let job = Array::new();
    let install = future_to_promise(supertonic_install(s.clone(), controller, num(&generation), signal.clone(), on_progress, read(&kit, "revision")?, read(&kit, "url")?));
    // The job's own promise is what the end of the job compares with: it is known once `finally` has answered.
    let finished = method(&INSTALLED.with(|installed| installed.clone()).into(), "bind", &[&JsValue::NULL, &s, &signal, &abort, &job])?;
    let promise = method(&install.into(), "finally", &[&finished])?;
    job.push(&promise);
    set(&s, "job", &promise)?;
    Ok(promise)
}
