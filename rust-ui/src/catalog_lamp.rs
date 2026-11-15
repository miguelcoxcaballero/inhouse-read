//! The lamp studio (formerly the whole adapter of src/js/lamp-catalog-preview.js: `make`, `removeModel`,
//! `prepareScene`, `release`, `retint`, `tintSet`, `applyTint`, the filament lamp's lighting and the lamp's
//! builder call): the chosen lamp's glass and texture settings, the fixture's own light and its target, the
//! stand's surfaces, where the camera stands, the centring of the whole display and the colour temperature
//! that eases in. Every three.js object is made, configured and added in the original's order, so three
//! numbers them the same and the pictures are identical.
//!
//! What it makes lives on `rig`, a plain record the preview owns (`{host, createShelfLamp,
//! createShelfLampLighting, tintLamp, tints, ms, display, presentation, fixture, target, surfaces}`): the
//! lamp's builder, the filament lamp's area lights and the one function that writes a tint on three's
//! colours stay JavaScript. What a frame reads is on the studio's own record (`size`, `lighting`, `entries`,
//! `slot`). The transition's eighteen numbers are kept here, one slot per open studio, freed when it closes;
//! the studio's state says in `tinting` whether a frame has anything to ease (slot + 1) or not (its negative),
//! so a frame at rest reads one number. Nothing else outlives a call: the two traversal callbacks are
//! dropped before it returns.
//!
//! Properties are read and written through declared accessors, each one direct call with no key string to
//! build: a selection touches a few hundred of them.
use std::{cell::RefCell, rc::Rc};
use wasm_bindgen::{prelude::*, JsCast};
use js_sys::{Array, Function, Object};
use crate::host::{absent, call, function_of, get, jmin, method, num, read, set, truthy};
use crate::studio_tint::{studio_tint_set, studio_tint_step, BUSY, FRESH, SHOWN, VALUE};

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
    #[wasm_bindgen(method, catch, js_name = tintLamp)] fn tint_lamp(this: &Thing, model: &JsValue, r: f64, g: f64, b: f64) -> R<JsValue>;
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

/// What one open lamp studio keeps here: the transition (rust-ui/src/studio_tint.rs) and the table it reads.
struct Tint { state: [f64; 18], tints: Vec<f64>, ms: f64 }
thread_local! { static TINTS: RefCell<Vec<Option<Tint>>> = const { RefCell::new(Vec::new()) }; }
fn tint<T>(slot: usize, work: impl FnOnce(&mut Tint) -> T) -> Option<T> {
    TINTS.with(|all| all.borrow_mut().get_mut(slot).and_then(Option::as_mut).map(work))
}
fn slot_of(record: &JsValue) -> usize { num(&get(record, "slot")) as usize }

/// The display group and, inside it, the group of the stand's surfaces.
pub(crate) fn scene(rig: &JsValue, three: &JsValue, scene: &JsValue) -> R<()> {
    let (rig, three) = (thing(rig), thing(three));
    let display = make(three.group_class()?, "Group", &[])?;
    thing(scene).add(&display)?;
    let presentation = make(three.group_class()?, "Group", &[])?;
    display.add(&presentation)?;
    rig.set_display(&display)?;
    rig.set_presentation(&presentation)
}

/// The studio is open: its transition is made at the default temperature (nothing applied yet), and its
/// state and record learn where it is kept.
pub(crate) fn opened(record: &JsValue, rig: &JsValue, state: &JsValue) -> R<()> {
    let tints = js_sys::Float64Array::new(&read(rig, "tints")?).to_vec();
    let mut made = Tint { state: [0.0; 18], ms: num(&read(rig, "ms")?), tints };
    studio_tint_set(&mut made.state, &made.tints, made.ms, made.tints.first().copied().unwrap_or(f64::NAN), 0.0, false);
    let slot = TINTS.with(|all| {
        let mut all = all.borrow_mut();
        match all.iter().position(Option::is_none) { Some(free) => { all[free] = Some(made); free } None => { all.push(Some(made)); all.len() - 1 } }
    });
    set(record, "slot", &number(slot as f64))?;
    set(record, "lighting", &JsValue::NULL)?;
    set(state, "lamp", record)?;
    set(state, "rig", rig)?;
    set(state, "tinting", &number((slot + 1) as f64))
}

/// The tint shown becomes the transition's value: the lamp's own materials and its fixture's light.
fn apply_tint(rig: &JsValue, slot: usize, model: &JsValue) -> R<()> {
    let Some([r, g, b]) = tint(slot, |tint| {
        let value = [tint.state[VALUE], tint.state[VALUE + 1], tint.state[VALUE + 2]];
        tint.state.copy_within(VALUE..VALUE + 3, SHOWN); tint.state[FRESH] = 0.0;
        value
    }) else { return Ok(()); };
    thing(rig).tint_lamp(model, r, g, b).map(|_| ())
}

/// One frame of a studio whose transition has something to do. 1: still easing; 2: the shown tint changed
/// and was applied.
pub(crate) fn retint(state: &JsValue, slot: usize, now: f64) -> R<u32> {
    let Some((code, busy)) = tint(slot, |tint| { let code = studio_tint_step(&mut tint.state, now); (code, tint.state[BUSY] != 0.0) }) else { return Ok(0); };
    if !busy { set(state, "tinting", &number(-((slot + 1) as f64)))?; }
    if code & 2 != 0 { apply_tint(&get(state, "rig"), slot, &get(state, "model"))?; }
    Ok(code)
}

/// A colour temperature is asked for (`tinting` is the state's): true when it is not the one in use.
pub(crate) fn tint_set(state: &JsValue, tinting: f64, kelvin: &JsValue, now: f64, animate: bool) -> R<bool> {
    let (slot, kelvin) = (tinting.abs() as usize - 1, num(kelvin));
    let changed = tint(slot, |tint| studio_tint_set(&mut tint.state, &tint.tints, tint.ms, kelvin, now, animate)).unwrap_or(false);
    if tint(slot, |tint| tint.state[BUSY] != 0.0) == Some(true) { set(state, "tinting", &number((slot + 1) as f64))?; }
    Ok(changed)
}

/// The filament lamp's area lights follow the lamp shown (before each picture).
pub(crate) fn light_filaments(lighting: &JsValue, record: &JsValue) -> R<()> {
    if !absent(lighting) { method(lighting, "update", &[&get(record, "entries")])?; }
    Ok(())
}

/// Takes the lamp, its light and its stand out of the display and disposes of them.
fn empty(record: &JsValue, rig: &Thing, model: &JsValue) -> R<()> {
    let lighting = get(record, "lighting");
    if !absent(&lighting) { method(&lighting, "dispose", &[])?; }
    set(record, "lighting", &JsValue::NULL)?;
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

/// Builds the chosen lamp in place of `previous`, tints it, lights its filaments and returns it. `record` is
/// the studio's own (`lamp` the rig, `parts` with `renderer`, `camera` and `scene`).
pub(crate) fn build(state: &JsValue, record: &JsValue, lamp: &JsValue, previous: &JsValue, invalidate: &JsValue) -> R<JsValue> {
    let (rig, slot) = (get(record, "lamp"), slot_of(record));
    let model = set_up(state, record, thing(&rig), slot, lamp, previous, invalidate)?;
    apply_tint(&rig, slot, &model)?;
    let lighting = get(record, "lighting");
    if !absent(&lighting) {
        let entry: JsValue = Object::new().into();
        set(&entry, "kind", &"lamp".into())?; set(&entry, "key", &"catalog-filaments".into())?;
        set(&entry, "model", &model)?; set(&entry, "width", &read(&get(record, "size"), "x")?)?;
        set(record, "entries", &Array::of1(&entry))?;
    }
    light_filaments(&lighting, record)?;
    Ok(model)
}

fn set_up(state: &JsValue, record: &JsValue, rig: &Thing, slot: usize, lamp: &JsValue, previous: &JsValue, invalidate: &JsValue) -> R<JsValue> {
    let parts = get(record, "parts");
    let parts = thing(&parts);
    let three = get(record, "three");
    let three = thing(&three);
    let (renderer, camera) = (parts.renderer()?, parts.camera()?);
    empty(record, rig, previous)?;
    let display = rig.display()?;
    let zero = number(0.0);
    display.position()?.set(&zero, &zero, &zero)?;
    renderer.shadow_map()?.set_needs_update(true)?;
    let options: JsValue = Object::new().into();
    set(&options, "lampId", &read(lamp, "id")?)?; set(&options, "width", &read(&read(lamp, "dimensions")?, "width")?)?;
    set(&options, "quality", &"high".into())?;
    set(&options, "kelvin", &number(tint(slot, |tint| tint.state[0]).unwrap_or(f64::NAN)))?;
    let model: Thing = function_of(rig, "createShelfLamp", &[&options])?.unchecked_into();
    // A new lamp shows no tint yet: the next frame applies the transition's.
    tint(slot, |tint| { tint.state[FRESH] = 1.0; tint.state[BUSY] = 1.0; });
    set(state, "tinting", &number((slot + 1) as f64))?;
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
        let options: JsValue = Object::new().into();
        set(&options, "maxLights", &number(1.0))?; set(&options, "filamentAreas", &JsValue::TRUE)?;
        set(record, "lighting", &function_of(rig, "createShelfLampLighting", &[&get(&get(record, "parts"), "scene"), &options])?)?;
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
    set(record, "size", &bounds.get_size(&size)?)?;
    let centre = make(three.vector_class()?, "Vector3", &[])?;
    display.position()?.sub(&bounds.get_center(&centre)?)?;
    camera.look_at(0.0, 0.0, 0.0)?;
    rig.host()?.dataset()?.set_light_emitter(if truthy(&emitter) { "warm-physical" } else { "none" })?;
    // Its light must exist before linking: every lit program depends on it.
    display.update_matrix_world(true)?;
    Ok(model.into())
}

/// The studio is closed: the lamp, its light and its stand go, every light left in the scene is disposed of,
/// and its transition's slot is free again.
pub(crate) fn release(record: &JsValue, model: &JsValue) -> R<()> {
    let slot = slot_of(record);
    TINTS.with(|all| if let Some(kept) = all.borrow_mut().get_mut(slot) { *kept = None; });
    empty(record, thing(&get(record, "lamp")), model)?;
    walk(thing(&get(&get(record, "parts"), "scene")), |object| { if truthy(&object.is_light()?) { object.dispose()?; } Ok(()) })
}
