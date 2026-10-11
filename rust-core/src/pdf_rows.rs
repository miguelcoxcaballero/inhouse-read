//! Complete PDF row grouping and horizontal gutter segmentation. The host
//! supplies JavaScript UTF-16 weights; no strings cross this numeric ABI.
use std::cmp::Ordering;

const INPUT: usize = 10;
const LINE: usize = 9;
const LIMIT: usize = 32768;
const X0: usize = 0;
const X1: usize = 1;
const Y: usize = 2;
const HEIGHT: usize = 3;
const TOP: usize = 4;
const BOTTOM: usize = 5;
const RAW: usize = 6;
const WEIGHT: usize = 7;
const TEXT_LENGTH: usize = 8;
const RTL: usize = 9;

fn cmp(a: f64, b: f64) -> Ordering {
    // ECMAScript subtracting comparators treat -0 and +0 as equal.
    a.partial_cmp(&b).unwrap_or(Ordering::Equal)
}
fn minimum(a: f64, b: f64) -> f64 {
    if a < b { a } else if b < a { b }
    else if a == 0.0 && (a.is_sign_negative() || b.is_sign_negative()) { -0.0 }
    else { a }
}
fn maximum(a: f64, b: f64) -> f64 {
    if a > b { a } else if b > a { b }
    else if a == 0.0 && (!a.is_sign_negative() || !b.is_sign_negative()) { 0.0 }
    else { a }
}

struct Row {
    entries: Vec<usize>, y: f64, top: f64, bottom: f64, height: f64,
}

fn weighted_median(source: &[f64], entries: &[usize], field: usize,
    rank: &[usize], scratch: &mut Vec<usize>) -> f64 {
    scratch.clear(); scratch.extend_from_slice(entries);
    // An explicit arrival rank makes an unstable allocation-free sort exactly
    // equivalent to the original stable sort, including signed-zero ties.
    scratch.sort_unstable_by(|&a, &b| cmp(source[a * INPUT + field], source[b * INPUT + field])
        .then_with(|| rank[a].cmp(&rank[b])));
    let mut total = 0.0;
    for &index in scratch.iter() { total += source[index * INPUT + WEIGHT]; }
    let mut weight = 0.0;
    for &index in scratch.iter() {
        weight += source[index * INPUT + WEIGHT];
        if weight >= total / 2.0 { return source[index * INPUT + field]; }
    }
    0.0
}

fn emit_line(source: &[f64], group: &[usize], row: &Row, order: &mut [f64],
    lines: &mut [f64], position: &mut usize, line_count: &mut usize) {
    let mut total = 0.0;
    let mut rtl_weight = 0.0;
    let mut x0 = f64::INFINITY;
    let mut x1 = f64::NEG_INFINITY;
    for &index in group {
        let at = index * INPUT;
        total += source[at + TEXT_LENGTH];
        if source[at + RTL] == 1.0 { rtl_weight += source[at + TEXT_LENGTH]; }
        x0 = minimum(x0, source[at + X0]); x1 = maximum(x1, source[at + X1]);
    }
    let rtl = rtl_weight > total / 2.0;
    let start = *position;
    for offset in 0..group.len() {
        order[*position] = group[if rtl { group.len() - 1 - offset } else { offset }] as f64;
        *position += 1;
    }
    let at = *line_count * LINE;
    lines[at..at + LINE].copy_from_slice(&[start as f64, group.len() as f64,
        x0, x1, row.y, row.top, row.bottom, row.height, if rtl { 1.0 } else { 0.0 }]);
    *line_count += 1;
}

/// Input: count records [x0,x1,y,height,top,bottom,rawIndex,trimWeight,UTF16Length,rtl].
/// Output: count input indices plus up to count line records
/// [start,length,x0,x1,y,top,bottom,height,rtl]. Returns line count; 0 rejects input.
/// # Safety
/// All three ranges are live, non-overlapping allocations of count*10, count
/// and count*9 f64 respectively. The owner retains them throughout the call.
#[no_mangle]
pub unsafe extern "C" fn pdf_row_lines(input: *const f64, count: usize,
    output_order: *mut f64, output_lines: *mut f64) -> u32 {
    if count == 0 || count > LIMIT || input.is_null() || output_order.is_null() || output_lines.is_null() { return 0; }
    let source = std::slice::from_raw_parts(input, count * INPUT);
    for entry in source.chunks_exact(INPUT) {
        if entry.iter().any(|value| !value.is_finite()) || entry[HEIGHT] <= 0.0
            || entry[X1] < entry[X0] || entry[BOTTOM] < entry[TOP]
            || entry[RAW] < 0.0 || entry[RAW].fract() != 0.0
            || entry[WEIGHT] < 1.0 || entry[WEIGHT].fract() != 0.0
            || entry[TEXT_LENGTH] < 0.0 || entry[TEXT_LENGTH].fract() != 0.0
            || entry[WEIGHT] > 2147483647.0 || entry[TEXT_LENGTH] > 2147483647.0
            || (entry[RTL] != 0.0 && entry[RTL] != 1.0) { return 0; }
    }
    let order = std::slice::from_raw_parts_mut(output_order, count);
    let lines = std::slice::from_raw_parts_mut(output_lines, count * LINE);
    let mut sorted: Vec<usize> = (0..count).collect();
    sorted.sort_unstable_by(|&a, &b| cmp(source[a * INPUT + TOP], source[b * INPUT + TOP])
        .then_with(|| cmp(source[a * INPUT + X0], source[b * INPUT + X0]))
        .then_with(|| cmp(source[a * INPUT + RAW], source[b * INPUT + RAW]))
        .then_with(|| a.cmp(&b)));
    let mut rank = vec![0; count];
    let mut max_height = f64::NEG_INFINITY;
    for (position, &index) in sorted.iter().enumerate() {
        rank[index] = position;
        max_height = maximum(max_height, source[index * INPUT + HEIGHT]);
    }
    let mut rows: Vec<Row> = Vec::new();
    let mut scratch = Vec::new();
    for index in sorted {
        let entry = &source[index * INPUT..(index + 1) * INPUT];
        let mut chosen = None;
        let mut distance = f64::INFINITY;
        for position in (0..rows.len()).rev() {
            let row = &rows[position];
            if row.bottom < entry[TOP] - max_height * 0.5 { break; }
            let overlap = minimum(row.bottom, entry[BOTTOM]) - maximum(row.top, entry[TOP]);
            let delta = (row.y - entry[Y]).abs();
            if (delta <= maximum(row.height, entry[HEIGHT]) * 0.42
                || overlap >= minimum(row.height, entry[HEIGHT]) * 0.65) && delta < distance {
                chosen = Some(position); distance = delta;
            }
        }
        if let Some(position) = chosen {
            let row = &mut rows[position];
            row.entries.push(index);
            row.top = minimum(row.top, entry[TOP]); row.bottom = maximum(row.bottom, entry[BOTTOM]);
            row.y = weighted_median(source, &row.entries, Y, &rank, &mut scratch);
            row.height = weighted_median(source, &row.entries, HEIGHT, &rank, &mut scratch);
        } else {
            rows.push(Row { entries: vec![index], y: entry[Y], top: entry[TOP], bottom: entry[BOTTOM], height: entry[HEIGHT] });
        }
    }
    let mut position = 0;
    let mut line_count = 0;
    for row in &rows {
        scratch.clear(); scratch.extend_from_slice(&row.entries);
        scratch.sort_unstable_by(|&a, &b| cmp(source[a * INPUT + X0], source[b * INPUT + X0])
            .then_with(|| cmp(source[a * INPUT + RAW], source[b * INPUT + RAW]))
            .then_with(|| rank[a].cmp(&rank[b])));
        let mut start = 0;
        for end in 1..=scratch.len() {
            if end == scratch.len() || source[scratch[end] * INPUT + X0] - source[scratch[end - 1] * INPUT + X1]
                > maximum(source[scratch[end - 1] * INPUT + HEIGHT], source[scratch[end] * INPUT + HEIGHT]) * 2.0 {
                emit_line(source, &scratch[start..end], row, order, lines, &mut position, &mut line_count);
                start = end;
            }
        }
    }
    line_count as u32
}
