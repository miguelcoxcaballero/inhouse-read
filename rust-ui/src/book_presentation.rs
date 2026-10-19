//! Idle model preparation, owned by Rust but scheduled with GC-owned Promise
//! callbacks. An unresolved browser/idle promise never roots a native future.
use wasm_bindgen::{prelude::*, JsCast};
use js_sys::{Array, Object, Promise, WeakMap};
use crate::host::{call, get, method, method_opt, read, set, truthy};
type R<T> = Result<T, JsValue>;

thread_local! {
    static PRESENTATIONS: WeakMap = WeakMap::new();
    static DETAILS: WeakMap = WeakMap::new();
}
fn with_cache<T>(state: &JsValue, f: impl FnOnce(&WeakMap) -> T) -> T {
    if truthy(&get(state, "detail")) { DETAILS.with(f) } else { PRESENTATIONS.with(f) }
}
fn callback(state: &JsValue, name: &str) -> R<JsValue> {
    method(&read(&read(state, "host")?, name)?, "bind", &[&JsValue::UNDEFINED, state])
}
fn promise(result: R<JsValue>) -> JsValue {
    match result { Ok(value) => Promise::resolve(&value).into(), Err(error) => Promise::reject(&error).into() }
}

#[wasm_bindgen]
pub fn book_presentation_prepare(host: JsValue, subject: JsValue, idle: JsValue, current: JsValue, detail: bool) -> R<JsValue> {
    if !idle.is_function() || (if detail { !subject.is_function() } else { !get(&subject, "traverse").is_function() }) {
        return Ok(Promise::resolve(&JsValue::FALSE).into());
    }
    let state: JsValue = Object::new().into();
    for (key, value) in [("host",host), ("subject",subject), ("idle",idle.clone()), ("current",current), ("detail",detail.into())] {
        set(&state,key,&value)?;
    }
    let task = promise(call(&idle, "idle", &[]));
    method(&task, "then", &[&callback(&state,"entered")?])
}

/// First idle slice ended. Existing success/pending work is shared per renderer;
/// a cancelled or rejected attempt is removed so a later owner can retry.
#[wasm_bindgen]
pub fn book_presentation_enter(state: JsValue) -> R<JsValue> {
    if !truthy(&call(&read(&state,"current")?,"current",&[])?) { return Ok(JsValue::FALSE); }
    let gpu = method(&read(&state,"host")?,"getRenderer",&[])?;
    if !truthy(&gpu) || !get(&gpu,"compile").is_function() { return Ok(JsValue::FALSE); }
    set(&state,"gpu",&gpu)?;
    let key = gpu.unchecked_into::<Object>();
    let existing = with_cache(&state, |cache| cache.get(&key));
    if truthy(&existing) { return Ok(existing); }
    let task = if truthy(&get(&state,"detail")) {
        match call(&read(&state,"subject")?,"build",&[]) {
            Err(error) => Promise::reject(&error).into(),
            Ok(model) => {
                set(&state,"model",&model)?;
                let ready = promise(read(&model,"userData").and_then(|data| read(&data,"ready")));
                let prepared = method(&ready,"then",&[&callback(&state,"compile")?])?;
                method(&prepared,"finally",&[&callback(&state,"dispose")?])?
            }
        }
    } else {
        set(&state,"model",&read(&state,"subject")?)?;
        promise(compile(&state))
    };
    set(&state,"task",&task)?;
    with_cache(&state, |cache| cache.set(&key,&task));
    method(&task,"then",&[&callback(&state,"finished")?,&callback(&state,"failed")?])
}

fn compile(state: &JsValue) -> R<JsValue> {
    if truthy(&get(state,"detail")) && !truthy(&call(&read(state,"current")?,"current",&[])?) { return Ok(JsValue::FALSE); }
    let host = read(state,"host")?;
    let gpu = read(state,"gpu")?;
    let materials = method(&host,"compileModel",&[&read(state,"model")?,&gpu])?;
    if truthy(&get(&materials,"size")) {
        if let Some(context) = method_opt(&gpu,"getContext",&[])? { method_opt(&context,"flush",&[])?; }
    }
    if Array::is_array(&get(&get(&gpu,"info"),"programs")) { method(&host,"retainPrograms",&[&gpu])?; }
    let options: JsValue = Object::new().into();
    set(&options,"idle",&read(state,"idle")?)?;
    set(&options,"current",&read(state,"current")?)?;
    method(&host,"prepareProgramUniforms",&[&gpu,&materials,&options])
}

#[wasm_bindgen]
pub fn book_presentation_compile(state: JsValue) -> R<JsValue> { compile(&state) }

#[wasm_bindgen]
pub fn book_presentation_dispose(state: JsValue) -> R<()> {
    method(&read(&read(&state,"model")?,"userData")?,"dispose",&[])?;
    Ok(())
}

fn remove_attempt(state: &JsValue) -> R<()> {
    let gpu = read(state,"gpu")?.unchecked_into::<Object>();
    let task = read(state,"task")?;
    with_cache(state, |cache| { if cache.get(&gpu) == task { cache.delete(&gpu); } });
    Ok(())
}
#[wasm_bindgen]
pub fn book_presentation_finished(state: JsValue, value: JsValue) -> R<JsValue> {
    if !truthy(&value) { remove_attempt(&state)?; }
    Ok(value)
}
#[wasm_bindgen]
pub fn book_presentation_failed(state: JsValue, error: JsValue) -> R<JsValue> {
    remove_attempt(&state)?;
    Err(error)
}
