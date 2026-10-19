//! Where a Piper voice's files are fetched from: '<family>/<locale>/<name>/<quality>/<piperId>' under the voice base, the
//! repository catalogue that lists their sizes, the author-hosted Serbian model and the Nakdimon pointing model Hebrew
//! needs. Strings go through the engine's own operations (`split`, `join`, ToString, `new URL().href`) so ids keep their
//! exact UTF-16. The base override is read by catalog.js when the app starts (before any book can set it), and its
//! default base comes in from there. The frozen JavaScript original is tests/unit/helpers/reference-voice-urls.js.
use wasm_bindgen::{prelude::*, JsCast};
use js_sys::{Array, JsString, Object};
use crate::host::{construct, read, set, text_value, truthy};

const MARKO: &str = "sr_RS-marko-medium";
const MARKO_BASE: &str = "https://huggingface.co/phantom9623/piper-serbian-tts/resolve/a71694f9ec3480f132dffaf7eb422d43aebd69e0/";
const MARKO_BYTES: f64 = 63_516_051.0;
const HEBREW: &str = "he_IL-saspeech-medium";
const NAKDIMON_URL: &str = "https://raw.githubusercontent.com/OHF-Voice/piper1-gpl/efffbfb226bfb511ebbcf55d0cecd8b35a89743d/src/piper/hebrew/nakdimon.onnx";
const NAKDIMON_BYTES: f64 = 21_312_753.0;
const NAKDIMON_SHA256: &str = "9ff491dcc7d66392019d427a98b97d5de10c0d721628ae740858174ae22b190e";

fn concat(parts: &[&JsValue]) -> JsValue {
    let mut text = JsString::from("");
    for part in parts { text = text.concat(part); }
    text.into()
}
fn s(value: &str) -> JsValue { JsValue::from_str(value) }

/// `family/locale/name/quality/piperId` ('es_MX-claude-high' -> 'es/es_MX/claude/high/es_MX-claude-high'): the
/// dataset name may hold '-' and the quality '_' ('x_low').
fn piper_path(piper_id: &JsValue) -> Result<JsValue, JsValue> {
    let parts: Array = text_value(piper_id).unchecked_into::<JsString>().split("-");
    let locale = parts.shift();
    let quality = parts.pop();
    let quality = if truthy(&quality) { quality } else { s("") };
    let name = parts.join("-");
    let family = locale.unchecked_ref::<JsString>().split("_").get(0);
    let slash = s("/");
    // Template literal parts: ToString, which throws for a Symbol id.
    Ok(JsString::from("").concat(&family).concat(&slash).concat(&locale).concat(&slash).concat(&name.into())
        .concat(&slash).concat(&quality).concat(&slash).concat(piper_id).into())
}

/// The URLs of a voice's model and config, the catalogue and the cache key, plus the companions of the two special voices.
#[wasm_bindgen]
pub fn catalog_voice_urls(piper_id: &JsValue, base: &JsValue, default_base: &JsValue) -> Result<JsValue, JsValue> {
    let relative = piper_path(piper_id)?;
    let path = concat(&[base, &relative]);
    let urls = Object::new();
    set(&urls, "model", &concat(&[&path, &s(".onnx")]))?;
    set(&urls, "config", &concat(&[&path, &s(".onnx.json")]))?;
    set(&urls, "catalogue", &concat(&[base, &s("voices.json")]))?;
    set(&urls, "key", &concat(&[&piper_path(piper_id)?, &s(".onnx")]))?;
    let default = base.as_string().is_some() && base == default_base;
    if piper_id.as_string().as_deref() == Some(MARKO) {
        if default {
            set(&urls, "model", &s(&format!("{MARKO_BASE}sr_Marko_medium.onnx")))?;
            set(&urls, "config", &s(&format!("{MARKO_BASE}sr_Marko_medium.onnx.json")))?;
        }
        set(&urls, "modelBytes", &MARKO_BYTES.into())?;
    }
    if piper_id.as_string().as_deref() == Some(HEBREW) {
        set(&urls, "phonemizerModel", &if default { s(NAKDIMON_URL) } else { concat(&[base, &s("aux/nakdimon.onnx")]) })?;
        set(&urls, "phonemizerSize", &NAKDIMON_BYTES.into())?;
        set(&urls, "phonemizerSha256", &s(NAKDIMON_SHA256))?;
    }
    for name in ["model", "config", "phonemizerModel"] {
        let value = read(&urls, name)?;
        if truthy(&value) { set(&urls, name, &read(&construct("URL", &[&value])?, "href")?)?; }
    }
    Ok(urls.into())
}
