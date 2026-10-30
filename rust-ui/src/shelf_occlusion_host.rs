//! The contact shadows of a cabinet (shelf-occlusion-wasm.js): one call of the numeric core's `shelf_occlusion`
//! (rust-core, a separate WebAssembly module with its own memory) per cabinet. This module makes the request the
//! JavaScript host made around the kernel: the feet that make a ring, the floor light, the arena (measures, rows,
//! feet and the host's cos/sin table) and the call. The host's `make` builds the three.js geometry from views of what
//! the kernel drew, before the arena is released (its attributes copy them, as they did). A core that refuses memory
//! or the request is reported with the host's messages; whatever happens, the arena is released, and a failure to
//! release it wins, as a `finally` that throws does.
use js_sys::{Array, Float32Array, Float64Array, Function};
use wasm_bindgen::{prelude::*, JsCast};

use crate::host::{num, truthy};

type R<T> = Result<T, JsValue>;

#[wasm_bindgen]
extern "C" {
    /// `Number(value)`, with its exception returned (the conversions of a typed array's `set`).
    #[wasm_bindgen(catch, js_name = Number)]
    fn number(value: &JsValue) -> R<f64>;
    /// The numeric core's exports: its kernels are called as methods, as `core.name(...)` calls them.
    type Core;
    #[wasm_bindgen(method, catch)]
    fn alloc_f64(this: &Core, words: f64) -> R<JsValue>;
    #[wasm_bindgen(method, catch)]
    fn free_f64(this: &Core, pointer: f64, words: f64) -> R<()>;
    #[wasm_bindgen(method, catch)]
    fn shelf_occlusion(this: &Core, input: f64, rows: f64, feet: f64, lit: f64, output: f64) -> R<JsValue>;
    #[wasm_bindgen(method, getter, catch)]
    fn memory(this: &Core) -> R<JsValue>;
}

/// The property names read for every foot, made once.
struct Keys {
    x: JsValue,
    z: JsValue,
    radius: JsValue,
}

thread_local! {
    static KEYS: Keys = Keys { x: JsValue::from_str("x"), z: JsValue::from_str("z"), radius: JsValue::from_str("radius") };
    /// cos/sin of the light and foot-ring directions, from the host's Math, read once.
    static ANGLES: Vec<f64> = crate::occlusion_table::occlusion_angles();
}

/// `Number.isFinite(value)`.
fn finite(value: &JsValue) -> bool { value.as_f64().is_some_and(f64::is_finite) }

/// `value[key]` of a foot (a truthy value), as the engine reads it.
fn field(value: &JsValue, key: &JsValue) -> R<JsValue> {
    js_sys::Reflect::get(value, key).or_else(|error| {
        if value.is_object() || value.is_function() { Err(error) } else { js_sys::Reflect::get(&crate::host::boxed(value), key) }
    })
}

fn buffer(core: &Core) -> R<JsValue> { Ok(core.memory()?.unchecked_into::<js_sys::WebAssembly::Memory>().buffer()) }

/// The contact shadows of a cabinet: what `make(positions, colours)` returns for the two Float32Array views of the
/// core's output.
#[wasm_bindgen]
#[allow(clippy::too_many_arguments)]
pub fn shelf_occlusion_request(core: &JsValue, width: &JsValue, height: &JsValue, depth: &JsValue, floor_y: &JsValue, bottoms: &JsValue,
    footprints: &JsValue, floor_light: &JsValue, make: &Function) -> R<JsValue> {
    let core: &Core = core.unchecked_ref();
    // The feet that make a ring: finite numbers and a positive radius (`[f.x, f.z, f.radius].every(Number.isFinite)`).
    let mut feet: Vec<[f64; 3]> = Vec::new();
    KEYS.with(|k| -> R<()> {
        let list: &Array = footprints.unchecked_ref();
        for index in 0..list.length() {
            let foot = list.get(index);
            if !truthy(&foot) {
                continue;
            }
            let (x, z, radius) = (field(&foot, &k.x)?, field(&foot, &k.z)?, field(&foot, &k.radius)?);
            if finite(&x) && finite(&z) && finite(&radius) && num(&radius) > 0.0 {
                feet.push([num(&x), num(&z), num(&radius)]);
            }
        }
        Ok(())
    })?;
    let light: Option<[f64; 4]> = if Array::is_array(floor_light) {
        let list: &Array = floor_light.unchecked_ref();
        if list.length() == 4 {
            let values = [list.get(0), list.get(1), list.get(2), list.get(3)];
            values.iter().all(finite).then(|| values.each_ref().map(num))
        } else {
            None
        }
    } else {
        None
    };
    let rows: &Array = bottoms.unchecked_ref();
    let row_count = rows.length() as usize;
    let input_length = 90 + row_count + feet.len() * 3;
    let most = row_count * 78 + 66 + if light.is_some() { 360 } else { 0 } + feet.len() * 300;
    let length = (input_length + (most * 7).div_ceil(2)) as f64;
    let pointer = core.alloc_f64(length)?;
    if !truthy(&pointer) {
        return Err(js_sys::Error::new("El módulo numérico no pudo reservar memoria.").into());
    }
    let pointer = num(&pointer);
    let drawn = (|| -> R<JsValue> {
        let mut input = vec![0.0; input_length];
        input[0] = number(width)?;
        input[1] = number(height)?;
        input[2] = number(depth)?;
        input[3] = number(floor_y)?;
        if let Some(light) = &light {
            input[6..10].copy_from_slice(light);
        }
        for index in 0..row_count {
            input[10 + index] = number(&rows.get(index as u32))?;
        }
        for (index, foot) in feet.iter().enumerate() {
            let at = 10 + row_count + index * 3;
            input[at..at + 3].copy_from_slice(foot);
        }
        ANGLES.with(|angles| input[input_length - 80..].copy_from_slice(angles));
        Float64Array::new_with_byte_offset_and_length(&buffer(core)?, pointer as u32, input_length as u32).copy_from(&input);
        let output = pointer + (input_length * 8) as f64;
        let vertices = core.shelf_occlusion(pointer, row_count as f64, feet.len() as f64, if light.is_some() { 1.0 } else { 0.0 }, output)?;
        if !truthy(&vertices) {
            return Err(js_sys::Error::new("El módulo numérico no pudo calcular las sombras.").into());
        }
        let vertices = num(&vertices) as u32;
        let values = Float32Array::new_with_byte_offset_and_length(&buffer(core)?, output as u32, vertices * 7);
        make.call2(&JsValue::UNDEFINED, &values.subarray(0, vertices * 3), &values.subarray(vertices * 3, vertices * 7))
    })();
    core.free_f64(pointer, length)?;
    drawn
}
