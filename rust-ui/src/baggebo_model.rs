//! The IKEA BAGGEBO 504.811.72 as geometry: four rounded-triangle posts with feet, the folded shelf pans and
//! lips, mount tabs and fixing screws, the expanded-metal sheets and the rear brace, merged by material.
//! Coordinates are millimetres at width 600: x centred, top y = 0, feet y = -1160, front z = 0, back z = -250.
//! The model does not depend on any input, so the result is the one template the host clones.
use crate::cabinet::{BAGGEBO, FOOT_RADIUS, MESH_PITCH, POST_OUTER_CORNER_RADIUS, POST_TIP_RADIUS, REAR_BRACE};
use crate::jsmath::{self, Box3};
use crate::geo_packet::{num, nums, Packet};
use crate::mesh_compact::{self, Packed};
use crate::mesh_finish;
use crate::metal_sheet;
use crate::three_geo::{self, Geo};
use crate::three_shape::{self, Path, P2};
use js_sys::Math;
use std::f64::consts::{PI, SQRT_2};

const STRAND_WIDTH: f64 = 0.9;
const SHEET_THICKNESS: f64 = 0.65;
const SHEET_FRONT: f64 = -15.0;
const SURFACE_WIDTH: f64 = 567.5;

/// Indices into the host's `[paint, meshPaint, hardware, foot]` materials.
const PAINT: usize = 0;
const MESH_PAINT: usize = 1;
const HARDWARE: usize = 2;
const FOOT: usize = 3;




struct Part { name: String, bounds: Box3, meta: String }
enum Pieces { Solid(Vec<Geo>), Sheets(Vec<Packed>) }
struct Builder { batches: Vec<(usize, Pieces)>, parts: Vec<Part> }

impl Builder {
    fn batch(&mut self, material: usize) -> &mut Pieces {
        let at = match self.batches.iter().position(|(m, _)| *m == material) {
            Some(at) => at,
            None => { self.batches.push((material, if material == MESH_PAINT { Pieces::Sheets(Vec::new()) } else { Pieces::Solid(Vec::new()) })); self.batches.len() - 1 }
        };
        &mut self.batches[at].1
    }
    fn add(&mut self, mut geo: Geo, material: usize, name: &str, meta: &str) {
        if material == HARDWARE {
            let shade: f32 = if name.contains("-slot-") { 0.24 } else { 1.0 };
            geo.color = vec![shade; geo.count() * 3];
        }
        if material == PAINT {
            // Rounded folded edges can exceed the nominal top by f32 round-off: keep the book baseline exact.
            for y in geo.position.chunks_exact_mut(3).map(|v| &mut v[1]) { if *y > 0.0 && f64::from(*y) < 1e-6 { *y = 0.0; } }
        }
        self.parts.push(Part { name: name.to_string(), bounds: geo.bounds(), meta: meta.to_string() });
        if let Pieces::Solid(list) = self.batch(material) { list.push(geo); }
    }
    fn add_sheet(&mut self, sheet: Packed, name: &str, meta: &str) {
        let Some((_, _, mesh_compact::Attr::F32(position))) = sheet.attributes.iter().find(|(n, _, _)| *n == "position") else { unreachable!() };
        let mut bounds = Box3::empty();
        for v in position.chunks_exact(3) { bounds.expand_by_point([f64::from(v[0]), f64::from(v[1]), f64::from(v[2])]); }
        self.parts.push(Part { name: name.to_string(), bounds, meta: meta.to_string() });
        if let Pieces::Sheets(list) = self.batch(MESH_PAINT) { list.push(sheet); }
    }
    /// `box(...)`: a rounded box of the given size and radius at a position.
    #[allow(clippy::too_many_arguments)]
    fn rounded(&mut self, name: &str, w: f64, h: f64, d: f64, x: f64, y: f64, z: f64, radius: f64) {
        let r = jsmath::jmin(jsmath::jmin(jsmath::jmin(radius, w / 3.0), h / 3.0), d / 3.0);
        let mut g = three_geo::rounded_box(w, h, d, 1, r);
        g.translate(x, y, z);
        self.add(g, PAINT, name, "");
    }
    /// `screw(...)`: a slotted fixing head (and a shank when angled) along `direction`.
    fn screw(&mut self, name: &str, x: f64, y: f64, z: f64, axis: Option<[f64; 3]>, radius: f64) {
        let direction = jsmath::normalize(axis.unwrap_or([0.0, 0.0, 1.0]));
        let up = [0.0, 1.0, 0.0];
        let mut g = three_geo::cylinder(radius * 0.88, radius, 1.1, 20, 1, false, 0.0, PI * 2.0).to_non_indexed();
        g.apply_quaternion(three_geo::quaternion_from_unit_vectors(up, direction));
        g.translate(x, y, z);
        self.add(g, HARDWARE, name, &format!("\"kind\":\"screw\",\"axis\":{}", nums(&direction)));
        if axis.is_some() {
            let mut shank = three_geo::cylinder(1.15, 1.15, 3.0, 8, 1, false, 0.0, PI * 2.0).to_non_indexed();
            shank.apply_quaternion(three_geo::quaternion_from_unit_vectors(up, direction));
            shank.translate(x - direction[0] * 1.65, y, z - direction[2] * 1.65);
            self.add(shank, HARDWARE, &format!("{name}-shank"), "\"kind\":\"fixing-shank\"");
        }
        // tiny dark cross grooves remain within the fixing head's footprint
        for (label, w, h) in [("horizontal", 3.05, 0.5), ("vertical", 0.5, 3.05)] {
            let mut slot = three_geo::box_geometry(w, h, 0.08, 1, 1, 1).to_non_indexed();
            slot.apply_quaternion(three_geo::quaternion_from_unit_vectors([0.0, 0.0, 1.0], direction));
            slot.translate(x + direction[0] * 0.555, y + direction[1] * 0.555, z + direction[2] * 0.555);
            self.add(slot, HARDWARE, &format!("{name}-slot-{label}"), "");
        }
    }
}

/// `uprightProfile`: the post's cross section, a right triangle with rounded corners whose flat diagonal
/// faces the shelf; its points and the diagonal's length.
fn upright_profile() -> (Vec<P2>, f64) {
    let (outer, tip) = (POST_OUTER_CORNER_RADIUS, POST_TIP_RADIUS);
    let diagonal = BAGGEBO.post_size + SQRT_2 * tip;
    let tangent = tip / Math::tan(PI / 8.0);
    let mut shape = Path::new();
    shape.move_to([0.0, outer]);
    shape.abs_arc(outer, outer, outer, PI, PI * 1.5, false);
    shape.line_to([diagonal - tangent, 0.0]);
    shape.abs_arc(diagonal - tangent, tip, tip, PI * 1.5, PI * 2.25, false);
    shape.line_to([tip + tip / SQRT_2, diagonal - tangent + tip / SQRT_2]);
    shape.abs_arc(tip, diagonal - tangent, tip, PI / 4.0, PI, false);
    shape.close();
    (shape.points(6), diagonal)
}

/// `extrudedSheet`: a contour (with holes) extruded `thickness` and stood so the extrusion runs down from `y`.
fn extruded_sheet(points: &[P2], holes: &[Vec<P2>], thickness: f64, y: f64) -> Geo {
    // Shape(points) and Path(hole): the points through their line curves
    let contour = Path::from_points(points).points(1);
    let holes: Vec<Vec<P2>> = holes.iter().map(|h| Path::from_points(h).points(1)).collect();
    let mut g = three_shape::extrude(&contour, &holes, thickness);
    g.apply_matrix4(&jsmath::Mat4([1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, -1.0, 0.0, 0.0, 0.0, y, 0.0, 1.0]));
    g
}

/// `triangularUpright`: one post along its length; the wall normals are averaged for continuous highlights.
fn triangular_upright(points: &[P2], side: f64, front: f64, depth: f64, height: f64) -> Geo {
    let outer_z = if front > 0.0 { 0.0 } else { -depth };
    let outline: Vec<P2> = points.iter().map(|p| [side * (300.0 - p[0]), outer_z - front * p[1]]).collect();
    let mut g = extruded_sheet(&outline, &[], height, 0.0);
    mesh_finish::smooth_post_normals(&mut g);
    g
}

/// Folded pans reach the outer rails and have four 45 degree cut corners.
fn pan_outline(width: f64, depth: f64, inset: f64, diagonal: f64) -> Vec<P2> {
    let x = width / 2.0 - inset;
    let front = -inset;
    let back = -depth + inset;
    let cut = diagonal - inset * 2.0;
    vec![[-x + cut, front], [x - cut, front], [x, front - cut], [x, back + cut], [x - cut, back], [-x + cut, back], [-x, back + cut], [-x, front - cut]]
}

fn sheet_packed(g: &Geo) -> Packed { mesh_compact::compact(g, &["position", "uv", "normal"]) }

/// The 32 x 32 fine powder-coat grain (RGBA bytes): a deterministic integer hash of the texel index.
pub fn paint_texture() -> Vec<u8> {
    (0..1024u32).flat_map(|index| {
        let grain = 122 + (index.wrapping_add(31).wrapping_mul(1664525) ^ index.wrapping_add(17).wrapping_mul(1013904223)) % 14;
        [grain as u8, grain as u8, grain as u8, 255]
    }).collect()
}

/// The whole template as a packet: a JSON header and the typed data it points into.
pub fn template() -> Vec<u8> {
    let (depth, height) = (BAGGEBO.depth, BAGGEBO.height);
    let rim = BAGGEBO.shelf_rim_height;
    let mut b = Builder { batches: Vec::new(), parts: Vec::new() };
    let (profile, diagonal) = upright_profile();
    let foot_radius = FOOT_RADIUS;
    // Four continuous slender uprights and the manual's small adjustable feet.
    for side in [-1.0f64, 1.0] {
        for (label, front) in [("front", 1.0f64), ("back", -1.0f64)] {
            let x = side * (300.0 - foot_radius);
            let z = (if front > 0.0 { 0.0 } else { -depth }) - front * foot_radius;
            let hand = if side < 0.0 { "left" } else { "right" };
            b.add(triangular_upright(&profile, side, front, depth, height - 7.0), PAINT, &format!("{hand}-{label}-upright"),
                &format!("\"kind\":\"upright\",\"profile\":\"rounded-right-triangle\",\"diagonal\":{},\"inwardNormal\":{}", num(diagonal),
                    nums(&[-side / SQRT_2, 0.0, -front / SQRT_2])));
            let mut foot = three_geo::cylinder(foot_radius - 0.25, foot_radius, 4.8, 24, 1, false, 0.0, PI * 2.0).to_non_indexed();
            foot.translate(x, -height + 2.4, z);
            b.add(foot, FOOT, &format!("{hand}-{label}-foot"), "\"kind\":\"foot\"");
            let mut stem = three_geo::cylinder(2.8, 2.8, 2.2, 8, 1, false, 0.0, PI * 2.0).to_non_indexed();
            stem.translate(x, -height + 5.9, z);
            b.add(stem, HARDWARE, &format!("{hand}-{label}-adjustment-stem"), "\"kind\":\"foot-stem\"");
        }
    }
    let pan_inset = 0.65;
    let pan_wall = 1.1;
    let pan_diagonal = diagonal + 0.75;
    let outside = pan_outline(600.0, depth, pan_inset, pan_diagonal);
    let inside = pan_outline(600.0, depth, pan_inset + pan_wall, pan_diagonal + pan_wall * SQRT_2);
    let aperture: Vec<P2> = vec![[-SURFACE_WIDTH / 2.0, SHEET_FRONT], [-SURFACE_WIDTH / 2.0, -235.0], [SURFACE_WIDTH / 2.0, -235.0], [SURFACE_WIDTH / 2.0, SHEET_FRONT]];
    // The horizontal sheet is one template reused (translated) by the top and every shelf.
    let horizontal = {
        let g = metal_sheet::expanded_metal(&[-SURFACE_WIDTH / 2.0, SURFACE_WIDTH / 2.0, -SHEET_FRONT, 220.0 - SHEET_FRONT, MESH_PITCH[0], MESH_PITCH[1], STRAND_WIDTH, SHEET_THICKNESS, 0.0], 0);
        sheet_packed(&g)
    };
    let shelf_bottoms: Vec<f64> = std::iter::once(0.0).chain(BAGGEBO.shelf_bottoms.iter().copied()).collect();
    for (index, &bottom) in shelf_bottoms.iter().enumerate() {
        let name = if index == 0 { "top".to_string() } else { format!("shelf-{}", index - 1) };
        let y = -bottom;
        // Folded steel rims are beneath the mesh baseline, leaving books seated at the source model's elevations.
        b.add(extruded_sheet(&outside, &[inside.clone()], rim, y), PAINT, &format!("{name}-folded-perimeter-rim"),
            &format!("\"kind\":\"shelf-rim\",\"cornerCut\":{},\"outline\":[{}]", num(pan_diagonal), outside.iter().map(|p| nums(p)).collect::<Vec<_>>().join(",")));
        // A continuous folded flange covers the edge of the cut mesh.
        b.add(extruded_sheet(&outside, &[aperture.clone()], 0.8, y), PAINT, &format!("{name}-folded-lip"), "\"kind\":\"folded-lip\"");
        for side in [-1.0f64, 1.0] {
            for (label, front) in [("front", 1.0f64), ("back", -1.0f64)] {
                let normal = [-side / SQRT_2, 0.0, -front / SQRT_2];
                let fixing_inset = (pan_diagonal + pan_wall * SQRT_2) / 2.0 + 0.4;
                let x = side * (300.0 - fixing_inset);
                let z = (if front > 0.0 { 0.0 } else { -depth }) - front * fixing_inset;
                let hand = if side < 0.0 { "left" } else { "right" };
                let mut tab = three_geo::rounded_box(9.0, 14.0, 1.2, 1, 0.25);
                tab.rotate_y(Math::atan2(normal[0], normal[2]));
                tab.translate(x - normal[0] * 1.65, y - 9.0, z - normal[2] * 1.65);
                b.add(tab, PAINT, &format!("{name}-{hand}-{label}-mount-tab"), &format!("\"kind\":\"mount-tab\",\"axis\":{}", nums(&normal)));
                b.screw(&format!("{name}-{hand}-{label}-fixing"), x, y - 9.0, z, Some(normal), 2.55);
            }
        }
        // A genuine central reinforcing strip under each expanded-metal panel.
        b.rounded(&format!("{name}-underside-stiffener"), 3.5, 3.0, 216.0, 0.0, y - 2.25, -depth / 2.0, 0.3);
        let mut sheet = clone_packed(&horizontal);
        sheet.translate(0.0, y, 0.0);
        b.add_sheet(sheet, &format!("{name}-mesh"), &format!("\"kind\":\"{}\",\"baseline\":{},\"thickness\":{},\"apertureGeometry\":true",
            if index == 0 { "mesh-top" } else { "mesh-shelf" }, num(y), num(SHEET_THICKNESS)));
    }
    let brace = REAR_BRACE; // width, height, top, bottom
    let brace_z = -249.0;
    // The brace is cut from the same expanded sheet, turned a quarter turn.
    let rear = sheet_packed(&metal_sheet::expanded_metal(&[brace[2], brace[2] + brace[1], -brace[0] / 2.0, brace[0] / 2.0, MESH_PITCH[0], MESH_PITCH[1], STRAND_WIDTH, SHEET_THICKNESS, brace_z], 1));
    b.add_sheet(rear, "rear-central-mesh-brace", &format!("\"kind\":\"mesh-brace\",\"thickness\":{},\"apertureGeometry\":true", num(SHEET_THICKNESS)));
    for side in [-1.0f64, 1.0] {
        let tag = if side < 0.0 { "left" } else { "right" };
        b.rounded(&format!("rear-brace-{tag}-fold"), 2.2, brace[1], 2.0, side * (brace[0] / 2.0 - 1.1), -(brace[2] + brace[1] / 2.0), brace_z, 0.3);
        for top in [brace[2] + 6.0, brace[3] - 6.0] {
            b.screw(&format!("rear-brace-{}-{}-fixing", num(side), num(top)), side * 94.0, -top, -247.3, None, 2.55);
        }
    }
    for top in [brace[2] + 1.0, brace[3] - 1.0] {
        b.rounded(&format!("rear-brace-{}-edge", num(top)), brace[0], 2.0, 2.0, 0.0, -top, brace_z, 0.3);
    }
    // Pair of small wall attachment tabs shown under the top rear rail.
    for side in [-1.0f64, 1.0] {
        b.rounded(&format!("wall-tab-{}", num(side)), 10.0, 20.0, 1.2, side * 90.0, -27.0, -248.9, 0.35);
        b.screw(&format!("wall-tab-{}-fixing", num(side)), side * 90.0, -33.0, -247.8, None, 1.8);
    }
    finish(b)
}

fn clone_packed(p: &Packed) -> Packed {
    use mesh_compact::Attr;
    Packed { attributes: p.attributes.iter().map(|(n, s, a)| (*n, *s, match a { Attr::F32(v) => Attr::F32(v.clone()), Attr::I16(v) => Attr::I16(v.clone()), Attr::U8(v) => Attr::U8(v.clone()) })).collect(), index: p.index.clone() }
}

/// Merge each material's pieces, finish them (paint UVs, compaction) and write the packet.
fn finish(builder: Builder) -> Vec<u8> {
    let Builder { batches, parts } = builder;
    let mut packet = Packet::new();
    packet.json.push_str("{\"batches\":[");
    for (n, (material, pieces)) in batches.into_iter().enumerate() {
        let packed = match pieces {
            Pieces::Solid(mut list) => {
                if material == PAINT { for g in list.iter_mut() { mesh_finish::physical_paint_uvs(g); } }
                let order: &[&'static str] = if list[0].color.is_empty() { if material == PAINT { &["position", "uv", "normal"] } else { &["position", "normal", "uv"] } } else { &["position", "normal", "uv", "color"] };
                mesh_compact::compact(&three_geo::merge(&list), order)
            }
            Pieces::Sheets(list) => mesh_compact::merge(list),
        };
        if n > 0 { packet.json.push(','); }
        packet.json.push_str(&format!("{{\"material\":{material},"));
        packet.packed(&packed);
        packet.json.push('}');
    }
    packet.json.push_str("],\"parts\":[");
    for (n, part) in parts.iter().enumerate() {
        if n > 0 { packet.json.push(','); }
        packet.json.push_str(&format!("{{\"name\":\"{}\",\"box\":{}", part.name, nums(&[part.bounds.min[0], part.bounds.min[1], part.bounds.min[2], part.bounds.max[0], part.bounds.max[1], part.bounds.max[2]])));
        if !part.meta.is_empty() { packet.json.push(','); packet.json.push_str(&part.meta); }
        packet.json.push('}');
    }
    packet.json.push_str("]}");
    packet.seal()
}
