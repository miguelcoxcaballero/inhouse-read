//! Colour temperature of a lamp's light (Kim et al.'s cubic fit of the
//! Planckian locus, 1667-25000 K). Powers are supplied by the host: `**`
//! rounds differently on every libm (the host's `t ** 3` and Rust's `powf`
//! differ in the last bit for about 5 % of inputs), so the cubes and squares
//! the original formula used are computed by the caller and every other
//! operation keeps the original order here.
use crate::jsnum::{max, min};

const DEFAULT: f64 = 2700.0;

/// Math.min(25000, Math.max(1667, Number(kelvin) || 2700)); `kelvin` is the
/// value after the host's Number() conversion.
#[no_mangle]
pub extern "C" fn kelvin_clamp(kelvin: f64) -> f64 {
    let value = if kelvin.is_nan() || kelvin == 0.0 { DEFAULT } else { kelvin };
    min(25000.0, max(1667.0, value))
}

/// Chromaticity x of a black body at `t` kelvin; `cube` = t ** 3, `square` = t ** 2.
#[no_mangle]
pub extern "C" fn kelvin_chroma_x(t: f64, cube: f64, square: f64) -> f64 {
    if t <= 4000.0 { -0.2661239e9 / cube - 0.2343589e6 / square + 0.8776956e3 / t + 0.179910 }
    else { -3.0258469e9 / cube + 2.1070379e6 / square + 0.2226347e3 / t + 0.240390 }
}

/// Linear sRGB of a black body scaled to a largest channel of 1, written to
/// `out[0..3]`; `cube` = x ** 3 and `square` = x ** 2 of `kelvin_chroma_x`.
/// # Safety
/// `out` points to three writable, 8-byte aligned f64 values.
#[no_mangle]
pub unsafe extern "C" fn kelvin_linear_rgb(t: f64, x: f64, cube: f64, square: f64, out: *mut f64) -> u32 {
    if out.is_null() || (out as usize) % 8 != 0 { return 0; }
    let y = if t <= 2222.0 { -1.1063814 * cube - 1.34811020 * square + 2.18555832 * x - 0.20219683 }
        else if t <= 4000.0 { -0.9549476 * cube - 1.37418593 * square + 2.09137015 * x - 0.16748867 }
        else { 3.0817580 * cube - 5.87338670 * square + 3.75112997 * x - 0.37001483 };
    let big_x = x / y;
    let big_z = (1.0 - x - y) / y;
    let r = max(0.0, 3.2406 * big_x - 1.5372 - 0.4986 * big_z);
    let g = max(0.0, -0.9689 * big_x + 1.8758 + 0.0415 * big_z);
    let b = max(0.0, 0.0557 * big_x - 0.2040 + 1.0570 * big_z);
    let largest = max(max(r, g), b);
    let peak = if largest.is_nan() || largest == 0.0 { 1.0 } else { largest };
    let out = std::slice::from_raw_parts_mut(out, 3);
    out[0] = r / peak; out[1] = g / peak; out[2] = b / peak;
    1
}

/// Per-channel multipliers of a lamp's warm colours, with the same luminance
/// at every temperature: `rgb` is divided by `reference` (the 2700 K colour)
/// and then by its own luminance, in place.
/// # Safety
/// `rgb` and `reference` point to three f64 values each, `rgb` writable.
#[no_mangle]
pub unsafe extern "C" fn lamp_tint_finish(rgb: *mut f64, reference: *const f64) -> u32 {
    if rgb.is_null() || reference.is_null() || (rgb as usize) % 8 != 0 || (reference as usize) % 8 != 0 { return 0; }
    let (rgb, reference) = (std::slice::from_raw_parts_mut(rgb, 3), std::slice::from_raw_parts(reference, 3));
    for channel in 0..3 { rgb[channel] /= reference[channel]; }
    let luminance = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
    for channel in 0..3 { rgb[channel] /= luminance; }
    1
}

/// One channel of the swatch colour: Math.round(255 * (v <= .0031308 ? 12.92 * v
/// : 1.055 * powered - .055)) with `powered` = v ** (1 / 2.4) from the host.
#[no_mangle]
pub extern "C" fn srgb_encode(value: f64, powered: f64) -> f64 {
    crate::jsnum::round(255.0 * (if value <= 0.0031308 { 12.92 * value } else { 1.055 * powered - 0.055 }))
}

/// The easing of a temperature change in flight: `moment` is the elapsed
/// fraction (already clamped to 0..1) and the result is the mix amount.
#[no_mangle]
pub extern "C" fn tint_ease(moment: f64) -> f64 {
    if moment >= 1.0 { return 1.0; }
    if moment < 0.5 { 2.0 * moment * moment } else { let k = -2.0 * moment + 2.0; 1.0 - k * k / 2.0 }
}

/// The elapsed fraction of a transition: 1 without a duration, else
/// Math.min(1, Math.max(0, (now - started) / duration)).
#[no_mangle]
pub extern "C" fn tint_moment(now: f64, started: f64, duration: f64) -> f64 {
    if duration != 0.0 && !duration.is_nan() { min(1.0, max(0.0, (now - started) / duration)) } else { 1.0 }
}

/// `from + (to - from) * amount` per channel into `out`.
/// # Safety
/// Three f64 values behind each pointer, `out` writable (it may alias `from`).
#[no_mangle]
pub unsafe extern "C" fn tint_mix(from: *const f64, to: *const f64, amount: f64, out: *mut f64) -> u32 {
    if from.is_null() || to.is_null() || out.is_null() { return 0; }
    for channel in 0..3 {
        let (a, b) = (*from.add(channel), *to.add(channel));
        *out.add(channel) = a + (b - a) * amount;
    }
    1
}
