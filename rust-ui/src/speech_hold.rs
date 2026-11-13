//! The hold gesture that starts narration at a word, the same in the EPUB iframe and the PDF text
//! layer (was readers/speech-hold.js). A short tap keeps its page/chrome action, including while
//! narration plays: `canLongPress` only probes, `onLongPress` acts. The two handlers are this
//! module's export bound to its document (`ui.speech_hold_event.bind(null, doc, probe)`), so they
//! keep no Rust closure alive and are collected with the gesture table that holds them. The frozen
//! original is tests/unit/helpers/reference-speech-hold.js; speech-hold-wasm.test.js compares both.
use js_sys::{Function, Object, Reflect};
use wasm_bindgen::{prelude::*, JsCast};
use crate::host::{construct, get, global, method, read, set};

type R<T> = Result<T, JsValue>;

/// One press: `window.dispatchEvent(new CustomEvent('inhouse-speech-hold', {detail}))`, answered by
/// whatever a listener left in `detail.handled`.
#[wasm_bindgen]
pub fn speech_hold_event(doc: &JsValue, probe: &JsValue, event: &JsValue) -> R<JsValue> {
    let detail: JsValue = Object::new().into();
    set(&detail, "doc", doc)?;
    set(&detail, "x", &read(event, "clientX")?)?;
    set(&detail, "y", &read(event, "clientY")?)?;
    set(&detail, "probe", probe)?;
    set(&detail, "handled", &JsValue::FALSE)?;
    let init: JsValue = Object::new().into();
    set(&init, "detail", &detail)?;
    if !Reflect::has(&global(), &"window".into())? { return Err(js_sys::ReferenceError::new("window is not defined").into()); }
    let window = get(&global(), "window");
    // The member is read before its argument is built, as in the call expression it replaces.
    let dispatch: Function = read(&window, "dispatchEvent")?.dyn_into()
        .map_err(|_| JsValue::from(js_sys::TypeError::new("window.dispatchEvent is not a function")))?;
    dispatch.call1(&window, &construct("CustomEvent", &[&"inhouse-speech-hold".into(), &init])?)?;
    Reflect::get(&detail, &"handled".into())
}

/// `{canLongPress, onLongPress}` for the gestures of `doc`; `ui` is this module's exports.
#[wasm_bindgen]
pub fn speech_hold(ui: &JsValue, doc: &JsValue) -> R<JsValue> {
    let handler = read(ui, "speech_hold_event")?;
    let hold: JsValue = Object::new().into();
    set(&hold, "canLongPress", &method(&handler, "bind", &[&JsValue::NULL, doc, &JsValue::TRUE])?)?;
    set(&hold, "onLongPress", &method(&handler, "bind", &[&JsValue::NULL, doc, &JsValue::FALSE])?)?;
    Ok(hold)
}
