//! The cabinet that stops a shelf lamp's light, as numbers. Boards, sides and front come from the
//! cabinet's parts; the uniforms of one render come from the cabinet's world matrix and the
//! camera. Boxes and matrices follow three@0.180's operation order (see `jsmath`), and the host
//! keeps the shader patch, the scene graph and the part-name classification.
use crate::jsmath::{fixed_value, jmax, Box3, Mat4};

const BOARDS: usize = 8;
const PART: usize = 8;
const FAR: f64 = 1e6;
/// `[count, centre xyz, half xyz, inner, front, solid sides, through, boards x 8]`.
const DESCRIPTION: usize = 19;
/// `[camera inverse x 16, world x 16, centre xyz, half xyz, inner, front, solid, through, boards, boards x 8]`.
const FRAME_INPUT: usize = 51;
/// `[cabinet x 20, boards x 8]` in the layout of the shader uniforms.
const FRAME_OUTPUT: usize = 28;

fn push_unique(list: &mut Vec<f64>, value: f64) {
    // Set semantics: NaN equals NaN, and -0 is stored as +0.
    let value = if value == 0.0 { 0.0 } else { value };
    if !list.iter().any(|known| *known == value || (known.is_nan() && value.is_nan())) { list.push(value); }
}

/// The boards (their mid-planes), sides and front of a cabinet from its parts' bounds. `input`
/// holds `units` matrices (16 values each) followed by `parts` records of
/// `[unit, kind, min xyz, max xyz]`, kind 1 for a solid board, 2 for a mesh shelf, 3 for an
/// upright and anything else for a part that only grows the bounds. Returns the number of boards,
/// 0 when the cabinet has none (and nothing is written to `output`).
///
/// # Safety
/// `input` holds `units * 16 + parts * 8` values and `output` DESCRIPTION values, both live.
#[no_mangle]
pub unsafe extern "C" fn shelf_occluders_describe(units: usize, parts: usize, input: *const f64, output: *mut f64) -> u32 {
    let input = std::slice::from_raw_parts(input, units * 16 + parts * PART);
    let (matrices, records) = input.split_at(units * 16);
    let mut bounds = Box3::empty();
    let (mut heights, mut sides): (Vec<f64>, Vec<f64>) = (Vec::new(), Vec::new());
    let (mut solid, mut mesh) = (false, false);
    for record in records.chunks_exact(PART) {
        let at = record[0] as usize * 16;
        let mut matrix = [0.0; 16];
        matrix.copy_from_slice(&matrices[at..at + 16]);
        let mut part = Box3 { min: [record[2], record[3], record[4]], max: [record[5], record[6], record[7]] };
        part.apply(&Mat4(matrix));
        bounds.union(&part);
        match record[1] as u32 {
            1 | 2 => {
                push_unique(&mut heights, fixed_value((part.min[1] + part.max[1]) / 2.0, 3));
                if record[1] == 1.0 { solid = true; } else { mesh = true; }
            }
            3 => sides.push((part.min[0] + part.max[0]) / 2.0),
            _ => {}
        }
    }
    if heights.is_empty() { return 0; }
    let centre = bounds.center();
    let size = bounds.size();
    let half = [size[0] * 0.5, size[1] * 0.5, size[2] * 0.5];
    // `(a, b) => a - b`, stable. A comparison with NaN counts as equal, as the engine reads it.
    for index in 1..heights.len() {
        let value = heights[index];
        let mut at = index;
        while at > 0 && heights[at - 1] - value > 0.0 { heights[at] = heights[at - 1]; at -= 1; }
        heights[at] = value;
    }
    let inner = if sides.is_empty() { half[0] } else { sides.iter().fold(f64::NEG_INFINITY, |most, x| jmax(most, (x - centre[0]).abs())) };
    let out = std::slice::from_raw_parts_mut(output, DESCRIPTION);
    let count = heights.len().min(BOARDS);
    out[0] = count as f64;
    out[1..4].copy_from_slice(&centre);
    out[4..7].copy_from_slice(&half);
    out[7] = inner;
    out[8] = bounds.max[2] - centre[2];
    out[9] = if sides.is_empty() { 0.0 } else { 1.0 };
    out[10] = if solid && !mesh { 0.0 } else { 0.5 };
    out[11..].fill(0.0);
    for (slot, height) in heights.iter().take(BOARDS).enumerate() { out[11 + slot] = height - centre[1]; }
    count as u32
}

/// The uniform values of one render: the cabinet's three axes, centre and half size in view space,
/// its front and inner width and the boards' heights, all in view units. Called every frame.
///
/// # Safety
/// `input` holds FRAME_INPUT values and `output` FRAME_OUTPUT values, both live.
#[no_mangle]
pub unsafe extern "C" fn shelf_occluders_apply(input: *const f64, output: *mut f64) {
    let input = std::slice::from_raw_parts(input, FRAME_INPUT);
    let out = std::slice::from_raw_parts_mut(output, FRAME_OUTPUT);
    let (mut camera, mut world) = ([0.0; 16], [0.0; 16]);
    camera.copy_from_slice(&input[..16]);
    world.copy_from_slice(&input[16..32]);
    let world = Mat4(world);
    let view = Mat4::multiply(&Mat4(camera), &world);
    let scale = world.scale();
    let unit = (scale[0] + scale[1] + scale[2]) / 3.0;
    for axis in 0..3 {
        let mut direction = [0.0; 3];
        direction[axis] = 1.0;
        out[axis * 4..axis * 4 + 3].copy_from_slice(&view.transform_direction(direction));
    }
    out[3] = 1.0;
    out[7] = input[38] * unit;
    out[11] = input[39] * unit;
    out[12..15].copy_from_slice(&view.apply([input[32], input[33], input[34]]));
    out[15] = input[40];
    out[16] = input[35] * unit;
    out[17] = input[36] * unit;
    out[18] = input[37] * unit;
    out[19] = input[41];
    out[20..].fill(FAR);
    for slot in 0..(input[42] as usize).min(BOARDS) { out[20 + slot] = input[43 + slot] * unit; }
}
