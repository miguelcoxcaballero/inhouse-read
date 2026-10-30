//! The retained framebuffer cache of the native room (formerly src/js/native-room-cache.js): its three objects,
//! replay uniforms and context listeners, and every step that is not per frame (context loss and restoration,
//! slot release, program and uniform preparation, disposal).
//!
//! Its textures retain the already resolved default framebuffer, including its original antialiasing,
//! tone-mapped sRGB bytes and premultiplied alpha. Capture, composition, repaint and their validity checks run
//! on every replayed frame and stay in the host: done from here, crossing into JavaScript for each of their
//! three.js reads and writes made a capture + repaint about five times slower (measured 184 us against 36 us).
//!
//! The cache is one plain JS record that both sides share and the bound exports take, so nothing here holds a
//! Rust closure and the whole cache goes with the garbage collector.
use wasm_bindgen::{prelude::*, JsCast};
use js_sys::{Array, Map, Object, Set};
use crate::host::{absent, get, method, method_opt, num, read, set, truthy};

type R<T> = Result<T, JsValue>;
const MAX_LAYERS: u32 = 3;

fn object(fields: &[(&str, JsValue)]) -> R<JsValue> {
    let value: JsValue = Object::new().into();
    for (key, field) in fields { set(&value, key, field)?; }
    Ok(value)
}
fn three_new(three: &JsValue, name: &str, args: &[&JsValue]) -> R<JsValue> {
    let constructor: js_sys::Function = read(three, name)?.dyn_into()
        .map_err(|_| JsValue::from(js_sys::TypeError::new(&format!("THREE.{name} is not a constructor"))))?;
    let list = Array::new();
    for argument in args { list.push(argument); }
    js_sys::Reflect::construct(&constructor, &list)
}
fn n(value: f64) -> JsValue { JsValue::from_f64(value) }
/// `target.name?.(...args)`: the target must exist, its method may be absent.
fn optional(target: &JsValue, name: &str, args: &[&JsValue]) -> R<()> {
    let function = read(target, name)?;
    if absent(&function) { return Ok(()); }
    let function: js_sys::Function = function.dyn_into()
        .map_err(|_| JsValue::from(js_sys::TypeError::new(&format!("{name} is not a function"))))?;
    let list = Array::new();
    for argument in args { list.push(argument); }
    function.apply(target, &list)?;
    Ok(())
}
fn slots(record: &JsValue) -> Map { get(record, "slots").unchecked_into() }
fn live(record: &JsValue) -> Set { get(record, "liveTextures").unchecked_into() }
fn flag(record: &JsValue, key: &str) -> bool { truthy(&get(record, key)) }
fn generation(record: &JsValue) -> JsValue { get(record, "generation") }
fn renderer(record: &JsValue) -> JsValue { get(record, "renderer") }
fn policy(record: &JsValue) -> JsValue { get(record, "policy") }
fn bind(exports: &JsValue, name: &str, args: &[&JsValue]) -> R<JsValue> {
    let list = Array::new();
    list.push(&JsValue::UNDEFINED);
    for argument in args { list.push(argument); }
    let function: js_sys::Function = read(exports, name)?.dyn_into()?;
    js_sys::Reflect::apply(&read(&function, "bind")?.dyn_into()?, &function, &list)
}
/// `for (const texture of slots.values()) texture.dispose(); slots.clear(); liveTextures.clear();`
fn release_all(record: &JsValue) -> R<()> {
    let table = slots(record);
    for texture in js_sys::try_iter(&table.values())?.into_iter().flatten() {
        let texture = texture?;
        method(&texture, "dispose", &[])?;
    }
    table.clear();
    live(record).clear();
    Ok(())
}

/// The cache's three objects, uniforms and listeners, in the original's order; answers the record the host's
/// per-frame steps share (its `slots`, `liveTextures`, scratch vectors, `uniforms`, `scene`, `camera`, `policy`,
/// `disposed` and `generation`), with `releaseSlot`, `dispose`, `prepare` and `prepareUniforms` bound to it.
/// The host has already checked that `renderer` can copy its framebuffer.
/// `hooks` holds the other modules' functions (`prepareProgramUniforms`,
/// `createNativeFramePolicy`); `exports` is this module.
#[wasm_bindgen]
pub fn native_room_cache_create(renderer: JsValue, on_restored: JsValue, three: JsValue, hooks: JsValue, exports: JsValue) -> R<JsValue> {
    let slots = Map::new();
    let live = Set::new(&JsValue::UNDEFINED);
    let size = three_new(&three, "Vector2", &[])?;
    let copy_origin = three_new(&three, "Vector2", &[])?;
    let scissor = three_new(&three, "Vector4", &[])?;
    let clear_color = three_new(&three, "Color", &[])?;
    let transparent = three_new(&three, "DataTexture", &[&js_sys::Uint8Array::new_with_length(4), &n(1.0), &n(1.0)])?;
    set(&transparent, "colorSpace", &read(&three, "NoColorSpace")?)?;
    set(&transparent, "needsUpdate", &JsValue::TRUE)?;
    let uniforms = object(&[("outputSize", object(&[("value", three_new(&three, "Vector2", &[])?)])?),
        ("outputOrigin", object(&[("value", three_new(&three, "Vector2", &[])?)])?)])?;
    for index in 0..MAX_LAYERS {
        set(&uniforms, &format!("layer{index}"), &object(&[("value", transparent.clone())])?)?;
        set(&uniforms, &format!("rect{index}"), &object(&[("value", three_new(&three, "Vector4", &[])?)])?)?;
        set(&uniforms, &format!("clip{index}"), &object(&[("value", three_new(&three, "Vector4", &[])?)])?)?;
        set(&uniforms, &format!("enabled{index}"), &object(&[("value", n(0.0))])?)?;
    }
    // The raw replay program's sources are rust-ui/src/native_room_shaders.rs.
    let sources = crate::native_room_shaders::native_room_shaders(MAX_LAYERS);
    let material = three_new(&three, "RawShaderMaterial", &[&object(&[("uniforms", uniforms.clone()), ("depthTest", JsValue::FALSE),
        ("depthWrite", JsValue::FALSE), ("blending", read(&three, "NoBlending")?), ("transparent", JsValue::FALSE),
        ("toneMapped", JsValue::FALSE), ("premultipliedAlpha", JsValue::FALSE), ("vertexShader", sources.get(0)),
        ("fragmentShader", sources.get(1))])?])?;
    let geometry = three_new(&three, "PlaneGeometry", &[&n(2.0), &n(2.0)])?;
    let mesh = three_new(&three, "Mesh", &[&geometry, &material])?;
    set(&mesh, "frustumCulled", &JsValue::FALSE)?;
    let scene = three_new(&three, "Scene", &[])?;
    let camera = three_new(&three, "Camera", &[])?;
    method(&scene, "add", &[&mesh])?;
    let policy = method(&hooks, "createNativeFramePolicy", &[])?;
    let record = object(&[("renderer", renderer.clone()), ("onRestored", on_restored), ("three", three), ("hooks", hooks),
        ("slots", slots.into()), ("liveTextures", live.into()), ("size", size), ("copyOrigin", copy_origin), ("scissor", scissor),
        ("clearColor", clear_color), ("transparent", transparent), ("uniforms", uniforms), ("material", material),
        ("geometry", geometry), ("mesh", mesh), ("scene", scene), ("camera", camera), ("policy", policy),
        ("disposed", JsValue::FALSE), ("prepared", JsValue::FALSE), ("generation", n(0.0)), ("exports", exports.clone())])?;
    let lost = bind(&exports, "native_room_cache_context_lost", &[&record])?;
    let restored = bind(&exports, "native_room_cache_context_restored", &[&record])?;
    set(&record, "contextLost", &lost)?;
    set(&record, "contextRestored", &restored)?;
    optional(&read(&renderer, "domElement")?, "addEventListener", &[&"webglcontextlost".into(), &lost])?;
    optional(&read(&renderer, "domElement")?, "addEventListener", &[&"webglcontextrestored".into(), &restored])?;
    for (key, export) in [("releaseSlot", "native_room_cache_release_slot"), ("dispose", "native_room_cache_dispose"),
        ("prepare", "native_room_cache_prepare"), ("prepareUniforms", "native_room_cache_prepare_uniforms")] {
        set(&record, key, &bind(&exports, export, &[&record])?)?;
    }
    Ok(record)
}

/// Every retained frame of the lost or restored context is gone.
fn invalidate_frames(record: &JsValue) -> R<()> {
    set(record, "generation", &n(num(&generation(record)) + 1.0))?;
    set(record, "prepared", &JsValue::FALSE)?;
    release_all(record)
}
#[wasm_bindgen]
pub fn native_room_cache_context_lost(record: &JsValue) -> R<()> { invalidate_frames(record) }
#[wasm_bindgen]
pub fn native_room_cache_context_restored(record: &JsValue) -> R<()> {
    invalidate_frames(record)?;
    crate::host::call_opt(&get(record, "onRestored"), "onRestored", &[])?;
    Ok(())
}

/// The renderer's context while it can draw, otherwise null.
fn ready_context(record: &JsValue) -> JsValue {
    let found = (|| -> R<JsValue> {
        let context = method(&renderer(record), "getContext", &[])?;
        if !truthy(&context) { return Ok(JsValue::NULL); }
        let lost = method_opt(&context, "isContextLost", &[])?.unwrap_or(JsValue::UNDEFINED);
        Ok(if truthy(&lost) { JsValue::NULL } else { context })
    })();
    found.unwrap_or(JsValue::NULL)
}
fn release_slot(record: &JsValue, slot: &JsValue) -> R<()> {
    let table = slots(record);
    let texture = table.get(slot);
    if truthy(&texture) { method(&texture, "dispose", &[])?; table.delete(slot); live(record).delete(&texture); }
    Ok(())
}
#[wasm_bindgen]
pub fn native_room_cache_release_slot(record: &JsValue, slot: &JsValue) -> R<()> { release_slot(record, slot) }

/// Release everything once: the policy's arena, the listeners, every retained texture and the replay program.
#[wasm_bindgen]
pub fn native_room_cache_dispose(record: &JsValue) -> R<()> {
    if flag(record, "disposed") { return Ok(()); }
    set(record, "disposed", &JsValue::TRUE)?;
    method(&policy(record), "dispose", &[])?;
    let canvas = read(&renderer(record), "domElement")?;
    optional(&canvas, "removeEventListener", &[&"webglcontextlost".into(), &get(record, "contextLost")])?;
    optional(&read(&renderer(record), "domElement")?, "removeEventListener", &[&"webglcontextrestored".into(), &get(record, "contextRestored")])?;
    release_all(record)?;
    for part in ["transparent", "geometry", "material"] { method(&get(record, part), "dispose", &[])?; }
    method(&get(record, "scene"), "remove", &[&get(record, "mesh")])?;
    Ok(())
}

/// Link the raw copy before an inspection gesture starts. This does not draw or alter the default framebuffer,
/// which remains the original scene output.
fn prepare(record: &JsValue) -> R<()> {
    if !flag(record, "prepared") {
        method(&renderer(record), "compile", &[&get(record, "scene"), &get(record, "camera")])?;
        set(record, "prepared", &JsValue::TRUE)?;
    }
    Ok(())
}
#[wasm_bindgen]
pub fn native_room_cache_prepare(record: &JsValue) -> R<()> { prepare(record) }

/// Whether a uniform preparation started for `owner` may continue: the cache is live, its context the same and
/// ready, and the caller still wants it (`current` answers as it did, its value kept as the answer when falsy).
#[wasm_bindgen]
pub fn native_room_cache_active(record: &JsValue, owner: &JsValue, current: &JsValue) -> R<JsValue> {
    if flag(record, "disposed") || generation(record) != *owner { return Ok(JsValue::FALSE); }
    let wanted = if current.is_undefined() { JsValue::TRUE } else { crate::host::call(current, "current", &[])? };
    if !truthy(&wanted) { return Ok(wanted); }
    Ok(JsValue::from_bool(truthy(&ready_context(record))))
}

/// Uniform reflection is otherwise deferred until the first room replay, inside the book's return. Prepare the
/// identical raw program in idle slices; no framebuffer allocation, capture or draw is needed. Resolves false
/// when there is no idle function or the cache moved on, otherwise to the uniform preparation's answer.
#[wasm_bindgen]
pub fn native_room_cache_prepare_uniforms(record: JsValue, options: JsValue) -> js_sys::Promise {
    wasm_bindgen_futures::future_to_promise(async move {
        let options = if options.is_undefined() { Object::new().into() } else { options };
        let idle = read(&options, "idle")?;
        let current = read(&options, "current")?;
        if !idle.is_function() { return Ok(JsValue::FALSE); }
        let owner = generation(&record);
        let active = bind(&get(&record, "exports"), "native_room_cache_active", &[&record, &owner, &current])?;
        let waited = crate::host::call(&idle, "idle", &[])?;
        wasm_bindgen_futures::JsFuture::from(js_sys::Promise::resolve(&waited)).await?;
        if !truthy(&crate::host::call(&active, "active", &[])?) { return Ok(JsValue::FALSE); }
        prepare(&record)?;
        optional(&method(&renderer(&record), "getContext", &[])?, "flush", &[])?;
        let materials = Array::of1(&get(&record, "material"));
        let answer = method(&get(&record, "hooks"), "prepareProgramUniforms", &[&renderer(&record), &materials,
            &object(&[("idle", idle), ("current", active)])?])?;
        wasm_bindgen_futures::JsFuture::from(js_sys::Promise::resolve(&answer)).await
    })
}
