//! The methods of the natural-voice picker (neural-picker.js `NeuralVoicePicker`), answered here:
//! each name hands the picker (`host`) and the doorways it needs to picker_actions/policy/warm.rs,
//! with the defaults the JavaScript methods had. `kit` holds the engine, catalogue, storage, idle,
//! frame and timer doorways (read when the method is called); the callbacks that come back later
//! (idle warm-up, engine load and events, refresh, paint frame) are reader_assembly.rs exports that
//! take this module's exports `ui` first, bound here when the method is called. The frozen originals are tests/unit/helpers/reference-picker-*.js.
use js_sys::Array;
use wasm_bindgen::{prelude::*, JsCast};
use crate::host::read;
use crate::picker_actions::{picker_cancel, picker_click, picker_use, picker_voice_name};
use crate::picker_policy::{picker_dismiss, picker_dismissed, picker_offer_for, picker_render_offer, picker_snoozed, picker_state};
use crate::picker_warm::{picker_attach, picker_cancel_warm, picker_changed, picker_paint, picker_refresh, picker_used, picker_warm, picker_warm_context, picker_warm_current, picker_warm_up};
use crate::voice_methods::door;
use crate::reader_assembly::bound_fn;

/// `NeuralVoicePicker.prototype[name].apply(host, args)`.
#[wasm_bindgen]
pub fn picker_method(host: JsValue, name: &str, args: Array, kit: JsValue, ui: JsValue) -> Result<JsValue, JsValue> {
    let a = |index: u32| args.get(index);
    let d = |name: &str| door(&kit, name);
    let done = |result: Result<(), JsValue>| result.map(|_| JsValue::UNDEFINED);
    match name {
        "warm" => done(picker_warm(host, bound_fn(&ui, "picker_schedule", &[&ui])?)),
        // refresh({warm = true} = {})
        "refresh" => {
            let options = a(0);
            if options.is_null() { return Err(js_sys::TypeError::new("Cannot destructure property 'warm' of 'object null' as it is null.").into()); }
            let warm = if options.is_undefined() { JsValue::UNDEFINED } else { read(&options, "warm")? };
            let warm = if warm.is_undefined() { JsValue::TRUE } else { warm };
            done(picker_refresh(host, warm, bound_fn(&ui, "picker_load", &[&ui, &kit])?))
        }
        "used" => Ok(picker_used(d("readUsed")?).into()),
        // attach(warm = true)
        "attach" => {
            let warm = a(0);
            let warm = if warm.is_undefined() { JsValue::TRUE } else { warm };
            done(picker_attach(host, warm, d("runtime.neuralEngine")?, bound_fn(&ui, "picker_listen", &[&ui, &kit])?, bound_fn(&ui, "picker_engine_refresh", &[&ui])?))
        }
        "warmContext" => picker_warm_context(host).map(Into::into),
        "isWarmCurrent" => picker_warm_current(host, a(0)).map(Into::into),
        "cancelWarm" => done(picker_cancel_warm(host, read(&kit, "cancelIdle")?, d("clearTimeout")?)),
        "warmUp" => done(picker_warm_up(host, d("runtime.neuralEngine")?, d("ignore")?, bound_fn(&ui, "picker_warm_check_factory", &[&ui])?)),
        "changed" => done(picker_changed(host, d("runtime.neuralEngine")?, bound_fn(&ui, "picker_frame", &[&ui])?)),
        "paint" => done(picker_paint(host, d("runtime.neuralEngine")?)),
        "state" => picker_state(host, a(0), a(1), read(&kit, "messages")?).map(Into::into),
        "click" => done(picker_click(host, a(0))),
        "cancel" => done(picker_cancel(host, a(0), d("runtime.neuralEngine")?)),
        "voiceName" => picker_voice_name(a(0), d("runtime.neuralVoiceList")?),
        "use" => done(picker_use(host, a(0), d("runtime.neuralEngine")?)),
        "dismissed" => Ok(picker_dismissed(d("readOffer")?)),
        "snoozed" => picker_snoozed(host, a(0), d("now")?).map(Into::into),
        "dismiss" => done(picker_dismiss(host, d("catalog.langBase")?, d("now")?, d("writeOffer")?)),
        "offerFor" => picker_offer_for(host, a(0), a(1).unchecked_into(), d("catalog.langBase")?, d("catalog.recommendedNeuralFor")?, read(&kit, "device")?),
        "renderOffer" => done(picker_render_offer(host, a(0), a(1))),
        _ => Err(js_sys::TypeError::new(&format!("NeuralVoicePicker has no method {name}")).into()),
    }
}
