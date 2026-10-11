//! Exact three-centre cover colour clustering. The host preserves the sample
//! stride and row-major RGBA order; this kernel retains every legacy tie rule.

fn rgb(sample: &[u8]) -> [f64; 3] {
    [sample[0] as f64, sample[1] as f64, sample[2] as f64]
}
fn distance(sample: &[u8], center: &[f64; 3]) -> f64 {
    let r = sample[0] as f64 - center[0];
    let g = sample[1] as f64 - center[1];
    let b = sample[2] as f64 - center[2];
    r * r + g * g + b * b
}

/// # Safety
/// `samples` has count*4 bytes, count <= 32768; output has three f64 slots.
/// Input and output do not overlap. The host applies Math.round to the three
/// resulting means, using the original browser's positive-half tie rule.
#[no_mangle]
pub unsafe extern "C" fn cover_dominant_rgb(samples: *const u8, count: usize, output: *mut f64) {
    let samples = std::slice::from_raw_parts(samples, count * 4);
    let output = std::slice::from_raw_parts_mut(output, 3);
    let Some(first) = samples.chunks_exact(4).find(|sample| sample[3] >= 48) else {
        output.copy_from_slice(&[90.0, 65.0, 48.0]);
        return;
    };
    let mut centers = [rgb(first); 3];
    for current in 1..3 {
        let mut farthest = first;
        let mut farthest_distance = -1.0;
        for sample in samples.chunks_exact(4) {
            if sample[3] < 48 { continue; }
            let mut nearest = f64::INFINITY;
            for center in &centers[..current] { nearest = nearest.min(distance(sample, center)); }
            if nearest > farthest_distance { farthest = sample; farthest_distance = nearest; }
        }
        centers[current] = rgb(farthest);
    }
    let mut counts = [0usize; 3];
    for _ in 0..7 {
        let mut sums = [[0.0; 3]; 3];
        counts = [0; 3];
        for sample in samples.chunks_exact(4) {
            if sample[3] < 48 { continue; }
            let mut best = 0;
            let mut nearest = f64::INFINITY;
            for (candidate, center) in centers.iter().enumerate() {
                let next = distance(sample, center);
                if next < nearest { best = candidate; nearest = next; }
            }
            counts[best] += 1;
            for channel in 0..3 { sums[best][channel] += sample[channel] as f64; }
        }
        for candidate in 0..3 {
            if counts[candidate] == 0 { continue; }
            for channel in 0..3 { centers[candidate][channel] = sums[candidate][channel] / counts[candidate] as f64; }
        }
    }
    let mut dominant = 0;
    for candidate in 1..3 { if counts[candidate] > counts[dominant] { dominant = candidate; } }
    output.copy_from_slice(&centers[dominant]);
}
