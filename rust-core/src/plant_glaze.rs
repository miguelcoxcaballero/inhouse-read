//! Full-resolution glazed pottery in the same bounded four-row idle slices.
use crate::plant_preview::byte;
pub(crate) fn hash(x: i32, y: i32, seed: u32) -> f64 {
    let mut h = (x as u32).wrapping_mul(0x27d4eb2d) ^ (y as u32).wrapping_mul(0x165667b1) ^ seed.wrapping_mul(0x9e3779b1);
    h = (h ^ (h >> 15)).wrapping_mul(0x85ebca6b);
    h = (h ^ (h >> 13)).wrapping_mul(0xc2b2ae35);
    (h ^ (h >> 16)) as f64 / 4294967296.0
}
fn wrap(value: i32, period: i32) -> i32 { (value % period + period) % period }
pub(crate) fn noise(x: f64, y: f64, period: i32, seed: u32) -> f64 {
    let xi = x.floor() as i32; let yi = y.floor() as i32;
    let fx = x - xi as f64; let fy = y - yi as f64;
    let sx = fx * fx * (3.0 - 2.0 * fx); let sy = fy * fy * (3.0 - 2.0 * fy);
    let x0 = wrap(xi, period); let x1 = wrap(xi + 1, period);
    let a = hash(x0, yi, seed); let b = hash(x1, yi, seed);
    let c = hash(x0, yi + 1, seed); let d = hash(x1, yi + 1, seed);
    a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy
}
fn cloud(x: f64, y: f64, seed: u32) -> f64 {
    (0.5 * noise(x, y, 5, seed) + 0.25 * noise(x * 2.0, y * 2.0, 10, seed + 31)) / 0.75
}
fn smooth(a: f64, b: f64, value: f64) -> f64 {
    let t = ((value - a) / (b - a)).clamp(0.0, 1.0); t * t * (3.0 - 2.0 * t)
}
fn cells(x: f64, y: f64, seed: u32) -> (f64, f64) {
    let xi = x.floor() as i32; let yi = y.floor() as i32;
    let (mut first, mut second) = (9.0_f64, 9.0_f64);
    for j in -1..=1 { for i in -1..=1 {
        let cy = yi + j; let h = hash(wrap(xi + i, 12), cy, seed);
        let dx = (xi + i) as f64 + h - x; let dy = cy as f64 + h * 4099.0 % 1.0 - y;
        let d = dx * dx + dy * dy;
        if d < first { second = first; first = d; } else if d < second { second = d; }
    } }
    (first.sqrt(), second.sqrt())
}
/// # Safety
/// config has 10 finite f64; output has width*count*8 bytes. No retained state.
#[no_mangle]
pub unsafe extern "C" fn plant_glaze_rows(width: usize, height: usize, row: usize,
    count: usize, config: *const f64, output: *mut u8) -> u32 {
    if width == 0 || height == 0 || width > 2048 || height > 2048 || count == 0 || count > 4 || row >= height || count > height - row { return 0; }
    let c = std::slice::from_raw_parts(config, 10);
    if c.iter().any(|v| !v.is_finite()) || c[..9].iter().any(|v| *v < 0.0 || *v > 1.0)
        || c[9] < 0.0 || c[9] > 1_000_000.0 || c[9].fract() != 0.0 { return 0; }
    let seed = c[9] as u32; let size = width * count * 4;
    let (pigment, data) = std::slice::from_raw_parts_mut(output, size * 2).split_at_mut(size);
    for x in 0..width {
        let u = (x as f64 + 0.5) / width as f64;
        let edge = 0.07 + (noise(u * 18.0, 0.0, 18, seed + 4) - 0.5) * 0.018
            - (noise(u * 36.0, 0.0, 36, seed + 3) - 0.7).max(0.0) * 0.1;
        for offset in 0..count {
            let y = row + offset; let v = (y as f64 + 0.5) / height as f64;
            let at = (offset * width + x) * 4;
            let mut texel = [0.2, 0.2, 0.2, 0.5, 1.0];
            if v < 0.74 + 0.03 {
                let cloud = cloud(u * 5.0, v * 5.0, seed);
                let glazed = smooth(edge - 0.004, edge + 0.004, v);
                let z = (v - edge) / 0.006; let bead = (-(z * z)).exp();
                let z = (v - 0.6) / 0.012; let lip = (-(z * z)).exp() * 0.24;
                let speck = if hash(x as i32, y as i32, seed + 5) > 1.0 - c[7] { 0.4 + hash(x as i32, y as i32, seed + 6) * 0.4 } else { 0.0 };
                let crack = if c[8] != 0.0 && v > edge { let (a,b) = cells(u * 12.0, v * 17.0, seed + 7); (1.0 - smooth(0.0, 0.03, b - a)) * c[8] } else { 0.0 };
                let grain = hash(x as i32, y as i32, seed + 8) - 0.5; let cover = glazed * (1.0 - lip);
                for channel in 0..3 {
                    let glaze = c[channel] * (0.975 + cloud * 0.045) * (1.0 - crack * 0.06) * (1.0 - speck * [0.34,0.45,0.6][channel] * glazed);
                    let body = c[channel + 3] * (0.92 + grain * 0.14);
                    texel[channel] = body + (glaze - body) * cover;
                }
                texel[3] = 0.5 + glazed * (cloud * 0.06 - speck * 0.22 - crack * 0.1) + (1.0 - glazed) * grain * 0.35 + bead * 0.14;
                texel[4] = 0.84 + grain * 0.1 + (c[6] + cloud * 0.06 + crack * 0.1 + speck * 0.2 - 0.84 - grain * 0.1) * glazed;
            }
            for channel in 0..3 { pigment[at + channel] = byte(texel[channel]); }
            pigment[at + 3] = 255; data[at] = byte(texel[3]); data[at + 1] = byte(texel[4]); data[at + 2] = 0; data[at + 3] = 255;
        }
    }
    1
}
