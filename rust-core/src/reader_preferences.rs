//! Reader presentation policy. DOM, storage and installed voice objects stay
//! in the host; validated presentation choices and CSS are produced here.
const DEFAULTS: [f64; 8] = [20.0, 1.6, 16.0, 100.0, 1.0, 100.0, 400.0, 0.0];
const MIN: [f64; 8] = [14.0, 1.2, 0.0, 70.0, 0.75, 50.0, 400.0, 0.0];
const MAX: [f64; 8] = [36.0, 2.4, 64.0, 200.0, 2.0, 120.0, 600.0, 0.0];

#[no_mangle]
pub extern "C" fn reader_nearest_rate(value: f64) -> f64 {
    if !value.is_finite() { return 1.0; }
    let mut best: f64 = 0.75;
    for step in [1.0_f64, 1.25, 1.5, 2.0] {
        if (step - value).abs() < (best - value).abs() { best = step; }
    }
    best
}

/// # Safety
/// Eight readable/writable f64 entries: size, line height, margin, zoom, rate,
/// brightness, weight, reserved. NaN is a missing/non-finite host number.
#[no_mangle]
pub unsafe extern "C" fn reader_preferences(values: *mut f64) -> u32 {
    if values.is_null() { return 0; }
    let values = std::slice::from_raw_parts_mut(values, 8);
    for i in 0..8 {
        values[i] = if i == 4 { reader_nearest_rate(values[i]) }
        else if i == 6 { if [400.0, 500.0, 600.0].contains(&values[i]) { values[i] } else { 400.0 } }
        else { let value = if values[i].is_finite() { values[i] } else { DEFAULTS[i] };
            // JS Math.max(+0, -0) must become +0 too.
            if value <= MIN[i] { MIN[i] } else if value >= MAX[i] { MAX[i] } else { value } };
    }
    1
}

/// # Safety
/// `values` contains the eight normalized preferences. Output is a host-owned
/// byte arena of capacity bytes; zero means invalid input or insufficient room.
#[no_mangle]
pub unsafe extern "C" fn reader_css(values: *const f64, theme: u32, font: u32,
    justified: u32, output: *mut u8, capacity: usize) -> usize {
    if values.is_null() || output.is_null() || theme > 4 || font > 3 || capacity > 16384 { return 0; }
    let p = std::slice::from_raw_parts(values, 8);
    if p.iter().any(|x| !x.is_finite()) { return 0; }
    let (background, color, scheme) = [
        ("#faf9f5", "#292821", "light"), ("#eee0c4", "#483825", "light"),
        ("#191c1a", "#d4d8cc", "dark"), ("#000000", "#c6c6c6", "dark"),
        ("#dce5d8", "#2c3a30", "light")][theme as usize];
    let family = ["Georgia, \"Times New Roman\", serif", "Palatino, \"Book Antiqua\", serif",
        "Arial, Helvetica, sans-serif", "monospace"][font as usize];
    let align = if justified != 0 { "justify" } else { "start" };
    let amoled = if theme == 3 { "body :is(p, li, blockquote, div, section, article, main, table, td, th, h1, h2, h3, h4, h5, h6, span, a, em, strong, small, pre, code) { background-color:transparent !important; }" } else { "" };
    let css = format!("html {{ -webkit-text-size-adjust:100%; text-size-adjust:100%; color-scheme:{scheme}; --theme-bg-color:{background}; background:{background} !important; }}\n    body {{ background:{background} !important; color:{color} !important; }}\n    body, p, li, blockquote, div {{ font-family:{family} !important; font-size:{}px !important; font-weight:{} !important; line-height:{} !important; text-align:{align} !important; }}\n    p, li, span, a, h1, h2, h3, h4, h5, h6, blockquote, div, section, article, main, table, td, th, em, strong, small, pre, code {{ color:inherit !important; }}\n    {amoled}\n    a {{ text-decoration:underline; }} img, svg {{ max-width:100%; height:auto; }}", p[0], p[6], p[1]);
    if css.len() > capacity { return 0; }
    std::ptr::copy_nonoverlapping(css.as_ptr(), output, css.len());
    css.len()
}
