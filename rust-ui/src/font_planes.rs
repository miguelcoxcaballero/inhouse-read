//! The title-font search's pixel planes inside the shelf module (formerly src/js/font-glyph-wasm.js, a bridge
//! to the numeric core): the crop of a rendered title into its mask and ordered sample points, the grey and
//! near-edge planes of a cover, and the neighbour map of an edge plane. The kernels are the core's own
//! (rust-core/src/font_glyph.rs and font_prepare.rs, compiled into this module by `#[path]`), so each is a plain
//! call over this module's memory: the bridge's arena, its views and its copies in and out are gone. What a
//! caller receives is what the bridge returned: owned typed arrays, `null` for a raster with no glyph, an error
//! where the bridge answered "unavailable".
use js_sys::{Float32Array, Int32Array, Object, Uint8Array, Uint8ClampedArray};
use wasm_bindgen::prelude::*;
use wasm_bindgen::JsCast;
use crate::font::font_mask_fits;
use crate::font_glyph::font_glyph_mask;
use crate::font_prepare::{font_near_edges, font_prepare_pixels};

#[wasm_bindgen]
extern "C" {
    // The record of a glyph: one typed write per field (a search asks for 144 of them a cover).
    type Record;
    #[wasm_bindgen(method, setter)] fn set_width(this: &Record, value: f64);
    #[wasm_bindgen(method, setter)] fn set_height(this: &Record, value: f64);
    #[wasm_bindgen(method, setter)] fn set_area(this: &Record, value: f64);
    #[wasm_bindgen(method, setter)] fn set_mask(this: &Record, value: &Uint8Array);
    #[wasm_bindgen(method, setter)] fn set_perimeter(this: &Record, value: &Int32Array);
    #[wasm_bindgen(method, setter)] fn set_foreground(this: &Record, value: &Int32Array);
    #[wasm_bindgen(method, setter)] fn set_background(this: &Record, value: &Int32Array);
}
fn record() -> Record { Object::new().unchecked_into() }

type R<T> = Result<T, JsValue>;
fn error(message: &str) -> JsValue { js_sys::Error::new(message).into() }
/// `Number.isSafeInteger(value)`, as a count.
fn safe_integer(value: &JsValue) -> Option<f64> { value.as_f64().filter(|n| n.fract() == 0.0 && n.abs() <= 9007199254740991.0) }
/// `raw instanceof Uint8Array || raw instanceof Uint8ClampedArray`, read as bytes either way.
fn bytes(raw: &JsValue) -> Option<&Uint8Array> {
    (raw.is_instance_of::<Uint8ClampedArray>() || raw.is_instance_of::<Uint8Array>()).then(|| raw.unchecked_ref())
}
/// The first `length` bytes of a host array, copied once into this module.
fn taken(raw: &Uint8Array, length: u32) -> Vec<u8> { if raw.length() == length { raw.to_vec() } else { raw.subarray(0, length).to_vec() } }
/// A raster's sides: both within 1..=2048 and no more than 1,048,576 pixels together.
fn sides(width: &JsValue, height: &JsValue) -> Option<(usize, usize)> {
    let (width, height) = (safe_integer(width)?, safe_integer(height)?);
    (width >= 1.0 && height >= 1.0 && width <= 2048.0 && height <= 2048.0 && width * height <= 1048576.0).then_some((width as usize, height as usize))
}

/// The bridge's `rustGlyphMask`: `Err(())` is its `undefined` (malformed input), `Ok(null)` a raster without a
/// usable glyph, otherwise `{ width, height, area, mask, perimeter, foreground, background }` with its sides.
fn glyph(raw: &JsValue, width: &JsValue, rows: &JsValue, stride: &JsValue) -> Result<Option<(JsValue, usize, usize)>, ()> {
    let (source, (width, rows), stride) = (bytes(raw).ok_or(())?, sides(width, rows).ok_or(())?, safe_integer(stride).ok_or(())?);
    let pixels = width * rows;
    if !(1.0..=65535.0).contains(&stride) || (source.length() as usize) < pixels * 4 { return Err(()); }
    let (raster, mut mask, mut points, mut meta) = (taken(source, (pixels * 4) as u32), vec![0u8; pixels], [0i32; 1280], [0u32; 6]);
    // SAFETY: the raster holds width*rows*4 bytes, the mask width*rows, the points 1280 cells and the metadata six.
    match unsafe { font_glyph_mask(raster.as_ptr(), width, rows, stride as usize, mask.as_mut_ptr(), points.as_mut_ptr(), meta.as_mut_ptr()) } {
        1 => return Ok(None),
        2 => {}
        _ => return Err(()),
    }
    let [w, h, area, perimeter, foreground, background] = meta.map(|value| value as usize);
    if w == 0 || h == 0 || w > width || h > rows || area > w * h || perimeter > 280 || foreground > 500 || background > 500 { return Err(()); }
    let found = record();
    let run = |from: usize, count: usize| Int32Array::from(&points[from..from + count]);
    found.set_width(w as f64); found.set_height(h as f64); found.set_area(area as f64);
    found.set_mask(&Uint8Array::from(&mask[..w * h]));
    found.set_perimeter(&run(0, perimeter)); found.set_foreground(&run(perimeter, foreground)); found.set_background(&run(perimeter + foreground, background));
    Ok(Some((found.into(), w, h)))
}

// `glyphMask(raw, maxWidth, rows, stride = maxWidth)`: the mask of a title raster, `null` when it has no glyph.
#[wasm_bindgen]
pub fn glyph_mask(raw: &JsValue, width: &JsValue, rows: &JsValue, stride: &JsValue) -> R<JsValue> {
    match glyph(raw, width, rows, if stride.is_undefined() { width } else { stride }) {
        Ok(found) => Ok(found.map_or(JsValue::NULL, |(mask, _, _)| mask)),
        Err(()) => Err(error("Invalid glyph raster")),
    }
}

// One mask of the title search, from the raster the host just read back: its glyph, kept only when it fits
// the cover's title band (`font_mask_fits`); `null` otherwise.
#[wasm_bindgen]
pub fn title_glyph_mask(raw: &JsValue, width: &JsValue, height: &JsValue, rows: f64) -> R<JsValue> {
    match glyph(raw, width, height, width) {
        Ok(Some((mask, w, h))) if font_mask_fits(w as f64, h as f64, crate::host::num(width), rows) != 0 => Ok(mask),
        Ok(_) => Ok(JsValue::NULL),
        Err(()) => Err(error("Invalid glyph raster")),
    }
}

/// The bridge's `rustPrepareCoverPixels`: the grey plane, the near-edge plane when asked for and whether the
/// cover is busy; `None` for pixels the kernel rejects.
pub fn cover_planes(raw: &JsValue, width: &JsValue, height: &JsValue, edges: bool) -> Option<(Uint8Array, Option<Float32Array>, bool)> {
    let (source, (width, height)) = (bytes(raw)?, sides(width, height)?);
    let pixels = width * height;
    if (source.length() as usize) < pixels * 4 { return None; }
    let (raster, mut gray, mut near) = (taken(source, (pixels * 4) as u32), vec![0u8; pixels], vec![0f32; if edges { pixels } else { 0 }]);
    // SAFETY: the raster holds width*height*4 bytes and the grey plane width*height; the near plane is only
    // written when edges are asked for, and then holds width*height cells.
    let status = unsafe { font_prepare_pixels(raster.as_ptr(), width, height, u32::from(edges), gray.as_mut_ptr(), near.as_mut_ptr()) };
    (status == 1 || status == 2).then(|| (Uint8Array::from(&gray[..]), edges.then(|| Float32Array::from(&near[..])), status == 2))
}

// The same planes as a record, `null` when rejected: `{ gray, near, busy }` (`near` is `null` without edges).
// The analyser calls `cover_planes` directly; this is its export for the differential tests.
#[wasm_bindgen]
pub fn cover_pixel_planes(raw: &JsValue, width: &JsValue, height: &JsValue, edges: bool) -> R<JsValue> {
    let Some((gray, near, busy)) = cover_planes(raw, width, height, edges) else { return Ok(JsValue::NULL) };
    let planes: JsValue = record().into();
    crate::host::set(&planes, "gray", &gray.into())?;
    crate::host::set(&planes, "near", &near.map_or(JsValue::NULL, Into::into))?;
    crate::host::set(&planes, "busy", &JsValue::from_bool(busy))?;
    Ok(planes)
}

// `nearEdgeMap(edges, width)`: each cell's strongest edge among itself and its four neighbours.
#[wasm_bindgen]
pub fn near_edge_map(edges: &JsValue, width: &JsValue) -> R<Float32Array> {
    let width = safe_integer(width).filter(|width| *width >= 1.0);
    let (Some(edges), Some(width)) = (edges.dyn_ref::<Float32Array>(), width) else { return Err(error("Invalid edge plane")) };
    let source = edges.to_vec();
    let mut out = vec![0f32; source.len()];
    // SAFETY: both planes hold `source.len()` cells.
    unsafe { font_near_edges(source.as_ptr(), source.len(), width as u64 as u32 as usize, out.as_mut_ptr()) };
    Ok(Float32Array::from(&out[..]))
}
