//! One page of PDF text in one call: the last geometry round, the rows, the reading order and the
//! joined stream, chained here instead of four round trips through the host with the line objects
//! rebuilt between them. Each stage is the unchanged kernel (pdf_text_geometry.rs, pdf_rows.rs,
//! pdf_order.rs, pdf_stream.rs); this file only carries one stage's numbers to the next, exactly as
//! the JavaScript wrappers did (frozen in tests/unit/helpers/live-pdf-*.js), and answers the two
//! line questions those wrappers asked with regular expressions.
use crate::pdf_order::pdf_order_lines;
use crate::pdf_rows::pdf_row_lines;
use crate::pdf_stream::pdf_text_stream;
use crate::pdf_text_geometry::{pdf_text_geometry_finish, ENTRY, ITEM};

const TRIMMED: usize = 8;
const LENGTH: usize = 9;
const DIRECTION: usize = 10;
/// Per item beside the geometry record: its index in the page's item list, the boundary flags of
/// its text and those of the text without a final soft hyphen (0 when it has none).
pub const EXTRA: usize = 3;
/// Per entry, in reading order: the item, x0, x1, y, height, top, bottom, prefix, trim, start, end.
pub const OUT_ENTRY: usize = 11;
/// Per line, in reading order: entries, x0, x1, y, top, bottom, height, rtl, the offset and length
/// of its column path, start, end, soft hyphen, paragraph.
pub const OUT_LINE: usize = 14;
const PATH_BYTES: usize = 80;
/// The answer of the last page; the host copies what it needs before the next call.
static mut ANSWER: Vec<f64> = Vec::new();
const KEEP: usize = 65536;

/// ECMAScript `\s`: WhiteSpace and LineTerminator.
fn space(unit: u16) -> bool {
    matches!(unit, 9..=13 | 0x20 | 0xa0 | 0x1680 | 0x2000..=0x200a | 0x2028 | 0x2029 | 0x202f | 0x205f | 0x3000 | 0xfeff)
}
fn digit(unit: u16) -> bool { (0x30..=0x39).contains(&unit) }
/// `/^\s*(?:\d{1,5}|[ivxlcdm]{1,7})\s*$/i`: a line that is only a page number.
fn counter(text: &[u16]) -> bool {
    let mut from = 0;
    while from < text.len() && space(text[from]) { from += 1; }
    let mut to = text.len();
    while to > from && space(text[to - 1]) { to -= 1; }
    let body = &text[from..to];
    let roman = |unit: &u16| *unit < 128 && b"ivxlcdm".contains(&((*unit as u8) | 0x20)) && (*unit as u8).is_ascii_alphabetic();
    (1..=5).contains(&body.len()) && body.iter().all(|unit| digit(*unit)) || (1..=7).contains(&body.len()) && body.iter().all(roman)
}
/// `/^(?:[•●▪‣⁃]|\d{1,3}[.)]|[a-z][.)])\s/u` on the text without its leading white space.
fn list_start(text: &[u16]) -> bool {
    let mut from = 0;
    while from < text.len() && space(text[from]) { from += 1; }
    let text = &text[from..];
    let at = |index: usize| text.get(index).copied();
    let close = |index: usize| matches!(at(index), Some(0x2e | 0x29));
    let then = |index: usize| at(index).is_some_and(space);
    let Some(first) = at(0) else { return false };
    if matches!(first, 0x2022 | 0x25cf | 0x25aa | 0x2023 | 0x2043) { return then(1); }
    if digit(first) {
        let mut digits = 1;
        while at(digits).is_some_and(digit) { digits += 1; }
        return digits <= 3 && close(digits) && then(digits + 1);
    }
    (0x61..=0x7a).contains(&first) && close(1) && then(2)
}

/// The page after the two host rounds of pdf_text_geometry_a and _b. Returns 1 with
/// `header = [pointer, lines, text length, path bytes]`, where `pointer` is this module's answer:
/// `count * OUT_ENTRY` numbers, `lines * OUT_LINE` numbers and the ASCII column paths. Returns 0
/// when the page keeps its stream order, -1 for an invalid call and -2 when a stage rejected its
/// input (the host reports a page that could not be computed).
/// # Safety
/// `view`, `items`, `first` and `second` as pdf_text_geometry_finish; `extra` holds `count * EXTRA`
/// numbers, `text` the `units` UTF-16 code units of every item's text in item order, `header` 4.
#[no_mangle]
pub unsafe extern "C" fn pdf_page_text(view: *const f64, items: *const f64, count: usize, first: *const f64, second: *const f64,
    extra: *const f64, text: *const u16, units: usize, header: *mut f64) -> i32 {
    if extra.is_null() || header.is_null() || (text.is_null() && units > 0) { return -1; }
    let mut boxes = vec![0.0; count.min(32768) * ENTRY];
    let mut rtl = 0.0;
    let status = pdf_text_geometry_finish(view, items, count, first, second, boxes.as_mut_ptr(), &mut rtl);
    if status != 1 { return status; }
    let items = std::slice::from_raw_parts(items, count * ITEM);
    let extra = std::slice::from_raw_parts(extra, count * EXTRA);
    let text: &[u16] = if units == 0 { &[] } else { std::slice::from_raw_parts(text, units) };
    let mut starts = Vec::with_capacity(count + 1);
    let mut total = 0usize;
    for item in items.chunks_exact(ITEM) {
        let length = item[LENGTH];
        if !(length >= 0.0) || length.fract() != 0.0 || length > units as f64 { return -1; }
        starts.push(total);
        total += length as usize;
    }
    if total != units { return -1; }
    starts.push(total);

    // Rows: [x0, x1, y, height, top, bottom, rawIndex, max(1, trimmed length), length, rtl].
    let mut input = Vec::with_capacity(count * 10);
    for index in 0..count {
        let item = &items[index * ITEM..(index + 1) * ITEM];
        input.extend_from_slice(&boxes[index * ENTRY..(index + 1) * ENTRY]);
        input.extend_from_slice(&[extra[index * EXTRA], if item[TRIMMED] > 1.0 { item[TRIMMED] } else { 1.0 }, item[LENGTH],
            if item[DIRECTION] == 2.0 { 1.0 } else { 0.0 }]);
    }
    let mut order = vec![0.0; count];
    let mut rows = vec![0.0; count * 9];
    let lines = pdf_row_lines(input.as_ptr(), count, order.as_mut_ptr(), rows.as_mut_ptr()) as usize;
    if lines == 0 || lines > count { return -2; }

    // The text of each row line (its items in line order) answers the two line questions.
    let mut scratch: Vec<u16> = Vec::new();
    let mut lists = vec![false; lines];
    let mut ordering = Vec::with_capacity(lines * 7);
    for line in 0..lines {
        let row = &rows[line * 9..(line + 1) * 9];
        let (start, size) = (row[0] as usize, row[1] as usize);
        scratch.clear();
        for position in start..start + size {
            let item = order[position] as usize;
            scratch.extend_from_slice(&text[starts[item]..starts[item + 1]]);
        }
        lists[line] = list_start(&scratch);
        // [x0, x1, top, bottom, y, height, counter].
        ordering.extend_from_slice(&[row[2], row[3], row[5], row[6], row[4], row[7], if counter(&scratch) { 1.0 } else { 0.0 }]);
    }
    let mut records = vec![0u32; lines * 3];
    let mut paths = vec![0u8; lines * PATH_BYTES];
    if pdf_order_lines(ordering.as_ptr(), lines, if rtl == 1.0 { 1 } else { 0 }, records.as_mut_ptr(), paths.as_mut_ptr(), paths.len()) != lines { return -2; }
    let path = |line: usize| &paths[records[line * 3 + 1] as usize..(records[line * 3 + 1] + records[line * 3 + 2]) as usize];

    // The stream: lines [first entry, entries, y, height, column, rtl, list start] in reading order,
    // entries [x0, x1, height, length, flags, flags without the soft hyphen].
    let mut columns: Vec<&[u8]> = Vec::new();
    let mut stream_lines = Vec::with_capacity(lines * 7);
    let mut stream_entries = Vec::with_capacity(count * 6);
    let mut sources = Vec::with_capacity(count);
    for line in 0..lines {
        let id = records[line * 3] as usize;
        let row = &rows[id * 9..(id + 1) * 9];
        let (start, size) = (row[0] as usize, row[1] as usize);
        let name = path(line);
        let column = columns.iter().position(|known| *known == name).unwrap_or_else(|| { columns.push(name); columns.len() - 1 });
        stream_lines.extend_from_slice(&[sources.len() as f64, size as f64, row[4], row[7], column as f64, row[8], if lists[id] { 1.0 } else { 0.0 }]);
        for position in start..start + size {
            let item = order[position] as usize;
            let area = &boxes[item * ENTRY..(item + 1) * ENTRY];
            stream_entries.extend_from_slice(&[area[0], area[1], area[3], items[item * ITEM + LENGTH], extra[item * EXTRA + 1], extra[item * EXTRA + 2]]);
            sources.push(item);
        }
    }
    if sources.len() != count { return -2; }
    let mut entry_plan = vec![0.0; count * 4];
    let mut line_plan = vec![0.0; lines * 4];
    let size = pdf_text_stream(stream_lines.as_ptr(), lines, columns.len(), stream_entries.as_ptr(), count, entry_plan.as_mut_ptr(), line_plan.as_mut_ptr());
    if size < 0 || size as usize > 16_000_000 + count * 2 { return -2; }

    let path_bytes = records[(lines - 1) * 3 + 1] as usize + records[(lines - 1) * 3 + 2] as usize;
    let answer = &mut *std::ptr::addr_of_mut!(ANSWER);
    answer.clear();
    if answer.capacity() > KEEP { *answer = Vec::new(); }
    answer.reserve(count * OUT_ENTRY + lines * OUT_LINE + path_bytes.div_ceil(8));
    for (position, &item) in sources.iter().enumerate() {
        answer.push(item as f64);
        answer.extend_from_slice(&boxes[item * ENTRY..(item + 1) * ENTRY]);
        answer.extend_from_slice(&entry_plan[position * 4..position * 4 + 4]);
    }
    for line in 0..lines {
        let id = records[line * 3] as usize;
        let row = &rows[id * 9..(id + 1) * 9];
        answer.extend_from_slice(&[row[1], row[2], row[3], row[4], row[5], row[6], row[7], row[8],
            records[line * 3 + 1] as f64, records[line * 3 + 2] as f64]);
        answer.extend_from_slice(&line_plan[line * 4..line * 4 + 4]);
    }
    let numbers = answer.len();
    answer.resize(numbers + path_bytes.div_ceil(8), 0.0);
    std::slice::from_raw_parts_mut(answer.as_mut_ptr().add(numbers) as *mut u8, path_bytes).copy_from_slice(&paths[..path_bytes]);
    std::slice::from_raw_parts_mut(header, 4).copy_from_slice(&[answer.as_ptr() as usize as f64, lines as f64, size as f64, path_bytes as f64]);
    1
}
