//! The geometry of the three shelf lamps (the MITTLED puck, the TRIPOD floor lamp, the filament lantern), built
//! the way `createShelfLamp` built it from three.js primitives: every part transformed to its place, the parts of
//! one material merged, the tripod's feet and cord trimmed to the shelf, and the fitting scale baked into the
//! vertices. The packet holds one geometry per mesh (in the order the meshes are added) and the light emitter
//! the fitted lamp carries; the host makes the materials and the meshes.
use crate::geo_packet::{num, nums, Packet};
use crate::jsmath::{self, Mat4, Vec3};
use crate::three_curve::{quaternion_from_axis_angle, quaternion_from_euler, quaternion_multiply, tube, CatmullRom};
use crate::three_geo::{self, Geo};
use js_sys::Math;
use std::f64::consts::PI;

const LATHE: [&str; 3] = ["position", "uv", "normal"];
const OTHER: [&str; 3] = ["position", "normal", "uv"];

/// One part of a batch: a geometry, the position and the Euler rotation it is baked at.
struct Part { geo: Geo, kind: &'static str, order: [&'static str; 3], position: Vec3, rotation: Vec3 }
fn lathe(profile: &[[f64; 2]], segments: usize) -> Part { Part { geo: three_geo::lathe(profile, segments), kind: "LatheGeometry", order: LATHE, position: [0.0; 3], rotation: [0.0; 3] } }
fn plain(geo: Geo, kind: &'static str) -> Part { Part { geo, kind, order: OTHER, position: [0.0; 3], rotation: [0.0; 3] } }
impl Part {
    fn at(mut self, position: Vec3) -> Part { self.position = position; self }
    fn turned(mut self, rotation: Vec3) -> Part { self.rotation = rotation; self }
}
fn tube_part(points: &[Vec3], radius: f64, segments: usize, radial: usize) -> Part {
    plain(tube(&CatmullRom::new(points.to_vec()), segments, radius, radial), "TubeGeometry")
}
fn cylinder(top: f64, bottom: f64, height: f64, radial: usize, open: bool) -> Part {
    plain(three_geo::cylinder(top, bottom, height, radial, 1, open, 0.0, PI * 2.0), "CylinderGeometry")
}

/// One mesh's geometry, with what the host needs to finish it: the class three gives it (a merged geometry is a plain
/// `BufferGeometry`) and whether its bounding box is computed.
struct Batch { name: &'static str, kind: &'static str, geo: Geo, order: [&'static str; 3], bounds: bool, wall_group: bool }

/// `addBatch`: bake every part's transform, merge the parts of one material.
fn batch(name: &'static str, parts: Vec<Part>) -> Batch {
    let order = parts[0].order;
    let kind = if parts.len() == 1 { parts[0].kind } else { "BufferGeometry" };
    // A lone open cylinder keeps the one draw group `CylinderGeometry` gives its wall; merging drops the groups.
    let groups = parts.len() == 1 && kind == "CylinderGeometry";
    let geos: Vec<Geo> = parts.into_iter().map(|Part { mut geo, position, rotation, .. }| {
        let q = quaternion_from_euler(rotation[0], rotation[1], rotation[2]);
        geo.apply_matrix4(&Mat4::compose(position, q, [1.0; 3]));
        geo
    }).collect();
    let geo = if geos.len() == 1 { geos.into_iter().next().unwrap() } else { three_geo::merge(&geos) };
    Batch { name, kind, geo, order, bounds: false, wall_group: groups }
}

struct Emitter {
    position: Vec3, colour: u32, range: f64, intensity: f64,
    direction: Option<(Vec3, f64, f64)>,
    filaments: Vec<(Vec3, Vec3, f64, Vec3)>,
}

fn polar(angle: f64, radius: f64, y: f64) -> Vec3 { [Math::cos(angle) * radius, y, Math::sin(angle) * radius] }

fn puck(segments: usize) -> (Vec<Batch>, Emitter) {
    let mut out = vec![];
    out.push(batch("lamp-housing", vec![lathe(&[
        [0.0, 0.0], [30.5, 0.0], [32.8, -0.6], [34.0, -2.0], [34.0, -8.0], [33.2, -10.3], [31.8, -11.0],
        [28.4, -11.0], [27.5, -10.1], [27.5, -8.8], [29.2, -8.8], [30.0, -1.8], [0.0, -1.8]], segments)]));
    out.push(batch("warm-opal-diffuser", vec![lathe(&[[0.0, -10.5], [25.8, -10.5], [27.5, -10.1], [27.5, -9.2], [0.0, -9.2]], segments)]));
    out.push(batch("puck-power-lead", vec![tube_part(&[[0.0, -2.0, -30.0], [0.0, -2.0, -33.0], [0.0, -1.5, -33.2]], 0.6, 8, 6)]));
    (out, Emitter { position: [0.0, -12.0, 0.0], colour: 0xffd3a0, range: 700.0, intensity: 392000.0,
        direction: Some(([0.0, -1.0, 0.0], PI * 0.38, 0.65)), filaments: vec![] })
}

pub(crate) const LANTERN_BASE:&[[f64;2]]=&[
        [0.0, 0.0], [58.0, 0.0], [67.0, 1.5], [72.0, 5.0], [74.5, 10.0], [75.0, 18.0], [75.0, 43.0], [74.0, 48.0],
        [70.0, 54.0], [59.0, 61.0], [43.0, 72.0], [35.0, 78.0], [34.0, 84.0], [34.0, 91.0], [31.0, 93.0], [0.0, 93.0]];
pub(crate) const LANTERN_CHIMNEY:&[[f64;2]]=&[
        [37.0, 94.0], [43.0, 96.0], [49.0, 103.0], [52.5, 116.0], [54.0, 135.0], [54.0, 185.0], [53.0, 204.0], [50.0, 215.0],
        [43.0, 227.0], [33.0, 238.0], [29.0, 243.0], [29.0, 248.0], [30.0, 250.0], [28.2, 250.0], [27.2, 248.0], [27.3, 243.0],
        [31.3, 237.0], [41.5, 226.0], [48.5, 214.0], [51.3, 203.0], [52.3, 185.0], [52.3, 135.0],
        [50.8, 117.0], [47.4, 104.0], [41.5, 98.0], [37.0, 96.0], [37.0, 94.0]];

pub(crate) fn tripod_leg_points(index:usize)->([f64;3],[f64;3],f64){
 let angle=index as f64/3.0*PI*2.0+PI/6.0;
 ([Math::cos(angle)*66.0,4.0,Math::sin(angle)*66.0],[Math::cos(angle)*22.0,177.0,Math::sin(angle)*22.0],angle)
}

fn lantern(segments: usize) -> (Vec<Batch>, Emitter) {
    let mut out = vec![];
    out.push(batch("lamp-base", vec![lathe(LANTERN_BASE, segments)]));
    let mut brass = vec![
        lathe(&[[30.0, 88.0], [38.0, 88.0], [40.0, 90.0], [40.0, 93.0], [37.0, 95.0], [30.0, 95.0], [30.0, 88.0]], segments),
        lathe(&[[0.0, 92.0], [11.0, 92.0], [12.0, 94.0], [12.0, 104.0], [10.7, 106.0], [0.0, 106.0]], 32),
        cylinder(3.6, 3.6, 14.0, 20, false).at([20.0, 80.0, 34.0]).turned([PI / 2.0, 0.0, 0.0]),
        cylinder(8.2, 8.2, 5.0, 40, false).at([20.0, 80.0, 42.0]).turned([PI / 2.0, 0.0, 0.0]),
        plain(three_geo::torus(7.85, 0.6, 6, 48), "TorusGeometry").at([20.0, 80.0, 44.8]),
        cylinder(1.3, 1.3, 1.0, 12, false).at([20.0, 80.0, 45.0]).turned([PI / 2.0, 0.0, 0.0]),
    ];
    for notch in 0..48 {
        let angle = notch as f64 / 48.0 * PI * 2.0;
        brass.push(plain(three_geo::box_geometry(0.28, 0.65, 2.9, 1, 1, 1), "BoxGeometry")
            .at([20.0 + Math::cos(angle) * 8.16, 80.0 + Math::sin(angle) * 8.16, 43.0]).turned([0.0, 0.0, angle]));
    }
    out.push(batch("brass-collar-and-machined-dimmer", brass));
    out.push(batch("clear-glass-chimney", vec![lathe(LANTERN_CHIMNEY, segments)]));
    out.push(batch("rolled-glass-rim", vec![plain(three_geo::torus(28.7, 0.9, 6, segments), "TorusGeometry").at([0.0, 249.0, 0.0]).turned([PI / 2.0, 0.0, 0.0])]));
    out.push(batch("amber-candle-led-bulb", vec![lathe(&[
        [0.0, 105.0], [9.0, 105.0], [12.0, 109.0], [15.5, 122.0], [17.0, 135.0], [15.7, 149.0], [12.5, 166.0],
        [8.0, 180.0], [3.5, 188.0], [0.0, 191.0]], 48)]));
    let mut support = vec![cylinder(0.55, 0.55, 57.0, 6, false).at([0.0, 138.0, 0.0])];
    for index in 0..4 {
        let angle = index as f64 / 4.0 * PI * 2.0 + PI / 8.0;
        support.push(tube_part(&[[0.0, 109.0, 0.0], polar(angle, 7.0, 114.0), polar(angle, 7.0, 161.0), [0.0, 163.0, 0.0]], 0.3, 16, 4));
    }
    out.push(batch("led-filament-support", support));
    let (mut filaments, mut emitters) = (vec![], vec![]);
    for index in 0..4 {
        let angle = index as f64 / 4.0 * PI * 2.0 + PI / 8.0;
        let path = [polar(angle, 7.0, 116.0), polar(angle, 7.8, 140.0), polar(angle, 6.8, 161.0)];
        filaments.push(tube_part(&path, 1.05, 16, 6));
        emitters.push((path[0], path[2], 2.1, [Math::cos(angle), 0.0, Math::sin(angle)]));
    }
    out.push(batch("glowing-retro-led-filaments", filaments));
    out.push(batch("black-braided-power-cord", vec![tube_part(&[[0.0, 10.0, -68.0], [0.0, 7.0, -71.0], [5.0, 3.0, -73.0], [12.0, 1.8, -73.1], [20.0, 1.8, -71.0]], 1.4, 24, 6)]));
    (out, Emitter { position: [0.0, 143.0, 0.0], colour: 0xffc889, range: 700.0, intensity: 196000.0, direction: None, filaments: emitters })
}

fn tripod(segments: usize) -> (Vec<Batch>, Emitter) {
    let mut out = vec![];
    let up = [0.0, 1.0, 0.0];
    let mut legs = vec![];
    for index in 0..3 {
        let (foot, shoulder, angle) = tripod_leg_points(index);
        let mut geo = three_geo::rounded_box(13.0, jsmath::distance(foot, shoulder), 9.0, 2, 1.1);
        let orientation = three_geo::quaternion_from_unit_vectors(up, jsmath::normalize(jsmath::sub(shoulder, foot)));
        // Width runs tangentially, so each leg reads as a flat plank.
        let orientation = quaternion_multiply(orientation, quaternion_from_axis_angle(up, -angle));
        geo.apply_quaternion(orientation);
        geo.translate((foot[0] + shoulder[0]) * 0.5, (foot[1] + shoulder[1]) * 0.5, (foot[2] + shoulder[2]) * 0.5);
        legs.push(plain(geo, "RoundedBoxGeometry"));
    }
    legs.push(plain(three_geo::rounded_box(36.0, 12.0, 36.0, 2, 2.0), "RoundedBoxGeometry").at([0.0, 167.0, 0.0]));
    let mut feet = batch("lamp-base", legs);
    // Trim the tiny rounded toe below the support plane.
    for i in 0..feet.geo.count() { if feet.geo.position[i * 3 + 1] < 0.0 { feet.geo.position[i * 3 + 1] = 0.0; } }
    feet.geo.compute_vertex_normals();
    let low = feet.geo.bounds().min[1];
    feet.geo.translate(0.0, -low, 0.0);
    feet.bounds = true;
    out.push(feet);
    let mut fitting = vec![
        cylinder(8.0, 8.0, 27.0, 20, false).at([0.0, 182.0, 0.0]),
        plain(three_geo::torus(87.8, 0.9, 6, segments), "TorusGeometry").at([0.0, 175.0, 0.0]).turned([PI / 2.0, 0.0, 0.0]),
        plain(three_geo::torus(87.8, 0.9, 6, segments), "TorusGeometry").at([0.0, 279.0, 0.0]).turned([PI / 2.0, 0.0, 0.0]),
    ];
    for index in 0..3 {
        let angle = index as f64 / 3.0 * PI * 2.0;
        fitting.push(tube_part(&[[0.0, 193.0, 0.0], polar(angle, 40.0, 185.0), polar(angle, 87.0, 177.0)], 0.55, 12, 4));
    }
    out.push(batch("shade-support-and-rims", fitting));
    out.push(batch("woven-linen-drum-shade", vec![cylinder(90.0, 90.0, 105.0, segments, true).at([0.0, 227.5, 0.0])]));
    out.push(batch("linen-bound-shade-edges", vec![
        lathe(&[[88.6, 175.0], [90.0, 175.0], [90.0, 177.0], [88.6, 177.0], [88.6, 175.0]], segments),
        lathe(&[[88.6, 278.0], [90.0, 278.0], [90.0, 280.0], [88.6, 280.0], [88.6, 278.0]], segments),
        cylinder(87.8, 87.8, 0.5, segments, true).at([0.0, 228.0, 0.0]),
    ]));
    out.push(batch("warm-shaded-led-bulb", vec![lathe(&[
        [0.0, 195.0], [7.0, 195.0], [7.0, 201.0], [13.0, 205.0], [19.0, 215.0], [21.0, 227.0], [17.0, 239.0], [9.0, 246.0], [0.0, 249.0]], 32)]));
    let mut cord = batch("ivory-fabric-power-cord", vec![tube_part(&[
        [0.0, 170.0, 0.0], [0.0, 150.0, -6.0], [8.0, 91.0, -27.0], [13.0, 56.0, -37.0], [15.0, 34.0, -48.0],
        [21.0, 13.0, -55.0], [32.0, 1.4, -53.0], [44.0, 1.4, -45.0]], 1.1, 48, 6)]);
    let low = cord.geo.bounds().min[1];
    if low < 0.0 { cord.geo.translate(0.0, 0.2 - low, 0.0); }
    cord.bounds = true;
    out.push(cord);
    // The virtual downward emitter below the opaque central support lights the pool the shade casts.
    (out, Emitter { position: [0.0, 158.0, 0.0], colour: 0xffd4a5, range: 750.0, intensity: 281250.0,
        direction: Some(([0.0, -1.0, 0.0], PI * 0.43, 0.75)), filaments: vec![] })
}

/// The lamp `kind` (0 MITTLED puck, 1 TRIPOD, anything else the lantern) at `segments` round the lathes, fitted
/// by the uniform `scale` that `createShelfLamp` bakes into the vertices.
pub fn lamp(kind: u32, segments: usize, scale: f64) -> Vec<u8> {
    let (batches, emitter) = match kind { 0 => puck(segments), 1 => tripod(segments), _ => lantern(segments) };
    let mut packet = Packet::new();
    packet.json.push_str("{\"batches\":[");
    for (n, Batch { name, kind, mut geo, order, bounds, wall_group }) in batches.into_iter().enumerate() {
        geo.scale(scale, scale, scale);
        if n > 0 { packet.json.push(','); }
        packet.json.push_str(&format!("{{\"name\":\"{name}\",\"type\":\"{kind}\",\"bounds\":{bounds},"));
        if wall_group { packet.json.push_str(&format!("\"groups\":[[0,{},0]],", geo.index.as_ref().map_or(0, Vec::len))); }
        packet.plain(&geo, &order);
        packet.json.push('}');
    }
    let scaled = |v: Vec3| nums(&[v[0] * scale, v[1] * scale, v[2] * scale]);
    packet.json.push_str(&format!("],\"emitter\":{{\"position\":{},\"color\":{},\"intensity\":{},\"distance\":{}", scaled(emitter.position),
        emitter.colour, num(emitter.intensity * scale * scale), num(emitter.range * scale)));
    if !emitter.filaments.is_empty() {
        packet.json.push_str(",\"filaments\":[");
        for (k, (start, end, width, normal)) in emitter.filaments.iter().enumerate() {
            if k > 0 { packet.json.push(','); }
            packet.json.push_str(&format!("{{\"start\":{},\"end\":{},\"width\":{},\"normal\":{}}}", scaled(*start), scaled(*end), num(width * scale), nums(normal)));
        }
        packet.json.push(']');
    }
    if let Some((direction, angle, penumbra)) = emitter.direction {
        packet.json.push_str(&format!(",\"direction\":{},\"angle\":{},\"penumbra\":{}", nums(&direction), num(angle), num(penumbra)));
    }
    packet.json.push_str("}}");
    packet.seal()
}
