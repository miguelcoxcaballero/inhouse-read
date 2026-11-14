//! The methods of the natural-voice picker (neural-picker.js `NeuralVoicePicker`), answered here:
//! each name hands the picker (`host`) and the doorways it needs to picker_actions/policy/warm.rs,
//! with the defaults the JavaScript methods had. `kit` holds the engine and catalogue modules
//! and the texts of a failed download; the storage, idle, frame and timer doorways are picker_shell.rs,
//! exports of this module bound to `ui` when the method is called, as the original arrow functions
//! captured it. The frozen originals are tests/unit/helpers/reference-picker-*.js.
use js_sys::Array;
use wasm_bindgen::{prelude::*, JsCast};
use crate::host::{get, global, read};
use crate::reader_experience_policy::bound;
use crate::picker_actions::{picker_cancel, picker_click, picker_use, picker_voice_name};
use crate::picker_policy::{picker_dismiss, picker_dismissed, picker_offer_for, picker_render_offer, picker_snoozed, picker_state};
use crate::picker_warm::{picker_attach, picker_cancel_warm, picker_changed, picker_paint, picker_refresh, picker_used, picker_warm, picker_warm_context, picker_warm_current, picker_warm_up};
use crate::voice_methods::door;

/// `Date.now`, as the page has it when the method is called.
fn now() -> Result<js_sys::Function, JsValue> { door(&global(), "Date.now") }

/// `NeuralVoicePicker.prototype[name].apply(host, args)`.
#[wasm_bindgen]
pub fn picker_method(host: JsValue, name: &str, args: Array, kit: JsValue, ui: JsValue) -> Result<JsValue, JsValue> {
    let a = |index: u32| args.get(index);
    let d = |name: &str| door(&kit, name);
    let done = |result: Result<(), JsValue>| result.map(|_| JsValue::UNDEFINED);
    match name {
        "warm" => done(picker_warm(host, bound(&ui, "picker_schedule", &[&ui])?)),
        // refresh({warm = true} = {})
        "refresh" => {
            let options = a(0);
            if options.is_null() { return Err(js_sys::TypeError::new("Cannot destructure property 'warm' of 'object null' as it is null.").into()); }
            let warm = if options.is_undefined() { JsValue::UNDEFINED } else { read(&options, "warm")? };
            let warm = if warm.is_undefined() { JsValue::TRUE } else { warm };
            done(picker_refresh(host, warm, bound(&ui, "picker_load", &[&ui, d("runtime.loadNeural")?.as_ref()])?))
        }
        "used" => Ok(picker_used(door(&ui, "picker_read_used")?).into()),
        // attach(warm = true)
        "attach" => {
            let warm = a(0);
            let warm = if warm.is_undefined() { JsValue::TRUE } else { warm };
            done(picker_attach(host, warm, d("runtime.neuralEngine")?, bound(&ui, "picker_listen", &[&ui, &kit])?, bound(&ui, "picker_engine_refresh", &[&ui])?))
        }
        "warmContext" => picker_warm_context(host).map(Into::into),
        "isWarmCurrent" => picker_warm_current(host, a(0)).map(Into::into),
        "cancelWarm" => done(picker_cancel_warm(host, match get(&global(), "cancelIdleCallback") { cancel if cancel.is_function() => cancel, _ => JsValue::NULL }, door(&global(), "clearTimeout")?)),
        "warmUp" => done(picker_warm_up(host, d("runtime.neuralEngine")?, door(&ui, "picker_ignore")?, bound(&ui, "picker_warm_active", &[&ui])?)),
        "changed" => done(picker_changed(host, d("runtime.neuralEngine")?, bound(&ui, "picker_frame", &[&ui])?)),
        "paint" => done(picker_paint(host, d("runtime.neuralEngine")?)),
        "state" => picker_state(host, a(0), a(1), read(&kit, "messages")?).map(Into::into),
        "click" => done(picker_click(host, a(0))),
        "cancel" => done(picker_cancel(host, a(0), d("runtime.neuralEngine")?)),
        "voiceName" => picker_voice_name(a(0), d("runtime.neuralVoiceList")?),
        "use" => done(picker_use(host, a(0), d("runtime.neuralEngine")?)),
        "dismissed" => Ok(picker_dismissed(door(&ui, "picker_read_offer")?)),
        "snoozed" => picker_snoozed(host, a(0), now()?).map(Into::into),
        "dismiss" => done(picker_dismiss(host, d("catalog.langBase")?, now()?, door(&ui, "picker_write_offer")?)),
        "offerFor" => picker_offer_for(host, a(0), a(1).unchecked_into(), d("catalog.langBase")?, d("catalog.recommendedNeuralFor")?, read(&read(&global(), "navigator")?, "language")?),
        "renderOffer" => done(picker_render_offer(host, a(0), a(1))),
        _ => Err(js_sys::TypeError::new(&format!("NeuralVoicePicker has no method {name}")).into()),
    }
}
