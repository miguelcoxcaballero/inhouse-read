//! The shell of the natural-voice picker (neural-picker.js `NeuralVoicePicker`): what its constructor
//! did, and the doorways its methods used to be handed by a JavaScript kit — the idle and frame
//! schedulers, the engine's listeners, the storage of 'Ahora no' and of the first use. Each callback
//! handed to the browser is a bound export of this module (`bound`), owned by the page.
//! The frozen original is tests/unit/helpers/reference-neural-picker-shell.js.
use js_sys::{Array, Function, Object};
use wasm_bindgen::{prelude::*, JsCast};
use crate::host::{absent, construct, get, global, method, method_opt, read, request_frame, set, set_timeout};
use crate::reader_experience_policy::bound;

type R<T = JsValue> = Result<T, JsValue>;

/// 'Ahora no' means not now: the offer comes back for that language after a while (picker_policy.rs keeps the dates).
const OFFER: &str = "inhouse-read-neural-offer-dismissed";
const USED: &str = "inhouse-read-neural-used";

thread_local! { static NOOP: Closure<dyn FnMut(JsValue)> = Closure::new(|_| {}); }
fn noop() -> JsValue { NOOP.with(|function| function.as_ref().clone()) }
fn storage() -> R { read(&global(), "localStorage") }
fn text(value: &str) -> JsValue { JsValue::from_str(value) }
fn resolved(value: &JsValue) -> R { method(&read(&global(), "Promise")?, "resolve", &[value]) }

/// `() => localStorage.getItem(OFFER)`.
#[wasm_bindgen]
pub fn picker_read_offer() -> R { method(&storage()?, "getItem", &[&text(OFFER)]) }
/// `value => localStorage.setItem(OFFER, value)`.
#[wasm_bindgen]
pub fn picker_write_offer(value: &JsValue) -> R { method(&storage()?, "setItem", &[&text(OFFER), value]) }
/// `() => localStorage.getItem(USED)`.
#[wasm_bindgen]
pub fn picker_read_used() -> R { method(&storage()?, "getItem", &[&text(USED)]) }
/// `() => localStorage.setItem(USED, '1')`.
#[wasm_bindgen]
pub fn picker_write_used() -> R { method(&storage()?, "setItem", &[&text(USED), &text("1")]) }
/// `value => Promise.resolve(value).catch(() => {})`.
#[wasm_bindgen]
pub fn picker_ignore(value: &JsValue) -> R { method(&resolved(value)?, "catch", &[&noop()]) }

/// The engine module is fetched in an idle moment: `{idle, id}` of the callback that will run `picker_warm_fire`.
#[wasm_bindgen]
pub fn picker_schedule(ui: &JsValue, owner: &JsValue, context: &JsValue) -> R {
    let run = bound(ui, "picker_warm_fire", &[owner, context])?;
    let handle = Object::new();
    let idle = get(&global(), "requestIdleCallback");
    if idle.is_function() {
        let options = Object::new();
        set(&options, "timeout", &JsValue::from_f64(2500.0))?;
        set(&handle, "idle", &JsValue::TRUE)?;
        set(&handle, "id", &idle.unchecked_into::<Function>().call2(&JsValue::UNDEFINED, &run, &options)?)?;
    } else {
        set(&handle, "idle", &JsValue::FALSE)?;
        set(&handle, "id", &set_timeout(run.as_ref(), 800.0)?)?;
    }
    Ok(handle.into())
}
/// `loadNeural().then(() => picker_loaded(owner, context, value), () => {})`.
#[wasm_bindgen]
pub fn picker_load(ui: &JsValue, load_neural: &Function, owner: &JsValue, context: &JsValue, value: &JsValue) -> R {
    let loading = load_neural.call0(&JsValue::UNDEFINED)?;
    method(&loading, "then", &[bound(ui, "picker_loaded", &[owner, context, value])?.as_ref(), &noop()])
}
/// The engine's two events: the installed set or a download moved (`owner.changed()`), and the first time it speaks.
#[wasm_bindgen]
pub fn picker_listen(ui: &JsValue, kit: &JsValue, owner: &JsValue, engine: &JsValue) -> R<()> {
    // `changed` arrives with every chunk of a download: the dispatcher itself answers it, in one visit.
    let changed = bound(ui, "picker_method", &[owner, &text("changed"), Array::new().as_ref(), kit, ui])?;
    method(engine, "addEventListener", &[&text("change"), changed.as_ref()])?;
    let status = bound(ui, "picker_engine_status", &[owner, engine, &read(ui, "picker_write_used")?])?;
    method(engine, "addEventListener", &[&text("status"), status.as_ref()]).map(drop)
}
/// `Promise.resolve(engine.refresh?.()).catch(() => {}).then(() => picker_engine_refreshed(owner, context, value))`.
#[wasm_bindgen]
pub fn picker_engine_refresh(ui: &JsValue, owner: &JsValue, engine: &JsValue, context: &JsValue, value: &JsValue) -> R {
    let refreshed = method_opt(engine, "refresh", &[])?.unwrap_or(JsValue::UNDEFINED);
    let settled = method(&resolved(&refreshed)?, "catch", &[&noop()])?;
    method(&settled, "then", &[bound(ui, "picker_engine_refreshed", &[owner, context, value])?.as_ref()])
}
/// `(owner, context) => () => owner.isWarmCurrent(context)`.
#[wasm_bindgen]
pub fn picker_warm_active(ui: &JsValue, owner: &JsValue, context: &JsValue) -> R<Function> { bound(ui, "picker_still_warm", &[owner, context]) }
#[wasm_bindgen]
pub fn picker_still_warm(owner: &JsValue, context: &JsValue) -> R { method(owner, "isWarmCurrent", &[context]) }
/// `requestAnimationFrame(() => picker_paint_frame(owner))`.
#[wasm_bindgen]
pub fn picker_frame(ui: &JsValue, owner: &JsValue) -> R { request_frame(bound(ui, "picker_paint_frame", &[owner])?.as_ref()) }

/// `event => owner.click(event)`.
#[wasm_bindgen]
pub fn picker_clicked(owner: &JsValue, event: &JsValue) -> R { method(owner, "click", &[event]) }
/// Reintentar: `host.voice.retryNeural?.(); host.voice.play?.(); owner.render()`.
#[wasm_bindgen]
pub fn picker_retry(owner: &JsValue) -> R<()> {
    let host = read(owner, "host")?;
    for name in ["retryNeural", "play"] {
        let voice = read(&host, "voice")?;
        read(&voice, name)?; // a missing voice fails here, as `host.voice.retryNeural` did
        method_opt(&voice, name, &[])?;
    }
    method(owner, "render", &[]).map(drop)
}

/// The body of `new NeuralVoicePicker(host)`. `host` is the ReaderExperience: panel, voice (ReadingVoice),
/// preferences, setPreference() and populateVoices().
#[wasm_bindgen]
pub fn picker_construct(owner: JsValue, host: JsValue, ui: JsValue) -> R<()> {
    set(&owner, "host", &host)?;
    set(&owner, "tasks", &construct("Map", &[])?)?; // voice id -> AbortController of the download this page started
    set(&owner, "errors", &construct("Map", &[])?)?; // voice id -> message of the last failed download
    set(&owner, "engine", &JsValue::NULL)?;
    set(&owner, "signature", &text(""))?;
    set(&owner, "frame", &JsValue::from_f64(0.0))?;
    set(&owner, "warmGeneration", &JsValue::from_f64(0.0))?;
    set(&owner, "warmHandle", &JsValue::NULL)?;
    let panel = read(&host, "panel")?;
    set(&owner, "view", &crate::experience_shell::made(&ui, "RustNeuralView", &[&panel])?)?;
    let query = |selector: &str| method(&panel, "querySelector", &[&text(selector)]);
    let (block, offer) = (query("[data-neural]")?, query("[data-neural-offer]")?);
    set(&owner, "block", &block)?;
    set(&owner, "offer", &offer)?;
    for root in [&block, &offer] { method(root, "addEventListener", &[&text("click"), bound(&ui, "picker_clicked", &[&owner])?.as_ref()])?; }
    let retry = query("[data-neural-retry]")?;
    if absent(&retry) { return Err(js_sys::TypeError::new("Cannot read properties of null (reading 'addEventListener')").into()); }
    method(&retry, "addEventListener", &[&text("click"), bound(&ui, "picker_retry", &[&owner])?.as_ref()]).map(drop)
}
