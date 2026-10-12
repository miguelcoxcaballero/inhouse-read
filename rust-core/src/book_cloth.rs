//! Deterministic cloth paint commands. Canvas compositing stays with the host.
use std::slice;
fn next(state: &mut u32) -> f64 {
    *state = state.wrapping_add(0x6D2B79F5);
    let mut t = (*state ^ (*state >> 15)).wrapping_mul(1 | *state);
    t = t.wrapping_add((t ^ (t >> 7)).wrapping_mul(61 | t)) ^ t;
    (t ^ (t >> 14)) as f64 / 4_294_967_296.0
}
fn rounded(value: f64) -> f64 {
    let floor = value.floor();
    floor + if value - floor >= 0.5 { 1.0 } else { 0.0 }
}
/// Generate dye pixels and ordered rectangle commands from a raw PRNG state.
/// # Safety
/// Field contains field_width*30*4 bytes. Commands contains 6*40+1 doubles
/// for metal, or 6*136+1 for cloth; its final double receives the next state.
#[no_mangle]
pub unsafe extern "C" fn book_cloth_plan(seed: u32, width: f64, metal: u32,
    field_width: u32, field: *mut u8, commands: *mut f64) -> u32 {
    if !width.is_finite() || !(0.0..=8192.0).contains(&width) || metal > 1
        || field_width != rounded(width / 34.0).max(4.0) as u32 { return 0; }
    let count = if metal != 0 { 40 } else { 136 };
    let field = slice::from_raw_parts_mut(field, field_width as usize * 30 * 4);
    let output = slice::from_raw_parts_mut(commands, count * 6 + 1);
    let mut state = seed;
    let spread = if metal != 0 { 5.0 } else { 9.0 };
    for rgba in field.chunks_exact_mut(4) {
        let value = rounded(128.0 + (next(&mut state) - 0.5) * 2.0 * spread) as u8;
        rgba.copy_from_slice(&[value, value, value, 255]);
    }
    let rows = if metal != 0 { 40 } else { 110 };
    for i in 0..rows {
        let y = next(&mut state) * 1024.0;
        let x = next(&mut state) * width * 0.7;
        let length = width * (0.2 + next(&mut state) * 0.6);
        let light = next(&mut state) > 0.45;
        let alpha = if light { 0.012 + next(&mut state) * 0.03 } else { 0.015 + next(&mut state) * 0.035 };
        let height = 0.5 + next(&mut state) * 0.8;
        output[i*6..i*6+6].copy_from_slice(&[x,y,length,height,alpha,if light { 1.0 } else { 0.0 }]);
    }
    if metal == 0 {
        for i in 110..136 {
            let x = next(&mut state) * width;
            let y = next(&mut state) * 900.0;
            let length = 60.0 + next(&mut state) * 380.0;
            let light = next(&mut state) > 0.5;
            let alpha = if light { 0.012 + next(&mut state) * 0.025 } else { 0.015 + next(&mut state) * 0.03 };
            let thickness = 0.5 + next(&mut state) * 0.7;
            output[i*6..i*6+6].copy_from_slice(&[x,y,thickness,length,alpha,if light { 1.0 } else { 0.0 }]);
        }
    }
    output[count*6] = state as f64;
    1
}
