//! The picture kernels of rust-core (pdf_images.rs), driven from here: the footprints PDF.js
//! reports are packed into one arena, the kernel is called and its answer is checked and copied
//! back as fresh host-owned bounds or clipping paths. Every number is copied once each way.
//! The frozen JavaScript original is tests/unit/helpers/reference-pdf-images-bridge.js.
//! (The text pipeline's bridges, row/order/stream, stay in JavaScript: driven from here they were
//! 2.6-6x slower per page, because every item field read crosses the boundary.)
use js_sys::{Array, Float32Array, Float64Array, Object, Reflect};
use wasm_bindgen::{prelude::*, JsCast};
use crate::core_bridge::{alloc, finite_value, free, has, integer_value, kernel, read_f64, required, write_f64, PDF_FAILURE};
use crate::host::{num, read};

fn key(name: &'static str) -> JsValue { JsValue::from_str(wasm_bindgen::intern(name)) }
fn obj(fields: &[(&'static str, JsValue)]) -> Result<JsValue, JsValue> {
    let target = Object::new();
    for (name, value) in fields { Reflect::set(&target, &key(name), value)?; }
    Ok(target.into())
}
fn number(value: f64) -> JsValue { JsValue::from_f64(value) }

// ---------------------------------------------------------------------------------------------
// Pictures: image regions and clipping paths (pdf_images.rs).

const MAX_IMAGES: f64 = 1_000_000.0;
const MAX_PATHS: usize = 32768;

/// The coordinates as the kernel reads them: numbers as they are, anything else NaN (the original
/// `Number.isFinite` rejects strings rather than coercing them).
fn coordinates_of(coordinates: &JsValue, cells: usize) -> Result<Vec<f64>, JsValue> {
    if let Some(values) = coordinates.dyn_ref::<Float64Array>() { return Ok(values.subarray(0, cells as u32).to_vec()); }
    if let Some(values) = coordinates.dyn_ref::<Float32Array>() { return Ok(values.subarray(0, cells as u32).to_vec().into_iter().map(f64::from).collect()); }
    let mut values = Vec::with_capacity(cells);
    for index in 0..cells { values.push(Reflect::get(coordinates, &number(index as f64))?.as_f64().unwrap_or(f64::NAN)); }
    Ok(values)
}
fn page_size(width: &JsValue, height: &JsValue) -> Option<(f64, f64)> {
    let (width, height) = (finite_value(width)?, finite_value(height)?);
    (width > 0.0 && height > 0.0).then_some((width, height))
}

fn image_rects(core: &JsValue, coordinates: &JsValue, width: &JsValue, height: &JsValue) -> Result<JsValue, JsValue> {
    let count = (num(&read(coordinates, "length")?) / 6.0).floor();
    let Some((page_width, page_height)) = page_size(width, height).filter(|_| has(core, "pdf_image_rects") && !(count > MAX_IMAGES)) else { return Ok(JsValue::UNDEFINED) };
    if !(count > 0.0) { return Ok(Array::new().into()); }
    let count = count as usize;
    let length = (count * 10) as f64;
    let pointer = match alloc(core, length) { Ok(Some(pointer)) => pointer, _ => return Ok(JsValue::UNDEFINED) };
    let outcome = (|| -> Result<JsValue, JsValue> {
        write_f64(core, pointer, &coordinates_of(coordinates, count * 6)?)?;
        let size = kernel(core, "pdf_image_rects", &[pointer, count as f64, page_width, page_height, pointer + (count * 48) as f64])?;
        let Some(size) = integer_value(&size).filter(|size| *size >= 0.0 && *size <= count as f64) else { return Ok(JsValue::UNDEFINED) };
        let output = read_f64(core, pointer + (count * 48) as f64, size as usize * 4)?;
        let rects = Array::new();
        for rect in output.chunks_exact(4) {
            let (x0, y0, x1, y1) = (rect[0], rect[1], rect[2], rect[3]);
            if !x0.is_finite() || !y0.is_finite() || !x1.is_finite() || !y1.is_finite()
                || x0 < 0.0 || y0 < 0.0 || x1 > page_width || y1 > page_height || x1 <= x0 || y1 <= y0 { return Ok(JsValue::UNDEFINED); }
            rects.push(&obj(&[("x0", number(x0)), ("y0", number(y0)), ("x1", number(x1)), ("y1", number(y1))])?);
        }
        Ok(rects.into())
    })().unwrap_or(JsValue::UNDEFINED);
    free(core, pointer, length)?;
    Ok(outcome)
}

/// Fresh host-owned bounds of the visible image regions. `required` is the page's entry point:
/// an unusable page size has no regions and a kernel without an answer is an error.
#[wasm_bindgen]
pub fn pdf_core_image_rects(core: &JsValue, coordinates: &JsValue, width: &JsValue, height: &JsValue, required_answer: bool) -> Result<JsValue, JsValue> {
    if required_answer && page_size(width, height).is_none() { return Ok(Array::new().into()); }
    let rects = image_rects(core, coordinates, width, height)?;
    if required_answer && rects.is_undefined() { return Err(required(core, PDF_FAILURE)); }
    Ok(rects)
}

fn image_paths(core: &JsValue, coordinates: &JsValue, width: &JsValue, height: &JsValue) -> Result<JsValue, JsValue> {
    let count = (num(&read(coordinates, "length")?) / 6.0).floor();
    let Some((page_width, page_height)) = page_size(width, height).filter(|_| has(core, "pdf_image_paths") && !(count > MAX_PATHS as f64)) else { return Ok(JsValue::UNDEFINED) };
    if !(count > 0.0) { return Ok(Float64Array::new_with_length(0).into()); }
    let count = count as usize;
    let length = (count * 14) as f64;
    let output_offset = (count * 48) as f64;
    let Ok(Some(pointer)) = alloc(core, length) else { return Ok(JsValue::UNDEFINED) };
    let outcome = (|| -> Result<JsValue, JsValue> {
        write_f64(core, pointer, &coordinates_of(coordinates, count * 6)?)?;
        let size = kernel(core, "pdf_image_paths", &[pointer, count as f64, page_width, page_height, pointer + output_offset])?;
        let Some(size) = integer_value(&size).filter(|size| *size >= 0.0 && *size <= count as f64) else { return Ok(JsValue::UNDEFINED) };
        let paths = read_f64(core, pointer + output_offset, size as usize * 8)?;
        let result = Float64Array::new_with_length(paths.len() as u32);
        result.copy_from(&paths);
        Ok(result.into())
    })().unwrap_or(JsValue::UNDEFINED);
    free(core, pointer, length)?;
    Ok(outcome)
}

/// Clipping paths of every picture footprint (eight numbers each), in order. With `required`
/// (the page's entry point): any number of pictures, in kernel-sized parts, an empty array for a
/// canvas without pixels, and an error when the kernel has no answer.
#[wasm_bindgen]
pub fn pdf_core_image_paths(core: &JsValue, coordinates: &JsValue, width: &JsValue, height: &JsValue, required_answer: bool) -> Result<JsValue, JsValue> {
    if !required_answer { return image_paths(core, coordinates, width, height); }
    if page_size(width, height).is_none() { return Ok(Float64Array::new_with_length(0).into()); }
    let need = |paths: JsValue| if paths.is_undefined() { Err(required(core, PDF_FAILURE)) } else { Ok(paths) };
    let count = (num(&read(coordinates, "length")?) / 6.0).floor();
    if count <= MAX_PATHS as f64 { return need(image_paths(core, coordinates, width, height)?); }
    let mut joined: Vec<f64> = Vec::new();
    let mut at = 0.0;
    while at < count * 6.0 {
        let part = crate::host::method(coordinates, "slice", &[&number(at), &number(at + (MAX_PATHS * 6) as f64)])?;
        joined.extend(need(image_paths(core, &part, width, height)?)?.unchecked_into::<Float64Array>().to_vec());
        at += (MAX_PATHS * 6) as f64;
    }
    let result = Float64Array::new_with_length(joined.len() as u32);
    result.copy_from(&joined);
    Ok(result.into())
}
