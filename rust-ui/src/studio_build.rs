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

/// The cabinet studio's lights for a cabinet type: `stage` is `[hemisphere, key, fill, environment, castShadow]`
/// (the key casts a shadow when `castShadow` is 1); the shadow map is redrawn for the new model.
#[wasm_bindgen]
pub fn studio_shelf_lights(parts: &JsValue, stage: &JsValue) -> R<()> {
    let stage = Array::from(stage);
    let lights = read(parts, "lights")?;
    set(&read(&lights, "hemisphere")?, "intensity", &stage.get(0))?;
    set(&read(&lights, "key")?, "intensity", &stage.get(1))?;
    set(&read(&lights, "fill")?, "intensity", &stage.get(2))?;
    set(&read(parts, "scene")?, "environmentIntensity", &stage.get(3))?;
    set(&read(&lights, "key")?, "castShadow", &JsValue::from_bool(stage.get(4) == number(1.0)))?;
    set(&read(&read(parts, "renderer")?, "shadowMap")?, "needsUpdate", &JsValue::TRUE)
}

/// Places a cabinet in its studio: a near-front angle reveals the shallow depth and perforations while retaining
/// an easy comparison of the two furniture silhouettes; centred, added to `scene`, its real size on `host`.
#[wasm_bindgen]
pub fn studio_shelf_place(three: &JsValue, host: &JsValue, scene: &JsValue, model: &JsValue) -> R<()> {
    let three = Three(three);
    call(&read(model, "rotation")?, "set", &[&number(0.075), &number(-0.28), &number(0.0)])?;
    let bounds = call(&three.new("Box3", &[])?, "setFromObject", &[model])?;
    call(&read(model, "position")?, "sub", &[&call(&bounds, "getCenter", &[&three.new("Vector3", &[])?])?])?;
    call(scene, "add", &[model])?;
    let data = read(host, "dataset")?;
    set(&data, "modelWidth", &"600".into())?;
    set(&data, "modelDepth", &"250".into())?;
    set(&data, "modelHeight", &"1160".into())
}

/// Dresses the lamp studio around a freshly made shelf lamp `model` (see `createLampCatalogPreview`): sharper
/// texture filtering, no opaque shadow from glass, the model in `display`, its own light (a cone with its target or
/// a bulb, scaled to the studio's exposure; a filament lamp's strips come from `filaments()`, the host's pool), the
/// stand's surfaces (pushed to `surfaces` and added to `presentation`), the camera, and the whole display centred.
/// Returns `{ fixture, target, size }` (`fixture` and `target` null when not made).
#[wasm_bindgen]
#[allow(clippy::too_many_arguments)]
pub fn studio_lamp_dress(three: &JsValue, host: &JsValue, model: &JsValue, display: &JsValue, presentation: &JsValue, camera: &JsValue,
    renderer: &JsValue, lamp: &JsValue, surfaces: &Array, filaments: &js_sys::Function) -> R<JsValue> {
    let three = Three(three);
    let capabilities = read(renderer, "capabilities")?;
    crate::three_host::traverse(model, &mut |object| {
        if !truthy(&read(object, "isMesh")?) {
            return Ok(());
        }
        let material = read(object, "material")?;
        let materials = if Array::is_array(&material) { Array::from(&material) } else { Array::of1(&material) };
        let mut clear = false;
        for material in materials.iter() {
            if truthy(&read(&material, "transparent")?) || crate::host::num(&read(&material, "transmission")?) > 0.0 {
                clear = true;
                break;
            }
        }
        // Glass keeps the model's transparent shadow behaviour, so the chimney cannot cast an opaque
        // silhouette over its own LED filament.
        if clear {
            set(object, "castShadow", &JsValue::FALSE)?;
        }
        for material in materials.iter() {
            for name in ["map", "bumpMap", "roughnessMap"] {
                let map = read(&material, name)?;
                if truthy(&map) {
                    let most = crate::host::num(&call(&capabilities, "getMaxAnisotropy", &[])?);
                    set(&map, "anisotropy", &number(js_sys::Math::min(8.0, most)))?;
                }
            }
        }
        Ok(())
    })?;
    call(display, "add", &[model])?;
    let emitter = read(&read(model, "userData")?, "lightEmitter")?;
    let dimensions = read(lamp, "dimensions")?;
    let undershelf = read(lamp, "mount")?.as_string().is_some_and(|mount| mount == "undershelf");
    let stage = crate::catalog_studio::studio_lamp_stage(undershelf, crate::host::num(&read(&dimensions, "width")?))?;
    let (mut fixture, mut target) = (JsValue::NULL, JsValue::NULL);
    if !absent(&emitter) && truthy(&read(&emitter, "filaments")?) {
        let intensity = crate::host::num(&read(&emitter, "intensity")?) * crate::host::num(&read(&stage, "filament")?);
        set(&emitter, "intensity", &number(intensity))?;
        filaments.call0(&JsValue::UNDEFINED)?;
    } else if truthy(&emitter) {
        let direction = read(&emitter, "direction")?;
        let intensity = crate::host::num(&read(&emitter, "intensity")?);
        let (color, distance, decay) = (read(&emitter, "color")?, read(&emitter, "distance")?, read(&emitter, "decay")?);
        fixture = if truthy(&direction) {
            let power = number(intensity * crate::host::num(&read(&stage, "cone")?));
            three.new("SpotLight", &[&color, &power, &distance, &read(&emitter, "angle")?, &read(&emitter, "penumbra")?, &decay])?
        } else {
            let power = number(intensity * crate::host::num(&read(&stage, "bulb")?));
            three.new("PointLight", &[&color, &power, &distance, &decay])?
        };
        call(&read(&fixture, "position")?, "fromArray", &[&read(&emitter, "position")?])?;
        call(display, "add", &[&fixture])?;
        if truthy(&direction) {
            target = three.new("Object3D", &[])?;
            let offset = call(&three.new("Vector3", &[])?, "fromArray", &[&direction])?;
            call(&call(&read(&target, "position")?, "copy", &[&read(&fixture, "position")?])?, "add", &[&offset])?;
            call(display, "add", &[&target])?;
            set(&fixture, "target", &target)?;
        }
    }
    for surface in Array::from(&read(&stage, "surfaces")?).iter() {
        let size = Array::from(&read(&surface, "size")?);
        let kind = read(&surface, "kind")?.as_string().unwrap_or_default();
        let geometry = if kind == "box" {
            three.new("BoxGeometry", &[&size.get(0), &size.get(1), &size.get(2)])?
        } else {
            three.new("CircleGeometry", &[&size.get(0), &size.get(1)])?
        };
        let options: JsValue = Object::new().into();
        set(&options, "color", &read(&surface, "color")?)?;
        set(&options, "roughness", &number(0.86))?;
        let mesh = three.new("Mesh", &[&geometry, &three.new("MeshStandardMaterial", &[&options])?])?;
        set(&mesh, "receiveShadow", &JsValue::TRUE)?;
        surfaces.push(&mesh);
        call(presentation, "add", &[&mesh])?;
        if kind == "circle" {
            set(&read(&mesh, "rotation")?, "x", &number(-std::f64::consts::PI / 2.0))?;
        }
        set(&read(&mesh, "position")?, "y", &read(&surface, "y")?)?;
        if truthy(&read(&surface, "cast")?) {
            set(&mesh, "castShadow", &JsValue::TRUE)?;
        }
    }
    spread(&read(camera, "position")?, "set", &read(&stage, "camera")?)?;
    let bounds = call(&three.new("Box3", &[])?, "setFromObject", &[display])?;
    let size = call(&bounds, "getSize", &[&three.new("Vector3", &[])?])?;
    call(&read(display, "position")?, "sub", &[&call(&bounds, "getCenter", &[&three.new("Vector3", &[])?])?])?;
    call(camera, "lookAt", &[&number(0.0), &number(0.0), &number(0.0)])?;
    set(&read(host, "dataset")?, "lightEmitter", &(if truthy(&emitter) { "warm-physical" } else { "none" }).into())?;
    // Its light must exist before linking: every lit program depends on it.
    call(display, "updateMatrixWorld", &[&JsValue::TRUE])?;
    let dressed: JsValue = Object::new().into();
    set(&dressed, "fixture", &fixture)?;
    set(&dressed, "target", &target)?;
    set(&dressed, "size", &size)?;
    Ok(dressed)
}
