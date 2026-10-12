//! Mono Float32, speed-up-only adaptation of Sonic's AMDF/PICOLA algorithm.
//! Copyright 2010 Bill Cox; Apache-2.0. Adapted for Inhouse Read in 2026.
//! See public/licenses/sonic-Apache-2.0.txt. No resampling/pitch change, no
//! model duration compression. The final input tail is copied, never cut.

fn period_in(samples: &[f64], min: usize, max: usize) -> (usize, f64, f64) {
    let (mut best, mut low, mut high) = (min, f64::INFINITY, 0.0_f64);
    for p in min..=max {
        let mut diff = 0.0;
        for i in 0..p { diff += (samples[i] - samples[i + p]).abs(); }
        diff /= p as f64;
        if diff < low { low = diff; best = p; }
        high = high.max(diff);
    }
    (best, low, high)
}

// The host allocates independent input/output (count floats each) and sorted
// input sample positions in marks. Marks are replaced with output positions.
// No allocation in this kernel. Max 4M samples, 128 marks, 8–96 kHz, 1–3x.
#[no_mangle]
pub unsafe extern "C" fn speech_tempo(input: *const f32, output: *mut f32,
    count: usize, sample_rate: u32, speed: f64, marks: *mut f64, mark_count: usize) -> usize {
    if input.is_null() || output.is_null() || count == 0 || count > 4_194_304
        || !(8000..=96000).contains(&sample_rate) || !speed.is_finite()
        || !(1.0..=3.0).contains(&speed) || mark_count > 128
        || (mark_count > 0 && marks.is_null()) { return 0; }
    let pcm = std::slice::from_raw_parts(input, count);
    if pcm.iter().any(|x| !x.is_finite()) { return 0; }
    let timeline = if mark_count == 0 { &mut [] } else { std::slice::from_raw_parts_mut(marks, mark_count) };
    if timeline.iter().enumerate().any(|(i,x)| !x.is_finite() || *x < 0.0 || *x >= count as f64
        || x.fract() != 0.0 || (i > 0 && *x < timeline[i-1])) { return 0; }
    let out = std::slice::from_raw_parts_mut(output, count);
    if speed == 1.0 { out.copy_from_slice(pcm); return count; }
    let min = sample_rate as usize / 400;
    let max = sample_rate as usize / 65;
    let required = 2 * max;
    let skip = (sample_rate as usize / 4000).max(1);
    // Full-resolution refinement needs at most 2*(96000/65) samples.
    let mut original = [0.0_f64; 2954];
    let mut down = [0.0_f64; 256];
    let (mut pos, mut written, mut mark, mut prev_period, mut prev_diff) = (0, 0, 0, 0, 0.0);
    while pos < count {
        let start = pos;
        let dest = written;
        let error = written as f64 - pos as f64 / speed;
        if pos + required > count || (speed < 2.0 && error < 0.0) {
            let copy = if pos + required > count { count - pos }
                else { ((1.0 - error * speed / (speed - 1.0)) as usize).min(count - pos).max(1) };
            out[written..written+copy].copy_from_slice(&pcm[pos..pos+copy]);
            pos += copy; written += copy;
        } else {
            for i in 0..required { original[i] = pcm[pos+i] as f64; }
            for i in 0..required/skip {
                let mut sum = 0.0;
                for j in 0..skip { sum += original[i*skip+j]; }
                down[i] = sum / skip as f64;
            }
            let (coarse, _, _) = period_in(&down, min/skip, max/skip);
            let center = coarse * skip;
            let (period, low, high) = period_in(&original,
                center.saturating_sub(4*skip).max(min), (center+4*skip).min(max));
            let use_previous = low != 0.0 && prev_period > 0 && high <= low*3.0 && low*2.0 > prev_diff*3.0;
            let p = if use_previous { prev_period } else { period };
            prev_period = period; prev_diff = low;
            let n = if speed >= 2.0 { (p as f64/(speed-1.0)) as usize } else { p };
            for i in 0..n {
                out[written+i] = ((pcm[pos+i] as f64 * (n-i) as f64
                    + pcm[pos+p+i] as f64 * i as f64) / n as f64) as f32;
            }
            pos += p+n; written += n;
        }
        while mark < timeline.len() && timeline[mark] < pos as f64 {
            timeline[mark] = (dest as f64 + (timeline[mark]-start as f64)
                * (written-dest) as f64/(pos-start) as f64).round();
            mark += 1;
        }
    }
    for point in timeline { *point = point.min((written-1) as f64); }
    written
}
