//! three's `Path`/`Shape` curves, `ShapeUtils.triangulateShape` and `ExtrudeGeometry` without bevel,
//! in three's own order of operations (the host's `Math` for the ellipse's trigonometry).
use crate::earcut;
use crate::three_geo::Geo;
use js_sys::Math;
use std::f64::consts::PI;

pub type P2 = [f64; 2];

pub enum Curve {
    Line(P2, P2),
    Ellipse { x: f64, y: f64, rx: f64, ry: f64, start: f64, end: f64, clockwise: bool },
}

impl Curve {
    /// `getPoint(t)`.
    pub fn point(&self, t: f64) -> P2 {
        match self {
            Curve::Line(v1, v2) => {
                if t == 1.0 { *v2 } else { [(v2[0] - v1[0]) * t + v1[0], (v2[1] - v1[1]) * t + v1[1]] }
            }
            Curve::Ellipse { x, y, rx, ry, start, end, clockwise } => {
                let two_pi = PI * 2.0;
                let mut delta = end - start;
                let same = delta.abs() < f64::EPSILON;
                // ensures that the angle is 0 .. 2 PI
                while delta < 0.0 { delta += two_pi; }
                while delta > two_pi { delta -= two_pi; }
                if delta < f64::EPSILON { delta = if same { 0.0 } else { two_pi }; }
                if *clockwise && !same { delta = if delta == two_pi { -two_pi } else { delta - two_pi }; }
                let angle = start + t * delta;
                [x + rx * Math::cos(angle), y + ry * Math::sin(angle)]
            }
        }
    }
    /// `getPoints(divisions)` for this curve type: an ellipse takes twice the divisions, a line one.
    fn sampled(&self, divisions: usize) -> Vec<P2> {
        let n = match self { Curve::Ellipse { .. } => divisions * 2, Curve::Line(..) => 1 };
        (0..=n).map(|d| self.point(d as f64 / n as f64)).collect()
    }
}

/// A `Path`: curves joined end to start, with a current point.
pub struct Path { pub curves: Vec<Curve>, current: P2 }

impl Path {
    pub fn new() -> Path { Path { curves: Vec::new(), current: [0.0, 0.0] } }
    /// `Path#setFromPoints`.
    pub fn from_points(points: &[P2]) -> Path {
        let mut path = Path::new();
        path.move_to(points[0]);
        for p in &points[1..] { path.line_to(*p); }
        path
    }
    pub fn move_to(&mut self, p: P2) { self.current = p; }
    pub fn line_to(&mut self, p: P2) { self.curves.push(Curve::Line(self.current, p)); self.current = p; }
    /// `absarc` / `absellipse` with equal radii.
    pub fn abs_arc(&mut self, x: f64, y: f64, r: f64, start: f64, end: f64, clockwise: bool) {
        let curve = Curve::Ellipse { x, y, rx: r, ry: r, start, end, clockwise };
        if !self.curves.is_empty() {
            // if a previous curve is present, attempt to join
            let first = curve.point(0.0);
            if !(first[0] == self.current[0] && first[1] == self.current[1]) { self.line_to(first); }
        }
        let last = curve.point(1.0);
        self.curves.push(curve);
        self.current = last;
    }
    /// `closePath()`: a line back to the start if the ends are not already joined.
    pub fn close(&mut self) {
        let start = self.curves[0].point(0.0);
        let end = self.curves[self.curves.len() - 1].point(1.0);
        if !(start[0] == end[0] && start[1] == end[1]) { self.curves.push(Curve::Line(end, start)); }
    }
    /// `getPoints(divisions)`: consecutive duplicates are skipped.
    pub fn points(&self, divisions: usize) -> Vec<P2> {
        let mut points: Vec<P2> = Vec::new();
        for curve in &self.curves {
            for point in curve.sampled(divisions) {
                if let Some(last) = points.last() { if last[0] == point[0] && last[1] == point[1] { continue; } }
                points.push(point);
            }
        }
        points
    }
}

fn area(contour: &[P2]) -> f64 {
    let n = contour.len();
    let mut a = 0.0;
    let (mut p, mut q) = (n - 1, 0);
    while q < n { a += contour[p][0] * contour[q][1] - contour[q][0] * contour[p][1]; p = q; q += 1; }
    a * 0.5
}
/// `ShapeUtils.isClockWise`.
fn is_clockwise(points: &[P2]) -> bool { area(points) < 0.0 }

/// `mergeOverlappingPoints` of `ExtrudeGeometry`: points (also the wrap-around pair) closer than 1e-10 of
/// their size are dropped, the later one - or the first one for the wrap.
fn merge_overlapping(points: &mut Vec<P2>) {
    let threshold_sq = 1e-10 * 1e-10;
    let mut prev = points[0];
    let mut i = 1;
    while i <= points.len() {
        let current_index = i % points.len();
        let current = points[current_index];
        let (dx, dy) = (current[0] - prev[0], current[1] - prev[1]);
        let dist_sq = dx * dx + dy * dy;
        let scaling = crate::jsmath::jmax(crate::jsmath::jmax(crate::jsmath::jmax(current[0].abs(), current[1].abs()), prev[0].abs()), prev[1].abs());
        let threshold_scaled = threshold_sq * scaling * scaling;
        if dist_sq <= threshold_scaled {
            points.remove(current_index);
            continue;
        }
        prev = current;
        i += 1;
    }
}

/// `ExtrudeGeometry(shape, { depth, bevelEnabled: false, steps: 1 })` of a contour and its holes:
/// lids, side walls, world-space UVs and vertex normals.
pub fn extrude(contour_points: &[P2], hole_points: &[Vec<P2>], depth: f64) -> Geo {
    let mut contour = contour_points.to_vec();
    let mut holes: Vec<Vec<P2>> = hole_points.to_vec();
    if !is_clockwise(&contour) {
        contour.reverse();
        for hole in holes.iter_mut() { if is_clockwise(hole) { hole.reverse(); } }
    }
    merge_overlapping(&mut contour);
    for hole in holes.iter_mut() { merge_overlapping(hole); }
    // all points: the contour, then every hole
    let mut vertices = contour.clone();
    for hole in &holes { vertices.extend_from_slice(hole); }
    let vlen = vertices.len();
    // ShapeUtils.triangulateShape(contour, holes): a repeated end point is dropped first
    let drop_duplicate_end = |points: &mut Vec<P2>| {
        let l = points.len();
        if l > 2 && points[l - 1][0] == points[0][0] && points[l - 1][1] == points[0][1] { points.pop(); }
    };
    drop_duplicate_end(&mut contour);
    for hole in holes.iter_mut() { drop_duplicate_end(hole); }
    let mut flat: Vec<f64> = contour.iter().flat_map(|p| *p).collect();
    let mut hole_indices = Vec::new();
    let mut hole_index = contour.len();
    for hole in &holes {
        hole_indices.push(hole_index);
        hole_index += hole.len();
        flat.extend(hole.iter().flat_map(|p| *p));
    }
    let triangles = earcut::triangulate(&flat, &hole_indices);
    // positions of both layers: z = 0 and z = depth / steps * 1
    let mut placeholder: Vec<f64> = Vec::with_capacity(vlen * 6);
    for p in &vertices { placeholder.extend([p[0], p[1], 0.0]); }
    for p in &vertices { placeholder.extend([p[0], p[1], depth / 1.0 * 1.0]); }
    let mut out: Vec<f64> = Vec::new();
    let mut uvs: Vec<f64> = Vec::new();
    let add = |out: &mut Vec<f64>, index: usize| out.extend_from_slice(&placeholder[index * 3..index * 3 + 3]);
    // lids: the bottom with reversed winding, then the top
    let mut f3 = |out: &mut Vec<f64>, uvs: &mut Vec<f64>, a: usize, b: usize, c: usize| {
        for v in [a, b, c] { add(out, v); }
        let next = out.len() / 3;
        for k in [next - 3, next - 2, next - 1] { uvs.extend([out[k * 3], out[k * 3 + 1]]); }
    };
    for face in triangles.chunks_exact(3) { f3(&mut out, &mut uvs, face[2], face[1], face[0]); }
    for face in triangles.chunks_exact(3) { f3(&mut out, &mut uvs, face[0] + vlen, face[1] + vlen, face[2] + vlen); }
    // side walls
    let mut walls = |out: &mut Vec<f64>, uvs: &mut Vec<f64>, ring: usize, layer_offset: usize| {
        let mut i = ring;
        while i > 0 {
            i -= 1;
            let j = i;
            let k = if i == 0 { ring - 1 } else { i - 1 };
            let (a, b, c, d) = (layer_offset + j, layer_offset + k, layer_offset + k + vlen, layer_offset + j + vlen);
            for v in [a, b, d, b, c, d] { add(out, v); }
            let next = out.len() / 3;
            let at = |n: usize, axis: usize| out[(next - n) * 3 + axis];
            // generateSideWallUV(vertices, next - 6, next - 3, next - 2, next - 1)
            let (a_x, a_y, a_z) = (at(6, 0), at(6, 1), at(6, 2));
            let (b_x, b_y, b_z) = (at(3, 0), at(3, 1), at(3, 2));
            let (c_x, c_y, c_z) = (at(2, 0), at(2, 1), at(2, 2));
            let (d_x, d_y, d_z) = (at(1, 0), at(1, 1), at(1, 2));
            let uv: [[f64; 2]; 4] = if (a_y - b_y).abs() < (a_x - b_x).abs() {
                [[a_x, 1.0 - a_z], [b_x, 1.0 - b_z], [c_x, 1.0 - c_z], [d_x, 1.0 - d_z]]
            } else {
                [[a_y, 1.0 - a_z], [b_y, 1.0 - b_z], [c_y, 1.0 - c_z], [d_y, 1.0 - d_z]]
            };
            for k in [0, 1, 3, 1, 2, 3] { uvs.extend(uv[k]); }
        }
    };
    let mut layer_offset = 0;
    walls(&mut out, &mut uvs, contour.len(), layer_offset);
    layer_offset += contour.len();
    for hole in &holes { walls(&mut out, &mut uvs, hole.len(), layer_offset); layer_offset += hole.len(); }
    let mut geo = Geo { position: crate::three_geo::f32s(&out), uv: crate::three_geo::f32s(&uvs), ..Default::default() };
    geo.compute_vertex_normals();
    geo
}
