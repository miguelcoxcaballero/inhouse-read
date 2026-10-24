//! App-core ABI for the shared reader presentation rules.
#[path = "reader_preference_rules.rs"]
mod rules;

#[no_mangle]
pub extern "C" fn reader_nearest_rate(value: f64) -> f64 { rules::nearest_rate(value) }

/// # Safety
/// Eight readable/writable f64 entries: size, line height, margin, zoom, rate,
/// brightness, weight, reserved. NaN is a missing/non-finite host number.
#[no_mangle]
pub unsafe extern "C" fn reader_preferences(values: *mut f64) -> u32 {
    if values.is_null() { return 0; }
    rules::normalize_values(&mut *values.cast::<[f64; 8]>());
    1
}

/// # Safety
/// `values` contains the eight normalized preferences. Output is a host-owned
/// byte arena of capacity bytes; zero means invalid input or insufficient room.
#[no_mangle]
pub unsafe extern "C" fn reader_css(values: *const f64, theme: u32, font: u32,
    justified: u32, output: *mut u8, capacity: usize) -> usize {
    if values.is_null() || output.is_null() || theme > 4 || font > 3 || capacity > 16384 { return 0; }
    let p = &*values.cast::<[f64; 8]>();
    if p.iter().any(|x| !x.is_finite()) { return 0; }
    let css = rules::css(p, theme as usize, font as usize, justified != 0);
    if css.len() > capacity { return 0; }
    std::ptr::copy_nonoverlapping(css.as_ptr(), output, css.len());
    css.len()
}
