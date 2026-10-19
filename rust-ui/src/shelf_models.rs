//! A small scene graph as one packet, for the shelf's furniture props (the wastebasket, the paper catalogue):
//! every node in the order the host adds it, its parent, its material role, its geometry and its transform.
//! The host creates a `Mesh` (or a `Group` for a node without geometry) per node, binds the material of its
//! role and applies the transform; nothing else is decided host-side.
use crate::geo_packet::Packet;
use crate::three_geo::Geo;

pub const LATHE: &[&str] = &["position", "uv", "normal"];
pub const LATHE_COLOURED: &[&str] = &["position", "uv", "normal", "color"];
pub const PLAIN: &[&str] = &["position", "normal", "uv"];
pub const EXTRUDED: &[&str] = &["position", "uv", "normal"];

/// The draw groups `BoxGeometry` adds with one segment per side: six faces of two triangles, materials 0 to 5.
pub fn box_groups() -> Vec<[usize; 3]> { (0..6).map(|side| [side * 6, 6, side]).collect() }

/// The draw groups `CylinderGeometry(top, bottom, _, radial, heightSegments, openEnded)` adds: the wall (material
/// 0), then the top (1) and bottom (2) caps of a closed cylinder whose radii are positive.
pub fn cylinder_groups(top: f64, bottom: f64, radial: usize, height_segments: usize, open: bool) -> Vec<[usize; 3]> {
    let mut wall = 0;
    for y in 0..height_segments { for _ in 0..radial { if top > 0.0 || y != 0 { wall += 3; } if bottom > 0.0 || y != height_segments - 1 { wall += 3; } } }
    let mut groups = vec![[0, wall, 0]];
    let mut start = wall;
    if !open {
        for (radius, material) in [(top, 1), (bottom, 2)] { if radius > 0.0 { groups.push([start, radial * 3, material]); start += radial * 3; } }
    }
    groups
}

pub struct Node {
    pub name: String,
    /// The geometry class, `None` for a group.
    pub kind: Option<&'static str>,
    pub material: &'static str,
    pub parent: Option<usize>,
    pub geo: Geo,
    pub order: &'static [&'static str],
    pub groups: Vec<[usize; 3]>,
    pub position: [f64; 3],
    /// The Euler angles and their order, when the original set a rotation.
    pub rotation: Option<([f64; 3], &'static str)>,
    /// The scale, when the original set one.
    pub scale: Option<[f64; 3]>,
}

impl Node {
    pub fn mesh(name: impl Into<String>, kind: &'static str, material: &'static str, geo: Geo, order: &'static [&'static str]) -> Node {
        Node { name: name.into(), kind: Some(kind), material, parent: None, geo, order, groups: Vec::new(), position: [0.0; 3], rotation: None, scale: None }
    }
    pub fn group(name: impl Into<String>) -> Node {
        Node { name: name.into(), kind: None, material: "", parent: None, geo: Geo::default(), order: &[], groups: Vec::new(), position: [0.0; 3], rotation: None, scale: None }
    }
    pub fn at(mut self, position: [f64; 3]) -> Node { self.position = position; self }
    pub fn turned(mut self, rotation: [f64; 3], order: &'static str) -> Node { self.rotation = Some((rotation, order)); self }
    pub fn scaled(mut self, scale: [f64; 3]) -> Node { self.scale = Some(scale); self }
    pub fn inside(mut self, parent: usize) -> Node { self.parent = Some(parent); self }
    pub fn grouped(mut self, groups: Vec<[usize; 3]>) -> Node { self.groups = groups; self }
}

/// `{"nodes":[{name, type, material, parent, rotation, scaled, attributes, index, groups}...], "transforms":...}`:
/// nine f64 per node (position, Euler angles, scale). `materials` is the JSON of the material table, `extra` named
/// f64 arrays.
pub fn packet(nodes: &[Node], materials: &str, extra: &[(&str, &[f64])]) -> Vec<u8> {
    let mut packet = Packet::new();
    let mut transforms = Vec::with_capacity(nodes.len() * 9);
    packet.json.push_str("{\"nodes\":[");
    for (n, node) in nodes.iter().enumerate() {
        if n > 0 { packet.json.push(','); }
        let parent = node.parent.map_or("-1".to_string(), |p| p.to_string());
        let rotation = node.rotation.map_or("null".to_string(), |(_, order)| format!("\"{order}\""));
        packet.json.push_str(&format!("{{\"name\":\"{}\",\"parent\":{parent},\"rotation\":{rotation},\"scaled\":{}", node.name, node.scale.is_some()));
        if let Some(kind) = node.kind {
            packet.json.push_str(&format!(",\"type\":\"{kind}\",\"material\":\"{}\",\"groups\":[", node.material));
            for (k, [start, count, material]) in node.groups.iter().enumerate() {
                if k > 0 { packet.json.push(','); }
                packet.json.push_str(&format!("[{start},{count},{material}]"));
            }
            packet.json.push_str("],");
            packet.plain(&node.geo, node.order);
        }
        packet.json.push('}');
        transforms.extend(node.position);
        transforms.extend(node.rotation.map_or([0.0; 3], |(angles, _)| angles));
        transforms.extend(node.scale.unwrap_or([1.0; 3]));
    }
    packet.json.push_str("],\"materials\":");
    packet.json.push_str(materials);
    packet.json.push(',');
    packet.f64s("transforms", &transforms);
    for (name, values) in extra { packet.json.push(','); packet.f64s(name, values); }
    packet.json.push('}');
    packet.seal()
}
