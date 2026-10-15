//! The walnut cabinet of the shelf: every plank, upright, board and lip of
//! `createShelfFurniture`, translated into place and merged by material. The host only
//! decides which of the three roles share a material object and builds the meshes.
use crate::jsmath::{jmax, jmin, Mat4, Box3};
use crate::timber::{self, FLOATS, VERTICES};

const BOARD_HEIGHT: f64 = 15.0;
const BACK_REACH: f64 = 3.0;
const FRONT_REACH: f64 = 11.7;

const WOOD: usize = 0;
const BACK: usize = 1;
const TRIM: usize = 2;

fn hash(seed: &str) -> u32 {
    // `for (const character of String(seed))` with `character.charCodeAt(0)`: the first UTF-16
    // unit of every code point.
    let mut value: u32 = 2166136261;
    for character in seed.chars() {
        let mut unit = [0u16; 2];
        let first = character.encode_utf16(&mut unit)[0];
        value = (value ^ u32::from(first)).wrapping_mul(16777619);
    }
    value
}
fn texture_offset(seed: &str) -> [f64; 2] {
    let value = hash(seed);
    [f64::from((value >> 8) % 1009) / 109.0, f64::from((value >> 18) % 1013) / 113.0]
}
/// Every board is cut from a slightly different flitch.
fn board_tone(seed: &str) -> [f64; 3] {
    let value = hash(&format!("{seed}:tone"));
    let light = 0.93 + (f64::from(value & 255) / 255.0) * 0.12;
    let warm = (f64::from((value >> 8) & 255) / 255.0 - 0.5) * 0.06;
    [light * (1.0 + warm), light, light * (1.0 - warm * 1.4)]
}

fn valid(value: f64, fallback: f64) -> f64 { if value.is_finite() && value > 0.0 { value } else { fallback } }

/// Shared cabinet measurements (`cabinetFrame`).
pub struct Frame { pub w: f64, pub h: f64, pub d: f64, pub side: f64, pub inner: f64, pub shelf_width: f64 }
pub fn frame(width: f64, height: f64, depth: f64) -> Frame {
    let w = valid(width, 360.0);
    let h = valid(height, 600.0);
    let d = jmax(1.0, valid(depth, 155.0) - BACK_REACH - FRONT_REACH);
    let side = jmin(12.0, w * 0.12);
    Frame { w, h, d, side, inner: jmax(1.0, w - 24.0), shelf_width: jmax(1.0, w - side * 2.0 + 8.0) }
}

/// `shelfBottoms`: finite, non-negative and not seen before (`Set` equality: `-0` is `0`).
pub fn shelf_bottoms(rows: &[f64]) -> Vec<f64> {
    let mut seen: Vec<f64> = Vec::new();
    for &bottom in rows {
        if !bottom.is_finite() || bottom < 0.0 || seen.contains(&bottom) { continue; }
        seen.push(bottom);
    }
    seen
}

enum Piece { Beam { width: f64, height: f64, depth: f64, bevel: f64, grain: usize, tone: Option<[f64; 3]> }, Lip { width: f64 } }
struct Beam { name: String, role: usize, piece: Piece, at: [f64; 3] }

fn plan(frame: &Frame, bottoms: &[f64]) -> Vec<Beam> {
    let Frame { w, h, d, side, inner, shelf_width } = *frame;
    let mut beams: Vec<Beam> = Vec::new();
    #[allow(clippy::too_many_arguments)]
    fn beam(beams: &mut Vec<Beam>, name: &str, bw: f64, bh: f64, bd: f64, x: f64, y: f64, z: f64, role: usize, grain: usize, bevel: f64, tone: Option<[f64; 3]>) {
        beams.push(Beam { name: name.to_string(), role, piece: Piece::Beam { width: bw, height: bh, depth: bd, bevel, grain, tone }, at: [x, y, z] });
    }
    let plank_count = jmax(2.0, jmin(12.0, (inner / 108.0).ceil())) as usize;
    let plank_width = inner / plank_count as f64;
    beam(&mut beams, "back-backer", inner + 4.0, jmax(1.0, h - 4.0), 1.0, 0.0, -h / 2.0, -d - 2.5, BACK, 1, 0.2, Some([0.2, 0.15, 0.11]));
    for index in 0..plank_count {
        beam(&mut beams, &format!("back-plank-{index}"), jmax(0.2, plank_width - 0.85), jmax(1.0, h - 12.0), 4.0,
            -inner / 2.0 + plank_width * (index as f64 + 0.5), -h / 2.0, -d, BACK, 1, 1.1, None);
    }
    beam(&mut beams, "left-upright", side, h, d + 6.0, -w / 2.0 + side / 2.0, -h / 2.0, -d / 2.0, TRIM, 1, 1.4, None);
    beam(&mut beams, "right-upright", side, h, d + 6.0, w / 2.0 - side / 2.0, -h / 2.0, -d / 2.0, WOOD, 1, 1.4, None);
    beam(&mut beams, "left-front-stile", jmax(1.0, side - 2.0), jmax(1.0, h - 4.0), 5.0, -w / 2.0 + side / 2.0, -h / 2.0, 5.0, WOOD, 1, 1.2, None);
    beam(&mut beams, "right-front-stile", jmax(1.0, side - 2.0), jmax(1.0, h - 4.0), 5.0, w / 2.0 - side / 2.0, -h / 2.0, 5.0, WOOD, 1, 1.2, None);
    beam(&mut beams, "top-cap", w, 12.0, d + 10.0, 0.0, -6.0, -d / 2.0 + 3.0, WOOD, 0, 1.6, None);
    beam(&mut beams, "top-back-rail", inner, 5.0, 7.0, 0.0, -10.0, -d + 4.0, TRIM, 0, 0.55, None);
    for (index, &bottom) in bottoms.iter().enumerate() {
        let name = format!("shelf-{index}");
        beam(&mut beams, &format!("{name}-board"), shelf_width, BOARD_HEIGHT, d + 8.0, 0.0, -bottom - BOARD_HEIGHT / 2.0, -d / 2.0 + 3.0, WOOD, 0, 0.65, None);
        beams.push(Beam { name: format!("{name}-lip"), role: WOOD, piece: Piece::Lip { width: shelf_width }, at: [0.0, -bottom, 0.0] });
        beam(&mut beams, &format!("{name}-back-rail"), inner, 5.0, 8.0, 0.0, -bottom + 2.5, -d + 4.0, TRIM, 0, 0.5, None);
    }
    // A recessed kick plate turns the open space under the last shelf into a plinth.
    let plinth_top = if bottoms.is_empty() { h } else { bottoms.iter().fold(f64::NEG_INFINITY, |m, &b| jmax(m, b)) + BOARD_HEIGHT };
    if h - plinth_top > 3.0 {
        beam(&mut beams, "plinth", inner + 2.0, h - plinth_top, 6.0, 0.0, -(plinth_top + h) / 2.0, -2.0, TRIM, 0, 0.8, None);
    }
    beams
}

/// `BufferGeometry#translate`: positions through `Vector3#applyMatrix4`, normals through the
/// normal matrix (the identity here) and `normalize`; everything stored back as f32.
fn translate(out: &mut [f32], vertices: usize, at: [f64; 3]) {
    let mut matrix = Mat4::identity();
    matrix.set_position(at);
    for vertex in 0..vertices {
        let p = [f64::from(out[vertex * 3]), f64::from(out[vertex * 3 + 1]), f64::from(out[vertex * 3 + 2])];
        let q = matrix.apply(p);
        for axis in 0..3 { out[vertex * 3 + axis] = q[axis] as f32; }
        let n = vertices * 3 + vertex * 3;
        let (x, y, z) = (f64::from(out[n]), f64::from(out[n + 1]), f64::from(out[n + 2]));
        // Matrix3#applyMatrix3 with the identity normal matrix, then `normalize`.
        let m = [1.0 * x + 0.0 * y + 0.0 * z, 0.0 * x + 1.0 * y + 0.0 * z, 0.0 * x + 0.0 * y + 1.0 * z];
        let normal = crate::jsmath::normalize(m);
        for axis in 0..3 { out[n + axis] = normal[axis] as f32; }
    }
}

fn bounds(out: &[f32], vertices: usize) -> Box3 {
    let mut b = Box3::empty();
    for vertex in 0..vertices {
        b.expand_by_point([f64::from(out[vertex * 3]), f64::from(out[vertex * 3 + 1]), f64::from(out[vertex * 3 + 2])]);
    }
    b
}

/// Parameters: width, height, depth, material id of wood/back/trim (equal ids are one material),
/// then the shelf bottoms as given. Output: per group (a material, in order of first use) the
/// merged positions, normals, UVs and colours; `table` receives the beam count, the group count,
/// the names' byte length, per group (vertices, name code: 0 back, 1 trim, 2 wood, material id) and
/// per beam its bounds (min xyz, max xyz); `names` the beam names joined by newlines.
///
/// # Safety
/// The host owns every buffer: `out` holds `FLOATS * (21 + 3 * rows)` f32, `table` `12 + 6 * (21 + 3 * rows)`
/// f64 and `names` `names_capacity` bytes.
#[no_mangle]
pub unsafe extern "C" fn cabinet_build(params: *const f64, rows: usize, out: *mut f32, table: *mut f64, names: *mut u8, names_capacity: usize) -> usize {
    if rows > 100_000 { return 0; }
    let p = std::slice::from_raw_parts(params, 6 + rows);
    let frame = frame(p[0], p[1], p[2]);
    let ids = [p[3], p[4], p[5]];
    let bottoms = shelf_bottoms(&p[6..]);
    let beams = plan(&frame, &bottoms);
    let count = beams.len();
    // Groups: one per distinct material id, in order of first use.
    let mut group_ids: Vec<f64> = Vec::new();
    let mut group_of: Vec<usize> = Vec::with_capacity(count);
    for beam in &beams {
        let id = ids[beam.role];
        let group = group_ids.iter().position(|&g| g == id).unwrap_or_else(|| { group_ids.push(id); group_ids.len() - 1 });
        group_of.push(group);
    }
    let mut vertices_of = vec![0usize; group_ids.len()];
    for &group in &group_of { vertices_of[group] += VERTICES; }
    let total = count * VERTICES;
    let out = std::slice::from_raw_parts_mut(out, total * 11);
    let table = std::slice::from_raw_parts_mut(table, 12 + 6 * count);
    // Group g starts after the earlier groups: positions | normals | UVs | colours.
    let mut base = vec![0usize; group_ids.len()];
    for g in 1..group_ids.len() { base[g] = base[g - 1] + vertices_of[g - 1] * 11; }
    let mut filled = vec![0usize; group_ids.len()];
    let mut text = String::new();
    let mut scratch = vec![0f32; FLOATS];
    for (index, beam) in beams.iter().enumerate() {
        match &beam.piece {
            Piece::Beam { width, height, depth, bevel, grain, tone } => {
                let tone = tone.unwrap_or_else(|| board_tone(&beam.name));
                timber::chamfered(*width, *height, *depth, *bevel, *grain, texture_offset(&beam.name), tone, &mut scratch);
            }
            Piece::Lip { width } => timber::lip(*width, texture_offset(&beam.name), board_tone(&beam.name), &mut scratch),
        }
        translate(&mut scratch, VERTICES, beam.at);
        let b = bounds(&scratch, VERTICES);
        table[12 + index * 6..12 + index * 6 + 3].copy_from_slice(&b.min);
        table[12 + index * 6 + 3..12 + index * 6 + 6].copy_from_slice(&b.max);
        let group = group_of[index];
        let vertices = vertices_of[group];
        let start = base[group];
        let at = filled[group];
        filled[group] += VERTICES;
        // Copy each attribute block of the beam to its place in the group's merged blocks.
        let blocks = [(0usize, 3usize), (VERTICES * 3, 3), (VERTICES * 6, 2), (VERTICES * 8, 3)];
        let mut offset = start;
        for (from, size) in blocks {
            let to = offset + at * size;
            out[to..to + VERTICES * size].copy_from_slice(&scratch[from..from + VERTICES * size]);
            offset += vertices * size;
        }
        if index > 0 { text.push('\n'); }
        text.push_str(&beam.name);
    }
    if text.len() > names_capacity { return 0; }
    std::ptr::copy_nonoverlapping(text.as_ptr(), names, text.len());
    table[0] = count as f64;
    table[1] = group_ids.len() as f64;
    table[2] = text.len() as f64;
    for (g, id) in group_ids.iter().enumerate() {
        table[3 + g * 3] = vertices_of[g] as f64;
        table[4 + g * 3] = if *id == ids[BACK] { 0.0 } else if *id == ids[TRIM] { 1.0 } else { 2.0 };
        table[5 + g * 3] = *id;
    }
    count
}
