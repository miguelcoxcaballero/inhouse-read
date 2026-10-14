//! JavaScript's `Math.round`, `Math.min` and `Math.max` as the voice kernels need them, so
//! that every sample count and boundary falls exactly where the JavaScript they replaced put it.

/// `Math.round`: a half rounds up (NaN and infinities stay as they are).
pub fn round_half_up(x: f64) -> f64 { let f = x.floor(); if x - f >= 0.5 { f + 1.0 } else { f } }
/// `Math.min` of two numbers: NaN wins, and -0 is below +0.
pub fn js_min(a: f64, b: f64) -> f64 { if a.is_nan() || b.is_nan() { f64::NAN } else if a == 0.0 && b == 0.0 { if a.is_sign_negative() { a } else { b } } else if a < b { a } else { b } }
/// `Math.max` of two numbers: NaN wins, and +0 is above -0.
pub fn js_max(a: f64, b: f64) -> f64 { if a.is_nan() || b.is_nan() { f64::NAN } else if a == 0.0 && b == 0.0 { if a.is_sign_negative() { b } else { a } } else if a > b { a } else { b } }
