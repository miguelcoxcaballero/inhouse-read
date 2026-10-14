//! JavaScript's `Math.max/min/sign` semantics and Three's f64 vector, box and matrix
//! operations, in the exact operation order of three@0.180 (no fused multiply-add,
//! `normalize` multiplies by `1 / length`). Browser-only functions (sin, cos, exp, pow, log)
//! are not used here: callers receive those values from the host.
pub type Vec3 = [f64; 3];

pub fn jmax(a: f64, b: f64) -> f64 {
    if a.is_nan() || b.is_nan() { f64::NAN }
    else if a == 0.0 && b == 0.0 { if a.is_sign_negative() { b } else { a } }
    else if a > b { a } else { b }
}
pub fn jmin(a: f64, b: f64) -> f64 {
    if a.is_nan() || b.is_nan() { f64::NAN }
    else if a == 0.0 && b == 0.0 { if a.is_sign_negative() { a } else { b } }
    else if a < b { a } else { b }
}
/// `THREE.MathUtils.clamp`: `Math.max(min, Math.min(max, value))`.
pub fn clamp(value: f64, low: f64, high: f64) -> f64 { jmax(low, jmin(high, value)) }

pub fn sub(a: Vec3, b: Vec3) -> Vec3 { [a[0] - b[0], a[1] - b[1], a[2] - b[2]] }
pub fn length_sq(a: Vec3) -> f64 { a[0] * a[0] + a[1] * a[1] + a[2] * a[2] }
pub fn length(a: Vec3) -> f64 { length_sq(a).sqrt() }
/// `x || 1` for the length, then `multiplyScalar(1 / length)`.
pub fn normalize(a: Vec3) -> Vec3 {
    let l = length(a);
    let divisor = if l != 0.0 && !l.is_nan() { l } else { 1.0 };
    let inverse = 1.0 / divisor;
    [a[0] * inverse, a[1] * inverse, a[2] * inverse]
}
pub fn cross(a: Vec3, b: Vec3) -> Vec3 {
    [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}
pub fn distance(a: Vec3, b: Vec3) -> f64 { let d = sub(a, b); length_sq(d).sqrt() }

#[derive(Clone, Copy)]
pub struct Mat4(pub [f64; 16]);
impl Mat4 {
    pub fn identity() -> Mat4 { let mut e = [0.0; 16]; e[0] = 1.0; e[5] = 1.0; e[10] = 1.0; e[15] = 1.0; Mat4(e) }
    /// `Vector3#applyMatrix4`, including the projective divide.
    pub fn apply(&self, p: Vec3) -> Vec3 {
        let e = &self.0;
        let (x, y, z) = (p[0], p[1], p[2]);
        let w = 1.0 / (e[3] * x + e[7] * y + e[11] * z + e[15]);
        [(e[0] * x + e[4] * y + e[8] * z + e[12]) * w, (e[1] * x + e[5] * y + e[9] * z + e[13]) * w, (e[2] * x + e[6] * y + e[10] * z + e[14]) * w]
    }
    /// `Matrix4#multiplyMatrices(a, b)`.
    pub fn multiply(a: &Mat4, b: &Mat4) -> Mat4 {
        let (ae, be) = (&a.0, &b.0);
        let (a11, a12, a13, a14) = (ae[0], ae[4], ae[8], ae[12]);
        let (a21, a22, a23, a24) = (ae[1], ae[5], ae[9], ae[13]);
        let (a31, a32, a33, a34) = (ae[2], ae[6], ae[10], ae[14]);
        let (a41, a42, a43, a44) = (ae[3], ae[7], ae[11], ae[15]);
        let (b11, b12, b13, b14) = (be[0], be[4], be[8], be[12]);
        let (b21, b22, b23, b24) = (be[1], be[5], be[9], be[13]);
        let (b31, b32, b33, b34) = (be[2], be[6], be[10], be[14]);
        let (b41, b42, b43, b44) = (be[3], be[7], be[11], be[15]);
        let mut te = [0.0; 16];
        te[0] = a11 * b11 + a12 * b21 + a13 * b31 + a14 * b41;
        te[4] = a11 * b12 + a12 * b22 + a13 * b32 + a14 * b42;
        te[8] = a11 * b13 + a12 * b23 + a13 * b33 + a14 * b43;
        te[12] = a11 * b14 + a12 * b24 + a13 * b34 + a14 * b44;
        te[1] = a21 * b11 + a22 * b21 + a23 * b31 + a24 * b41;
        te[5] = a21 * b12 + a22 * b22 + a23 * b32 + a24 * b42;
        te[9] = a21 * b13 + a22 * b23 + a23 * b33 + a24 * b43;
        te[13] = a21 * b14 + a22 * b24 + a23 * b34 + a24 * b44;
        te[2] = a31 * b11 + a32 * b21 + a33 * b31 + a34 * b41;
        te[6] = a31 * b12 + a32 * b22 + a33 * b32 + a34 * b42;
        te[10] = a31 * b13 + a32 * b23 + a33 * b33 + a34 * b43;
        te[14] = a31 * b14 + a32 * b24 + a33 * b34 + a34 * b44;
        te[3] = a41 * b11 + a42 * b21 + a43 * b31 + a44 * b41;
        te[7] = a41 * b12 + a42 * b22 + a43 * b32 + a44 * b42;
        te[11] = a41 * b13 + a42 * b23 + a43 * b33 + a44 * b43;
        te[15] = a41 * b14 + a42 * b24 + a43 * b34 + a44 * b44;
        Mat4(te)
    }
    /// `Matrix4#invert`: a singular matrix becomes all zeros.
    pub fn invert(&mut self) {
        let te = &mut self.0;
        let (n11, n21, n31, n41) = (te[0], te[1], te[2], te[3]);
        let (n12, n22, n32, n42) = (te[4], te[5], te[6], te[7]);
        let (n13, n23, n33, n43) = (te[8], te[9], te[10], te[11]);
        let (n14, n24, n34, n44) = (te[12], te[13], te[14], te[15]);
        let t11 = n23 * n34 * n42 - n24 * n33 * n42 + n24 * n32 * n43 - n22 * n34 * n43 - n23 * n32 * n44 + n22 * n33 * n44;
        let t12 = n14 * n33 * n42 - n13 * n34 * n42 - n14 * n32 * n43 + n12 * n34 * n43 + n13 * n32 * n44 - n12 * n33 * n44;
        let t13 = n13 * n24 * n42 - n14 * n23 * n42 + n14 * n22 * n43 - n12 * n24 * n43 - n13 * n22 * n44 + n12 * n23 * n44;
        let t14 = n14 * n23 * n32 - n13 * n24 * n32 - n14 * n22 * n33 + n12 * n24 * n33 + n13 * n22 * n34 - n12 * n23 * n34;
        let det = n11 * t11 + n21 * t12 + n31 * t13 + n41 * t14;
        if det == 0.0 { *te = [0.0; 16]; return; }
        let inverse = 1.0 / det;
        te[0] = t11 * inverse;
        te[1] = (n24 * n33 * n41 - n23 * n34 * n41 - n24 * n31 * n43 + n21 * n34 * n43 + n23 * n31 * n44 - n21 * n33 * n44) * inverse;
        te[2] = (n22 * n34 * n41 - n24 * n32 * n41 + n24 * n31 * n42 - n21 * n34 * n42 - n22 * n31 * n44 + n21 * n32 * n44) * inverse;
        te[3] = (n23 * n32 * n41 - n22 * n33 * n41 - n23 * n31 * n42 + n21 * n33 * n42 + n22 * n31 * n43 - n21 * n32 * n43) * inverse;
        te[4] = t12 * inverse;
        te[5] = (n13 * n34 * n41 - n14 * n33 * n41 + n14 * n31 * n43 - n11 * n34 * n43 - n13 * n31 * n44 + n11 * n33 * n44) * inverse;
        te[6] = (n14 * n32 * n41 - n12 * n34 * n41 - n14 * n31 * n42 + n11 * n34 * n42 + n12 * n31 * n44 - n11 * n32 * n44) * inverse;
        te[7] = (n12 * n33 * n41 - n13 * n32 * n41 + n13 * n31 * n42 - n11 * n33 * n42 - n12 * n31 * n43 + n11 * n32 * n43) * inverse;
        te[8] = t13 * inverse;
        te[9] = (n14 * n23 * n41 - n13 * n24 * n41 - n14 * n21 * n43 + n11 * n24 * n43 + n13 * n21 * n44 - n11 * n23 * n44) * inverse;
        te[10] = (n12 * n24 * n41 - n14 * n22 * n41 + n14 * n21 * n42 - n11 * n24 * n42 - n12 * n21 * n44 + n11 * n22 * n44) * inverse;
        te[11] = (n13 * n22 * n41 - n12 * n23 * n41 - n13 * n21 * n42 + n11 * n23 * n42 + n12 * n21 * n43 - n11 * n22 * n43) * inverse;
        te[12] = t14 * inverse;
        te[13] = (n13 * n24 * n31 - n14 * n23 * n31 + n14 * n21 * n33 - n11 * n24 * n33 - n13 * n21 * n34 + n11 * n23 * n34) * inverse;
        te[14] = (n14 * n22 * n31 - n12 * n24 * n31 - n14 * n21 * n32 + n11 * n24 * n32 + n12 * n21 * n34 - n11 * n22 * n34) * inverse;
        te[15] = (n12 * n23 * n31 - n13 * n22 * n31 + n13 * n21 * n32 - n11 * n23 * n32 - n12 * n21 * n33 + n11 * n22 * n33) * inverse;
    }
    /// `Matrix4#lookAt(eye, target, up)`: only the rotation entries change.
    pub fn look_at(&mut self, eye: Vec3, target: Vec3, up: Vec3) {
        let te = &mut self.0;
        let mut z = sub(eye, target);
        if length_sq(z) == 0.0 { z[2] = 1.0; }
        z = normalize(z);
        let mut x = cross(up, z);
        if length_sq(x) == 0.0 {
            if up[2].abs() == 1.0 { z[0] += 0.0001; } else { z[2] += 0.0001; }
            z = normalize(z);
            x = cross(up, z);
        }
        x = normalize(x);
        let y = cross(z, x);
        te[0] = x[0]; te[4] = y[0]; te[8] = z[0];
        te[1] = x[1]; te[5] = y[1]; te[9] = z[1];
        te[2] = x[2]; te[6] = y[2]; te[10] = z[2];
    }
    pub fn set_position(&mut self, p: Vec3) { self.0[12] = p[0]; self.0[13] = p[1]; self.0[14] = p[2]; }
    /// `Matrix4#determinant`, in three's term order.
    pub fn determinant(&self) -> f64 {
        let te = &self.0;
        let (n11, n12, n13, n14) = (te[0], te[4], te[8], te[12]);
        let (n21, n22, n23, n24) = (te[1], te[5], te[9], te[13]);
        let (n31, n32, n33, n34) = (te[2], te[6], te[10], te[14]);
        let (n41, n42, n43, n44) = (te[3], te[7], te[11], te[15]);
        n41 * (n14 * n23 * n32 - n13 * n24 * n32 - n14 * n22 * n33 + n12 * n24 * n33 + n13 * n22 * n34 - n12 * n23 * n34)
            + n42 * (n11 * n23 * n34 - n11 * n24 * n33 + n14 * n21 * n33 - n13 * n21 * n34 + n13 * n24 * n31 - n14 * n23 * n31)
            + n43 * (n11 * n24 * n32 - n11 * n22 * n34 - n14 * n21 * n32 + n12 * n21 * n34 + n14 * n22 * n31 - n12 * n24 * n31)
            + n44 * (-n13 * n22 * n31 - n11 * n23 * n32 + n11 * n22 * n33 + n13 * n21 * n32 - n12 * n21 * n33 + n12 * n23 * n31)
    }
    /// `Matrix4#compose(position, quaternion [x, y, z, w], scale)`.
    pub fn compose(position: Vec3, q: [f64; 4], scale: Vec3) -> Mat4 {
        let (x, y, z, w) = (q[0], q[1], q[2], q[3]);
        let (x2, y2, z2) = (x + x, y + y, z + z);
        let (xx, xy, xz) = (x * x2, x * y2, x * z2);
        let (yy, yz, zz) = (y * y2, y * z2, z * z2);
        let (wx, wy, wz) = (w * x2, w * y2, w * z2);
        let (sx, sy, sz) = (scale[0], scale[1], scale[2]);
        Mat4([(1.0 - (yy + zz)) * sx, (xy + wz) * sx, (xz - wy) * sx, 0.0,
            (xy - wz) * sy, (1.0 - (xx + zz)) * sy, (yz + wx) * sy, 0.0,
            (xz + wy) * sz, (yz - wx) * sz, (1.0 - (xx + yy)) * sz, 0.0,
            position[0], position[1], position[2], 1.0])
    }
    /// `Quaternion#setFromRotationMatrix` as `[x, y, z, w]`; the upper 3x3 is assumed unscaled.
    pub fn quaternion(&self) -> [f64; 4] {
        let te = &self.0;
        let (m11, m12, m13, m21, m22, m23, m31, m32, m33) = (te[0], te[4], te[8], te[1], te[5], te[9], te[2], te[6], te[10]);
        let trace = m11 + m22 + m33;
        if trace > 0.0 {
            let s = 0.5 / (trace + 1.0).sqrt();
            [(m32 - m23) * s, (m13 - m31) * s, (m21 - m12) * s, 0.25 / s]
        } else if m11 > m22 && m11 > m33 {
            let s = 2.0 * (1.0 + m11 - m22 - m33).sqrt();
            [0.25 * s, (m12 + m21) / s, (m13 + m31) / s, (m32 - m23) / s]
        } else if m22 > m33 {
            let s = 2.0 * (1.0 + m22 - m11 - m33).sqrt();
            [(m12 + m21) / s, 0.25 * s, (m23 + m32) / s, (m13 - m31) / s]
        } else {
            let s = 2.0 * (1.0 + m33 - m11 - m22).sqrt();
            [(m13 + m31) / s, (m23 + m32) / s, 0.25 * s, (m21 - m12) / s]
        }
    }
    /// `Matrix4#decompose`: position, quaternion `[x, y, z, w]` and scale. A negative determinant
    /// flips the first scale.
    pub fn decompose(&self) -> (Vec3, [f64; 4], Vec3) {
        let te = &self.0;
        let mut sx = length([te[0], te[1], te[2]]);
        let sy = length([te[4], te[5], te[6]]);
        let sz = length([te[8], te[9], te[10]]);
        if self.determinant() < 0.0 { sx = -sx; }
        let mut rotation = *self;
        let (inverse_x, inverse_y, inverse_z) = (1.0 / sx, 1.0 / sy, 1.0 / sz);
        for (index, inverse) in [(0, inverse_x), (1, inverse_x), (2, inverse_x), (4, inverse_y), (5, inverse_y), (6, inverse_y), (8, inverse_z), (9, inverse_z), (10, inverse_z)] {
            rotation.0[index] *= inverse;
        }
        ([te[12], te[13], te[14]], rotation.quaternion(), [sx, sy, sz])
    }
    /// `Vector3#transformDirection`: the upper 3x3 applied, then normalised.
    pub fn transform_direction(&self, d: Vec3) -> Vec3 {
        let e = &self.0;
        normalize([e[0] * d[0] + e[4] * d[1] + e[8] * d[2], e[1] * d[0] + e[5] * d[1] + e[9] * d[2], e[2] * d[0] + e[6] * d[1] + e[10] * d[2]])
    }
    /// `Vector3#setFromMatrixScale`: the length of each basis column.
    pub fn scale(&self) -> Vec3 {
        let e = &self.0;
        [length([e[0], e[1], e[2]]), length([e[4], e[5], e[6]]), length([e[8], e[9], e[10]])]
    }
}

/// `+x.toFixed(digits)`: the number written with that many decimals (round half up on the exact
/// binary value, magnitude first, so a tiny negative stays `-0`), read back. From 1e21 on
/// `toFixed` is `ToString(x)`, which reads back as `x`. `digits` is at most 3 here.
pub fn fixed_value(x: f64, digits: u32) -> f64 {
    if x.is_nan() || x.abs() >= 1e21 { return x; }
    let magnitude = x.abs();
    let bits = magnitude.to_bits();
    let (exponent, fraction) = (((bits >> 52) & 0x7ff) as i32, bits & ((1u64 << 52) - 1));
    let (mantissa, shift) = if exponent == 0 { (fraction, -1074) } else { (fraction | (1u64 << 52), exponent - 1075) };
    let scale = 10u128.pow(digits);
    let product = mantissa as u128 * scale;
    let rounded: u128 = if shift >= 0 { product << shift }
        else if shift <= -128 { 0 }
        else { let right = (-shift) as u32; (product + (1u128 << (right - 1))) >> right };
    let value = if rounded < (1u128 << 53) { rounded as f64 / scale as f64 }
        else { format!("{}.{:0width$}", rounded / scale, rounded % scale, width = digits as usize).parse().unwrap_or(f64::NAN) };
    if x < 0.0 { -value } else { value }
}

#[derive(Clone, Copy)]
pub struct Box3 { pub min: Vec3, pub max: Vec3 }
impl Box3 {
    pub fn empty() -> Box3 { Box3 { min: [f64::INFINITY; 3], max: [f64::NEG_INFINITY; 3] } }
    pub fn is_empty(&self) -> bool { self.max[0] < self.min[0] || self.max[1] < self.min[1] || self.max[2] < self.min[2] }
    pub fn center(&self) -> Vec3 {
        if self.is_empty() { return [0.0; 3]; }
        [(self.min[0] + self.max[0]) * 0.5, (self.min[1] + self.max[1]) * 0.5, (self.min[2] + self.max[2]) * 0.5]
    }
    pub fn size(&self) -> Vec3 { if self.is_empty() { [0.0; 3] } else { sub(self.max, self.min) } }
    pub fn expand_by_point(&mut self, p: Vec3) {
        for axis in 0..3 { self.min[axis] = jmin(self.min[axis], p[axis]); self.max[axis] = jmax(self.max[axis], p[axis]); }
    }
    pub fn union(&mut self, other: &Box3) {
        for axis in 0..3 { self.min[axis] = jmin(self.min[axis], other.min[axis]); self.max[axis] = jmax(self.max[axis], other.max[axis]); }
    }
    /// `Box3#applyMatrix4`: the eight corners in Three's binary order.
    pub fn apply(&mut self, m: &Mat4) {
        if self.is_empty() { return; }
        let (a, b) = (self.min, self.max);
        let corners = [[a[0], a[1], a[2]], [a[0], a[1], b[2]], [a[0], b[1], a[2]], [a[0], b[1], b[2]],
            [b[0], a[1], a[2]], [b[0], a[1], b[2]], [b[0], b[1], a[2]], [b[0], b[1], b[2]]];
        *self = Box3::empty();
        for corner in corners { self.expand_by_point(m.apply(corner)); }
    }
}
