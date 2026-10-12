//! Fit complete spoken clauses to the existing 180-code-unit voice chunks.
use crate::speech_normalize::whitespace;
fn clause(c: u16) -> bool { matches!(c, 44 | 59 | 58 | 0x2014 | 0x2013 | 0x60c | 0x3001 | 0xff0c | 0xff1b | 0xff1a) }
fn cjk(c: u16) -> bool { matches!(c, 0x3001 | 0xff0c | 0xff1b | 0xff1a) }

/// # Safety
/// input has len u16 values, ends count u32, output capacity*4+1 u32.
#[no_mangle]
pub unsafe extern "C" fn speech_fragments(input: *const u16, len: usize,
    ends: *const u32, count: usize, output: *mut u32, capacity: usize) -> u32 {
    if len > 1_000_000 || count > len { return 0; }
    let text = std::slice::from_raw_parts(input, len);
    let ends = std::slice::from_raw_parts(ends, count);
    let mut previous = 0;
    for &end in ends { if end as usize > len || end <= previous { return 0; } previous = end; }
    let output = std::slice::from_raw_parts_mut(output, capacity * 4 + 1);
    let (mut from, mut written) = (0, 0);
    for &end in ends {
        let (mut start, mut stop) = (from, end as usize);
        from = stop;
        while start < stop && whitespace(text[start]) { start += 1; }
        while stop > start && whitespace(text[stop - 1]) { stop -= 1; }
        if stop <= start { continue; }
        let mut pos = start;
        loop {
            let mut cut = stop;
            if stop - pos > 180 {
                let ideal = ((stop - pos) as f64 / (stop - pos).div_ceil(180) as f64).round() as usize;
                let (mut best, mut best_score) = (0, usize::MAX);
                for at in pos + (ideal as f64 * 0.6).ceil() as usize..=(pos + 180).min(stop - 1) {
                    let space = whitespace(text[at]) && !whitespace(text[at - 1]);
                    if !space && !(cjk(text[at - 1]) && !whitespace(text[at])) { continue; }
                    let score = (at - pos).abs_diff(ideal) + if clause(text[at - 1]) { 0 } else { ideal };
                    if score < best_score { best = at; best_score = score; }
                }
                cut = if best > 0 { best } else { pos + 180 };
            }
            if written >= capacity { return 0; }
            let at = 1 + written * 4;
            output[at..at + 4].copy_from_slice(&[start as u32, stop as u32, pos as u32, cut as u32]);
            written += 1;
            if cut == stop { break; }
            pos = cut;
            while pos < stop && whitespace(text[pos]) { pos += 1; }
        }
    }
    output[0] = written as u32;
    1
}
