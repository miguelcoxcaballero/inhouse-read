//! A shelf plant's bake as data.
//!
//! A bake is the finished plant content as plain data: every object in its creation order (ids decide the draw
//! order of equal sort keys), its parent and place among siblings, transform, material role and geometry arrays.
//! `plant_model` draws it as a packet; this module turns that packet into the bake record the shelf remembers and
//! saves (what `unpackBake` did in shelf-plants.js). The host still makes three's objects from a bake.
use js_sys::{Array, Object, Reflect, Uint16Array};
use wasm_bindgen::{prelude::*, JsCast};

use crate::host::{num, read, set, truthy};
use crate::packet_host::{Packet, R};

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
