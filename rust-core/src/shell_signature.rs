//! Which files make a deployed index.html a different app: the hashed module scripts and the
//! stylesheets it loads. The tags are read one by one, not with a single pattern, so the order
//! in which a bundler writes their attributes does not matter. Offsets are UTF-16 units of the
//! document, so the host slices the very text it passed in and resolves the URLs itself.

fn word(unit: u16) -> bool { matches!(unit, 0x30..=0x39 | 0x41..=0x5A | 0x61..=0x7A | 0x5F) }
fn lower(unit: u16) -> u16 { if (0x41..=0x5A).contains(&unit) { unit + 32 } else { unit } }
fn quote(unit: Option<&u16>) -> bool { matches!(unit, Some(0x22) | Some(0x27)) }
/// JavaScript's `\s`.
fn space(unit: u16) -> bool {
    matches!(unit, 0x09..=0x0D | 0x20 | 0xA0 | 0x1680 | 0x2000..=0x200A | 0x2028 | 0x2029 | 0x202F | 0x205F | 0x3000 | 0xFEFF)
}
/// `text[at..]` starts with `pattern`, ASCII letters in either case.
fn at(text: &[u16], at: usize, pattern: &str) -> bool {
    let end = at + pattern.len();
    end <= text.len() && pattern.bytes().zip(&text[at..end]).all(|(wanted, &unit)| wanted as u16 == lower(unit))
}
/// `name`, `=`, a quote, `value` and a quote, anywhere in the tag.
fn has_pair(tag: &[u16], name: &str, value: &str) -> bool {
    let (n, v) = (name.len(), value.len());
    (0..tag.len()).any(|start| at(tag, start, name) && at(tag, start + n, "=") && quote(tag.get(start + n + 1))
        && at(tag, start + n + 2, value) && quote(tag.get(start + n + 2 + v)))
}
/// A white space, `name`, `=`, a quote, one or more characters that are no quote and a quote:
/// the span of those characters.
fn attribute(tag: &[u16], name: &str) -> Option<(usize, usize)> {
    let n = name.len();
    for start in 0..tag.len() {
        if !space(tag[start]) || !at(tag, start + 1, name) || !at(tag, start + 1 + n, "=") || !quote(tag.get(start + 2 + n)) { continue; }
        let first = start + 3 + n;
        let end = (first..tag.len()).find(|&index| quote(Some(&tag[index])));
        if let Some(end) = end { if end > first { return Some((first, end)); } }
    }
    None
}

/// The span of each file reference, in document order: `script type="module" src` and `link rel="stylesheet" href`.
fn references(text: &[u16]) -> Vec<(usize, usize)> {
    let mut found = Vec::new();
    let mut index = 0;
    while index < text.len() {
        if text[index] != 0x3C { index += 1; continue; }
        let script = at(text, index + 1, "script") && !text.get(index + 7).is_some_and(|&unit| word(unit));
        let link = !script && at(text, index + 1, "link") && !text.get(index + 5).is_some_and(|&unit| word(unit));
        if !script && !link { index += 1; continue; }
        // `[^>]*>`: with no closing bracket left, no later tag can close either.
        let Some(close) = text[index..].iter().position(|&unit| unit == 0x3E) else { break };
        let tag = &text[index..index + close + 1];
        let span = if script {
            if has_pair(tag, "type", "module") { attribute(tag, "src") } else { None }
        } else if has_pair(tag, "rel", "stylesheet") { attribute(tag, "href") } else { None };
        if let Some((start, end)) = span { found.push((index + start, index + end)); }
        index += close + 1;
    }
    found
}

/// Writes the (start, end) pairs of the references of the UTF-16 document at `text` into `out`
/// as f64 values, as many as `capacity` pairs allow, and returns how many there are.
/// # Safety
/// `text` points to `length` readable u16 values and `out` to `capacity` * 2 writable, 8-byte aligned f64 values.
#[no_mangle]
pub unsafe extern "C" fn shell_file_refs(text: *const u16, length: usize, out: *mut f64, capacity: usize) -> usize {
    if text.is_null() || out.is_null() || (out as usize) % 8 != 0 { return 0; }
    let found = references(std::slice::from_raw_parts(text, length));
    let room = std::slice::from_raw_parts_mut(out, capacity * 2);
    for (slot, (start, end)) in room.chunks_exact_mut(2).zip(&found) { slot[0] = *start as f64; slot[1] = *end as f64; }
    found.len()
}
