//! Complete cactus mesh. Browser coefficients retain its exact trig rounding.
use crate::plant_leaf::indexed_normals;

fn smooth(a: f64, b: f64, value: f64) -> f64 {
    let t = ((value - a) / (b - a)).clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

/// # Safety
/// Columns: 33 triples (cos, sin, cos8); samples: 627 PRNG values.
/// Outputs: position/normal/color 1881 f32 each, UV 1254 f32, indices 3456 u16.
#[no_mangle]
pub unsafe extern "C" fn plant_cactus_mesh(length: f64, radius: f64, bend: f64,
    columns: *const f64, samples: *const f64, positions: *mut f32, normals: *mut f32,
    colors: *mut f32, uv: *mut f32, indices: *mut u16) -> u32 {
    if !length.is_finite() || !radius.is_finite() || !bend.is_finite()
        || length <= 0.0 || radius <= 0.0 || length > 1e6 || radius > 1e6 || bend.abs() > 1e6 { return 0; }
    let columns = std::slice::from_raw_parts(columns, 99);
    let samples = std::slice::from_raw_parts(samples, 627);
    if columns.iter().any(|v| !v.is_finite() || v.abs() > 1.0)
        || samples.iter().any(|v| !v.is_finite() || *v < 0.0 || *v >= 1.0) { return 0; }
    let positions = std::slice::from_raw_parts_mut(positions, 1881);
    let normals = std::slice::from_raw_parts_mut(normals, 1881);
    let colors = std::slice::from_raw_parts_mut(colors, 1881);
    let uv = std::slice::from_raw_parts_mut(uv, 1254);
    let indices = std::slice::from_raw_parts_mut(indices, 3456);
    let mut index = 0;
    for row in 0..=18 {
        let f = row as f64 / 18.0;
        let end = if f > 0.85 { (f - 0.85) / 0.15 } else { 0.0 };
        let cap = if f < 0.15 { 1.0 } else { (1.0 - end * end).max(0.0).sqrt() };
        let cork = smooth(0.12, 0.0, f) * 0.35;
        let fresh = smooth(0.75, 1.0, f) * 0.06;
        for col in 0..=32 {
            let at = row * 33 + col;
            let co = columns[col * 3]; let si = columns[col * 3 + 1]; let ridge = columns[col * 3 + 2];
            let r = radius * cap * (0.87 + 0.13 * ridge);
            positions[at * 3] = (co * r + bend * f * f) as f32;
            positions[at * 3 + 1] = (length * f) as f32;
            positions[at * 3 + 2] = (si * r) as f32;
            let green = 0.30 + 0.07 * ridge + samples[at] * 0.025;
            colors[at * 3] = (green * (0.68 + cork * 0.5) + fresh * 0.4) as f32;
            colors[at * 3 + 1] = (green * (1.0 - cork * 0.25) + fresh) as f32;
            colors[at * 3 + 2] = (green * (0.60 - cork * 0.1) + fresh * 0.2) as f32;
            uv[at * 2] = (col as f64 / 32.0) as f32; uv[at * 2 + 1] = f as f32;
            if row < 18 && col < 32 {
                let a = at as u16; let b = a + 1; let c = a + 33; let d = c + 1;
                indices[index..index + 6].copy_from_slice(&[a,d,b,a,c,d]); index += 6;
            }
        }
    }
    indexed_normals(positions, normals, indices);
    3456
}
