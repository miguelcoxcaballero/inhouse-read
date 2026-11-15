//! The parts of the reading experience: its chrome, lifecycle, voice and preference flows and its
//! actions. They were five JavaScript classes (reader-chrome.js, reader-lifecycle.js, voice-flow.js,
//! preference-flow.js, reader-actions.js), each a `host` and methods that called back into this
//! module. `reader_part` builds the same objects: `host` first, then the callbacks the class kept as
//! fields, then its methods, every one a bound export, so the page owns them and nothing here is
//! kept alive or freed. `flow_method` answers the methods of the lifecycle, the two flows and the
//! chrome's audio state with the defaults and argument conversions their JavaScript methods and
//! generated bindings applied. The frozen originals are tests/unit/helpers/reference-reader-parts.js.
use js_sys::{Function, Object, Promise, Reflect};
use wasm_bindgen::{prelude::*, JsCast};
use crate::host::{absent, global, method, num, read, set, text_value};
use crate::reader_experience_policy::bound;
use crate::voice_methods::{door, kit_value};

type R<T = JsValue> = Result<T, JsValue>;
/// Where the reading preferences are stored and the name their change is announced with.
const KEY: &str = "inhouse-read-reading-preferences";

/// How a `bool` parameter of a generated binding reads a value: ToInt32, then non-zero.
fn int32_flag(value: &JsValue) -> bool {
    if let Some(flag) = value.as_bool() { return flag; }
    if absent(value) { return false; }
    let number = num(value);
    number.is_finite() && (number.trunc() % 4_294_967_296.0) != 0.0
}
/// What `async function () { return body() }` answers: always a promise, settled by what the body
/// returned (one more turn when that is itself a promise) or rejected with what it threw.
fn asynchronous(body: impl FnOnce() -> R) -> R {
    let result = body();
    Ok(Promise::new(&mut |resolve, reject| {
        let _ = match &result { Ok(value) => resolve.call1(&JsValue::UNDEFINED, value), Err(error) => reject.call1(&JsValue::UNDEFINED, error) };
    }).into())
}

/// `(current, key, value) => preferences.normalizeReadingPreferences({ ...current, [key]: value })`.
#[wasm_bindgen]
pub fn reader_part_normalize(kit: &JsValue, current: &JsValue, key: &JsValue, value: &JsValue) -> R {
    let next = method(&read(&global(), "Object")?, "assign", &[Object::new().as_ref(), current])?;
    let own = Object::new();
    for (name, field) in [("value", value), ("writable", &JsValue::TRUE), ("enumerable", &JsValue::TRUE), ("configurable", &JsValue::TRUE)] { set(&own, name, field)?; }
    Reflect::define_property(next.unchecked_ref(), key, &own)?;
    door(kit, "preferences.normalizeReadingPreferences")?.call1(&JsValue::UNDEFINED, &next)
}
/// `value => localStorage.setItem(KEY, JSON.stringify(value))`.
#[wasm_bindgen]
pub fn reader_part_store(value: &JsValue) -> R {
    let storage = read(&global(), "localStorage")?;
    let text = method(&read(&global(), "JSON")?, "stringify", &[value])?;
    method(&storage, "setItem", &[&JsValue::from_str(KEY), &text])
}
/// `() => navigator.language`.
#[wasm_bindgen]
pub fn reader_part_device() -> R { read(&read(&global(), "navigator")?, "language") }

/// `new Part(host)` for the part `which` of an experience: "chrome", "lifecycle", "voices",
/// "preferences" or "actions". `kit` is the experience's table (its modules), `ui` these exports.
#[wasm_bindgen]
pub fn reader_part(host: &JsValue, which: &str, kit: &JsValue, ui: &JsValue) -> R {
    let part: JsValue = Object::new().into();
    set(&part, "host", host)?;
    let put = |name: &str, export: &str, head: &[&JsValue]| -> R<Function> { let made = bound(ui, export, head)?; set(&part, name, made.as_ref())?; Ok(made) };
    let flow = |names: &[&str]| -> R<()> {
        for name in names { put(name, "flow_method", &[&part, &JsValue::from_str(name), &JsValue::from_str(which), kit, ui])?; }
        Ok(())
    };
    match which {
        "lifecycle" => flow(&["refreshNames", "open", "closeVoice", "reset", "show"])?,
        "preferences" => flow(&["set", "apply"])?,
        "voices" => flow(&["bookLanguage", "chooseLanguage", "voiceBase", "populateVoices"])?,
        "chrome" => {
            let (document, window) = (read(&global(), "document")?, read(&global(), "window")?);
            let reveal = put("reveal", "reader_reveal_field", &[host, &document])?;
            // The panel, the mini player and the return button; then the panel following the keyboard, with one
            // frame asked for when it is open (the listener of every visual-viewport event: one call, no dispatch).
            put("create", "reader_chrome_create", &[host, &kit_value(kit, "preferences.RATE_STEPS")?, &document])?;
            put("resize", "reader_resize_panel", &[host, &window, reveal.as_ref()])?;
            flow(&["voiceState"])?
        }
        "actions" => {
            let state = |name: &str| kit_value(&read(kit, "state")?, name);
            let place = put("place", "reader_action_place", &[host, &state("clonePlace")?])?;
            let fields = put("fields", "reader_action_fields", &[host, &state("cleanPlaces")?, &state("cleanQuotes")?])?;
            let quote = put("quote", "reader_action_quote", &[host])?;
            put("savePlaces", "reader_save_places", &[host, fields.as_ref()])?;
            put("jump", "reader_jump", &[host, place.as_ref()])?;
            put("returnToReading", "reader_return", &[host])?;
            put("addBookmark", "reader_bookmark", &[host, place.as_ref()])?;
            put("addQuote", "reader_quote", &[host, quote.as_ref(), &state("cleanQuotes")?])?;
            put("search", "reader_search", &[host, bound(ui, "reader_search_activate", &[host])?.as_ref()])?;
            put("endSearch", "reader_end_search", &[host])?;
        }
        _ => return Err(js_sys::TypeError::new(&format!("The reader has no part {which}")).into()),
    }
    Ok(part)
}

/// `part[name](a, b, c)` for the lifecycle, preference, voice and chrome parts (`which`).
#[wasm_bindgen]
pub fn flow_method(part: JsValue, name: &str, which: &str, kit: JsValue, ui: JsValue, a: JsValue, b: JsValue, c: JsValue) -> R {
    let host = read(&part, "host")?;
    let d = |name: &str| door(&kit, name);
    let done = |result: R<()>| result.map(|_| JsValue::UNDEFINED);
    let device = || bound(&ui, "reader_part_device", &[]);
    match (which, name) {
        ("lifecycle", "refreshNames") => done(crate::reader_lifecycle::reader_refresh_names(host, a, b)),
        ("lifecycle", "open") => asynchronous(|| crate::reader_lifecycle::reader_open(host, a, d("state.cleanPlaces")?, d("state.cleanQuotes")?).map(Into::into)),
        ("lifecycle", "closeVoice") => done(crate::reader_lifecycle::reader_close_voice(host, d("runtime.neuralEngine")?)),
        ("lifecycle", "reset") => done(crate::reader_lifecycle::reader_reset(host)),
        ("lifecycle", "show") => done(crate::reader_lifecycle::reader_show(host, a)),
        ("preferences", "set") => {
            let key = text_value(&a).as_string().unwrap_or_default();
            let notify = d("notify")?.bind1(&JsValue::UNDEFINED, &JsValue::from_str(KEY));
            done(crate::preference_flow::reader_set_preference(host, key, b, int32_flag(&c), bound(&ui, "reader_part_normalize", &[&kit])?, notify))
        }
        ("preferences", "apply") => asynchronous(|| crate::preference_flow::reader_apply_preferences(host, int32_flag(&a), kit_value(&kit, "preferences.READING_THEMES")?, bound(&ui, "reader_part_store", &[])?).map(Into::into)),
        ("voices", "bookLanguage") => crate::voice_flow::reader_book_language(host, device()?),
        ("voices", "chooseLanguage") => done(crate::voice_flow::reader_choose_language(host, a, d("catalog.langBase")?)),
        ("voices", "voiceBase") => crate::voice_flow::reader_voice_base(host, a.unchecked_into(), d("catalog.langBase")?, d("catalog.declaredLanguage")?),
        ("voices", "populateVoices") => done(crate::voice_flow::reader_populate_voices_catalog(host, d("runtime.neuralVoiceList")?, device()?, kit_value(&kit, "catalog")?)),
        ("chrome", "voiceState") => done(crate::reader_chrome::reader_voice_state(host, a, b, read(&global(), "document")?.unchecked_into())),
        _ => Err(js_sys::TypeError::new(&format!("The reader's {which} part has no method {name}")).into()),
    }
}
