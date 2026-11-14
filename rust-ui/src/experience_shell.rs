//! What the constructor of the reading experience (reader-experience.js `ReaderExperience`) did after
//! its class fields: its state, the panel and its parts, the selection listeners, the voice session,
//! the controls and the two menus, in the order the JavaScript constructor ran them. The callbacks it
//! hands out are bound exports of this module (`bound`): the page owns them, so nothing here has to
//! be kept alive or freed. The frozen original is tests/unit/helpers/reference-reader-experience-shell.js.
use js_sys::{Array, Function, Reflect};
use wasm_bindgen::{prelude::*, JsCast};
use web_sys::Element;
use crate::host::{absent, construct, get, global, method, read, set};
use crate::reader_experience_policy::{bound, reader_experience_init, reader_experience_remember_selection, reader_experience_selection_init};
use crate::voice_methods::kit_value;

type R<T = JsValue> = Result<T, JsValue>;

fn element(host: &JsValue, name: &str) -> R<Element> { Ok(read(host, name)?.unchecked_into()) }
/// `target[name].bind(target)`.
fn own(target: &JsValue, name: &str) -> R<Function> { Ok(read(target, name)?.unchecked_into::<Function>().bind(target)) }
fn listen(target: &JsValue, kind: &str, callback: &Function) -> R<()> { method(target, "addEventListener", &[&JsValue::from_str(kind), callback.as_ref()]).map(drop) }

/// `event => reader_experience_remember_selection(host, event.detail)`.
#[wasm_bindgen]
pub fn reader_experience_selection_event(host: &JsValue, event: &JsValue) -> R<()> { reader_experience_remember_selection(host, &read(event, "detail")?) }
/// `(state, message) => host.chrome.voiceState(state, message)`.
#[wasm_bindgen]
pub fn reader_experience_voice_state(host: &JsValue, state: &JsValue, message: &JsValue) -> R { method(&read(host, "chrome")?, "voiceState", &[state, message]) }
/// `value => host.chooseLanguage(value)`.
#[wasm_bindgen]
pub fn reader_experience_language_chosen(host: &JsValue, value: &JsValue) -> R { method(host, "chooseLanguage", &[value]) }
/// `value => host.setPreference('voice', value)`.
#[wasm_bindgen]
pub fn reader_experience_voice_chosen(host: &JsValue, value: &JsValue) -> R { method(host, "setPreference", &[&JsValue::from_str("voice"), value]) }
/// `() => host`, where the browser has no WeakRef.
#[wasm_bindgen]
pub fn reader_experience_self(host: JsValue) -> JsValue { host }

/// The body of `new ReaderExperience(reader, { persist, onLengthMetadata })`, after the class fields.
/// `kit` is the table the experience's methods are answered with, plus the two classes it builds.
#[wasm_bindgen]
pub fn reader_experience_construct(host: JsValue, reader: JsValue, persist: JsValue, on_length_metadata: JsValue, kit: JsValue, ui: JsValue) -> R<()> {
    set(&host, "reader", &reader)?;
    set(&host, "persist", &persist)?;
    set(&host, "onLengthMetadata", &on_length_metadata)?;
    reader_experience_init(&host, &kit_value(&kit, "preferences.normalizeReadingPreferences")?)?;
    method(&read(&host, "chrome")?, "create", &[])?;
    let view: JsValue = crate::reader_view::RustReaderView::new(element(&host, "screen")?, element(&host, "panel")?, element(&host, "miniPlayer")?, element(&host, "returnButton")?)?.into();
    set(&host, "view", &view)?;
    set(&host, "lists", &crate::reader_lists::RustReaderLists::new(element(&host, "panel")?)?.into())?;
    if get(&global(), "ResizeObserver").is_function() {
        // The observers call the view's own layout methods (possibly every frame of a resize).
        for (field, sync, observed) in [("miniPlayerResizeObserver", "syncMiniPlayerLayout", "miniPlayer"), ("returnResizeObserver", "syncReturnLayout", "returnButton")] {
            let observer = construct("ResizeObserver", &[own(&view, sync)?.as_ref()])?;
            set(&host, field, &observer)?;
            method(&observer, "observe", &[&read(&host, observed)?])?;
        }
    }
    let (document, window) = (read(&global(), "document")?, read(&global(), "window")?);
    method(&read(&document, "body")?, "append", &[&read(&host, "panel")?])?;
    reader_experience_selection_init(&host)?;
    listen(&document, "selectionchange", &bound(&ui, "reader_experience_selection_changed", &[&host])?)?;
    listen(&window, "inhouse-reader-selection", &bound(&ui, "reader_experience_selection_event", &[&host])?)?;
    let voice = Reflect::construct(read(&kit, "ReadingVoice")?.unchecked_ref(), &Array::of2(&reader, bound(&ui, "reader_experience_voice_state", &[&host])?.as_ref()))?;
    set(&host, "voice", &voice)?;
    // () => host.updateReadingMetrics(), once for everything the voice presents: answered by the dispatcher itself.
    set(&voice, "onProgress", bound(&ui, "experience_method", &[&host, &JsValue::from_str("updateReadingMetrics"), Array::new().as_ref(), &kit, &ui])?.as_ref())?;
    // The Rust controls hold the experience weakly: it owns them, not the reverse.
    let me = if get(&global(), "WeakRef").is_function() { own(&construct("WeakRef", &[&host])?, "deref")? } else { bound(&ui, "reader_experience_self", &[&host])? };
    set(&host, "controls", &crate::reader_controls::RustReaderControls::new(me, element(&host, "panel")?, element(&host, "miniPlayer")?)?.into())?;
    // Idioma first, then the voices of that language. Both are the app's own dropdowns (no operating-system <select>);
    // the downloadable natural voices of the chosen language live at the end of the voice list.
    let panel = read(&host, "panel")?;
    let languages: JsValue = crate::RustSelectMenu::new("Idioma".into(), None, bound(&ui, "reader_experience_language_chosen", &[&host])?)?.into();
    set(&host, "languageMenu", &languages)?;
    let neural = method(&panel, "querySelector", &[&JsValue::from_str("[data-neural]")])?;
    let voices: JsValue = crate::RustSelectMenu::new("Voz".into(), if absent(&neural) { None } else { Some(neural.unchecked_into()) }, bound(&ui, "reader_experience_voice_chosen", &[&host])?)?.into();
    set(&host, "voiceMenu", &voices)?;
    method(&method(&panel, "querySelector", &[&JsValue::from_str("[data-voice-menus]")])?, "append", &[&read(&languages, "root")?, &read(&voices, "root")?])?;
    set(&host, "neuralPicker", &Reflect::construct(read(&kit, "NeuralVoicePicker")?.unchecked_ref(), &Array::of1(&host))?)?;
    method(&host, "populateVoices", &[])?;
    // The panel follows the keyboard: the chrome's own resize, on every visual-viewport event.
    let resize = own(&read(&host, "chrome")?, "resize")?;
    let viewport = read(&window, "visualViewport")?;
    if !absent(&viewport) { listen(&viewport, "resize", &resize)?; listen(&viewport, "scroll", &resize)?; }
    listen(&window, "resize", &resize)?;
    set(&host, "resizePanel", resize.as_ref())
}
