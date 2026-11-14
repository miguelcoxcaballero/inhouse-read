//! The title-font search's policy inside the shelf module (formerly src/js/font-policy-wasm.js, a bridge to
//! the numeric core): the wrap of a title into lines, a family's wrap cache, the raster plan of a search and
//! the choice among the families' scores. The kernels are the core's own (rust-core/src/font.rs, compiled into
//! this module by `#[path]`), so each is a plain call. Canvas measurement and locale case conversion stay the
//! browser's: `measureText` is asked for the same spans, in the same order, as the bridge asked.
use js_sys::{Array, Float64Array, JsString};
use wasm_bindgen::prelude::*;
use wasm_bindgen::JsCast;
use crate::font::{font_family_max, font_family_select, font_search_plan, font_wrap_cache_free, font_wrap_cache_get, font_wrap_cache_new,
    font_wrap_cache_store, font_wrap_free, font_wrap_new, font_wrap_result, font_wrap_result_len, font_wrap_step, font_wrap_text,
    font_wrap_text_len, TitleWrap, TitleWrapCache};
use crate::host::{absent, num, text_value};

#[wasm_bindgen]
extern "C" {
    type Surface;
    #[wasm_bindgen(method, catch, js_name = measureText)]
    fn measure_text(this: &Surface, text: &JsString) -> Result<Metrics, JsValue>;
    type Metrics;
    #[wasm_bindgen(method, getter, catch)]
    fn width(this: &Metrics) -> Result<JsValue, JsValue>;
}

/// The UTF-16 units the engine holds: a string without U+FFFD crosses once; one that has it (or a lone
/// surrogate the crossing replaced by it) is read unit by unit.
fn units(text: &JsString) -> Vec<u16> {
    match text.as_string() { Some(utf8) if !utf8.contains('\u{FFFD}') => utf8.encode_utf16().collect(), _ => text.iter().collect() }
}
/// The host string of `units` (`String.fromCharCode` in runs of 8192, like the bridge).
fn host_text(units: &[u16]) -> JsString {
    let mut chunks = units.chunks(8192);
    let mut text = JsString::from_char_code(chunks.next().unwrap_or(&[]));
    for chunk in chunks { text = text.concat(&JsString::from_char_code(chunk)); }
    text
}
/// The finished wrap's lines, each a slice of its normalised text.
unsafe fn lines_of(wrap: *const TitleWrap, text: &JsString) -> Array {
    let spans = std::slice::from_raw_parts(font_wrap_result(wrap), font_wrap_result_len(wrap));
    let lines = Array::new();
    for span in spans.chunks_exact(2) { lines.push(&text.slice(span[0], span[1])); }
    lines
}

/// One family's wraps: the same title at three alignments measures the same, so its eight case/size wraps are
/// kept until the family's rasters end. The host's raster (`fontMask`) asks it for the lines of each mask.
#[wasm_bindgen]
pub struct FontWraps { cache: *mut TitleWrapCache, texts: [Option<JsString>; 8] }

impl Drop for FontWraps {
    fn drop(&mut self) { self.dispose(); }
}

#[wasm_bindgen]
impl FontWraps {
    /// An empty cache (the analyser makes one per family; the constructor is what the tests reach).
    #[wasm_bindgen(constructor)]
    pub fn new() -> FontWraps { FontWraps { cache: font_wrap_cache_new(), texts: Default::default() } }

    /// The lines of `title` within `width`, measured on `context`; `key` names the case and size of the wrap.
    pub fn lines(&mut self, context: &JsValue, title: &JsValue, width: f64, key: f64) -> Result<Array, JsValue> {
        if self.cache.is_null() { return Err(js_sys::Error::new("Font wrapping cache disposed").into()); }
        let key = key as i32 as usize;
        unsafe {
            let cached = font_wrap_cache_get(self.cache, key);
            if !cached.is_null() {
                let text = match self.texts.get(key) { Some(Some(text)) => text.clone(), _ => host_text(std::slice::from_raw_parts(font_wrap_text(cached), font_wrap_text_len(cached))) };
                return Ok(lines_of(cached, &text));
            }
            let source = if absent(title) { Vec::new() } else { units(text_value(title).unchecked_ref()) };
            let wrap = font_wrap_new(source.as_ptr(), source.len());
            if wrap.is_null() { return Err(js_sys::Error::new("Invalid font title").into()); }
            let text = host_text(std::slice::from_raw_parts(font_wrap_text(wrap), font_wrap_text_len(wrap)));
            let surface: &Surface = context.unchecked_ref();
            let mut measured = f64::NAN;
            loop {
                // 0 = finished; otherwise start + end * 2^21 + measure * 2^42.
                let code = font_wrap_step(wrap, measured, width);
                if code == 0.0 { break; }
                let (measure, span) = (code >= 4_398_046_511_104.0, code % 4_398_046_511_104.0);
                let (start, end) = (span % 2_097_152.0, (span / 2_097_152.0).floor());
                measured = if !measure { f64::NAN } else {
                    match surface.measure_text(&text.slice(start as u32, end as u32)).and_then(|metrics| metrics.width()) {
                        Ok(width) => num(&width),
                        Err(failure) => { font_wrap_free(wrap); return Err(failure); }
                    }
                };
            }
            let lines = lines_of(wrap, &text);
            if font_wrap_cache_store(self.cache, key, wrap) == 1 { self.texts[key] = Some(text); } else { font_wrap_free(wrap); }
            Ok(lines)
        }
    }

    /// The end of the family's rasters: every kept wrap is released, and `lines` refuses from here on.
    pub fn dispose(&mut self) {
        if !self.cache.is_null() { unsafe { font_wrap_cache_free(self.cache); } self.cache = std::ptr::null_mut(); }
        self.texts = Default::default();
    }
}

/// The raster requests of one family for `String(title)`: twelve, or twenty-four when upper case changes the
/// title; each is `[upper, alignment, size, canvasHeight, x, lineHeight, lineWidth, key]`.
pub(crate) fn search_plan(title: &JsValue, width: f64) -> Array {
    let text: JsString = text_value(title).unchecked_into();
    let changes = JsValue::from(text.to_locale_upper_case(None)) != JsValue::from(text);
    let mut values = [0.0; 24 * 8];
    let count = unsafe { font_search_plan(u32::from(changes), width, values.as_mut_ptr()) };
    let plans = Array::new();
    for plan in values[..count * 8].chunks_exact(8) {
        let row = Array::new();
        for value in plan { row.push(&JsValue::from_f64(*value)); }
        plans.push(&row);
    }
    plans
}
/// The best score of a family's masks (NaN when any is).
pub(crate) fn family_max(scores: &JsValue) -> f64 {
    let scores = Float64Array::new(scores).to_vec();
    unsafe { font_family_max(scores.as_ptr(), scores.len()) }
}
/// The index of the family that wins clearly, or -1.
pub(crate) fn family_select(scores: &JsValue) -> i32 {
    let scores = Float64Array::new(scores).to_vec();
    unsafe { font_family_select(scores.as_ptr(), scores.len()) }
}
