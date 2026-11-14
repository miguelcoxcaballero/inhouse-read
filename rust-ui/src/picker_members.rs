//! The two members of the natural-voice picker (neural-picker.js `NeuralVoicePicker`) that waited in JavaScript between
//! exports of picker_actions.rs: downloading a voice (only ever started by a tap) and selecting it when it is ready,
//! and removing one. `eager` runs each the way the `async` method ran, so the list is repainted and the result
//! announced at the microtask they were. `kit` is the picker's own table: the engine and catalogue doorways and the
//! texts of a failed download.
use js_sys::{Array, Function, Reflect};
use wasm_bindgen::prelude::*;
use crate::eager::eager;
use crate::quick_wait::wait;
use crate::host::{method, read};
use crate::picker_actions::{picker_install_begin, picker_install_done, picker_install_error, picker_remove_begin, picker_remove_done};
use crate::voice_methods::door;

type R<T = JsValue> = Result<T, JsValue>;

thread_local! {
    /// `() => new AbortController()`, the controller of the download this page starts.
    static CONTROLLER: Function = Closure::<dyn FnMut() -> R>::new(|| {
        let class = read(&crate::host::global(), "AbortController")?;
        Reflect::construct(class.unchecked_ref(), &Array::new())
    }).into_js_value().unchecked_into();
}

/// `NeuralVoicePicker.prototype[name].apply(host, args)` for `install` and `remove`.
#[wasm_bindgen]
pub fn picker_member(host: JsValue, name: &str, args: Array, kit: JsValue, _ui: JsValue) -> R {
    let id = args.get(0);
    Ok(match name {
        "install" => eager(async move {
            let context = picker_install_begin(host.clone(), id.clone(), door(&kit, "runtime.neuralEngine")?, door(&kit, "catalog.isNeuralId")?, CONTROLLER.with(Function::clone))?;
            if !context.is_truthy() { return Ok(JsValue::UNDEFINED); }
            // try { await context.task; done } catch (error) { failed }
            let installed: R<()> = async {
                wait(&read(&context, "task")?).await?;
                picker_install_done(host.clone(), id.clone(), context.clone(), door(&kit, "catalog.declaredLanguage")?, door(&kit, "catalog.langBase")?, door(&kit, "runtime.neuralVoiceList")?)
            }.await;
            if let Err(error) = installed { picker_install_error(host, id, context, error, read(&kit, "messages")?)?; }
            Ok(JsValue::UNDEFINED)
        }).into(),
        "remove" => eager(async move {
            let context = picker_remove_begin(host.clone(), id.clone(), door(&kit, "runtime.neuralEngine")?, door(&kit, "runtime.neuralVoiceList")?)?;
            if !context.is_truthy() { return Ok(JsValue::UNDEFINED); }
            let removed: R = async { wait(&method(&read(&context, "engine")?, "remove", &[&id])?).await }.await;
            let _ = removed; // a failed removal still leaves the list as the engine reports it
            picker_remove_done(host, id, context)?;
            Ok(JsValue::UNDEFINED)
        }).into(),
        _ => return Err(js_sys::TypeError::new(&format!("NeuralVoicePicker has no member {name}")).into()),
    })
}
