//! The existing bookcloth, paper tooth and ribbon mask. All raster outputs
//! retain their original byte format. The host supplies eight browser sine
//! coefficients; no per-pixel callback or imported platform function is used.

fn lattice(i: u32, j: u32, salt: u32) -> f64 {
    let mut h = i.wrapping_mul(374761393).wrapping_add(j.wrapping_mul(668265263))
        .wrapping_add(salt.wrapping_mul(1442695041)).wrapping_mul(1274126177);
    h = (h ^ (h >> 13)).wrapping_mul(1103515245);
    (h ^ (h >> 16)) as f64 / 4294967296.0
}
fn lerp(a: f64, b: f64, t: f64) -> f64 { (1.0 - t) * a + t * b }
fn octave(x: usize, y: usize, cell: usize, salt: u32) -> f64 {
    let n = 128 / cell;
    let gx = x as f64 / cell as f64; let gy = y as f64 / cell as f64;
    let i = x / cell; let j = y / cell;
    let dx = gx - i as f64; let dy = gy - j as f64;
    let sx = dx * dx * (3.0 - 2.0 * dx); let sy = dy * dy * (3.0 - 2.0 * dy);
    let v = |a, b| lattice(((i + a) % n) as u32, ((j + b) % n) as u32, salt);
    lerp(lerp(v(0, 0), v(1, 0), sx), lerp(v(0, 1), v(1, 1), sx), sy)
}

/// The host owns aligned space for 8 f64, 16384 f32 and 65536 u8.
/// Kind 0 = cloth, 1 = paper. No retained allocation or JS-owned view.
#[no_mangle]
pub unsafe extern "C" fn book_surface_pixels(kind: u32, coefficients: *const f64,
    field: *mut f32, output: *mut u8) -> u32 {
    if kind > 1 { return 0; }
    let sine = std::slice::from_raw_parts(coefficients, 8);
    let heights = std::slice::from_raw_parts_mut(field, 128 * 128);
    let pixels = std::slice::from_raw_parts_mut(output, 128 * 128 * 4);
    for y in 0..128 { for x in 0..128 {
        heights[y * 128 + x] = if kind == 0 {
            let i = x >> 3; let j = y >> 3;
            let warp = sine[x % 8] * (0.7 + 0.6 * lattice(i as u32, (y >> 5) as u32, 1));
            let weft = sine[y % 8] * (0.7 + 0.6 * lattice(j as u32, (x >> 5) as u32, 2));
            if (i + j) % 2 != 0 { warp * 0.85 + weft * 0.2 } else { weft * 0.85 + warp * 0.2 }
        } else {
            octave(x, y, 32, 5) * 0.9 + octave(x, y, 8, 6) * 0.45 + lattice(x as u32, y as u32, 7) * 0.08
        } as f32;
    } }
    let strength = if kind == 0 { 1.1 } else { 1.4 };
    for y in 0..128 { for x in 0..128 {
        let nx = (heights[y * 128 + (x + 127) % 128] as f64
            - heights[y * 128 + (x + 1) % 128] as f64) * strength;
        let ny = (heights[((y + 127) % 128) * 128 + x] as f64
            - heights[((y + 1) % 128) * 128 + x] as f64) * strength;
        let length = (nx * nx + ny * ny + 1.0).sqrt();
        let i = (y * 128 + x) * 4;
        pixels[i] = ((nx / length + 1.0) * 127.5) as u8;
        pixels[i + 1] = ((ny / length + 1.0) * 127.5) as u8;
        pixels[i + 2] = ((1.0 / length + 1.0) * 127.5) as u8;
        pixels[i + 3] = 255;
    } }
    1
}

#[no_mangle]
pub unsafe extern "C" fn book_ribbon_notch(width: usize, height: usize, output: *mut u8) -> u32 {
    if width == 0 || height == 0 || width > 512 || height > 512 { return 0; }
    let pixels = std::slice::from_raw_parts_mut(output, width * height * 4);
    for y in 0..height { for x in 0..width {
        let across = ((x as f64 + 0.5) / width as f64 * 2.0 - 1.0).abs();
        let value = if (y as f64 + 0.5) / height as f64 > 0.2 * (1.0 - across) { 255 } else { 0 };
        pixels[(y * width + x) * 4..(y * width + x + 1) * 4].fill(value);
    } }
    1
}
