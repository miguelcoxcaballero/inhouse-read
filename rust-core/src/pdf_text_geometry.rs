//! Page-local geometry of PDF.js text items before they are grouped into rows: the viewport
//! transform, the dominant writing direction, the rotation into that direction and the box of
//! every item. A page whose geometry cannot be trusted (an item without a finite transform, a
//! degenerate scale, vertical or mixed rotated writing, an overflowing coordinate) keeps the
//! stream order the file paints: the caller then uses the plain text. `Math.atan2`, `Math.hypot`,
//! `Math.sin` and `Math.cos` come from the host (host_math.rs) in three rounds, so the numbers are
//! the ones the page's own engine always produced. The frozen JavaScript original is
//! tests/unit/helpers/reference-pdf-text-geometry.js.
use crate::host_math::{put, ATAN2, COS, HYPOT, SIN};
use crate::jsmath::jmax;

/// Per item: transform[0..6] (Number-coerced), Number(width), Number(height),
/// str.trim().length, str.length and the direction (0 other, 1 'ttb', 2 'rtl').
pub const ITEM: usize = 11;
const WIDTH: usize = 6;
const HEIGHT: usize = 7;
const TRIMMED: usize = 8;
const LENGTH: usize = 9;
const DIRECTION: usize = 10;
/// Per entry: x0, x1, y, height, top, bottom.
pub const ENTRY: usize = 6;
const LIMIT: usize = 32768;

/// The item's transform in viewport space, in the original operation order.
fn multiply(a: &[f64], b: &[f64]) -> [f64; 6] {
    [
        a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1],
        a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3],
        a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5],
    ]
}

unsafe fn inputs<'a>(view: *const f64, items: *const f64, count: usize) -> Option<(&'a [f64], &'a [f64])> {
    if view.is_null() || items.is_null() || count == 0 || count > LIMIT { return None; }
    Some((std::slice::from_raw_parts(view, 6), std::slice::from_raw_parts(items, count * ITEM)))
}

/// Round one. Returns the number of requests (3 per item and the viewport scale), 0 when an
/// item has no finite transform (the page keeps its stream order) or -1 for an invalid call.
/// Requests per item: hypot(t0, t1), atan2(tt1, tt0), hypot(tt2, tt3); then hypot(view0, view1).
/// # Safety
/// `view` holds 6 numbers, `items` `count * ITEM`, `requests` `(3 * count + 1) * 3`.
#[no_mangle]
pub unsafe extern "C" fn pdf_text_geometry_a(view: *const f64, items: *const f64, count: usize, requests: *mut f64) -> i32 {
    let Some((view, items)) = inputs(view, items, count) else { return -1 };
    if requests.is_null() { return -1; }
    if items.chunks_exact(ITEM).any(|item| item[..6].iter().any(|value| !value.is_finite())) { return 0; }
    let requests = std::slice::from_raw_parts_mut(requests, (3 * count + 1) * 3);
    for (index, item) in items.chunks_exact(ITEM).enumerate() {
        let t = multiply(view, &item[..6]);
        put(requests, index * 3, HYPOT, item[0], item[1]);
        put(requests, index * 3 + 1, ATAN2, t[1], t[0]);
        put(requests, index * 3 + 2, HYPOT, t[2], t[3]);
    }
    put(requests, 3 * count, HYPOT, view[0], view[1]);
    (3 * count + 1) as i32
}

/// The first item with the longest trimmed text (a stable descending sort's first element).
fn dominant(items: &[f64]) -> usize {
    let mut best = 0;
    for (index, item) in items.chunks_exact(ITEM).enumerate() {
        if item[TRIMMED] > items[best * ITEM + TRIMMED] { best = index; }
    }
    best
}

/// Round two. Returns the number of requests (`count + 2`), or 0 when the page keeps its stream
/// order: an item of zero scale, or vertical writing. Requests: cos(angle), sin(angle) and, per
/// item, sin(its angle - angle), where angle is the dominant item's direction.
/// # Safety
/// As round one; `first` holds its `3 * count + 1` answers, `requests` `(count + 2) * 3`.
#[no_mangle]
pub unsafe extern "C" fn pdf_text_geometry_b(view: *const f64, items: *const f64, count: usize, first: *const f64, requests: *mut f64) -> i32 {
    let Some((_, items)) = inputs(view, items, count) else { return -1 };
    if first.is_null() || requests.is_null() { return -1; }
    let first = std::slice::from_raw_parts(first, 3 * count + 1);
    // `Math.hypot(t0, t1) > 0` for every item, then no 'ttb' item.
    if (0..count).any(|index| !(first[index * 3] > 0.0)) { return 0; }
    if items.chunks_exact(ITEM).any(|item| item[DIRECTION] == 1.0) { return 0; }
    let angle = first[dominant(items) * 3 + 1];
    let requests = std::slice::from_raw_parts_mut(requests, (count + 2) * 3);
    put(requests, 0, COS, angle, 0.0);
    put(requests, 1, SIN, angle, 0.0);
    for index in 0..count { put(requests, index + 2, SIN, first[index * 3 + 1] - angle, 0.0); }
    (count + 2) as i32
}

/// Round three: the item boxes. Returns 1 with `count * ENTRY` numbers in `entries` and the
/// right-to-left decision in `rtl[0]`, or 0 when the page keeps its stream order (a rotated
/// item, or a coordinate that overflowed).
/// # Safety
/// As round two; `second` holds its `count + 2` answers.
#[no_mangle]
pub unsafe extern "C" fn pdf_text_geometry_finish(view: *const f64, items: *const f64, count: usize, first: *const f64,
    second: *const f64, entries: *mut f64, rtl: *mut f64) -> i32 {
    let Some((view, items)) = inputs(view, items, count) else { return -1 };
    if first.is_null() || second.is_null() || entries.is_null() || rtl.is_null() { return -1; }
    let first = std::slice::from_raw_parts(first, 3 * count + 1);
    let second = std::slice::from_raw_parts(second, count + 2);
    if (0..count).any(|index| second[index + 2].abs() > 0.2) { return 0; }
    let (cos, sin) = (second[0], second[1]);
    let scale = { let value = first[3 * count]; if value == 0.0 || value.is_nan() { 1.0 } else { value } };
    let output = std::slice::from_raw_parts_mut(entries, count * ENTRY);
    for (index, item) in items.chunks_exact(ITEM).enumerate() {
        let t = multiply(view, &item[..6]);
        let x = t[4] * cos + t[5] * sin;
        let y = -t[4] * sin + t[5] * cos;
        // `Math.hypot(t2, t3) || Number(item.height) * scale || 12`, never below 1.
        let measured = first[index * 3 + 2];
        let declared = item[HEIGHT] * scale;
        let height = jmax(1.0, if measured != 0.0 && !measured.is_nan() { measured }
            else if declared != 0.0 && !declared.is_nan() { declared } else { 12.0 });
        let width = jmax(0.0, if item[WIDTH].is_finite() { item[WIDTH] * scale } else { item[LENGTH] * height * 0.5 });
        let values = [x, x + width, y, height, y - height, y];
        if values.iter().any(|value| !value.is_finite()) { return 0; }
        output[index * ENTRY..index * ENTRY + ENTRY].copy_from_slice(&values);
    }
    let (mut right, mut total) = (0.0, 0.0);
    for item in items.chunks_exact(ITEM) {
        if item[DIRECTION] == 2.0 { right += item[LENGTH]; }
        total += item[LENGTH];
    }
    *rtl = if right > total / 2.0 { 1.0 } else { 0.0 };
    1
}
