//! The doors of readers/voice-catalog.js and voice-order.js that only led back into this module: which ids are a
//! natural voice, the language a book declares, the voice chosen for a fragment, the language of a text, the Spanish
//! names of languages and regions, the order of the picker's list and the voice it recommends. The reader's kits
//! named them as JavaScript functions (Rust -> JavaScript -> Rust); they are answered here, by one export
//! (`catalog_door`) that a door binds its number to.
//! `normalizeLang` stays the page's (`kit.catalog.normalizeLang`): saved preferences need it before this module loads.
//! A kit that names a door is asked first, which is how a test hands the reader its own.
use wasm_bindgen::{prelude::*, JsCast};
use js_sys::{Array, Function, JsString, Object, Reflect};
use crate::host::{get, global, method, read, set};
use crate::reader_experience_policy::bound;

type R<T = JsValue> = Result<T, JsValue>;

// The browser's collation of two strings: `spanish` asks for the Spanish order (the picker's names and labels).
// A function of the page itself, so a sort calls it without passing through this module again.
#[wasm_bindgen(inline_js = "export const ihr_collate=(a,b,spanish)=>spanish?a.localeCompare(b,'es'):a.localeCompare(b)")]
extern "C" {
    #[wasm_bindgen(thread_local_v2, js_name = ihr_collate)]
    static COLLATE: Function;
}
#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(catch, js_name = String)]
    fn text(value: &JsValue) -> Result<JsValue, JsValue>;
}
fn collate() -> Function { COLLATE.with(Function::clone) }
/// Rust leaves a foreign record unanswered (undefined) instead of coercing it: the wrappers threw.
fn answered(result: JsValue) -> R { if result.is_undefined() { Err(js_sys::TypeError::new("Unsupported neural voice record").into()) } else { Ok(result) } }
fn or_else(value: JsValue, default: &str) -> JsValue { if value.is_undefined() { default.into() } else { value } }
fn function(value: &JsValue) -> Function { value.clone().unchecked_into() }

/// `declaredLanguage(reader)`: the language a book itself declares (its metadata), or ''. reader.language falls back to
/// the device's language, which says nothing about the book: a PDF has no language.
fn declared_language(reader: &JsValue) -> JsValue {
    let declared = || -> R {
        let optional = |value: &JsValue, name: &str| if value.is_null() || value.is_undefined() { Ok(JsValue::UNDEFINED) } else { read(value, name) };
        let language = optional(&optional(reader, "metadata")?, "language")?;
        let language = if Array::is_array(&language) { Reflect::get_u32(&language, 0)? } else { language };
        text(&if language.is_truthy() { language } else { "".into() })
    };
    declared().unwrap_or_else(|_| "".into())
}
/// `resolveVoice(voices, options)`: the voice and language of one utterance (voice_catalog.rs `catalog_resolve_voice`).
#[inline(never)]
fn resolve(normalize: &JsValue, voices: &JsValue, options: &JsValue) -> R {
    answered(crate::voice_catalog::catalog_resolve_voice(voices.clone(), options.clone(), function(normalize), collate())?)
}
/// `detectLanguage(text, fallback = 'en-US')`.
#[inline(never)]
fn detect_language(normalize: &JsValue, text: JsValue, fallback: JsValue) -> R {
    crate::language_detect::detect_voice_language(text, or_else(fallback, "en-US"), function(normalize))
}

/// The browser's own name of a language or a region, in Spanish because the interface is; the code itself when it has none.
fn host_name(code: &str, kind: &str) -> R<String> {
    let asked = || -> R {
        let options: JsValue = Object::new().into();
        set(&options, "type", &kind.into())?;
        let names = Reflect::construct(read(&read(&global(), "Intl")?, "DisplayNames")?.unchecked_ref(), &Array::of2(&Array::of1(&"es".into()), &options))?;
        method(&names, "of", &[&code.into()])
    };
    let name = match asked() { Ok(value) if value.is_truthy() && value != JsValue::from_str(code) => value, _ => JsValue::from_str("") };
    let name: JsString = if name.is_truthy() { name } else { JsValue::from_str(code) }.unchecked_into();
    let name = if kind == "language" { name.char_at(0).to_locale_upper_case(Some("es")).concat(&name.slice(1, name.length())) } else { name };
    Ok(name.as_string().unwrap_or_default())
}
/// `baseLanguageName(tag)` (kind 0: 'Español' for 'es-MX'), `regionName(tag)` (1: 'México') and `languageName(tag)`
/// (2: 'Español (México)'); the tag is normalised once for each part it reads, as `langBase` and `langRegion` did.
#[inline(never)]
fn name_of(normalize: &JsValue, kind: u32, tag: &JsValue) -> R<String> {
    use crate::voice_catalog::{base_language_name, region_name};
    let part = |index: usize| -> R<String> {
        Ok(function(normalize).call1(&JsValue::UNDEFINED, tag)?.as_string().unwrap_or_default().split('-').nth(index).unwrap_or("").to_owned())
    };
    if kind == 1 { return region_name(&part(1)?, &host_name); }
    let base = part(0)?;
    let region = if kind == 2 { part(1)? } else { String::new() };
    let mut name = base_language_name(&base, &host_name)?;
    if kind == 2 && !name.is_empty() {
        let place = region_name(&region, &host_name)?;
        if !place.is_empty() { name = format!("{name} ({place})"); }
    }
    Ok(name)
}
/// `Array.isArray(voices) ? voices : [...(voices || [])]`.
fn list(voices: JsValue) -> R {
    if Array::is_array(&voices) { return Ok(voices); }
    let made = Array::new();
    if voices.is_truthy() {
        for item in js_sys::try_iter(&voices)?.ok_or_else(|| JsValue::from(js_sys::TypeError::new("voices is not iterable")))? { made.push(&item?); }
    }
    Ok(made.into())
}

/// One door of the catalogue, by its number:
/// 0 `isNeuralId(id)`; 1 `declaredLanguage(reader)`; 2 `resolveVoice(voices, options)`;
/// 3 `detectLanguage(text, fallback = 'en-US')`; 4 `baseLanguageName(tag)`; 5 `regionName(tag)`; 6 `languageName(tag)`;
/// 7 `orderNeuralVoices(voices, {bookLang: a, deviceLang: b})`, the two tags in a row as the picker asks;
/// 8 `recommendedNeuralFor(voices, lang, deviceLang = '')`.
#[wasm_bindgen]
pub fn catalog_door(normalize: &JsValue, which: u32, a: JsValue, b: JsValue, c: JsValue) -> R {
    let label = |tag: &JsValue| -> R { Ok(name_of(normalize, 2, tag)?.into()) };
    match which {
        0 => Ok(crate::voice_catalog::is_neural_id(&a).into()),
        1 => Ok(declared_language(&a)),
        2 => resolve(normalize, &a, &b),
        3 => detect_language(normalize, a, b),
        4..=6 => Ok(name_of(normalize, which - 4, &a)?.into()),
        7 => answered(crate::voice_order::order(list(a)?, or_else(b, ""), or_else(c, ""), &function(normalize), &label, &collate())?),
        _ => answered(crate::voice_order::recommended(list(a)?, b, or_else(c, ""), &function(normalize), &label, &collate())?),
    }
}

const NAMES: [&str; 9] = ["isNeuralId", "declaredLanguage", "resolveVoice", "detectLanguage", "baseLanguageName", "regionName", "languageName", "order", "recommendedNeuralFor"];
/// This module's own door `name`, over the page's `normalize`.
pub(crate) fn own(normalize: &JsValue, ui: &JsValue, name: &str) -> R<Function> {
    let which = NAMES.iter().position(|known| *known == name).ok_or_else(|| JsValue::from(js_sys::TypeError::new(&format!("catalog.{name} is not a function"))))?;
    bound(ui, "catalog_door", &[normalize, &(which as u32).into()])
}
/// `kit.catalog[name]`, or this module's own door when the kit does not name one.
pub(crate) fn door(kit: &JsValue, ui: &JsValue, name: &str) -> R<Function> {
    let catalog = read(kit, "catalog")?;
    let given = get(&catalog, name);
    if !given.is_undefined() { return Ok(given.unchecked_into()); }
    own(&read(&catalog, "normalizeLang")?, ui, name)
}

/// `ReadingVoice.voiceFor(text)`: the choice of a voice before every fragment the audiobook speaks or prepares. The
/// catalogue's doors are called here, not through the page.
pub(crate) fn voice_for(host: JsValue, text: JsValue, list: &Function, base: &Function, device: &Function, kit: &JsValue) -> R {
    let catalog = read(kit, "catalog")?;
    let given = |name: &str| { let value = get(&catalog, name); if value.is_undefined() { None } else { Some(value.unchecked_into::<Function>()) } };
    let (is_neural, declared, resolver) = (given("isNeuralId"), given("declaredLanguage"), given("resolveVoice"));
    crate::voice_selection::choose(host, text, list,
        &|id| match &is_neural { Some(door) => door.call1(&JsValue::UNDEFINED, id), None => Ok(crate::voice_catalog::is_neural_id(id).into()) },
        &|reader| match &declared { Some(door) => door.call1(&JsValue::UNDEFINED, reader), None => Ok(declared_language(reader)) },
        base,
        &|voices, options| match &resolver {
            Some(door) => door.call2(&JsValue::UNDEFINED, voices, options),
            None => resolve(&read(&catalog, "normalizeLang")?, voices, options),
        },
        device)
}
/// `ReadingVoice.detectLanguage(text)`: `catalog.detectLanguage(text, reader.language || navigator.language || 'en-US')`.
pub(crate) fn detect(host: &JsValue, text: JsValue, kit: &JsValue) -> R {
    let mut fallback = read(&read(host, "reader")?, "language")?;
    if !fallback.is_truthy() { fallback = read(&read(&global(), "navigator")?, "language")?; }
    if !fallback.is_truthy() { fallback = "en-US".into(); }
    let catalog = read(kit, "catalog")?;
    if !get(&catalog, "detectLanguage").is_undefined() { return method(&catalog, "detectLanguage", &[&text, &fallback]); }
    detect_language(&read(&catalog, "normalizeLang")?, text, fallback)
}
/// The catalogue the language and voice menus are built with (voice_menus.rs): the kit's, with this module's two names.
pub(crate) fn menus(kit: &JsValue, ui: &JsValue) -> R {
    let catalog = read(kit, "catalog")?;
    let made: JsValue = Object::assign(&Object::new(), catalog.unchecked_ref()).into();
    for name in ["baseLanguageName", "regionName"] { named(&made, ui, name)?; }
    Ok(made)
}
#[inline(never)]
fn named(made: &JsValue, ui: &JsValue, name: &str) -> R<()> {
    if get(made, name).is_undefined() { set(made, name, &own(&read(made, "normalizeLang")?, ui, name)?.into())?; }
    Ok(())
}
