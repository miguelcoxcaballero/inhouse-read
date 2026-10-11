//! Complete placement of objects on independently mounted shelf surfaces.
//! IDs, metadata and DOM ownership remain with the host. All geometry remains
//! f64 and sorting follows JavaScript's stable numeric comparator semantics.
use std::cmp::Ordering;

const EPSILON: f64 = 0.000001;
const MAX_OBJECTS: usize = 8192;
const INPUT_STRIDE: usize = 7;
const OUTPUT_STRIDE: usize = 6;

#[derive(Clone)]
struct Item {
    index: usize,
    width: f64,
    shelf: usize,
    desired: Option<f64>,
    requested_x: Option<f64>,
    order: f64,
    left: f64,
}
struct Config { width: f64, padding: f64, gap: f64, available: f64, minimum: usize }
struct Layout { rows: Vec<Vec<Item>> }

fn compare(value: f64) -> Ordering {
    if value < 0.0 { Ordering::Less } else if value > 0.0 { Ordering::Greater } else { Ordering::Equal }
}
fn max(a: f64, b: f64) -> f64 {
    if a.is_nan() || b.is_nan() { f64::NAN }
    else if a == b && a == 0.0 { if a.is_sign_negative() && b.is_sign_negative() { -0.0 } else { 0.0 } }
    else if a > b { a } else { b }
}
fn min(a: f64, b: f64) -> f64 {
    if a.is_nan() || b.is_nan() { f64::NAN }
    else if a == b && a == 0.0 { if a.is_sign_negative() || b.is_sign_negative() { -0.0 } else { 0.0 } }
    else if a < b { a } else { b }
}
fn ordered(a: &Item, b: &Item) -> Ordering {
    let delta = a.desired.unwrap() + a.width / 2.0 - (b.desired.unwrap() + b.width / 2.0);
    if delta == 0.0 || delta.is_nan() { compare(a.order - b.order) } else { compare(delta) }
}
fn by_left(a: &Item, b: &Item) -> Ordering { compare(a.left - b.left) }
fn ensure(rows: &mut Vec<Vec<Item>>, index: usize) { while rows.len() <= index { rows.push(Vec::new()); } }

fn free_left(items: &[Item], width: f64, cfg: &Config) -> Option<f64> {
    let mut sorted: Vec<&Item> = items.iter().collect();
    sorted.sort_by(|a, b| by_left(a, b));
    let mut cursor = cfg.padding;
    for item in sorted {
        if item.left - cfg.gap - cursor >= width - EPSILON { return Some(cursor); }
        cursor = max(cursor, item.left + item.width + cfg.gap);
    }
    if cursor + width <= cfg.width - cfg.padding + EPSILON { Some(cursor) } else { None }
}

fn solve_row(mut candidates: Vec<Item>, cfg: &Config) -> (Vec<Item>, Vec<Item>) {
    candidates.sort_by(ordered);
    let mut kept = Vec::new();
    let mut overflow = Vec::new();
    let mut occupied = 0.0;
    for item in candidates {
        let cost = item.width + if kept.is_empty() { 0.0 } else { cfg.gap };
        if occupied + cost > cfg.available + EPSILON { overflow.push(item); }
        else { occupied += cost; kept.push(item); }
    }
    let mut cursor = cfg.padding;
    for item in &mut kept {
        item.left = max(item.desired.unwrap(), cursor);
        cursor = item.left + item.width + cfg.gap;
    }
    cursor = cfg.width - cfg.padding;
    for item in kept.iter_mut().rev() {
        item.left = min(item.left, cursor - item.width);
        cursor = item.left - cfg.gap;
    }
    (kept, overflow)
}

fn solve_pinned(mut candidates: Vec<Item>, pin_index: usize, cfg: &Config) -> (Vec<Item>, Vec<Item>) {
    let at = candidates.iter().position(|item| item.index == pin_index).unwrap();
    let mut pin = candidates.remove(at);
    let center = pin.desired.unwrap() + pin.width / 2.0;
    pin.left = pin.desired.unwrap();
    let mut left_cursor = pin.left - cfg.gap;
    let mut right_cursor = pin.left + pin.width + cfg.gap;
    candidates.sort_by(ordered);
    let (left, right): (Vec<Item>, Vec<Item>) = candidates.into_iter()
        .partition(|item| item.desired.unwrap() + item.width / 2.0 < center);
    let mut placed = vec![pin];
    let mut overflow = Vec::new();
    for mut item in left.into_iter().rev() {
        let next = min(item.desired.unwrap(), left_cursor - item.width);
        if next < cfg.padding - EPSILON { overflow.push(item); }
        else { item.left = next; left_cursor = next - cfg.gap; placed.push(item); }
    }
    for mut item in right {
        let next = max(item.desired.unwrap(), right_cursor);
        if next + item.width > cfg.width - cfg.padding + EPSILON { overflow.push(item); }
        else { item.left = next; right_cursor = next + item.width + cfg.gap; placed.push(item); }
    }
    overflow.sort_by(ordered);
    let mut remaining = Vec::new();
    for mut item in overflow {
        if let Some(left) = free_left(&placed, item.width, cfg) { item.left = left; placed.push(item); }
        else { remaining.push(item); }
    }
    (placed, remaining)
}

fn layout(items: Vec<Item>, pin: Option<usize>, cfg: &Config) -> Layout {
    let mut pending = Vec::new();
    let mut automatic = Vec::new();
    for item in items {
        if item.desired.is_none() { automatic.push(item); }
        else { ensure(&mut pending, item.shelf); let row = item.shelf; pending[row].push(item); }
    }
    let mut solved = Vec::new();
    let mut index = 0;
    while index < pending.len() {
        let candidates = std::mem::take(&mut pending[index]);
        let pinned = pin.filter(|pin| candidates.iter().any(|item| item.index == *pin));
        let (placed, overflow) = if let Some(pin) = pinned { solve_pinned(candidates, pin, cfg) }
            else { solve_row(candidates, cfg) };
        ensure(&mut solved, index); solved[index] = placed;
        if !overflow.is_empty() {
            ensure(&mut pending, index + 1);
            for mut item in overflow { item.shelf = index + 1; pending[index + 1].push(item); }
        }
        index += 1;
    }
    for mut item in automatic {
        let mut row = item.shelf;
        loop {
            ensure(&mut solved, row);
            if let Some(left) = free_left(&solved[row], item.width, cfg) {
                item.shelf = row; item.left = left; solved[row].push(item); break;
            }
            row += 1;
        }
    }
    if cfg.minimum > 0 { ensure(&mut solved, cfg.minimum - 1); }
    for row in &mut solved {
        row.sort_by(|a, b| {
            let delta = a.left - b.left;
            if delta == 0.0 || delta.is_nan() { compare(a.order - b.order) } else { compare(delta) }
        });
    }
    Layout { rows: solved }
}

/// # Safety
/// The host owns distinct live input/config/output ranges of `count*7`, 7 and
/// `output_length` f64 respectively. IDs are implicit input indices; no strings
/// or browser references cross this boundary. Group 0 is floor, 1 is ceiling.
/// Output: counts[items0,rows0,items1,rows1], ordered item tuples
/// [inputIndex,row,width,left,center,x], then row tuples [used,occupied,free].
#[no_mangle]
pub unsafe extern "C" fn shelf_place(
    input: *const f64, count: usize, config: *const f64, output: *mut f64, output_length: usize,
) -> u32 {
    if count > MAX_OBJECTS || output_length < 4 { return 0; }
    let values = std::slice::from_raw_parts(config, 7);
    if values.iter().any(|value| !value.is_finite()) || values[0] <= 0.0
        || values[1] < 0.0 || values[2] < 0.0 || values[3] <= 0.0
        || values[4] < 0.0 || values[4] > 1000.0 || values[4].fract() != 0.0
        || (values[5] != 1.0 && values[5] != 2.0)
        || values[6] < -1.0 || values[6].fract() != 0.0
        || values[6] >= count as f64 { return 0; }
    let cfg = Config { width:values[0], padding:values[1], gap:values[2], available:values[3], minimum:values[4] as usize };
    let groups = values[5] as usize;
    let pin = if values[6] < 0.0 { None } else { Some(values[6] as usize) };
    let input = std::slice::from_raw_parts(input, count * INPUT_STRIDE);
    let mut grouped = vec![Vec::new(); groups];
    for (index, row) in input.chunks_exact(INPUT_STRIDE).enumerate() {
        if row.iter().any(|value| !value.is_finite()) || row[0] <= 0.0 || row[0] > cfg.available
            || row[1] < 0.0 || row[1] > 999.0 || row[1].fract() != 0.0
            || row[4] < 0.0 || row[4] > 3.0 || row[4].fract() != 0.0
            || row[5] < 0.0 || row[5].fract() != 0.0
            || row[6] < 0.0 || row[6] >= groups as f64 || row[6].fract() != 0.0 { return 0; }
        let flags = row[4] as u8;
        grouped[row[6] as usize].push(Item { index, width:row[0], shelf:row[1] as usize,
            desired:if flags & 1 != 0 { Some(row[2]) } else { None },
            requested_x:if flags & 2 != 0 { Some(row[3]) } else { None },
            order:row[5], left:0.0 });
    }
    let layouts: Vec<Layout> = grouped.into_iter().map(|items| layout(items, pin, &cfg)).collect();
    let total_rows: usize = layouts.iter().map(|value| value.rows.len()).sum();
    let length = 4 + count * OUTPUT_STRIDE + total_rows * 3;
    if output_length < length { return 0; }
    let output = std::slice::from_raw_parts_mut(output, length);
    output[..4].fill(0.0);
    let mut at = 4;
    let mut stats_at = 4 + count * OUTPUT_STRIDE;
    for (group, result) in layouts.iter().enumerate() {
        output[group * 2] = result.rows.iter().map(|row| row.len()).sum::<usize>() as f64;
        output[group * 2 + 1] = result.rows.len() as f64;
        for (row_index, row) in result.rows.iter().enumerate() {
            let mut right = f64::NEG_INFINITY;
            let mut occupied = 0.0;
            for item in row {
                let center = item.left + item.width / 2.0;
                let x = if Some(item.index) != pin && item.requested_x.is_some() && Some(item.left) == item.desired {
                    item.requested_x.unwrap()
                } else { min(1.0, max(0.0, (center - cfg.padding) / cfg.available)) };
                output[at..at + OUTPUT_STRIDE].copy_from_slice(&[
                    item.index as f64, row_index as f64, item.width, item.left, center, x]);
                at += OUTPUT_STRIDE;
                right = max(right, item.left + item.width); occupied += item.width;
            }
            occupied += cfg.gap * row.len().saturating_sub(1) as f64;
            let used = if row.is_empty() { 0.0 } else { right - cfg.padding };
            output[stats_at..stats_at + 3].copy_from_slice(&[used, occupied, max(0.0, cfg.available - occupied)]);
            stats_at += 3;
        }
    }
    1
}
