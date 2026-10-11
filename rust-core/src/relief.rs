//! Bounded numeric cover-map passes. Inputs and outputs live in the caller's
//! aligned WASM arena; every export does at most the row/pixel range requested.
//! f32 is storage only: arithmetic follows JavaScript's f64 operation order.

use std::slice;

fn clamp(value: f64, low: f64, high: f64) -> f64 {
    if value.is_nan() { value } else { value.max(low).min(high) }
}

/// ECMA ToUint8Clamp, including ties to even (Rust's float-to-u8 cast truncates).
fn clamped_byte(value: f64) -> u8 {
    // f64.nearest rounds ties to even in one WASM instruction. Rust's float
    // cast saturates outside u8's range and maps NaN to zero, completing the
    // same conversion without four floor/fraction branches per RGBA pixel.
    value.round_ties_even() as u8
}

// Math.round followed by Uint8Array conversion, for finite nonnegative map data.
fn rounded_byte(value: f64) -> u8 {
    if !value.is_finite() { return 0; }
    let floor = value.floor();
    let rounded = if value - floor < 0.5 { floor } else { floor + 1.0 };
    (rounded as i64 & 255) as u8
}

fn extent(width: u32, height: u32, from: u32, to: u32, limit: u32) -> Option<usize> {
    let count = width.checked_mul(height)?;
    if width == 0 || height == 0 || count > 1_048_576 || from > to || to > limit {
        None
    } else { Some(count as usize) }
}

#[no_mangle]
pub unsafe extern "C" fn relief_distance_init(mask: *const u8, distance: *mut f32,
    count: u32, from: u32, to: u32) -> u32 {
    if count > 1_048_576 || from > to || to > count { return 0; }
    let mask = slice::from_raw_parts(mask, count as usize);
    let distance = slice::from_raw_parts_mut(distance, count as usize);
    for i in from as usize..to as usize { distance[i] = if mask[i] != 0 { 1e6 } else { 0.0 }; }
    1
}

#[no_mangle]
pub unsafe extern "C" fn relief_distance_rows(distance: *mut f32, width: u32,
    height: u32, from: u32, to: u32, reverse: u32) -> u32 {
    let Some(count) = extent(width, height, from, to, height) else { return 0; };
    let d = slice::from_raw_parts_mut(distance, count);
    let w = width as usize;
    for row in from..to {
        let y = if reverse != 0 { to - 1 - (row - from) } else { row } as usize;
        for column in 0..w {
            let x = if reverse != 0 { w - 1 - column } else { column };
            let at = y * w + x;
            if d[at] == 0.0 { continue; }
            let mut v = d[at] as f64;
            if reverse == 0 {
                if x > 0 { v = v.min(d[at - 1] as f64 + 1.0); }
                if y > 0 {
                    v = v.min(d[at - w] as f64 + 1.0);
                    if x > 0 { v = v.min(d[at - w - 1] as f64 + 1.4142); }
                    if x < w - 1 { v = v.min(d[at - w + 1] as f64 + 1.4142); }
                }
            } else {
                if x < w - 1 { v = v.min(d[at + 1] as f64 + 1.0); }
                if y < height as usize - 1 {
                    v = v.min(d[at + w] as f64 + 1.0);
                    if x < w - 1 { v = v.min(d[at + w + 1] as f64 + 1.4142); }
                    if x > 0 { v = v.min(d[at + w - 1] as f64 + 1.4142); }
                }
            }
            d[at] = v as f32;
        }
    }
    1
}

fn edge(index: i64, size: usize) -> usize { index.max(0).min(size as i64 - 1) as usize }

#[no_mangle]
pub unsafe extern "C" fn relief_blur_pass(input: *const f32, output: *mut f32,
    width: u32, height: u32, radius: u32, from: u32, to: u32, vertical: u32) -> u32 {
    let limit = if vertical != 0 { width } else { height };
    let Some(count) = extent(width, height, from, to, limit) else { return 0; };
    if radius == 0 || radius > 1024 { return 0; }
    let input = slice::from_raw_parts(input, count);
    let output = slice::from_raw_parts_mut(output, count);
    let w = width as usize;
    let h = height as usize;
    let r = radius as i64;
    let size = (radius * 2 + 1) as f64;
    for line in from as usize..to as usize {
        let mut sum = 0.0;
        if vertical == 0 {
            for x in -r..=r { sum += input[line * w + edge(x, w)] as f64; }
            for x in 0..w {
                output[line * w + x] = (sum / size) as f32;
                sum += input[line * w + edge(x as i64 + r + 1, w)] as f64
                    - input[line * w + edge(x as i64 - r, w)] as f64;
            }
        } else {
            for y in -r..=r { sum += input[edge(y, h) * w + line] as f64; }
            for y in 0..h {
                output[y * w + line] = (sum / size) as f32;
                sum += input[edge(y as i64 + r + 1, h) * w + line] as f64
                    - input[edge(y as i64 - r, h) * w + line] as f64;
            }
        }
    }
    1
}

// Scaled compensated sum, matching the browser's overflow-safe Math.hypot.
fn hypot3(x: f64, y: f64, z: f64) -> f64 {
    let values = [x.abs(), y.abs(), z.abs()];
    let maximum = values[0].max(values[1]).max(values[2]);
    if maximum.is_infinite() { return f64::INFINITY; }
    if values.iter().any(|value| value.is_nan()) { return f64::NAN; }
    if maximum == 0.0 { return 0.0; }
    let mut sum = 0.0;
    let mut compensation = 0.0;
    for value in values {
        let scaled = value / maximum;
        let summand = scaled * scaled - compensation;
        let preliminary = sum + summand;
        compensation = (preliminary - sum) - summand;
        sum = preliminary;
    }
    sum.sqrt() * maximum
}

#[no_mangle]
pub unsafe extern "C" fn relief_normal_rows(height_map: *const u8, owners: *const u8,
    mask: *const u8, output: *mut u8, width: u32, height: u32, from: u32, to: u32,
    has_owners: u32, preserve_ink: u32, unit: f64) -> u32 {
    let Some(count) = extent(width, height, from, to, height) else { return 0; };
    let heights = slice::from_raw_parts(height_map, count);
    let owners = if has_owners != 0 { Some(slice::from_raw_parts(owners, count)) } else { None };
    let mask = if preserve_ink != 0 { Some(slice::from_raw_parts(mask, count)) } else { None };
    let out = slice::from_raw_parts_mut(output, count * 4);
    let w = width as usize;
    let h = height as usize;
    for y in from as usize..to as usize {
        for x in 0..w {
            let pixel = y * w + x;
            let at = pixel * 4;
            if mask.is_some_and(|mask| mask[pixel] == 0) {
                out[at..at + 4].copy_from_slice(&[128, 128, 255, 255]);
                continue;
            }
            let sample = |sx: i64, sy: i64| {
                let index = edge(sy, h) * w + edge(sx, w);
                if owners.is_some_and(|owners| owners[index] != owners[pixel]) { 0.0 }
                else { heights[index] as f64 }
            };
            let nx = -(sample(x as i64 + 1, y as i64) - sample(x as i64 - 1, y as i64)) * unit;
            let ny = (sample(x as i64, y as i64 + 1) - sample(x as i64, y as i64 - 1)) * unit;
            let length = hypot3(nx, ny, 1.0);
            out[at] = clamped_byte((nx / length * 0.5 + 0.5) * 255.0);
            out[at + 1] = clamped_byte((ny / length * 0.5 + 0.5) * 255.0);
            out[at + 2] = clamped_byte((1.0 / length * 0.5 + 0.5) * 255.0);
            out[at + 3] = 255;
        }
    }
    1
}

#[no_mangle]
pub unsafe extern "C" fn relief_material_pixels(foil: *const u8, gloss: *const u8,
    owners: *const u8, profiles: *const f64, output: *mut u8, count: u32,
    from: u32, to: u32, profile_count: u32, preserve_ink: u32,
    base: f64, foil_roughness: f64, gloss_roughness: f64, gloss_coat_roughness: f64) -> u32 {
    if count > 1_048_576 || from > to || to > count || profile_count > 10 { return 0; }
    let foil = slice::from_raw_parts(foil, count as usize);
    let gloss = slice::from_raw_parts(gloss, count as usize);
    let owners = if profile_count > 0 { Some(slice::from_raw_parts(owners, count as usize)) } else { None };
    let profiles = slice::from_raw_parts(profiles, profile_count as usize * 2);
    let out = slice::from_raw_parts_mut(output, count as usize * 4);
    for i in from as usize..to as usize {
        let f = if preserve_ink != 0 { 0.0 } else { foil[i] as f64 / 255.0 };
        let g = gloss[i] as f64 / 255.0;
        let owner = owners.map_or(0, |owners| owners[i] as usize);
        let (roughness, coat_roughness) = if owner > 0 && owner <= profile_count as usize {
            (profiles[(owner - 1) * 2], profiles[(owner - 1) * 2 + 1])
        } else { (gloss_roughness, gloss_coat_roughness) };
        out[i * 4] = clamped_byte((base + (1.0 - base) * g) * 255.0);
        out[i * 4 + 1] = clamped_byte((1.0 - (f * (1.0 - foil_roughness)).max(g * (1.0 - roughness))) * 255.0);
        out[i * 4 + 2] = clamped_byte(f * 255.0);
        out[i * 4 + 3] = if preserve_ink != 0 {
            clamped_byte((1.0 - g * (1.0 - coat_roughness)) * 255.0)
        } else { 255 };
    }
    1
}

#[no_mangle]
pub unsafe extern "C" fn relief_compose_pixels(owners: *const u8, base_mask: *const u8,
    base_height: *const f32, strengths: *const f64, output: *mut u8, count: u32,
    from: u32, to: u32, layer_count: u32) -> u32 {
    if count > 1_048_576 || from > to || to > count || layer_count > 10 { return 0; }
    let owners = slice::from_raw_parts(owners, count as usize);
    let masks = slice::from_raw_parts(base_mask, count as usize);
    let heights = slice::from_raw_parts(base_height, count as usize);
    let strengths = slice::from_raw_parts(strengths, layer_count as usize);
    let out = slice::from_raw_parts_mut(output, count as usize * 3);
    let n = count as usize;
    for i in from as usize..to as usize {
        let owner = owners[i] as usize;
        let strength = if owner > 0 && owner <= layer_count as usize { strengths[owner - 1] } else { 0.0 };
        if strength > 0.0 {
            out[i] = masks[i];
            out[n + i] = rounded_byte(clamp(masks[i] as f64 / 255.0 * strength, 0.0, 1.0) * 255.0);
            out[n * 2 + i] = rounded_byte(heights[i] as f64 * strength);
        } else { out[i] = 0; out[n + i] = 0; out[n * 2 + i] = 0; }
    }
    1
}
