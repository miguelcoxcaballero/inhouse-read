//! The case of a book model: its two boards and the two half-ellipse ends of the binding, built in one call
//! per book. Both boards are the same `boardGeometry` and both ends the same `capGeometry`, so each is built
//! once; the host installs two geometries from each. The front board's cover faces are split into outer
//! (material 0) and inner (material 2) groups by the sign of their normal's z, as `createBookModel` did.
//! Every array is the one three r180 builds (`ExtrudeGeometry`, `translate`, the UV rewrite of the lids,
//! `ShapeGeometry`), in its order of operations and with the host's `Math.sin`/`Math.cos`.
use crate::jsmath::jmin;
use crate::three_shape::{extrude_beveled, shape_geometry, Path};
use js_sys::Math;
use std::f64::consts::PI;
use wasm_bindgen::prelude::*;

/// Floats before the arrays: board vertices, lid start/count, wall start/count, front groups, cap vertices,
/// cap indices.
const HEADER: usize = 8;

/// `boardGeometry(width, height, depth, { shelf, overview })`: rounded board edges with front/back UVs in the
/// same coordinates as a cover, the bevel inside the book's dimensions. Returns the geometry and its groups.
fn board(width: f64, height: f64, depth: f64, shelf: bool, overview: bool) -> (crate::three_geo::Geo, [[usize; 3]; 2]) {
    // A visibly rounded, slightly softened board edge, as covered board has.
    let bevel = jmin(depth * 0.4, height * 0.0035);
    let (x, y) = (-width / 2.0 + bevel, -height / 2.0 + bevel);
    let (w, h, r) = (width - bevel * 2.0, height - bevel * 2.0, height * 0.006);
    let mut shape = Path::new();
    shape.move_to([x + r, y]);
    shape.line_to([x + w - r, y]);
    shape.quadratic_to([x + w, y], [x + w, y + r]);
    shape.line_to([x + w, y + h - r]);
    shape.quadratic_to([x + w, y + h], [x + w - r, y + h]);
    shape.line_to([x + r, y + h]);
    shape.quadratic_to([x, y + h], [x, y + h - r]);
    shape.line_to([x, y + r]);
    shape.quadratic_to([x, y], [x + r, y]);
    let curve_segments = if overview { 1 } else if shelf { 2 } else { 5 };
    let bevel_segments = if shelf || overview { 1 } else { 3 };
    let (mut geo, groups) = extrude_beveled(&shape.points(curve_segments), depth - bevel * 2.0, bevel, bevel, bevel_segments);
    geo.translate(0.0, 0.0, -depth / 2.0 + bevel);
    // The lids (group 0) take the cover's UVs: position / size + .5, from the stored positions.
    let [start, count, _] = groups[0];
    for i in start..start + count {
        geo.uv[i * 2] = (f64::from(geo.position[i * 3]) / width + 0.5) as f32;
        geo.uv[i * 2 + 1] = (f64::from(geo.position[i * 3 + 1]) / height + 0.5) as f32;
    }
    (geo, groups)
}

/// The front board's groups: each lid run split where its normal turns from the outside (material 0, z >= 0)
/// to the inside of the board (material 2), checked at the first vertex of every triangle; other groups kept.
fn front_groups(normal: &[f32], groups: &[[usize; 3]; 2]) -> Vec<[usize; 3]> {
    let mut out = Vec::new();
    for &[start, count, material] in groups {
        if material != 0 { out.push([start, count, material]); continue; }
        let side = |index: usize| if normal[index * 3 + 2] < 0.0 { 2 } else { 0 };
        let (mut first, mut current) = (start, side(start));
        let mut index = start + 3;
        while index < start + count {
            let next = side(index);
            if next != current { out.push([first, index - first, current]); first = index; current = next; }
            index += 3;
        }
        out.push([first, start + count - first, current]);
    }
    out
}

/// `capGeometry(width, thickness, segments, rim)`: the half-ellipse end of the case. A rim leaves the hollow
/// open so the headband shows inside a thin edge of cloth and board.
fn cap(width: f64, thickness: f64, segments: usize, rim: f64) -> crate::three_geo::Geo {
    let bulge = thickness * 0.38;
    let mut shape = Path::new();
    shape.move_to([-width / 2.0, -thickness / 2.0]);
    for i in 1..=segments {
        let a = i as f64 / segments as f64 * PI;
        shape.line_to([-width / 2.0 - bulge * Math::sin(a), -thickness / 2.0 * Math::cos(a)]);
    }
    if rim != 0.0 && !rim.is_nan() {
        for i in (0..=segments).rev() {
            let a = i as f64 / segments as f64 * PI;
            shape.line_to([-width / 2.0 - (bulge - rim) * Math::sin(a), -(thickness / 2.0 - rim) * Math::cos(a)]);
        }
    }
    shape.close();
    // ShapeGeometry's default curveSegments; every curve here is a line.
    shape_geometry(&shape, &[], 12)
}

/// The case of one book as one Float32 buffer: a header of `HEADER` counts, the front board's groups
/// (start, count, material each), then the board's position, uv and normal, then the cap's position, normal,
/// uv and index (as numbers). `segments` 0 builds no cap. Every count fits a Float32 exactly.
#[wasm_bindgen]
#[allow(clippy::too_many_arguments)]
pub fn book_case_geometry(width: f64, height: f64, depth: f64, shelf: bool, overview: bool, thickness: f64, segments: u32, rim: f64) -> Vec<f32> {
    let (board, groups) = board(width, height, depth, shelf, overview);
    let front = front_groups(&board.normal, &groups);
    let cap = if segments > 0 { Some(cap(width, thickness, segments as usize, rim)) } else { None };
    let (cap_vertices, cap_indices) = cap.as_ref().map_or((0, 0), |cap| (cap.count(), cap.index.as_ref().map_or(0, Vec::len)));
    let board_vertices = board.count();
    let mut out = Vec::with_capacity(HEADER + front.len() * 3 + board_vertices * 8 + cap_vertices * 8 + cap_indices);
    let [lid, wall] = groups;
    for value in [board_vertices, lid[0], lid[1], wall[0], wall[1], front.len(), cap_vertices, cap_indices] { out.push(value as f32); }
    for [start, count, material] in &front { out.extend([*start as f32, *count as f32, *material as f32]); }
    out.extend_from_slice(&board.position);
    out.extend_from_slice(&board.uv);
    out.extend_from_slice(&board.normal);
    if let Some(cap) = &cap {
        out.extend_from_slice(&cap.position);
        out.extend_from_slice(&cap.normal);
        out.extend_from_slice(&cap.uv);
        if let Some(index) = &cap.index { out.extend(index.iter().map(|&i| i as f32)); }
    }
    out
}
