//! A name that is safe to give a file in the library folder: every run of the characters that
//! file systems reserve becomes one underscore, the ends lose their white space and an empty
//! name becomes "libro". Operates on UTF-16 units, as the host's strings are.

/// JavaScript's `\s`, which is also what `String.prototype.trim` removes.
fn space(unit: u16) -> bool {
    matches!(unit, 0x09..=0x0D | 0x20 | 0xA0 | 0x1680 | 0x2000..=0x200A | 0x2028 | 0x2029 | 0x202F | 0x205F | 0x3000 | 0xFEFF)
}
fn reserved(unit: u16) -> bool { matches!(unit, 0x5C | 0x2F | 0x3A | 0x2A | 0x3F | 0x22 | 0x3C | 0x3E | 0x7C) }

pub fn sanitize(name: &[u16]) -> Vec<u16> {
    let mut replaced = Vec::with_capacity(name.len());
    let mut in_run = false;
    for &unit in name {
        if reserved(unit) { if !in_run { replaced.push(0x5F); in_run = true; } }
        else { replaced.push(unit); in_run = false; }
    }
    let start = replaced.iter().position(|&unit| !space(unit)).unwrap_or(replaced.len());
    let end = replaced.iter().rposition(|&unit| !space(unit)).map_or(start, |last| last + 1);
    if start >= end { "libro".encode_utf16().collect() } else { replaced[start..end].to_vec() }
}

/// Writes the sanitized name (never longer than the input, but at least five units) to `out` and
/// returns its length; a null or too small `out` only measures it.
/// # Safety
/// `name` points to `length` readable u16 values; `out` is null or points to `capacity` writable u16 values.
#[no_mangle]
pub unsafe extern "C" fn sanitize_file_name(name: *const u16, length: usize, out: *mut u16, capacity: usize) -> usize {
    if name.is_null() && length > 0 { return 0; }
    let clean = sanitize(if length == 0 { &[] } else { std::slice::from_raw_parts(name, length) });
    if !out.is_null() && clean.len() <= capacity { std::slice::from_raw_parts_mut(out, clean.len()).copy_from_slice(&clean); }
    clean.len()
}
