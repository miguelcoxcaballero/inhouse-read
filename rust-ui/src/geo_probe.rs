//! Differential probes: each of the geometry generators and finishing steps the models are made of,
//! callable on its own, so the unit tests can compare it with three.js on large pseudo-random corpora.
//! The models themselves call the same functions.
use crate::geo_packet::{num, Packet};
use crate::plant_parts;
use crate::mesh_compact::{self, Attr, Packed};
use crate::three_geo::{self, Geo};
use crate::three_curve::{self, CatmullRom};
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
        // `lathe`: segments, point count, then x/y pairs.
        "lathe" => {
            let n = p[1] as usize;
            let points: Vec<[f64; 2]> = (0..n).map(|i| [p[2 + i * 2], p[3 + i * 2]]).collect();
            packet_of(&three_geo::lathe(&points, p[0] as usize), &["position", "uv", "normal"])
        }
        // `torus`: radius, tube, radialSegments, tubularSegments.
        "torus" => packet_of(&three_geo::torus(p[0], p[1], p[2] as usize, p[3] as usize), &["position", "normal", "uv"]),
        // `tube`: tubularSegments, radius, radialSegments, point count, then x/y/z triples of the Catmull-Rom path.
        "tube" => {
            let n = p[3] as usize;
            let points: Vec<[f64; 3]> = (0..n).map(|i| [p[4 + i * 3], p[5 + i * 3], p[6 + i * 3]]).collect();
            packet_of(&three_curve::tube(&CatmullRom::new(points), p[0] as usize, p[1], p[2] as usize), &["position", "normal", "uv"])
        }
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

/// `CatmullRomCurve3` queries on flat x/y/z `points`: `point`, `point_at`, `tangent`, `tangent_at` (three numbers per
/// parameter in `args`), `u_to_t` (one per parameter) and `frames` (`args[0]` segments: tangent, normal and binormal of
/// every frame, interleaved).
#[wasm_bindgen]
pub fn probe_curve(kind: &str, points: &[f64], args: &[f64]) -> Vec<f64> {
    let curve = CatmullRom::new(points.chunks_exact(3).map(|c| [c[0], c[1], c[2]]).collect());
    match kind {
        "point" => args.iter().flat_map(|&t| curve.point(t)).collect(),
        "point_at" => args.iter().flat_map(|&u| curve.point_at(u)).collect(),
        "tangent" => args.iter().flat_map(|&t| curve.tangent(t)).collect(),
        "tangent_at" => args.iter().flat_map(|&u| curve.tangent_at(u)).collect(),
        "u_to_t" => args.iter().map(|&u| curve.u_to_t(u)).collect(),
        "frames" => {
            let (tangents, normals, binormals) = curve.frenet_frames(args[0] as usize);
            (0..tangents.len()).flat_map(|i| tangents[i].into_iter().chain(normals[i]).chain(binormals[i])).collect()
        }
        _ => Vec::new(),
    }
}

/// `euler`: x, y, z -> `Quaternion#setFromEuler`; `axis_angle`: ax, ay, az, angle -> `setFromAxisAngle`;
/// `multiply`: eight numbers (a then b) -> `a.multiply(b)`; `rotation_axis`: ax, ay, az, angle -> the sixteen
/// elements of `Matrix4#makeRotationAxis`.
#[wasm_bindgen]
pub fn probe_quaternion(kind: &str, a: &[f64]) -> Vec<f64> {
    match kind {
        "euler" => three_curve::quaternion_from_euler(a[0], a[1], a[2]).to_vec(),
        "axis_angle" => three_curve::quaternion_from_axis_angle([a[0], a[1], a[2]], a[3]).to_vec(),
        "multiply" => three_curve::quaternion_multiply([a[0], a[1], a[2], a[3]], [a[4], a[5], a[6], a[7]]).to_vec(),
        "rotation_axis" => three_curve::rotation_axis([a[0], a[1], a[2]], a[3]).0.to_vec(),
        _ => Vec::new(),
    }
}

/// A plant geometry as a packet: its three class, whether it carries the Monstera's fenestrations, `extra` JSON
/// members, and its attributes and index.
fn part_packet(built: &plant_parts::Built, extra: &str) -> Vec<u8> {
    let mut packet = Packet::new();
    packet.json.push_str(&format!("{{\"type\":\"{}\",\"fenestrations\":{}{extra},", built.kind, built.fenestrations));
    packet.plain(&built.geo, built.order);
    packet.json.push('}');
    packet.seal()
}

/// One generator of a plant on its own, its random numbers `samples`, in turn. `leaf` (`name` the variety; `p`: length,
/// width, curve, twist, detailed), `ivy` and `monstera` (length, width, curve), `cactus` (length, radius, bend) and
/// `pot` (`name` the pot model; radius, height, soil fraction: the packet also holds `soilRadius` and `radius`).
#[wasm_bindgen]
pub fn probe_plant_part(kind: &str, name: &str, p: &[f64], samples: &[f64]) -> Vec<u8> {
    let mut rng = plant_parts::Rng::scripted(samples);
    match kind {
        "leaf" => part_packet(&plant_parts::leaf_geometry(p[0], p[1], plant_parts::Variant::parse(name), p[2], p[3], &mut rng, p[4] != 0.0), ""),
        "ivy" => part_packet(&plant_parts::ivy_leaf_geometry(p[0], p[1], p[2], &mut rng), ""),
        "monstera" => part_packet(&plant_parts::monstera_leaf_geometry(p[0], p[1], p[2], &mut rng), ""),
        "cactus" => part_packet(&plant_parts::cactus_geometry(p[0], p[1], p[2], &mut rng), ""),
        "pot" => {
            let pot = plant_parts::pot_geometry(name, p[0], p[1], p[2]);
            part_packet(&pot.built, &format!(",\"soilRadius\":{},\"radius\":{}", num(pot.soil_radius), num(pot.radius)))
        }
        _ => Vec::new(),
    }
}

/// The midpoint subdivision of an indexed surface: the new positions and index.
#[wasm_bindgen]
pub fn probe_subdivide(positions: &[f32], index: &[u32]) -> Vec<u8> {
    let surface = Geo { position: positions.to_vec(), index: Some(index.to_vec()), ..Default::default() };
    let (position, indices) = plant_parts::subdivide(&surface);
    packet_of(&Geo { position, index: Some(indices), ..Default::default() }, &["position"])
}
