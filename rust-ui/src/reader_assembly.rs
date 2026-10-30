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
