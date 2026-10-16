//! The light of the shelf's lamps: how many lights each kind of lamp gets, which lamps are lit and which light each of
//! them takes, and the numbers every light is aimed with. The host keeps the three.js lights, the scene graph (it hands in
//! each model's world matrix) and the change stamps; everything decided or computed here is three.js' own arithmetic
//! (f64, its order of operations, the host's `Math.pow`) over the numbers handed in, so the lights come out exactly as
//! `shelf-lamp-lighting.js` used to aim them (the frozen original is `tests/unit/helpers/reference-shelf-lamp-lighting.js`).
//! No function here panics or traps on a wrong-sized buffer: it answers `false` and writes nothing.
use crate::jsmath::{self, jmax, jmin, Mat4, Vec3};
use crate::three_curve::quaternion_multiply;
use crate::three_math::{add_scaled, color, dot};
use js_sys::Math;
use std::f64::consts::PI;

/// A candidate lamp: kind index (-1 when unknown), key id, dragging, raw power, middle of its rectangle, identity id, key rank.
pub const CANDIDATE: usize = 7;
/// A slot: kind index, key id, lit.
pub const SLOT: usize = 3;
/// Lights per fixture the host may ask a filament fixture for.
pub const MAX_STRIPS: usize = 64;
/// A point or cone light's inputs and outputs, and a filament fixture's header and strips.
pub const LIGHT_IN: usize = 102;
pub const LIGHT_OUT: usize = 38;
pub const FILAMENT_HEAD: usize = 24;
pub const STRIP_IN: usize = 10;
pub const FILAMENT_OUT_HEAD: usize = 3;
pub const STRIP_OUT: usize = 10;
/// Most lights any library may own (`MAX_SHELF_LAMP_LIGHTS`).
const MAX_LIGHTS: f64 = 8.0;

fn mat(slice: &[f64]) -> Mat4 {
    let mut elements = [0.0; 16];
    elements.copy_from_slice(&slice[..16]);
    Mat4(elements)
}

/// `x || 0`.
fn or_zero(value: f64) -> f64 { if value == 0.0 || value.is_nan() { 0.0 } else { value } }

/// `Matrix4#getMaxScaleOnAxis`.
fn max_scale(m: &Mat4) -> f64 {
    let e = &m.0;
    let x = e[0] * e[0] + e[1] * e[1] + e[2] * e[2];
    let y = e[4] * e[4] + e[5] * e[5] + e[6] * e[6];
    let z = e[8] * e[8] + e[9] * e[9] + e[10] * e[10];
    jmax(jmax(x, y), z).sqrt()
}

/// Two matrices equal to within a relative 1e-7 of their largest entries (NaN is never equal).
fn same_matrix(a: &Mat4, b: &Mat4) -> bool {
    for index in 0..16 {
        let (value, other) = (a.0[index], b.0[index]);
        if !((value - other).abs() <= 1e-7 * jmax(jmax(1.0, value.abs()), other.abs())) { return false; }
    }
    true
}

/// A room transform that only turns, moves and zooms uniformly (`**` is the host's `Math.pow`).
fn uniform_transform(m: &Mat4) -> bool {
    let e = &m.0;
    let squares = |a: f64, b: f64, c: f64| Math::pow(a, 2.0) + Math::pow(b, 2.0) + Math::pow(c, 2.0);
    let size = squares(e[0], e[1], e[2]);
    let tolerance = jmax(1.0, size) * 1e-7;
    size > 0.0 && size.is_finite() && m.determinant() > 0.0
        && (squares(e[4], e[5], e[6]) - size).abs() <= tolerance
        && (squares(e[8], e[9], e[10]) - size).abs() <= tolerance
        && (e[0] * e[4] + e[1] * e[5] + e[2] * e[6]).abs() <= tolerance
        && (e[0] * e[8] + e[1] * e[9] + e[2] * e[10]).abs() <= tolerance
        && (e[4] * e[8] + e[5] * e[9] + e[6] * e[10]).abs() <= tolerance
}

/// The room's transform: `out[0]` is 1 when lights may follow it (it is a uniform similarity), and `out[1..17]` its inverse.
pub fn root(transform: &[f64], out: &mut [f64]) -> bool {
    if transform.len() < 16 || out.len() < 17 { return false; }
    let matrix = mat(transform);
    if !uniform_transform(&matrix) { out[0] = 0.0; return true; }
    let mut inverse = matrix;
    inverse.invert();
    out[0] = 1.0;
    out[1..17].copy_from_slice(&inverse.0);
    true
}

/// How many lights each kind of lamp gets: `limit` (the library's most) is handed out one to every kind that has lamps, then
/// a second round, and so on, in the order of `counts`.
pub fn quota(counts: &[f64], limit: f64, out: &mut [f64]) -> bool {
    if out.len() < counts.len() { return false; }
    let mut left = jmax(0.0, jmin(MAX_LIGHTS, limit));
    for slot in out.iter_mut().take(counts.len()) { *slot = 0.0; }
    for (kind, &count) in counts.iter().enumerate() {
        if left > 0.0 && count > 0.0 { out[kind] = 1.0; left -= 1.0; }
    }
    let mut grew = true;
    while grew && left > 0.0 {
        grew = false;
        for (kind, &count) in counts.iter().enumerate() {
            if left > 0.0 && out[kind] < count { out[kind] += 1.0; left -= 1.0; grew = true; }
        }
    }
    true
}

/// `emitterPower`: the lamp's power clamped to 0..1, 1 when it is not a finite number.
fn emitter_power(power: f64) -> f64 { if power.is_finite() { jsmath::clamp(power, 0.0, 1.0) } else { 1.0 } }

/// Stable merge sort of `order` by `earlier(a, b)` (true when `a` has to come strictly before `b`); never panics,
/// whatever the comparison does with infinities.
fn merge_sort(order: &mut Vec<usize>, before: &dyn Fn(usize, usize) -> bool) {
    let n = order.len();
    let mut buffer = order.clone();
    let mut width = 1;
    while width < n {
        let mut start = 0;
        while start < n {
            let (middle, end) = ((start + width).min(n), (start + 2 * width).min(n));
            let (mut left, mut right, mut at) = (start, middle, start);
            while left < middle && right < end {
                // The right one goes first only when it is strictly earlier: equals keep their order.
                if before(order[right], order[left]) { buffer[at] = order[right]; right += 1; } else { buffer[at] = order[left]; left += 1; }
                at += 1;
            }
            while left < middle { buffer[at] = order[left]; left += 1; at += 1; }
            while right < end { buffer[at] = order[right]; right += 1; at += 1; }
            start += 2 * width;
        }
        std::mem::swap(order, &mut buffer);
        width *= 2;
    }
}

/// Which lamps are lit and which slot (light) each takes.
///
/// `candidates`: `CANDIDATE` numbers each (the lamps that may be lit, in the library's order); `slots`: `SLOT` numbers each;
/// `quota`: the lights per kind; `middle`: the middle of the viewport. `out`: `[failed, events, (slot, candidate) * events,
/// (candidate, lit, power) * slots]` with `2 + 2 * candidates + 3 * slots` numbers. `failed` is the candidate that had to be
/// lit but found no slot of its kind (-1 for none); the events before it are still given.
///
/// A lamp being dragged comes first, then the lamps that were already lit (a scroll never moves a light to another lamp),
/// then the ones nearest the middle of the viewport, a stable key rank resolving equal scores. The powered lamps of each
/// kind take its lights in that order; a lamp keeps the slot it holds, else takes a free one, else one whose lamp is not
/// wanted.
pub fn plan(candidates: &[f64], slots: &[f64], quota: &[f64], middle: f64, out: &mut [f64]) -> bool {
    if candidates.len() % CANDIDATE != 0 || slots.len() % SLOT != 0 { return false; }
    let (n, s) = (candidates.len() / CANDIDATE, slots.len() / SLOT);
    if out.len() < 2 + 2 * n + 3 * s { return false; }
    let field = |i: usize, f: usize| candidates[i * CANDIDATE + f];
    let slot_field = |k: usize, f: usize| slots[k * SLOT + f];
    let lit_before = |key: f64| (0..s).any(|k| slot_field(k, 2) != 0.0 && slot_field(k, 1) == key);
    let priority: Vec<f64> = (0..n).map(|i| {
        if field(i, 2) != 0.0 { f64::NEG_INFINITY }
        else { (if lit_before(field(i, 1)) { -1e9 } else { 0.0 }) + or_zero((field(i, 4) - middle).abs()) }
    }).collect();
    // The comparison is `priority(a) - priority(b) || rank(a) - rank(b)`: a difference of exactly zero (or none, as with
    // two infinities) leaves the order to the keys.
    let before = |a: usize, b: usize| {
        let difference = priority[a] - priority[b];
        if difference != 0.0 && !difference.is_nan() { difference < 0.0 } else { field(a, 6) - field(b, 6) < 0.0 }
    };
    let mut order: Vec<usize> = (0..n).collect();
    merge_sort(&mut order, &before);
    // The lit lamps are the powered ones nearest the view (or picked up), as many of each kind as it has slots.
    let mut ranks = vec![0.0f64; quota.len()];
    let mut wanted: Vec<f64> = Vec::new();
    for &i in &order {
        if emitter_power(field(i, 3)) <= 0.0 { continue; }
        let kind = field(i, 0);
        if !(kind >= 0.0 && (kind as usize) < quota.len()) { continue; }
        let kind = kind as usize;
        let rank = ranks[kind];
        ranks[kind] = rank + 1.0;
        if rank < quota[kind] { wanted.push(field(i, 1)); }
    }
    let wants = |key: f64| wanted.contains(&key);
    // A slot keeps the lamp it already lights.
    let mut entry: Vec<Option<usize>> = vec![None; s];
    for &i in &order {
        for k in 0..s { if slot_field(k, 1) == field(i, 1) && slot_field(k, 0) == field(i, 0) { entry[k] = Some(i); } }
    }
    let mut failed = -1.0;
    let mut events = 0usize;
    for &i in &order {
        if !wants(field(i, 1)) || entry.iter().flatten().any(|&held| field(held, 5) == field(i, 5)) { continue; }
        let mut target: Option<usize> = None;
        for k in 0..s {
            if slot_field(k, 0) != field(i, 0) { continue; }
            match entry[k] {
                None => { target = Some(k); break; }
                Some(held) => if target.is_none() && !wants(field(held, 1)) { target = Some(k); }
            }
        }
        match target {
            None => { failed = i as f64; break; }
            Some(k) => { entry[k] = Some(i); out[2 + 2 * events] = k as f64; out[3 + 2 * events] = i as f64; events += 1; }
        }
    }
    out[0] = failed;
    out[1] = events as f64;
    let base = 2 + 2 * n;
    for k in 0..s {
        let (mut index, mut lit, mut power) = (-1.0, 0.0, 0.0);
        if let Some(i) = entry[k] {
            index = i as f64;
            if wants(field(i, 1)) { lit = 1.0; power = emitter_power(field(i, 3)); }
        }
        out[base + 3 * k] = index; out[base + 3 * k + 1] = lit; out[base + 3 * k + 2] = power;
    }
    true
}

/// The colour of a light: the lamp's sRGB number in the linear working space times its tint.
fn tinted(hex: f64, has_tint: f64, tint: [f64; 3]) -> [f64; 3] {
    let mut rgb = color(hex as i32 as u32);
    if has_tint != 0.0 { rgb[0] *= tint[0]; rgb[1] *= tint[1]; rgb[2] *= tint[2]; }
    rgb
}

/// The aim of a point light, or of a cone (`spot`).
///
/// Inputs (`LIGHT_IN`): 0..16 the model's world matrix; 16 whether the lights follow the room; 17..33 the room's inverse;
/// 33..49 the room; 49..65 and 65..81 the local and room matrices this slot remembers; 81 whether it remembers any;
/// 82..85 the emitter's position; 85..88 its direction; 88 its colour as a signed 32-bit number; 89 whether it has a tint;
/// 90..93 the tint; 93 its intensity; 94 the slot's power; 95 the emitter's distance; 96 the entry's width; 97 the
/// emitter's decay; 98 whether it has an angle, 99 the angle; 100 whether it has a penumbra, 101 the penumbra.
///
/// Outputs (`LIGHT_OUT`): 0..3 position; 3..6 colour; 6 intensity; 7 distance; 8 decay; then, for a cone, 9..12 the shadow
/// camera's up; 12..15 the target; 15 angle; 16 penumbra; 17 near; 18 far; 19 normal bias; 20..36 the local matrix (when the
/// lights follow the room); 36 whether the room is where the slot remembers it; 37 whether the local matrix is.
pub fn light(spot: bool, input: &[f64], out: &mut [f64]) -> bool {
    if input.len() < LIGHT_IN || out.len() < LIGHT_OUT { return false; }
    let world = mat(&input[0..16]);
    let scale = max_scale(&world);
    let position = world.apply([input[82], input[83], input[84]]);
    out[0..3].copy_from_slice(&position);
    out[3..6].copy_from_slice(&tinted(input[88], input[89], [input[90], input[91], input[92]]));
    out[6] = jmax(0.0, or_zero(input[93])) * input[94] * scale * scale;
    let distance_base = if input[95] == 0.0 || input[95].is_nan() { input[96] * 6.0 } else { input[95] };
    out[7] = jmax(0.01, distance_base) * scale;
    out[8] = if input[97] == 0.0 || input[97].is_nan() { 2.0 } else { input[97] };
    for value in out[9..20].iter_mut() { *value = 0.0; }
    if spot {
        let direction = jsmath::normalize([input[85], input[86], input[87]]);
        // A ceiling cone points down its local Y axis: an orthogonal model-space up follows the whole room.
        let z_up = direction[2].abs() < 0.9;
        let up = world.transform_direction(if z_up { [0.0, 0.0, 1.0] } else { [1.0, 0.0, 0.0] });
        let aimed = world.transform_direction(direction);
        let target = add_scaled(position, aimed, out[7]);
        out[9..12].copy_from_slice(&up);
        out[12..15].copy_from_slice(&target);
        out[15] = jmin(PI / 2.0, jmax(0.01, if input[98] != 0.0 { input[99] } else { PI * 0.38 }));
        out[16] = if input[100] != 0.0 { input[101] } else { 0.65 };
        out[17] = jmax(0.01, 0.5 * scale);
        out[18] = out[7];
        out[19] = 0.15 * scale;
    }
    for value in out[20..38].iter_mut() { *value = 0.0; }
    if input[16] != 0.0 {
        let local = Mat4::multiply(&mat(&input[17..33]), &world);
        out[20..36].copy_from_slice(&local.0);
        if input[81] != 0.0 {
            out[36] = if same_matrix(&mat(&input[33..49]), &mat(&input[65..81])) { 1.0 } else { 0.0 };
            out[37] = if same_matrix(&local, &mat(&input[49..65])) { 1.0 } else { 0.0 };
        }
    }
    true
}

/// The aim of the strips of a filament fixture (area lights that stand along its LED fibres).
///
/// Inputs: 0..16 the model's world matrix; 16 the number of strips; 17 the colour as a signed 32-bit number; 18 whether it
/// has a tint; 19..22 the tint; 22 the emitter's intensity; 23 the slot's power; then `STRIP_IN` numbers a strip from
/// `FILAMENT_HEAD`: start (3), end (3), outward normal (3) and width.
///
/// Outputs: 0..3 the colour; then `STRIP_OUT` numbers a strip from `FILAMENT_OUT_HEAD`: position (3), quaternion (x, y, z,
/// w), width, height and intensity.
pub fn filaments(input: &[f64], out: &mut [f64]) -> bool {
    if input.len() < FILAMENT_HEAD { return false; }
    let count = input[16];
    if !(count >= 0.0 && count <= MAX_STRIPS as f64 && count.fract() == 0.0) { return false; }
    let count = count as usize;
    if input.len() < FILAMENT_HEAD + STRIP_IN * count || out.len() < FILAMENT_OUT_HEAD + STRIP_OUT * count { return false; }
    let world = mat(&input[0..16]);
    let rotation = world.decompose().1;
    let scale = max_scale(&world);
    out[0..3].copy_from_slice(&tinted(input[17], input[18], [input[19], input[20], input[21]]));
    for strip in 0..count {
        let at = FILAMENT_HEAD + STRIP_IN * strip;
        let vector = |from: usize| -> Vec3 { [input[at + from], input[at + from + 1], input[at + from + 2]] };
        let (start, end, width) = (vector(0), vector(3), input[at + 9]);
        let along = jsmath::sub(end, start);
        let length = jsmath::length(along);
        let y = jsmath::normalize(along);
        let mut normal = jsmath::normalize(vector(6));
        normal = jsmath::normalize(add_scaled(normal, y, -dot(normal, y)));
        // A RectAreaLight emits towards local -Z: orient each strip along its fibre and out through the glass.
        let z = [-normal[0], -normal[1], -normal[2]];
        let x = jsmath::normalize(jsmath::cross(y, z));
        let basis = Mat4([x[0], x[1], x[2], 0.0, y[0], y[1], y[2], 0.0, z[0], z[1], z[2], 0.0, 0.0, 0.0, 0.0, 1.0]);
        let turned = quaternion_multiply(rotation, basis.quaternion());
        let middle = world.apply([(start[0] + end[0]) * 0.5, (start[1] + end[1]) * 0.5, (start[2] + end[2]) * 0.5]);
        let to = FILAMENT_OUT_HEAD + STRIP_OUT * strip;
        out[to..to + 3].copy_from_slice(&middle);
        out[to + 3..to + 7].copy_from_slice(&turned);
        out[to + 7] = width * scale;
        out[to + 8] = length * scale;
        // Four outward Lambertian strips keep the old bulb's total luminous flux.
        out[to + 9] = jmax(0.0, or_zero(input[22])) * input[23] * 4.0 / (count as f64 * width * length);
    }
    true
}
