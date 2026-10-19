//! Geometry contracts for copying and replaying resolved framebuffers. These
//! kernels never resample, round CSS coordinates or change the original pixels.
const FRAME: usize = 16;
const LAYERS: usize = 3;
const PLACEMENT: usize = FRAME * 4;
const OUTPUT: usize = PLACEMENT + 10 * LAYERS;
pub const WORDS: usize = OUTPUT + 8 * LAYERS;

fn integer(value: f64) -> bool { value.is_finite() && value.floor() == value }
fn positive(value: f64) -> bool { value.is_finite() && value > 0.0 }
fn exact(frame: &[f64]) -> bool {
    if !frame[..3].iter().all(|&value| positive(value))
        || !frame[3..5].iter().all(|value| value.is_finite()) { return false; }
    if frame[5] == 1.0 {
        [frame[6], frame[7], frame[9], frame[10]].iter().all(|&value| integer(value) && value > 0.0)
            && frame[6] == (frame[0] * frame[2]).floor()
            && frame[7] == (frame[1] * frame[2]).floor()
            && (!frame[11].is_finite() || frame[6].max(frame[7]) <= frame[11])
    } else {
        frame[5] == 0.0 && [frame[0] * frame[2], frame[1] * frame[2], frame[3] * frame[2], frame[4] * frame[2]]
            .iter().all(|&value| integer(value))
    }
}
fn dimensions(frame: &[f64]) -> (f64, f64) {
    if frame[5] == 1.0 { (frame[6], frame[7]) } else { (frame[0] * frame[2], frame[1] * frame[2]) }
}

/// Mode 0 validates a logical/physical descriptor. Mode 1 also checks source
/// bounds for capture and writes its two physical dimensions. Mode 2 validates
/// up to three retained layers and writes all rectangle/clip uniforms together.
/// # Safety
/// `pointer` must own WORDS aligned f64 slots for the duration of this call.
#[no_mangle]
pub unsafe extern "C" fn native_frame_plan(pointer: *mut f64, mode: u32, count: usize) -> u32 {
    if pointer.is_null() || mode > 2 || count > LAYERS { return 0; }
    let values = std::slice::from_raw_parts_mut(pointer, WORDS);
    if !exact(&values[..FRAME]) { return 0; }
    if mode == 0 { return 1; }
    if mode == 1 {
        let (width, height) = dimensions(values);
        let (x, y) = (values[12], values[13]);
        if !integer(x) || !integer(y) || x < 0.0 || y < 0.0
            || x + width > values[14] || y + height > values[15] { return 0; }
        if values[5] == 1.0 && (values[9] != values[14] || values[10] != values[15]
            || x + width > values[9] || y + height > values[10]) { return 0; }
        values[OUTPUT] = width; values[OUTPUT + 1] = height;
        return 1;
    }
    // Validate all layers before changing output, matching the host's atomic
    // preflight: a bad last layer must not resize or partially draw the room.
    for index in 0..count {
        let frame = &values[FRAME * (index + 1)..FRAME * (index + 2)];
        let placement = &values[PLACEMENT + index * 10..PLACEMENT + (index + 1) * 10];
        if !exact(frame) || !placement[..2].iter().all(|value| value.is_finite())
            || !positive(placement[2])
            || placement[3] != 0.0 && !placement[4..8].iter().all(|value| value.is_finite()) { return 0; }
    }
    for index in 0..count {
        let frame = FRAME * (index + 1); let placement = PLACEMENT + index * 10; let out = OUTPUT + index * 8;
        let (x, y, scale) = (values[placement], values[placement + 1], values[placement + 2]);
        let (width, height) = (values[frame] * scale, values[frame + 1] * scale);
        let clip = if values[placement + 3] != 0.0 {
            [values[placement + 4], values[placement + 5], values[placement + 6], values[placement + 7]]
        } else { [x, y, x + width, y + height] };
        values[out..out + 4].copy_from_slice(&[x, y, width, height]);
        values[out + 4..out + 8].copy_from_slice(&clip);
    }
    1
}
