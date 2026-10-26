//! The shelf's props as finished three.js objects: the wastebasket, the hanging catalogue and the BAGGEBO.
//!
//! Each of them used to be assembled in JavaScript from this module's packets (shelf-trash.js,
//! shelf-catalog.js, baggebo-model.js). The assembly — which objects, in which order, with which names,
//! shadows, textures, materials and metadata, and what disposing them releases — now runs here, on the
//! `three` namespace the host passes in (see `three_host`). The host keeps only the closures three's callers
//! hold (`setState`, `getMouth`, `dispose`), which call back into the functions below with the model's state.
use js_sys::{Array, Object, Set};
use std::cell::RefCell;
use wasm_bindgen::{prelude::*, JsCast};

use crate::host::{num, read, set, truthy};
use crate::three_host::{build_nodes, call, data_texture, make_materials, number, traverse, user_data, Packet, Three, R};

/// `options` of a `({ a = .., b = .. } = {})` parameter: `undefined` stands for `{}`, `null` cannot be destructured.
fn destructured(options: &JsValue, first: &str) -> R<Option<JsValue>> {
    if options.is_undefined() {
        return Ok(None);
    }
    if options.is_null() {
        return Err(js_sys::TypeError::new(&format!("Cannot destructure property '{first}' of 'object null' as it is null.")).into());
    }
    Ok(Some(options.clone()))
}

/// `options[key]`, or `fallback` when it is `undefined` (a destructuring default).
fn option_or(options: &Option<JsValue>, key: &str, fallback: f64) -> R<JsValue> {
    let value = match options {
        Some(options) => read(options, key)?,
        None => JsValue::UNDEFINED,
    };
    Ok(if value.is_undefined() { number(fallback) } else { value })
}

fn true_value() -> JsValue { JsValue::TRUE }

/// The state object a model's closures carry back: plain properties, so it is owned by the JS heap.
fn state_object(fields: &[(&str, &JsValue)]) -> R<JsValue> {
    let state: JsValue = Object::new().into();
    for (key, value) in fields {
        set(&state, key, value)?;
    }
    Ok(state)
}

fn dispose_each(list: &JsValue) -> R<()> {
    // Sets and arrays both iterate in insertion order.
    let values = Array::from(list);
    for value in values.iter() {
        call(&value, "dispose", &[])?;
    }
    Ok(())
}

// ---------------------------------------------------------------------------------------------- wastebasket

/// The fine orange-peel texture of a powder coat (R relief, G roughness): the 64 px field of `powder_coat`.
fn powder_coat(three: &Three) -> R<JsValue> {
    let texture = data_texture(three, &crate::shelf_trash::powder_coat(), 64.0, 64.0)?;
    let repeat = three.constant("RepeatWrapping")?;
    set(&texture, "wrapT", &repeat)?;
    set(&texture, "wrapS", &repeat)?;
    call(&read(&texture, "repeat")?, "set", &[&number(12.0), &number(12.0)])?;
    set(&texture, "magFilter", &three.constant("LinearFilter")?)?;
    set(&texture, "minFilter", &three.constant("LinearMipmapLinearFilter")?)?;
    set(&texture, "generateMipmaps", &true_value())?;
    set(&texture, "needsUpdate", &true_value())?;
    Ok(texture)
}

/// `createShelfTrash({ radius = 44, height = 140 } = {})`: a powder-coated steel pedal bin with a rolled rim, a
/// removable inner bucket, a moulded base with a brushed-steel pedal and a domed stainless lid on a rear hinge.
/// `closures(state)` gives the host's `{ setState, getMouth, dispose }` for the bin's state (`basket`, `lid`,
/// `mouth` and what `trash_dispose` releases); `setState` and `getMouth` run every frame of a drop, so they are the
/// host's own closures over the lid and the root.
#[wasm_bindgen]
pub fn trash_create(three: &JsValue, options: &JsValue, closures: &js_sys::Function) -> R<JsValue> {
    let three = Three(three);
    let options = destructured(options, "radius")?;
    let (radius, height) = (option_or(&options, "radius", 44.0)?, option_or(&options, "height", 140.0)?);
    let size = crate::shelf_trash::trash_size(&radius, &height);
    let (size, tall, mouth) = (size[0], size[1], size[2]);
    let basket = three.new("Group", &[])?;
    set(&basket, "name", &"Shelf wastebasket".into())?;
    let peel = powder_coat(&three)?;
    let textures = Set::new(&JsValue::UNDEFINED);
    textures.add(&peel);
    let packet = Packet::open(crate::shelf_trash::trash_model(size, tall))?;
    let materials = Object::new();
    let values = state_object(&[("peel", &peel)])?;
    make_materials(&three, &read(&packet.header, "materials")?, &values, &materials)?;
    let objects = build_nodes(&three, &packet, materials.as_ref(), &basket)?;
    let mut lid = JsValue::UNDEFINED;
    for object in &objects {
        if truthy(&read(object, "isGroup")?) {
            lid = object.clone();
            break;
        }
    }
    traverse(&basket, &mut |mesh| {
        if truthy(&read(mesh, "isMesh")?) {
            set(mesh, "castShadow", &true_value())?;
            set(mesh, "receiveShadow", &true_value())?;
        }
        Ok(())
    })?;
    let geometries = Set::new(&JsValue::UNDEFINED);
    let owned = Set::new(&JsValue::UNDEFINED);
    traverse(&basket, &mut |mesh| {
        let geometry = read(mesh, "geometry")?;
        if truthy(&geometry) {
            geometries.add(&geometry);
        }
        let material = read(mesh, "material")?;
        if truthy(&material) {
            owned.add(&material);
        }
        Ok(())
    })?;
    let data = user_data(&basket)?;
    set(&data, "trash", &true_value())?;
    set(&data, "radius", &number(size))?;
    set(&data, "height", &number(tall))?;
    set(&data, "lid", &lid)?;
    let state = state_object(&[
        ("basket", &basket), ("lid", &lid), ("mouth", &number(mouth)), ("disposed", &JsValue::FALSE),
        ("geometries", geometries.as_ref()), ("materials", owned.as_ref()), ("textures", textures.as_ref()),
    ])?;
    let hooks = closures.call1(&JsValue::UNDEFINED, &state)?;
    for key in ["setState", "getMouth", "dispose"] {
        set(&data, key, &read(&hooks, key)?)?;
    }
    call(&data, "setState", &[])?;
    Ok(basket)
}

/// `dispose()`: releases the bin's geometries, materials and texture once.
#[wasm_bindgen]
pub fn trash_dispose(state: &JsValue) -> R<()> {
    if truthy(&read(state, "disposed")?) {
        return Ok(());
    }
    set(state, "disposed", &true_value())?;
    dispose_each(&read(state, "geometries")?)?;
    dispose_each(&read(state, "materials")?)?;
    dispose_each(&read(state, "textures")?)
}

// ---------------------------------------------------------------------------------------------- catalogue

/// `createShelfCatalog({ width = 76, height = 108, thickness = 3.4 } = {})`: a saddle-stitched paper catalogue
/// hanging from a steel bulldog clip on a pin in the outside of the cabinet. Local +Z is the cover, -Z faces the
/// cabinet wall; the cover art is drawn on a canvas of `document`. `closures(state)` gives `{ dispose }`.
#[wasm_bindgen]
pub fn catalog_create(three: &JsValue, document: &JsValue, options: &JsValue, closures: &js_sys::Function) -> R<JsValue> {
    let three = Three(three);
    let options = destructured(options, "width")?;
    let width = option_or(&options, "width", 76.0)?;
    let height = option_or(&options, "height", 108.0)?;
    let thickness = option_or(&options, "thickness", 3.4)?;
    let catalogue = three.new("Group", &[])?;
    set(&catalogue, "name", &"ikea-plant-catalog".into())?;
    set(&user_data(&catalogue)?, "catalog", &true_value())?;
    let packet = Packet::open(crate::shelf_catalog::catalog_model(num(&width), num(&height), num(&thickness)))?;
    let textures = Set::new(&JsValue::UNDEFINED);
    let roles: Array = read(&packet.header, "materials")?.unchecked_into();
    let materials = Object::new();
    make_materials(&three, roles.slice(0, 3).as_ref(), &Object::new().into(), &materials)?;
    let canvas = call(document, "createElement", &[&"canvas".into()])?;
    let size = crate::shelf_catalog::catalog_canvas_size(num(&width), num(&height));
    set(&canvas, "width", &number(size[0]))?;
    set(&canvas, "height", &number(size[1]))?;
    let context = call(&canvas, "getContext", &[&"2d".into()])?;
    if !context.is_null() && !context.is_undefined() && truthy(&read(&context, "fillRect")?) {
        crate::shelf_catalog::catalog_draw_cover(&context, num(&read(&canvas, "width")?), num(&read(&canvas, "height")?))?;
    }
    let map = three.new("CanvasTexture", &[&canvas])?;
    set(&map, "colorSpace", &three.constant("SRGBColorSpace")?)?;
    set(&map, "anisotropy", &number(4.0))?;
    textures.add(&map);
    let rest = Object::new();
    make_materials(&three, roles.slice(3, roles.length()).as_ref(), &state_object(&[("map", &map)])?, &rest)?;
    Object::assign(&materials, &rest);
    for item in build_nodes(&three, &packet, materials.as_ref(), &catalogue)? {
        set(&item, "castShadow", &true_value())?;
        set(&item, "receiveShadow", &true_value())?;
    }
    let data = user_data(&catalogue)?;
    let bounds = three.new("Box3", &[])?;
    set(&data, "bounds", &call(&bounds, "setFromObject", &[&catalogue])?)?;
    set(&data, "width", &width)?;
    set(&data, "height", &height)?;
    set(&data, "thickness", &thickness)?;
    let state = state_object(&[("catalogue", &catalogue), ("materials", materials.as_ref()), ("textures", textures.as_ref()), ("disposed", &JsValue::FALSE)])?;
    set(&data, "dispose", &read(&closures.call1(&JsValue::UNDEFINED, &state)?, "dispose")?)?;
    Ok(catalogue)
}

/// The catalogue's `dispose()`: its children's geometries (as they are when it is called), its materials and
/// its cover texture, once.
#[wasm_bindgen]
pub fn catalog_dispose(state: &JsValue) -> R<()> {
    if truthy(&read(state, "disposed")?) {
        return Ok(());
    }
    set(state, "disposed", &true_value())?;
    let children: Array = read(&read(state, "catalogue")?, "children")?.unchecked_into();
    for item in children.iter() {
        call(&read(&item, "geometry")?, "dispose", &[])?;
    }
    let materials = read(state, "materials")?;
    dispose_each(Object::values(materials.unchecked_ref()).as_ref())?;
    dispose_each(&read(state, "textures")?)
}

// ---------------------------------------------------------------------------------------------- BAGGEBO

thread_local! {
    // The finished furniture as immutable data in this module's memory, not live JS objects: reopening a
    // preview or adding another unit only copies buffers out of it.
    static BAGGEBO: RefCell<Option<std::rc::Rc<Vec<u8>>>> = const { RefCell::new(None) };
    // Each batch's bounding box (min, max) and sphere (centre, radius) as three computed them for the first
    // model: later models take copies, as cloning the template's did, instead of walking every vertex again.
    static BAGGEBO_BOUNDS: RefCell<Vec<[f64; 10]>> = const { RefCell::new(Vec::new()) };
}

fn vector(three: &Three, values: &[f64]) -> R<JsValue> { three.new("Vector3", &[&number(values[0]), &number(values[1]), &number(values[2])]) }

/// Gives `geometry` the bounds of batch `index`, computing and remembering them the first time.
fn baggebo_bounds(three: &Three, geometry: &JsValue, index: usize) -> R<()> {
    if let Some(bounds) = BAGGEBO_BOUNDS.with(|cached| cached.borrow().get(index).copied()) {
        set(geometry, "boundingBox", &three.new("Box3", &[&vector(three, &bounds[0..3])?, &vector(three, &bounds[3..6])?])?)?;
        set(geometry, "boundingSphere", &three.new("Sphere", &[&vector(three, &bounds[6..9])?, &number(bounds[9])])?)?;
        return Ok(());
    }
    call(geometry, "computeBoundingBox", &[])?;
    call(geometry, "computeBoundingSphere", &[])?;
    let (bbox, sphere) = (read(geometry, "boundingBox")?, read(geometry, "boundingSphere")?);
    let mut bounds = [0.0; 10];
    for (at, (object, key)) in [(&bbox, "min"), (&bbox, "max"), (&sphere, "center")].iter().enumerate() {
        let point = read(object, key)?;
        for (offset, axis) in ["x", "y", "z"].iter().enumerate() {
            bounds[at * 3 + offset] = num(&read(&point, axis)?);
        }
    }
    bounds[9] = num(&read(&sphere, "radius")?);
    BAGGEBO_BOUNDS.with(|cached| {
        let mut cached = cached.borrow_mut();
        if cached.len() == index { cached.push(bounds); }
    });
    Ok(())
}

/// The template packet, drawn once; only its bytes are kept (no JS value outlives a call).
fn baggebo_packet() -> R<Packet> {
    let bytes = match BAGGEBO.with(|cached| cached.borrow().clone()) {
        Some(bytes) => bytes,
        None => {
            let bytes = std::rc::Rc::new(crate::baggebo_model::template());
            BAGGEBO.with(|cached| *cached.borrow_mut() = Some(bytes.clone()));
            bytes
        }
    };
    Packet::open_shared(bytes)
}

/// `createBaggebo({ width = 600 } = {})` with the cabinet's specification `spec`: BAGGEBO 504.811.72 in
/// millimetres at width 600 (x centred, top y=0, feet y=-1160, front z=0 and back z=-250), scaled uniformly.
/// `closures(state)` gives `{ dispose }`.
#[wasm_bindgen]
pub fn baggebo_create(three: &JsValue, options: &JsValue, spec: &JsValue, closures: &js_sys::Function) -> R<JsValue> {
    let three = Three(three);
    let options = destructured(options, "width")?;
    let width = option_or(&options, "width", 600.0)?;
    let layout = crate::baggebo_layout(&width, spec)?;
    let group = three.new("Group", &[])?;
    set(&group, "name", &"IKEA BAGGEBO white powder-coated steel".into())?;
    call(&read(&group, "scale")?, "setScalar", &[&read(&layout, "scale")?])?;
    let data = user_data(&group)?;
    set(&data, "furniture", &true_value())?;
    set(&data, "shelfType", &"baggebo".into())?;
    set(&data, "physicalDimensions", &read(&layout, "physicalDimensions")?)?;
    set(&data, "specification", spec)?;
    set(&data, "shelfPositions", &read(&layout, "shelfPositions")?)?;
    set(&data, "parts", &Array::new())?;

    let paint = data_texture(&three, &crate::baggebo_model::paint_texture(), 32.0, 32.0)?;
    set(&paint, "name", &"BAGGEBO fine powder coat".into())?;
    let repeat = three.constant("RepeatWrapping")?;
    set(&paint, "wrapT", &repeat)?;
    set(&paint, "wrapS", &repeat)?;
    set(&paint, "magFilter", &three.constant("LinearFilter")?)?;
    set(&paint, "minFilter", &three.constant("LinearMipmapLinearFilter")?)?;
    set(&paint, "generateMipmaps", &true_value())?;
    set(&paint, "needsUpdate", &true_value())?;
    let by_role = Object::new();
    make_materials(&three, &js_sys::JSON::parse(&crate::baggebo_materials())?, &state_object(&[("paint", &paint)])?, &by_role)?;
    let materials = Array::new();
    for role in ["paint", "meshPaint", "hardware", "foot"] {
        materials.push(&read(by_role.as_ref(), role)?);
    }

    let packet = baggebo_packet()?;
    let parts = Array::new();
    for part in Array::from(&read(&packet.header, "parts")?).iter() {
        // `{ name, bounds, ...metadata }`: the box becomes bounds, the rest is copied as it is.
        let copy: JsValue = Object::new().into();
        set(&copy, "name", &read(&part, "name")?)?;
        let corners: Array = read(&part, "box")?.unchecked_into();
        let corner = |a: u32| -> R<JsValue> { three.new("Vector3", &[&corners.get(a), &corners.get(a + 1), &corners.get(a + 2)]) };
        set(&copy, "bounds", &three.new("Box3", &[&corner(0)?, &corner(3)?])?)?;
        for key in Object::keys(part.unchecked_ref()).iter() {
            let name = key.as_string().unwrap_or_default();
            if name != "name" && name != "box" {
                js_sys::Reflect::set(&copy, &key, &js_sys::Reflect::get(&part, &key)?)?;
            }
        }
        parts.push(&copy);
    }
    set(&data, "parts", &parts)?;
    let geometries = Array::new();
    for (batch_index, batch) in Array::from(&read(&packet.header, "batches")?).iter().enumerate() {
        let geometry = three.new("BufferGeometry", &[])?;
        for entry in Array::from(&read(&batch, "attributes")?).iter() {
            let entry: Array = entry.unchecked_into();
            let kind = entry.get(2).as_string().unwrap_or_default();
            let values = packet.copy(&kind, num(&entry.get(3)), num(&entry.get(4)))?;
            let attribute = three.new("BufferAttribute", &[&values, &entry.get(1), &JsValue::from_bool(kind != "f32")])?;
            call(&geometry, "setAttribute", &[&entry.get(0), &attribute])?;
        }
        let index: Array = read(&batch, "index")?.unchecked_into();
        let wide = index.get(0).as_string().is_some_and(|text| text == "u32");
        let values = packet.copy(if wide { "u32" } else { "u16" }, num(&index.get(1)), num(&index.get(2)))?;
        call(&geometry, "setIndex", &[&three.new("BufferAttribute", &[&values, &number(1.0)])?])?;
        baggebo_bounds(&three, &geometry, batch_index)?;
        let material = materials.get(num(&read(&batch, "material")?) as u32);
        geometries.push(&geometry);
        let mesh = three.new("Mesh", &[&geometry, &material])?;
        set(&mesh, "name", &read(&material, "name")?)?;
        set(&mesh, "castShadow", &true_value())?;
        set(&mesh, "receiveShadow", &true_value())?;
        call(&group, "add", &[&mesh])?;
    }
    let state = state_object(&[("geometries", geometries.as_ref()), ("materials", materials.as_ref()), ("paint", &paint), ("disposed", &JsValue::FALSE)])?;
    let dispose = read(&closures.call1(&JsValue::UNDEFINED, &state)?, "dispose")?;
    set(&data, "dispose", &dispose)?;
    set(&data, "disposeGeometry", &dispose)?;
    Ok(group)
}

/// The BAGGEBO's `dispose()`: its geometries, materials and powder-coat grain, once.
#[wasm_bindgen]
pub fn baggebo_dispose(state: &JsValue) -> R<()> {
    if truthy(&read(state, "disposed")?) {
        return Ok(());
    }
    set(state, "disposed", &true_value())?;
    dispose_each(&read(state, "geometries")?)?;
    dispose_each(&read(state, "materials")?)?;
    call(&read(state, "paint")?, "dispose", &[])?;
    Ok(())
}

// ---------------------------------------------------------------------------------------------- lamps

/// Cones that cast a shadow: each costs a texture unit in every lit program, of which a phone has few.
const MAX_LAMP_SHADOWS: f64 = 2.0;

/// A light slot of the shelf's lamp pool for fixtures of `kind` ("cone", "point" or "filaments:N"), the
/// `index`-th of its kind, with its three lights added to `scene` idle (intensity 0): N area strips for a
/// filament fixture, else one cone (the first two casting a 512 px shadow) or point light. The slot is the
/// plain record the pool keeps: `{ kind, filaments, spotlight, shadow, key, power, lit, state, lights }`.
#[wasm_bindgen]
pub fn lamp_slot_create(three: &JsValue, scene: &JsValue, kind: &str, index: f64) -> R<JsValue> {
    let three = Three(three);
    let filaments = match kind.strip_prefix("filaments:") { Some(count) => num(&JsValue::from_str(count)), None => 0.0 };
    let spotlight = kind == "cone";
    let shadow = spotlight && index < MAX_LAMP_SHADOWS;
    let state: JsValue = crate::lamp_light::LampLightState::new(filaments as usize).into();
    let slot = state_object(&[
        ("kind", &kind.into()), ("filaments", &number(filaments)), ("spotlight", &spotlight.into()), ("shadow", &shadow.into()),
        ("key", &JsValue::NULL), ("power", &number(0.0)), ("lit", &JsValue::FALSE), ("state", &state),
    ])?;
    let lights = Array::new();
    // `if (filaments)`: NaN and 0 are both a single light.
    if filaments != 0.0 && !filaments.is_nan() {
        for strip in 0..filaments as u32 {
            let light = three.new("RectAreaLight", &[&number(f64::from(0xffffff)), &number(0.0)])?;
            set(&user_data(&light)?, "filamentIndex", &number(f64::from(strip)))?;
            lights.push(&light);
        }
    } else {
        let light = three.new(if spotlight { "SpotLight" } else { "PointLight" }, &[])?;
        set(&light, "intensity", &number(0.0))?;
        if spotlight {
            set(&light, "castShadow", &shadow.into())?;
            let map = read(&light, "shadow")?;
            call(&read(&map, "mapSize")?, "set", &[&number(512.0), &number(512.0)])?;
            set(&map, "autoUpdate", &JsValue::FALSE)?;
            set(&map, "radius", &number(2.0))?;
            set(&map, "blurSamples", &number(4.0))?;
            set(&map, "bias", &number(-0.0002))?;
            set(&map, "intensity", &number(0.8))?;
            call(scene, "add", &[&read(&light, "target")?])?;
        }
        lights.push(&light);
    }
    set(&slot, "lights", &lights)?;
    for light in lights.iter() {
        set(&user_data(&light)?, "shelfLamp", &true_value())?;
        set(&light, "name", &"Shelf lamp light: idle".into())?;
        call(scene, "add", &[&light])?;
    }
    Ok(slot)
}

/// Takes a slot's lights (and a cone's target) out of the scene and releases their shadow maps and the slot's
/// native state.
#[wasm_bindgen]
pub fn lamp_slot_remove(slot: &JsValue) -> R<()> {
    call(&read(slot, "state")?, "free", &[])?;
    for light in Array::from(&read(slot, "lights")?).iter() {
        call(&light, "removeFromParent", &[])?;
        let target = read(&light, "target")?;
        if !target.is_null() && !target.is_undefined() {
            call(&target, "removeFromParent", &[])?;
        }
        let shadow = read(&light, "shadow")?;
        if !shadow.is_null() && !shadow.is_undefined() {
            for key in ["map", "mapPass"] {
                let resource = read(&shadow, key)?;
                if !resource.is_null() && !resource.is_undefined() {
                    call(&resource, "dispose", &[])?;
                }
            }
        }
    }
    Ok(())
}

/// The geometry of a shelf lamp (see `lamp_geometry`) as three's objects: `{ geometries, emitter }`, a Map from
/// each batch's name to its BufferGeometry (with its bounding box when the batch asks for one) and the emitter,
/// both already fitted by `scale`.
#[wasm_bindgen]
pub fn lamp_geometry_build(three: &JsValue, kind: u32, segments: u32, scale: f64) -> R<JsValue> {
    let three = Three(three);
    let packet = Packet::open(crate::lamp_model::lamp(kind, segments as usize, scale))?;
    let geometries = js_sys::Map::new();
    for batch in Array::from(&read(&packet.header, "batches")?).iter() {
        let geometry = crate::three_host::geometry_of(&three, &packet, &batch)?;
        if truthy(&read(&batch, "bounds")?) {
            call(&geometry, "computeBoundingBox", &[])?;
        }
        geometries.set(&read(&batch, "name")?, &geometry);
    }
    state_object(&[("geometries", geometries.as_ref()), ("emitter", &read(&packet.header, "emitter")?)])
}
