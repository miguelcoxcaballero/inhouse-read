//! The index of the recorded clip atlas of the shelf's sounds (src/assets/sfx: 16-bit PCM plus a
//! JSON index), read once when the atlas arrives. Fetching it, and choosing and decoding a take per
//! impact, stay with the host (cozy-sounds.js): driven from here, one impact's buffer cost 9.9 us
//! instead of 0.7 us, every Map and property read crossing the boundary.
use js_sys::{Array, JsString, Map, Object, Reflect};
use wasm_bindgen::{prelude::*, JsCast};
use crate::host::{absent, num, read, truthy};

fn key(name: &str) -> JsValue { JsValue::from_str(name) }
fn integer(value: &JsValue) -> Option<f64> { value.as_f64().filter(|number| number.is_finite() && number.fract() == 0.0) }

/// The atlas index as groups of takes (`book_set_wood_t0`… belong to `book_set_wood`), keeping only
/// the clips that lie inside `samples` and play at 8–96 kHz.
#[wasm_bindgen]
pub fn cozy_atlas_index(index: &JsValue, samples: &JsValue) -> Result<Map, JsValue> {
    let found = Map::new();
    let source: Object = if truthy(index) && index.is_object() { index.clone().unchecked_into() } else { Object::new() };
    let samples = num(samples);
    for entry in Object::entries(&source).iter() {
        let name = Reflect::get(&entry, &JsValue::from_f64(0.0))?;
        let clip = Reflect::get(&entry, &JsValue::from_f64(1.0))?;
        let (offset, length) = if absent(&clip) { (JsValue::UNDEFINED, JsValue::UNDEFINED) } else { (read(&clip, "offset")?, read(&clip, "length")?) };
        let rate = if absent(&clip) { JsValue::UNDEFINED } else { read(&clip, "rate")? };
        let rate = if absent(&rate) { JsValue::from_f64(24000.0) } else { rate };
        let (Some(start), Some(size)) = (integer(&offset), integer(&length)) else { continue };
        let hertz = num(&rate);
        if start < 0.0 || size < 2.0 || start + size > samples || !(hertz >= 8000.0 && hertz <= 96000.0) { continue; }
        // `name.replace(/_t\d+$/, '')`: the final `_t` and digits.
        let text: JsString = name.clone().unchecked_into();
        let mut cut = text.length();
        while cut > 0 && (48.0..=57.0).contains(&text.char_code_at(cut - 1)) { cut -= 1; }
        let group: JsValue = if cut < text.length() && cut >= 2 && text.char_code_at(cut - 1) == 116.0 && text.char_code_at(cut - 2) == 95.0 { text.slice(0, cut - 2).into() } else { name.clone() };
        if !found.has(&group) { found.set(&group, &Array::new()); }
        let take = Object::new();
        Reflect::set(&take, &key("name"), &name)?;
        Reflect::set(&take, &key("offset"), &offset)?;
        Reflect::set(&take, &key("length"), &length)?;
        Reflect::set(&take, &key("rate"), &rate)?;
        found.get(&group).unchecked_into::<Array>().push(&take);
    }
    Ok(found)
}
