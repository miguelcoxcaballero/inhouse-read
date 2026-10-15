//! The first look of a plant surface: its painter sampled on a lattice 8 pixels apart (f32), spread
//! bilinearly over the whole texture. The finished painting follows in idle slices (the row kernels).
use crate::{plant_foliage, plant_glaze, plant_pottery, plant_soil};

#[inline(always)]
pub(crate) fn byte(value: f64) -> u8 {
    let scaled = 255.0 * value.clamp(0.0, 1.0);
    // Every sample was validated finite; interpolation in f64 cannot overflow
    // f32 endpoints. Clamping guarantees [0,255], so this conversion is safe.
    // Compare the fraction instead of adding .5, which can round an adjacent
    // representable value up to a half-integer before the actual rounding.
    let whole = unsafe { scaled.to_int_unchecked::<u32>() };
    (whole + u32::from(scaled - whole as f64 >= 0.5)) as u8
}

const STEP: usize = 8;

/// Expand a lattice of `columns * rows` five-channel samples (colour, relief, roughness) over a
/// `width x height` texture: pigment (RGBA) and material data (relief, roughness, 0, 255).
fn expand(width: usize, height: usize, columns: usize, rows: usize, lattice: &[f32], pigment: &mut [u8], data: &mut [u8]) {
    for y in 0..height {
        let j = (y / STEP).min(rows - 2);
        let fy = ((y - j * STEP) as f64 / 8.0).min(1.0);
        for x in 0..width {
            let i = (x / STEP).min(columns - 2);
            let fx = ((x - i * STEP) as f64 / 8.0).min(1.0);
            let a = (j * columns + i) * 5;
            let b = a + 5; let c = a + columns * 5; let d = c + 5;
            let pixel = (y * width + x) * 4;
            for k in 0..5 {
                let top = lattice[a+k] as f64 + (lattice[b+k] as f64 - lattice[a+k] as f64) * fx;
                let bottom = lattice[c+k] as f64 + (lattice[d+k] as f64 - lattice[c+k] as f64) * fx;
                let value = byte(top + (bottom - top) * fy);
                if k < 3 { pigment[pixel+k] = value; } else { data[pixel+k-3] = value; }
            }
            pigment[pixel+3] = 255; data[pixel+2] = 0; data[pixel+3] = 255;
        }
    }
}

/// Paint the coarse preview of one surface: `family` 0 glazed pottery (config 10 numbers), 1 terracotta
/// or zinc (kind; 4), 2 soil (kind; none), 3 leaves (kind; 5). The lattice samples sit every 8 pixels
/// (the last column wraps to 0 for a surface that repeats around a lathe, else stays on the edge).
///
/// # Safety
/// `config` holds the family's numbers; `output` has width*height*8 bytes (pigment, then data).
#[no_mangle]
pub unsafe extern "C" fn plant_surface_lattice(family: u32, kind: u32, width: usize, height: usize, repeat: u32,
    config: *const f64, output: *mut u8) -> u32 {
    if width == 0 || height == 0 || width > 2048 || height > 2048 || repeat > 1 { return 0; }
    let length = match family { 0 => 10, 1 => 4, 2 => 0, 3 => 5, _ => return 0 };
    let cfg: &[f64] = if length > 0 { std::slice::from_raw_parts(config, length) } else { &[] };
    let ok = match family {
        0 => plant_glaze::valid(cfg),
        1 => kind <= 1 && plant_pottery::valid(cfg),
        2 => kind <= 1,
        _ => kind <= 3 && plant_foliage::valid(cfg),
    };
    if !ok { return 0; }
    let columns = width.div_ceil(STEP) + 1; let rows = height.div_ceil(STEP) + 1;
    let mut lattice = vec![0f32; columns * rows * 5];
    for j in 0..rows {
        let y = (j * STEP).min(height - 1);
        for i in 0..columns {
            let x = if i * STEP >= width { if repeat == 1 { 0 } else { width - 1 } } else { i * STEP };
            let u = (x as f64 + 0.5) / width as f64; let v = (y as f64 + 0.5) / height as f64;
            let (xi, yi) = (x as i32, y as i32);
            let texel = match family {
                0 => plant_glaze::texel(cfg, u, v, xi, yi, plant_glaze::edge(u, cfg[9] as u32)),
                1 => plant_pottery::texel(kind, cfg, u, v, xi, yi, plant_pottery::wheel(kind, u, cfg[3] as u32)),
                2 => plant_soil::paint(kind, u, v, xi, yi),
                _ => { let (midrib, wave) = plant_foliage::column(kind, u); plant_foliage::texel(kind, cfg, u, v, xi, yi, midrib, wave) }
            };
            for k in 0..5 { lattice[(j * columns + i) * 5 + k] = texel[k] as f32; }
        }
    }
    if lattice.iter().any(|v| !v.is_finite()) { return 0; }
    let pixels = width * height;
    let (pigment, data) = std::slice::from_raw_parts_mut(output, pixels * 8).split_at_mut(pixels * 4);
    expand(width, height, columns, rows, &lattice, pigment, data);
    1
}
