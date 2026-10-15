//! Differential probes: each of the geometry generators and finishing steps the models are made of,
//! callable on its own, so the unit tests can compare it with three.js on large pseudo-random corpora.
//! The models themselves call the same functions.
use crate::geo_packet::Packet;
use crate::mesh_compact::{self, Attr, Packed};
use crate::three_geo::{self, Geo};
use crate::{earcut, mesh_finish, metal_sheet, three_shape};
use wasm_bindgen::prelude::*;

/// A geometry as a packet of f32 attributes in `order` plus its index (empty when not indexed).
pub fn packet_of(geo: &Geo, order: &[&'static str]) -> Vec<u8> {
    let attributes = order.iter().map(|&name| match name {
        "position" => (name, 3, Attr::F32(geo.position.clone())),
        "normal" => (name, 3, Attr::F32(geo.normal.clone())),
        "uv" => (name, 2, Attr::F32(geo.uv.clone())),
        _ => (name, 3, Attr::F32(geo.color.clone())),
    }).collect();
    let mut packet = Packet::new();
    packet.json.push('{');
    packet.packed(&Packed { attributes, index: geo.index.clone().unwrap_or_default() });
    packet.json.push('}');
    packet.seal()
}

/// `box`: width, height, depth, widthSegments, heightSegments, depthSegments.
/// `rounded_box`: width, height, depth, segments, radius.
/// `cylinder`: radiusTop, radiusBottom, height, radialSegments, heightSegments, openEnded, thetaStart, thetaLength.
/// `extrude`: depth, contour length, contour x/y pairs, hole count, then per hole its length and x/y pairs.
#[wasm_bindgen]
pub fn probe_geometry(kind: &str, p: &[f64]) -> Vec<u8> {
    match kind {
        "box" => packet_of(&three_geo::box_geometry(p[0], p[1], p[2], p[3] as usize, p[4] as usize, p[5] as usize), &["position", "normal", "uv"]),
        "rounded_box" => packet_of(&three_geo::rounded_box(p[0], p[1], p[2], p[3] as usize, p[4]), &["position", "normal", "uv"]),
        "cylinder" => packet_of(&three_geo::cylinder(p[0], p[1], p[2], p[3] as usize, p[4] as usize, p[5] != 0.0, p[6], p[7]), &["position", "normal", "uv"]),
        "extrude" => {
            let depth = p[0];
            let n = p[1] as usize;
            let points = |from: usize, count: usize| -> Vec<[f64; 2]> { (0..count).map(|i| [p[from + i * 2], p[from + i * 2 + 1]]).collect() };
            let contour = three_shape::Path::from_points(&points(2, n)).points(1);
            let mut at = 2 + n * 2;
            let holes_count = p[at] as usize;
            at += 1;
            let mut holes = Vec::new();
            for _ in 0..holes_count {
                let count = p[at] as usize;
                holes.push(three_shape::Path::from_points(&points(at + 1, count)).points(1));
                at += 1 + count * 2;
            }
            packet_of(&three_shape::extrude(&contour, &holes, depth), &["position", "uv", "normal"])
        }
        _ => Vec::new(),
    }
}

/// Earcut of flat x/y pairs with hole start indices.
#[wasm_bindgen]
pub fn probe_earcut(data: &[f64], holes: &[u32]) -> Vec<u32> {
    let holes: Vec<usize> = holes.iter().map(|&h| h as usize).collect();
    earcut::triangulate(data, &holes).into_iter().map(|i| i as u32).collect()
}

/// An expanded-metal sheet (nine parameters: uMin, uMax, vMin, vMax, pitch, periodY, strand, thickness, z)
/// as a packet of position, uv and normal; `compact` runs the signed-normalised compaction as well.
#[wasm_bindgen]
pub fn probe_sheet(p: &[f64], kind: u32, compact: bool) -> Vec<u8> {
    let sheet = metal_sheet::expanded_metal(&[p[0], p[1], p[2], p[3], p[4], p[5], p[6], p[7], p[8]], kind);
    if !compact { return packet_of(&sheet, &["position", "uv", "normal"]); }
    let packed = mesh_compact::compact(&sheet, &["position", "uv", "normal"]);
    let mut packet = Packet::new();
    packet.json.push('{');
    packet.packed(&packed);
    packet.json.push('}');
    packet.seal()
}

/// Compaction of a non-indexed geometry whose attributes come in `order` (letters p, n, u, c for position,
/// normal, uv and colour; the colour array may be empty when `c` is absent).
#[wasm_bindgen]
pub fn probe_compact(order: &str, position: &[f32], normal: &[f32], uv: &[f32], color: &[f32]) -> Vec<u8> {
    let geo = Geo { position: position.to_vec(), normal: normal.to_vec(), uv: uv.to_vec(), color: color.to_vec(), index: None };
    let names: Vec<&'static str> = order.chars().map(|c| match c { 'p' => "position", 'n' => "normal", 'u' => "uv", _ => "color" }).collect();
    let mut packet = Packet::new();
    packet.json.push('{');
    packet.packed(&mesh_compact::compact(&geo, &names));
    packet.json.push('}');
    packet.seal()
}

/// `physicalPaintUVs` (kind 0, returns the UVs) or `smoothPostNormals` (kind 1, returns the normals).
#[wasm_bindgen]
pub fn probe_finish(kind: u32, position: &[f32], normal: &[f32]) -> Vec<f32> {
    let mut geo = Geo { position: position.to_vec(), normal: normal.to_vec(), uv: vec![0.0; position.len() / 3 * 2], ..Default::default() };
    if kind == 0 { mesh_finish::physical_paint_uvs(&mut geo); geo.uv } else { mesh_finish::smooth_post_normals(&mut geo); geo.normal }
}

/// A geometry operation: translate (1), rotateY (2), applyQuaternion (3), scale (4) or computeVertexNormals (0)
/// applied to a non-indexed geometry; returns position and normal.
#[wasm_bindgen]
pub fn probe_transform(kind: u32, args: &[f64], position: &[f32], normal: &[f32]) -> Vec<f32> {
    let mut geo = Geo { position: position.to_vec(), normal: normal.to_vec(), ..Default::default() };
    match kind {
        0 => geo.compute_vertex_normals(),
        1 => geo.translate(args[0], args[1], args[2]),
        2 => geo.rotate_y(args[0]),
        3 => geo.apply_quaternion([args[0], args[1], args[2], args[3]]),
        _ => geo.scale(args[0], args[1], args[2]),
    }
    let mut out = geo.position;
    out.extend(geo.normal);
    out
}
