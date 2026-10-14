//! The mono voice cleanup (peak normalisation, silence trimming, edge fades), with
//! f64 arithmetic and f32 stores at exactly the same boundaries as the JavaScript
//! Float32Array pipeline it replaced (tests/unit/helpers/reference-pcm.js). It is
//! total over the samples: NaN and infinities behave as they did in JavaScript
//! (a NaN never counts as a peak and never passes the silence threshold).
//! No resampling, voice/model changes, pause changes, or imported functions.

use crate::voice_math::round_half_up;

/// Host owns disjoint buffers: count scratch samples (possibly none) and four f64
/// metadata slots. On rejection the host discards this scratch arena. Output metadata:
/// [gain, first retained sample, exclusive end, number of faded samples].
#[no_mangle]
pub unsafe extern "C" fn pcm_prepare(
    input: *mut f32, metadata: *mut f64,
    count: usize, sample_rate: f64, nvcc: u32,
) -> u32 {
    if input.is_null() || metadata.is_null()
        || count > 4_194_304 || !sample_rate.is_finite() || sample_rate <= 0.0
        || sample_rate > 384_000.0 || nvcc > 1 { return 0; }
    let samples = std::slice::from_raw_parts_mut(input, count);
    let meta = std::slice::from_raw_parts_mut(metadata, 4);
    let mut peak = 0.0_f64;
    for &value in samples.iter() {
        let a = (value as f64).abs();
        if a > peak { peak = a; }
    }
    let mut cap = 6.0_f64;
    if nvcc == 1 && peak >= 0.02 {
        let mut sum = 0.0;
        for &value in samples.iter() { let x = value as f64; sum += x * x; }
        if (sum / count as f64).sqrt() >= 0.002 { cap = 12.0; }
    }
    let gain = cap.min(0.9 / peak.max(0.001));
    let adjust = (gain - 1.0).abs() > 1e-6;
    let mut normalized_peak = 0.0_f64;
    for value in samples.iter_mut() {
        if adjust { *value = (*value as f64 * gain) as f32; }
        let a = (*value as f64).abs();
        if a > normalized_peak { normalized_peak = a; }
    }
    let threshold = (normalized_peak * 0.02).max(0.002);
    let mut from = 0;
    while from < count && (samples[from] as f64).abs() < threshold { from += 1; }
    if from == count { meta.copy_from_slice(&[gain, 0.0, 0.0, 0.0]); return 1; }
    let mut to = count - 1;
    while to > from && (samples[to] as f64).abs() < threshold { to -= 1; }
    // Math.round for these nonnegative durations (multiply before division).
    from = from.saturating_sub(round_half_up(sample_rate * 14.0 / 1000.0) as usize);
    to = (to + round_half_up(sample_rate * 110.0 / 1000.0) as usize).min(count - 1);
    let length = to + 1 - from;
    let out = &mut samples[from..to + 1];
    let n = (round_half_up(sample_rate * 4.0 / 1000.0) as usize).min(length >> 1);
    for i in 0..n {
        let k = i as f64 / n as f64;
        out[i] = (out[i] as f64 * k) as f32;
        out[length - 1 - i] = (out[length - 1 - i] as f64 * k) as f32;
    }
    meta.copy_from_slice(&[gain, from as f64, (to + 1) as f64, n as f64]);
    1
}
