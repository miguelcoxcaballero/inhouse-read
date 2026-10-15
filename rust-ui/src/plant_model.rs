//! A shelf plant as `createShelfPlant` built it: the pot (with its saucer or seam), the foliage of its variety grown
//! from the plant's PRNG, the potting soil, the parts merged by material, the foliage fitted to the promised envelope
//! and the whole as a baked scene (every object in creation order with its place, transform, role and geometry).
//! The host makes the materials and the objects from it.
use crate::geo_packet::{num, nums, Packet};
use crate::jsmath::{self, jmax, jmin, Box3, Mat4, Vec3};
use crate::plant_parts::*;
use crate::three_curve::{quaternion_from_axis_angle, quaternion_from_euler, quaternion_multiply, CatmullRom};
use crate::three_geo::{self, quaternion_from_unit_vectors, Geo};
use crate::three_math::{add, add_scaled, apply_quaternion, dot, euler_from_quaternion, lerp, project_on_plane, scale};
use js_sys::Math;
use std::f64::consts::PI;

const UP: Vec3 = [0.0, 1.0, 0.0];
const GOLDEN: f64 = 2.39996;

#[derive(Clone, Copy, PartialEq, Eq)]
enum Role { Clay = 0, Soil = 1, Leaf = 2, Stem = 3, Mineral = 4, Green = 5, Needles = 6 }
const ROLE_NAMES: [&str; 7] = ["clay", "soil", "leaf", "stem", "mineral", "green", "needles"];

#[derive(Clone, Copy, PartialEq, Eq)]
enum Kind { Mesh, Lines, Group }

/// One object of the scene: three's `position`, `quaternion`, `scale` and the geometry it draws.
struct Obj {
    name: String, kind: Kind, role: Role, built: Option<Built>,
    position: Vec3, quaternion: [f64; 4], touched: bool, euler: Option<[f64; 3]>, scale: Vec3,
    parent: usize, children: Vec<usize>, shadows: bool, batch_parts: Option<Vec<String>>, alive: bool,
}

struct Scene { objs: Vec<Obj> }
impl Scene {
    fn new() -> Scene {
        let content = Obj { name: String::new(), kind: Kind::Group, role: Role::Clay, built: None, position: [0.0; 3], quaternion: [0.0, 0.0, 0.0, 1.0], touched: false,
            euler: None, scale: [1.0; 3], parent: 0, children: Vec::new(), shadows: false, batch_parts: None, alive: true };
        Scene { objs: vec![content] }
    }
    fn add(&mut self, parent: usize, name: &str, kind: Kind, role: Role, built: Option<Built>, shadows: bool) -> usize {
        let id = self.objs.len();
        self.objs.push(Obj { name: name.to_string(), kind, role, built, position: [0.0; 3], quaternion: [0.0, 0.0, 0.0, 1.0], touched: false, euler: None, scale: [1.0; 3],
            parent, children: Vec::new(), shadows, batch_parts: None, alive: true });
        self.objs[parent].children.push(id);
        id
    }
    /// `mesh(geometry, material, name)`: a shadow-casting mesh added to the content.
    fn mesh(&mut self, built: Built, role: Role, name: &str) -> usize { self.add(0, name, Kind::Mesh, role, Some(built), true) }
    fn local_matrix(&self, id: usize) -> Mat4 { let o = &self.objs[id]; Mat4::compose(o.position, o.quaternion, o.scale) }
    /// `Box3#setFromObject(object)`: the boxes of the geometries under it, each taken through its world matrix.
    fn world_box(&self, id: usize, parent_world: &Mat4, into: &mut Box3) {
        let world = Mat4::multiply(parent_world, &self.local_matrix(id));
        if let Some(built) = &self.objs[id].built {
            let mut b = built.geo.bounds();
            b.apply(&world);
            into.union(&b);
        }
        for &child in &self.objs[id].children { if self.objs[child].alive { self.world_box(child, &world, into); } }
    }
}

/// What the host gives a plant.
pub struct Plant<'a> {
    pub seed: &'a [u16], pub skip: usize, pub variant: Variant, pub catalog: bool, pub detailed: bool,
    pub pot_id: &'a str, pub pot_model: &'a str,
    pub width: f64, pub radius: f64, pub pot_height: f64, pub soil_fraction: f64, pub above: f64, pub growth_height: f64, pub height: f64,
}

struct Builder<'a> {
    p: &'a Plant<'a>, rng: Rng, scene: Scene, roots: Vec<Vec3>, soil_y: f64, sink: f64,
}

impl Builder<'_> {
    /// `stem(path, r, name, options)`: a tube along the curve, rooted in the soil when it enters it.
    fn stem(&mut self, curve: &CatmullRom, r: f64, name: &str, tubular: usize, radial: usize, tone: Tone, taper: [f64; 2]) -> usize {
        let built = stem_geometry(curve, r, tubular, radial, tone, taper);
        let first = curve.point_at(0.0);
        // Only stems that enter the soil root the plant (not petioles on hanging vines).
        if first[1] <= self.soil_y + 1e-6 && Math::hypot(first[0], first[2]) < self.p.radius * 0.9 { self.roots.push([first[0], first[2], r * taper[0]]); }
        self.scene.mesh(built, Role::Stem, name)
    }
    fn stem_path(&mut self, path: &[Vec3], r: f64, name: &str, tubular: usize, radial: usize, tone: Tone, taper: [f64; 2]) -> usize {
        let curve = CatmullRom::new(path.to_vec());
        self.stem(&curve, r, name, tubular, radial, tone, taper)
    }

    /// `blade(position, direction, length, width, angle, curve, twist, index, facing)`: one leaf, oriented along
    /// `direction`, rolled about its midrib, with the raised rib of the broad varieties.
    #[allow(clippy::too_many_arguments)]
    fn blade(&mut self, position: Vec3, direction: Vec3, length: f64, leaf_width: f64, angle: f64, curve: f64, twist: f64, index: usize, facing: Option<Vec3>) -> usize {
        let variant = self.p.variant;
        let built = if variant == Variant::Ivy { ivy_leaf_geometry(length, leaf_width, curve, &mut self.rng) }
            else if self.p.catalog && variant == Variant::Monstera { monstera_leaf_geometry(length, leaf_width, curve, &mut self.rng) }
            else { leaf_geometry(length, leaf_width, variant, curve, twist, &mut self.rng, self.p.detailed) };
        let leaf = self.scene.mesh(built, Role::Leaf, &format!("leaf-{index}"));
        let axis = jsmath::normalize(direction);
        self.scene.objs[leaf].position = position;
        let mut q = quaternion_from_unit_vectors(UP, axis);
        let mut roll = angle;
        if let Some(facing) = facing {
            // Turn the lamina about its own midrib until it faces the light.
            let target = project_on_plane(facing, axis);
            if jsmath::length_sq(target) > 1e-8 {
                roll += Math::atan2(dot(target, apply_quaternion([1.0, 0.0, 0.0], q)), dot(target, apply_quaternion([0.0, 0.0, 1.0], q)));
            }
        }
        q = quaternion_multiply(q, quaternion_from_axis_angle(UP, roll));
        let object = &mut self.scene.objs[leaf];
        object.quaternion = q;
        object.touched = true;
        if position[1] <= self.soil_y && Math::hypot(position[0], position[2]) < self.p.radius * 0.9 { self.roots.push([position[0], position[2], leaf_width * 0.3]); }
        if variant == Variant::Monstera || variant == Variant::Leafy {
            // The raised midrib follows the lamina it sits on, from the notch to just short of the tip.
            let rib = self.p.width * 0.0015;
            let carved = self.p.catalog && variant == Variant::Monstera;
            let along = |f: f64| -> Vec3 {
                if carved { [0.0, f * 0.78 * length, Math::sin((0.12 + f * 0.78) * PI) * length * curve + rib * 0.5] }
                else { blade_point(f, 0.0, length, leaf_width, variant, curve, twist) }
            };
            let path: Vec<Vec3> = [0.0, 0.2, 0.43, 0.67, 0.9].iter().map(|&f| add(apply_quaternion(along(f), q), position)).collect();
            self.stem_path(&path, rib, &format!("leaf-vein-{index}"), 6, 4, Tone::Vein, [1.3, 0.5]);
        }
        leaf
    }

    fn radial(angle: f64) -> Vec3 { [Math::cos(angle), 0.0, Math::sin(angle)] }

    fn cactus(&mut self) {
        let width = self.p.width;
        let mut spikes: Vec<f64> = Vec::new();
        let columns = [(0.0, 0.0, self.p.growth_height * 0.71, width * 0.12), (-width * 0.16, width * 0.03, self.p.growth_height * 0.47, width * 0.085),
            (width * 0.165, -width * 0.055, self.p.growth_height * 0.36, width * 0.083)];
        for (index, &(cx, cz, length, radius)) in columns.iter().enumerate() {
            let bend = (self.rng.next() - 0.5) * width * 0.09;
            let base = self.soil_y - length * 0.06;
            // The column enters the grit at full girth instead of resting on a rounded foot.
            let trunk = self.scene.mesh(cactus_geometry(length, radius, bend, &mut self.rng), Role::Green, &format!("cactus-column-{index}"));
            self.scene.objs[trunk].position = [cx, base, cz];
            self.roots.push([cx, cz, radius]);
            for row in 1..7 {
                for ridge in 0..8 {
                    let f = row as f64 / 8.0;
                    let angle = ridge as f64 / 8.0 * PI * 2.0;
                    let radius_at = radius * cactus_cap(f);
                    let p = [cx + Math::cos(angle) * radius_at + bend * f * f, base + length * f, cz + Math::sin(angle) * radius_at];
                    let areole = self.scene.mesh(areole_geometry(width), Role::Mineral, &format!("cactus-areole-{index}-{row}-{ridge}"));
                    self.scene.objs[areole].position = p;
                    self.scene.objs[areole].scale = [1.0, 0.8, 1.0];
                    for tilt in [-1.0, -0.45, 0.0, 0.45, 1.0] {
                        let tip = add(p, [Math::cos(angle) * width * 0.023, width * 0.018 * tilt, Math::sin(angle) * width * 0.023]);
                        spikes.extend(p);
                        spikes.extend(tip);
                    }
                }
            }
        }
        let mut geo = Geo::default();
        geo.position = three_geo::f32s(&spikes);
        let lines = self.scene.add(0, "cactus-areoles", Kind::Lines, Role::Needles, Some(Built { geo, kind: "BufferGeometry", order: POS_ONLY, groups: Vec::new(), fenestrations: false }), false);
        let _ = lines;
    }

    fn upright(&mut self) {
        let (width, catalog) = (self.p.width, self.p.catalog);
        for i in 0..8usize {
            let angle = i as f64 * GOLDEN;
            let spread = width * (0.045 + (i % 3) as f64 * 0.028);
            let position = [Math::cos(angle) * spread, self.soil_y - self.sink, Math::sin(angle) * spread];
            let direction = [Math::cos(angle) * (0.06 + (i % 3) as f64 * 0.035), 1.0, Math::sin(angle) * 0.055];
            let length = self.p.growth_height * if i == 0 { 0.74 } else { 0.50 + self.rng.next() * 0.21 };
            let leaf_width = width * if catalog { 0.29 + self.rng.next() * 0.075 } else { 0.24 + self.rng.next() * 0.055 };
            let roll = if catalog { ((i % 3) as f64 - 1.0) * 0.38 } else { angle * 0.38 };
            let curve = 0.035 + self.rng.next() * 0.03;
            let twist = (self.rng.next() - 0.5) * 0.22;
            self.blade(position, direction, length, leaf_width, roll, curve, twist, i, None);
        }
    }

    fn succulent(&mut self) {
        let (width, catalog, radius, above, pot_height) = (self.p.width, self.p.catalog, self.p.radius, self.p.above, self.p.pot_height);
        let count = if catalog { 27 } else { 9 };
        // An Echeveria rosette in four tiers, sized to the pot: flat outer leaves rest over the lip, inner ones close
        // into a tight cone. Only a very tall envelope lifts it on an aged, woody stem.
        let leaf = jmin(jmin(radius * 1.55, above * 0.75), width * 0.45);
        let crown = if catalog { self.soil_y + jmax((pot_height - self.soil_y) * 0.75, jmin(above * 0.4, above - leaf * 1.85)) } else { self.soil_y };
        if catalog {
            self.stem_path(&[[0.0, self.soil_y - self.sink, 0.0], [width * 0.012, (self.soil_y + crown) / 2.0, 0.0], [0.0, crown, 0.0]], width * 0.034, "succulent-stem", 4, 6, Tone::Woody, [1.15, 0.85]);
        }
        for i in 0..count {
            let tier = if catalog { if i < 12 { 0 } else if i < 20 { 1 } else if i < 25 { 2 } else { 3 } } else { 0 };
            let angle = i as f64 * GOLDEN;
            let ring = if catalog { [0.95, 0.72, 0.42, 0.2][tier] } else if i < 5 { 0.55 } else { 0.22 };
            let direction = [Math::cos(angle) * ring, if catalog { [0.4, 0.85, 1.6, 3.2][tier] } else { 0.65 + (i % 3) as f64 * 0.10 }, Math::sin(angle) * ring];
            let size = if catalog { 0.92 + self.rng.next() * 0.16 } else { 1.0 };
            // Each fleshy leaf keeps its concave upper face turned to the sky.
            let position = [Math::cos(angle) * width * 0.02, crown + if catalog { tier as f64 * leaf * 0.1 } else { 0.0 }, Math::sin(angle) * width * 0.02];
            let length = if catalog { leaf * [1.0, 0.92, 0.8, 0.62][tier] * size } else { self.p.growth_height * if i < 5 { 0.58 } else { 0.51 } };
            let leaf_width = if catalog { leaf * [0.62, 0.58, 0.5, 0.42][tier] * size } else { width * (0.22 + self.rng.next() * 0.035) };
            let roll = if catalog { 0.0 } else { angle };
            let curve = if catalog { 0.05 } else { 0.09 };
            let twist = (self.rng.next() - 0.5) * 0.16;
            self.blade(position, direction, length, leaf_width, roll, curve, twist, i, if catalog { Some(UP) } else { None });
        }
    }

    fn palm(&mut self) {
        let (width, above, growth) = (self.p.width, self.p.above, self.p.growth_height);
        let (fronds, pairs) = (10usize, 11usize);
        let mut index = 0;
        for i in 0..fronds {
            let angle = i as f64 * GOLDEN + self.rng.next() * 0.25;
            let radial = Self::radial(angle);
            let lateral = [-radial[2], 0.0, radial[0]];
            let mut root = scale(radial, width * 0.035);
            root[1] = self.soil_y - self.sink;
            let reach = width * 0.34 * (0.72 + self.rng.next() * 0.28);
            let apex = above * (0.4 + (i % 4) as f64 * 0.15 + self.rng.next() * 0.05);
            let curve = CatmullRom::new(vec![root,
                add(add(root, scale(radial, reach * 0.16)), [0.0, apex * 0.61, 0.0]),
                add(add(root, scale(radial, reach * 0.57)), [0.0, apex, 0.0]),
                add(add(root, scale(radial, reach)), [0.0, apex * 0.59, 0.0])]);
            self.stem(&curve, width * 0.0042, &format!("palm-rachis-{i}"), 12, 5, Tone::Palm, [1.25, 0.45]);
            for p in 0..pairs {
                let f = 0.21 + p as f64 / (pairs - 1) as f64 * 0.71;
                let at = curve.point(f);
                let taper = Math::pow(Math::sin((0.14 + p as f64 / (pairs - 1) as f64 * 0.79) * PI), 0.60);
                let size = 0.88 + self.rng.next() * 0.24;
                for side in [-1.0f64, 1.0] {
                    let mut direction = add(scale(lateral, side * 0.74), scale(radial, 0.38));
                    direction[1] = -0.17 - p as f64 / pairs as f64 * 0.27;
                    let twist = (self.rng.next() - 0.5) * 0.12;
                    self.blade(at, direction, growth * 0.225 * taper * size, width * 0.030 * taper, side * 0.18, 0.13, twist, index, None);
                    index += 1;
                }
            }
            self.blade(curve.point(0.90), curve.tangent(0.92), growth * 0.075, width * 0.026, 0.0, 0.065, 0.0, index, None);
            index += 1;
        }
    }

    fn fern(&mut self) {
        let (width, above, growth) = (self.p.width, self.p.above, self.p.growth_height);
        let (fronds, pairs) = (18usize, 18usize);
        let sky = [0.0, 1.0, 0.35];
        let mut index = 0;
        for i in 0..fronds {
            let young = i < 4;
            let angle = i as f64 * GOLDEN + self.rng.next() * 0.3;
            let radial = Self::radial(angle);
            let mut root = scale(radial, width * 0.03);
            root[1] = self.soil_y - self.sink;
            let reach = width * (if young { 0.17 } else { 0.38 }) * (0.8 + self.rng.next() * 0.25);
            let apex = above * if young { 0.78 + self.rng.next() * 0.1 } else { 0.46 + self.rng.next() * 0.2 };
            let drop = if young { apex * 0.9 } else { apex * (0.25 + self.rng.next() * 0.35) };
            let curve = CatmullRom::new(vec![root,
                add(add(root, scale(radial, reach * 0.12)), [0.0, apex * 0.6, 0.0]),
                add(add(root, scale(radial, reach * 0.55)), [0.0, apex, 0.0]),
                add(add(root, scale(radial, reach)), [0.0, drop, 0.0])]);
            self.stem(&curve, width * 0.0036, &format!("fern-rachis-{i}"), 14, 3, Tone::Fern, [1.2, 0.35]);
            for p in 0..pairs {
                let f = 0.1 + p as f64 / (pairs - 1) as f64 * 0.86;
                let taper = Math::pow(Math::sin((0.1 + p as f64 / (pairs - 1) as f64 * 0.86) * PI), 0.55);
                let tangent = curve.tangent_at(f);
                let mut side = jsmath::normalize(jsmath::cross(tangent, UP));
                if jsmath::length_sq(side) < 0.5 { side = jsmath::normalize(jsmath::cross(radial, UP)); }
                for hand in [-1.0f64, 1.0] {
                    let at = curve.point_at(jmin(1.0, f + if hand > 0.0 { 0.012 } else { 0.0 }));
                    let mut direction = add(scale(side, hand * 0.88), scale(tangent, 0.4));
                    direction[1] -= 0.05;
                    let length = growth * 0.105 * taper * (0.88 + self.rng.next() * 0.24);
                    let twist = (self.rng.next() - 0.5) * 0.2;
                    self.blade(at, direction, length, width * 0.03 * taper, 0.0, 0.06, twist, index, Some(sky));
                    index += 1;
                }
            }
            self.blade(curve.point_at(0.97), curve.tangent_at(0.97), growth * 0.05, width * 0.02, 0.0, 0.05, 0.0, index, Some(sky));
            index += 1;
        }
    }

    fn zz(&mut self) {
        let (width, growth) = (self.p.width, self.p.growth_height);
        let mut index = 0;
        for i in 0..6usize {
            let angle = i as f64 * GOLDEN;
            let radial = Self::radial(angle);
            let side_axis = [-radial[2], 0.0, radial[0]];
            let mut root = scale(radial, width * 0.065);
            root[1] = self.soil_y - self.sink;
            let length = growth * (0.49 + self.rng.next() * 0.22);
            let endpoint = add(add(root, scale(radial, width * (0.08 + self.rng.next() * 0.12))), [0.0, length, 0.0]);
            let curve = CatmullRom::new(vec![root, add(lerp(root, endpoint, 0.50), scale(radial, -width * 0.04)), endpoint]);
            // Zamioculcas petioles swell into a bulbous base at the soil.
            self.stem(&curve, width * 0.011, &format!("zamioculcas-stem-{i}"), 12, 6, Tone::Zz, [1.45, 0.7]);
            for pair in 0..5usize {
                for side in [-1.0f64, 1.0] {
                    let f = 0.28 + pair as f64 * 0.135;
                    let at = curve.point(f);
                    let axis = add(add(scale(side_axis, side * 0.66), scale(radial, 0.24)), [0.0, 0.61, 0.0]);
                    let size = (1.0 - pair as f64 * 0.07) * (0.92 + self.rng.next() * 0.16);
                    let twist = (self.rng.next() - 0.5) * 0.15;
                    self.blade(at, axis, growth * 0.17 * size, width * 0.15 * size, side * 0.2, 0.07, twist, index, None);
                    index += 1;
                }
            }
            self.blade(curve.point(0.94), [radial[0] * 0.3, 1.0, radial[2] * 0.3], growth * 0.12, width * 0.12, 0.0, 0.05, 0.0, index, None);
            index += 1;
        }
    }

    fn ivy(&mut self) {
        let (width, above, growth, pot_height, radius) = (self.p.width, self.p.above, self.p.growth_height, self.p.pot_height, self.p.radius);
        // Hedera as it grows in a pot: a dense mound of short arching shoots over the soil, longer shoots that lean out and
        // nod over at the tip, and vines spilling over the rim. Leaves alternate on short petioles, broad low on each
        // shoot and smaller towards the growing tip.
        let unit = jmin(width * 0.26, growth * 0.12);
        let sky = [0.0, 0.5, 0.55];
        let soil_y = self.soil_y;
        let mut index = 0usize;
        let mut vine = 0usize;
        // [out, height, sway]: a gentle zigzag from node to node, as ivy grows.
        let mut shoot = |b: &mut Builder, angle: f64, path: &[[f64; 3]], leaves: usize, size: f64, from: f64| {
            let radial = Builder::radial(angle);
            let across = [-radial[2], 0.0, radial[0]];
            let mut root = scale(radial, width * 0.04);
            root[1] = soil_y - b.sink;
            let mut points = vec![root];
            for &[r, y, sway] in path { points.push(add(add_scaled(scale(radial, r), across, sway), [0.0, y, 0.0])); }
            let curve = CatmullRom::new(points);
            b.stem(&curve, width * 0.0042, &format!("ivy-vine-{vine}"), 12, 4, Tone::Ivy, [1.1, 0.55]);
            vine += 1;
            for j in 0..leaves {
                // Internodes shorten towards the tip.
                let f = from + (1.0 - from) * Math::pow((j as f64 + 0.35 + b.rng.next() * 0.3) / leaves as f64, 0.85);
                let tangent = curve.tangent_at(f);
                let mut side = jsmath::cross(tangent, UP);
                if jsmath::length_sq(side) < 1e-4 { side = jsmath::cross(radial, UP); }
                side = jsmath::normalize(side);
                let axis = jsmath::normalize(add(add(scale(side, if j % 2 == 1 { 0.78 } else { -0.78 }), scale(radial, 0.42)), [0.0, 0.5, 0.0]));
                let leaf_scale = size * (1.08 - 0.62 * Math::pow(f, 1.4)) * (0.86 + b.rng.next() * 0.28);
                // A short petiole holds each blade clear of the vine.
                let at = curve.point_at(f);
                let base = add_scaled(at, axis, unit * 0.38 * leaf_scale);
                b.stem_path(&[at, add(lerp(at, base, 0.5), [0.0, unit * 0.06, 0.0]), base], width * 0.0022, &format!("ivy-petiole-{index}"), 2, 3, Tone::Ivy, [1.0, 1.0]);
                let twist = (b.rng.next() - 0.5) * 0.3;
                b.blade(base, axis, unit * leaf_scale, unit * 1.08 * leaf_scale, 0.0, 0.07, twist, index, Some(add(scale(radial, 0.8), sky)));
                index += 1;
            }
        };
        let lip = radius * 1.04;
        let turn = self.rng.next() * PI * 2.0;
        // Low mound: short shoots arch up and out over the soil.
        for i in 0..6 {
            let rise = above * (0.16 + self.rng.next() * 0.12);
            let out = width * (0.2 + self.rng.next() * 0.1);
            shoot(self, turn + i as f64 * GOLDEN, &[[out * 0.35, soil_y + rise * 0.8, 0.0], [out * 0.75, soil_y + rise, 0.0], [out, soil_y + rise * 0.7, 0.0]], 5, 1.05, 0.2);
        }
        // Longer shoots lean out in every direction and nod over at the tip, giving an open, rounded crown.
        for k in 0..4usize {
            let peak = above * (0.97 - k as f64 * 0.11) * (0.94 + self.rng.next() * 0.08);
            let lean = width * (0.2 + self.rng.next() * 0.05);
            let sway = width * 0.035 * if k % 2 == 1 { 1.0 } else { -1.0 };
            let angle = turn + 0.5 + k as f64 * PI / 2.0 + (self.rng.next() - 0.5) * 0.5;
            shoot(self, angle, &[[lean * 0.45, soil_y + peak * 0.38, sway], [lean * 0.85, soil_y + peak * 0.74, -sway], [lean * 1.1, soil_y + peak, sway * 0.6], [lean * 1.4, soil_y + peak * 0.9, 0.0]], 11 - (k >> 1), 1.08, 0.14);
        }
        // Vines spill over the rim and hang down the pot.
        for i in 0..6 {
            let drop = pot_height * (0.1 + self.rng.next() * 0.35);
            let spill = width * (0.09 + self.rng.next() * 0.06);
            shoot(self, turn + 1.3 + i as f64 * GOLDEN, &[[width * 0.1, soil_y + growth * 0.06, 0.0], [lip + width * 0.03, pot_height + growth * 0.03, 0.0],
                [lip + width * 0.07, (pot_height + drop) * 0.6, 0.0], [lip + spill, drop, 0.0]], 6, 0.92, 0.22);
        }
    }

    fn leafy(&mut self) {
        // A pothos grows along bent vines. Vary the leaf levels and include two lower, hanging hearts instead of
        // arranging all leaves as an upright fan.
        let (width, growth) = (self.p.width, self.p.growth_height);
        let leaves: [(f64, f64, f64, [f64; 3], f64, f64); 8] = [
            (0.0, -0.04, 0.33, [0.04, 1.0, 0.04], 0.38, 0.44), (-0.16, -0.08, 0.24, [-0.48, 0.88, 0.05], 0.35, 0.45),
            (0.16, -0.07, 0.21, [0.50, 0.85, 0.07], 0.35, 0.45), (-0.17, 0.04, 0.17, [-0.70, 0.62, 0.10], 0.32, 0.43),
            (0.16, 0.06, 0.15, [0.73, 0.60, 0.12], 0.31, 0.42), (-0.20, 0.12, 0.18, [-0.53, -0.68, 0.15], 0.25, 0.38),
            (0.20, 0.10, 0.20, [0.52, -0.66, 0.13], 0.26, 0.39), (0.025, -0.13, 0.28, [-0.12, 0.96, -0.18], 0.30, 0.34)];
        for (i, &(x, z, y, axis, length, leaf_width)) in leaves.iter().enumerate() {
            let endpoint = [x * width, self.soil_y + y * growth, z * width];
            let root = [x * width * 0.13, self.soil_y - self.sink, z * width * 0.13];
            let middle = [endpoint[0] * 0.42, self.soil_y + growth * if i == 5 || i == 6 { 0.26 } else { y * 0.65 }, endpoint[2] * 0.45];
            self.stem_path(&[root, middle, endpoint], width * 0.008, &format!("petiole-{i}"), 8, 4, Tone::Petiole, [1.0, 1.0]);
            let roll = (self.rng.next() - 0.5) * 0.36;
            let curve = 0.08 + self.rng.next() * 0.05;
            let twist = (self.rng.next() - 0.5) * 0.26;
            self.blade(endpoint, axis, growth * length, width * leaf_width, roll, curve, twist, i, None);
        }
    }

    fn monstera(&mut self) {
        let (width, growth) = (self.p.width, self.p.growth_height);
        for i in 0..5usize {
            let angle = i as f64 * GOLDEN + 0.30;
            let spread = width * (0.10 + self.rng.next() * 0.075);
            let endpoint = [Math::cos(angle) * spread, self.soil_y + growth * (0.22 + self.rng.next() * 0.14), Math::sin(angle) * spread * 0.8];
            let root = [Math::cos(angle) * width * 0.025, self.soil_y - self.sink, Math::sin(angle) * width * 0.025];
            self.stem_path(&[root, [endpoint[0] * 0.34, self.soil_y + growth * 0.13, endpoint[2] * 0.34], endpoint], width * 0.012, &format!("petiole-{i}"), 8, 4, Tone::Petiole, [1.2, 0.85]);
            let direction = [Math::cos(angle) * 0.35, 1.0, Math::sin(angle) * 0.18];
            let length = growth * 0.38 * (0.94 + self.rng.next() * 0.12);
            let curve = 0.11 + self.rng.next() * 0.045;
            let twist = (self.rng.next() - 0.5) * 0.40;
            self.blade(endpoint, direction, length, width * 0.43, Math::sin(angle) * 0.6, curve, twist, i, None);
        }
    }
}

/// Merge the objects that share a material into one batch each (`consolidateParts`), returning the names of every
/// object that existed before.
fn consolidate(scene: &mut Scene) -> Vec<String> {
    let parts: Vec<String> = scene.objs[0].children.iter().map(|&c| scene.objs[c].name.clone()).collect();
    let mut batches: Vec<(Role, Vec<usize>)> = Vec::new();
    for &id in &scene.objs[0].children.clone() {
        let o = &scene.objs[id];
        if o.kind != Kind::Mesh || o.name == "ceramic-pot" || o.name == "leaf-0" { continue; }
        match batches.iter_mut().find(|(role, _)| *role == o.role) {
            Some((_, list)) => list.push(id),
            None => batches.push((o.role, vec![id])),
        }
    }
    for (role, objects) in batches {
        if objects.len() < 2 { continue; }
        // Parts are baked in place: their geometry is discarded after merging.
        let mut geos = Vec::new();
        for &id in &objects {
            let matrix = scene.local_matrix(id);
            let built = scene.objs[id].built.as_mut().unwrap();
            built.geo.apply_matrix4(&matrix);
            let o = &mut scene.objs[id];
            o.position = [0.0; 3]; o.quaternion = [0.0, 0.0, 0.0, 1.0]; o.scale = [1.0; 3];
            geos.push(o.built.as_ref().unwrap().geo.clone());
        }
        let first = scene.objs[objects[0]].built.as_ref().unwrap();
        let (order, indexed) = (first.order, first.geo.index.is_some());
        // `mergeGeometries` refuses geometries that differ in the attributes they carry or in being indexed
        let compatible = objects.iter().all(|&id| { let b = scene.objs[id].built.as_ref().unwrap(); b.order.len() == order.len() && order.iter().all(|a| b.order.contains(a)) && b.geo.index.is_some() == indexed });
        if !compatible { continue; }
        let merged = three_geo::merge(&geos);
        let name = format!("{}-batch", scene.objs[objects[0]].name.split('-').next().unwrap());
        let names: Vec<String> = objects.iter().map(|&id| scene.objs[id].name.clone()).collect();
        for &id in &objects {
            scene.objs[id].alive = false;
            scene.objs[0].children.retain(|&c| c != id);
        }
        let batch = scene.mesh(Built { geo: merged, kind: "BufferGeometry", order, groups: Vec::new(), fenestrations: false }, role, &name);
        scene.objs[batch].batch_parts = Some(names);
    }
    parts
}

/// The plant as a baked scene packet: `{"parts", "objects"}` and the typed arrays.
pub fn plant(p: &Plant) -> Vec<u8> {
    let mut rng = Rng::new(p.seed);
    for _ in 0..p.skip { rng.next(); }
    let soil_y = p.pot_height * p.soil_fraction;
    let mut b = Builder { p, rng, scene: Scene::new(), roots: Vec::new(), soil_y, sink: p.width * 0.012 };
    let pot = pot_geometry(p.pot_model, p.radius, p.pot_height, p.soil_fraction);
    let (soil_radius, pot_radius) = (pot.soil_radius, pot.radius);
    b.scene.mesh(pot.built, Role::Clay, "ceramic-pot");
    if p.pot_id == "muskotblomma" { b.scene.mesh(saucer_geometry(p.radius, p.pot_height), Role::Clay, "terracotta-saucer"); }
    if p.pot_id == "akerbar" {
        let seam = b.scene.mesh(seam_geometry(p.width, p.pot_height), Role::Clay, "steel-folded-seam");
        let o = &mut b.scene.objs[seam];
        o.position = [0.0, p.pot_height * 0.48, -pot_radius * 0.878];
        o.euler = Some([-0.16, 0.0, 0.0]);
        o.quaternion = quaternion_from_euler(-0.16, 0.0, 0.0);
    }
    match p.variant {
        Variant::Cactus => b.cactus(),
        Variant::Upright => b.upright(),
        Variant::Succulent => b.succulent(),
        Variant::Palm => b.palm(),
        Variant::Fern => b.fern(),
        Variant::Zz => b.zz(),
        Variant::Ivy => b.ivy(),
        Variant::Leafy => b.leafy(),
        Variant::Monstera => b.monstera(),
    }
    let grit = p.variant == Variant::Cactus || p.variant == Variant::Succulent;
    let soil = soil_geometry(soil_radius * 0.995, soil_y, &mut b.rng, &b.roots, grit);
    b.scene.mesh(soil, Role::Soil, "potting-soil");
    let parts = consolidate(&mut b.scene);
    let roots = std::mem::take(&mut b.roots);
    let mut scene = b.scene;
    // Only the foliage is fitted to the promised collision envelope: the pot stays round and true to size, and the
    // ceramic base remains at -height/2.
    let foliage = scene.add(0, "plant-foliage", Kind::Group, Role::Clay, None, false);
    for id in scene.objs[0].children.clone() {
        if id != foliage && scene.objs[id].role != Role::Clay && scene.objs[id].role != Role::Soil {
            scene.objs[0].children.retain(|&c| c != id);
            scene.objs[id].parent = foliage;
            scene.objs[foliage].children.push(id);
        }
    }
    // the plant's group is the identity; the content sits half the height below it
    scene.objs[0].position = [0.0, -p.height / 2.0, 0.0];
    let group_world = Mat4::identity();
    let content_world = Mat4::multiply(&group_world, &scene.local_matrix(0));
    let mut leaf_bounds = Box3::empty();
    scene.world_box(foliage, &content_world, &mut leaf_bounds);
    let x_extent = jmax(jmax(leaf_bounds.min[0].abs(), leaf_bounds.max[0].abs()), 1e-6);
    let z_extent = jmax(jmax(leaf_bounds.min[2].abs(), leaf_bounds.max[2].abs()), 1e-6);
    // Foliage stretches about the soil line to reach the envelope's top, never so far that trailing stems would pass
    // below the base of the pot.
    let top = leaf_bounds.max[1] + p.height / 2.0;
    let low = leaf_bounds.min[1] + p.height / 2.0;
    let stretch = jmin(p.above / jmax(1e-6, top - soil_y), if low < soil_y { soil_y / (soil_y - low) } else { f64::INFINITY });
    // Width follows the same factor where the envelope allows, so a small rosette grows as a plant rather than being
    // pulled into spikes; stems still have to rise from the soil inside the pot wall.
    let reach = roots.iter().fold(1e-6, |m, r| jmax(m, Math::hypot(r[0], r[1]) + r[2]));
    let rooted = soil_radius * 0.97 / reach;
    scene.objs[foliage].scale = [jmin(jmin(stretch, p.width / 2.0 / x_extent), rooted), stretch, jmin(jmin(stretch, p.width * 0.35 / z_extent), rooted)];
    scene.objs[foliage].position[1] = soil_y * (1.0 - stretch);
    let mut bounds = Box3::empty();
    scene.world_box(0, &group_world, &mut bounds);
    // Preserve the measured pot height; never stretch the whole assembly.
    let correction = (p.height - soil_y) / jmax(1e-6, bounds.max[1] + p.height / 2.0 - soil_y);
    scene.objs[foliage].scale[1] *= correction;
    scene.objs[foliage].position[1] = soil_y * (1.0 - scene.objs[foliage].scale[1]);
    write(&scene, &parts)
}

fn write(scene: &Scene, parts: &[String]) -> Vec<u8> {
    let mut packet = Packet::new();
    // objects in creation order, the content itself left out
    let ids: Vec<usize> = (1..scene.objs.len()).filter(|&i| scene.objs[i].alive).collect();
    let mut order = vec![usize::MAX; scene.objs.len()];
    for (n, &id) in ids.iter().enumerate() { order[id] = n; }
    packet.json.push_str("{\"parts\":[");
    for (n, name) in parts.iter().enumerate() { if n > 0 { packet.json.push(','); } packet.json.push_str(&format!("\"{name}\"")); }
    packet.json.push_str("],\"objects\":[");
    for (n, &id) in ids.iter().enumerate() {
        let o = &scene.objs[id];
        if n > 0 { packet.json.push(','); }
        let parent: i64 = if o.parent == 0 { -1 } else { order[o.parent] as i64 };
        let place = scene.objs[o.parent].children.iter().position(|&c| c == id).unwrap();
        let rotation = match o.euler { Some(e) => e, None if o.touched => euler_from_quaternion(o.quaternion), None => [0.0; 3] };
        let kind = match o.kind { Kind::Mesh => "mesh", Kind::Lines => "lines", Kind::Group => "group" };
        let role = if o.kind == Kind::Group { "null".to_string() } else { format!("\"{}\"", ROLE_NAMES[o.role as usize]) };
        let user = match &o.batch_parts { Some(names) => format!("{{\"parts\":[{}]}}", names.iter().map(|s| format!("\"{s}\"")).collect::<Vec<_>>().join(",")), None => "{}".to_string() };
        packet.json.push_str(&format!("{{\"name\":\"{}\",\"kind\":\"{kind}\",\"role\":{role},\"parent\":{parent},\"place\":{place},\"position\":{},\"quaternion\":{},\"rotation\":{},\"scale\":{},\"castShadow\":{},\"receiveShadow\":{},\"userData\":{user}",
            o.name, nums(&o.position), nums(&o.quaternion), nums(&rotation), nums(&o.scale), o.shadows, o.shadows));
        if let Some(built) = &o.built {
            let b = built.geo.bounds();
            packet.json.push_str(&format!(",\"geometry\":{{\"type\":\"{}\",\"box\":{},\"userData\":{},\"groups\":[{}],",
                built.kind, nums(&[b.min[0], b.min[1], b.min[2], b.max[0], b.max[1], b.max[2]]),
                if built.fenestrations { "{\"fenestrations\":4}" } else { "{}" },
                built.groups.iter().map(|g| format!("[{},{},{}]", g[0], g[1], g[2])).collect::<Vec<_>>().join(",")));
            packet.plain(&built.geo, built.order);
            packet.json.push('}');
        }
        packet.json.push('}');
    }
    packet.json.push_str("]}");
    let _ = num;
    packet.seal()
}
