//! The light of the shelf's lamps: how many lights each kind of lamp gets, which lamps are lit and which light each of
//! them takes, and the numbers every light is aimed with. The host keeps the three.js lights, the scene graph (it hands in
//! each model's world matrix); Rust owns persistent change stamps and shadow policy. Arithmetic remains three.js' own
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
fn merge_sort(order: &mut Vec<usize>, buffer: &mut Vec<usize>, before: &dyn Fn(usize, usize) -> bool) {
    let n = order.len();
    buffer.clear(); buffer.extend_from_slice(order);
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
        std::mem::swap(order, buffer);
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
#[derive(Default)]
struct PlanScratch {
    priority: Vec<f64>, order: Vec<usize>, merge: Vec<usize>, ranks: Vec<f64>,
    wanted: Vec<f64>, entry: Vec<Option<usize>>,
}

pub fn plan(candidates: &[f64], slots: &[f64], quota: &[f64], middle: f64, out: &mut [f64]) -> bool {
    plan_with(candidates, slots, quota, middle, out, &mut PlanScratch::default(), None)
}
fn plan_with(candidates: &[f64], slots: &[f64], quota: &[f64], middle: f64, out: &mut [f64], scratch: &mut PlanScratch, key_ranks: Option<&[f64]>) -> bool {
    if candidates.len() % CANDIDATE != 0 || slots.len() % SLOT != 0 { return false; }
    let (n, s) = (candidates.len() / CANDIDATE, slots.len() / SLOT);
    if out.len() < 2 + 2 * n + 3 * s { return false; }
    let field = |i: usize, f: usize| if f == 6 { key_ranks.map_or(candidates[i * CANDIDATE + f], |ranks| ranks[i]) } else { candidates[i * CANDIDATE + f] };
    let slot_field = |k: usize, f: usize| slots[k * SLOT + f];
    let lit_before = |key: f64| (0..s).any(|k| slot_field(k, 2) != 0.0 && slot_field(k, 1) == key);
    let PlanScratch { priority, order, merge, ranks, wanted, entry } = scratch;
    priority.clear(); priority.extend((0..n).map(|i| {
        if field(i, 2) != 0.0 { f64::NEG_INFINITY }
        else { (if lit_before(field(i, 1)) { -1e9 } else { 0.0 }) + or_zero((field(i, 4) - middle).abs()) }
    }));
    // The comparison is `priority(a) - priority(b) || rank(a) - rank(b)`: a difference of exactly zero (or none, as with
    // two infinities) leaves the order to the keys.
    let before = |a: usize, b: usize| {
        let difference = priority[a] - priority[b];
        if difference != 0.0 && !difference.is_nan() { difference < 0.0 } else { field(a, 6) - field(b, 6) < 0.0 }
    };
    order.clear(); order.extend(0..n);
    merge_sort(order, merge, &before);
    // The lit lamps are the powered ones nearest the view (or picked up), as many of each kind as it has slots.
    ranks.resize(quota.len(), 0.0); ranks.fill(0.0);
    wanted.clear();
    for &i in order.iter() {
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
    entry.resize(s, None); entry.fill(None);
    for &i in order.iter() {
        for k in 0..s { if slot_field(k, 1) == field(i, 1) && slot_field(k, 0) == field(i, 0) { entry[k] = Some(i); } }
    }
    let mut failed = -1.0;
    let mut events = 0usize;
    for &i in order.iter() {
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
    light_with_color(spot, input, out, None)
}
fn light_with_color(spot: bool, input: &[f64], out: &mut [f64], color: Option<[f64; 3]>) -> bool {
    if input.len() < LIGHT_IN || out.len() < LIGHT_OUT { return false; }
    let world = mat(&input[0..16]);
    let scale = max_scale(&world);
    let position = world.apply([input[82], input[83], input[84]]);
    out[0..3].copy_from_slice(&position);
    out[3..6].copy_from_slice(&color.unwrap_or_else(|| tinted(input[88], input[89], [input[90], input[91], input[92]])));
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
    filaments_with_color(input, out, None)
}
fn filaments_with_color(input: &[f64], out: &mut [f64], color: Option<[f64; 3]>) -> bool {
    if input.len() < FILAMENT_HEAD { return false; }
    let count = input[16];
    if !(count >= 0.0 && count <= MAX_STRIPS as f64 && count.fract() == 0.0) { return false; }
    let count = count as usize;
    if input.len() < FILAMENT_HEAD + STRIP_IN * count || out.len() < FILAMENT_OUT_HEAD + STRIP_OUT * count { return false; }
    let world = mat(&input[0..16]);
    let rotation = world.decompose().1;
    let scale = max_scale(&world);
    out[0..3].copy_from_slice(&color.unwrap_or_else(|| tinted(input[17], input[18], [input[19], input[20], input[21]])));
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

// The lifetime of the numeric state follows its Three.js fixture. Reassignment
// invalidates stamps; fading only invalidates radiance, never cached depth.
use wasm_bindgen::prelude::*;

fn stamp(previous: &mut [f64], current: &[f64]) -> bool {
    let mut changed = false;
    for (last, &value) in previous.iter_mut().zip(current) {
        if *last != value && (!last.is_nan() || !value.is_nan()) {
            *last = value; changed = true;
        }
    }
    changed
}

// Three.Color#getHex in its existing linear-sRGB working space. Math.pow stays
// in the engine, including its treatment of NaN/infinity and final rounding.
fn light_hex(rgb: &[f64]) -> f64 {
    let channel = |c: f64| {
        let c = if c < 0.0031308 { c * 12.92 } else { 1.055 * Math::pow(c, 0.41666) - 0.055 };
        Math::round(jsmath::clamp(c * 255.0, 0.0, 255.0))
    };
    channel(rgb[0]) * 65536.0 + channel(rgb[1]) * 256.0 + channel(rgb[2])
}

/// Persistent cache for one fixture. A computed frame returns bits: valid=8,
/// visible change=1, carry cached shadow matrix=2, refresh shadow texture=4.
#[wasm_bindgen]
pub struct LampLightState {
    shadow: [f64; 12], radiance: [f64; 5], emitter: [f64; 9], pose: Vec<f64>,
    local: Mat4, root: Mat4, has_transform: bool, stale: bool,
    color_inputs: [f64; 5], color: [f64; 3], hex: f64, color_ready: bool,
}

/// Reusable transport for point/cone fixture frames. The browser packs Three
/// handles directly into native memory; no bindgen input/output slices are
/// allocated or copied on each animation frame. The numerical/state path is
/// the same `LampLightState::light` used by the slice API.
#[wasm_bindgen]
pub struct LampLightFrame {
    input: Box<[f64; LIGHT_IN + 1]>, output: Box<[f64; LIGHT_OUT]>,
}
#[wasm_bindgen]
impl LampLightFrame {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self { Self { input:Box::new([0.0; LIGHT_IN + 1]), output:Box::new([0.0; LIGHT_OUT]) } }
    pub fn memory(&self) -> JsValue { wasm_bindgen::memory() }
    pub fn input_ptr(&self) -> usize { self.input.as_ptr() as usize }
    pub fn output_ptr(&self) -> usize { self.output.as_ptr() as usize }
    pub fn sample(&mut self, state: &mut LampLightState, spot: bool, shadowed: bool,
        lit: bool, was_lit: bool, shadow_dirty: bool) -> u32 {
        state.light(spot,shadowed,lit,was_lit,shadow_dirty,self.input.as_slice(),self.output.as_mut_slice())
    }
}

#[wasm_bindgen]
impl LampLightState {
    #[wasm_bindgen(constructor)]
    pub fn new(strips: usize) -> LampLightState {
        LampLightState { shadow:[0.0; 12], radiance:[0.0; 5], emitter:[0.0; 9],
            pose:vec![0.0; strips.min(MAX_STRIPS) * 11], local:Mat4::identity(), root:Mat4::identity(),
            has_transform:false, stale:false, color_inputs:[0.0; 5], color:[0.0; 3], hex:0.0, color_ready:false }
    }
    pub fn assign(&mut self) {
        self.stale = true; self.has_transform = false;
        self.shadow.fill(f64::NAN); self.radiance.fill(f64::NAN);
        self.emitter.fill(f64::NAN); self.pose.fill(f64::NAN);
    }
    pub fn light(&mut self, spot: bool, shadowed: bool, lit: bool, was_lit: bool,
        shadow_dirty: bool, input: &[f64], out: &mut [f64]) -> u32 {
        if input.len() < LIGHT_IN || out.len() < LIGHT_OUT { return 0; }
        let mut cached = [0.0; LIGHT_IN + 1];
        let count = input.len().min(LIGHT_IN + 1); cached[..count].copy_from_slice(&input[..count]);
        let input = &mut cached;
        let root = input[16] != 0.0;
        input[81] = if root && self.has_transform { 1.0 } else { 0.0 };
        if root {
            input[49..65].copy_from_slice(&self.local.0);
            input[65..81].copy_from_slice(&self.root.0);
        }
        self.color_for([input[88], input[89], input[90], input[91], input[92]]);
        if !light_with_color(spot, input, out, Some(self.color)) { return 0; }
        let mut shadow = [0.0; 12];
        shadow[..3].copy_from_slice(&out[..3]); shadow[3] = out[7];
        if spot { shadow[4..7].copy_from_slice(&out[12..15]); shadow[7..10].copy_from_slice(&out[9..12]); shadow[10] = out[15]; }
        shadow[11] = shadowed as u8 as f64;
        let shadow_changed = stamp(&mut self.shadow, &shadow);
        let light_changed = stamp(&mut self.radiance, &[out[6], self.hex, out[8],
            if spot { out[15] } else { 0.0 }, if spot { out[16] } else { 0.0 }]);
        let mut emitter = [0.0; 9]; emitter[..3].copy_from_slice(&input[82..85]);
        if spot { emitter[3..6].copy_from_slice(&input[85..88]); emitter[7] = out[15]; }
        emitter[6] = input[95]; emitter[8] = shadowed as u8 as f64;
        let emitter_changed = stamp(&mut self.emitter, &emitter) || input.get(102).copied().unwrap_or(0.0) != 0.0;
        let root_moved = root && self.has_transform && out[36] == 0.0;
        let mut flags = 8;
        if shadowed && (shadow_changed || emitter_changed || shadow_dirty || root_moved) {
            if root && self.has_transform && !shadow_dirty && !emitter_changed && out[37] != 0.0 {
                flags |= 2;
            } else { self.stale = true; }
        }
        if shadowed && lit && self.stale { flags |= 4; self.stale = false; }
        self.has_transform = root;
        if root { self.local = mat(&out[20..36]); self.root = mat(&input[33..49]); }
        if (lit || was_lit) && (shadow_changed || light_changed || emitter_changed || shadow_dirty || root_moved) { flags |= 1; }
        flags
    }
    pub fn filaments(&mut self, lit: bool, was_lit: bool, input: &[f64], out: &mut [f64]) -> u32 {
        if input.len() < FILAMENT_HEAD { return 0; }
        let count = input[16] as usize;
        if count * 11 != self.pose.len() { return 0; }
        self.color_for([input[17], input[18], input[19], input[20], input[21]]);
        if !filaments_with_color(input, out, Some(self.color)) { return 0; }
        let mut changed = false;
        let hex = self.hex;
        for index in 0..count {
            let at = FILAMENT_OUT_HEAD + STRIP_OUT * index;
            let mut pose = [0.0; 11]; pose[..10].copy_from_slice(&out[at..at + 10]); pose[10] = hex;
            changed |= stamp(&mut self.pose[index * 11..(index + 1) * 11], &pose);
        }
        8 | if changed && (lit || was_lit) { 1 } else { 0 }
    }
}

impl LampLightState {
    fn color_for(&mut self, inputs: [f64; 5]) {
        if self.color_ready && self.color_inputs.iter().zip(inputs).all(|(&a, b)| a.to_bits() == b.to_bits()) { return; }
        self.color_inputs = inputs; self.color_ready = true;
        self.color = tinted(inputs[0], inputs[1], [inputs[2], inputs[3], inputs[4]]);
        self.hex = light_hex(&self.color);
    }
}

/// Fixed numeric fixture ids on the host boundary: cone=0, point=1,
/// filaments:N=N+1. Counting, lexical kind order, quotas and rank-cache
/// invalidation belong to Rust; only locale collation remains a host primitive.
#[wasm_bindgen]
pub struct LampPoolState {
    kinds: Vec<usize>, quotas: [f64; KINDS], ranked_keys: Vec<f64>, key_ranks: Vec<f64>, scratch: PlanScratch,
}
const KINDS: usize = MAX_STRIPS + 2;
fn kind_name(kind: usize) -> String {
    match kind { 0 => "cone".into(), 1 => "point".into(), _ => format!("filaments:{}", kind - 1) }
}
#[wasm_bindgen]
impl LampPoolState {
    #[wasm_bindgen(constructor)]
    pub fn new() -> LampPoolState { LampPoolState { kinds:Vec::new(), quotas:[0.0; KINDS], ranked_keys:Vec::new(), key_ranks:Vec::new(), scratch:PlanScratch::default() } }
    /// Only structural changes leave Rust: (kind, wanted, existing), in original
    /// lexical order. An unchanged pool allocates/transfers no output payload.
    pub fn reconcile(&mut self, entries: &[f64], slots: &[f64], limit: f64) -> Result<Vec<f64>, JsValue> {
        let mut counts = [0.0; KINDS]; let mut existing = [0.0; KINDS];
        let mut registered = false;
        for &code in entries {
            if code < 0.0 { continue; }
            if !code.is_finite() || code.fract() != 0.0 || code >= KINDS as f64 { return Err(js_sys::RangeError::new("Tipo de luz no válido.").into()); }
            let kind = code as usize; counts[kind] += 1.0;
            if !self.kinds.contains(&kind) { self.kinds.push(kind); registered = true; }
        }
        for &code in slots {
            if !code.is_finite() || code < 0.0 || code.fract() != 0.0 || code >= KINDS as f64 { return Err(js_sys::RangeError::new("Tipo de luz no válido.").into()); }
            existing[code as usize] += 1.0;
        }
        if registered { self.kinds.sort_by_cached_key(|&kind| kind_name(kind)); }
        let mut ordered = [0.0; KINDS]; let mut result = [0.0; KINDS];
        for (i, &kind) in self.kinds.iter().enumerate() { ordered[i] = counts[kind]; }
        quota(&ordered[..self.kinds.len()], limit, &mut result[..self.kinds.len()]);
        self.quotas.fill(0.0);
        let mut changes = Vec::new();
        for (i, &kind) in self.kinds.iter().enumerate() {
            self.quotas[kind] = result[i];
            if result[i] != existing[kind] { changes.extend_from_slice(&[kind as f64, result[i], existing[kind]]); }
        }
        Ok(changes)
    }
    /// `keys` are host identity ids stable for this manager's lifetime. The
    /// comparator is invoked only when membership/order changes, never per frame.
    pub fn plan(&mut self, candidates: &[f64], slots: &[f64],
        middle: f64, out: &mut [f64], rank_keys: &js_sys::Function) -> Result<bool, JsValue> {
        if candidates.len() % CANDIDATE != 0 { return Ok(false); }
        let count = candidates.len() / CANDIDATE;
        let same = self.ranked_keys.len() == count && (0..count).all(|i| self.ranked_keys[i] == candidates[i * CANDIDATE + 1]);
        if !same {
            let ranks = js_sys::Float64Array::new(&rank_keys.call0(&JsValue::UNDEFINED)?);
            if ranks.length() as usize != count { return Ok(false); }
            self.key_ranks.resize(count, 0.0); ranks.copy_to(&mut self.key_ranks);
            self.ranked_keys.clear(); self.ranked_keys.extend((0..count).map(|i| candidates[i * CANDIDATE + 1]));
        }
        Ok(plan_with(candidates, slots, &self.quotas, middle, out, &mut self.scratch, Some(&self.key_ranks)))
    }
}
