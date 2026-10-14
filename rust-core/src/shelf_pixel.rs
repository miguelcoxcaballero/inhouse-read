//! CSS layout uses fractional positions even when the retained room has an integral
//! framebuffer. Choose the nearest integral CSS origin that also falls on a physical pixel.
//! Fractional buffers keep their existing path (offset 0).
fn integer(value: f64) -> bool { value.is_finite() && value.floor() == value }

#[no_mangle]
pub extern "C" fn shelf_pixel_offset(top: f64, width: f64, height: f64, ratio: f64) -> f64 {
    if !(top.is_finite() && width.is_finite() && height.is_finite() && ratio.is_finite()) || ratio <= 0.0
        || !integer(width * ratio) || !integer(height * ratio) { return 0.0; }
    if integer(top * ratio) { return 0.0; }
    // Beyond 2^52 consecutive candidates collapse onto one value: there is no useful origin.
    if top.abs() > 4503599627370496.0 { return 0.0; }
    let mut best: Option<f64> = None;
    let low = (top - 4.0).floor();
    let mut candidate = (top + 4.0).ceil();
    while candidate >= low {
        if integer(candidate * ratio) {
            let offset = candidate - top;
            if best.map_or(true, |known| offset.abs() < known.abs()) { best = Some(offset); }
        }
        candidate -= 1.0;
    }
    best.unwrap_or(0.0)
}
