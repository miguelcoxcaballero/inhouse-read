//! PDF column detection over geometry only. Text, UTF-16 offsets and PDF.js item
//! identities stay with the caller. Operations retain the JavaScript f64 order.

const STRIDE: usize = 6;

/// `lines` contains [x0, x1, top, bottom, y, height] for each line.
/// Writes [kind, at, score], with kind 0 = no cut, 1 = cut, 2 = table.
/// The caller owns both allocations and supplies finite geometry.
#[no_mangle]
pub unsafe extern "C" fn pdf_column_cut(lines: *const f64, count: usize, result: *mut f64) {
    let out = std::slice::from_raw_parts_mut(result, 3);
    out.fill(0.0);
    if count < 4 { return; }
    let Some(length) = count.checked_mul(STRIDE) else { return; };
    let source = std::slice::from_raw_parts(lines, length);
    if source.iter().any(|value| !value.is_finite()) { return; }
    let value = |line: usize, field: usize| source[line * STRIDE + field];
    let mut heights: Vec<f64> = (0..count).map(|line| value(line, 5)).collect();
    heights.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let height = heights[count / 2];
    let mut edges = Vec::with_capacity(count * 2);
    for line in 0..count {
        for field in 0..2 {
            let edge = value(line, field);
            // JavaScript Set applies SameValueZero and canonicalizes -0.
            edges.push(if edge == 0.0 { 0.0 } else { edge });
        }
    }
    edges.sort_by(|a, b| a.partial_cmp(b).unwrap());
    edges.dedup();
    // Reuse indices and accumulators across candidates instead of allocating
    // several arrays of geometry for every possible gutter.
    let mut left = Vec::with_capacity(count);
    let mut right = Vec::with_capacity(count);
    let mut table = false;
    let mut best: Option<(f64, f64)> = None;
    for pair in edges.windows(2) {
        if pair[1] - pair[0] < height * 0.65 { continue; }
        let at = (pair[1] + pair[0]) / 2.0;
        left.clear(); right.clear();
        let mut crossing = 0;
        let (mut left_bottom, mut right_bottom) = (f64::NEG_INFINITY, f64::NEG_INFINITY);
        let (mut left_top, mut right_top) = (f64::INFINITY, f64::INFINITY);
        let mut left_end = f64::NEG_INFINITY;
        let mut right_start = f64::INFINITY;
        let mut short_cells = 0;
        for line in 0..count {
            if value(line, 1) <= at {
                left.push(line);
                left_bottom = left_bottom.max(value(line, 3));
                left_top = left_top.min(value(line, 2));
                left_end = left_end.max(value(line, 1));
            } else if value(line, 0) >= at {
                right.push(line);
                right_bottom = right_bottom.max(value(line, 3));
                right_top = right_top.min(value(line, 2));
                right_start = right_start.min(value(line, 0));
            } else { crossing += 1; continue; }
            if value(line, 1) - value(line, 0) < value(line, 5) * 8.0 { short_cells += 1; }
        }
        if left.len() < 2 || right.len() < 2 || crossing > left.len().min(right.len()) { continue; }
        let overlap = left_bottom.min(right_bottom) - left_top.max(right_top);
        if overlap < height * 1.5 { continue; }
        let mut coexisting = 0;
        let mut aligned = 0;
        for &line in &left {
            let mut coexists = false;
            let mut aligns = false;
            for &other in &right {
                let delta = (value(other, 4) - value(line, 4)).abs();
                if delta < value(line, 5).max(value(other, 5)) * 1.6 { coexists = true; }
                if delta < value(line, 5).min(value(other, 5)) * 0.25 { aligns = true; }
                if coexists && aligns { break; }
            }
            if coexists { coexisting += 1; }
            if aligns { aligned += 1; }
        }
        if coexisting < 2 { continue; }
        if crossing <= 2 && left.len() >= 3 && right.len() >= 3
            && aligned as f64 >= left.len() as f64 * 0.85
            && short_cells as f64 >= (left.len() + right.len()) as f64 * 0.85 {
            table = true;
            continue;
        }
        let gap = right_start - left_end;
        if gap < height * 0.65 { continue; }
        let score = coexisting as f64 * left.len().min(right.len()) as f64
            * gap.min(height * 8.0) / (crossing + 1) as f64;
        if best.map_or(true, |(_, previous)| score > previous) { best = Some((at, score)); }
    }
    if let Some((at, score)) = best { out.copy_from_slice(&[1.0, at, score]); }
    else if table { out[0] = 2.0; }
}
