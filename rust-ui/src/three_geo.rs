//! three.js geometry, operation by operation: the generators the shelf's models are made of and the
//! `BufferGeometry` operations applied to them. Every store follows three's own (f64 arithmetic,
//! Float32 storage after each step; `Math.sin/cos/acos/pow` from the host's `Math`), so the arrays are
//! the ones three would have built.
use crate::jsmath::{self, Box3, Mat4, Vec3};
use js_sys::Math;
use std::f64::consts::PI;

/// A `BufferGeometry` of the attributes the models use. Empty vectors are absent attributes.
#[derive(Clone, Default)]
pub struct Geo {
    pub position: Vec<f32>,
    pub normal: Vec<f32>,
    pub uv: Vec<f32>,
    pub color: Vec<f32>,
    pub index: Option<Vec<u32>>,
}

pub fn f32s(values: &[f64]) -> Vec<f32> { values.iter().map(|&v| v as f32).collect() }
/// `Math.sign`.
pub fn js_sign(v: f64) -> f64 { if v > 0.0 { 1.0 } else if v < 0.0 { -1.0 } else { v } }
pub fn v3(a: &[f32], i: usize) -> Vec3 { [f64::from(a[i * 3]), f64::from(a[i * 3 + 1]), f64::from(a[i * 3 + 2])] }
fn put(a: &mut [f32], i: usize, v: Vec3) { a[i * 3] = v[0] as f32; a[i * 3 + 1] = v[1] as f32; a[i * 3 + 2] = v[2] as f32; }

impl Geo {
    pub fn count(&self) -> usize { self.position.len() / 3 }

    /// `BufferGeometry#toNonIndexed`.
    pub fn to_non_indexed(&self) -> Geo {
        let Some(index) = &self.index else { return self.clone() };
        let pick = |source: &[f32], size: usize| -> Vec<f32> {
            if source.is_empty() { return Vec::new(); }
            let mut out = Vec::with_capacity(index.len() * size);
            for &i in index { let at = i as usize * size; out.extend_from_slice(&source[at..at + size]); }
            out
        };
        Geo { position: pick(&self.position, 3), normal: pick(&self.normal, 3), uv: pick(&self.uv, 2), color: pick(&self.color, 3), index: None }
    }

    /// `BufferGeometry#applyMatrix4`: positions through `Vector3#applyMatrix4`; normals through the
    /// normal matrix and `normalize`.
    pub fn apply_matrix4(&mut self, m: &Mat4) {
        for i in 0..self.count() { let p = m.apply(v3(&self.position, i)); put(&mut self.position, i, p); }
        if !self.normal.is_empty() {
            let n = normal_matrix(m);
            for i in 0..self.normal.len() / 3 {
                let [x, y, z] = v3(&self.normal, i);
                let r = jsmath::normalize([n[0] * x + n[3] * y + n[6] * z, n[1] * x + n[4] * y + n[7] * z, n[2] * x + n[5] * y + n[8] * z]);
                put(&mut self.normal, i, r);
            }
        }
    }
    pub fn translate(&mut self, x: f64, y: f64, z: f64) {
        let mut m = Mat4::identity();
        m.set_position([x, y, z]);
        self.apply_matrix4(&m);
    }
    /// `rotateY(angle)`: `Matrix4#makeRotationY` with the host's cos/sin.
    pub fn rotate_y(&mut self, angle: f64) {
        let (c, s) = (Math::cos(angle), Math::sin(angle));
        self.apply_matrix4(&Mat4([c, 0.0, -s, 0.0, 0.0, 1.0, 0.0, 0.0, s, 0.0, c, 0.0, 0.0, 0.0, 0.0, 1.0]));
    }
    /// `applyQuaternion(q)`: `Matrix4#makeRotationFromQuaternion`.
    pub fn apply_quaternion(&mut self, q: [f64; 4]) {
        self.apply_matrix4(&Mat4::compose([0.0; 3], q, [1.0; 3]));
    }
    /// `scale(x, y, z)`.
    pub fn scale(&mut self, x: f64, y: f64, z: f64) {
        self.apply_matrix4(&Mat4([x, 0.0, 0.0, 0.0, 0.0, y, 0.0, 0.0, 0.0, 0.0, z, 0.0, 0.0, 0.0, 0.0, 1.0]));
    }

    /// `computeVertexNormals()`: every face normal added to its vertices, stored as f32 after
    /// each addition, then every normal normalised.
    pub fn compute_vertex_normals(&mut self) {
        self.normal = vec![0.0; self.position.len()];
        let face = |p: &[f32], a: usize, b: usize, c: usize| {
            let (pa, pb, pc) = (v3(p, a), v3(p, b), v3(p, c));
            jsmath::cross(jsmath::sub(pc, pb), jsmath::sub(pa, pb))
        };
        if let Some(index) = &self.index {
            for t in index.chunks_exact(3) {
                let (a, b, c) = (t[0] as usize, t[1] as usize, t[2] as usize);
                let cb = face(&self.position, a, b, c);
                // all three are read before any is written, as three does
                let n = [v3(&self.normal, a), v3(&self.normal, b), v3(&self.normal, c)];
                for (k, v) in [a, b, c].into_iter().enumerate() {
                    put(&mut self.normal, v, [n[k][0] + cb[0], n[k][1] + cb[1], n[k][2] + cb[2]]);
                }
            }
        } else {
            for i in (0..self.count()).step_by(3) {
                let cb = face(&self.position, i, i + 1, i + 2);
                // a triangle soup stores the face normal itself, a negative zero included
                for v in 0..3 { put(&mut self.normal, i + v, cb); }
            }
        }
        for i in 0..self.normal.len() / 3 { let n = jsmath::normalize(v3(&self.normal, i)); put(&mut self.normal, i, n); }
    }

    /// `computeBoundingBox()`: min/max of the f32 positions.
    pub fn bounds(&self) -> Box3 {
        let mut b = Box3::empty();
        for i in 0..self.count() { b.expand_by_point(v3(&self.position, i)); }
        b
    }
}

/// `new Matrix3().getNormalMatrix(m)`: the inverse transpose of the upper 3x3, column-major, with three's
/// own sequence of products so even the sign of a zero is the same.
pub fn normal_matrix(m: &Mat4) -> [f64; 9] {
    let e = &m.0;
    let (n11, n21, n31, n12, n22, n32, n13, n23, n33) = (e[0], e[1], e[2], e[4], e[5], e[6], e[8], e[9], e[10]);
    let (t11, t12, t13) = (n33 * n22 - n32 * n23, n32 * n13 - n33 * n12, n23 * n12 - n22 * n13);
    let det = n11 * t11 + n21 * t12 + n31 * t13;
    if det == 0.0 { return [0.0; 9]; }
    let inv = 1.0 / det;
    let t = [t11 * inv, (n31 * n23 - n33 * n21) * inv, (n32 * n21 - n31 * n22) * inv,
        t12 * inv, (n33 * n11 - n31 * n13) * inv, (n31 * n12 - n32 * n11) * inv,
        t13 * inv, (n21 * n13 - n23 * n11) * inv, (n22 * n11 - n21 * n12) * inv];
    // transpose
    [t[0], t[3], t[6], t[1], t[4], t[7], t[2], t[5], t[8]]
}

/// `Quaternion#setFromUnitVectors(from, to)` as `[x, y, z, w]`.
pub fn quaternion_from_unit_vectors(from: Vec3, to: Vec3) -> [f64; 4] {
    let mut r = from[0] * to[0] + from[1] * to[1] + from[2] * to[2] + 1.0;
    let (x, y, z, w);
    if r < f64::EPSILON {
        // from and to point in opposite directions
        r = 0.0;
        if from[0].abs() > from[2].abs() { x = -from[1]; y = from[0]; z = 0.0; w = r; }
        else { x = 0.0; y = -from[2]; z = from[1]; w = r; }
    } else {
        x = from[1] * to[2] - from[2] * to[1];
        y = from[2] * to[0] - from[0] * to[2];
        z = from[0] * to[1] - from[1] * to[0];
        w = r;
    }
    quaternion_normalize([x, y, z, w])
}
pub fn quaternion_normalize(q: [f64; 4]) -> [f64; 4] {
    let l = (q[0] * q[0] + q[1] * q[1] + q[2] * q[2] + q[3] * q[3]).sqrt();
    if l == 0.0 { [0.0, 0.0, 0.0, 1.0] } else { let l = 1.0 / l; [q[0] * l, q[1] * l, q[2] * l, q[3] * l] }
}

/// `mergeGeometries(list, false)`: attributes appended in order, indices offset (Uint32 once any
/// reaches 65535 - decided by the caller's `index_is_32`).
pub fn merge(list: &[Geo]) -> Geo {
    let indexed = list[0].index.is_some();
    let mut out = Geo { index: if indexed { Some(Vec::new()) } else { None }, ..Default::default() };
    let mut offset = 0u32;
    for g in list {
        out.position.extend_from_slice(&g.position);
        out.normal.extend_from_slice(&g.normal);
        out.uv.extend_from_slice(&g.uv);
        out.color.extend_from_slice(&g.color);
        if let (Some(target), Some(index)) = (&mut out.index, &g.index) { target.extend(index.iter().map(|i| i + offset)); }
        offset += g.count() as u32;
    }
    out
}

/// `BoxGeometry(width, height, depth, widthSegments, heightSegments, depthSegments)` (indexed).
pub fn box_geometry(width: f64, height: f64, depth: f64, ws: usize, hs: usize, ds: usize) -> Geo {
    let (mut vertices, mut normals, mut uvs, mut indices): (Vec<f64>, Vec<f64>, Vec<f64>, Vec<u32>) = (vec![], vec![], vec![], vec![]);
    let mut number_of_vertices = 0u32;
    // buildPlane(u, v, w, udir, vdir, width, height, depth, gridX, gridY)
    let mut plane = |u: usize, v: usize, w: usize, udir: f64, vdir: f64, width: f64, height: f64, depth: f64, grid_x: usize, grid_y: usize| {
        let segment_width = width / grid_x as f64;
        let segment_height = height / grid_y as f64;
        let (width_half, height_half, depth_half) = (width / 2.0, height / 2.0, depth / 2.0);
        let (grid_x1, grid_y1) = (grid_x + 1, grid_y + 1);
        let mut vertex_counter = 0u32;
        for iy in 0..grid_y1 {
            let y = iy as f64 * segment_height - height_half;
            for ix in 0..grid_x1 {
                let x = ix as f64 * segment_width - width_half;
                let mut vector = [0.0f64; 3];
                vector[u] = x * udir; vector[v] = y * vdir; vector[w] = depth_half;
                vertices.extend(vector);
                let mut vector = [0.0f64; 3];
                vector[u] = 0.0; vector[v] = 0.0; vector[w] = if depth > 0.0 { 1.0 } else { -1.0 };
                normals.extend(vector);
                uvs.push(ix as f64 / grid_x as f64);
                uvs.push(1.0 - (iy as f64 / grid_y as f64));
                vertex_counter += 1;
            }
        }
        for iy in 0..grid_y {
            for ix in 0..grid_x {
                let a = number_of_vertices + (ix + grid_x1 * iy) as u32;
                let b = number_of_vertices + (ix + grid_x1 * (iy + 1)) as u32;
                let c = number_of_vertices + ((ix + 1) + grid_x1 * (iy + 1)) as u32;
                let d = number_of_vertices + ((ix + 1) + grid_x1 * iy) as u32;
                indices.extend([a, b, d, b, c, d]);
            }
        }
        number_of_vertices += vertex_counter;
    };
    plane(2, 1, 0, -1.0, -1.0, depth, height, width, ds, hs); // px
    plane(2, 1, 0, 1.0, -1.0, depth, height, -width, ds, hs); // nx
    plane(0, 2, 1, 1.0, 1.0, width, depth, height, ws, ds); // py
    plane(0, 2, 1, 1.0, -1.0, width, depth, -height, ws, ds); // ny
    plane(0, 1, 2, 1.0, -1.0, width, height, depth, ws, hs); // pz
    plane(0, 1, 2, -1.0, -1.0, width, height, -depth, ws, hs); // nz
    Geo { position: f32s(&vertices), normal: f32s(&normals), uv: f32s(&uvs), color: Vec::new(), index: Some(indices) }
}

/// `RoundedBoxGeometry(width, height, depth, segments, radius)` (non-indexed).
pub fn rounded_box(width: f64, height: f64, depth: f64, segments: usize, radius: f64) -> Geo {
    // calculate total segments needed, odd so that a plane connects the rounded corners
    let total = segments * 2 + 1;
    let radius = jsmath::jmin(jsmath::jmin(jsmath::jmin(width / 2.0, height / 2.0), depth / 2.0), radius);
    let base = box_geometry(1.0, 1.0, 1.0, total, total, total);
    if total == 1 { return base; }
    let mut g = base.to_non_indexed();
    g.index = None;
    let bx = [width * 0.5 - radius, height * 0.5 - radius, depth * 0.5 - radius];
    let face_tris = g.position.len() / 6;
    let half_segment = 0.5 / total as f64;
    let sign = js_sign;
    let (mut i, mut j) = (0, 0);
    while i < g.position.len() {
        let position = [f64::from(g.position[i]), f64::from(g.position[i + 1]), f64::from(g.position[i + 2])];
        let mut normal = position;
        for a in 0..3 { normal[a] -= sign(normal[a]) * half_segment; }
        let normal = jsmath::normalize(normal);
        for a in 0..3 {
            g.position[i + a] = (bx[a] * sign(position[a]) + normal[a] * radius) as f32;
            g.normal[i + a] = normal[a] as f32;
        }
        let side = i / face_tris;
        let uv = |dir: Vec3, ua: usize, pa: usize, len: f64| rounded_uv(dir, normal, ua, pa, radius, len);
        let (u, v) = match side {
            0 => (uv([1.0, 0.0, 0.0], 2, 1, depth), 1.0 - uv([1.0, 0.0, 0.0], 1, 2, height)),
            1 => (1.0 - uv([-1.0, 0.0, 0.0], 2, 1, depth), 1.0 - uv([-1.0, 0.0, 0.0], 1, 2, height)),
            2 => (1.0 - uv([0.0, 1.0, 0.0], 0, 2, width), uv([0.0, 1.0, 0.0], 2, 0, depth)),
            3 => (1.0 - uv([0.0, -1.0, 0.0], 0, 2, width), 1.0 - uv([0.0, -1.0, 0.0], 2, 0, depth)),
            4 => (1.0 - uv([0.0, 0.0, 1.0], 0, 1, width), 1.0 - uv([0.0, 0.0, 1.0], 1, 0, height)),
            _ => (uv([0.0, 0.0, -1.0], 0, 1, width), 1.0 - uv([0.0, 0.0, -1.0], 1, 0, height)),
        };
        g.uv[j] = u as f32; g.uv[j + 1] = v as f32;
        i += 3; j += 2;
    }
    g
}
fn rounded_uv(face_dir: Vec3, normal: Vec3, uv_axis: usize, projection_axis: usize, radius: f64, side_length: f64) -> f64 {
    let total_arc = 2.0 * PI * radius / 4.0;
    // length of the planes between the arcs on each axis
    let center_length = jsmath::jmax(side_length - 2.0 * radius, 0.0);
    let half_arc = PI / 4.0;
    // the vector projected onto the plane of the projection axis
    let mut projected = normal;
    projected[projection_axis] = 0.0;
    let projected = jsmath::normalize(projected);
    // total amount of UV space allotted to a single arc
    let arc_uv_ratio = 0.5 * total_arc / (total_arc + center_length);
    // the distance along one arc the point is at
    let arc_angle_ratio = 1.0 - (angle_to(projected, face_dir) / half_arc);
    if js_sign(projected[uv_axis]) == 1.0 {
        arc_angle_ratio * arc_uv_ratio
    } else {
        // total amount of UV space allotted to the plane between the arcs
        let len_uv = center_length / (total_arc + center_length);
        len_uv + arc_uv_ratio + arc_uv_ratio * (1.0 - arc_angle_ratio)
    }
}
/// `Vector3#angleTo`.
pub fn angle_to(a: Vec3, b: Vec3) -> f64 {
    let denominator = (jsmath::length_sq(a) * jsmath::length_sq(b)).sqrt();
    if denominator == 0.0 { return PI / 2.0; }
    let theta = (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / denominator;
    Math::acos(jsmath::clamp(theta, -1.0, 1.0))
}

/// `CylinderGeometry(radiusTop, radiusBottom, height, radialSegments, heightSegments, openEnded, thetaStart, thetaLength)`.
#[allow(clippy::too_many_arguments)]
pub fn cylinder(radius_top: f64, radius_bottom: f64, height: f64, radial: usize, height_segments: usize, open_ended: bool, theta_start: f64, theta_length: f64) -> Geo {
    let (mut vertices, mut normals, mut uvs, mut indices): (Vec<f64>, Vec<f64>, Vec<f64>, Vec<u32>) = (vec![], vec![], vec![], vec![]);
    let mut index = 0u32;
    let mut index_array: Vec<Vec<u32>> = Vec::new();
    let half_height = height / 2.0;
    // torso
    {
        // this will be used to calculate the normal
        let slope = (radius_bottom - radius_top) / height;
        for y in 0..=height_segments {
            let mut row = Vec::new();
            let v = y as f64 / height_segments as f64;
            // the radius of the current row
            let radius = v * (radius_bottom - radius_top) + radius_top;
            for x in 0..=radial {
                let u = x as f64 / radial as f64;
                let theta = u * theta_length + theta_start;
                let (sin_theta, cos_theta) = (Math::sin(theta), Math::cos(theta));
                vertices.extend([radius * sin_theta, -v * height + half_height, radius * cos_theta]);
                let n = jsmath::normalize([sin_theta, slope, cos_theta]);
                normals.extend(n);
                uvs.extend([u, 1.0 - v]);
                row.push(index); index += 1;
            }
            index_array.push(row);
        }
        for x in 0..radial {
            for y in 0..height_segments {
                let (a, b, c, d) = (index_array[y][x], index_array[y + 1][x], index_array[y + 1][x + 1], index_array[y][x + 1]);
                if radius_top > 0.0 || y != 0 { indices.extend([a, b, d]); }
                if radius_bottom > 0.0 || y != height_segments - 1 { indices.extend([b, c, d]); }
            }
        }
    }
    let mut cap = |top: bool, index: &mut u32, vertices: &mut Vec<f64>, normals: &mut Vec<f64>, uvs: &mut Vec<f64>, indices: &mut Vec<u32>| {
        let center_start = *index;
        let radius = if top { radius_top } else { radius_bottom };
        let sign = if top { 1.0 } else { -1.0 };
        // one center vertex per face/segment
        for _ in 1..=radial {
            vertices.extend([0.0, half_height * sign, 0.0]);
            normals.extend([0.0, sign, 0.0]);
            uvs.extend([0.5, 0.5]);
            *index += 1;
        }
        let center_end = *index;
        for x in 0..=radial {
            let u = x as f64 / radial as f64;
            let theta = u * theta_length + theta_start;
            let (cos_theta, sin_theta) = (Math::cos(theta), Math::sin(theta));
            vertices.extend([radius * sin_theta, half_height * sign, radius * cos_theta]);
            normals.extend([0.0, sign, 0.0]);
            uvs.extend([(cos_theta * 0.5) + 0.5, (sin_theta * 0.5 * sign) + 0.5]);
            *index += 1;
        }
        for x in 0..radial as u32 {
            let c = center_start + x;
            let i = center_end + x;
            if top { indices.extend([i, i + 1, c]); } else { indices.extend([i + 1, i, c]); }
        }
    };
    if !open_ended {
        if radius_top > 0.0 { cap(true, &mut index, &mut vertices, &mut normals, &mut uvs, &mut indices); }
        if radius_bottom > 0.0 { cap(false, &mut index, &mut vertices, &mut normals, &mut uvs, &mut indices); }
    }
    Geo { position: f32s(&vertices), normal: f32s(&normals), uv: f32s(&uvs), color: Vec::new(), index: Some(indices) }
}

/// The Uint32 rule of `BufferGeometry#setIndex(array)`: any value of 65535 or more.
pub fn needs_uint32(index: &[u32]) -> bool { index.iter().any(|&i| i >= 65535) }

/// `LatheGeometry(points, segments)` for the full turn (`phiStart` 0, `phiLength` 2 pi). The last point keeps
/// the previous segment's raw (unnormalised) normal, as three does.
pub fn lathe(points: &[[f64; 2]], segments: usize) -> Geo {
    let phi_length = jsmath::clamp(PI * 2.0, 0.0, PI * 2.0);
    let n = points.len();
    let inverse_segments = 1.0 / segments as f64;
    let mut init_normals: Vec<f64> = Vec::with_capacity(n * 3);
    let mut prev_normal = [0.0f64; 3];
    for j in 0..n {
        if j == 0 {
            let (dx, dy) = (points[1][0] - points[0][0], points[1][1] - points[0][1]);
            let normal = [dy * 1.0, -dx, dy * 0.0];
            prev_normal = normal;
            init_normals.extend(jsmath::normalize(normal));
        } else if j == n - 1 {
            init_normals.extend(prev_normal);
        } else {
            let (dx, dy) = (points[j + 1][0] - points[j][0], points[j + 1][1] - points[j][1]);
            let normal = [dy * 1.0, -dx, dy * 0.0];
            let cur_normal = normal;
            init_normals.extend(jsmath::normalize([normal[0] + prev_normal[0], normal[1] + prev_normal[1], normal[2] + prev_normal[2]]));
            prev_normal = cur_normal;
        }
    }
    let (mut vertices, mut normals, mut uvs, mut indices): (Vec<f64>, Vec<f64>, Vec<f64>, Vec<u32>) = (vec![], vec![], vec![], vec![]);
    for i in 0..=segments {
        let phi = 0.0 + i as f64 * inverse_segments * phi_length;
        let (sin, cos) = (Math::sin(phi), Math::cos(phi));
        for j in 0..n {
            vertices.extend([points[j][0] * sin, points[j][1], points[j][0] * cos]);
            uvs.extend([i as f64 / segments as f64, j as f64 / (n - 1) as f64]);
            normals.extend([init_normals[3 * j] * sin, init_normals[3 * j + 1], init_normals[3 * j] * cos]);
        }
    }
    for i in 0..segments {
        for j in 0..n - 1 {
            let base = (j + i * n) as u32;
            let (a, b, c, d) = (base, base + n as u32, base + n as u32 + 1, base + 1);
            indices.extend([a, b, d, c, d, b]);
        }
    }
    Geo { position: f32s(&vertices), normal: f32s(&normals), uv: f32s(&uvs), color: Vec::new(), index: Some(indices) }
}

/// `TorusGeometry(radius, tube, radialSegments, tubularSegments)` for the full turn.
pub fn torus(radius: f64, tube: f64, radial: usize, tubular: usize) -> Geo { torus_arc(radius, tube, radial, tubular, PI * 2.0) }

/// `TorusGeometry(radius, tube, radialSegments, tubularSegments, arc)`.
pub fn torus_arc(radius: f64, tube: f64, radial: usize, tubular: usize, arc: f64) -> Geo {
    let (mut vertices, mut normals, mut uvs, mut indices): (Vec<f64>, Vec<f64>, Vec<f64>, Vec<u32>) = (vec![], vec![], vec![], vec![]);
    for j in 0..=radial {
        for i in 0..=tubular {
            let u = i as f64 / tubular as f64 * arc;
            let v = j as f64 / radial as f64 * PI * 2.0;
            let vertex = [(radius + tube * Math::cos(v)) * Math::cos(u), (radius + tube * Math::cos(v)) * Math::sin(u), tube * Math::sin(v)];
            vertices.extend(vertex);
            let center = [radius * Math::cos(u), radius * Math::sin(u), 0.0];
            normals.extend(jsmath::normalize(jsmath::sub(vertex, center)));
            uvs.push(i as f64 / tubular as f64);
            uvs.push(j as f64 / radial as f64);
        }
    }
    for j in 1..=radial {
        for i in 1..=tubular {
            let a = ((tubular + 1) * j + i - 1) as u32;
            let b = ((tubular + 1) * (j - 1) + i - 1) as u32;
            let c = ((tubular + 1) * (j - 1) + i) as u32;
            let d = ((tubular + 1) * j + i) as u32;
            indices.extend([a, b, d, b, c, d]);
        }
    }
    Geo { position: f32s(&vertices), normal: f32s(&normals), uv: f32s(&uvs), color: Vec::new(), index: Some(indices) }
}

/// `SphereGeometry(radius, widthSegments, heightSegments)` for the whole sphere.
pub fn sphere(radius: f64, width_segments: usize, height_segments: usize) -> Geo {
    let width_segments = width_segments.max(3);
    let height_segments = height_segments.max(2);
    let (theta_start, theta_length, phi_start, phi_length) = (0.0, PI, 0.0, PI * 2.0);
    let theta_end = jsmath::jmin(theta_start + theta_length, PI);
    let (mut vertices, mut normals, mut uvs, mut indices): (Vec<f64>, Vec<f64>, Vec<f64>, Vec<u32>) = (vec![], vec![], vec![], vec![]);
    let mut index = 0u32;
    let mut grid: Vec<Vec<u32>> = Vec::new();
    for iy in 0..=height_segments {
        let mut row = Vec::new();
        let v = iy as f64 / height_segments as f64;
        let mut u_offset = 0.0;
        if iy == 0 && theta_start == 0.0 { u_offset = 0.5 / width_segments as f64; }
        else if iy == height_segments && theta_end == PI { u_offset = -0.5 / width_segments as f64; }
        for ix in 0..=width_segments {
            let u = ix as f64 / width_segments as f64;
            let vertex = [-radius * Math::cos(phi_start + u * phi_length) * Math::sin(theta_start + v * theta_length),
                radius * Math::cos(theta_start + v * theta_length),
                radius * Math::sin(phi_start + u * phi_length) * Math::sin(theta_start + v * theta_length)];
            vertices.extend(vertex);
            normals.extend(jsmath::normalize(vertex));
            uvs.extend([u + u_offset, 1.0 - v]);
            row.push(index);
            index += 1;
        }
        grid.push(row);
    }
    for iy in 0..height_segments {
        for ix in 0..width_segments {
            let (a, b, c, d) = (grid[iy][ix + 1], grid[iy][ix], grid[iy + 1][ix], grid[iy + 1][ix + 1]);
            if iy != 0 || theta_start > 0.0 { indices.extend([a, b, d]); }
            if iy != height_segments - 1 || theta_end < PI { indices.extend([b, c, d]); }
        }
    }
    Geo { position: f32s(&vertices), normal: f32s(&normals), uv: f32s(&uvs), color: Vec::new(), index: Some(indices) }
}

/// `IcosahedronGeometry(radius, 0)` without its UVs (every caller replaces them): non-indexed, flat normals.
pub fn icosahedron(radius: f64) -> Geo {
    let t = (1.0 + 5.0f64.sqrt()) / 2.0;
    let vertices: [f64; 36] = [-1.0, t, 0.0, 1.0, t, 0.0, -1.0, -t, 0.0, 1.0, -t, 0.0, 0.0, -1.0, t, 0.0, 1.0, t, 0.0, -1.0, -t, 0.0, 1.0, -t,
        t, 0.0, -1.0, t, 0.0, 1.0, -t, 0.0, -1.0, -t, 0.0, 1.0];
    let indices: [usize; 60] = [0, 11, 5, 0, 5, 1, 0, 1, 7, 0, 7, 10, 0, 10, 11, 1, 5, 9, 5, 11, 4, 11, 10, 2, 10, 7, 6, 7, 1, 8,
        3, 9, 4, 3, 4, 2, 3, 2, 6, 3, 6, 8, 3, 8, 9, 4, 9, 5, 2, 4, 11, 6, 2, 10, 8, 6, 7, 9, 8, 1];
    let lerp = |a: Vec3, b: Vec3, alpha: f64| -> Vec3 { [a[0] + (b[0] - a[0]) * alpha, a[1] + (b[1] - a[1]) * alpha, a[2] + (b[2] - a[2]) * alpha] };
    let mut buffer: Vec<f64> = Vec::with_capacity(180);
    for face in indices.chunks_exact(3) {
        let at = |k: usize| -> Vec3 { [vertices[face[k] * 3], vertices[face[k] * 3 + 1], vertices[face[k] * 3 + 2]] };
        let (a, b, c) = (at(0), at(1), at(2));
        // subdivideFace(a, b, c, 0): the first triangle of the one-column lattice
        let aj0 = lerp(a, c, 0.0);
        let bj0 = lerp(b, c, 0.0);
        let v00 = lerp(aj0, bj0, 0.0);
        let v01 = lerp(aj0, bj0, 1.0);
        let v10 = lerp(a, c, 1.0);
        for p in [v01, v10, v00] { buffer.extend(jsmath::normalize(p).map(|x| x * radius)); }
    }
    let mut geo = Geo { position: f32s(&buffer), normal: Vec::new(), uv: Vec::new(), color: Vec::new(), index: None };
    geo.compute_vertex_normals();
    geo
}

/// `rotateX(angle)`: `Matrix4#makeRotationX` with the host's cos/sin.
pub fn rotate_x(geo: &mut Geo, angle: f64) {
    let (c, s) = (Math::cos(angle), Math::sin(angle));
    geo.apply_matrix4(&Mat4([1.0, 0.0, 0.0, 0.0, 0.0, c, s, 0.0, 0.0, -s, c, 0.0, 0.0, 0.0, 0.0, 1.0]));
}

/// `CapsuleGeometry(radius, height, capSegments, radialSegments, heightSegments)` of three r180: a profile of
/// two quarter circles and a straight wall swept around y, with arc-length v coordinates.
pub fn capsule(radius: f64, height: f64, cap_segments: f64, radial_segments: f64, height_segments: f64) -> Geo {
    let height = jsmath::jmax(0.0, height);
    let cap_segments = jsmath::jmax(1.0, cap_segments.floor()) as usize;
    let radial_segments = jsmath::jmax(3.0, radial_segments.floor()) as usize;
    let height_segments = jsmath::jmax(1.0, height_segments.floor()) as usize;
    let (mut vertices, mut normals, mut uvs, mut indices): (Vec<f64>, Vec<f64>, Vec<f64>, Vec<u32>) = (vec![], vec![], vec![], vec![]);
    let half_height = height / 2.0;
    let cap_arc_length = (PI / 2.0) * radius;
    let cylinder_part_length = height;
    let total_arc_length = 2.0 * cap_arc_length + cylinder_part_length;
    let vertical = cap_segments * 2 + height_segments;
    let per_row = radial_segments + 1;
    for iy in 0..=vertical {
        let (profile_y, profile_radius, normal_y, arc_length);
        if iy <= cap_segments {
            // bottom cap
            let progress = iy as f64 / cap_segments as f64;
            let angle = (progress * PI) / 2.0;
            profile_y = -half_height - radius * Math::cos(angle);
            profile_radius = radius * Math::sin(angle);
            normal_y = -radius * Math::cos(angle);
            arc_length = progress * cap_arc_length;
        } else if iy <= cap_segments + height_segments {
            // middle section
            let progress = (iy - cap_segments) as f64 / height_segments as f64;
            profile_y = -half_height + progress * height;
            profile_radius = radius;
            normal_y = 0.0;
            arc_length = cap_arc_length + progress * cylinder_part_length;
        } else {
            // top cap
            let progress = (iy - cap_segments - height_segments) as f64 / cap_segments as f64;
            let angle = (progress * PI) / 2.0;
            profile_y = half_height + radius * Math::sin(angle);
            profile_radius = radius * Math::cos(angle);
            normal_y = radius * Math::sin(angle);
            arc_length = cap_arc_length + cylinder_part_length + progress * cap_arc_length;
        }
        let v = jsmath::jmax(0.0, jsmath::jmin(1.0, arc_length / total_arc_length));
        // the poles
        let u_offset = if iy == 0 { 0.5 / radial_segments as f64 } else if iy == vertical { -0.5 / radial_segments as f64 } else { 0.0 };
        for ix in 0..=radial_segments {
            let u = ix as f64 / radial_segments as f64;
            let theta = u * PI * 2.0;
            let (sin, cos) = (Math::sin(theta), Math::cos(theta));
            vertices.extend([-profile_radius * cos, profile_y, profile_radius * sin]);
            normals.extend(jsmath::normalize([-profile_radius * cos, normal_y, profile_radius * sin]));
            uvs.extend([u + u_offset, v]);
        }
        if iy > 0 {
            let previous = (iy - 1) * per_row;
            for ix in 0..radial_segments {
                let (i1, i2, i3, i4) = (previous + ix, previous + ix + 1, iy * per_row + ix, iy * per_row + ix + 1);
                indices.extend([i1 as u32, i2 as u32, i3 as u32, i2 as u32, i4 as u32, i3 as u32]);
            }
        }
    }
    Geo { position: f32s(&vertices), normal: f32s(&normals), uv: f32s(&uvs), color: Vec::new(), index: Some(indices) }
}

/// `PlaneGeometry(width, height, widthSegments, heightSegments)`.
pub fn plane(width: f64, height: f64, width_segments: f64, height_segments: f64) -> Geo {
    let (width_half, height_half) = (width / 2.0, height / 2.0);
    let (grid_x, grid_y) = (width_segments.floor() as usize, height_segments.floor() as usize);
    let (grid_x1, grid_y1) = (grid_x + 1, grid_y + 1);
    let (segment_width, segment_height) = (width / grid_x as f64, height / grid_y as f64);
    let (mut vertices, mut normals, mut uvs, mut indices): (Vec<f64>, Vec<f64>, Vec<f64>, Vec<u32>) = (vec![], vec![], vec![], vec![]);
    for iy in 0..grid_y1 {
        let y = iy as f64 * segment_height - height_half;
        for ix in 0..grid_x1 {
            let x = ix as f64 * segment_width - width_half;
            vertices.extend([x, -y, 0.0]);
            normals.extend([0.0, 0.0, 1.0]);
            uvs.extend([ix as f64 / grid_x as f64, 1.0 - (iy as f64 / grid_y as f64)]);
        }
    }
    for iy in 0..grid_y {
        for ix in 0..grid_x {
            let a = (ix + grid_x1 * iy) as u32;
            let b = (ix + grid_x1 * (iy + 1)) as u32;
            let c = ((ix + 1) + grid_x1 * (iy + 1)) as u32;
            let d = ((ix + 1) + grid_x1 * iy) as u32;
            indices.extend([a, b, d, b, c, d]);
        }
    }
    Geo { position: f32s(&vertices), normal: f32s(&normals), uv: f32s(&uvs), color: Vec::new(), index: Some(indices) }
}

/// `ToInt32` (`~~x`) of a finite or non-finite number.
fn to_int32(value: f64) -> i32 { if value.is_finite() { value.trunc().rem_euclid(4294967296.0) as u64 as u32 as i32 } else { 0 } }

/// `toCreasedNormals(geometry, creaseAngle)` of three's BufferGeometryUtils: the triangle soup (an indexed
/// geometry is first made non-indexed) gets, at each corner, the sum of the face normals that share its
/// hashed position and lie within the crease angle of its own face, normalised.
pub fn creased_normals(geo: &Geo, crease_angle: f64) -> Geo {
    let mut out = geo.to_non_indexed();
    let crease_dot = Math::cos(crease_angle);
    let multiplier = (1.0 + 1e-10) * 1e2;
    let hash = |v: Vec3| (to_int32(v[0] * multiplier), to_int32(v[1] * multiplier), to_int32(v[2] * multiplier));
    let faces = out.count() / 3;
    let face = |p: &[f32], i: usize| -> (Vec3, Vec3, Vec3, Vec3) {
        let (a, b, c) = (v3(p, i * 3), v3(p, i * 3 + 1), v3(p, i * 3 + 2));
        (a, b, c, jsmath::normalize(jsmath::cross(jsmath::sub(c, b), jsmath::sub(a, b))))
    };
    let mut map: std::collections::HashMap<(i32, i32, i32), Vec<Vec3>> = std::collections::HashMap::new();
    for i in 0..faces {
        let (a, b, c, normal) = face(&out.position, i);
        for vert in [a, b, c] { map.entry(hash(vert)).or_default().push(normal); }
    }
    let mut normals = vec![0.0f32; out.count() * 3];
    for i in 0..faces {
        let (a, b, c, own) = face(&out.position, i);
        for (n, vert) in [a, b, c].into_iter().enumerate() {
            let mut sum = [0.0f64; 3];
            for other in &map[&hash(vert)] {
                if own[0] * other[0] + own[1] * other[1] + own[2] * other[2] > crease_dot { sum = [sum[0] + other[0], sum[1] + other[1], sum[2] + other[2]]; }
            }
            put(&mut normals, i * 3 + n, jsmath::normalize(sum));
        }
    }
    out.normal = normals;
    out
}
