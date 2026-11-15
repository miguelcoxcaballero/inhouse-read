//! A cover's binding colour, its shade and its legible ink inside the shelf module (formerly
//! src/js/cover-color-wasm.js, a bridge to the numeric core): the bounded sample of the decoded pixels and the
//! three-centre clustering. The kernel is the core's own (rust-core/src/cover_color.rs, compiled into this module
//! by `#[path]`), so it is a plain call over this module's memory: the bridge's arena, its views and its copies
//! are gone. What a caller receives is what the bridge returned: `{ color, shade, ink }` as `#rrggbb` strings,
//! or nothing for pixels it rejected.
use js_sys::{Object, Uint8Array, Uint8ClampedArray};
use wasm_bindgen::prelude::*;
use wasm_bindgen::JsCast;
use crate::cover_color::cover_dominant_style;

type R<T> = Result<T, JsValue>;
/// No more samples than this reach the kernel, whatever the size of the image.
const MAX_SAMPLES: f64 = 32768.0;
/// Up to this many bytes (the analyser's own 192 x 288 raster is 221,184) the pixels are copied into the module
/// in one visit; a larger image is read one sampled row at a time, which is quicker from there on (measured at
/// 512 x 512) and never asks this module's memory to hold an arbitrarily large raster.
const WHOLE_COPY: usize = 1 << 18;

/// `Number.isSafeInteger(value) && value >= 1`.
fn side(value: &JsValue) -> Option<f64> { value.as_f64().filter(|n| n.fract() == 0.0 && *n >= 1.0 && *n <= 9007199254740991.0) }

/// The bridge's `rustCoverColor(core, data, width, height)` without the core: `None` is its `null` (pixels
/// that are not bytes, sides that are not whole and positive, fewer bytes than the sides ask for, or more
/// samples than the bound). The sample keeps the bridge's stride and its row-major order.
pub fn cover_style(data: &JsValue, width: &JsValue, height: &JsValue) -> Option<JsValue> {
    if !(data.is_instance_of::<Uint8ClampedArray>() || data.is_instance_of::<Uint8Array>()) { return None; }
    let source: &Uint8Array = data.unchecked_ref();
    let (width, height) = (side(width)?, side(height)?);
    let pixels = width * height;
    if pixels > 9007199254740991.0 || pixels * 4.0 > source.length() as f64 { return None; }
    let stride = (pixels / 1800.0).sqrt().floor().max(1.0);
    let (columns, rows) = ((width / stride).ceil(), (height / stride).ceil());
    let count = columns * rows;
    if count > MAX_SAMPLES { return None; }
    // Every size below is bounded by the array's own length (pixels * 4 <= length < 2^32).
    let (width, stride, columns, rows, count) = (width as usize, stride as usize, columns as usize, rows as usize, count as usize);
    let samples = if stride == 1 {
        source.subarray(0, (count * 4) as u32).to_vec()
    } else {
        let mut samples = Vec::with_capacity(count * 4);
        // The last sampled column of a row; a row's bytes up to it are all that is read.
        let reach = ((columns - 1) * stride + 1) * 4;
        if pixels as usize * 4 <= WHOLE_COPY {
            let all = source.subarray(0, (pixels as usize * 4) as u32).to_vec();
            for row in 0..rows {
                let start = row * stride * width * 4;
                for pixel in all[start..start + reach].chunks(stride * 4) { samples.extend_from_slice(&pixel[..4]); }
            }
        } else {
            let mut line = vec![0u8; reach];
            for row in 0..rows {
                let start = row * stride * width * 4;
                source.subarray(start as u32, (start + reach) as u32).copy_to(&mut line);
                for pixel in line.chunks(stride * 4) { samples.extend_from_slice(&pixel[..4]); }
            }
        }
        samples
    };
    let mut style = [0u8; 21];
    // SAFETY: `samples` holds count * 4 bytes with count <= 32768, `style` the kernel's 21.
    unsafe { cover_dominant_style(samples.as_ptr(), count, style.as_mut_ptr()) };
    let text = std::str::from_utf8(&style).ok()?;
    let found: JsValue = Object::new().into();
    for (name, at) in [("color", 0), ("shade", 7), ("ink", 14)] {
        crate::host::set(&found, name, &JsValue::from_str(&text[at..at + 7])).ok()?;
    }
    Some(found)
}

// `coverColorFromPixels(data, width, height)`: `null` without pixels or with sides that are not finite and at
// least one; an error for pixels the sample rejects.
#[wasm_bindgen]
pub fn cover_color_style(data: &JsValue, width: &JsValue, height: &JsValue) -> R<JsValue> {
    let finite = |value: &JsValue| value.as_f64().is_some_and(|n| n.is_finite() && n >= 1.0);
    if !data.is_truthy() || !finite(width) || !finite(height) { return Ok(JsValue::NULL); }
    cover_style(data, width, height).ok_or_else(|| js_sys::Error::new("Invalid cover pixels").into())
}
