//! three's `Path`/`Shape` curves, `ShapeUtils.triangulateShape` and `ExtrudeGeometry` (flat, or bevelled without holes),
//! in three's own order of operations (the host's `Math` for the ellipse's trigonometry).
use crate::earcut;
use crate::three_geo::Geo;
use js_sys::Math;
use std::f64::consts::PI;

pub type P2 = [f64; 2];

pub enum Curve {
    Line(P2, P2),
    Ellipse { x: f64, y: f64, rx: f64, ry: f64, start: f64, end: f64, clockwise: bool, rotation: f64 },
    Quadratic(P2, P2, P2),
    Cubic(P2, P2, P2, P2),
}

/// `QuadraticBezier(t, p0, p1, p2)` of `Interpolations`.
fn quadratic_bezier(t: f64, p0: f64, p1: f64, p2: f64) -> f64 {
    let k = 1.0 - t;
    k * k * p0 + 2.0 * (1.0 - t) * t * p1 + t * t * p2
}
/// `CubicBezier(t, p0, p1, p2, p3)` of `Interpolations`.
fn cubic_bezier(t: f64, p0: f64, p1: f64, p2: f64, p3: f64) -> f64 {
    let k = 1.0 - t;
    k * k * k * p0 + 3.0 * k * k * t * p1 + 3.0 * (1.0 - t) * t * t * p2 + t * t * t * p3
}

impl Curve {
    /// `getPoint(t)`.
    pub fn point(&self, t: f64) -> P2 {
        match self {
            Curve::Line(v1, v2) => {
                if t == 1.0 { *v2 } else { [(v2[0] - v1[0]) * t + v1[0], (v2[1] - v1[1]) * t + v1[1]] }
            }
            Curve::Quadratic(v0, v1, v2) => [quadratic_bezier(t, v0[0], v1[0], v2[0]), quadratic_bezier(t, v0[1], v1[1], v2[1])],
            Curve::Cubic(v0, v1, v2, v3) => [cubic_bezier(t, v0[0], v1[0], v2[0], v3[0]), cubic_bezier(t, v0[1], v1[1], v2[1], v3[1])],
            Curve::Ellipse { x, y, rx, ry, start, end, clockwise, rotation } => {
                let two_pi = PI * 2.0;
                let mut delta = end - start;
                let same = delta.abs() < f64::EPSILON;
                // ensures that the angle is 0 .. 2 PI
                while delta < 0.0 { delta += two_pi; }
                while delta > two_pi { delta -= two_pi; }
                if delta < f64::EPSILON { delta = if same { 0.0 } else { two_pi }; }
                if *clockwise && !same { delta = if delta == two_pi { -two_pi } else { delta - two_pi }; }
                let angle = start + t * delta;
                let (mut px, mut py) = (x + rx * Math::cos(angle), y + ry * Math::sin(angle));
                if *rotation != 0.0 {
                    let (cos, sin) = (Math::cos(*rotation), Math::sin(*rotation));
                    // rotate the point about the centre of the ellipse
                    let (tx, ty) = (px - x, py - y);
                    px = tx * cos - ty * sin + x;
                    py = tx * sin + ty * cos + y;
                }
                [px, py]
            }
        }
    }
    /// `getPoints(divisions)` for this curve type: an ellipse takes twice the divisions, a line one.
    fn sampled(&self, divisions: usize) -> Vec<P2> {
        let n = match self { Curve::Ellipse { .. } => divisions * 2, Curve::Line(..) => 1, Curve::Quadratic(..) | Curve::Cubic(..) => divisions };
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
        self.abs_ellipse(x, y, r, r, start, end, clockwise, 0.0);
    }
    /// `quadraticCurveTo(cx, cy, x, y)`.
    pub fn quadratic_to(&mut self, control: P2, p: P2) { self.curves.push(Curve::Quadratic(self.current, control, p)); self.current = p; }
    /// `bezierCurveTo(c1x, c1y, c2x, c2y, x, y)`.
    pub fn bezier_to(&mut self, c1: P2, c2: P2, p: P2) { self.curves.push(Curve::Cubic(self.current, c1, c2, p)); self.current = p; }
    #[allow(clippy::too_many_arguments)]
    pub fn abs_ellipse(&mut self, x: f64, y: f64, rx: f64, ry: f64, start: f64, end: f64, clockwise: bool, rotation: f64) {
        let curve = Curve::Ellipse { x, y, rx, ry, start, end, clockwise, rotation };
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

/// `ShapeGeometry(shape, curveSegments)` of a shape and its holes: the flat triangulated face (z = 0, normal +z,
/// world-space UVs). The outline and each hole lose a repeated end point before the triangulation, as
/// `ShapeUtils.triangulateShape` does in place.
pub fn shape_geometry(shape: &Path, holes: &[Path], curve_segments: usize) -> Geo {
    let mut outline = shape.points(curve_segments);
    let mut hole_points: Vec<Vec<P2>> = holes.iter().map(|hole| hole.points(curve_segments)).collect();
    if !is_clockwise(&outline) { outline.reverse(); }
    for hole in hole_points.iter_mut() { if is_clockwise(hole) { hole.reverse(); } }
    let drop_duplicate_end = |points: &mut Vec<P2>| {
        let l = points.len();
        if l > 2 && points[l - 1][0] == points[0][0] && points[l - 1][1] == points[0][1] { points.pop(); }
    };
    drop_duplicate_end(&mut outline);
    for hole in hole_points.iter_mut() { drop_duplicate_end(hole); }
    let mut flat: Vec<f64> = outline.iter().flat_map(|p| *p).collect();
    let mut hole_indices = Vec::new();
    let mut hole_index = outline.len();
    for hole in &hole_points {
        hole_indices.push(hole_index);
        hole_index += hole.len();
        flat.extend(hole.iter().flat_map(|p| *p));
    }
    let triangles = earcut::triangulate(&flat, &hole_indices);
    let count = flat.len() / 2;
    let mut positions = Vec::with_capacity(count * 3);
    let mut normals = Vec::with_capacity(count * 3);
    for xy in flat.chunks_exact(2) { positions.extend([xy[0], xy[1], 0.0]); normals.extend([0.0, 0.0, 1.0]); }
    Geo { position: crate::three_geo::f32s(&positions), normal: crate::three_geo::f32s(&normals), uv: crate::three_geo::f32s(&flat), color: Vec::new(),
        index: Some(triangles.into_iter().map(|i| i as u32).collect()) }
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

/// `getBevelVec(inPt, inPrev, inNext)` of `ExtrudeGeometry`: the direction a contour point moves for the bevel.
fn bevel_vec(pt: P2, prev: P2, next: P2) -> P2 {
    let (v_prev_x, v_prev_y) = (pt[0] - prev[0], pt[1] - prev[1]);
    let (v_next_x, v_next_y) = (next[0] - pt[0], next[1] - pt[1]);
    let v_prev_lensq = v_prev_x * v_prev_x + v_prev_y * v_prev_y;
    let collinear0 = v_prev_x * v_next_y - v_prev_y * v_next_x;
    let (v_trans_x, v_trans_y, shrink_by);
    if collinear0.abs() > f64::EPSILON {
        // not collinear: the intersection of the two shifted edges
        let v_prev_len = v_prev_lensq.sqrt();
        let v_next_len = (v_next_x * v_next_x + v_next_y * v_next_y).sqrt();
        let pt_prev_shift_x = prev[0] - v_prev_y / v_prev_len;
        let pt_prev_shift_y = prev[1] + v_prev_x / v_prev_len;
        let pt_next_shift_x = next[0] - v_next_y / v_next_len;
        let pt_next_shift_y = next[1] + v_next_x / v_next_len;
        let sf = ((pt_next_shift_x - pt_prev_shift_x) * v_next_y - (pt_next_shift_y - pt_prev_shift_y) * v_next_x)
            / (v_prev_x * v_next_y - v_prev_y * v_next_x);
        let (x, y) = (pt_prev_shift_x + v_prev_x * sf - pt[0], pt_prev_shift_y + v_prev_y * sf - pt[1]);
        let v_trans_lensq = x * x + y * y;
        if v_trans_lensq <= 2.0 { return [x, y]; }
        v_trans_x = x; v_trans_y = y; shrink_by = (v_trans_lensq / 2.0).sqrt();
    } else {
        // collinear, in the same or the opposite direction
        let direction_eq = if v_prev_x > f64::EPSILON { v_next_x > f64::EPSILON }
            else if v_prev_x < -f64::EPSILON { v_next_x < -f64::EPSILON }
            else { crate::three_geo::js_sign(v_prev_y) == crate::three_geo::js_sign(v_next_y) };
        if direction_eq { v_trans_x = -v_prev_y; v_trans_y = v_prev_x; shrink_by = v_prev_lensq.sqrt(); }
        else { v_trans_x = v_prev_x; v_trans_y = v_prev_y; shrink_by = (v_prev_lensq / 2.0).sqrt(); }
    }
    [v_trans_x / shrink_by, v_trans_y / shrink_by]
}

/// The two groups `ExtrudeGeometry` adds: `[start, count, materialIndex]` of the lids, then of the walls.
pub type Groups = [[usize; 3]; 2];

/// `ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness, bevelSize, bevelSegments, steps: 1 })`
/// of an outline without holes (`bevelOffset` 0): the points come from `Path#points(curveSegments)`. Positions
/// and world UVs in three's order, then `computeVertexNormals` of the soup; also its two groups.
pub fn extrude_beveled(outline: &[P2], depth: f64, bevel_thickness: f64, bevel_size: f64, bevel_segments: usize) -> (Geo, Groups) {
    let (steps, bevel_offset) = (1usize, 0.0f64);
    let mut contour = outline.to_vec();
    if !is_clockwise(&contour) { contour.reverse(); }
    merge_overlapping(&mut contour);
    let vlen = contour.len();
    let n = vlen;
    let movements: Vec<P2> = (0..n).map(|i| bevel_vec(contour[i], contour[if i == 0 { n - 1 } else { i - 1 }], contour[if i + 1 == n { 0 } else { i + 1 }])).collect();
    let scale_pt = |p: P2, v: P2, size: f64| -> P2 { [p[0] + v[0] * size, p[1] + v[1] * size] };
    let mut placeholder: Vec<f64> = Vec::new();
    let mut contracted: Vec<P2> = Vec::new();
    for b in 0..bevel_segments {
        let t = b as f64 / bevel_segments as f64;
        let z = bevel_thickness * Math::cos(t * PI / 2.0);
        let bs = bevel_size * Math::sin(t * PI / 2.0) + bevel_offset;
        for i in 0..n {
            let vert = scale_pt(contour[i], movements[i], bs);
            placeholder.extend([vert[0], vert[1], -z]);
            if t == 0.0 { contracted.push(vert); }
        }
    }
    // ShapeUtils.triangulateShape(contracted, []): a repeated end point is dropped first
    {
        let l = contracted.len();
        if l > 2 && contracted[l - 1][0] == contracted[0][0] && contracted[l - 1][1] == contracted[0][1] { contracted.pop(); }
    }
    let flat: Vec<f64> = contracted.iter().flat_map(|p| *p).collect();
    let faces = earcut::triangulate(&flat, &[]);
    let bs = bevel_size + bevel_offset;
    for i in 0..vlen { let vert = scale_pt(contour[i], movements[i], bs); placeholder.extend([vert[0], vert[1], 0.0]); }
    for s in 1..=steps {
        for i in 0..vlen { let vert = scale_pt(contour[i], movements[i], bs); placeholder.extend([vert[0], vert[1], depth / steps as f64 * s as f64]); }
    }
    for b in (0..bevel_segments).rev() {
        let t = b as f64 / bevel_segments as f64;
        let z = bevel_thickness * Math::cos(t * PI / 2.0);
        let bs = bevel_size * Math::sin(t * PI / 2.0) + bevel_offset;
        for i in 0..n { let vert = scale_pt(contour[i], movements[i], bs); placeholder.extend([vert[0], vert[1], depth + z]); }
    }
    let mut out: Vec<f64> = Vec::new();
    let mut uvs: Vec<f64> = Vec::new();
    let add = |out: &mut Vec<f64>, index: usize| out.extend_from_slice(&placeholder[index * 3..index * 3 + 3]);
    let f3 = |out: &mut Vec<f64>, uvs: &mut Vec<f64>, a: usize, b: usize, c: usize| {
        for v in [a, b, c] { add(out, v); }
        let next = out.len() / 3;
        for k in [next - 3, next - 2, next - 1] { uvs.extend([out[k * 3], out[k * 3 + 1]]); }
    };
    // lids: the first layer with reversed winding, then the last
    let lid_start = 0;
    for face in faces.chunks_exact(3) { f3(&mut out, &mut uvs, face[2], face[1], face[0]); }
    let offset = vlen * (steps + bevel_segments * 2);
    for face in faces.chunks_exact(3) { f3(&mut out, &mut uvs, face[0] + offset, face[1] + offset, face[2] + offset); }
    let side_start = out.len() / 3;
    let layers = steps + bevel_segments * 2;
    let mut i = n;
    while i > 0 {
        i -= 1;
        let j = i;
        let k = if i == 0 { n - 1 } else { i - 1 };
        for s in 0..layers {
            let (slen1, slen2) = (vlen * s, vlen * (s + 1));
            let (a, b, c, d) = (j + slen1, k + slen1, k + slen2, j + slen2);
            for v in [a, b, d, b, c, d] { add(&mut out, v); }
            let next = out.len() / 3;
            let at = |m: usize, axis: usize| out[(next - m) * 3 + axis];
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
            for m in [0, 1, 3, 1, 2, 3] { uvs.extend(uv[m]); }
        }
    }
    let end = out.len() / 3;
    let mut geo = Geo { position: crate::three_geo::f32s(&out), uv: crate::three_geo::f32s(&uvs), ..Default::default() };
    geo.compute_vertex_normals();
    (geo, [[lid_start, side_start - lid_start, 0], [side_start, end - side_start, 1]])
}
