#![allow(dead_code)]
//! The numeric core (rust-core, a raw-ABI module with its own memory) seen from rust-ui. Its
//! exports object comes from the host on every call (`getRustCore()`, so a test or a recovery can
//! replace it), kernels are called by name with the exports as `this`, exactly as `core.name(...)`,
//! and arena cells are written and read as whole slices: one copy each way, never per element.
//! Views are created after every call that may grow the core's memory, never held across one.
use js_sys::{Array, Float64Array, Function, Reflect, Uint32Array, Uint8Array};
use wasm_bindgen::{prelude::*, JsCast};
use crate::host::{get, global, read, truthy};

/// `typeof core?.name === 'function'`.
pub fn has(core: &JsValue, name: &str) -> bool { get(core, name).is_function() }

/// `core.name(...args)`: numbers in, the kernel's raw answer out.
pub fn kernel(core: &JsValue, name: &str, args: &[f64]) -> Result<JsValue, JsValue> {
    let function = read(core, name)?;
    let function = function.dyn_ref::<Function>()
        .ok_or_else(|| JsValue::from(js_sys::TypeError::new(&format!("core.{name} is not a function"))))?;
    let list = Array::new_with_length(args.len() as u32);
    for (index, value) in args.iter().enumerate() { list.set(index as u32, JsValue::from_f64(*value)); }
    Reflect::apply(function, core, &list)
}

/// `core.alloc_f64(cells)`; `None` when the core answered a falsy pointer.
pub fn alloc(core: &JsValue, cells: f64) -> Result<Option<f64>, JsValue> {
    let pointer = kernel(core, "alloc_f64", &[cells])?;
    Ok(if truthy(&pointer) { Some(crate::host::num(&pointer)) } else { None })
}
pub fn free(core: &JsValue, pointer: f64, cells: f64) -> Result<(), JsValue> { kernel(core, "free_f64", &[pointer, cells]).map(|_| ()) }

/// `new globalThis[kind](core.memory.buffer, byteOffset, length)`, throwing like the engine for a
/// misaligned or out-of-range view instead of trapping.
fn view(core: &JsValue, kind: &str, byte_offset: f64, length: f64) -> Result<JsValue, JsValue> {
    let buffer = read(&read(core, "memory")?, "buffer")?;
    let constructor = read(&global(), kind)?.dyn_into::<Function>()
        .map_err(|_| JsValue::from(js_sys::TypeError::new(&format!("{kind} is not a constructor"))))?;
    Reflect::construct(&constructor, &Array::of3(&buffer, &JsValue::from_f64(byte_offset), &JsValue::from_f64(length)))
}
pub fn f64_view(core: &JsValue, byte_offset: f64, length: usize) -> Result<Float64Array, JsValue> {
    Ok(view(core, "Float64Array", byte_offset, length as f64)?.unchecked_into())
}
/// The `length` cells at `byte_offset`, copied out of the core.
pub fn read_f64(core: &JsValue, byte_offset: f64, length: usize) -> Result<Vec<f64>, JsValue> {
    Ok(f64_view(core, byte_offset, length)?.to_vec())
}
/// Copies `data` into the core at `byte_offset`.
pub fn write_f64(core: &JsValue, byte_offset: f64, data: &[f64]) -> Result<(), JsValue> {
    f64_view(core, byte_offset, data.len())?.copy_from(data);
    Ok(())
}
pub fn read_u32(core: &JsValue, byte_offset: f64, length: usize) -> Result<Vec<u32>, JsValue> {
    Ok(view(core, "Uint32Array", byte_offset, length as f64)?.unchecked_into::<Uint32Array>().to_vec())
}
pub fn read_u8(core: &JsValue, byte_offset: f64, length: usize) -> Result<Vec<u8>, JsValue> {
    Ok(view(core, "Uint8Array", byte_offset, length as f64)?.unchecked_into::<Uint8Array>().to_vec())
}

/// `Number.isInteger(value)` for a number already read.
pub fn integer(value: f64) -> bool { value.is_finite() && value.fract() == 0.0 }
/// `Number.isSafeInteger(value)` for a number already read.
pub fn safe_integer(value: f64) -> bool { integer(value) && value.abs() <= 9_007_199_254_740_991.0 }
/// `Number.isInteger(value)` for any value (no coercion).
pub fn integer_value(value: &JsValue) -> Option<f64> { value.as_f64().filter(|number| integer(*number)) }
/// `Number.isFinite(value)` for any value (no coercion).
pub fn finite_value(value: &JsValue) -> Option<f64> { value.as_f64().filter(|number| number.is_finite()) }

/// What `coreRequired` (readers/core-required.js) reports when a kernel had nothing to say.
pub fn required(core: &JsValue, failure: &str) -> JsValue {
    let message = if truthy(core) { failure } else { "El módulo numérico no se pudo cargar. Recarga la página." };
    js_sys::Error::new(message).into()
}
pub const PDF_FAILURE: &str = "No se pudo calcular la página del PDF.";
