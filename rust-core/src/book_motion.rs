//! Prepared monotone Hermite motion. The host retains frame scheduling and GPU ownership.
const KEYS: usize = 9;
const INPUT: usize = 10;
const PREPARED: usize = 19;

/// # Safety
/// Read count*10 f64 [offset, 9 pose components]; write count*19 f64
/// [offset, 9 values, 9 tangents]. Disjoint, aligned buffers are required.
#[no_mangle]
pub unsafe extern "C" fn book_motion_prepare(input: *const f64, count: usize, output: *mut f64) -> u32 {
    if !(2..=1024).contains(&count) { return 0; }
    let source = std::slice::from_raw_parts(input, count * INPUT);
    if source.iter().any(|v| !v.is_finite()) || source.chunks_exact(INPUT)
        .zip(source.chunks_exact(INPUT).skip(1)).any(|(a,b)| b[0] <= a[0]) { return 0; }
    let result = std::slice::from_raw_parts_mut(output, count * PREPARED);
    for i in 0..count {
        let target = &mut result[i * PREPARED..(i + 1) * PREPARED];
        target[..INPUT].copy_from_slice(&source[i * INPUT..(i + 1) * INPUT]);
        for key in 0..KEYS {
            target[INPUT + key] = if i == 0 || i == count - 1 { 0.0 } else {
                let dt0 = source[i * INPUT] - source[(i - 1) * INPUT];
                let dt1 = source[(i + 1) * INPUT] - source[i * INPUT];
                let value = |j| source[j * INPUT + 1 + key];
                let a = (value(i) - value(i - 1)) / dt0;
                let b = (value(i + 1) - value(i)) / dt1;
                if a * b <= 0.0 { 0.0 } else {
                    let w0 = 2.0 * dt1 + dt0;
                    let w1 = dt1 + 2.0 * dt0;
                    (w0 + w1) / (w0 / a + w1 / b)
                }
            };
        }
    }
    1
}

/// # Safety
/// `prepared` is count*19 f64 produced by book_motion_prepare; output is 9 f64.
#[no_mangle]
pub unsafe extern "C" fn book_motion_sample(prepared: *const f64, count: usize, progress: f64, output: *mut f64) -> u32 {
    if !(2..=1024).contains(&count) || !progress.is_finite() { return 0; }
    let source = std::slice::from_raw_parts(prepared, count * PREPARED);
    // JS Math.max(0, Math.min(1, -0)) produces positive zero.
    let t = if progress <= 0.0 { 0.0 } else if progress >= 1.0 { 1.0 } else { progress };
    let mut index = 0;
    while index < count - 2 && t > source[(index + 1) * PREPARED] { index += 1; }
    let a = &source[index * PREPARED..(index + 1) * PREPARED];
    let b = &source[(index + 1) * PREPARED..(index + 2) * PREPARED];
    let span = b[0] - a[0];
    let k = (t - a[0]) / span;
    let k2 = k * k;
    let k3 = k2 * k;
    let output = std::slice::from_raw_parts_mut(output, KEYS);
    for key in 0..KEYS {
        output[key] = (2.0 * k3 - 3.0 * k2 + 1.0) * a[1 + key]
            + (k3 - 2.0 * k2 + k) * span * a[INPUT + key]
            + (-2.0 * k3 + 3.0 * k2) * b[1 + key]
            + (k3 - k2) * span * b[INPUT + key];
    }
    1
}
