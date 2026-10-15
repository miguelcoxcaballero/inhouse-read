//! three.js curves and the geometries swept along them: `CatmullRomCurve3` (centripetal, open), the arc-length
//! parametrisation of `Curve`, `Curve#computeFrenetFrames` and `TubeGeometry`, with three's own operation
//! order (f64 arithmetic, the host's `Math.sin/cos/acos/pow`), plus `Quaternion#setFromEuler`.
use crate::jsmath::{self, Mat4, Vec3};
use crate::three_geo::Geo;
use crate::three_geo::f32s;
use js_sys::Math;
use std::cell::RefCell;
use std::f64::consts::PI;

/// `Quaternion#setFromEuler` for the default `XYZ` order, as `[x, y, z, w]`.
pub fn quaternion_from_euler(x: f64, y: f64, z: f64) -> [f64; 4] {
    let (c1, c2, c3) = (Math::cos(x / 2.0), Math::cos(y / 2.0), Math::cos(z / 2.0));
    let (s1, s2, s3) = (Math::sin(x / 2.0), Math::sin(y / 2.0), Math::sin(z / 2.0));
    [s1 * c2 * c3 + c1 * s2 * s3, c1 * s2 * c3 - s1 * c2 * s3, c1 * c2 * s3 + s1 * s2 * c3, c1 * c2 * c3 - s1 * s2 * s3]
}

/// `Quaternion#setFromAxisAngle` for a unit axis, as `[x, y, z, w]`.
pub fn quaternion_from_axis_angle(axis: Vec3, angle: f64) -> [f64; 4] {
    let half = angle / 2.0;
    let s = Math::sin(half);
    [axis[0] * s, axis[1] * s, axis[2] * s, Math::cos(half)]
}

/// `Quaternion#multiply(b)` (this = this * b).
pub fn quaternion_multiply(a: [f64; 4], b: [f64; 4]) -> [f64; 4] {
    let (qax, qay, qaz, qaw) = (a[0], a[1], a[2], a[3]);
    let (qbx, qby, qbz, qbw) = (b[0], b[1], b[2], b[3]);
    [qax * qbw + qaw * qbx + qay * qbz - qaz * qby,
     qay * qbw + qaw * qby + qaz * qbx - qax * qbz,
     qaz * qbw + qaw * qbz + qax * qby - qay * qbx,
     qaw * qbw - qax * qbx - qay * qby - qaz * qbz]
}

/// `Matrix4#makeRotationAxis(axis, angle)`.
pub fn rotation_axis(axis: Vec3, angle: f64) -> Mat4 {
    let c = Math::cos(angle);
    let s = Math::sin(angle);
    let t = 1.0 - c;
    let (x, y, z) = (axis[0], axis[1], axis[2]);
    let (tx, ty) = (t * x, t * y);
    // `set` takes its arguments row by row; the elements are stored column-major
    let rows = [
        [tx * x + c, tx * y - s * z, tx * z + s * y, 0.0],
        [tx * y + s * z, ty * y + c, ty * z - s * x, 0.0],
        [tx * z - s * y, ty * z + s * x, t * z * z + c, 0.0],
        [0.0, 0.0, 0.0, 1.0],
    ];
    let mut e = [0.0; 16];
    for r in 0..4 { for c in 0..4 { e[c * 4 + r] = rows[r][c]; } }
    Mat4(e)
}

fn add(a: Vec3, b: Vec3) -> Vec3 { [a[0] + b[0], a[1] + b[1], a[2] + b[2]] }
fn distance_sq(a: Vec3, b: Vec3) -> f64 { let (dx, dy, dz) = (a[0] - b[0], a[1] - b[1], a[2] - b[2]); dx * dx + dy * dy + dz * dz }
fn dot(a: Vec3, b: Vec3) -> f64 { a[0] * b[0] + a[1] * b[1] + a[2] * b[2] }

/// One axis of a non-uniform Catmull-Rom segment: `c0 + c1 t + c2 t^2 + c3 t^3`.
struct CubicPoly { c0: f64, c1: f64, c2: f64, c3: f64 }
impl CubicPoly {
    fn nonuniform(x0: f64, x1: f64, x2: f64, x3: f64, dt0: f64, dt1: f64, dt2: f64) -> CubicPoly {
        let mut t1 = (x1 - x0) / dt0 - (x2 - x0) / (dt0 + dt1) + (x2 - x1) / dt1;
        let mut t2 = (x2 - x1) / dt1 - (x3 - x1) / (dt1 + dt2) + (x3 - x2) / dt2;
        t1 *= dt1;
        t2 *= dt1;
        // init(x1, x2, t1, t2)
        let (a, b, ta, tb) = (x1, x2, t1, t2);
        CubicPoly { c0: a, c1: ta, c2: -3.0 * a + 3.0 * b - 2.0 * ta - tb, c3: 2.0 * a - 2.0 * b + ta + tb }
    }
    fn calc(&self, t: f64) -> f64 {
        let t2 = t * t;
        let t3 = t2 * t;
        self.c0 + self.c1 * t + self.c2 * t2 + self.c3 * t3
    }
}

/// `CatmullRomCurve3(points)` (open, centripetal) with `Curve`'s arc-length cache (200 divisions).
pub struct CatmullRom { points: Vec<Vec3>, lengths: RefCell<Option<Vec<f64>>> }

impl CatmullRom {
    pub fn new(points: Vec<Vec3>) -> CatmullRom { CatmullRom { points, lengths: RefCell::new(None) } }

    /// `getPoint(t)`.
    pub fn point(&self, t: f64) -> Vec3 {
        let points = &self.points;
        let l = points.len();
        let p = (l as f64 - 1.0) * t;
        let mut int_point = p.floor();
        let mut weight = p - int_point;
        if weight == 0.0 && int_point == l as f64 - 1.0 {
            int_point = l as f64 - 2.0;
            weight = 1.0;
        }
        // `p0` and `p3` are either a point of the curve or the one scratch vector `tmp` of three's module,
        // which the second reflection overwrites (a curve of two points sees the later value in both).
        let at = |i: f64| -> Vec3 { points[(i.rem_euclid(l as f64)) as usize] };
        let mut tmp = [0.0; 3];
        let mut p0_tmp = false;
        let p0 = if int_point > 0.0 { at(int_point - 1.0) } else {
            tmp = add(jsmath::sub(points[0], points[1]), points[0]);
            p0_tmp = true;
            [0.0; 3]
        };
        let p1 = at(int_point);
        let p2 = at(int_point + 1.0);
        let mut p3_tmp = false;
        let p3 = if int_point + 2.0 < l as f64 { at(int_point + 2.0) } else {
            tmp = add(jsmath::sub(points[l - 1], points[l - 2]), points[l - 1]);
            p3_tmp = true;
            [0.0; 3]
        };
        let p0 = if p0_tmp { tmp } else { p0 };
        let p3 = if p3_tmp { tmp } else { p3 };
        let pow = 0.25;
        let mut dt0 = Math::pow(distance_sq(p0, p1), pow);
        let mut dt1 = Math::pow(distance_sq(p1, p2), pow);
        let mut dt2 = Math::pow(distance_sq(p2, p3), pow);
        // safety check for repeated points
        if dt1 < 1e-4 { dt1 = 1.0; }
        if dt0 < 1e-4 { dt0 = dt1; }
        if dt2 < 1e-4 { dt2 = dt1; }
        let px = CubicPoly::nonuniform(p0[0], p1[0], p2[0], p3[0], dt0, dt1, dt2);
        let py = CubicPoly::nonuniform(p0[1], p1[1], p2[1], p3[1], dt0, dt1, dt2);
        let pz = CubicPoly::nonuniform(p0[2], p1[2], p2[2], p3[2], dt0, dt1, dt2);
        [px.calc(weight), py.calc(weight), pz.calc(weight)]
    }

    /// `getLengths()`: cumulative chord lengths at 200 divisions, computed once.
    fn ensure_lengths(&self) {
        if self.lengths.borrow().is_some() { return; }
        let divisions = 200usize;
        let mut cache = vec![0.0];
        let mut last = self.point(0.0);
        let mut sum = 0.0;
        for p in 1..=divisions {
            let current = self.point(p as f64 / divisions as f64);
            sum += distance_sq(current, last).sqrt();
            cache.push(sum);
            last = current;
        }
        *self.lengths.borrow_mut() = Some(cache);
    }

    /// `getUtoTmapping(u)`.
    pub fn u_to_t(&self, u: f64) -> f64 {
        self.ensure_lengths();
        let guard = self.lengths.borrow();
        let lengths = guard.as_ref().unwrap();
        let il = lengths.len() as i64;
        let target = u * lengths[(il - 1) as usize];
        let (mut low, mut high) = (0i64, il - 1);
        while low <= high {
            let i = low + (high - low) / 2;
            let comparison = lengths[i as usize] - target;
            if comparison < 0.0 { low = i + 1; }
            else if comparison > 0.0 { high = i - 1; }
            else { high = i; break; }
        }
        let i = high;
        let get = |k: i64| -> f64 { if k >= 0 && k < il { lengths[k as usize] } else { f64::NAN } };
        if get(i) == target { return i as f64 / (il - 1) as f64; }
        let (before, after) = (get(i), get(i + 1));
        let fraction = (target - before) / (after - before);
        (i as f64 + fraction) / (il - 1) as f64
    }

    pub fn point_at(&self, u: f64) -> Vec3 { self.point(self.u_to_t(u)) }

    /// `getTangent(t)`.
    pub fn tangent(&self, t: f64) -> Vec3 {
        let delta = 0.0001;
        let mut t1 = t - delta;
        let mut t2 = t + delta;
        if t1 < 0.0 { t1 = 0.0; }
        if t2 > 1.0 { t2 = 1.0; }
        jsmath::normalize(jsmath::sub(self.point(t2), self.point(t1)))
    }
    pub fn tangent_at(&self, u: f64) -> Vec3 { self.tangent(self.u_to_t(u)) }

    /// `computeFrenetFrames(segments, false)`: tangents, normals and binormals.
    pub fn frenet_frames(&self, segments: usize) -> (Vec<Vec3>, Vec<Vec3>, Vec<Vec3>) {
        let tangents: Vec<Vec3> = (0..=segments).map(|i| self.tangent_at(i as f64 / segments as f64)).collect();
        let mut normals = vec![[0.0; 3]; segments + 1];
        let mut binormals = vec![[0.0; 3]; segments + 1];
        let mut min = f64::MAX;
        let (tx, ty, tz) = (tangents[0][0].abs(), tangents[0][1].abs(), tangents[0][2].abs());
        let mut normal = [0.0; 3];
        if tx <= min { min = tx; normal = [1.0, 0.0, 0.0]; }
        if ty <= min { min = ty; normal = [0.0, 1.0, 0.0]; }
        if tz <= min { normal = [0.0, 0.0, 1.0]; }
        let vec = jsmath::normalize(jsmath::cross(tangents[0], normal));
        normals[0] = jsmath::cross(tangents[0], vec);
        binormals[0] = jsmath::cross(tangents[0], normals[0]);
        for i in 1..=segments {
            normals[i] = normals[i - 1];
            binormals[i] = binormals[i - 1];
            let vec = jsmath::cross(tangents[i - 1], tangents[i]);
            if jsmath::length(vec) > f64::EPSILON {
                let vec = jsmath::normalize(vec);
                let theta = Math::acos(jsmath::clamp(dot(tangents[i - 1], tangents[i]), -1.0, 1.0));
                normals[i] = rotation_axis(vec, theta).apply(normals[i]);
            }
            binormals[i] = jsmath::cross(tangents[i], normals[i]);
        }
        (tangents, normals, binormals)
    }
}

/// `TubeGeometry(path, tubularSegments, radius, radialSegments, false)`.
pub fn tube(path: &CatmullRom, tubular: usize, radius: f64, radial: usize) -> Geo {
    let (_, normals_frame, binormals_frame) = path.frenet_frames(tubular);
    let (mut vertices, mut normals, mut uvs, mut indices): (Vec<f64>, Vec<f64>, Vec<f64>, Vec<u32>) = (vec![], vec![], vec![], vec![]);
    let mut segment = |i: usize| {
        let p = path.point_at(i as f64 / tubular as f64);
        let (n, b) = (normals_frame[i], binormals_frame[i]);
        for j in 0..=radial {
            let v = j as f64 / radial as f64 * PI * 2.0;
            let sin = Math::sin(v);
            let cos = -Math::cos(v);
            let normal = jsmath::normalize([cos * n[0] + sin * b[0], cos * n[1] + sin * b[1], cos * n[2] + sin * b[2]]);
            normals.extend(normal);
            vertices.extend([p[0] + radius * normal[0], p[1] + radius * normal[1], p[2] + radius * normal[2]]);
        }
    };
    for i in 0..tubular { segment(i); }
    segment(tubular);
    for i in 0..=tubular { for j in 0..=radial { uvs.push(i as f64 / tubular as f64); uvs.push(j as f64 / radial as f64); } }
    for j in 1..=tubular {
        for i in 1..=radial {
            let a = ((radial + 1) * (j - 1) + (i - 1)) as u32;
            let b = ((radial + 1) * j + (i - 1)) as u32;
            let c = ((radial + 1) * j + i) as u32;
            let d = ((radial + 1) * (j - 1) + i) as u32;
            indices.extend([a, b, d, b, c, d]);
        }
    }
    Geo { position: f32s(&vertices), normal: f32s(&normals), uv: f32s(&uvs), color: Vec::new(), index: Some(indices) }
}
