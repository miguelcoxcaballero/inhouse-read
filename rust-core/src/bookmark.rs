//! The ribbon: its centreline and cross-sections from a book's size and the reader's position
//! (`bookmark_plan_a`, `bookmark_plan_b`), and the mesh built on them. Position and normal
//! arithmetic follows the original JavaScript and Three's operation and f32 write order; the
//! sines, cosines and powers are the host's own (see host_math.rs): the plan asks for them in
//! two stages (the centreline's angles, then the twist's sine and cosine).
use crate::host_math::{put, skip, COS, POW, SIN};
use crate::jsmath::clamp;
use crate::jsnum::{max, min, round};
use std::f64::consts::PI;

fn lerp(a: f64, b: f64, t: f64) -> f64 { (1.0 - t) * a + t * b }
/// `THREE.MathUtils.smoothstep`.
fn smoothstep(x: f64, low: f64, high: f64) -> f64 {
    if x <= low { return 0.0; }
    if x >= high { return 1.0; }
    let x = (x - low) / (high - low);
    x * x * (3.0 - 2.0 * x)
}
/// `x | 0`: ToInt32, for any double.
fn int32(x: f64) -> i32 {
    if !x.is_finite() { return 0; }
    let wrapped = x.trunc() % 4294967296.0;
    ((wrapped + 4294967296.0) % 4294967296.0) as u32 as i32
}
/// The integer lattice of the cloth and the ribbon's variation, on doubles as the original had it.
fn lattice(i: f64, j: f64, salt: f64) -> f64 {
    let mut h = int32(i * 374761393.0 + j * 668265263.0 + salt * 1442695041.0).wrapping_mul(1274126177);
    h = (h ^ ((h as u32) >> 13) as i32).wrapping_mul(1103515245);
    ((h ^ ((h as u32) >> 16) as i32) as u32) as f64 / 4294967296.0
}

/// Sections of the strip: `Math.max(4, Math.round((Number(segments) || 32) / 2) * 2)`; 0 when the
/// plan does not take that many.
#[no_mangle]
pub extern "C" fn bookmark_steps(segments: f64) -> u32 {
    let wanted = if segments.is_nan() || segments == 0.0 { 32.0 } else { segments };
    let steps = max(4.0, round(wanted / 2.0) * 2.0);
    if steps > 256.0 { 0 } else { steps as u32 }
}

/// Everything the plan derives from the book and the pose before it looks at one section.
struct Ribbon {
    refined: bool, steps: usize, ribbon_width: f64, fabric_depth: f64, lay: f64, flop: f64, x: f64, head: f64, depth: f64, height: f64,
    upper: f64, back: f64, drift: f64, arc: f64, reach_back: f64, twist_max: f64, leaves: f64, body_length: f64,
    wander: f64, splay: f64, start: f64, cut: f64, split: f64, half: f64, fold: f64, folded: f64, vary5: f64,
}
impl Ribbon {
    /// `p`: width, height, thickness, progress, peek, open, withdraw, segments, seed.
    fn new(p: &[f64], refined: bool) -> Option<Ribbon> {
        let (width, height, thickness, progress, peek, open, withdraw, seed) = (p[0], p[1], p[2], p[3], p[4], p[5], p[6], p[8]);
        let steps = bookmark_steps(p[7]) as usize;
        if steps == 0 { return None; }
        let ribbon_width = min(width * 0.09, max(height * 0.035, min(height * 0.055, thickness * 0.42))) * if refined { 1.4 } else { 1.0 };
        // Each copy of a book falls the same way; different books do not.
        let seeded = seed != 0.0 && !seed.is_nan();
        let vary = |k: f64| if seeded { lattice(seed % 65521.0, k, 17.0) } else { 0.5 };
        let peek = if peek.is_nan() || peek == 0.0 { 10.0 } else { peek };
        let visible_length = height * max(0.09, min(0.17, peek / 200.0 * 1.6)) * (1.0 + if seeded { 0.12 * vary(1.0) } else { 0.0 });
        let opening = max(0.0, min(1.0, open));
        // Always between two leaves, never on a board.
        let leaves = max(0.0, thickness / 2.0 - height * 0.0125);
        let inside_depth = clamp(thickness / 2.0 - thickness * max(0.0, min(1.0, progress)), -leaves, leaves);
        let page_depth = thickness / 2.0 - height * 0.0083 + height * 0.002;
        let depth = lerp(inside_depth, page_depth, smoothstep(opening, 0.0, 0.3));
        let lay = smoothstep(opening, 0.05, 0.55);
        let flop = smoothstep(opening, 0.15, 0.85);
        let x = lerp(-width / 2.0 + max(thickness * 0.75, ribbon_width * 1.5),
            -width / 2.0 + height * 0.012 + ribbon_width * 0.5 + width * 0.006, lay);
        let lift = height * 1.25 * max(0.0, min(1.0, withdraw));
        let page_top = height / 2.0 - height * 0.009;
        let bend = height * 0.016;
        let head = lerp(height / 2.0 - height * 0.012, page_top - bend * 0.3, lay);
        let tail = lerp(height / 2.0 - height * 0.64, -height / 2.0 + height * 0.03, lay);
        let upper = visible_length + height * 0.012;
        let back = visible_length * (0.1 + 0.16 * vary(2.0));
        let drift = visible_length * (vary(3.0) - 0.5) * 0.36;
        let arc = bend * PI / 2.0;
        let reach_back = page_depth - bend - (-thickness / 2.0 + height * 0.0084);
        let twist_max = PI / 2.0 * (0.74 + 0.08 * vary(4.0));
        let body_length = head - tail;
        let wander = ribbon_width * (0.12 + 0.1 * vary(6.0));
        let splay = ribbon_width * 0.3 * vary(7.0);
        let start = lift - body_length;
        let cut = upper + lift;
        let split = min(cut, max(start, 0.0));
        let half = steps as f64 / 2.0;
        let fold = max(1.0, round(steps as f64 * 0.19));
        let folded = min(cut, split + arc * 1.1);
        Some(Ribbon { refined, steps, ribbon_width, fabric_depth: height * 0.0018, lay, flop, x, head, depth, height, upper, back, drift, arc,
            reach_back, twist_max, leaves, body_length, wander, splay, start, cut, split, half, fold, folded, vary5: vary(5.0) })
    }
    /// Keep the entire inserted strip in one leaf plane. Only silk already
    /// beyond the book's head may turn toward the viewer.
    fn turn(&self, s:f64)->f64 {
        if self.refined { smoothstep(s,self.height*0.012,self.height*0.07) }
        else { smoothstep(s,-self.height*0.006,self.height*0.0025) }
    }
    /// The arc length past the head of section `i`, negative inside the book or on the page. Samples
    /// are laid on the path, not on the sliding silk: half on the page, the rest from the head on, a
    /// fixed share of them crowded over the turn and the fold. `crowd[j - 1]` is `(j / fold) ** 1.4`.
    fn along(&self, i: usize, crowd: &[f64]) -> f64 {
        let i = i as f64;
        if i <= self.half { lerp(self.start, self.split, i / self.half) }
        else if i - self.half <= self.fold { self.split + (self.folded - self.split) * crowd[(i - self.half) as usize - 1] }
        else { lerp(self.folded, self.cut, (i - self.half - self.fold) / (self.half - self.fold)) }
    }
}

/// The powers that depend on the section count alone, asked once per count: `(j / fold) ** 1.4`
/// for j = 1..=fold. Writes the requests, returns how many (0 when `steps` is not a section count).
/// # Safety
/// `requests` has room for 3 f64 per request, at most 66 of them.
#[no_mangle]
pub unsafe extern "C" fn bookmark_constants(steps: usize, requests: *mut f64) -> u32 {
    if !(4..=256).contains(&steps) { return 0; }
    let fold = max(1.0, round(steps as f64 * 0.19)) as usize;
    let out = std::slice::from_raw_parts_mut(requests, fold * 3);
    for j in 1..=fold { put(out, j - 1, POW, j as f64 / fold as f64, 1.4); }
    fold as u32
}

/// First stage of a ribbon: the arguments of the sines, cosines and powers each section needs
/// (slot 0: the sine of the greatest twist; per section, 7 slots: the twist's turn, the page's
/// wander, roll and wave, the sag's power, the fold's sine and cosine). Returns how many requests
/// were written (0 for a count of sections the plan does not take).
/// # Safety
/// `params` holds 9 f64, `crowd` the powers of `bookmark_constants`, `requests` 3 f64 per request.
#[no_mangle]
pub unsafe extern "C" fn bookmark_plan_a(params: *const f64, crowd: *const f64, requests: *mut f64) -> u32 { bookmark_plan_a_policy(params,crowd,requests,false) }
#[no_mangle]
pub unsafe extern "C" fn bookmark_plan_a_refined(params: *const f64, crowd: *const f64, requests: *mut f64) -> u32 { bookmark_plan_a_policy(params,crowd,requests,true) }

unsafe fn bookmark_plan_a_policy(params: *const f64, crowd: *const f64, requests: *mut f64, refined:bool) -> u32 {
    let Some(r) = Ribbon::new(std::slice::from_raw_parts(params, 9), refined) else { return 0 };
    let crowd = std::slice::from_raw_parts(crowd, r.fold as usize);
    let count = 1 + 7 * (r.steps + 1);
    let out = std::slice::from_raw_parts_mut(requests, count * 3);
    put(out, 0, SIN, r.twist_max, 0.0);
    for i in 0..=r.steps {
        let s = r.along(i, crowd);
        let base = 1 + 7 * i;
        let turned = r.twist_max * r.turn(s);
        put(out, base, SIN, turned, 0.0);
        if s <= 0.0 {
            let u = -s / r.body_length;
            put(out, base + 1, SIN, PI * 1.3 * u, 0.0);
            put(out, base + 2, COS, u * PI * 4.0, 0.0);
            put(out, base + 3, SIN, u * PI * 2.6 + r.vary5 * 6.0, 0.0);
            put(out, base + 4, POW, 1.0 - u, 3.0);
            skip(out, base + 5); skip(out, base + 6);
        } else {
            let angle = r.flop * PI / 2.0 / r.arc * min(s, r.arc);
            for slot in 1..5 { skip(out, base + slot); }
            put(out, base + 5, SIN, angle, 0.0);
            put(out, base + 6, COS, angle, 0.0);
        }
    }
    count as u32
}

/// Second stage: with the first stage's results, the centreline of every section (x, y, z, its
/// twist, 0, the sideways tuck and whether it lies on the page: 7 f64 per section in
/// `coefficients`) and the arguments of the twist's cosine and sine (2 requests per section).
/// # Safety
/// As `bookmark_plan_a`; `results` holds one f64 per request of the first stage.
#[no_mangle]
pub unsafe extern "C" fn bookmark_plan_b(params: *const f64, crowd: *const f64, results: *const f64,
    coefficients: *mut f64, requests: *mut f64) -> u32 { bookmark_plan_b_policy(params,crowd,results,coefficients,requests,false) }
#[no_mangle]
pub unsafe extern "C" fn bookmark_plan_b_refined(params: *const f64, crowd: *const f64, results: *const f64,
    coefficients: *mut f64, requests: *mut f64) -> u32 { bookmark_plan_b_policy(params,crowd,results,coefficients,requests,true) }

unsafe fn bookmark_plan_b_policy(params: *const f64, crowd: *const f64, results: *const f64,
    coefficients: *mut f64, requests: *mut f64, refined:bool) -> u32 {
    let Some(r) = Ribbon::new(std::slice::from_raw_parts(params, 9), refined) else { return 0 };
    let crowd = std::slice::from_raw_parts(crowd, r.fold as usize);
    let results = std::slice::from_raw_parts(results, 1 + 7 * (r.steps + 1));
    let data = std::slice::from_raw_parts_mut(coefficients, (r.steps + 1) * 7);
    let out = std::slice::from_raw_parts_mut(requests, (r.steps + 1) * 2 * 3);
    // Turning about its middle would push the edge through a board at the very first or last
    // leaf: the ribbon moves inward by exactly what it gains.
    let sine_max = results[0];
    let reach = sine_max * r.ribbon_width / 2.0;
    let inward = if r.refined { 0.0 } else { (clamp(r.depth, -r.leaves + reach, r.leaves - reach) - r.depth) * (1.0 - r.lay) };
    for i in 0..=r.steps {
        let s = r.along(i, crowd);
        let base = 1 + 7 * i;
        let (mut px, mut py, mut pz) = (r.x, r.head, r.depth);
        let turned = r.twist_max * r.turn(s);
        // A sideways shift, kept out of the direction the cross-sections face.
        let tuck = inward * results[base] / if sine_max != 0.0 && !sine_max.is_nan() { sine_max } else { 1.0 };
        let mut twist = turned * (1.0 - r.lay);
        if s <= 0.0 {
            // On an open page it runs the full leaf and never lies ruler-straight.
            let u = -s / r.body_length;
            px += r.lay * (r.wander * results[base + 1] + r.splay * u * u);
            py += s;
            pz += r.lay * r.height * 0.0012 * (1.0 - results[base + 2]) / 2.0;
            // Satin never lies dead flat: a slow roll turns the sheen on and off.
            twist += r.lay * 0.22 * results[base + 3] * (1.0 - results[base + 4]);
        } else {
            let k = r.flop * PI / 2.0 / r.arc;
            let bent = min(s, r.arc);
            // Past the gathering's depth the rest is tucked under, out of sight.
            let run = min(s - bent, r.reach_back + (1.0 - r.flop) * r.height * 4.0);
            // A cantilever's sag: nothing at the root, most of it toward the end.
            let fraction = if r.refined { (s-r.height*0.012)/max(0.001,r.upper-r.height*0.012) } else { s/r.upper };
            let fall = smoothstep(min(1.0, fraction), 0.0, 1.0) * (1.0 - r.flop);
            px += r.back * fall;
            py += (if k > 1e-6 { results[base + 5] / k } else { bent }) + run * results[base + 6];
            pz += (if k > 1e-6 { (results[base + 6] - 1.0) / k } else { 0.0 }) - run * results[base + 5] + r.drift * fall;
        }
        data[i * 7..i * 7 + 7].copy_from_slice(&[px, py, pz, twist, 0.0, tuck, if s <= 0.0 { 1.0 } else { 0.0 }]);
        put(out, i * 2, COS, twist, 0.0);
        put(out, i * 2 + 1, SIN, twist, 0.0);
    }
    (r.steps as u32 + 1) * 2
}

/// Last stage: the twist's cosine and sine complete the centreline, and the mesh is built on it.
/// # Safety
/// As `bookmark_mesh`; `results` holds 2 f64 per section.
#[no_mangle]
pub unsafe extern "C" fn bookmark_finish(params: *const f64, results: *const f64, coefficients: *mut f64, distances: *mut f64,
    positions: *mut f32, uvs: *mut f32, normals: *mut f32, indices: *const u16) { bookmark_finish_policy(params,results,coefficients,distances,positions,uvs,normals,indices,false) }
#[no_mangle]
pub unsafe extern "C" fn bookmark_finish_refined(params: *const f64, results: *const f64, coefficients: *mut f64, distances: *mut f64,
    positions: *mut f32, uvs: *mut f32, normals: *mut f32, indices: *const u16) { bookmark_finish_policy(params,results,coefficients,distances,positions,uvs,normals,indices,true) }

unsafe fn bookmark_finish_policy(params: *const f64, results: *const f64, coefficients: *mut f64, distances: *mut f64,
    positions: *mut f32, uvs: *mut f32, normals: *mut f32, indices: *const u16, refined:bool) {
    let Some(r) = Ribbon::new(std::slice::from_raw_parts(params, 9), refined) else { return };
    let results = std::slice::from_raw_parts(results, (r.steps + 1) * 2);
    let data = std::slice::from_raw_parts_mut(coefficients, (r.steps + 1) * 7);
    for i in 0..=r.steps { data[i * 7 + 3] = results[i * 2]; data[i * 7 + 4] = results[i * 2 + 1]; }
    bookmark_mesh(coefficients, distances, r.steps, r.ribbon_width, r.fabric_depth, r.lay, positions, uvs, normals, indices);
}


fn normalized(v: [f64; 3]) -> [f64; 3] {
    let length = (v[0] * v[0] + v[1] * v[1] + v[2] * v[2]).sqrt();
    let inverse = 1.0 / if length == 0.0 { 1.0 } else { length };
    [v[0] * inverse, v[1] * inverse, v[2] * inverse]
}
fn cross(a: [f64; 3], b: [f64; 3]) -> [f64; 3] {
    [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}

/// # Safety
/// `indices` has room for steps * 24 + 12 u16 entries. Steps is bounded by
/// the host, so four vertices per section fit the original u16 index buffer.
#[no_mangle]
pub unsafe extern "C" fn bookmark_topology(indices: *mut u16, steps: usize) {
    let output = std::slice::from_raw_parts_mut(indices, steps * 24 + 12);
    for i in 0..steps {
        let k = (i * 4) as u16;
        let n = k + 4;
        output[i * 24..i * 24 + 24].copy_from_slice(&[
            k, k + 1, n, k + 1, n + 1, n,
            k + 2, n + 2, k + 3, k + 3, n + 2, n + 3,
            k, n, k + 2, k + 2, n, n + 2,
            k + 1, k + 3, n + 1, k + 3, n + 3, n + 1,
        ]);
    }
    let end = (steps * 4) as u16;
    output[steps * 24..].copy_from_slice(&[0, 2, 1, 1, 2, 3, end, end + 1, end + 2, end + 1, end + 3, end + 2]);
}

/// # Safety
/// Host arenas contain (steps+1)*7 f64 centreline coefficients (xyz, cos,
/// sin, tuck, on-page), steps+1 f64 distances, 12/8/12 f32 output components
/// per section, and a topology produced by bookmark_topology for these steps.
#[no_mangle]
pub unsafe extern "C" fn bookmark_mesh(
    coefficients: *const f64, distances: *mut f64, steps: usize,
    ribbon_width: f64, fabric_depth: f64, lay: f64,
    positions: *mut f32, uvs: *mut f32, normals: *mut f32, indices: *const u16,
) {
    let count = steps + 1;
    let coefficients = std::slice::from_raw_parts(coefficients, count * 7);
    let distances = std::slice::from_raw_parts_mut(distances, count);
    let positions = std::slice::from_raw_parts_mut(positions, count * 12);
    let uvs = std::slice::from_raw_parts_mut(uvs, count * 8);
    let normals = std::slice::from_raw_parts_mut(normals, count * 12);
    let indices = std::slice::from_raw_parts(indices, steps * 24 + 12);
    distances[steps] = 0.0;
    for i in (1..=steps).rev() {
        let at = i * 7;
        let previous = at - 7;
        let dx = coefficients[at] - coefficients[previous];
        let dy = coefficients[at + 1] - coefficients[previous + 1];
        let dz = coefficients[at + 2] - coefficients[previous + 2];
        distances[i - 1] = distances[i] + (dx * dx + dy * dy + dz * dz).sqrt();
    }
    for i in 0..count {
        let at = i * 7;
        let previous = i.saturating_sub(1) * 7;
        let next = (i + 1).min(steps) * 7;
        let mut tangent = [
            coefficients[next] - coefficients[previous],
            coefficients[next + 1] - coefficients[previous + 1],
            coefficients[next + 2] - coefficients[previous + 2],
        ];
        if tangent[0] * tangent[0] + tangent[1] * tangent[1] + tangent[2] * tangent[2] < 1e-12 {
            tangent = [0.0, 0.0, -1.0];
        } else { tangent = normalized(tangent); }
        let across = normalized([
            1.0 + tangent[0] * -tangent[0],
            0.0 + tangent[1] * -tangent[0],
            0.0 + tangent[2] * -tangent[0],
        ]);
        let face = cross(across, tangent);
        let cosine = coefficients[at + 3];
        let sine = coefficients[at + 4];
        let mut side = [0.0; 3];
        let mut normal = [0.0; 3];
        for channel in 0..3 {
            side[channel] = (across[channel] * cosine + face[channel] * sine) * (ribbon_width / 2.0);
            normal[channel] = (across[channel] * -sine + face[channel] * cosine) * (fabric_depth / 2.0);
        }
        let x = coefficients[at];
        let y = coefficients[at + 1];
        let z = coefficients[at + 2] + coefficients[at + 5]
            + if coefficients[at + 6] != 0.0 { lay * side[2].abs() } else { 0.0 };
        let vertices = [
            x - side[0] + normal[0], y - side[1] + normal[1], z - side[2] + normal[2],
            x + side[0] + normal[0], y + side[1] + normal[1], z + side[2] + normal[2],
            x - side[0] - normal[0], y - side[1] - normal[1], z - side[2] - normal[2],
            x + side[0] - normal[0], y + side[1] - normal[1], z + side[2] - normal[2],
        ];
        for channel in 0..12 { positions[i * 12 + channel] = vertices[channel] as f32; }
        let v = (distances[i] / ribbon_width) as f32;
        uvs[i * 8..i * 8 + 8].copy_from_slice(&[0.0, v, 1.0, v, 0.0, v, 1.0, v]);
    }
    // Match BufferGeometry.computeVertexNormals: read f32 positions, form
    // each face in f64, and round each accumulated vertex after every face.
    normals.fill(0.0);
    for triangle in indices.chunks_exact(3) {
        let a = triangle[0] as usize * 3;
        let b = triangle[1] as usize * 3;
        let c = triangle[2] as usize * 3;
        let cb = [f64::from(positions[c]) - f64::from(positions[b]), f64::from(positions[c + 1]) - f64::from(positions[b + 1]), f64::from(positions[c + 2]) - f64::from(positions[b + 2])];
        let ab = [f64::from(positions[a]) - f64::from(positions[b]), f64::from(positions[a + 1]) - f64::from(positions[b + 1]), f64::from(positions[a + 2]) - f64::from(positions[b + 2])];
        let face = cross(cb, ab);
        for vertex in [a, b, c] {
            for channel in 0..3 { normals[vertex + channel] = (f64::from(normals[vertex + channel]) + face[channel]) as f32; }
        }
    }
    for vertex in normals.chunks_exact_mut(3) {
        let normal = normalized([f64::from(vertex[0]), f64::from(vertex[1]), f64::from(vertex[2])]);
        for channel in 0..3 { vertex[channel] = normal[channel] as f32; }
    }
}
