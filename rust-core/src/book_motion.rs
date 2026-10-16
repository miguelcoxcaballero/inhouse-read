//! Prepared monotone Hermite motion and its real-time clock. The host retains frame
//! scheduling and GPU ownership. Both kernels are total: any offsets, values and
//! progress (NaN, infinities, duplicate or reversed offsets) go through the same IEEE
//! arithmetic the original JavaScript sampler used, so degenerate keyframes give the
//! same numbers it gave.
use crate::jsnum::{max, min};
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
    if !(2..=1024).contains(&count) { return 0; }
    let source = std::slice::from_raw_parts(prepared, count * PREPARED);
    // Math.max(0, Math.min(1, progress)): -0 becomes +0 and NaN stays NaN.
    let t = max(0.0, min(1.0, progress));
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

/// Start of a motion's clock: `state` is [longest step, elapsed, last frame, started].
/// A stalled frame may absorb at most 100 ms (a fifth of a hinge opening), never half a
/// phase, so the board and ribbon never visibly jump.
/// # Safety
/// `state` points to four writable, 8-byte aligned f64 values.
#[no_mangle]
pub unsafe extern "C" fn book_motion_clock_start(state: *mut f64, duration: f64, now: f64) {
    std::slice::from_raw_parts_mut(state, 4).copy_from_slice(&[max(48.0, min(100.0, duration / 2.0)), 0.0, now, 0.0]);
}

/// One callback of the motion: the time elapsed since the previous callback, capped at
/// the longest step (48 ms for the first, which only covers the frame that scheduled the
/// motion), advances the motion; returns its progress 0..1.
/// # Safety
/// `state` was written by book_motion_clock_start.
#[no_mangle]
pub unsafe extern "C" fn book_motion_clock_step(state: *mut f64, duration: f64, now: f64) -> f64 {
    let s = std::slice::from_raw_parts_mut(state, 4);
    s[1] += min(if s[3] != 0.0 { s[0] } else { 48.0 }, max(0.0, now - s[2]));
    s[2] = now;
    s[3] = 1.0;
    if duration > 0.0 { min(1.0, s[1] / duration) } else { 1.0 }
}
