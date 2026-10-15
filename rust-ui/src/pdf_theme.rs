//! Themed PDF paper. PDF.js reports image footprints in normalized page coordinates; the printed
//! paper and ink are themed once, then the ORIGINAL pixels are copied back inside each footprint.
//! No pixel readback or CPU loop is needed, including for monochrome photos.
use wasm_bindgen::{prelude::*, JsCast};
use js_sys::Float64Array;
use crate::host::{absent, call, get, method, num, set, truthy};

/// Theme `source` onto `target` with `filter`, restoring the pictures from `source`.
pub(crate) fn paint(source: &JsValue, target: &JsValue, filter: &JsValue, coordinates: &JsValue, paths: &JsValue) -> Result<(), JsValue> {
    let ctx = method(target, "getContext", &[&"2d".into()])?;
    let (width, height) = (get(target, "width"), get(target, "height"));
    method(&ctx, "clearRect", &[&0.into(), &0.into(), &width, &height])?;
    set(&ctx, "filter", filter)?;
    method(&ctx, "drawImage", &[source, &0.into(), &0.into(), &width, &height])?;
    set(&ctx, "filter", &"none".into())?;
    if *filter == "none" || !truthy(&get(coordinates, "length")) { return Ok(()); }
    // Three adjacent corners define the fourth, and reflected images get the same
    // winding as ordinary ones, so overlapping paths cannot cause cancellation and recolour
    // that area. A rectangular bounding box would restore white wedges around
    // rotated photographs in night mode.
    let outline = call(paths, "pdfImagePaths", &[coordinates, &width, &height])?.unchecked_into::<Float64Array>().to_vec();
    method(&ctx, "save", &[])?;
    method(&ctx, "beginPath", &[])?;
    for corner in outline.chunks(8) {
        let point = |index: usize| -> JsValue { corner.get(index).copied().map_or(JsValue::UNDEFINED, JsValue::from_f64) };
        method(&ctx, "moveTo", &[&point(0), &point(1)])?;
        for at in [2, 4, 6] { method(&ctx, "lineTo", &[&point(at), &point(at + 1)])?; }
        method(&ctx, "closePath", &[])?;
    }
    method(&ctx, "clip", &[])?;
    method(&ctx, "drawImage", &[source, &0.into(), &0.into(), &width, &height])?;
    method(&ctx, "restore", &[])?;
    Ok(())
}

#[wasm_bindgen]
pub fn pdf_paint_theme(source: &JsValue, target: &JsValue, filter: &JsValue, coordinates: &JsValue, paths: &JsValue) -> Result<(), JsValue> {
    paint(source, target, filter, coordinates, paths)
}

/// Stencil masks still bypass PDF.js's image-footprint tracker. Preserve their
/// original printed page rather than guess bounds. The guarded Vite patch now
/// records grouped/repeated ordinary images at every actual draw transform.
#[wasm_bindgen]
pub fn pdf_untracked_images(operators: &JsValue, ops: &JsValue) -> Result<bool, JsValue> {
    let numbers: Vec<f64> = ["paintImageMaskXObject", "paintImageMaskXObjectGroup", "paintImageMaskXObjectRepeat", "paintSolidColorImageMask"]
        .iter().map(|name| get(ops, name)).filter(|value| value.as_f64().is_some_and(f64::is_finite)).map(|value| num(&value)).collect();
    let list = get(operators, "fnArray");
    if absent(&list) { return Ok(false); }
    let marks = Closure::<dyn FnMut(JsValue) -> bool>::new(move |op: JsValue| op.as_f64().is_some_and(|op| numbers.contains(&op)));
    Ok(truthy(&method(&list, "some", &[marks.as_ref()])?))
}
