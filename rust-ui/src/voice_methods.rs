//! The methods of the audiobook session (reading-voice.js `ReadingVoice`), answered here: each name
//! hands the session (`host`) and the doorways it needs to its implementation in voice_*.rs, with
//! the defaults the JavaScript methods had. `kit` holds the engine, audio, catalogue, text and
//! timer doorways (read when the method is called, as the methods read them); `ui` is this module's
//! exports, which the callbacks that come back later (an active check, a join, a timer) capture
//! when the method is called, as the original arrow functions did. The frozen originals are
//! tests/unit/helpers/reference-voice-*.js; their former wrapper modules are described in
//! docs/remaining-wip-verification.md.
use js_sys::{Array, Function};
use wasm_bindgen::{prelude::*, JsCast};
use crate::host::{absent, num, read};
use crate::voice_advance::voice_advance;
use crate::voice_ahead::{voice_adopt_plan, voice_clear_ahead, voice_page_valid, voice_prepare_ahead, voice_revalidate_next};
use crate::voice_dispatch::{voice_engine_failed, voice_removed, voice_set_sleep, voice_speak_current, voice_speak_neural};
use crate::voice_join::voice_join_sentence;
use crate::voice_navigation::{voice_browse, voice_continue_page, voice_jump_point, voice_return_audio, voice_seek_point};
use crate::voice_preparation::{voice_prepare, voice_prepare_next, voice_prepare_opening, voice_prepare_playback, voice_refresh_breaks};
use crate::voice_presentation::{voice_engine_ended, voice_engine_started, voice_present, voice_unpaint};
use crate::voice_selection::{voice_audio_item, voice_for, voice_needs_join, voice_upcoming};
use crate::voice_session::{voice_diagnostic, voice_prepare_text};
use crate::voice_start::{voice_play, voice_restart_visible};
use crate::voice_stop::{voice_cancel, voice_fail, voice_pause, voice_restart, voice_retry, voice_stop};

/// A value of the kit by path (`runtime.neuralEngine` reads a module namespace the kit holds, when
/// the method needs it, as the method read its import), unchecked like the arguments it passed.
pub(crate) fn kit_value(kit: &JsValue, path: &str) -> Result<JsValue, JsValue> {
    let mut value = kit.clone();
    for key in path.split('.') { value = read(&value, key)?; }
    Ok(value)
}
pub(crate) fn door(kit: &JsValue, path: &str) -> Result<Function, JsValue> { Ok(kit_value(kit, path)?.unchecked_into()) }
/// `(owner, value) => () => ui[name](owner, value)` without a new closure: `bind` bound to `ui[name]`,
/// so `factory(owner, value)` is `ui[name].bind(null, owner, value)`.
fn active_factory(ui: &JsValue, name: &str) -> Result<Function, JsValue> {
    let check: Function = read(ui, name)?.unchecked_into();
    let bind: Function = read(&check, "bind")?.unchecked_into();
    Ok(bind.bind1(&check, &JsValue::NULL))
}
/// `value === undefined ? fallback : value`, a parameter default.
fn or(value: JsValue, fallback: impl FnOnce() -> Result<JsValue, JsValue>) -> Result<JsValue, JsValue> {
    if value.is_undefined() { fallback() } else { Ok(value) }
}
/// How a `bool` parameter of a generated binding reads a value: ToInt32, then non-zero.
fn int32_flag(value: &JsValue) -> bool {
    if let Some(flag) = value.as_bool() { return flag; }
    if absent(value) { return false; }
    let number = num(value);
    number.is_finite() && (number.trunc() % 4_294_967_296.0) != 0.0
}
/// `{doc, x, y}` destructured from a parameter, failing like the engine for null or undefined.
fn point(value: &JsValue) -> Result<(JsValue, JsValue, JsValue), JsValue> {
    if absent(value) {
        let (of, what) = if value.is_null() { ("object null", "null") } else { ("undefined", "undefined") };
        return Err(js_sys::TypeError::new(&format!("Cannot destructure property 'doc' of '{of}' as it is {what}.")).into());
    }
    Ok((read(value, "doc")?, read(value, "x")?, read(value, "y")?))
}

/// `ReadingVoice.prototype[name].apply(host, args)`.
#[wasm_bindgen]
pub fn voice_method(host: JsValue, name: &str, args: Array, kit: JsValue, ui: JsValue) -> Result<JsValue, JsValue> {
    let a = |index: u32| args.get(index);
    let d = |name: &str| door(&kit, name);
    let done = |result: Result<(), JsValue>| result.map(|_| JsValue::UNDEFINED);
    match name {
        "getDiagnosticState" => voice_diagnostic(host, a(0), d("audio.nativeAudio")?, d("runtime.neuralEngine")?, kit_value(&kit, "document")?),
        "restartFromVisiblePage" => voice_restart_visible(host),
        "play" => voice_play(host, d("runtime.loadNeural")?, d("runtime.neuralEngine")?, d("runtime.unlockNeural")?, d("audio.nativeAudio")?).map(Into::into),
        "speakCurrent" => done(voice_speak_current(host, d("runtime.neuralVoiceList")?, d("catalog.langBase")?, d("catalog.isNeuralId")?, d("now")?, crate::reader_assembly::bound_fn(&ui, "voice_join_later", &[&ui])?)),
        "voiceFor" => voice_for(host, a(0), d("runtime.neuralVoiceList")?, d("catalog.isNeuralId")?, d("catalog.declaredLanguage")?, d("catalog.langBase")?, d("catalog.resolveVoice")?, d("deviceLanguage")?),
        "speakNeural" => voice_speak_neural(host, a(0), a(1), a(2), d("runtime.neuralEngine")?, d("audio.nativeAudio")?, d("clearTimeout")?,
            crate::reader_assembly::bound_fn(&ui, "voice_wait_later", &[&ui])?, crate::reader_assembly::bound_fn(&ui, "voice_synth_failed_later", &[&ui])?).map(Into::into),
        "upcomingFor" => voice_upcoming(host, a(0)),
        "audioItem" => voice_audio_item(a(0)),
        "needsPageJoin" => voice_needs_join(host, a(0), a(1)),
        "joinPageSentence" => done(voice_join_sentence(host, d("add")?)),
        "prepareAhead" => done(voice_prepare_ahead(host, active_factory(&ui, "voice_ahead_active")?, d("runtime.neuralEngine")?)),
        "clearAhead" => done(voice_clear_ahead(host)),
        "engineFailed" => done(voice_engine_failed(host, a(0), d("clearTimeout")?, d("runtime.neuralEngine")?, d("ignore")?)),
        "retryNeural" => done(voice_retry(host)),
        "voiceRemoved" => done(voice_removed(host, a(0))),
        "advance" => voice_advance(host, active_factory(&ui, "voice_advance_active")?, d("sleep")?).map(Into::into),
        // jumpToPoint({doc, x, y} = {}) and seekToPoint({doc, x, y}).
        "jumpToPoint" => { let value = a(0); let (doc, x, y) = if value.is_undefined() { Default::default() } else { point(&value)? }; voice_jump_point(host, doc, x, y).map(Into::into) }
        "seekToPoint" => { let (doc, x, y) = point(&a(0))?; voice_seek_point(host, doc, x, y).map(Into::into) }
        "continueFromPage" => voice_continue_page(host, a(0)).map(Into::into),
        "browse" => done(voice_browse(host, d("add")?)),
        "returnToAudio" => voice_return_audio(host).map(Into::into),
        "refreshPageBreaks" => voice_refresh_breaks(host, d("runtime.neuralEngine")?).map(Into::into),
        "prepare" => voice_prepare(host, a(0), int32_flag(&a(1)), d("speech.planSpeech")?, d("speech.firstCompleteSentenceOffset")?).map(Into::into),
        "prepareOpening" => voice_prepare_opening(host).map(Into::into),
        "preparePlayback" => { let active = or(a(0), || Ok(d("always")?.into()))?; voice_prepare_playback(host, active.unchecked_into(), d("runtime.neuralEngine")?).map(Into::into) }
        "prepareNext" => voice_prepare_next(host, a(0), active_factory(&ui, "voice_next_active")?).map(Into::into),
        "pagePlanValid" => Ok(voice_page_valid(a(0)).into()),
        "revalidateNext" => voice_revalidate_next(host, a(0), a(1)).map(Into::into),
        "adopt" => done(voice_adopt_plan(host, a(0))),
        "engineStarted" => done(voice_engine_started(host, a(0), d("clearTimeout")?, d("audio.nativeAudio")?)),
        "engineEnded" => done(voice_engine_ended(host, a(0))),
        // present(id = this.utteranceId, offset = 0)
        "present" => {
            let id = or(a(0), || read(&host, "utteranceId"))?;
            let offset = or(a(1), || Ok(JsValue::from_f64(0.0)))?;
            done(voice_present(host, id, offset, d("clearTimeout")?, d("ignore")?))
        }
        "unpaint" => done(voice_unpaint(host, d("clearTimeout")?)),
        "restart" => done(voice_restart(host)),
        // cancelUtterance(reason = 'stop')
        "cancelUtterance" => { let reason = or(a(0), || Ok(JsValue::from_str("stop")))?; done(voice_cancel(host, reason, d("clearTimer")?, d("audio.nativeAudio")?, d("runtime.neuralEngine")?)) }
        "prepareText" => voice_prepare_text(host, a(0)),
        "pause" => done(voice_pause(host)),
        "stop" => done(voice_stop(host, d("clearTimer")?)),
        "fail" => done(voice_fail(host, a(0))),
        "setSleep" => done(voice_set_sleep(host, a(0), d("clearTimeout")?, crate::reader_assembly::bound_fn(&ui, "voice_sleep_later", &[&ui])?)),
        _ => Err(js_sys::TypeError::new(&format!("ReadingVoice has no method {name}")).into()),
    }
}
