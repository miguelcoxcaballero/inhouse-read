//! Per-colour membership from host-prepared OKLab f64 values. The browser
//! retains Math.cbrt; Rust preserves the original distance/smoothing order.

/// # Safety
/// Lab has count*3 f64 values and alpha count bytes. Output has end-start f32
/// slots, at most 1024. The three ranges are valid, live and non-overlapping.
#[no_mangle]
pub unsafe extern "C" fn relief_color_mask_pixels(
    lab: *const f64, alpha: *const u8, output: *mut f32,
    count: usize, start: usize, end: usize,
    target_l: f64, target_a: f64, target_b: f64, tolerance: f64,
) -> u32 {
    if count == 0 || count > 262144 || start > end || end > count || end - start > 1024
        || !target_l.is_finite() || !target_a.is_finite() || !target_b.is_finite()
        || !tolerance.is_finite() || tolerance <= 0.0 || tolerance > 12.0 { return 0; }
    let lab = std::slice::from_raw_parts(lab, count * 3);
    let alpha = std::slice::from_raw_parts(alpha, count);
    let out = std::slice::from_raw_parts_mut(output, end - start);
    let square = tolerance * tolerance;
    for i in start..end {
        let mut amount = 0.0;
        if alpha[i] >= 128 {
            let at = i * 3;
            let dl = target_l - lab[at];
            let da = target_a - lab[at + 1];
            let db = target_b - lab[at + 2];
            let distance = dl * dl + da * da + db * db;
            if distance < square {
                let low = tolerance * 0.72;
                let t = ((distance.sqrt() - low) / (tolerance - low)).clamp(0.0, 1.0);
                let smooth = t * t * (3.0 - 2.0 * t);
                amount = (1.0 - smooth) * alpha[i] as f64 / 255.0;
            }
        }
        out[i - start] = amount as f32;
    }
    1
}
