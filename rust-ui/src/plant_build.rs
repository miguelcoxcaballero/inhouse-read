//! A shelf plant's bake as data and its three.js objects.
//!
//! A bake is the finished plant content as plain data: every object in its creation order (ids decide the draw
//! order of equal sort keys), its parent and place among siblings, transform, material role and geometry arrays.
//! `plant_model` draws it as a packet; this module turns that packet into the bake record the shelf remembers and
//! saves (what `unpackBake` did in shelf-plants.js), and rebuilds three's objects from a bake, fresh or saved (what
//! `restoreGeometry` and `restoreContent` did). Every class comes from the `three` namespace the host passes in.
use js_sys::{Array, Object, Reflect, Set, Uint16Array};
use wasm_bindgen::{prelude::*, JsCast};

use crate::host::{absent, num, read, set, truthy};
use crate::three_host::{call, number, Packet, Three, R};

/// `JSON.parse(JSON.stringify(value ?? {}))`: a plain, unshared copy of user data.
fn json_copy(value: &JsValue) -> R<JsValue> {
    let source = if absent(value) { Object::new().into() } else { value.clone() };
    let text = js_sys::JSON::stringify(&source)?;
    js_sys::JSON::parse(&String::from(text))
}

/// The bake of a freshly drawn plant (see `plant_model` for the arguments): `{ parts, objects }`, every array
/// copied out of the packet into a buffer of its own.
#[wasm_bindgen]
#[allow(clippy::too_many_arguments)]
pub fn plant_bake_build(units: &JsValue, skip: f64, variant: &str, pot_id: &str, pot_model: &str, catalog: bool, detailed: bool, dims: &[f64]) -> R<JsValue> {
    let seed: Vec<u16> = units.dyn_ref::<Uint16Array>().map(Uint16Array::to_vec)
        .unwrap_or_else(|| Array::from(units).iter().map(|unit| num(&unit) as u16).collect());
    let packet = Packet::open(crate::plant_model(&seed, skip as u32, variant, pot_id, pot_model, catalog, detailed, dims))?;
    let objects = Array::new();
    for record in Array::from(&read(&packet.header, "objects")?).iter() {
        // `{ ...object, rotation: [...rotation, 'XYZ'], geometry }`: the record's own fields keep their order.
        let object: JsValue = Object::new().into();
        for key in Object::keys(record.unchecked_ref()).iter() {
            let name = key.as_string().unwrap_or_default();
            if name != "geometry" && name != "rotation" {
                Reflect::set(&object, &key, &Reflect::get(&record, &key)?)?;
            }
        }
        let rotation = Array::from(&read(&record, "rotation")?);
        rotation.push(&"XYZ".into());
        set(&object, "rotation", &rotation)?;
        let geometry = read(&record, "geometry")?;
        let baked = if truthy(&geometry) {
            let attributes = Object::new();
            for entry in Array::from(&read(&geometry, "attributes")?).iter() {
                let entry: Array = entry.unchecked_into();
                let kind = entry.get(2).as_string().unwrap_or_default();
                let values = packet.copy(&kind, num(&entry.get(3)), num(&entry.get(4)))?;
                Reflect::set(&attributes, &entry.get(0), &Array::of3(&values, &entry.get(1), &JsValue::FALSE))?;
            }
            let index = read(&geometry, "index")?;
            let index = if truthy(&index) { packet.copy_triple(&index)? } else { index };
            let baked: JsValue = Object::new().into();
            set(&baked, "type", &read(&geometry, "type")?)?;
            set(&baked, "attributes", &attributes)?;
            set(&baked, "index", &index)?;
            set(&baked, "groups", &read(&geometry, "groups")?)?;
            set(&baked, "userData", &read(&geometry, "userData")?)?;
            set(&baked, "box", &read(&geometry, "box")?)?;
            baked
        } else {
            JsValue::NULL
        };
        set(&object, "geometry", &baked)?;
        objects.push(&object);
    }
    let bake: JsValue = Object::new().into();
    set(&bake, "parts", &read(&packet.header, "parts")?)?;
    set(&bake, "objects", &objects)?;
    Ok(bake)
}

/// One baked geometry as a BufferGeometry: its attributes share the bake's arrays.
fn restore_geometry(three: &Three, baked: &JsValue) -> R<JsValue> {
    let geometry = three.new("BufferGeometry", &[])?;
    set(&geometry, "type", &read(baked, "type")?)?;
    let attributes = read(baked, "attributes")?;
    for entry in Object::entries(attributes.unchecked_ref()).iter() {
        let entry: Array = entry.unchecked_into();
        let value: Array = entry.get(1).unchecked_into();
        let attribute = three.new("BufferAttribute", &[&value.get(0), &value.get(1), &value.get(2)])?;
        call(&geometry, "setAttribute", &[&entry.get(0), &attribute])?;
    }
    let index = read(baked, "index")?;
    if truthy(&index) {
        call(&geometry, "setIndex", &[&three.new("BufferAttribute", &[&index, &number(1.0)])?])?;
    }
    for group in Array::from(&read(baked, "groups")?).iter() {
        let group: Array = group.unchecked_into();
        call(&geometry, "addGroup", &[&group.get(0), &group.get(1), &group.get(2)])?;
    }
    set(&geometry, "userData", &json_copy(&read(baked, "userData")?)?)?;
    let corners = read(baked, "box")?;
    if truthy(&corners) {
        let min = call(&three.new("Vector3", &[])?, "fromArray", &[&corners])?;
        let max = call(&three.new("Vector3", &[])?, "fromArray", &[&corners, &number(3.0)])?;
        set(&geometry, "boundingBox", &three.new("Box3", &[&min, &max])?)?;
    }
    Ok(geometry)
}

/// Rebuilds a bake's objects under `content`: a Group, LineSegments or Mesh per record with the material of its
/// role in `materials`, added to its parent in the order of its place among siblings. Every mesh's geometry and
/// material join `geometries` and `owned`. Returns a copy of the bake's parts.
#[wasm_bindgen]
pub fn plant_restore(three: &JsValue, bake: &JsValue, content: &JsValue, materials: &JsValue, geometries: &Set, owned: &Set) -> R<Array> {
    let three = Three(three);
    let records: Array = read(bake, "objects")?.unchecked_into();
    let count = records.length();
    let mut objects = Vec::with_capacity(count as usize);
    for record in records.iter() {
        let kind = read(&record, "kind")?;
        let group = kind.as_string().is_some_and(|text| text == "group");
        let object = if group {
            three.new("Group", &[])?
        } else {
            let lines = kind.as_string().is_some_and(|text| text == "lines");
            let geometry = restore_geometry(&three, &read(&record, "geometry")?)?;
            let material = Reflect::get(materials, &read(&record, "role")?)?;
            three.new(if lines { "LineSegments" } else { "Mesh" }, &[&geometry, &material])?
        };
        set(&object, "name", &read(&record, "name")?)?;
        call(&read(&object, "position")?, "fromArray", &[&read(&record, "position")?])?;
        call(&read(&object, "scale")?, "fromArray", &[&read(&record, "scale")?])?;
        // Euler and quaternion each follow whichever of them was set last.
        call(&read(&object, "quaternion")?, "fromArray", &[&read(&record, "quaternion")?])?;
        let rotation: Array = read(&record, "rotation")?.unchecked_into();
        let (x, y, z, order) = (rotation.get(0), rotation.get(1), rotation.get(2), rotation.get(3));
        let euler = read(&object, "rotation")?;
        // `!==`: NaN always differs, -0 and 0 do not.
        let differs = |key: &str, value: &JsValue| -> R<bool> { Ok(read(&euler, key)? != *value) };
        if differs("x", &x)? || differs("y", &y)? || differs("z", &z)? || differs("order", &order)? {
            call(&euler, "set", &[&x, &y, &z, &order])?;
        }
        set(&object, "castShadow", &read(&record, "castShadow")?)?;
        set(&object, "receiveShadow", &read(&record, "receiveShadow")?)?;
        set(&object, "userData", &json_copy(&read(&record, "userData")?)?)?;
        if !group {
            geometries.add(&read(&object, "geometry")?);
            owned.add(&read(&object, "material")?);
        }
        objects.push(object);
    }
    // Stable order by place among siblings, as `Array#sort` keeps equal places in creation order.
    let mut order: Vec<(f64, f64, usize)> = Vec::with_capacity(objects.len());
    for (index, record) in records.iter().enumerate() {
        order.push((num(&read(&record, "parent")?), num(&read(&record, "place")?), index));
    }
    order.sort_by(|a, b| { let d = a.1 - b.1; if d < 0.0 { std::cmp::Ordering::Less } else if d > 0.0 { std::cmp::Ordering::Greater } else { std::cmp::Ordering::Equal } });
    for (parent, _, index) in order {
        let owner = if parent == -1.0 { content.clone() } else { objects[parent as usize].clone() };
        call(&owner, "add", &[&objects[index]])?;
    }
    Ok(Array::from(&read(bake, "parts")?))
}
