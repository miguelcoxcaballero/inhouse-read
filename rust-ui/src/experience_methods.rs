//! The methods of the reading experience (reader-experience.js `ReaderExperience`), answered here:
//! the ones Rust decides (reader_experience_policy.rs) get the experience (`host`) and the doorways
//! of `kit`; the rest hand the call to the part of the experience that owns it (its lifecycle,
//! preference and voice flows, actions, view and navigation queue), with the defaults the
//! JavaScript methods had. The constructor, the methods that close over a navigation step and the
//! layout syncs its resize observers call (possibly every frame of a resize) stay with the class.
use js_sys::Array;
use wasm_bindgen::{prelude::*, JsCast};
use crate::host::{get, method, read, set};
use crate::reader_experience_policy::*;

/// `host[part][name](...args)`.
fn part(host: &JsValue, owner: &str, name: &str, args: &[&JsValue]) -> Result<JsValue, JsValue> { method(&read(host, owner)?, name, args) }
fn or(value: JsValue, fallback: impl FnOnce() -> Result<JsValue, JsValue>) -> Result<JsValue, JsValue> {
    if value.is_undefined() { fallback() } else { Ok(value) }
}

/// `ReaderExperience.prototype[name].apply(host, args)`.
#[wasm_bindgen]
pub fn experience_method(host: JsValue, name: &str, args: Array, kit: JsValue, ui: JsValue) -> Result<JsValue, JsValue> {
    let a = |index: u32| args.get(index);
    let k = |path: &str| crate::voice_methods::kit_value(&kit, path);
    let the_kit = || read(&kit, "experience");
    let done = |result: Result<(), JsValue>| result.map(|_| JsValue::UNDEFINED);
    let quiet = |result: Result<JsValue, JsValue>| result.map(|_| JsValue::UNDEFINED);
    match name {
        "resetAppearance" => done(reader_experience_reset_appearance(&host, &k("preferences.normalizeReadingPreferences")?)),
        "rotateReading" => reader_experience_rotate(host),
        "open" => reader_experience_open(&host, &a(0), &the_kit()?),
        "relocate" => done(reader_experience_relocate(&host, &k("state.clonePlace")?)),
        "readingMetrics" => reader_experience_metrics(&host),
        "updateReadingMetrics" => done(reader_experience_update_metrics(&host)),
        "label" => reader_experience_label(&host, &a(0)),
        "showTab" => done(reader_experience_show_tab(&host, &a(0))),
        "showPlaceTab" => done(reader_experience_place_tab(&host, &a(0))),
        // updateMiniPlayer(state = this.voice?.state, message = '')
        "updateMiniPlayer" => {
            let state = or(a(0), || Ok(get(&read(&host, "voice")?, "state")))?;
            let message = or(a(1), || Ok(JsValue::from_str("")))?;
            done(reader_experience_mini_player(&host, &state, &message, &the_kit()?))
        }
        "updateBookmarkButton" => done(reader_experience_bookmark(&host, &k("places.isBookmarked")?)),
        "queueNavigation" => reader_experience_queue(&host, &a(0), &the_kit()?),
        // returnToReading(index = 0)
        "returnToReading" => reader_experience_return(&host, &or(a(0), || Ok(JsValue::from_f64(0.0)))?, &the_kit()?),
        "shareBook" => reader_experience_share(host, &the_kit()?),
        // formatSize(bytes = 0)
        "formatSize" => reader_experience_size(&or(a(0), || Ok(JsValue::from_f64(0.0)))?),
        "renderPlaces" => done(reader_experience_places(&host, &the_kit()?)),
        "renderToc" => done(reader_experience_toc(&host, &the_kit()?)),
        "updateReturnButton" => done(reader_experience_return_button(&host)),
        // The title written on the spine or the author changed (in the shelf's editor, maybe while
        // this book was already prepared): show them here too.
        "refreshNames" => part(&host, "lifecycle", "refreshNames", &[&a(0), &a(1)]),
        "closeVoice" => done(crate::reader_lifecycle::reader_close_voice(host, k("runtime.neuralEngine")?.unchecked_into())),
        "reset" => part(&host, "lifecycle", "reset", &[]),
        "show" => part(&host, "lifecycle", "show", &[&a(0)]),
        "setSleepChoice" => quiet(part(&host, "view", "setSleepChoice", &[&a(0)])),
        // setPreference(key, value, {restart = true} = {})
        "setPreference" => {
            let options = a(2);
            if options.is_null() { return Err(js_sys::TypeError::new("Cannot destructure property 'restart' of 'object null' as it is null.").into()); }
            let restart = if options.is_undefined() { JsValue::UNDEFINED } else { read(&options, "restart")? };
            part(&host, "preferenceFlow", "set", &[&a(0), &a(1), &or(restart, || Ok(JsValue::TRUE))?])
        }
        // applyPreferences(updateBook = true)
        "applyPreferences" => part(&host, "preferenceFlow", "apply", &[&or(a(0), || Ok(JsValue::TRUE))?]),
        // The language of the open book (the device's when it has none or no book is open).
        "bookLanguage" => part(&host, "voiceFlow", "bookLanguage", &[]),
        // Picking a language: the voice goes back to Automática unless the one in use already speaks it.
        "chooseLanguage" => part(&host, "voiceFlow", "chooseLanguage", &[&a(0)]),
        "voiceBase" => part(&host, "voiceFlow", "voiceBase", &[&a(0)]),
        "populateVoices" => part(&host, "voiceFlow", "populateVoices", &[]),
        // error(message): this.panel.querySelector('.reading-error').textContent = message
        "error" => {
            let target = method(&read(&host, "panel")?, "querySelector", &[&JsValue::from_str(".reading-error")])?;
            if target.is_null() { return Err(js_sys::TypeError::new("Cannot set properties of null (setting 'textContent')").into()); }
            set(&target, "textContent", &a(0))?;
            Ok(JsValue::UNDEFINED)
        }
        "savePlaces" => part(&host, "actions", "savePlaces", &[]),
        "cancelNavigation" => quiet(part(&host, "navigation", "cancel", &[])),
        "addBookmark" => part(&host, "actions", "addBookmark", &[]),
        "addQuote" => part(&host, "actions", "addQuote", &[]),
        "search" => part(&host, "actions", "search", &[&a(0)]),
        "endSearch" => part(&host, "actions", "endSearch", &[]),
        _ => { let _ = ui; Err(js_sys::TypeError::new(&format!("ReaderExperience has no method {name}")).into()) }
    }
}
