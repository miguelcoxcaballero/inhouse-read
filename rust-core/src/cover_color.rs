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

fn dominant_rgb(samples: &[u8]) -> [f64; 3] {
    let Some(first) = samples.chunks_exact(4).find(|sample| sample[3] >= 48) else {
        return [90.0, 65.0, 48.0];
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
    centers[dominant]
}

/// # Safety
/// `samples` has count*4 bytes, count <= 32768; output has three f64 slots.
/// Input and output do not overlap. Compatibility entry point; the host rounds
/// these means for callers that need just RGB rather than a complete style.
#[no_mangle]
pub unsafe extern "C" fn cover_dominant_rgb(samples: *const u8, count: usize, output: *mut f64) {
    let samples = std::slice::from_raw_parts(samples, count * 4);
    std::slice::from_raw_parts_mut(output, 3).copy_from_slice(&dominant_rgb(samples));
}

fn hex(rgb: [f64; 3]) -> [u8; 7] {
    let mut output = [b'#'; 7];
    for (index, value) in rgb.into_iter().enumerate() {
        let channel = crate::jsnum::round(value) as u8;
        output[index * 2 + 1] = b"0123456789abcdef"[(channel >> 4) as usize];
        output[index * 2 + 2] = b"0123456789abcdef"[(channel & 15) as usize];
    }
    output
}

fn color_style(rgb: [f64; 3]) -> [u8; 21] {
    let rgb = rgb.map(crate::jsnum::round);
    // Clustering produces rounded 8-bit channels: calculate each transfer
    // function once, instead of repeating three powf calls for every cover.
    static LINEAR: std::sync::OnceLock<[f64; 256]> = std::sync::OnceLock::new();
    let table = LINEAR.get_or_init(|| std::array::from_fn(|value| {
        let channel = value as f64 / 255.0;
        if channel <= 0.04045 { channel / 12.92 }
        else { ((channel + 0.055) / 1.055).powf(2.4) }
    }));
    let linear = rgb.map(|value| table[value as usize]);
    let luminance = 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
    let white = 1.05 / (luminance + 0.05);
    // Cover extraction intentionally differs from the user colour picker:
    // retain its original dark-ink contrast reference of 0.025 + 0.05.
    let dark = (luminance + 0.05) / (0.025 + 0.05);
    let ink = if white >= dark { b"#fffaf0" } else { b"#171512" };
    let mut output = [0; 21];
    output[..7].copy_from_slice(&hex(rgb));
    output[7..14].copy_from_slice(&hex(rgb.map(|value| value * (1.0 - 0.24))));
    output[14..].copy_from_slice(ink);
    output
}

/// Clustering, channel rounding, shade and contrast share one WASM call and
/// one bounded arena. Returns three ASCII #rrggbb strings, with no allocation.
/// # Safety
/// `samples` has count*4 readable bytes and output has 21 writable bytes;
/// count <= 32768 and the input/output ranges must not overlap.
#[no_mangle]
pub unsafe extern "C" fn cover_dominant_style(samples: *const u8, count: usize, output: *mut u8) {
    let samples = std::slice::from_raw_parts(samples, count * 4);
    std::slice::from_raw_parts_mut(output, 21).copy_from_slice(&color_style(dominant_rgb(samples)));
}
