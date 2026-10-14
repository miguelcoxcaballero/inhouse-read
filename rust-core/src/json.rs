//! A tiny JSON writer for the static tables the host receives. Numbers are
//! printed with Rust's shortest round-trip form, which `JSON.parse` reads back
//! to the identical f64. Keys keep the order they were written in.

pub enum V { N(f64), S(String), B(bool), A(Vec<V>), O(Vec<(String, V)>) }

pub fn s(text: &str) -> V { V::S(text.to_string()) }
pub fn n(number: f64) -> V { V::N(number) }
pub fn obj(items: Vec<(&str, V)>) -> V { V::O(items.into_iter().map(|(key, value)| (key.to_string(), value)).collect()) }
pub fn nums(list: &[f64]) -> V { V::A(list.iter().map(|&number| V::N(number)).collect()) }

impl V {
    pub fn write(&self, out: &mut String) {
        match self {
            V::N(number) => {
                // JSON has no NaN/Infinity: none of the tables contain one.
                if number.is_finite() { out.push_str(&format!("{}", number)); } else { out.push_str("null"); }
            }
            V::B(flag) => out.push_str(if *flag { "true" } else { "false" }),
            V::S(text) => {
                out.push('"');
                for ch in text.chars() {
                    match ch {
                        '"' => out.push_str("\\\""),
                        '\\' => out.push_str("\\\\"),
                        c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
                        c => out.push(c),
                    }
                }
                out.push('"');
            }
            V::A(list) => {
                out.push('[');
                for (index, value) in list.iter().enumerate() {
                    if index > 0 { out.push(','); }
                    value.write(out);
                }
                out.push(']');
            }
            V::O(list) => {
                out.push('{');
                for (index, (key, value)) in list.iter().enumerate() {
                    if index > 0 { out.push(','); }
                    V::S(key.clone()).write(out);
                    out.push(':');
                    value.write(out);
                }
                out.push('}');
            }
        }
    }
}

/// Writes `value` as UTF-8 into `out` when `capacity` allows and returns its
/// length in bytes: the host asks once for the size and once for the bytes.
/// # Safety
/// `out` is null or points to `capacity` writable bytes.
pub unsafe fn export(value: &V, out: *mut u8, capacity: usize) -> usize {
    let mut text = String::new();
    value.write(&mut text);
    if !out.is_null() && capacity >= text.len() {
        std::ptr::copy_nonoverlapping(text.as_ptr(), out, text.len());
    }
    text.len()
}
