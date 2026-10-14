//! Book colours: hex parsing, HSL, the twelve book cloths a binder would stock
//! and the legible ink for any spine colour. The host passes the text as UTF-16
//! units (a colour from a record, a form or a backup) and receives `#rrggbb`
//! as ASCII bytes. Arithmetic keeps the original order in f64.
use crate::jsnum;

/// Deep, dyed tones: oxblood, rust, ochre, olive, moss, bottle green, peacock,
/// slate, navy, indigo, aubergine, claret.
const BOOKCLOTH: [&str; 12] = ["#6e2a2a", "#9a4a2c", "#9a7432", "#5e6130", "#4f6a2e", "#245439",
    "#1f5359", "#3a5470", "#1f2f52", "#3b3368", "#5a2a50", "#7a2e3e"];
const FALLBACK: [f64; 3] = [139.0, 94.0, 60.0];
const NEUTRAL: [&str; 2] = ["#6e2a2a", "#1f2f52"];

/// ECMAScript WhiteSpace and LineTerminator: what String.prototype.trim removes.
fn is_space(unit: u16) -> bool {
    matches!(unit, 0x09..=0x0D | 0x20 | 0xA0 | 0x1680 | 0x2000..=0x200A | 0x2028 | 0x2029 | 0x202F | 0x205F | 0x3000 | 0xFEFF)
}

/// /^#?([\da-f]{3}|[\da-f]{6})$/i on the trimmed text, as three 8-bit channels.
fn parse_hex(units: &[u16]) -> Option<[f64; 3]> {
    let start = units.iter().position(|&unit| !is_space(unit))?;
    let end = units.iter().rposition(|&unit| !is_space(unit))? + 1;
    let text = &units[start..end];
    let digits = if text.first() == Some(&(b'#' as u16)) { &text[1..] } else { text };
    if digits.len() != 3 && digits.len() != 6 { return None; }
    let mut values = Vec::with_capacity(6);
    for &unit in digits {
        values.push(char::from_u32(unit as u32).and_then(|c| c.to_digit(16))? as f64);
    }
    if values.len() == 3 { values = values.iter().flat_map(|&v| [v, v]).collect(); }
    Some([values[0] * 16.0 + values[1], values[2] * 16.0 + values[3], values[4] * 16.0 + values[5]])
}
fn parse_text(text: &str) -> [f64; 3] { parse_hex(&text.encode_utf16().collect::<Vec<_>>()).unwrap() }

/// `#rrggbb` of three channels, each rounded and held to 0..255.
fn to_hex(values: [f64; 3]) -> [u8; 7] {
    let mut out = [b'#'; 7];
    for (index, &value) in values.iter().enumerate() {
        let byte = jsnum::round(jsnum::min(255.0, jsnum::max(0.0, value))) as u8;
        out[1 + index * 2] = b"0123456789abcdef"[(byte >> 4) as usize];
        out[2 + index * 2] = b"0123456789abcdef"[(byte & 15) as usize];
    }
    out
}

struct Hsl { hue: f64, saturation: f64 }
fn to_hsl(rgb: [f64; 3]) -> Hsl {
    let (r, g, b) = (rgb[0] / 255.0, rgb[1] / 255.0, rgb[2] / 255.0);
    let (high, low) = (jsnum::max(jsnum::max(r, g), b), jsnum::min(jsnum::min(r, g), b));
    let lightness = (high + low) / 2.0;
    let delta = high - low;
    let (mut hue, mut saturation) = (0.0, 0.0);
    if delta != 0.0 {
        saturation = delta / (1.0 - (2.0 * lightness - 1.0).abs());
        hue = if high == r { 60.0 * (((g - b) / delta) % 6.0) } else if high == g { 60.0 * ((b - r) / delta + 2.0) } else { 60.0 * ((r - g) / delta + 4.0) };
    }
    Hsl { hue: (hue + 360.0) % 360.0, saturation }
}
fn hue_distance(a: f64, b: f64) -> f64 {
    let d = (((a - b) % 360.0 + 360.0) % 360.0).abs();
    jsnum::min(d, 360.0 - d)
}

/// Math.hypot as the host computes it: scaled by the largest value and summed
/// with Kahan compensation, which is not the same rounding as sqrt(a*a + ...).
fn hypot(values: [f64; 3]) -> f64 {
    let absolute = values.map(f64::abs);
    let largest = absolute.iter().fold(0.0_f64, |m, &v| if v > m { v } else { m });
    if largest == 0.0 { return 0.0; }
    let (mut sum, mut compensation) = (0.0, 0.0);
    for value in absolute {
        let n = value / largest;
        let summand = n * n - compensation;
        let preliminary = sum + summand;
        compensation = (preliminary - sum) - summand;
        sum = preliminary;
    }
    sum.sqrt() * largest
}

/// The cloth nearest a target hue that stays clearly apart from the colours
/// already offered.
fn cloth_near(hue: f64, taken: &[[f64; 3]]) -> &'static str {
    let mut ranked: Vec<(f64, usize, [f64; 3])> = BOOKCLOTH.iter().enumerate().map(|(index, hex)| {
        let rgb = parse_text(hex);
        (hue_distance(to_hsl(rgb).hue, hue), index, rgb)
    }).collect();
    ranked.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap().then(a.1.cmp(&b.1)));
    let apart = |cloth: &[f64; 3]| taken.iter().all(|rgb| hypot([cloth[0] - rgb[0], cloth[1] - rgb[1], cloth[2] - rgb[2]]) > 80.0);
    BOOKCLOTH[ranked.iter().find(|entry| apart(&entry.2)).unwrap_or(&ranked[0]).1]
}

unsafe fn text<'a>(units: *const u16, length: usize) -> &'a [u16] {
    if length == 0 { &[] } else { std::slice::from_raw_parts(units, length) }
}
fn valid(units: *const u16, length: usize, out: *mut u8) -> bool {
    length <= 1 << 20 && !out.is_null() && (length == 0 || (!units.is_null() && (units as usize) % 2 == 0))
}

/// The cover colour plus two split-complementary cloths; neutral covers get
/// oxblood and navy. Writes three `#rrggbb` strings (21 bytes) to `out`.
/// # Safety
/// `units` points to `length` readable, 2-byte aligned u16 values and `out` to
/// 21 writable bytes. Nothing is retained.
#[no_mangle]
pub unsafe extern "C" fn book_color_options(units: *const u16, length: usize, out: *mut u8) -> u32 {
    if !valid(units, length, out) { return 0; }
    let rgb = parse_hex(text(units, length)).unwrap_or(FALLBACK);
    let hsl = to_hsl(rgb);
    let options: [[u8; 7]; 3] = if hsl.saturation < 0.16 {
        [to_hex(rgb), to_hex(parse_text(NEUTRAL[0])), to_hex(parse_text(NEUTRAL[1]))]
    } else {
        let second = cloth_near(hsl.hue + 135.0, &[rgb]);
        let third = cloth_near(hsl.hue + 245.0, &[rgb, parse_text(second)]);
        [to_hex(rgb), to_hex(parse_text(second)), to_hex(parse_text(third))]
    };
    std::slice::from_raw_parts_mut(out, 21).copy_from_slice(&options.concat());
    1
}

/// Spine shading and legible title ink for any user-selected colour. Writes
/// three `#rrggbb` strings (21 bytes): the colour, its shade and the ink.
/// # Safety
/// As `book_color_options`.
#[no_mangle]
pub unsafe extern "C" fn spine_color_style(units: *const u16, length: usize, out: *mut u8) -> u32 {
    if !valid(units, length, out) { return 0; }
    let rgb = parse_hex(text(units, length)).unwrap_or(FALLBACK);
    let linear = rgb.map(|channel| {
        let v = channel / 255.0;
        if v <= 0.04045 { v / 12.92 } else { ((v + 0.055) / 1.055).powf(2.4) }
    });
    let luminance = 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
    let white_contrast = 1.05 / (luminance + 0.05);
    let dark_contrast = (luminance + 0.05) / 0.057;
    let ink = if white_contrast >= dark_contrast { b"#fffaf0" } else { b"#171512" };
    let styled: [[u8; 7]; 3] = [to_hex(rgb), to_hex(rgb.map(|v| v * 0.76)), *ink];
    std::slice::from_raw_parts_mut(out, 21).copy_from_slice(&styled.concat());
    1
}

/// `#rrggbb` of a colour text when it parses (3 or 6 hex digits, optional `#`),
/// else 0. Writes 7 bytes to `out`.
/// # Safety
/// As `book_color_options`, with 7 writable bytes.
#[no_mangle]
pub unsafe extern "C" fn color_hex(units: *const u16, length: usize, out: *mut u8) -> u32 {
    if !valid(units, length, out) { return 0; }
    let Some(rgb) = parse_hex(text(units, length)) else { return 0 };
    std::slice::from_raw_parts_mut(out, 7).copy_from_slice(&to_hex(rgb));
    1
}
