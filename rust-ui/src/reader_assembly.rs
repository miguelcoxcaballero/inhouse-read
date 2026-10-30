//! How the reading experience is put together (reader-experience.js `ReaderExperience`, its
//! natural-voice picker and its audiobook session): the constructors, which build the parts, wire
//! the panel, the menus and the window listeners, and the navigation steps queued for later. Every
//! callback that comes back later is one of this module's exports bound to its state
//! (`ui[name].bind(null, ...)`), so no Rust closure is kept alive and each one is collected with
//! the experience, as the arrow functions they replace were. The classes the constructors build
//! come in `parts` (the JavaScript imports, so a test that replaces a module still replaces it),
//! and the callbacks that may run on every frame of a resize, of a viewport scroll or of a spoken
//! word stay arrows made there (`parts.syncMini`, `parts.syncReturn`, `parts.resize`,
//! `parts.progress`).
use js_sys::{Array, Function, Object, Reflect};
use wasm_bindgen::{prelude::*, JsCast};
use crate::host::{call, get, global, method, read, set};

type R<T> = Result<T, JsValue>;

/// `ui[name].bind(null, ...args)`: a callback that runs one of this module's exports.
pub(crate) fn bound(ui: &JsValue, name: &str, args: &[&JsValue]) -> R<JsValue> {
    let function = read(ui, name)?;
    let list = Array::new();
    list.push(&JsValue::NULL);
    for argument in args { list.push(argument); }
    let bind: Function = read(&function, "bind")?.dyn_into().map_err(|_| JsValue::from(js_sys::TypeError::new("bind is not a function")))?;
    bind.apply(&function, &list)
}
/// `new parts[name](...args)`.
fn build(parts: &JsValue, name: &str, args: &[&JsValue]) -> R<JsValue> {
    let class: Function = read(parts, name)?.dyn_into().map_err(|_| JsValue::from(js_sys::TypeError::new(&format!("{name} is not a constructor"))))?;
    let list = Array::new();
    for argument in args { list.push(argument); }
    Reflect::construct(&class, &list)
}
fn window() -> JsValue { get(&global(), "window") }
fn document() -> JsValue { get(&global(), "document") }

/// The body of `new ReaderExperience(reader, { persist, onLengthMetadata })`, after its parts
/// (chrome, lifecycle, voice and preference flows, actions, navigation queue) were created by the
/// class fields: the reading state and panel, the view and lists over it, the layout observers,
/// the quote selection, the audiobook session, the controls, the Idioma and Voz menus (the app's
/// own dropdowns, no operating-system <select>; the downloadable natural voices of the chosen
/// language live at the end of the voice list), the natural-voice picker and the panel's resize.
#[wasm_bindgen]
pub fn reader_experience_construct(host: &JsValue, reader: &JsValue, persist: &JsValue, on_length_metadata: &JsValue, parts: &JsValue, ui: &JsValue) -> R<()> {
    set(host, "reader", reader)?;
    set(host, "persist", persist)?;
    set(host, "onLengthMetadata", on_length_metadata)?;
    crate::reader_experience_policy::reader_experience_init(host, &read(parts, "normalize")?)?;
    method(&read(host, "chrome")?, "create", &[])?;
    set(host, "view", &build(parts, "ReaderView", &[&read(host, "screen")?, &read(host, "panel")?, &read(host, "miniPlayer")?, &read(host, "returnButton")?])?)?;
    set(host, "lists", &build(parts, "ReaderLists", &[&read(host, "panel")?])?)?;
    if get(&global(), "ResizeObserver").is_function() {
        let observer = crate::host::construct("ResizeObserver", &[&call(&read(parts, "syncMini")?, "syncMini", &[host])?])?;
        set(host, "miniPlayerResizeObserver", &observer)?;
        method(&read(host, "miniPlayerResizeObserver")?, "observe", &[&read(host, "miniPlayer")?])?;
        let observer = crate::host::construct("ResizeObserver", &[&call(&read(parts, "syncReturn")?, "syncReturn", &[host])?])?;
        set(host, "returnResizeObserver", &observer)?;
        method(&read(host, "returnResizeObserver")?, "observe", &[&read(host, "returnButton")?])?;
    }
    method(&read(&document(), "body")?, "append", &[&read(host, "panel")?])?;
    crate::reader_experience_policy::reader_experience_selection_init(host)?;
    method(&document(), "addEventListener", &[&"selectionchange".into(), &bound(ui, "reader_experience_selection_changed", &[host])?])?;
    method(&window(), "addEventListener", &[&"inhouse-reader-selection".into(), &bound(ui, "reader_experience_selection_event", &[host])?])?;
    set(host, "voice", &build(parts, "ReadingVoice", &[reader, &bound(ui, "reader_experience_voice_state", &[host])?])?)?;
    set(&read(host, "voice")?, "onProgress", &call(&read(parts, "progress")?, "progress", &[host])?)?;
    set(host, "controls", &build(parts, "ReaderControls", &[host])?)?;
    let options: JsValue = Object::new().into();
    set(&options, "label", &"Idioma".into())?;
    set(&options, "onChange", &bound(ui, "reader_experience_menu_choice", &[host, &"language".into()])?)?;
    set(host, "languageMenu", &build(parts, "SelectMenu", &[&options])?)?;
    let options: JsValue = Object::new().into();
    set(&options, "label", &"Voz".into())?;
    set(&options, "extra", &method(&read(host, "panel")?, "querySelector", &[&"[data-neural]".into()])?)?;
    set(&options, "onChange", &bound(ui, "reader_experience_menu_choice", &[host, &"voice".into()])?)?;
    set(host, "voiceMenu", &build(parts, "SelectMenu", &[&options])?)?;
    let menus = method(&read(host, "panel")?, "querySelector", &[&"[data-voice-menus]".into()])?;
    method(&menus, "append", &[&read(&read(host, "languageMenu")?, "root")?, &read(&read(host, "voiceMenu")?, "root")?])?;
    set(host, "neuralPicker", &build(parts, "NeuralVoicePicker", &[host])?)?;
    method(host, "populateVoices", &[])?;
    let resize = call(&read(parts, "resize")?, "resize", &[host])?;
    let viewport = read(&window(), "visualViewport")?;
    crate::host::method_opt(&viewport, "addEventListener", &[&"resize".into(), &resize])?;
    let viewport = read(&window(), "visualViewport")?;
    crate::host::method_opt(&viewport, "addEventListener", &[&"scroll".into(), &resize])?;
    method(&window(), "addEventListener", &[&"resize".into(), &resize])?;
    set(host, "resizePanel", &resize)
}

/// A quote selection announced by a reader: remembered for the panel's Citar.
#[wasm_bindgen]
pub fn reader_experience_selection_event(host: &JsValue, event: &JsValue) -> R<()> {
    crate::reader_experience_policy::reader_experience_remember_selection(host, &read(event, "detail")?)
}

/// The audiobook session's state, shown by the chrome.
#[wasm_bindgen]
pub fn reader_experience_voice_state(host: &JsValue, state: &JsValue, message: &JsValue) -> R<JsValue> {
    method(&read(host, "chrome")?, "voiceState", &[state, message])
}

/// A choice in the Idioma menu (`chooseLanguage(value)`) or the Voz menu (`setPreference('voice', value)`).
#[wasm_bindgen]
pub fn reader_experience_menu_choice(host: &JsValue, menu: &str, value: &JsValue) -> R<JsValue> {
    if menu == "language" { method(host, "chooseLanguage", &[value]) } else { method(host, "setPreference", &[&"voice".into(), value]) }
}

/// `jump(place, target)`: the jump runs on the navigation queue, with the queue's check of whether it is still current.
#[wasm_bindgen]
pub fn reader_experience_jump(host: &JsValue, place: &JsValue, target: &JsValue, ui: &JsValue) -> R<JsValue> {
    method(host, "queueNavigation", &[&bound(ui, "reader_experience_jump_run", &[host, place, target])?])
}
#[wasm_bindgen]
pub fn reader_experience_jump_run(host: &JsValue, place: &JsValue, target: &JsValue, current: &JsValue) -> R<JsValue> {
    method(&read(host, "actions")?, "jump", &[place, target, current])
}

/// `step(direction)`: consult another page without moving the independent audible cursor.
#[wasm_bindgen]
pub fn reader_experience_step(host: &JsValue, direction: &JsValue, ui: &JsValue) -> R<JsValue> {
    method(host, "queueNavigation", &[&bound(ui, "reader_experience_step_run", &[host, direction, ui])?])
}
#[wasm_bindgen]
pub fn reader_experience_step_run(host: &JsValue, direction: &JsValue, ui: &JsValue) -> R<JsValue> {
    method(&read(host, "voice")?, "continueFromPage", &[&bound(ui, "reader_experience_page_step", &[host, direction])?])
}

/// A bound export (see `bound`) as the function type the callee expects.
pub(crate) fn bound_fn(ui: &JsValue, name: &str, args: &[&JsValue]) -> R<Function> { Ok(bound(ui, name, args)?.unchecked_into()) }
/// A function that does nothing, for promise handlers that only mean "carry on".
fn noop() -> JsValue {
    thread_local! { static NOOP: JsValue = Closure::<dyn FnMut()>::new(|| {}).into_js_value(); }
    NOOP.with(JsValue::clone)
}
/// `globalThis[name](...args)` with the global object as `this`, as a bare call of a global function.
fn global_call(name: &str, args: &[&JsValue]) -> R<JsValue> {
    let function: Function = read(&global(), name)?.dyn_into().map_err(|_| JsValue::from(js_sys::TypeError::new(&format!("{name} is not a function"))))?;
    let list = Array::new();
    for argument in args { list.push(argument); }
    function.apply(&global(), &list)
}

// --- The natural-voice picker (neural-picker.js `NeuralVoicePicker`) -------------------------------------------------

/// `new NeuralVoicePicker(host)`: its download and error records, its view over the panel, and the
/// clicks of the list, the first-use offer and Reintentar.
#[wasm_bindgen]
pub fn picker_construct(owner: &JsValue, host: &JsValue, ui: &JsValue) -> R<()> {
    set(owner, "host", host)?;
    set(owner, "tasks", &js_sys::Map::new())?; // voice id -> AbortController of the download this page started
    set(owner, "errors", &js_sys::Map::new())?; // voice id -> message of the last failed download
    set(owner, "engine", &JsValue::NULL)?;
    set(owner, "signature", &"".into())?;
    set(owner, "frame", &0.into())?;
    set(owner, "warmGeneration", &0.into())?;
    set(owner, "warmHandle", &JsValue::NULL)?;
    let panel = read(host, "panel")?;
    let view: Function = read(ui, "RustNeuralView")?.dyn_into().map_err(|_| JsValue::from(js_sys::TypeError::new("RustNeuralView is not a constructor")))?;
    set(owner, "view", &Reflect::construct(&view, &Array::of1(&panel))?)?;
    set(owner, "block", &method(&panel, "querySelector", &[&"[data-neural]".into()])?)?;
    set(owner, "offer", &method(&panel, "querySelector", &[&"[data-neural-offer]".into()])?)?;
    for root in [read(owner, "block")?, read(owner, "offer")?] {
        method(&root, "addEventListener", &[&"click".into(), &bound(ui, "picker_click_event", &[owner])?])?;
    }
    let retry = method(&panel, "querySelector", &[&"[data-neural-retry]".into()])?;
    method(&retry, "addEventListener", &[&"click".into(), &bound(ui, "picker_retry", &[owner, host])?])?;
    Ok(())
}
#[wasm_bindgen]
pub fn picker_click_event(owner: &JsValue, event: &JsValue) -> R<JsValue> { method(owner, "click", &[event]) }
/// Reintentar: give the natural voice another chance, play, and repaint the list.
#[wasm_bindgen]
pub fn picker_retry(owner: &JsValue, host: &JsValue) -> R<()> {
    for name in ["retryNeural", "play"] {
        let voice = read(host, "voice")?;
        if !crate::host::absent(&read(&voice, name)?) { method(&voice, name, &[])?; }
    }
    method(owner, "render", &[])?;
    Ok(())
}
/// The engine module is scheduled for an idle moment once a book opens (nothing loads at app start).
#[wasm_bindgen]
pub fn picker_schedule(ui: &JsValue, owner: &JsValue, context: &JsValue) -> R<JsValue> {
    let run = bound(ui, "picker_warm_fire", &[owner, context])?;
    let handle: JsValue = Object::new().into();
    if get(&global(), "requestIdleCallback").is_function() {
        let options: JsValue = Object::new().into();
        set(&options, "timeout", &2500.into())?;
        set(&handle, "idle", &JsValue::TRUE)?;
        set(&handle, "id", &global_call("requestIdleCallback", &[&run, &options])?)?;
    } else {
        set(&handle, "idle", &JsValue::FALSE)?;
        set(&handle, "id", &crate::host::set_timeout(&run, 800.0)?)?;
    }
    Ok(handle)
}
/// The engine module loaded (or not): the picker attaches to it if the request is still current.
#[wasm_bindgen]
pub fn picker_load(ui: &JsValue, kit: &JsValue, owner: &JsValue, context: &JsValue, value: &JsValue) -> R<JsValue> {
    let loading = call(&crate::voice_methods::kit_value(kit, "runtime.loadNeural")?, "loadNeural", &[])?;
    method(&loading, "then", &[&bound(ui, "picker_loaded", &[owner, context, value])?, &noop()])
}
/// The engine's change (installed set) and status (speaking) events.
#[wasm_bindgen]
pub fn picker_listen(ui: &JsValue, kit: &JsValue, owner: &JsValue, engine: &JsValue) -> R<()> {
    method(engine, "addEventListener", &[&"change".into(), &bound(ui, "picker_changed_event", &[owner])?])?;
    method(engine, "addEventListener", &[&"status".into(), &bound(ui, "picker_engine_status", &[owner, engine, &read(kit, "writeUsed")?])?])?;
    Ok(())
}
#[wasm_bindgen]
pub fn picker_changed_event(owner: &JsValue) -> R<JsValue> { method(owner, "changed", &[]) }
/// Re-read what is installed (a failing refresh still lets the warm-up decide).
#[wasm_bindgen]
pub fn picker_engine_refresh(ui: &JsValue, owner: &JsValue, engine: &JsValue, context: &JsValue, value: &JsValue) -> R<JsValue> {
    let refresh = read(engine, "refresh")?;
    let refreshed = if crate::host::absent(&refresh) { JsValue::UNDEFINED } else { method(engine, "refresh", &[])? };
    let settled = method(&js_sys::Promise::resolve(&refreshed), "catch", &[&noop()])?;
    method(&settled, "then", &[&bound(ui, "picker_engine_refreshed", &[owner, context, value])?])
}
/// The check a warm-up hands the session: is this warm-up still the current one?
#[wasm_bindgen]
pub fn picker_warm_check_factory(ui: &JsValue, owner: &JsValue, context: &JsValue) -> R<JsValue> { bound(ui, "picker_warm_check", &[owner, context]) }
#[wasm_bindgen]
pub fn picker_warm_check(owner: &JsValue, context: &JsValue) -> R<JsValue> { method(owner, "isWarmCurrent", &[context]) }
/// Download progress is painted on the next frame.
#[wasm_bindgen]
pub fn picker_frame(ui: &JsValue, owner: &JsValue) -> R<JsValue> { crate::host::request_frame(&bound(ui, "picker_paint_frame", &[owner])?) }

// --- The audiobook session (reading-voice.js `ReadingVoice`) ---------------------------------------------------------

/// `new ReadingVoice(reader, onState)`: the session's state, the page's audio diagnostics and the
/// window events that steer it (TTS, relayout, hold to read, media controls).
#[wasm_bindgen]
pub fn voice_construct(owner: &JsValue, reader: &JsValue, on_state: &JsValue, kit: &JsValue, ui: &JsValue) -> R<()> {
    crate::voice_session::voice_initialize(owner.clone(), reader.clone(), on_state.clone())?;
    set(&window(), "InhouseReadAudioDiagnostics", &bound(ui, "voice_diagnostics", &[owner])?)?;
    let _ = (|| -> R<JsValue> { method(&read(&global(), "localStorage")?, "removeItem", &[&"inhouse-read-neural-slow".into()]) })(); // obsolete preference
    for kind in ["inhouse-tts", "inhouse-speech-layout", "inhouse-speech-hold", "inhouse-audio-control"] {
        method(&window(), "addEventListener", &[&kind.into(), &bound(ui, "voice_window_event", &[owner, &kind.into(), kit])?])?;
    }
    Ok(())
}
#[wasm_bindgen]
pub fn voice_diagnostics(owner: &JsValue, session: &JsValue) -> R<JsValue> { method(owner, "getDiagnosticState", &[session]) }
#[wasm_bindgen]
pub fn voice_window_event(owner: &JsValue, kind: String, kit: &JsValue, event: &JsValue) -> R<()> {
    let pcm = crate::voice_methods::kit_value(kit, "audio.nativePcmBridge")?;
    crate::voice_session::voice_event(owner.clone(), kind, read(event, "detail")?, pcm.unchecked_into())
}
/// A sentence joined across the page break is spoken once its next page is ready.
#[wasm_bindgen]
pub fn voice_join_later(ui: &JsValue, owner: &JsValue, promise: &JsValue, generation: &JsValue, index: &JsValue) -> R<()> {
    method(promise, "then", &[&bound(ui, "voice_join_ready", &[owner, generation, index])?])?;
    Ok(())
}
/// The engine has 900 ms to start an utterance.
#[wasm_bindgen]
pub fn voice_wait_later(ui: &JsValue, owner: &JsValue, id: &JsValue) -> R<JsValue> { crate::host::set_timeout(&bound(ui, "voice_wait_started", &[owner, id])?, 900.0) }
/// A synthesis that could not start fails after the current task, like the engine's own failures.
#[wasm_bindgen]
pub fn voice_synth_failed_later(ui: &JsValue, owner: &JsValue, id: &JsValue) -> R<JsValue> { global_call("queueMicrotask", &[&bound(ui, "voice_synth_failed", &[owner, id])?]) }
#[wasm_bindgen]
pub fn voice_synth_failed(owner: &JsValue, id: &JsValue) -> R<JsValue> {
    let failure: JsValue = Object::new().into();
    set(&failure, "id", id)?;
    set(&failure, "reason", &"synth-failed".into())?;
    method(owner, "engineFailed", &[&failure])
}
/// The sleep timer.
#[wasm_bindgen]
pub fn voice_sleep_later(ui: &JsValue, owner: &JsValue, ms: &JsValue) -> R<JsValue> {
    global_call("setTimeout", &[&bound(ui, "voice_sleep_expired", &[owner])?, ms])
}
