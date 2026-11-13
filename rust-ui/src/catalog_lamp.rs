//! The lamp studio's model set-up (formerly `make`, `removeModel`, `prepareScene` and `release` of
//! src/js/lamp-catalog-preview.js): the chosen lamp's glass and texture settings, the fixture's own light and
//! its target, the stand's surfaces, where the camera stands and the centring of the whole display. Every
//! three.js object is made, configured and added in the original's order, so three numbers them the same and
//! the pictures are identical.
//!
//! What it makes lives on `rig`, a plain record the preview owns (`{display, presentation, fixture, target,
//! surfaces, size}`); `host` is the preview's own `{three, host, unlight(), create(lamp), light()}`, whose
//! three functions stay JavaScript: the lamp's builder and the filament lamp's area lights. Nothing here
//! outlives a call: the two traversal callbacks are dropped before it returns.
//!
//! Properties are read and written through declared accessors, each one direct call with no key string to
//! build: a selection touches a few hundred of them.
use std::{cell::RefCell, rc::Rc};
use wasm_bindgen::{prelude::*, JsCast};
use js_sys::{Array, Function, Object};
use crate::host::{absent, call, jmin, num, truthy};

type R<T> = Result<T, JsValue>;

#[wasm_bindgen]
extern "C" {
    /// Any object of this set-up: a three.js object, material, texture, vector or box, the rig, the host.
    type Thing;
    #[wasm_bindgen(method, getter = isMesh, catch)] fn is_mesh(this: &Thing) -> R<JsValue>;
    #[wasm_bindgen(method, getter = isLight, catch)] fn is_light(this: &Thing) -> R<JsValue>;
    #[wasm_bindgen(method, getter, catch)] fn material(this: &Thing) -> R<JsValue>;
    #[wasm_bindgen(method, getter, catch)] fn geometry(this: &Thing) -> R<Thing>;
    #[wasm_bindgen(method, getter, catch)] fn transparent(this: &Thing) -> R<JsValue>;
    #[wasm_bindgen(method, getter, catch)] fn transmission(this: &Thing) -> R<JsValue>;
    #[wasm_bindgen(method, getter, catch)] fn map(this: &Thing) -> R<JsValue>;
    #[wasm_bindgen(method, getter = bumpMap, catch)] fn bump_map(this: &Thing) -> R<JsValue>;
    #[wasm_bindgen(method, getter = roughnessMap, catch)] fn roughness_map(this: &Thing) -> R<JsValue>;
    #[wasm_bindgen(method, getter, catch)] fn capabilities(this: &Thing) -> R<Thing>;
    #[wasm_bindgen(method, catch, js_name = getMaxAnisotropy)] fn max_anisotropy(this: &Thing) -> R<JsValue>;
    #[wasm_bindgen(method, setter, catch)] fn set_anisotropy(this: &Thing, value: f64) -> R<()>;
    #[wasm_bindgen(method, setter = castShadow, catch)] fn set_cast_shadow(this: &Thing, value: bool) -> R<()>;
    #[wasm_bindgen(method, setter = receiveShadow, catch)] fn set_receive_shadow(this: &Thing, value: bool) -> R<()>;
    #[wasm_bindgen(method, setter = needsUpdate, catch)] fn set_needs_update(this: &Thing, value: bool) -> R<()>;
    #[wasm_bindgen(method, getter = userData, catch)] fn user_data(this: &Thing) -> R<Thing>;
    #[wasm_bindgen(method, getter = lightEmitter, catch)] fn light_emitter(this: &Thing) -> R<JsValue>;
    #[wasm_bindgen(method, setter = lightEmitter, catch)] fn set_light_emitter(this: &Thing, value: &str) -> R<()>;
    #[wasm_bindgen(method, setter, catch)] fn set_invalidate(this: &Thing, value: &JsValue) -> R<()>;
    #[wasm_bindgen(method, getter, catch)] fn filaments(this: &Thing) -> R<JsValue>;
    #[wasm_bindgen(method, getter, catch)] fn intensity(this: &Thing) -> R<JsValue>;
    #[wasm_bindgen(method, setter, catch)] fn set_intensity(this: &Thing, value: f64) -> R<()>;
    #[wasm_bindgen(method, getter, catch)] fn direction(this: &Thing) -> R<JsValue>;
    #[wasm_bindgen(method, getter, catch)] fn color(this: &Thing) -> R<JsValue>;
    #[wasm_bindgen(method, getter, catch)] fn distance(this: &Thing) -> R<JsValue>;
    #[wasm_bindgen(method, getter, catch)] fn angle(this: &Thing) -> R<JsValue>;
    #[wasm_bindgen(method, getter, catch)] fn penumbra(this: &Thing) -> R<JsValue>;
    #[wasm_bindgen(method, getter, catch)] fn decay(this: &Thing) -> R<JsValue>;
    #[wasm_bindgen(method, getter, catch)] fn position(this: &Thing) -> R<Thing>;
    #[wasm_bindgen(method, getter, catch)] fn rotation(this: &Thing) -> R<Thing>;
    #[wasm_bindgen(method, setter, catch)] fn set_x(this: &Thing, value: f64) -> R<()>;
    #[wasm_bindgen(method, setter, catch)] fn set_y(this: &Thing, value: f64) -> R<()>;
    #[wasm_bindgen(method, getter, catch)] fn display(this: &Thing) -> R<Thing>;
    #[wasm_bindgen(method, setter, catch)] fn set_display(this: &Thing, value: &Thing) -> R<()>;
    #[wasm_bindgen(method, getter, catch)] fn presentation(this: &Thing) -> R<Thing>;
    #[wasm_bindgen(method, setter, catch)] fn set_presentation(this: &Thing, value: &Thing) -> R<()>;
    #[wasm_bindgen(method, getter, catch)] fn fixture(this: &Thing) -> R<JsValue>;
    #[wasm_bindgen(method, setter, catch)] fn set_fixture(this: &Thing, value: &JsValue) -> R<()>;
    #[wasm_bindgen(method, getter, catch)] fn target(this: &Thing) -> R<JsValue>;
    #[wasm_bindgen(method, setter, catch)] fn set_target(this: &Thing, value: &JsValue) -> R<()>;
    #[wasm_bindgen(method, getter, catch)] fn surfaces(this: &Thing) -> R<Thing>;
    #[wasm_bindgen(method, setter, catch)] fn set_size(this: &Thing, value: &JsValue) -> R<()>;
    #[wasm_bindgen(method, getter, catch)] fn three(this: &Thing) -> R<Thing>;
    #[wasm_bindgen(method, getter, catch)] fn host(this: &Thing) -> R<Thing>;
    #[wasm_bindgen(method, getter, catch)] fn dataset(this: &Thing) -> R<Thing>;
    #[wasm_bindgen(method, getter, catch)] fn renderer(this: &Thing) -> R<Thing>;
    #[wasm_bindgen(method, getter, catch)] fn camera(this: &Thing) -> R<Thing>;
    #[wasm_bindgen(method, getter = shadowMap, catch)] fn shadow_map(this: &Thing) -> R<Thing>;
    #[wasm_bindgen(method, getter = dispose, catch)] fn disposer(this: &Thing) -> R<JsValue>;
    #[wasm_bindgen(method, getter, catch)] fn mount(this: &Thing) -> R<JsValue>;
    #[wasm_bindgen(method, getter, catch)] fn dimensions(this: &Thing) -> R<Thing>;
    #[wasm_bindgen(method, getter, catch)] fn width(this: &Thing) -> R<JsValue>;
    #[wasm_bindgen(method, catch)] fn add(this: &Thing, child: &JsValue) -> R<Thing>;
    #[wasm_bindgen(method, catch)] fn remove(this: &Thing, child: &JsValue) -> R<JsValue>;
    #[wasm_bindgen(method, catch)] fn clear(this: &Thing) -> R<JsValue>;
    #[wasm_bindgen(method, catch)] fn dispose(this: &Thing) -> R<JsValue>;
    #[wasm_bindgen(method, catch)] fn set(this: &Thing, x: &JsValue, y: &JsValue, z: &JsValue) -> R<JsValue>;
    #[wasm_bindgen(method, catch, js_name = fromArray)] fn from_array(this: &Thing, values: &JsValue) -> R<JsValue>;
    #[wasm_bindgen(method, catch)] fn copy(this: &Thing, other: &Thing) -> R<Thing>;
    #[wasm_bindgen(method, catch)] fn sub(this: &Thing, other: &JsValue) -> R<JsValue>;
    #[wasm_bindgen(method, catch, js_name = lookAt)] fn look_at(this: &Thing, x: f64, y: f64, z: f64) -> R<JsValue>;
    #[wasm_bindgen(method, catch, js_name = setFromObject)] fn set_from_object(this: &Thing, object: &Thing) -> R<Thing>;
    #[wasm_bindgen(method, catch, js_name = getSize)] fn get_size(this: &Thing, into: &JsValue) -> R<JsValue>;
    #[wasm_bindgen(method, catch, js_name = getCenter)] fn get_center(this: &Thing, into: &JsValue) -> R<JsValue>;
    #[wasm_bindgen(method, catch, js_name = updateMatrixWorld)] fn update_matrix_world(this: &Thing, force: bool) -> R<JsValue>;
    #[wasm_bindgen(method, catch)] fn traverse(this: &Thing, visit: &JsValue) -> R<JsValue>;
    #[wasm_bindgen(method, catch)] fn splice(this: &Thing, start: f64) -> R<Array>;
    #[wasm_bindgen(method, catch)] fn push(this: &Thing, value: &JsValue) -> R<JsValue>;
    #[wasm_bindgen(method, catch)] fn unlight(this: &Thing) -> R<JsValue>;
    #[wasm_bindgen(method, catch)] fn create(this: &Thing, lamp: &JsValue) -> R<Thing>;
    #[wasm_bindgen(method, catch)] fn light(this: &Thing) -> R<JsValue>;
    // three's classes, read off its namespace.
    #[wasm_bindgen(method, getter = Group, catch)] fn group_class(this: &Thing) -> R<JsValue>;
    #[wasm_bindgen(method, getter = SpotLight, catch)] fn spot_class(this: &Thing) -> R<JsValue>;
    #[wasm_bindgen(method, getter = PointLight, catch)] fn point_class(this: &Thing) -> R<JsValue>;
    #[wasm_bindgen(method, getter = Object3D, catch)] fn object_class(this: &Thing) -> R<JsValue>;
    #[wasm_bindgen(method, getter = Vector3, catch)] fn vector_class(this: &Thing) -> R<JsValue>;
    #[wasm_bindgen(method, getter = Box3, catch)] fn box_class(this: &Thing) -> R<JsValue>;
    #[wasm_bindgen(method, getter = BoxGeometry, catch)] fn box_geometry_class(this: &Thing) -> R<JsValue>;
    #[wasm_bindgen(method, getter = CircleGeometry, catch)] fn circle_geometry_class(this: &Thing) -> R<JsValue>;
    #[wasm_bindgen(method, getter = MeshStandardMaterial, catch)] fn standard_class(this: &Thing) -> R<JsValue>;
    #[wasm_bindgen(method, getter = Mesh, catch)] fn mesh_class(this: &Thing) -> R<JsValue>;
    #[wasm_bindgen(method, setter = color, catch)] fn set_color_option(this: &Thing, value: &JsValue) -> R<()>;
    #[wasm_bindgen(method, setter = roughness, catch)] fn set_roughness_option(this: &Thing, value: f64) -> R<()>;
}

fn thing(value: &JsValue) -> &Thing { value.unchecked_ref() }
fn number(value: f64) -> JsValue { JsValue::from_f64(value) }
/// `new class(...args)`.
fn make(class: JsValue, name: &str, args: &[&JsValue]) -> R<Thing> {
    let class: Function = class.dyn_into().map_err(|_| JsValue::from(js_sys::TypeError::new(&format!("THREE.{name} is not a constructor"))))?;
    let list = Array::new();
    for argument in args { list.push(argument); }
    Ok(js_sys::Reflect::construct(&class, &list)?.unchecked_into())
}
/// `root.traverse(object => visit(object))`; the first failure stops the work and is thrown once three returns.
fn walk(root: &Thing, mut visit: impl FnMut(&Thing) -> R<()> + 'static) -> R<()> {
    let failure: Rc<RefCell<Option<JsValue>>> = Rc::new(RefCell::new(None));
    let seen = failure.clone();
    let callback = Closure::<dyn FnMut(JsValue)>::new(move |object: JsValue| {
        if seen.borrow().is_some() { return; }
        if let Err(error) = visit(thing(&object)) { *seen.borrow_mut() = Some(error); }
    });
    let walked = root.traverse(callback.as_ref());
    drop(callback);
    if let Some(error) = failure.borrow_mut().take() { return Err(error); }
    walked.map(|_| ())
}

/// The display group and, inside it, the group of the stand's surfaces.
#[wasm_bindgen]
pub fn studio_lamp_scene(rig: &JsValue, three: &JsValue, scene: &JsValue) -> R<()> {
    let (rig, three) = (thing(rig), thing(three));
    let display = make(three.group_class()?, "Group", &[])?;
    thing(scene).add(&display)?;
    let presentation = make(three.group_class()?, "Group", &[])?;
    display.add(&presentation)?;
    rig.set_display(&display)?;
    rig.set_presentation(&presentation)
}

/// Takes the lamp, its light and its stand out of the display and disposes of them.
fn empty(rig: &Thing, host: &Thing, model: &JsValue) -> R<()> {
    host.unlight()?;
    let display = rig.display()?;
    if truthy(model) {
        display.remove(model)?;
        // `(model.dispose || model.userData.dispose)?.()`
        let mut dispose = thing(model).disposer()?;
        if !truthy(&dispose) { dispose = thing(model).user_data()?.disposer()?; }
        if !absent(&dispose) { call(&dispose, "dispose", &[])?; }
    }
    let fixture = rig.fixture()?;
    if truthy(&fixture) {
        display.remove(&fixture)?;
        thing(&fixture).dispose()?;
        rig.set_fixture(&JsValue::NULL)?;
    }
    let target = rig.target()?;
    if truthy(&target) {
        display.remove(&target)?;
        rig.set_target(&JsValue::NULL)?;
    }
    rig.presentation()?.clear()?;
    for mesh in rig.surfaces()?.splice(0.0)?.iter() {
        thing(&mesh).geometry()?.dispose()?;
        thing(&thing(&mesh).material()?).dispose()?;
    }
    Ok(())
}

/// Builds the chosen lamp in place of `previous` and returns it. `parts` are the studio's own (`renderer`,
/// `camera`); the preview tints the lamp and lights its filaments after this.
#[wasm_bindgen]
pub fn studio_lamp_make(rig: &JsValue, host: &JsValue, parts: &JsValue, lamp: &JsValue, previous: &JsValue, invalidate: &JsValue) -> R<JsValue> {
    let (rig, host, parts) = (thing(rig), thing(host), thing(parts));
    let three = host.three()?;
    let (renderer, camera) = (parts.renderer()?, parts.camera()?);
    empty(rig, host, previous)?;
    let display = rig.display()?;
    let zero = number(0.0);
    display.position()?.set(&zero, &zero, &zero)?;
    renderer.shadow_map()?.set_needs_update(true)?;
    let model = host.create(lamp)?;
    model.user_data()?.set_invalidate(invalidate)?;
    walk(&model, move |object| {
        if !truthy(&object.is_mesh()?) { return Ok(()); }
        // Glass keeps the model's transparent shadow behaviour, so the chimney cannot cast an opaque
        // silhouette over its own LED filament.
        let material = object.material()?;
        let materials: Vec<JsValue> = if Array::is_array(&material) { material.unchecked_into::<Array>().to_vec() } else { vec![material] };
        let mut clear_glass = false;
        for material in &materials {
            let material = thing(material);
            if truthy(&material.transparent()?) || num(&material.transmission()?) > 0.0 { clear_glass = true; break; }
        }
        if clear_glass { object.set_cast_shadow(false)?; }
        for material in &materials {
            let material = thing(material);
            for texture in [material.map()?, material.bump_map()?, material.roughness_map()?] {
                if truthy(&texture) { thing(&texture).set_anisotropy(jmin(8.0, num(&renderer.capabilities()?.max_anisotropy()?)))?; }
            }
        }
        Ok(())
    })?;
    display.add(&model)?;
    let emitter = model.user_data()?.light_emitter()?;
    let lamp = thing(lamp);
    let stage = crate::catalog_studio::lamp_stage(lamp.mount()? == JsValue::from_str("undershelf"), num(&lamp.dimensions()?.width()?));
    if !absent(&emitter) && truthy(&thing(&emitter).filaments()?) {
        let emitter = thing(&emitter);
        emitter.set_intensity(num(&emitter.intensity()?) * stage.filament)?;
        host.light()?;
    } else if truthy(&emitter) {
        let emitter = thing(&emitter);
        let fixture = if truthy(&emitter.direction()?) {
            make(three.spot_class()?, "SpotLight", &[&emitter.color()?, &number(num(&emitter.intensity()?) * stage.cone), &emitter.distance()?,
                &emitter.angle()?, &emitter.penumbra()?, &emitter.decay()?])?
        } else {
            make(three.point_class()?, "PointLight", &[&emitter.color()?, &number(num(&emitter.intensity()?) * stage.bulb), &emitter.distance()?, &emitter.decay()?])?
        };
        rig.set_fixture(&fixture)?;
        let place = emitter.position()?;
        fixture.position()?.from_array(&place)?;
        display.add(&fixture)?;
        if truthy(&emitter.direction()?) {
            let target = make(three.object_class()?, "Object3D", &[])?;
            rig.set_target(&target)?;
            let aimed = target.position()?.copy(&fixture.position()?)?;
            thing(&aimed).add(&make(three.vector_class()?, "Vector3", &[])?.from_array(&emitter.direction()?)?)?;
            display.add(&target)?;
            fixture.set_target(&target)?;
        }
    }
    let (surfaces, presentation) = (rig.surfaces()?, rig.presentation()?);
    for surface in &stage.surfaces {
        let (a, b) = (number(surface.size[0]), number(surface.size[1]));
        let geometry = if surface.round { make(three.circle_geometry_class()?, "CircleGeometry", &[&a, &b])? }
            else { make(three.box_geometry_class()?, "BoxGeometry", &[&a, &b, &number(surface.size[2])])? };
        let options: JsValue = Object::new().into();
        thing(&options).set_color_option(&JsValue::from_str(surface.color))?;
        thing(&options).set_roughness_option(0.86)?;
        let material = make(three.standard_class()?, "MeshStandardMaterial", &[&options])?;
        let mesh = make(three.mesh_class()?, "Mesh", &[&geometry, &material])?;
        mesh.set_receive_shadow(true)?;
        surfaces.push(&mesh)?;
        presentation.add(&mesh)?;
        if surface.round { mesh.rotation()?.set_x(-std::f64::consts::PI / 2.0)?; }
        mesh.position()?.set_y(surface.y)?;
        if surface.cast { mesh.set_cast_shadow(true)?; }
    }
    camera.position()?.set(&number(stage.camera[0]), &number(stage.camera[1]), &number(stage.camera[2]))?;
    let bounds = make(three.box_class()?, "Box3", &[])?.set_from_object(&display)?;
    let size = make(three.vector_class()?, "Vector3", &[])?;
    rig.set_size(&bounds.get_size(&size)?)?;
    let centre = make(three.vector_class()?, "Vector3", &[])?;
    display.position()?.sub(&bounds.get_center(&centre)?)?;
    camera.look_at(0.0, 0.0, 0.0)?;
    host.host()?.dataset()?.set_light_emitter(if truthy(&emitter) { "warm-physical" } else { "none" })?;
    // Its light must exist before linking: every lit program depends on it.
    display.update_matrix_world(true)?;
    Ok(model.into())
}

/// The studio is closed: the lamp, its light and its stand go, and every light left in the scene is disposed of.
#[wasm_bindgen]
pub fn studio_lamp_release(rig: &JsValue, host: &JsValue, model: &JsValue, scene: &JsValue) -> R<()> {
    empty(thing(rig), thing(host), model)?;
    walk(thing(scene), |object| { if truthy(&object.is_light()?) { object.dispose()?; } Ok(()) })
}
