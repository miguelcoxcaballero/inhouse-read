//! The text side of the Supertonic recipe (adapted from Supertone's MIT-licensed web/helper.js, Copyright (c) 2025
//! Supertone Inc.): the cleanup that precedes the model's character ids, and the cut of a long fragment into chunks
//! that bound latent and audio memory. The frozen JavaScript original is tests/unit/helpers/reference-supertonic-text.js.
//! Unicode compatibility decomposition (NFKD) stays with the browser, which hands over the decomposed text.

/// JavaScript `\s` and the characters `String.prototype.trim` removes.
fn space(c: u32) -> bool { matches!(c, 9..=13 | 32 | 0xa0 | 0x1680 | 0x2000..=0x200a | 0x2028 | 0x2029 | 0x202f | 0x205f | 0x3000 | 0xfeff) }
fn emoji(c: u32) -> bool {
    matches!(c, 0x1f600..=0x1f64f | 0x1f300..=0x1f5ff | 0x1f680..=0x1f6ff | 0x1f700..=0x1f77f | 0x1f780..=0x1f7ff | 0x1f800..=0x1f8ff
        | 0x1f900..=0x1f9ff | 0x1fa00..=0x1faff | 0x2600..=0x27bf | 0x1f1e6..=0x1f1ff)
}
/// A string as code points; a lone surrogate stays one value of its own, as `Array.from` has it.
fn points(units: &[u16]) -> Vec<u32> {
    let mut out = Vec::with_capacity(units.len());
    let mut i = 0;
    while i < units.len() {
        let c = units[i] as u32;
        if (0xd800..0xdc00).contains(&c) && i + 1 < units.len() && (0xdc00..0xe000).contains(&(units[i + 1] as u32)) {
            out.push(0x10000 + ((c - 0xd800) << 10) + (units[i + 1] as u32 - 0xdc00)); i += 2;
        } else { out.push(c); i += 1; }
    }
    out
}
fn units(points: &[u32], out: &mut Vec<u16>) {
    for &c in points {
        if c >= 0x10000 { let v = c - 0x10000; out.push(0xd800 + (v >> 10) as u16); out.push(0xdc00 + (v & 0x3ff) as u16); } else { out.push(c as u16); }
    }
}
/// `text.replaceAll(from, to)`: non-overlapping, left to right.
fn replace_all(text: Vec<u32>, from: &str, to: &str) -> Vec<u32> {
    let from: Vec<u32> = from.chars().map(|c| c as u32).collect();
    let mut out = Vec::with_capacity(text.len());
    let mut i = 0;
    while i < text.len() {
        if text[i..].starts_with(&from) { out.extend(to.chars().map(|c| c as u32)); i += from.len(); } else { out.push(text[i]); i += 1; }
    }
    out
}
/// A run of two or more of `mark` becomes one.
fn collapse(text: Vec<u32>, mark: u32) -> Vec<u32> {
    let mut out: Vec<u32> = Vec::with_capacity(text.len());
    for c in text { if c == mark && out.last() == Some(&mark) { continue; } out.push(c); }
    out
}

/// `normalizeSupertonicText` after the language check: `<es>text.</es>`, or nothing when nothing speakable is left.
/// `text` is already NFKD-decomposed. Writes UTF-16 to `output` and returns its length, `-1` for misuse and `-2` if
/// `capacity` is too small (8 units per input unit and 64 more always suffice).
/// # Safety: live disjoint buffers of the declared sizes.
#[no_mangle]
pub unsafe extern "C" fn supertonic_normalize(text: *const u16, len: usize, lang: *const u16, lang_len: usize, output: *mut u16, capacity: usize) -> i32 {
    if (len > 0 && text.is_null()) || lang.is_null() || output.is_null() || lang_len == 0 || len > 16_000_000 { return -1; }
    let source = if len == 0 { &[][..] } else { std::slice::from_raw_parts(text, len) };
    let mut value: Vec<u32> = points(source).into_iter().filter(|&c| !emoji(c)).map(|c| match c {
        0x2013 | 0x2011 | 0x2014 => 0x2d,
        0x5f | 0x5b | 0x5d | 0x7c | 0x2f | 0x23 | 0x2192 | 0x2190 => 0x20,
        0x201c | 0x201d => 0x22,
        0x2018 | 0x2019 | 0xb4 | 0x60 => 0x27,
        other => other,
    }).filter(|c| !matches!(c, 0x2665 | 0x2606 | 0x2661 | 0xa9 | 0x5c)).collect();
    value = replace_all(value, "@", " at ");
    value = replace_all(value, "e.g.,", "for example, ");
    value = replace_all(value, "i.e.,", "that is, ");
    // `\s+([,.!?;:'])` -> `$1`: spaces before a mark are dropped.
    let mut tight = Vec::with_capacity(value.len());
    let mut i = 0;
    while i < value.len() {
        if space(value[i]) {
            let mut j = i;
            while j < value.len() && space(value[j]) { j += 1; }
            if j < value.len() && matches!(value[j], 0x2c | 0x2e | 0x21 | 0x3f | 0x3b | 0x3a | 0x27) { tight.push(value[j]); i = j + 1; } else { tight.extend_from_slice(&value[i..j]); i = j; }
        } else { tight.push(value[i]); i += 1; }
    }
    value = collapse(collapse(tight, 0x22), 0x27);
    // `\s+` -> one space, then trim.
    let mut words: Vec<u32> = Vec::with_capacity(value.len());
    for c in value { if space(c) { if words.last() != Some(&0x20) { words.push(0x20); } } else { words.push(c); } }
    while words.first() == Some(&0x20) { words.remove(0); }
    while words.last() == Some(&0x20) { words.pop(); }
    let mut result: Vec<u16> = Vec::with_capacity(words.len() + 2 * lang_len + 8);
    if !words.is_empty() {
        if !matches!(words[words.len() - 1], 0x2e | 0x21 | 0x3f | 0x3b | 0x3a | 0x2c | 0x27 | 0x22 | 0x29 | 0x5d | 0x7d | 0x2026 | 0x3002 | 0x300d | 0x300f | 0x3011 | 0x3009 | 0x300b | 0x203a | 0xbb) { words.push(0x2e); }
        let tag = std::slice::from_raw_parts(lang, lang_len);
        result.push(0x3c); result.extend_from_slice(tag); result.push(0x3e);
        units(&words, &mut result);
        result.push(0x3c); result.push(0x2f); result.extend_from_slice(tag); result.push(0x3e);
    }
    if result.len() > capacity { return -2; }
    std::ptr::copy_nonoverlapping(result.as_ptr(), output, result.len());
    result.len() as i32
}

/// `supertonicTextChunks`: the text, trimmed, is cut every `limit` code points, at the last space or sentence mark in the
/// second half of the window when there is one; every chunk is trimmed and empty ones dropped. Writes the UTF-16 range
/// `[start, end)` of each chunk (of `text` itself) to `output` and returns how many, `-1` for misuse and `-2` when more
/// than `capacity` would be needed.
/// # Safety: live disjoint buffers; `output` holds `2 * capacity` u32.
#[no_mangle]
pub unsafe extern "C" fn supertonic_chunks(text: *const u16, len: usize, limit: usize, output: *mut u32, capacity: usize) -> i32 {
    if (len > 0 && text.is_null()) || output.is_null() || limit < 2 || len > 16_000_000 { return -1; }
    let source = if len == 0 { &[][..] } else { std::slice::from_raw_parts(text, len) };
    // Trim like String.prototype.trim, then walk code points, remembering where each one starts in the units.
    let first = source.iter().position(|&c| !space(c as u32)).unwrap_or(source.len());
    let last = source.iter().rposition(|&c| !space(c as u32)).map_or(first, |at| at + 1);
    let body = &source[first..last];
    let chars = points(body);
    let mut at = Vec::with_capacity(chars.len() + 1);
    let mut unit = first;
    for &c in &chars { at.push(unit); unit += if c >= 0x10000 { 2 } else { 1 }; }
    at.push(unit);
    let mut found = 0;
    let mut start = 0;
    while start < chars.len() {
        let mut end = chars.len().min(start + limit);
        if end < chars.len() {
            let mut i = end;
            // `i > start + limit/2` with limit/2 not necessarily whole.
            while (i as f64) > start as f64 + limit as f64 / 2.0 {
                if matches!(chars[i - 1], 0x2e | 0x21 | 0x3f | 0x3b | 0x3002 | 0xff01 | 0xff1f) || space(chars[i - 1]) { end = i; break; }
                i -= 1;
            }
        }
        // The chunk without its surrounding white space.
        let (mut a, mut b) = (start, end);
        while a < b && space(chars[a]) { a += 1; }
        while b > a && space(chars[b - 1]) { b -= 1; }
        if b > a {
            if found >= capacity { return -2; }
            *output.add(found * 2) = at[a] as u32; *output.add(found * 2 + 1) = at[b] as u32; found += 1;
        }
        start = end;
    }
    found as i32
}
