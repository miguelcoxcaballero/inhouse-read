//! JavaScript number semantics that differ from Rust's: Math.round rounds half
//! up (Rust's `round` rounds half away from zero), Math.min/max propagate NaN
//! and order the two zeros, and Math.min(max, Math.max(min, v)) is the clamp
//! the host uses. Every kernel that reproduces host arithmetic uses these.

/// Math.round: ties go towards +infinity, -0 is kept for values in [-0.5, -0].
pub fn round(value: f64) -> f64 {
    if !value.is_finite() || value.abs() >= 4_503_599_627_370_496.0 { return value; }
    let floor = value.floor();
    let rounded = if value - floor >= 0.5 { floor + 1.0 } else { floor };
    if rounded == 0.0 && (value < 0.0 || (value == 0.0 && value.is_sign_negative())) { -0.0 } else { rounded }
}

/// Math.max(a, b)
pub fn max(a: f64, b: f64) -> f64 {
    if a.is_nan() || b.is_nan() { f64::NAN }
    else if a == b && a == 0.0 { if a.is_sign_negative() && b.is_sign_negative() { -0.0 } else { 0.0 } }
    else if a > b { a } else { b }
}

/// Math.min(a, b)
pub fn min(a: f64, b: f64) -> f64 {
    if a.is_nan() || b.is_nan() { f64::NAN }
    else if a == b && a == 0.0 { if a.is_sign_negative() || b.is_sign_negative() { -0.0 } else { 0.0 } }
    else if a < b { a } else { b }
}

/// Math.min(high, Math.max(low, value))
pub fn clamp(value: f64, low: f64, high: f64) -> f64 { min(high, max(low, value)) }
