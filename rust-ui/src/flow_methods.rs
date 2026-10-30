//! The methods of the reading experience's parts (reader-lifecycle.js, preference-flow.js,
//! voice-flow.js, reader-chrome.js), answered here over the experience they belong to
//! (`host.host`); `kit.part` says which part is asking. The defaults and argument conversions are
//! the ones their JavaScript methods and generated bindings applied.
use js_sys::Array;
use wasm_bindgen::{prelude::*, JsCast};
use crate::host::{absent, num, read, text_value};

use crate::voice_methods::{door, kit_value};
/// How a `bool` parameter of a generated binding reads a value: ToInt32, then non-zero.
fn int32_flag(value: &JsValue) -> bool {
    if let Some(flag) = value.as_bool() { return flag; }
    if absent(value) { return false; }
    let number = num(value);
    number.is_finite() && (number.trunc() % 4_294_967_296.0) != 0.0
}

/// `Part.prototype[name].apply(part, args)` for the lifecycle, preference, voice and chrome parts.
#[wasm_bindgen]
pub fn flow_method(part: JsValue, name: &str, args: Array, kit: JsValue, _ui: JsValue) -> Result<JsValue, JsValue> {
    let host = read(&part, "host")?;
    let a = |index: u32| args.get(index);
    let d = |name: &str| door(&kit, name);
    let done = |result: Result<(), JsValue>| result.map(|_| JsValue::UNDEFINED);
    let which = read(&kit, "part")?.as_string().unwrap_or_default();
    match (which.as_str(), name) {
        ("lifecycle", "refreshNames") => done(crate::reader_lifecycle::reader_refresh_names(host, a(0), a(1))),
        ("lifecycle", "open") => crate::reader_lifecycle::reader_open(host, a(0), d("state.cleanPlaces")?, d("state.cleanQuotes")?).map(Into::into),
        ("lifecycle", "closeVoice") => done(crate::reader_lifecycle::reader_close_voice(host, d("runtime.neuralEngine")?)),
        ("lifecycle", "reset") => done(crate::reader_lifecycle::reader_reset(host)),
        ("lifecycle", "show") => done(crate::reader_lifecycle::reader_show(host, a(0))),
        ("preferences", "set") => {
            let key = text_value(&a(0)).as_string().unwrap_or_default();
            done(crate::preference_flow::reader_set_preference(host, key, a(1), int32_flag(&a(2)), d("normalize")?, d("notify")?))
        }
        ("preferences", "apply") => crate::preference_flow::reader_apply_preferences(host, int32_flag(&a(0)), kit_value(&kit, "preferences.READING_THEMES")?, d("store")?).map(Into::into),
        ("voices", "bookLanguage") => crate::voice_flow::reader_book_language(host, d("device")?),
        ("voices", "chooseLanguage") => done(crate::voice_flow::reader_choose_language(host, a(0), d("catalog.langBase")?)),
        ("voices", "voiceBase") => crate::voice_flow::reader_voice_base(host, a(0).unchecked_into(), d("catalog.langBase")?, d("catalog.declaredLanguage")?),
        ("voices", "populateVoices") => done(crate::voice_flow::reader_populate_voices(host, d("runtime.neuralVoiceList")?, d("device")?, d("catalog.langBase")?, d("menus.languageOptions")?, d("menus.voiceOptions")?)),
        ("chrome", "voiceState") => done(crate::reader_chrome::reader_voice_state(host, a(0), a(1), kit_value(&kit, "document")?.unchecked_into())),
        _ => Err(js_sys::TypeError::new(&format!("The reader's {which} part has no method {name}")).into()),
    }
}
