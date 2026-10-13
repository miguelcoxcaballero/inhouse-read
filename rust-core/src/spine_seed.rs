//! Deterministic spine style numbers of bookshelf-layout.js: FNV-1a over the
//! UTF-16 code units of `${seed}::${salt}`, the same stream the host hashes.
const PRIME: u32 = 0x0100_0193;

fn feed(mut state: u32, units: impl IntoIterator<Item = u16>) -> u32 {
    for unit in units { state = (state ^ unit as u32).wrapping_mul(PRIME); }
    state
}

fn unit_of(base: u32, salt: &str) -> f64 {
    let state = feed(feed(base, "::".encode_utf16()), salt.encode_utf16());
    state as f64 / 4_294_967_296.0
}

/// Writes palette index (12 colours), texture index (4 finishes) and the
/// height unit to `out[0..3]`. Returns 1, or 0 for a rejected request.
/// # Safety
/// `units` points to `length` readable, 2-byte aligned u16 values (no pointer is
/// retained) and `out` to three writable, 8-byte aligned f64 values.
#[no_mangle]
pub unsafe extern "C" fn spine_style_numbers(units: *const u16, length: usize, out: *mut f64) -> u32 {
    if out.is_null() || (units.is_null() && length != 0) || length > 65_536
        || (units as usize) % 2 != 0 || (out as usize) % 8 != 0 { return 0; }
    let seed: &[u16] = if length == 0 { &[] } else { std::slice::from_raw_parts(units, length) };
    let base = feed(0x811c_9dc5, seed.iter().copied());
    let out = std::slice::from_raw_parts_mut(out, 3);
    out[0] = ((unit_of(base, "palette") * 12.0) as usize % 12) as f64;
    out[1] = ((unit_of(base, "texture") * 4.0) as usize % 4) as f64;
    out[2] = unit_of(base, "height");
    1
}
