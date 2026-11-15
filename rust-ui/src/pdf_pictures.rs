//! The pictures of a PDF page in its text mode: which regions of the rendered page are illustrations
//! (`pdf_image_rects`) and before which character of the reading stream each one goes
//! (`pdf_place_figures`). Cropping and colour-managed drawing remain PDF.js's and the canvas's.
//!
//! Both were kernels of the numeric core reached through a JavaScript wrapper that the reader's Rust
//! called back (Rust -> JavaScript -> core). They are this module's now, so the reader calls them
//! as ordinary functions; the frozen JavaScript originals they are tested against are
//! tests/unit/helpers/reference-pdf-images.js and reference-pdf-figures.js. A page the kernels
//! cannot answer is an error to report, never a state to work around with a second implementation.
use wasm_bindgen::{prelude::*, JsCast};
use std::fmt::Write;
use js_sys::{Array, Float64Array, Map, Math, Object};
use crate::host::{absent, flag, get, get_at, num, number, read, set, truthy};

/// Pages assembled from tiles can draw many thousands of pictures.
const MAX_IMAGES: f64 = 1_000_000.0;
const MAX_LINES: f64 = 32768.0;
const LINE: usize = 6;

fn refused() -> JsValue { js_sys::Error::new("No se pudo calcular la página del PDF.").into() }
/// A number as `Number.isFinite` wants it: no coercion, anything else is NaN.
fn strict(value: &JsValue, name: &str) -> f64 { get(value, name).as_f64().unwrap_or(f64::NAN) }

/// A stable sort of `order`: `before(b, a)` says that `b` must come before an `a` that precedes it.
/// Written out because the standard sort costs kilobytes for every element type it is used with.
fn sort(order: &mut Vec<u32>, before: &dyn Fn(u32, u32) -> bool) {
    let count = order.len();
    let (mut from, mut to, mut width) = (std::mem::take(order), vec![0_u32; count], 1);
    while width < count {
        let mut start = 0;
        while start < count {
            let (middle, end) = ((start + width).min(count), (start + 2 * width).min(count));
            let (mut left, mut right) = (start, middle);
            for slot in &mut to[start..end] {
                if right < end && (left == middle || before(from[right], from[left])) { *slot = from[right]; right += 1; } else { *slot = from[left]; left += 1; }
            }
            start = end;
        }
        std::mem::swap(&mut from, &mut to);
        width *= 2;
    }
    *order = from;
}

#[derive(Clone, Copy)]
struct Rect { x0: f64, y0: f64, x1: f64, y1: f64 }
/// By top edge, then by left edge (the bounds are finite numbers).
fn in_reading_order(rects: &mut Vec<Rect>) {
    let mut order: Vec<u32> = (0..rects.len() as u32).collect();
    sort(&mut order, &|b, a| { let (a, b) = (rects[a as usize], rects[b as usize]); b.y0 < a.y0 || b.y0 == a.y0 && b.x0 < a.x0 });
    *rects = order.iter().map(|&index| rects[index as usize]).collect();
}

/// Composite image bounds from the renderer's transformed unit-square corners (six numbers a
/// picture). Layered or overlapping tiles are one illustration; disconnected photographs stay
/// separate, including repeated uses of one image.
fn image_rects(source: &[f64], width: f64, height: f64) -> Vec<Rect> {
    let mut rects = Vec::with_capacity(source.len() / 6);
    for c in source.chunks_exact(6) {
        if c.iter().any(|v| !v.is_finite()) { continue; }
        let dx = c[2] + c[4] - c[0]; let dy = c[3] + c[5] - c[1];
        let x0 = 0.0_f64.max((c[0].min(c[2]).min(c[4]).min(dx) * width + 1e-7).floor());
        let y0 = 0.0_f64.max((c[1].min(c[3]).min(c[5]).min(dy) * height + 1e-7).floor());
        let x1 = width.min((c[0].max(c[2]).max(c[4]).max(dx) * width - 1e-7).ceil());
        let y1 = height.min((c[1].max(c[3]).max(c[5]).max(dy) * height - 1e-7).ceil());
        if x1 > x0 && y1 > y0 { rects.push(Rect { x0, y0, x1, y1 }); }
    }
    in_reading_order(&mut rects);
    let mut a = 0;
    while a < rects.len() {
        let mut merged = false; let mut b = a + 1;
        while b < rects.len() {
            let left = rects[a]; let right = rects[b];
            // Sorted top edges cannot overlap after the current composite's bottom.
            if right.y0 >= left.y1 { break; }
            if left.x1.min(right.x1) > left.x0.max(right.x0) && left.y1.min(right.y1) > left.y0.max(right.y0) {
                rects[a] = Rect { x0: left.x0.min(right.x0), y0: left.y0.min(right.y0), x1: left.x1.max(right.x1), y1: left.y1.max(right.y1) };
                rects.remove(b); merged = true; break;
            }
            b += 1;
        }
        // Restart after a merge: its enlarged box can still reach earlier pictures.
        if merged { a = 0; } else { a += 1; }
    }
    in_reading_order(&mut rects);
    rects
}

/// Lines: six numbers each `[x0, x1, y, height, UTF-16 start, column id]`. Rectangles: four each
/// `[x0, y0, x1, y1]`. Parameters: `[cos, sin, scaleX, scaleY, text length]`. The answer is
/// `(rectangle index, UTF-16 offset)` sorted for reading, or nothing for input it refuses. A layout
/// without geometry (no line, no column) puts every figure after the whole text.
fn place_figures(lines: &[f64], columns: usize, rects: &[f64], params: &[f64; 5]) -> Option<Vec<(u32, f64)>> {
    let (count, images) = (lines.len() / LINE, rects.len() / 4);
    if (count == 0) != (columns == 0) || columns > count { return None; }
    if lines.iter().chain(rects).chain(params).any(|v| !v.is_finite()) || params[2] <= 0.0 || params[3] <= 0.0 { return None; }
    let end = params[4];
    if end < 0.0 || end.fract() != 0.0 || end > 9007199254740991.0 { return None; }
    let mut bounds = vec![(f64::INFINITY, f64::NEG_INFINITY); columns];
    for line in lines.chunks_exact(LINE) {
        if line[0] > line[1] || line[3] <= 0.0 || line[4] < 0.0 || line[4] > end || line[4].fract() != 0.0
            || line[5] < 0.0 || line[5] >= columns as f64 || line[5].fract() != 0.0 { return None; }
        let column = &mut bounds[line[5] as usize];
        column.0 = column.0.min(line[0]); column.1 = column.1.max(line[1]);
    }
    if rects.chunks_exact(4).any(|r| r[0] > r[2] || r[1] > r[3]) { return None; }
    let (cos, sin, sx, sy) = (params[0], params[1], params[2], params[3]);
    let mut matches = vec![false; columns];
    let mut offsets = Vec::with_capacity(images);
    for rect in rects.chunks_exact(4) {
        let mut x0 = f64::INFINITY; let mut x1 = f64::NEG_INFINITY; let mut y1 = f64::NEG_INFINITY;
        for (x, y) in [(rect[0], rect[1]), (rect[2], rect[1]), (rect[0], rect[3]), (rect[2], rect[3])] {
            let x = x * sx; let y = y * sy;
            let px = x * cos + y * sin; let py = -x * sin + y * cos;
            if !px.is_finite() || !py.is_finite() { return None; }
            x0 = x0.min(px); x1 = x1.max(px); y1 = y1.max(py);
        }
        let mut any = false;
        for (index, &(left, right)) in bounds.iter().enumerate() { matches[index] = right.min(x1) > left.max(x0); any |= matches[index]; }
        let mut at = end;
        for line in lines.chunks_exact(LINE) {
            if line[2] >= y1 - line[3] * 0.3 && (!any || matches[line[5] as usize]) { at = line[4]; break; }
        }
        offsets.push(at);
    }
    // By offset, then from the top of the page.
    let mut order: Vec<u32> = (0..images as u32).collect();
    sort(&mut order, &|b, a| { let (a, b) = (a as usize, b as usize); offsets[b] < offsets[a] || offsets[b] == offsets[a] && rects[b * 4 + 1] < rects[a * 4 + 1] });
    Some(order.into_iter().map(|index| (index, offsets[index as usize])).collect())
}

/// The corner coordinates PDF.js recorded, as numbers; a value that is not a number is NaN, so its picture is skipped.
fn corners(coordinates: &JsValue, size: u32) -> Vec<f64> {
    // PDF.js records them in a typed array (16- or 32-bit floats): its numbers are copied in one visit.
    if js_sys::ArrayBuffer::is_view(coordinates) {
        let mut list = Float64Array::new(coordinates).to_vec();
        if list.len() >= size as usize { list.truncate(size as usize); return list; }
    }
    (0..size).map(|index| get_at(coordinates, index).as_f64().unwrap_or(f64::NAN)).collect()
}

/// Composite illustration bounds of a page, each `{x0, y0, x1, y1}` in the pixels of a
/// `width` x `height` rendering. An unusable page size has no visible regions; a page with more
/// pictures than the kernel takes is refused.
#[wasm_bindgen]
pub fn pdf_image_rects(coordinates: &JsValue, width: &JsValue, height: &JsValue) -> Result<JsValue, JsValue> {
    // `Number.isFinite` of the original: a size that is not a number is no size.
    let (Some(width), Some(height)) = (width.as_f64(), height.as_f64()) else { return Ok(Array::new().into()) };
    if !(width.is_finite() && height.is_finite() && width > 0.0 && height > 0.0) { return Ok(Array::new().into()); }
    if absent(coordinates) { read(coordinates, "length")?; }
    let count = (number(coordinates, "length") / 6.0).floor();
    if count > MAX_IMAGES { return Err(refused()); }
    if count.is_nan() || count <= 0.0 { return Ok(Array::new().into()); }
    // The bounds are finite numbers, which the engine reads back exactly from their shortest decimal form:
    // the list and its objects are made in one visit, as the literals of the original made them.
    let mut list = String::from("[");
    for rect in image_rects(&corners(coordinates, count as u32 * 6), width, height) {
        if list.len() > 1 { list.push(','); }
        let _ = write!(list, r#"{{"x0":{},"y0":{},"x1":{},"y1":{}}}"#, rect.x0, rect.y0, rect.x1, rect.y1);
    }
    list.push(']');
    js_sys::JSON::parse(&list)
}

/// The text item with the most characters (the first of them): its direction is the page's.
fn dominant(lines: &JsValue, count: u32) -> Option<JsValue> {
    let mut found: Option<(f64, JsValue)> = None;
    for index in 0..count {
        let entries = get(&get_at(lines, index), "entries");
        if !Array::is_array(&entries) { return None; }
        for at in 0..entries.unchecked_ref::<Array>().length() {
            let item = get(&get_at(&entries, at), "item");
            let text = get(&item, "str");
            if !text.is_string() { return None; }
            let length = text.unchecked_ref::<js_sys::JsString>().length() as f64;
            if found.as_ref().is_none_or(|(longest, _)| length > *longest) { found = Some((length, item)); }
        }
    }
    found.map(|(_, item)| item)
}

/// The lines of a layout as the kernel takes them, their number of columns and the dominant text item.
struct Lines { packed: Vec<f64>, columns: usize, item: JsValue }

/// The lines of a layout made by `extractPDFText`, which keeps for this the line records the text kernel
/// wrote (fourteen numbers each: x0, x1, y, height, start and the span of the column's path among them), the
/// paths and the dominant item: nothing is read line by line. `None` when the layout carries no such
/// record, or one that is not about these lines.
fn recorded(layout: &JsValue, count: u32) -> Option<Lines> {
    const RECORD: usize = 14;
    let facts = get(layout, "pictures");
    let records = get(&facts, "lines").dyn_into::<Float64Array>().ok()?.to_vec();
    let paths = get(&facts, "paths").as_string()?;
    let item = get(&facts, "dominant");
    let count = count as usize;
    if records.len() != count * RECORD || !paths.is_ascii() || !item.is_object() { return None; }
    let paths = paths.as_bytes();
    let mut spans = Vec::with_capacity(count);
    for record in records.chunks_exact(RECORD) {
        let (at, length) = (record[8], record[9]);
        if !(at >= 0.0 && length >= 0.0 && at + length <= paths.len() as f64) { return None; }
        spans.push((at as usize, (at + length) as usize));
    }
    // Lines of one path are one column; the columns are numbered in the order of their first lines, as the
    // Map of the original numbered them. Sorting the lines by path brings each column together, first line first.
    let path = |line: u32| { let (from, to) = spans[line as usize]; &paths[from..to] };
    let mut order: Vec<u32> = (0..count as u32).collect();
    sort(&mut order, &|b, a| path(b) < path(a));
    let (mut ids, mut first, mut columns) = (vec![-1.0; count], 0_u32, 0_usize);
    for (rank, &line) in order.iter().enumerate() { if rank == 0 || path(line) != path(first) { first = line; } ids[line as usize] = -1.0 - f64::from(first); }
    for line in 0..count {
        let leader = (-1.0 - ids[line]) as usize;
        ids[line] = if leader == line { columns += 1; (columns - 1) as f64 } else { ids[leader] };
    }
    let mut packed = Vec::with_capacity(count * LINE);
    for (record, id) in records.chunks_exact(RECORD).zip(ids) { packed.extend([record[1], record[2], record[3], record[6], record[10], id]); }
    Some(Lines { packed, columns, item })
}

/// The lines of any other layout, read one by one as the original read them.
fn read_lines(lines: &JsValue, count: u32) -> Option<Lines> {
    let item = dominant(lines, count)?;
    // A column is known by its path; the columns are numbered as a Map meets them, which is how the original told them apart.
    let columns = Map::new();
    let mut packed = Vec::with_capacity(count as usize * LINE);
    for index in 0..count {
        let line = get_at(lines, index);
        let key = get(&line, "column");
        let known = columns.get(&key);
        let column = match known.as_f64() { Some(id) => id, None => { let id = f64::from(columns.size()); columns.set(&key, &id.into()); id } };
        packed.extend([strict(&line, "x0"), strict(&line, "x1"), strict(&line, "y"), strict(&line, "height"), strict(&line, "start"), column]);
    }
    Some(Lines { packed, columns: columns.size() as usize, item })
}

/// Illustrations with the UTF-16 offset of the text they precede, in reading order; each rectangle is the caller's own object.
pub(crate) fn place(rects: &JsValue, layout: &JsValue, source: &JsValue, viewport: &JsValue) -> Result<Vec<(JsValue, f64)>, JsValue> {
    if absent(rects) { read(rects, "length")?; }
    let images = number(rects, "length");
    // A layout without geometry (the plain stream) has no lines: every figure goes after all the text.
    let lines = get(layout, "lines");
    let geometric = flag(layout, "geometric") && flag(&lines, "length");
    let count = if geometric { number(&lines, "length") } else { 0.0 };
    if !truthy(layout) || count > MAX_LINES || images > MAX_LINES { return Err(refused()); }
    if images.is_nan() || images == 0.0 { return Ok(Vec::new()); }
    if images < 0.0 || images.fract() != 0.0 || count.is_nan() || count < 0.0 || count.fract() != 0.0 { return Err(refused()); }
    let (count, images) = (count as u32, images as u32);
    let size = strict(&get(layout, "text"), "length");
    let mut params = [1.0, 0.0, 1.0, 1.0, size];
    let mut page = Lines { packed: Vec::new(), columns: 0, item: JsValue::UNDEFINED };
    if geometric {
        page = match recorded(layout, count) { Some(page) => page, None => read_lines(&lines, count).ok_or_else(refused)? };
        let given = get(viewport, "transform");
        let transform: [f64; 4] = if truthy(&given) { [0, 1, 2, 3].map(|index| num(&get_at(&given, index))) } else { [1.0, 0.0, 0.0, -1.0] };
        let t = get(&page.item, "transform");
        if absent(&t) { return Err(refused()); }
        let (t0, t1) = (num(&get_at(&t, 0)), num(&get_at(&t, 1)));
        // The engine's own trigonometry: the frozen original used it.
        let angle = Math::atan2(transform[1] * t0 + transform[3] * t1, transform[0] * t0 + transform[2] * t1);
        params = [Math::cos(angle), Math::sin(angle), number(viewport, "width") / number(source, "width"), number(viewport, "height") / number(source, "height"), size];
    }
    let mut boxes = Vec::with_capacity(images as usize * 4);
    let mut owned = Vec::with_capacity(images as usize);
    for index in 0..images {
        let rect = get_at(rects, index);
        boxes.extend([strict(&rect, "x0"), strict(&rect, "y0"), strict(&rect, "x1"), strict(&rect, "y1")]);
        owned.push(rect);
    }
    let placed = place_figures(&page.packed, page.columns, &boxes, &params).ok_or_else(refused)?;
    Ok(placed.into_iter().map(|(index, offset)| (owned[index as usize].clone(), offset)).collect())
}

/// The same, as the array of `{rect, offset}` the original answered with.
#[wasm_bindgen]
pub fn pdf_place_figures(rects: &JsValue, layout: &JsValue, source: &JsValue, viewport: &JsValue) -> Result<Array, JsValue> {
    let figures = Array::new();
    for (rect, offset) in place(rects, layout, source, viewport)? {
        let figure = Object::new();
        set(&figure, "rect", &rect)?;
        set(&figure, "offset", &offset.into())?;
        figures.push(&figure);
    }
    Ok(figures)
}
