//! The three.js side of a catalogue studio, assembled here: its scene, orthographic camera, renderer, studio
//! environment and lights, all from the studio's plan (`catalog_studio::studio_plan`). Every class comes from the
//! `three` namespace the host passes in (and `RoomEnvironment` from three's addons), so the objects are three's
//! own. A studio that cannot draw (no WebGL, or anything failing while the renderer is set up) releases what it
//! made and says so in its host element, as before.
use js_sys::{Array, Object};
use wasm_bindgen::{prelude::*, JsCast};

use crate::host::{absent, global, read, set, truthy};
use crate::three_host::{call, number, Three, R};

fn spread(target: &JsValue, method: &str, values: &JsValue) -> R<()> {
    let values = Array::from(values);
    let list: Vec<JsValue> = values.iter().collect();
    let references: Vec<&JsValue> = list.iter().collect();
    call(target, method, &references)?;
    Ok(())
}

/// What a studio says when it cannot draw.
#[wasm_bindgen]
pub fn studio_unavailable(host: &JsValue) -> R<()> {
    set(&read(host, "dataset")?, "renderer", &"unavailable".into())?;
    set(host, "textContent", &"Vista 3D no disponible".into())
}

fn renderer_setup(three: &Three, room_class: &JsValue, plan: &JsValue, host: &JsValue, parts: &JsValue, diagnostics: &JsValue, lost: &JsValue) -> R<()> {
    let scene = read(parts, "scene")?;
    if read(&global(), "WebGLRenderingContext")?.is_undefined() {
        return Err(js_sys::Error::new("WebGL unavailable").into());
    }
    let options: JsValue = Object::new().into();
    set(&options, "antialias", &JsValue::TRUE)?;
    set(&options, "alpha", &JsValue::TRUE)?;
    let renderer = three.new("WebGLRenderer", &[&options])?;
    set(parts, "renderer", &renderer)?;
    crate::host::call(diagnostics, "configureShaderDiagnostics", &[&renderer])?;
    let ratio = read(&global(), "devicePixelRatio")?;
    let ratio = if truthy(&ratio) { ratio } else { number(1.0) };
    call(&renderer, "setPixelRatio", &[&number(js_sys::Math::min(crate::host::num(&ratio), 2.0))])?;
    set(&renderer, "toneMapping", &three.constant("ACESFilmicToneMapping")?)?;
    set(&renderer, "toneMappingExposure", &read(plan, "exposure")?)?;
    if truthy(&read(plan, "shadows")?) {
        let map = read(&renderer, "shadowMap")?;
        set(&map, "enabled", &JsValue::TRUE)?;
        set(&map, "type", &three.constant("PCFSoftShadowMap")?)?;
        // Main-camera resize and reopening do not move these stationary casters.
        set(&map, "autoUpdate", &JsValue::FALSE)?;
    }
    let canvas = read(&renderer, "domElement")?;
    call(&canvas, "setAttribute", &[&"aria-hidden".into(), &"true".into()])?;
    call(&canvas, "addEventListener", &[&"webglcontextlost".into(), lost])?;
    let pmrem = three.new("PMREMGenerator", &[&renderer])?;
    let room = js_sys::Reflect::construct(room_class.unchecked_ref(), &Array::new())?;
    let cards = Array::from(&read(plan, "cards")?);
    if cards.length() > 0 {
        let options: JsValue = Object::new().into();
        set(&options, "color", &"#252a30".into())?;
        set(&options, "side", &three.constant("DoubleSide")?)?;
        let material = three.new("MeshBasicMaterial", &[&options])?;
        for card in cards.iter() {
            let card = Array::from(&card);
            let plane = three.new("PlaneGeometry", &[&card.get(3), &card.get(4)])?;
            let mesh = three.new("Mesh", &[&plane, &material])?;
            call(&read(&mesh, "position")?, "set", &[&card.get(0), &card.get(1), &card.get(2)])?;
            call(&mesh, "lookAt", &[&number(0.0), &card.get(1), &number(0.0)])?;
            call(&room, "add", &[&mesh])?;
        }
    }
    let environment = call(&pmrem, "fromScene", &[&room, &read(plan, "sigma")?])?;
    set(parts, "environment", &environment)?;
    call(&room, "dispose", &[])?;
    call(&pmrem, "dispose", &[])?;
    set(&scene, "environment", &read(&environment, "texture")?)?;
    set(&scene, "environmentIntensity", &read(plan, "environment")?)?;
    let lights = read(parts, "lights")?;
    let hemisphere = three.new("HemisphereLight", &[&read(plan, "sky")?, &read(plan, "ground")?, &read(plan, "hemisphere")?])?;
    set(&lights, "hemisphere", &hemisphere)?;
    call(&scene, "add", &[&hemisphere])?;
    let key_plan = read(plan, "key")?;
    let key = three.new("DirectionalLight", &[&read(&key_plan, "color")?, &read(&key_plan, "intensity")?])?;
    set(&lights, "key", &key)?;
    spread(&read(&key, "position")?, "set", &read(&key_plan, "position")?)?;
    let shadow = read(plan, "shadow")?;
    if truthy(&shadow) {
        let frustum = Array::from(&read(&shadow, "camera")?);
        if truthy(&read(&shadow, "cast")?) {
            set(&key, "castShadow", &JsValue::TRUE)?;
        }
        let map = read(&key, "shadow")?;
        let size = read(&shadow, "mapSize")?;
        call(&read(&map, "mapSize")?, "set", &[&size, &size])?;
        let camera = read(&map, "camera")?;
        for (index, side) in ["left", "right", "top", "bottom", "near", "far"].iter().enumerate() {
            set(&camera, side, &frustum.get(index as u32))?;
        }
        if truthy(&read(&shadow, "project")?) {
            call(&camera, "updateProjectionMatrix", &[])?;
        }
        set(&map, "bias", &read(&shadow, "bias")?)?;
        set(&map, "normalBias", &read(&shadow, "normalBias")?)?;
    }
    call(&scene, "add", &[&key])?;
    let fill_plan = read(plan, "fill")?;
    let fill = three.new("DirectionalLight", &[&read(&fill_plan, "color")?, &read(&fill_plan, "intensity")?])?;
    set(&lights, "fill", &fill)?;
    spread(&read(&fill, "position")?, "set", &read(&fill_plan, "position")?)?;
    call(&scene, "add", &[&fill])?;
    call(host, "replaceChildren", &[&canvas])?;
    set(&read(host, "dataset")?, "renderer", &"three-mesh".into())
}


/// The parts of a studio of `kind` drawn into `host`: `{ scene, camera, renderer, environment, lights, framing,
/// observer }`. `adapter.prepareScene(parts)`, when the adapter has one, runs before the renderer is made;
/// `diagnostics(renderer)` (the shader diagnostics) right after; `lost` listens for a lost WebGL context.
#[wasm_bindgen]
#[allow(clippy::too_many_arguments)]
pub fn studio_parts(three: &JsValue, room: &JsValue, kind: f64, host: &JsValue, adapter: &JsValue, framing: &JsValue, diagnostics: &JsValue, lost: &JsValue) -> R<JsValue> {
    let three = Three(three);
    let plan = crate::catalog_studio::studio_plan(kind)?;
    let scene = three.new("Scene", &[])?;
    let frustum = Array::from(&read(&plan, "camera")?);
    let camera = three.new("OrthographicCamera", &[&frustum.get(0), &frustum.get(1), &frustum.get(2), &frustum.get(3), &frustum.get(4), &frustum.get(5)])?;
    if frustum.length() > 6 {
        spread(&read(&camera, "position")?, "set", &frustum.slice(6, frustum.length()))?;
        call(&camera, "lookAt", &[&number(0.0), &number(0.0), &number(0.0)])?;
    }
    let parts: JsValue = Object::new().into();
    for (key, value) in [("scene", scene), ("camera", camera), ("renderer", JsValue::NULL), ("environment", JsValue::NULL),
        ("lights", Object::new().into()), ("framing", framing.clone()), ("observer", JsValue::NULL)] {
        set(&parts, key, &value)?;
    }
    crate::host::method_opt(adapter, "prepareScene", &[&parts])?;
    if renderer_setup(&three, room, &plan, host, &parts, diagnostics, lost).is_err() {
        // Like the original's bare `catch`: whatever failed, the studio has no renderer.
        let renderer = read(&parts, "renderer")?;
        if !absent(&renderer) { call(&renderer, "dispose", &[])?; }
        set(&parts, "renderer", &JsValue::NULL)?;
        let environment = read(&parts, "environment")?;
        if !absent(&environment) { call(&environment, "dispose", &[])?; }
        set(&parts, "environment", &JsValue::NULL)?;
        studio_unavailable(host)?;
    }
    Ok(parts)
}
