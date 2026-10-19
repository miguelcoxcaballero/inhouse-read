//! Program preparation/retention policy; Three and WebGL remain host APIs.
//! Async stages and timers use GC-owned bound callbacks, not rooted Rust tasks.
use wasm_bindgen::{prelude::*, JsCast};
use js_sys::{Array, Object, Promise, Set, WeakMap, WeakSet};
use crate::host::*;
type R<T> = Result<T, JsValue>;
const MAX_RETAINED: f64 = 160.0;
const LINK_TIMEOUT: f64 = 15000.0;
thread_local! {
    static RETAINED: WeakSet = WeakSet::new();
    static COUNTS: WeakMap = WeakMap::new();
    static UNIFORMS: WeakSet = WeakSet::new();
}
fn object(fields: &[(&str, JsValue)]) -> R<JsValue> {
    let state: JsValue = Object::new().into();
    for (key,value) in fields { set(&state,key,value)?; }
    Ok(state)
}
fn key(value: &JsValue) -> Object { value.clone().unchecked_into() }
fn bound(host: &JsValue, name: &str, state: &JsValue) -> R<JsValue> {
    method(&read(host,name)?,"bind",&[&JsValue::UNDEFINED,state])
}
fn resolved(result: R<JsValue>) -> JsValue {
    match result { Ok(value) => Promise::resolve(&value).into(), Err(error) => Promise::reject(&error).into() }
}
fn entries(value: &JsValue) -> R<js_sys::IntoIter> {
    js_sys::try_iter(value)?.ok_or_else(|| js_sys::TypeError::new("Value is not iterable").into())
}
fn collect_programs(renderer: &JsValue, materials: &JsValue, programs: &Set) -> R<()> {
    let add = method(&read(programs.as_ref(),"add")?,"bind",&[programs.as_ref()])?;
    for item in entries(materials)? {
        let material = item?;
        let properties = method(&read(renderer,"properties")?,"get",&[&material])?;
        let owned = read(&properties,"programs")?;
        if !absent(&owned) { method(&owned,"forEach",&[&add])?; }
    }
    Ok(())
}
fn flush(renderer: &JsValue) -> R<()> {
    if let Some(context) = method_opt(renderer,"getContext",&[])? { method_opt(&context,"flush",&[])?; }
    Ok(())
}

#[wasm_bindgen]
pub fn gpu_retain_programs(host: JsValue, renderer: JsValue) -> R<()> {
    let programs = read(&read(&renderer,"info")?,"programs")?;
    let renderer_key = key(&renderer);
    let saved = COUNTS.with(|counts| counts.get(&renderer_key));
    let mut count = if truthy(&saved) { num(&saved) } else { 0.0 };
    if count >= MAX_RETAINED { return Ok(()); }
    // Batch opaque JS-object membership across the host boundary. Inspecting
    // every already-retained Three program through WASM on every render is
    // substantially slower than a single host WeakSet scan.
    let candidates: Array = RETAINED.with(|retained|
        method(&host,"unretained",&[&programs,retained.as_ref()]))?.unchecked_into();
    for program in candidates.iter() {
        if count >= MAX_RETAINED { break; }
        let program_key = key(&program);
        if RETAINED.with(|retained| retained.has(&program_key)) { continue; }
        RETAINED.with(|retained| retained.add(&program_key)); count += 1.0;
        set(&program,"usedTimes",&(num(&read(&program,"usedTimes")?) + 1.0).into())?;
    }
    COUNTS.with(|counts| counts.set(&renderer_key,&count.into()));
    Ok(())
}

fn wait_uniform(state: &JsValue) -> R<JsValue> {
    let pending = resolved(call(&read(state,"idle")?,"idle",&[]));
    method(&pending,"then",&[&bound(&read(state,"host")?,"uniformAfterIdle",state)?])
}
fn next_uniform(state: &JsValue) -> R<JsValue> {
    let programs = read(state,"programs")?;
    let mut index = num(&read(state,"index")?) as u32;
    while index < num(&read(&programs,"length")?) as u32 {
        let program = get_at(&programs,index);
        if UNIFORMS.with(|known| known.has(&key(&program))) || !get(&program,"getUniforms").is_function() {
            index += 1; set(state,"index",&(index as f64).into())?; continue;
        }
        set(state,"program",&program)?;
        return wait_uniform(state);
    }
    call(&read(state,"current")?,"current",&[])
}
#[wasm_bindgen]
pub fn gpu_prepare_uniforms(host: JsValue, renderer: JsValue, materials: JsValue, idle: JsValue, current: JsValue) -> R<JsValue> {
    if !idle.is_function() || !truthy(&materials) || !truthy(&get(&get(&renderer,"properties"),"get")) {
        return Ok(Promise::resolve(&JsValue::FALSE).into());
    }
    let programs = Set::new(&JsValue::UNDEFINED);
    collect_programs(&renderer,&materials,&programs)?;
    let state = object(&[("host",host),("programs",Array::from(programs.as_ref()).into()),
        ("idle",idle),("current",current),("deadline",(clock()?+LINK_TIMEOUT).into()),("index",0.0.into())])?;
    Ok(resolved(next_uniform(&state)))
}
#[wasm_bindgen]
pub fn gpu_uniform_after_idle(state: JsValue) -> R<JsValue> {
    if !truthy(&call(&read(&state,"current")?,"current",&[])?) || clock()? > num(&read(&state,"deadline")?) { return Ok(JsValue::FALSE); }
    let program = read(&state,"program")?;
    if get(&program,"isReady").is_function() && !truthy(&method(&program,"isReady",&[])?) { return wait_uniform(&state); }
    method(&program,"getUniforms",&[])?;
    UNIFORMS.with(|known| known.add(&key(&program)));
    set(&state,"index",&(num(&read(&state,"index")?)+1.0).into())?;
    next_uniform(&state)
}

#[wasm_bindgen]
pub fn gpu_compile_page(renderer: JsValue, scene: JsValue, camera: JsValue) -> R<JsValue> {
    let materials = method(&renderer,"compile",&[&scene,&camera])?;
    if truthy(&get(&materials,"size")) { flush(&renderer)?; }
    Ok(materials)
}
#[wasm_bindgen]
pub fn gpu_collect_drawable(drawn: Array, node: JsValue) {
    if (truthy(&get(&node,"isMesh")) || truthy(&get(&node,"isPoints")) || truthy(&get(&node,"isLine"))) && truthy(&get(&node,"material")) { drawn.push(&node); }
}
fn gather(host: &JsValue, root: &JsValue, drawn: &Array, visible: bool) -> R<()> {
    method(root,if visible { "traverseVisible" } else { "traverse" },&[&bound(host,"collect",drawn.as_ref())?])?;
    Ok(())
}
fn compile_list(host: &JsValue, renderer: &JsValue, scene: &JsValue, camera: &JsValue, objects: &Array) -> R<JsValue> {
    method(host,"compileList",&[renderer,objects.as_ref(),camera,scene])
}
#[wasm_bindgen]
pub fn gpu_prelink(host: JsValue, renderer: JsValue, scene: JsValue, camera: JsValue, roots: JsValue) -> R<()> {
    if !get(&renderer,"compile").is_function() || !method(&renderer,"getRenderTarget",&[])?.is_null() { return Ok(()); }
    let drawn = Array::new();
    for root in entries(&roots)? { gather(&host,&root?,&drawn,true)?; }
    if drawn.length() == 0 { return Ok(()); }
    compile_list(&host,&renderer,&scene,&camera,&drawn)?;
    flush(&renderer)
}
fn materials_of(node: &JsValue) -> R<Array> {
    let material = read(node,"material")?;
    Ok(if Array::is_array(&material) { material.unchecked_into() } else { Array::of1(&material) })
}
fn needs_transmission(objects: &Array) -> R<bool> {
    for object in objects.iter() { for material in materials_of(&object)?.iter() {
        if num(&read(&material,"transmission")?) > 0.0 { return Ok(true); }
    }}
    Ok(false)
}
fn opaque_objects(objects: &Array) -> R<Array> {
    let opaque = Array::new();
    'objects: for object in objects.iter() {
        for material in materials_of(&object)?.iter() {
            if truthy(&read(&material,"transmission")?) || truthy(&read(&material,"transparent")?) { continue 'objects; }
        }
        opaque.push(&object);
    }
    Ok(opaque)
}
#[wasm_bindgen]
pub fn gpu_compile_programs(host: JsValue, renderer: JsValue, scene: JsValue, camera: JsValue, prepared: JsValue) -> R<JsValue> {
    let programs = Set::new(&JsValue::UNDEFINED);
    if get(&renderer,"compile").is_function() {
        let drawn = Array::new(); gather(&host,&scene,&drawn,true)?;
        for item in entries(&prepared)? { let item = item?; if !drawn.includes(&item,0) { drawn.push(&item); } }
        collect_programs(&renderer,&compile_list(&host,&renderer,&scene,&camera,&drawn)?,&programs)?;
        if needs_transmission(&drawn)? {
            let previous = method(&renderer,"getRenderTarget",&[])?;
            let target = method(&host,"createTarget",&[])?;
            method(&renderer,"setRenderTarget",&[&target])?;
            let compiled = (|| -> R<()> {
                collect_programs(&renderer,&compile_list(&host,&renderer,&scene,&camera,&opaque_objects(&drawn)?)?,&programs)
            })();
            method(&renderer,"setRenderTarget",&[&previous])?;
            method(&target,"dispose",&[])?;
            compiled?;
        }
        if programs.size() != 0 { flush(&renderer)?; }
    }
    let state = object(&[("programs",programs.into()),("deadline",(clock()?+LINK_TIMEOUT).into())])?;
    bound(&host,"ready",&state)
}
#[wasm_bindgen]
pub fn gpu_programs_ready(state: JsValue) -> R<bool> {
    if clock()? > num(&read(&state,"deadline")?) { return Ok(true); }
    for program in entries(&read(&state,"programs")?)? {
        if !truthy(&method(&program?,"isReady",&[])?) { return Ok(false); }
    }
    Ok(true)
}

fn unpark(state: &JsValue) -> R<()> {
    if truthy(&read(state,"parked")?) { method(&read(state,"owner")?,"removeEventListener",&[&"visibilitychange".into(),&read(state,"wake")?])?; }
    set(state,"parked",&JsValue::FALSE)
}
#[wasm_bindgen]
pub fn gpu_readiness_check(state: JsValue) -> R<()> {
    set(&state,"timer",&0.0.into())?;
    if truthy(&read(&state,"cancelled")?) { return Ok(()); }
    let owner = read(&state,"owner")?;
    if get(&owner,"visibilityState") == JsValue::from_str("hidden") {
        if !truthy(&read(&state,"parked")?) {
            set(&state,"parked",&JsValue::TRUE)?;
            method(&owner,"addEventListener",&[&"visibilitychange".into(),&read(&state,"wake")?])?;
        }
        return Ok(());
    }
    if truthy(&call(&read(&state,"ready")?,"ready",&[])?) {
        set(&state,"cancelled",&JsValue::TRUE)?;
        call(&read(&state,"done")?,"done",&[])?;
    } else { set(&state,"timer",&set_timeout(&read(&state,"check")?,num(&read(&state,"interval")?))?)?; }
    Ok(())
}
#[wasm_bindgen]
pub fn gpu_readiness_wake(state: JsValue) -> R<()> {
    if get(&read(&state,"owner")?,"visibilityState") != JsValue::from_str("hidden") { unpark(&state)?; gpu_readiness_check(state)?; }
    Ok(())
}
#[wasm_bindgen]
pub fn gpu_readiness_cancel(state: JsValue) -> R<()> {
    set(&state,"cancelled",&JsValue::TRUE)?;
    let timer = read(&state,"timer")?; if truthy(&timer) { clear_timeout(&timer)?; }
    set(&state,"timer",&0.0.into())?;
    unpark(&state)
}
#[wasm_bindgen]
pub fn gpu_when_ready(host: JsValue, renderer: JsValue, scene: JsValue, camera: JsValue, root: JsValue, done: JsValue, interval: JsValue) -> R<JsValue> {
    let meshes = Array::new(); gather(&host,&root,&meshes,false)?;
    let ready = match gpu_compile_programs(host.clone(),renderer,scene,camera,meshes.into()) {
        Ok(ready) => ready,
        Err(_) => bound(&host,"ready",&object(&[("programs",Set::new(&JsValue::UNDEFINED).into()),("deadline",0.0.into())])?)?,
    };
    let state = object(&[("owner",get(&global(),"document")),("ready",ready),("done",done),("interval",interval),
        ("timer",0.0.into()),("cancelled",JsValue::FALSE),("parked",JsValue::FALSE)])?;
    set(&state,"check",&bound(&host,"check",&state)?)?;
    set(&state,"wake",&bound(&host,"wake",&state)?)?;
    gpu_readiness_check(state.clone())?;
    bound(&host,"cancel",&state)
}
