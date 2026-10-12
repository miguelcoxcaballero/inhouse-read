//! Expand the existing f32 botanical pigment/material lattice without
//! changing its samples, resolution, color space, mipmaps or idle painting.
#[inline(always)]
fn byte(value: f64) -> u8 {
    let scaled = 255.0 * value.clamp(0.0, 1.0);
    // Every sample was validated finite; interpolation in f64 cannot overflow
    // f32 endpoints. Clamping guarantees [0,255], so this conversion is safe.
    // Compare the fraction instead of adding .5, which can round an adjacent
    // representable value up to a half-integer before the actual rounding.
    let whole = unsafe { scaled.to_int_unchecked::<u32>() };
    (whole + u32::from(scaled - whole as f64 >= 0.5)) as u8
}

/// # Safety
/// lattice contains columns*rows*5 f32 values; output has width*height*8 u8.
#[no_mangle]
pub unsafe extern "C" fn plant_surface_preview(width: usize, height: usize,
    columns: usize, rows: usize, lattice: *const f32, output: *mut u8) -> u32 {
    if width == 0 || height == 0 || width > 2048 || height > 2048
        || columns != width.div_ceil(8) + 1 || rows != height.div_ceil(8) + 1 { return 0; }
    let lattice = std::slice::from_raw_parts(lattice, columns * rows * 5);
    if lattice.iter().any(|v| !v.is_finite()) { return 0; }
    let pixels = width * height;
    let output = std::slice::from_raw_parts_mut(output, pixels * 8);
    let (pigment, data) = output.split_at_mut(pixels * 4);
    for y in 0..height {
        let j = (y / 8).min(rows - 2);
        let fy = ((y - j * 8) as f64 / 8.0).min(1.0);
        for x in 0..width {
            let i = (x / 8).min(columns - 2);
            let fx = ((x - i * 8) as f64 / 8.0).min(1.0);
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
    1
}
