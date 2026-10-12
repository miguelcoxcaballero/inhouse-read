//! Book header recognition, independent of filename and platform I/O.
fn contains_ascii_case(bytes: &[u8], needle: &[u8]) -> bool {
    bytes.windows(needle.len()).any(|part| part.iter().zip(needle)
        .all(|(a,b)| a.to_ascii_lowercase() == *b))
}

/// 0 unknown, 1 PDF, 2 ZIP, 3 PalmDOC/MOBI, 4 raw FB2.
/// # Safety
/// `input` points to `length` readable bytes; length is limited to 200. A null
/// pointer is permitted only with zero length. No buffers are retained.
#[no_mangle]
pub unsafe extern "C" fn sniff_book_format(input: *const u8, length: usize) -> u32 {
    if input.is_null() || length == 0 || length > 200 { return 0; }
    let bytes = std::slice::from_raw_parts(input, length);
    if bytes.starts_with(b"%PDF-") { return 1; }
    if bytes.starts_with(b"PK\x03\x04") { return 2; }
    if bytes.len() >= 68 && (&bytes[60..68] == b"BOOKMOBI" || &bytes[60..68] == b"TEXtREAd") { return 3; }
    if contains_ascii_case(bytes, b"<?xml") && contains_ascii_case(bytes, b"fictionbook") { return 4; }
    0
}
