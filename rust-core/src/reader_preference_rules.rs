//! Shared reader presentation rules; app-core ABI and object-aware UI adapters
//! call the same numeric and CSS implementation.
const DEFAULTS: [f64; 8] = [20.0, 1.6, 16.0, 100.0, 1.0, 100.0, 400.0, 0.0];
const MIN: [f64; 8] = [14.0, 1.2, 0.0, 70.0, 0.75, 50.0, 400.0, 0.0];
const MAX: [f64; 8] = [36.0, 2.4, 64.0, 200.0, 2.0, 120.0, 600.0, 0.0];

pub fn nearest_rate(value: f64) -> f64 {
    if !value.is_finite() { return 1.0; }
    let mut best: f64 = 0.75;
    for step in [1.0_f64, 1.25, 1.5, 2.0] {
        if (step - value).abs() < (best - value).abs() { best = step; }
    }
    best
}

pub fn normalize_values(values: &mut [f64; 8]) {
    for i in 0..8 {
        values[i] = if i == 4 { nearest_rate(values[i]) }
        else if i == 6 { if [400.0, 500.0, 600.0].contains(&values[i]) { values[i] } else { 400.0 } }
        else { let value = if values[i].is_finite() { values[i] } else { DEFAULTS[i] };
            // JS Math.max(+0, -0) must become +0 too.
            if value <= MIN[i] { MIN[i] } else if value >= MAX[i] { MAX[i] } else { value } };
    }
}
pub fn css(p: &[f64; 8], theme: usize, font: usize, justified: bool) -> String {
    let (background, color, scheme) = [
        ("#faf9f5", "#292821", "light"), ("#eee0c4", "#483825", "light"),
        ("#191c1a", "#d4d8cc", "dark"), ("#000000", "#c6c6c6", "dark"),
        ("#dce5d8", "#2c3a30", "light")][theme as usize];
    let family = ["Georgia, \"Times New Roman\", serif", "Palatino, \"Book Antiqua\", serif",
        "Arial, Helvetica, sans-serif", "monospace"][font as usize];
    let align = if justified { "justify" } else { "start" };
    let amoled = if theme == 3 { "body :is(p, li, blockquote, div, section, article, main, table, td, th, h1, h2, h3, h4, h5, h6, span, a, em, strong, small, pre, code) { background-color:transparent !important; }" } else { "" };
    format!("html {{ -webkit-text-size-adjust:100%; text-size-adjust:100%; color-scheme:{scheme}; --theme-bg-color:{background}; background:{background} !important; }}\n    body {{ background:{background} !important; color:{color} !important; }}\n    body, p, li, blockquote, div {{ font-family:{family} !important; font-size:{}px !important; font-weight:{} !important; line-height:{} !important; text-align:{align} !important; }}\n    p, li, span, a, h1, h2, h3, h4, h5, h6, blockquote, div, section, article, main, table, td, th, em, strong, small, pre, code {{ color:inherit !important; }}\n    {amoled}\n    a {{ text-decoration:underline; }} img, svg {{ max-width:100%; height:auto; }}", p[0], p[6], p[1])
}
