//! three.js vector, quaternion, Euler and colour arithmetic, in three's own order of operations (f64 throughout,
//! the host's `Math.pow/asin/atan2` for the transcendentals).
use crate::jsmath::{self, Mat4, Vec3};
use js_sys::Math;

pub fn add(a: Vec3, b: Vec3) -> Vec3 { [a[0] + b[0], a[1] + b[1], a[2] + b[2]] }
pub fn scale(a: Vec3, s: f64) -> Vec3 { [a[0] * s, a[1] * s, a[2] * s] }
pub fn dot(a: Vec3, b: Vec3) -> f64 { a[0] * b[0] + a[1] * b[1] + a[2] * b[2] }
/// `Vector3#lerp(v, alpha)`.
pub fn lerp(a: Vec3, b: Vec3, alpha: f64) -> Vec3 { [a[0] + (b[0] - a[0]) * alpha, a[1] + (b[1] - a[1]) * alpha, a[2] + (b[2] - a[2]) * alpha] }
/// `Vector3#addScaledVector(v, s)`.
pub fn add_scaled(a: Vec3, v: Vec3, s: f64) -> Vec3 { [a[0] + v[0] * s, a[1] + v[1] * s, a[2] + v[2] * s] }

/// `Vector3#applyQuaternion(q)` (`q` as `[x, y, z, w]`).
pub fn apply_quaternion(v: Vec3, q: [f64; 4]) -> Vec3 {
    let (vx, vy, vz) = (v[0], v[1], v[2]);
    let (qx, qy, qz, qw) = (q[0], q[1], q[2], q[3]);
    let tx = 2.0 * (qy * vz - qz * vy);
    let ty = 2.0 * (qz * vx - qx * vz);
    let tz = 2.0 * (qx * vy - qy * vx);
    [vx + qw * tx + qy * tz - qz * ty, vy + qw * ty + qz * tx - qx * tz, vz + qw * tz + qx * ty - qy * tx]
}

/// `Vector3#projectOnPlane(normal)`.
pub fn project_on_plane(v: Vec3, normal: Vec3) -> Vec3 {
    let denominator = jsmath::length_sq(normal);
    let projected = if denominator == 0.0 { [0.0, 0.0, 0.0] } else { scale(normal, dot(normal, v) / denominator) };
    jsmath::sub(v, projected)
}

/// `Euler#setFromQuaternion(q)` in the default `XYZ` order, as `[x, y, z]`.
pub fn euler_from_quaternion(q: [f64; 4]) -> [f64; 3] {
    let te = Mat4::compose([0.0; 3], q, [1.0; 3]).0;
    let (m11, m12, m13) = (te[0], te[4], te[8]);
    let (m22, m23) = (te[5], te[9]);
    let (m32, m33) = (te[6], te[10]);
    let y = Math::asin(jsmath::clamp(m13, -1.0, 1.0));
    if m13.abs() < 0.9999999 { [Math::atan2(-m23, m33), y, Math::atan2(-m12, m11)] }
    else { [Math::atan2(m32, m22), y, 0.0] }
}

/// `SRGBToLinear`.
pub fn srgb_to_linear(c: f64) -> f64 { if c < 0.04045 { c * 0.0773993808 } else { Math::pow(c * 0.9478672986 + 0.0521327014, 2.4) } }
/// `new Color(hex)`: the sRGB colour of a 24-bit number in the linear working space.
pub fn color(hex: u32) -> [f64; 3] {
    let channel = |shift: u32| srgb_to_linear(f64::from((hex >> shift) & 255) / 255.0);
    [channel(16), channel(8), channel(0)]
}
/// `Color#lerp(other, alpha)`.
pub fn color_lerp(a: [f64; 3], b: [f64; 3], alpha: f64) -> [f64; 3] { [a[0] + (b[0] - a[0]) * alpha, a[1] + (b[1] - a[1]) * alpha, a[2] + (b[2] - a[2]) * alpha] }
