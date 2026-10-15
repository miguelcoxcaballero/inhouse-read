//! Fine foliage pigment, veins, height and wax roughness.
use crate::plant_glaze::{hash, noise};
use crate::plant_pottery::fbm;
use crate::plant_preview::byte;
use std::f64::consts::PI;

fn smooth(a: f64, b: f64, v: f64) -> f64 {
    let t = ((v - a) / (b - a)).clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}
fn color(hex: u32) -> [f64; 3] {
    [(hex >> 16 & 255) as f64 / 255.0, (hex >> 8 & 255) as f64 / 255.0, (hex & 255) as f64 / 255.0]
}
fn snake(u: f64, v: f64, x: i32, y: i32) -> [f64; 5] {
    let strip = (u * 4.0).floor().min(3.0) as i32;
    let s = u * 4.0 - strip as f64;
    let a = (s * 2.0 - 1.0).abs();
    let seed = (71 + strip * 13) as u32;
    let warp = fbm(s * 2.0, v * 7.0, 0, seed, 2) - 0.5;
    let zig = ((s * 5.0 + noise(s * 3.0, v * 40.0, 0, seed + 4) * 0.8) % 1.0 - 0.5).abs();
    let phase = v * 12.0 + strip as f64 * 0.37 - a * a * 0.55 + warp * 1.5 + zig * 0.3;
    let k = phase.floor() as i32;
    let p = phase - k as f64;
    let span = 0.22 + hash(k, strip, seed) * 0.3;
    let band = smooth(0.0, 0.07, p) * (1.0 - smooth(span, span + 0.07, p)) * (0.5 + 0.5 * hash(k, strip, seed + 5));
    let ripple = ((phase * 2.6 + warp) * PI * 2.0).sin().max(0.0).powi(6) * 0.28;
    let broken = smooth(0.2, 0.55, noise(s * 5.0, v * 70.0, 0, seed + 1));
    let pale = (band * (0.35 + 0.65 * broken)).max(ripple * broken) * (1.0 - smooth(0.84, 1.0, v));
    let speck = hash(x, y, seed + 2) - 0.5;
    let field = fbm(s * 3.0, v * 16.0, 0, seed + 3, 2);
    let margin = smooth(0.82, 0.87, a);
    let seam_at = (a - 0.81) / 0.025;
    let seam = (-(seam_at * seam_at)).exp() * 0.3;
    let deep = color(0x1d3621); let leaf = color(0x2f5230);
    let sage = color(0x96a88c); let gold = color(0xb6a85c);
    let mut out = [0.0; 5];
    for c in 0..3 {
        let green = (deep[c] + (leaf[c] - deep[c]) * field) * (1.0 + speck * 0.06);
        let banded = (green + (sage[c] - green) * pale * 0.8) * (1.0 - seam);
        out[c] = banded + (gold[c] * (0.94 + speck * 0.1) - banded) * margin;
    }
    out[3] = 0.46 + pale * 0.06 - margin * 0.03 + speck * 0.03;
    out[4] = 0.6 + pale * 0.06 + speck * 0.05;
    out
}
fn broad(kind: u32, u: f64, v: f64, x: i32, y: i32, cfg: &[f64], midrib: f64, wave: f64) -> [f64; 5] {
    let signed = u * 2.0 - 1.0;
    let a = signed.abs();
    let vein_phase = (v * 9.0 - a * 0.95 + 0.06 * wave + signed * 0.09) * PI * 2.0;
    let mut lateral = vein_phase.cos().max(0.0).powi(24) * (1.0 - a);
    let fine = ((v * 37.0 + a * 12.0) * PI * 2.0).cos().max(0.0).powi(18) * a * (1.0 - a);
    if kind == 1 {
        let angle = (signed * 0.5).atan2(v);
        let reach = (signed * 0.5).hypot(v);
        lateral = (angle * 11.4).cos().max(0.0).powi(46) * smooth(0.95, 0.1, reach) * 2.2;
    }
    let seed = cfg[4] as u32;
    let cells = (hash(x, y, seed) - 0.5) * 0.025;
    let mottling = (v * 19.0 + (signed * 11.0 + cfg[3]).sin()).sin() * (signed * 17.0 - v * 7.0).cos() * 0.027;
    let margin = if kind == 1 { a.powi(5) * 0.06 } else { 0.0 };
    let bloom = if kind == 2 { fbm(u * 6.0, v * 6.0, 0, seed + 4, 3) * 0.05 } else { 0.0 };
    let veins = (midrib * 0.055 + lateral * 0.035 + fine * 0.012) * if kind == 2 { 0.12 } else if kind == 1 { 1.6 } else { 1.0 };
    let variation = cells + mottling + margin + veins + bloom;
    [cfg[0] + variation, cfg[1] + variation, cfg[2] + variation * 0.65 + bloom * 0.6,
     0.38 + midrib * 0.30 + lateral * 0.16 + fine * 0.06 + cells,
     0.62 + veins * 2.0 + mottling * 3.0 + cells]
}
/// Whether a foliage configuration is usable: RGB in [0,1], a phase in [0, 2π] and an integer seed.
pub(crate) fn valid(cfg: &[f64]) -> bool {
    !(cfg.iter().any(|v| !v.is_finite()) || cfg[..3].iter().any(|v| *v < 0.0 || *v > 1.0) || cfg[3] < 0.0 || cfg[3] > PI * 2.0 || cfg[4] < 0.0 || cfg[4] > 1_000_000.0 || cfg[4].fract() != 0.0)
}
/// The central vein and its sweep: constant along a column.
pub(crate) fn column(kind: u32, u: f64) -> (f64, f64) {
    let a = (u * 2.0 - 1.0).abs();
    (if kind == 3 { 0.0 } else { (-a * 48.0).exp() }, if kind == 3 { 0.0 } else { (a * 5.0).sin() })
}
/// One texel of a leaf surface (kind 0 broad, 1 ivy, 2 succulent, 3 sansevieria strips).
pub(crate) fn texel(kind: u32, cfg: &[f64], u: f64, v: f64, x: i32, y: i32, midrib: f64, wave: f64) -> [f64; 5] {
    if kind == 3 { snake(u, v, x, y) } else { broad(kind, u, v, x, y, cfg, midrib, wave) }
}
/// # Safety
/// cfg holds RGB, phase and seed. output has width * count * 8 bytes.
#[no_mangle]
pub unsafe extern "C" fn plant_foliage_rows(kind: u32, width: usize, height: usize, row: usize, count: usize, cfg: *const f64, output: *mut u8) -> u32 {
    if kind > 3 || width == 0 || height == 0 || width > 2048 || height > 2048 || count == 0 || count > 4 || row >= height || count > height - row { return 0; }
    let cfg = std::slice::from_raw_parts(cfg, 5);
    if !valid(cfg) { return 0; }
    let size = width * count * 4;
    let (pigment, data) = std::slice::from_raw_parts_mut(output, size * 2).split_at_mut(size);
    // The central vein and its sweep are constant for each column in a row batch.
    for x in 0..width {
        let u = (x as f64 + 0.5) / width as f64;
        let (midrib, wave) = column(kind, u);
        for offset in 0..count {
            let y = row + offset; let v = (y as f64 + 0.5) / height as f64;
            let t = texel(kind, cfg, u, v, x as i32, y as i32, midrib, wave);
            let at = (offset * width + x) * 4;
            for k in 0..3 { pigment[at + k] = byte(t[k]); }
            pigment[at + 3] = 255; data[at] = byte(t[3]); data[at + 1] = byte(t[4]); data[at + 2] = 0; data[at + 3] = 255;
        }
    }
    1
}
