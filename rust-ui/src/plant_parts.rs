//! The surfaces a shelf plant is made of: leaf blades of every variety, ivy and Monstera leaves, cactus columns,
//! the pot (a lathe with its wall rows and tones), the saucer, the steel seam, the potting soil with its pebbles
//! and the stems swept along Catmull-Rom curves. Each is `shelf-plants.js` as it built them, line by line: the same
//! f64 arithmetic in the same order, the host's `Math` for the transcendentals, Float32 where three stores one.
use crate::jsmath::{self, jmax, jmin, Mat4, Vec3};
use crate::three_curve::{quaternion_from_euler, tube, CatmullRom};
use crate::three_geo::{self, f32s, js_sign, Geo};
use crate::three_math::{color, color_lerp};
use crate::three_shape::{self, Path};
use js_sys::Math;
use std::collections::HashMap;
use std::f64::consts::PI;

/// The PRNG of a plant (`randomFor(seed)`): the seed's code points hashed by their first UTF-16 unit, then a
/// 32-bit generator.
pub struct Rng { state: u32, script: Option<(Vec<f64>, usize)> }
impl Rng {
    /// A generator that gives the listed numbers in turn (the tests' fixed samples), then NaN.
    pub fn scripted(values: &[f64]) -> Rng { Rng { state: 0, script: Some((values.to_vec(), 0)) } }
    pub fn new(units: &[u16]) -> Rng {
        let mut state: u32 = 2166136261;
        let mut i = 0;
        while i < units.len() {
            let unit = units[i];
            // a surrogate pair is one code point, of which `charCodeAt(0)` is the high unit
            i += if (0xd800..0xdc00).contains(&unit) && i + 1 < units.len() && (0xdc00..0xe000).contains(&units[i + 1]) { 2 } else { 1 };
            state = (state ^ u32::from(unit)).wrapping_mul(16777619);
        }
        Rng { state, script: None }
    }
    pub fn next(&mut self) -> f64 {
        if let Some((values, at)) = &mut self.script { let value = values.get(*at).copied().unwrap_or(f64::NAN); *at += 1; return value; }
        self.state = self.state.wrapping_add(0x6d2b79f5);
        let s = self.state;
        let mut value = (s ^ (s >> 15)).wrapping_mul(s | 1);
        value ^= value.wrapping_add((value ^ (value >> 7)).wrapping_mul(value | 61));
        f64::from(value ^ (value >> 14)) / 4294967296.0
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Variant { Cactus, Monstera, Upright, Succulent, Palm, Fern, Ivy, Zz, Leafy }
impl Variant {
    pub fn parse(name: &str) -> Variant {
        match name {
            "cactus" => Variant::Cactus, "monstera" => Variant::Monstera, "upright" => Variant::Upright, "succulent" => Variant::Succulent,
            "palm" => Variant::Palm, "fern" => Variant::Fern, "ivy" => Variant::Ivy, "zz" => Variant::Zz, _ => Variant::Leafy,
        }
    }
}

pub fn clamp01(value: f64) -> f64 { jmin(1.0, jmax(0.0, value)) }
pub fn smoothstep(a: f64, b: f64, value: f64) -> f64 { let t = clamp01((value - a) / (b - a)); t * t * (3.0 - 2.0 * t) }

const SNAKE_STRIPS: f64 = 4.0;
const SNAKE_INSET: f64 = 0.04;
pub const FOOT: f64 = 0.07;
pub const RIM: f64 = 0.6;
pub const SOIL: f64 = 0.74;

/// Position of a point on a blade: its outline, lobes, channel and curl (`bladePoint`).
pub fn blade_point(f: f64, u: f64, length: f64, width: f64, variant: Variant, curve: f64, twist: f64) -> Vec3 {
    let pow = Math::pow;
    let profile = if variant == Variant::Upright {
        pow(jmax(0.0, 1.0 - f * f), 0.68) * (0.72 + 0.28 * Math::sin(f * PI))
    } else if variant == Variant::Succulent {
        // Echeveria leaves are spatulate: narrow at the base, broad high up, then a short point.
        if f < 0.74 { 0.42 + 0.58 * Math::sin(f / 0.74 * PI / 2.0) } else { pow(Math::cos((f - 0.74) / 0.26 * PI / 2.0), 0.55) }
    } else {
        pow(jmax(0.0, Math::sin(PI * pow(f, if variant == Variant::Leafy || variant == Variant::Ivy { 0.56 } else { 0.75 }))), if variant == Variant::Zz { 0.45 } else { 0.65 })
    };
    let lobes = if variant == Variant::Monstera { 1.0 - 0.54 * pow(Math::sin(f * PI * 5.0), 8.0) }
        else if variant == Variant::Ivy { 0.53 + 0.47 * pow(Math::cos(f * PI * 3.3 - 0.2), 2.0) }
        else if variant == Variant::Fern { 0.92 + 0.08 * Math::cos(f * PI * 14.0) } else { 1.0 };
    let asymmetry = 1.0 + 0.055 * Math::sin(f * 7.0 + twist * 4.0) * js_sign(u);
    let x = width * 0.5 * profile * lobes * u * asymmetry;
    let bow = Math::sin(f * PI * 0.85) * length * curve;
    // Sansevieria swords are channelled: a stiff U that flattens toward the tip.
    let ridge = if variant == Variant::Upright { width * 0.15 * (1.0 - f * 0.6) * u * u }
        else { width * (if variant == Variant::Succulent { 0.075 } else { 0.065 }) * pow(u.abs(), if variant == Variant::Succulent { 2.0 } else { 1.5 }) };
    let edge_curl = if variant == Variant::Succulent || variant == Variant::Upright { 0.0 }
        else { width * 0.022 * pow(u.abs(), 3.0) * Math::sin(f * 19.0 + twist * 9.0) * Math::sin(f * PI) };
    let z = bow + ridge + edge_curl;
    let angle = twist * f;
    [x * Math::cos(angle) + z * Math::sin(angle), f * length, z * Math::cos(angle) - x * Math::sin(angle)]
}

/// A built geometry with the order of its attributes and what the host records about it.
pub struct Built { pub geo: Geo, pub kind: &'static str, pub order: &'static [&'static str], pub groups: Vec<[usize; 3]>, pub fenestrations: bool }
pub const POS_NORMAL_COLOR_UV: &[&str] = &["position", "normal", "color", "uv"];
pub const POS_COLOR_UV_NORMAL: &[&str] = &["position", "color", "uv", "normal"];
pub const POS_UV_NORMAL_COLOR: &[&str] = &["position", "uv", "normal", "color"];
pub const POS_NORMAL_UV_COLOR: &[&str] = &["position", "normal", "uv", "color"];
pub const POS_UV_COLOR_NORMAL: &[&str] = &["position", "uv", "color", "normal"];
pub const POS_NORMAL_UV: &[&str] = &["position", "normal", "uv"];
pub const POS_ONLY: &[&str] = &["position"];

fn built(geo: Geo, kind: &'static str, order: &'static [&'static str]) -> Built { Built { geo, kind, order, groups: Vec::new(), fenestrations: false } }

/// `leafGeometry`: a blade as a grid of rows and columns, one or two faces and the edge walls between them.
#[allow(clippy::too_many_arguments)]
pub fn leaf_geometry(length: f64, width: f64, variant: Variant, curve: f64, twist: f64, rng: &mut Rng, detailed: bool) -> Built {
    let rows: usize = match variant { Variant::Palm => 4, Variant::Fern => 3, Variant::Zz => 6, Variant::Succulent if detailed => 10, Variant::Ivy => 8,
        Variant::Upright => 16, Variant::Monstera => 14, _ => 12 };
    let columns: usize = match variant { Variant::Palm | Variant::Fern => 2, Variant::Monstera => 10,
        Variant::Leafy | Variant::Upright => 6, Variant::Succulent if detailed => 6, _ => 4 };
    // Small palm and fern leaflets are single sheets: a lit double-sided sheet reads identically.
    let thick = variant == Variant::Succulent || (detailed && variant != Variant::Palm && variant != Variant::Fern);
    let thickness = if thick { width * (if variant == Variant::Succulent { if detailed { 0.15 } else { 0.07 } } else { 0.008 }) } else { 0.0 };
    let (mut positions, mut colors, mut uv, mut indices): (Vec<f64>, Vec<f64>, Vec<f64>, Vec<u32>) = (vec![], vec![], vec![], vec![]);
    let inset = 0.012;
    // Each leaf has its own age: new growth is lighter and yellower, older leaves darker and bluer.
    let tint = rng.next() * 0.08;
    let hue = (rng.next() - 0.5) * 0.1;
    let strip = jmin(SNAKE_STRIPS - 1.0, (tint / 0.08 * SNAKE_STRIPS).floor());
    for side in 0..=usize::from(thick) {
        let side_f = side as f64;
        for row in 0..=rows {
            for col in 0..=columns {
                let f = row as f64 / rows as f64;
                let u = col as f64 / columns as f64 * 2.0 - 1.0;
                let point = blade_point(f, u, length, width, variant, curve, twist);
                let flesh = if variant == Variant::Succulent { thickness * Math::pow(Math::sin(f * PI), 0.65) * jmax(0.0, 1.0 - u * u).sqrt() * (1.25 - f * 0.45) } else { thickness };
                positions.extend([point[0], point[1], point[2] + if variant == Variant::Succulent { (if side == 1 { -1.0 } else { 1.0 }) * flesh } else { -side_f * flesh }]);
                uv.push(if variant == Variant::Upright { (strip + SNAKE_INSET + col as f64 / columns as f64 * (1.0 - SNAKE_INSET * 2.0)) / SNAKE_STRIPS }
                    else { inset + col as f64 / columns as f64 * (1.0 - inset * 2.0) });
                uv.push(inset + f * (1.0 - inset * 2.0));
                let edge = Math::pow(u.abs(), 2.0);
                let ridge = 1.0 - u.abs();
                // Echeveria tips blush pink where the wax is thinnest.
                let blush = if variant == Variant::Succulent { smoothstep(0.78, 1.0, f) * (0.6 + edge * 0.4) } else { 0.0 };
                if detailed {
                    colors.extend([0.78 + ridge * 0.12 + tint + side_f * 0.04 + hue * 0.8 + blush * 0.34,
                        0.85 + ridge * 0.10 + tint + side_f * 0.025 + hue * 0.15 - blush * 0.12,
                        0.73 + ridge * 0.12 + tint + side_f * 0.055 - hue * 0.5 + blush * 0.04]);
                } else {
                    colors.extend([0.23 + ridge * 0.11 + tint + edge * 0.04, 0.36 + ridge * 0.15 + tint, 0.16 + ridge * 0.075 + tint * 0.5]);
                }
            }
        }
    }
    let count = (rows + 1) * (columns + 1);
    for row in 0..rows {
        for col in 0..columns {
            let f = (row as f64 + 0.5) / rows as f64;
            let u = ((col as f64 + 0.5) / columns as f64 * 2.0 - 1.0).abs();
            // Genuine gaps between the rib and lobes remain part of the geometry.
            if variant == Variant::Monstera && u > 0.15 && u < 0.48 && [0.32, 0.54, 0.74].iter().any(|center| (f - center).abs() < 0.045) { continue; }
            let a = row * (columns + 1) + col;
            let (b, c) = (a + 1, a + columns + 1);
            let d = c + 1;
            indices.extend([a, b, d, a, d, c].map(|i| i as u32));
            if thick { indices.extend([a + count, d + count, b + count, a + count, c + count, d + count].map(|i| i as u32)); }
        }
    }
    if thick {
        let mut edge = |a: usize, b: usize| indices.extend([a, a + count, b + count, a, b + count, b].map(|i| i as u32));
        for row in 0..rows {
            edge(row * (columns + 1), (row + 1) * (columns + 1));
            edge((row + 1) * (columns + 1) + columns, row * (columns + 1) + columns);
        }
        for col in 0..columns {
            edge(col + 1, col);
            edge(rows * (columns + 1) + col, rows * (columns + 1) + col + 1);
        }
    }
    let mut geo = Geo { position: f32s(&positions), normal: vec![0.0; positions.len()], uv: f32s(&uv), color: f32s(&colors), index: Some(indices) };
    geo.compute_vertex_normals();
    built(geo, "BufferGeometry", POS_NORMAL_COLOR_UV)
}

/// `ivyLeafGeometry`: five broad lobes with shallow sinuses and a notched base, as one cupped double-sided sheet.
pub fn ivy_leaf_geometry(length: f64, width: f64, curve: f64, rng: &mut Rng) -> Built {
    let outline: [[f64; 2]; 14] = [[0.0, 0.05], [-0.14, -0.01], [-0.30, 0.10], [-0.50, 0.30], [-0.37, 0.43], [-0.45, 0.63], [-0.19, 0.66], [0.0, 1.0],
        [0.19, 0.66], [0.45, 0.63], [0.37, 0.43], [0.50, 0.30], [0.30, 0.10], [0.14, -0.01]];
    let segments = outline.len();
    let center = [0.0, length * 0.44, length * curve * 0.75];
    let tint = rng.next() * 0.045;
    let asymmetry = (rng.next() - 0.5) * 0.12;
    let hue = (rng.next() - 0.5) * 0.08;
    let (mut positions, mut uv, mut colors, mut indices): (Vec<f64>, Vec<f64>, Vec<f64>, Vec<u32>) = (vec![], vec![], vec![], vec![]);
    let mut vertex = |x: f64, y: f64, f: f64| {
        let px = x * width * f * (1.0 + asymmetry * js_sign(x));
        let py = center[1] + (y * length - center[1]) * f;
        positions.extend([px, py, center[2] + x.abs() * width * 0.055 * f + Math::sin(y * PI) * length * curve * 0.2 * f]);
        uv.extend([0.5 + px / width, jmax(0.0, py / length)]);
        colors.extend([0.86 + tint + hue * 0.8, 0.92 + tint + hue * 0.15, 0.83 + tint - hue * 0.5]);
    };
    vertex(0.0, 0.44, 0.0);
    for f in [0.5, 1.0] { for [x, y] in outline { vertex(x, y, f); } }
    for j in 0..segments {
        let next = (j + 1) % segments;
        let (a, b) = (1 + j, 1 + next);
        let (c, d) = (a + segments, b + segments);
        indices.extend([0, b, a, a, b, d, a, d, c].map(|i| i as u32));
    }
    let mut geo = Geo { position: f32s(&positions), normal: Vec::new(), uv: f32s(&uv), color: f32s(&colors), index: Some(indices) };
    geo.compute_vertex_normals();
    built(geo, "BufferGeometry", POS_COLOR_UV_NORMAL)
}

/// The outline of a Monstera blade: cordate base, rounded lobes, deep curved slits and two pairs of closed
/// fenestrations (the holes), as a `Shape`.
fn monstera_shape() -> (Path, Vec<Path>) {
    let mut shape = Path::new();
    shape.move_to([0.0, 0.12]);
    shape.bezier_to([-0.14, -0.02], [-0.45, 0.005], [-0.50, 0.19]);
    shape.quadratic_to([-0.55, 0.28], [-0.50, 0.37]);
    shape.bezier_to([-0.43, 0.37], [-0.30, 0.31], [-0.22, 0.33]);
    shape.quadratic_to([-0.27, 0.40], [-0.46, 0.45]);
    shape.quadratic_to([-0.47, 0.50], [-0.42, 0.57]);
    shape.bezier_to([-0.32, 0.57], [-0.18, 0.49], [-0.13, 0.53]);
    shape.quadratic_to([-0.22, 0.63], [-0.35, 0.66]);
    shape.quadratic_to([-0.31, 0.72], [-0.27, 0.78]);
    shape.quadratic_to([-0.17, 0.70], [-0.10, 0.66]);
    shape.quadratic_to([-0.14, 0.78], [-0.22, 0.85]);
    shape.quadratic_to([-0.10, 0.94], [0.0, 1.0]);
    shape.quadratic_to([0.10, 0.94], [0.22, 0.85]);
    shape.quadratic_to([0.14, 0.78], [0.10, 0.66]);
    shape.quadratic_to([0.17, 0.70], [0.27, 0.78]);
    shape.quadratic_to([0.31, 0.72], [0.35, 0.66]);
    shape.quadratic_to([0.22, 0.63], [0.13, 0.53]);
    shape.bezier_to([0.18, 0.49], [0.32, 0.57], [0.42, 0.57]);
    shape.quadratic_to([0.47, 0.50], [0.46, 0.45]);
    shape.quadratic_to([0.27, 0.40], [0.22, 0.33]);
    shape.bezier_to([0.30, 0.31], [0.43, 0.37], [0.50, 0.37]);
    shape.quadratic_to([0.55, 0.28], [0.50, 0.19]);
    shape.bezier_to([0.45, 0.005], [0.14, -0.02], [0.0, 0.12]);
    let mut holes = Vec::new();
    for side in [-1.0f64, 1.0] {
        for [x, y, rx, ry] in [[0.19, 0.24, 0.042, 0.065], [0.095, 0.43, 0.030, 0.062]] {
            let mut hole = Path::new();
            hole.abs_ellipse(side * x, y, rx, ry, 0.0, PI * 2.0, true, side * -0.30);
            holes.push(hole);
        }
    }
    (shape, holes)
}

/// `subdivideSurface`: every triangle split in four at the midpoints of its edges (shared by neighbours), so the
/// flat blade has interior vertices to bend. Returns the positions (Float32) and the new index.
pub fn subdivide(surface: &Geo) -> (Vec<f32>, Vec<u32>) {
    let mut positions: Vec<f64> = surface.position.iter().map(|&v| f64::from(v)).collect();
    let mut indices: Vec<u32> = Vec::new();
    let mut midpoints: HashMap<(u32, u32), u32> = HashMap::new();
    let mut midpoint = |positions: &mut Vec<f64>, a: u32, b: u32| -> u32 {
        let key = if a < b { (a, b) } else { (b, a) };
        if let Some(&found) = midpoints.get(&key) { return found; }
        let at = (positions.len() / 3) as u32;
        midpoints.insert(key, at);
        for axis in 0..3 { let value = (positions[a as usize * 3 + axis] + positions[b as usize * 3 + axis]) / 2.0; positions.push(value); }
        at
    };
    for t in surface.index.as_ref().unwrap().chunks_exact(3) {
        let (a, b, c) = (t[0], t[1], t[2]);
        let ab = midpoint(&mut positions, a, b);
        let bc = midpoint(&mut positions, b, c);
        let ca = midpoint(&mut positions, c, a);
        indices.extend([a, ab, ca, ab, b, bc, ca, bc, c, ab, bc, ca]);
    }
    (f32s(&positions), indices)
}

/// `monsteraLeafGeometry`: the subdivided outline bent into a lamina with two faces and the edge walls between them.
pub fn monstera_leaf_geometry(length: f64, width: f64, curve: f64, rng: &mut Rng) -> Built {
    let (shape, holes) = monstera_shape();
    let flat = three_shape::shape_geometry(&shape, &holes, 5);
    let (source, source_index) = subdivide(&flat);
    let count = source.len() / 3;
    let tint = rng.next() * 0.035;
    let twist = (rng.next() - 0.5) * 0.16;
    let hue = (rng.next() - 0.5) * 0.07;
    let (mut positions, mut uv, mut colors, mut indices): (Vec<f64>, Vec<f64>, Vec<f64>, Vec<u32>) = (vec![], vec![], vec![], vec![]);
    for side in 0..2 {
        let side_f = f64::from(side);
        for i in 0..count {
            let (x, y) = (f64::from(source[i * 3]), f64::from(source[i * 3 + 1]));
            positions.extend([x * width * (1.0 + twist * js_sign(x)), (y - 0.12) * length,
                Math::sin(y * PI) * length * curve + x * x * width * 0.15 + x * width * twist * y - side_f * width * 0.009]);
            uv.extend([0.5 + x, y]);
            colors.extend([0.85 + tint + side_f * 0.04 + hue * 0.8, 0.93 + tint + side_f * 0.025 + hue * 0.15, 0.81 + tint + side_f * 0.055 - hue * 0.5]);
        }
    }
    // an edge shared by two triangles is interior: only the boundary gets a wall (a Map keeps insertion order)
    let mut slots: Vec<Option<(u32, u32)>> = Vec::new();
    let mut live: HashMap<(u32, u32), usize> = HashMap::new();
    let mut edge = |a: u32, b: u32| {
        let key = if a < b { (a, b) } else { (b, a) };
        if let Some(slot) = live.remove(&key) { slots[slot] = None; } else { live.insert(key, slots.len()); slots.push(Some((a, b))); }
    };
    let count_u = count as u32;
    for t in source_index.chunks_exact(3) {
        let (a, b, c) = (t[0], t[1], t[2]);
        indices.extend([a, b, c, a + count_u, c + count_u, b + count_u]);
        edge(a, b); edge(b, c); edge(c, a);
    }
    for (a, b) in slots.into_iter().flatten() { indices.extend([a, a + count_u, b + count_u, a, b + count_u, b]); }
    let mut geo = Geo { position: f32s(&positions), normal: Vec::new(), uv: f32s(&uv), color: f32s(&colors), index: Some(indices) };
    geo.compute_vertex_normals();
    let mut out = built(geo, "BufferGeometry", POS_COLOR_UV_NORMAL);
    out.fenestrations = true;
    out
}

/// `cactusCap`: how the girth closes towards both ends of a column.
pub fn cactus_cap(f: f64) -> f64 {
    let end = if f < 0.15 { f / 0.15 - 1.0 } else if f > 0.85 { (f - 0.85) / 0.15 } else { 0.0 };
    jmax(0.0, 1.0 - end * end).sqrt()
}

/// `cactusGeometry`: a ribbed column.
pub fn cactus_geometry(length: f64, radius: f64, bend: f64, rng: &mut Rng) -> Built {
    let (rows, columns) = (18usize, 32usize);
    let (mut positions, mut colors, mut uv, mut indices): (Vec<f64>, Vec<f64>, Vec<f64>, Vec<u32>) = (vec![], vec![], vec![], vec![]);
    for row in 0..=rows {
        for col in 0..=columns {
            let f = row as f64 / rows as f64;
            let angle = col as f64 / columns as f64 * PI * 2.0;
            let cap = if f < 0.15 { 1.0 } else { cactus_cap(f) };
            let ridge = 0.87 + 0.13 * Math::cos(angle * 8.0);
            let r = radius * cap * ridge;
            positions.extend([Math::cos(angle) * r + bend * f * f, length * f, Math::sin(angle) * r]);
            // Older tissue near the soil corks slightly; the crown is fresher.
            let green = 0.30 + 0.07 * Math::cos(angle * 8.0) + rng.next() * 0.025;
            let cork = smoothstep(0.12, 0.0, f) * 0.35;
            let fresh = smoothstep(0.75, 1.0, f) * 0.06;
            colors.extend([green * (0.68 + cork * 0.5) + fresh * 0.4, green * (1.0 - cork * 0.25) + fresh, green * (0.60 - cork * 0.1) + fresh * 0.2]);
            uv.extend([col as f64 / columns as f64, f]);
            if row < rows && col < columns {
                let a = row * (columns + 1) + col;
                let (b, c) = (a + 1, a + columns + 1);
                let d = c + 1;
                indices.extend([a, d, b, a, c, d].map(|i| i as u32));
            }
        }
    }
    let mut geo = Geo { position: f32s(&positions), normal: Vec::new(), uv: f32s(&uv), color: f32s(&colors), index: Some(indices) };
    geo.compute_vertex_normals();
    built(geo, "BufferGeometry", POS_COLOR_UV_NORMAL)
}

/// The profile of a pot, the unit radius and height of its wall, rim and inside (`potProfile`).
pub(crate) fn pot_profile(pot_id: &str) -> Vec<[f64; 2]> {
    if pot_id == "muskot" {
        // Broad lower horizontal bands, as on the real white MUSKOT.
        let mut profile = vec![[0.76, 0.0], [0.80, 0.025]];
        for i in 0..=20 {
            let y = 0.04 + i as f64 / 20.0 * 0.54;
            profile.push([0.81 + y * 0.20 + 0.019 * Math::sin(i as f64 * PI / 2.0), y]);
        }
        profile.extend([[0.975, 0.90], [0.994, 0.955], [0.998, 0.984], [0.986, 0.999], [0.963, 0.998], [0.949, 0.979], [0.936, 0.94], [0.922, 0.84], [0.0, 0.84]]);
        return profile;
    }
    if pot_id == "gradvis" {
        return vec![[0.53, 0.0], [0.64, 0.025], [0.76, 0.08], [0.86, 0.16], [0.93, 0.27], [0.97, 0.39], [0.99, 0.54], [1.0, 0.95], [0.997, 0.985], [0.982, 1.0], [0.955, 0.998], [0.942, 0.975], [0.935, 0.84], [0.0, 0.84]];
    }
    if pot_id == "akerbar" {
        return vec![[0.78, 0.0], [0.81, 0.015], [0.81, 0.035], [0.785, 0.048], [0.79, 0.085], [0.97, 0.95], [1.0, 0.971], [1.018, 0.99], [1.0, 1.011], [0.98, 1.014], [0.96, 1.0], [0.957, 0.983], [0.955, 0.95], [0.948, 0.84], [0.0, 0.84]];
    }
    // Terracotta: tapered body under a thick, rounded collar.
    vec![[0.68, 0.0], [0.715, 0.012], [0.735, 0.05], [0.895, 0.785], [0.93, 0.80], [0.985, 0.815], [1.005, 0.84], [1.012, 0.90], [1.008, 0.965], [0.992, 0.992], [0.965, 1.0], [0.935, 0.994], [0.918, 0.965], [0.912, 0.9], [0.905, 0.84], [0.0, 0.84]]
}

/// The pot: its lathe with the texture rows, the inside tone and, for the fluted GRADVIS, the ribs and a welded seam.
pub struct Pot { pub built: Built, pub soil_radius: f64, pub radius: f64 }
pub fn pot_geometry(pot_id: &str, radius: f64, height: f64, soil_fraction: f64) -> Pot {
    let raw = pot_profile(pot_id);
    let full_height = raw.iter().fold(f64::NEG_INFINITY, |m, p| jmax(m, p[1]));
    let profile: Vec<[f64; 2]> = raw.iter().map(|p| [p[0], p[1] / full_height]).collect();
    let n = profile.len();
    let fluted = pot_id == "gradvis";
    // `radius` is the pot's real outer radius: its widest point (a rolled rim, or the crest of a rib) reaches exactly that.
    let widest = profile.iter().fold(f64::NEG_INFINITY, |m, p| jmax(m, p[0]));
    let radius = radius / (widest + if fluted { 0.018 } else { 0.0 });
    let segments = if fluted { 96 } else if pot_id == "muskot" { 40 } else { 48 };
    let points: Vec<[f64; 2]> = profile.iter().map(|p| [p[0] * radius, p[1] * height]).collect();
    let mut geo = three_geo::lathe(&points, segments);
    let mut s = vec![0.0];
    for j in 1..n { s.push(s[j - 1] + Math::hypot((profile[j][0] - profile[j - 1][0]) * radius, (profile[j][1] - profile[j - 1][1]) * height)); }
    let mut top = 0;
    for j in 1..n { if profile[j][1] > profile[top][1] { top = j; } }
    let cross = |start: usize, end: usize, y: f64| -> (f64, f64) {
        for j in start..end {
            let ([ra, ya], [rb, yb]) = (profile[j], profile[j + 1]);
            if ya != yb && (ya - y) * (yb - y) <= 0.0 {
                let t = (y - ya) / (yb - ya);
                return (s[j] + (s[j + 1] - s[j]) * t, ra + (rb - ra) * t);
            }
        }
        (s[end], profile[end][0])
    };
    // Arc length anchors keep the unglazed foot, lip and soil line in the same texture rows whatever the pot's proportions.
    let foot = cross(0, top, 0.04);
    let soil = cross(top, n - 1, soil_fraction);
    let anchors = [[0.0, 0.0], [foot.0, FOOT], [s[top], RIM], [soil.0, SOIL], [s[n - 1], 1.0]];
    let row_for = |value: f64| -> f64 {
        for k in 1..anchors.len() {
            if value <= anchors[k][0] || k == anchors.len() - 1 {
                let ([s0, v0], [s1, v1]) = (anchors[k - 1], anchors[k]);
                return v0 + (v1 - v0) * if s1 > s0 { clamp01((value - s0) / (s1 - s0)) } else { 0.0 };
            }
        }
        1.0
    };
    let mut colors = vec![1.0f32; geo.count() * 3];
    let lip = profile[top][1];
    for i in 0..=segments {
        for j in 0..n {
            let index = i * n + j;
            let [r, y] = profile[j];
            geo.uv[index * 2 + 1] = row_for(s[j]) as f32;
            let mut tone = 1.0;
            // The inside of the pot falls into shadow towards the soil.
            if j > top {
                tone = if y < soil_fraction - 0.01 { 0.42 } else { 1.0 - 0.45 * smoothstep(0.0, 1.0, (lip - y) / (lip - soil_fraction)) };
            } else if pot_id == "muskot" && j > 0 && j < top {
                tone += jsmath::clamp((r - (profile[j - 1][0] + profile[j + 1][0]) / 2.0) * 5.0, -0.09, 0.02);
            }
            if fluted && j < top {
                let (x, z) = (f64::from(geo.position[index * 3]), f64::from(geo.position[index * 3 + 2]));
                let px = Math::hypot(x, z);
                let rib = -Math::cos(Math::atan2(x, z) * 32.0);
                // Rounded vertical ribs fade into the foot and stop below the rim.
                let fade = Math::sin(jmin(1.0, y * 7.0) * PI / 2.0) * jsmath::clamp((0.97 - y) * 14.0, 0.0, 1.0);
                let offset = rib * radius * 0.018 * fade;
                if px != 0.0 {
                    geo.position[index * 3] = (x / px * (px + offset)) as f32;
                    geo.position[index * 3 + 2] = (z / px * (px + offset)) as f32;
                }
                tone *= 1.0 + jmin(0.0, rib) * 0.07 * fade;
            }
            colors[index * 3] = tone as f32; colors[index * 3 + 1] = tone as f32; colors[index * 3 + 2] = tone as f32;
        }
    }
    geo.color = colors;
    if fluted {
        geo.compute_vertex_normals();
        // Weld the lathe seam so the first rib is not shaded as a hard edge.
        for j in 0..n {
            let (a, b) = (three_geo::v3(&geo.normal, j), three_geo::v3(&geo.normal, segments * n + j));
            let welded = jsmath::normalize([a[0] + b[0], a[1] + b[1], a[2] + b[2]]);
            for k in [j, segments * n + j] { for axis in 0..3 { geo.normal[k * 3 + axis] = welded[axis] as f32; } }
        }
    }
    Pot { built: built(geo, "LatheGeometry", POS_UV_NORMAL_COLOR), soil_radius: soil.1 * radius, radius }
}

/// The saucer of the MUSKOTBLOMMA, a lathe with the texture rows of the foot and the contact shadow of the pot.
pub fn saucer_geometry(radius: f64, pot_height: f64) -> Built {
    let profile: [[f64; 2]; 12] = [[0.0, 0.0], [1.13, 0.0], [1.17, 0.025], [1.19, 0.075], [1.18, 0.14], [1.155, 0.172], [1.12, 0.17], [1.09, 0.12], [1.07, 0.07], [0.9, 0.067], [0.74, 0.066], [0.0, 0.065]];
    let points: Vec<[f64; 2]> = profile.iter().map(|p| [radius * p[0] / 1.19, pot_height * p[1]]).collect();
    let mut geo = three_geo::lathe(&points, 40);
    let count = geo.count();
    let mut tones = Vec::with_capacity(count * 3);
    for i in 0..count {
        let j = i % profile.len();
        geo.uv[i * 2 + 1] = (FOOT + 0.02 + j as f64 / (profile.len() - 1) as f64 * 0.3) as f32;
        // Contact shadow where the pot foot stands in the dish.
        let tone = if j >= profile.len() - 3 { [0.7, 0.5, 0.45][j - profile.len() + 3] } else { 1.0 };
        tones.extend([tone, tone, tone]);
    }
    geo.color = f32s(&tones);
    built(geo, "LatheGeometry", POS_UV_NORMAL_COLOR)
}

/// The folded steel seam down the front of the zinc pot (a thin cylinder with its caps).
pub fn seam_geometry(width: f64, pot_height: f64) -> Built {
    let mut geo = three_geo::cylinder(width * 0.0015, width * 0.0015, pot_height * 0.87, 5, 1, false, 0.0, PI * 2.0);
    geo.color = vec![0.86f64 as f32; geo.count() * 3];
    let torso = 5 * 6;
    let mut out = built(geo, "CylinderGeometry", POS_NORMAL_UV_COLOR);
    out.groups = vec![[0, torso, 0], [torso, 15, 1], [torso + 15, 15, 2]];
    out
}

/// The tones a stem runs through, from its older base to the fresh growth at its tip.
#[derive(Clone, Copy)]
pub enum Tone { Stem, Woody, Zz, Palm, Fern, Petiole, Vein, Ivy }
fn tone_colors(tone: Tone) -> ([f64; 3], [f64; 3]) {
    let (a, b) = match tone {
        Tone::Stem => (0x4b5a2f, 0x6a8a3c), Tone::Woody => (0x5a4630, 0x5d7336), Tone::Zz => (0x2f4027, 0x4b6a2b), Tone::Palm => (0x46602a, 0x627f38),
        Tone::Fern => (0x4a5a2a, 0x6b8a3a), Tone::Petiole => (0x536d2f, 0x739449), Tone::Vein => (0x7f9955, 0x91a866), Tone::Ivy => (0x4a3a2c, 0x4c5a31),
    };
    (color(a), color(b))
}

/// A stem: a tube along `curve`, tapered between the end radii and coloured from base to tip.
pub fn stem_geometry(curve: &CatmullRom, r: f64, tubular: usize, radial: usize, tone: Tone, taper: [f64; 2]) -> Built {
    let mut geo = tube(curve, tubular, r, radial);
    let count = geo.count();
    let mut colors = vec![0.0f32; count * 3];
    let (from, to) = tone_colors(tone);
    for i in 0..=tubular {
        let f = i as f64 / tubular as f64;
        let scale = taper[0] + (taper[1] - taper[0]) * f;
        let centre = curve.point_at(f);
        let colour = color_lerp(from, to, jmin(1.0, f * 1.6));
        for j in 0..=radial {
            let k = i * (radial + 1) + j;
            if scale != 1.0 {
                for axis in 0..3 {
                    geo.position[k * 3 + axis] = (centre[axis] + (f64::from(geo.position[k * 3 + axis]) - centre[axis]) * scale) as f32;
                }
            }
            for axis in 0..3 { colors[k * 3 + axis] = colour[axis] as f32; }
        }
    }
    geo.color = colors;
    built(geo, "TubeGeometry", POS_NORMAL_UV_COLOR)
}

/// The potting soil: a shallow mound that meets the pot wall in a darker moist edge, stems sinking into soft shadowed
/// collars, and the pebbles, bark or perlite that join the same draw. `roots` are `[x, z, radius]`.
pub fn soil_geometry(radius: f64, y: f64, rng: &mut Rng, roots: &[Vec3], grit: bool) -> Built {
    let (segments, rings) = (32usize, 6usize);
    let mut positions: Vec<f64> = vec![0.0, y + radius * 0.035, 0.0];
    let mut uv: Vec<f64> = vec![0.5, 0.5];
    let mut indices: Vec<u32> = Vec::new();
    for ring in 1..=rings {
        for i in 0..segments {
            let angle = i as f64 / segments as f64 * PI * 2.0;
            let f = ring as f64 / rings as f64;
            let lift = if ring == rings { radius * 0.014 } else { radius * (0.035 * (1.0 - f * f) + (rng.next() - 0.5) * 0.028) };
            positions.extend([Math::cos(angle) * radius * f, y + lift, Math::sin(angle) * radius * f]);
            uv.extend([0.5 + Math::cos(angle) * f / 2.0, 0.5 + Math::sin(angle) * f / 2.0]);
        }
    }
    for i in 0..segments { indices.extend([0, (1 + (i + 1) % segments) as u32, (1 + i) as u32]); }
    for ring in 1..rings {
        for i in 0..segments {
            let a = 1 + (ring - 1) * segments + i;
            let b = 1 + (ring - 1) * segments + (i + 1) % segments;
            indices.extend([a, b, b + segments, a, b + segments, a + segments].map(|v| v as u32));
        }
    }
    let mut colors: Vec<f64> = Vec::new();
    for k in (0..positions.len()).step_by(3) {
        let (x, z) = (positions[k], positions[k + 2]);
        let mut tone = 1.0 - 0.5 * smoothstep(0.72, 1.0, Math::hypot(x, z) / radius);
        for &[rx, rz, rr] in roots {
            tone *= 1.0 - 0.38 * Math::exp(-Math::pow(Math::hypot(x - rx, z - rz) / (rr * 2.4 + radius * 0.06), 2.0));
        }
        colors.extend([tone, tone, tone]);
    }
    let mut bed = Geo { position: f32s(&positions), normal: Vec::new(), uv: f32s(&uv), color: f32s(&colors), index: Some(indices) };
    bed.compute_vertex_normals();
    let mut parts = vec![bed.to_non_indexed()];
    let palette: [u32; 4] = [0xa39c90, 0xc2b59d, 0x7f6d5c, 0xdcd8cf];
    let pieces = if grit { 12 } else { 5 };
    for k in 0..pieces {
        let chip = !grit && k < 3;
        let perlite = !grit && !chip;
        let size = radius * if chip { 0.085 + rng.next() * 0.05 } else if perlite { 0.03 + rng.next() * 0.022 } else { 0.055 + rng.next() * 0.045 };
        let mut piece = three_geo::icosahedron(size);
        let angle = rng.next() * PI * 2.0;
        let r = radius * (0.22 + 0.62 * rng.next().sqrt());
        let euler = [(rng.next() - 0.5) * 0.5, rng.next() * PI * 2.0, (rng.next() - 0.5) * 0.5];
        let rotation = quaternion_from_euler(euler[0], euler[1], euler[2]);
        let matrix = Mat4::compose([Math::cos(angle) * r, y + radius * 0.035 * (1.0 - Math::pow(r / radius, 2.0)) + size * if chip { 0.04 } else { 0.12 }, Math::sin(angle) * r],
            rotation, if chip { [1.5, 0.3, 0.9] } else { [1.0, 0.62, 0.85] });
        piece.apply_matrix4(&matrix);
        let base = if grit { palette[(rng.next() * 4.0).floor() as usize] } else if chip { 0x6b4630 } else { 0xebe8e0 };
        let shade = 0.82 + rng.next() * 0.3;
        let colour = color(base).map(|c| c * shade);
        let count = piece.count();
        piece.color = (0..count).flat_map(|_| colour.map(|c| c as f32)).collect();
        piece.uv = vec![0.965f64 as f32; count * 2];
        parts.push(piece);
    }
    built(three_geo::merge(&parts), "BufferGeometry", POS_UV_COLOR_NORMAL)
}

/// An areole bead of a cactus: a tiny sphere as a triangle soup.
pub fn areole_geometry(width: f64) -> Built {
    built(three_geo::sphere(width * 0.0065, 4, 3).to_non_indexed(), "BufferGeometry", POS_NORMAL_UV)
}

/// The segments of a bounding box in `Box3` form of a geometry's positions.
pub fn box_of(geo: &Geo) -> [f64; 6] { let b = geo.bounds(); [b.min[0], b.min[1], b.min[2], b.max[0], b.max[1], b.max[2]] }
