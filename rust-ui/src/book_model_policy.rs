//! Model quality and resource ownership. Three creates and renders objects; Rust
//! chooses their quality, retains shared sources and releases each owned map once.
use wasm_bindgen::prelude::*;
use js_sys::{Array, Function, Map, Object, Set};
use crate::host::{absent, jmax, jmin, js_round, num, truthy};

// Every name and level sent from here is a literal sent again for each book (several materials and
// plans per model): interned, so the page keeps one string for it instead of decoding it each time.
fn key(name: &'static str) -> &'static str { wasm_bindgen::intern(name) }
fn get(value: &JsValue, name: &'static str) -> JsValue { crate::host::get(value, key(name)) }
fn set(value: &JsValue, name: &'static str, next: &JsValue) -> Result<(), JsValue> { crate::host::set(value, key(name), next) }
fn method(target: &JsValue, name: &'static str, args: &[&JsValue]) -> Result<JsValue, JsValue> { crate::host::method(target, key(name), args) }
fn word(text: &'static str) -> JsValue { JsValue::from_str(key(text)) }

fn object(fields: &[(&'static str, JsValue)]) -> Result<JsValue, JsValue> {
    let value: JsValue = Object::new().into();
    for (key, item) in fields { set(&value, key, item)?; }
    Ok(value)
}
fn lifted_height(height: f64, ratio: &JsValue) -> f64 {
    let ratio = jmin(2.0, ratio.as_f64().unwrap_or(1.0));
    if height * ratio > 1100.0 { 2048.0 } else { 1024.0 }
}

#[wasm_bindgen]
pub fn book_model_plan(height: f64, shelf: bool, overview: bool, inspection: f64, pixel_ratio: JsValue) -> Result<JsValue, JsValue> {
    let inspection = if shelf && !overview {
        if inspection >= 2048.0 { 2048.0 } else if inspection >= 1024.0 { 1024.0 } else { 0.0 }
    } else { 0.0 };
    let level = if overview { "overview" } else if shelf { "shelf" } else { "detail" };
    let texture_height = if inspection != 0.0 { inspection } else if overview { 256.0 }
        else if shelf { 512.0 } else { lifted_height(height, &pixel_ratio) };
    object(&[
        ("inspectionResolution", inspection.into()), ("detailLevel", word(level)),
        ("textureHeight", texture_height.into()),
        ("maxTextureDimension", if overview { 256.0 } else { f64::INFINITY }.into()),
        ("bindingSegments", if overview { 16.0 } else if shelf { 32.0 } else { 96.0 }.into()),
        ("reliefRows", if shelf { 96.0 } else { 384.0 }.into()),
        ("ribbonSegments", if overview { 8.0 } else { 32.0 }.into()),
        ("detail", (!shelf && !overview).into()),
    ])
}

#[wasm_bindgen]
pub fn book_spine_options(height: f64, shelf: bool, overview: bool, inspection: f64, pixel_ratio: JsValue) -> Result<JsValue, JsValue> {
    if overview { return object(&[("textureWidth", 64.0.into()), ("textureHeight", 256.0.into()),
        ("engraving", false.into()), ("level", word("overview"))]); }
    let (width, height, level) = if inspection != 0.0 && !inspection.is_nan() { (512.0, inspection, "detail") }
        else if shelf { (256.0, 1024.0, "shelf") }
        else { let height = lifted_height(height, &pixel_ratio); (height / 2.0, height, "detail") };
    object(&[("textureWidth", width.into()), ("textureHeight", height.into()), ("level", word(level))])
}

#[wasm_bindgen]
pub fn book_cover_raster_size(ratio: JsValue, height: f64, max_dimension: f64) -> Result<JsValue, JsValue> {
    let ratio = num(&ratio);
    let ratio = if ratio == 0.0 || ratio.is_nan() { 0.66 } else { ratio };
    let width = jmax(1.0, js_round(height * ratio));
    let scale = jmin(1.0, max_dimension / jmax(width, height));
    object(&[("width", jmax(1.0, js_round(width * scale)).into()),
        ("height", jmax(1.0, js_round(height * scale)).into())])
}

/// Apply one finish as a transaction in the model owner. Three setters retain
/// their original order, including needsUpdate before the paper adjustments.
#[wasm_bindgen]
pub fn book_apply_material_finish(material: JsValue, finish: JsValue, kind: &str, metallic: bool) -> Result<(), JsValue> {
    if kind == "cap" {
        set(&material, "metalness", &if metallic { 1.0 } else { 0.0 }.into())?;
        if metallic {
            for (key, value) in [("roughness", 0.3), ("envMapIntensity", 1.8),
                ("clearcoat", 0.42), ("clearcoatRoughness", 0.16)] { set(&material, key, &value.into())?; }
            return set(&material, "needsUpdate", &JsValue::TRUE);
        }
    }
    for key in ["roughness", "clearcoat", "clearcoatRoughness", "envMapIntensity"] { set(&material, key, &get(&finish, key))?; }
    set(&material, "needsUpdate", &JsValue::TRUE)?;
    if kind == "paper" {
        set(&material, "roughness", &(0.35 + num(&get(&material, "roughness")) * 0.6).into())?;
        set(&material, "clearcoat", &(num(&get(&material, "clearcoat")) * 0.3).into())?;
        set(&material, "specularIntensity", &0.7.into())?;
    } else if kind == "cover" { set(&material, "specularIntensity", &1.0.into())?; }
    Ok(())
}

thread_local! { static SHARED_SOURCES: Map = Map::new(); }

/// A clone owns its repeat/sampler; its Source remains the cached source. A
/// clone's Texture.copy increments Source.version, so restore it to avoid an
/// identical GPU upload for every book. Do not hold a Rust borrow across build.
#[wasm_bindgen]
pub fn book_shared_texture(key: JsValue, build: &Function) -> Result<JsValue, JsValue> {
    book_shared_texture_with(key, || build.call0(&JsValue::UNDEFINED))
}
/// The same for a texture the shelf module builds itself.
pub(crate) fn book_shared_texture_with(key: JsValue, build: impl FnOnce() -> Result<JsValue, JsValue>) -> Result<JsValue, JsValue> {
    SHARED_SOURCES.with(|cache| {
        if !cache.has(&key) { cache.set(&key, &build()?); }
        let base = cache.get(&key);
        let version = get(&get(&base, "source"), "version");
        let copy = method(&base, "clone", &[])?;
        set(&get(&copy, "source"), "version", &version)?;
        Ok(copy)
    })
}

const TEXTURE_SLOTS: [&str; 9] = ["map", "roughnessMap", "metalnessMap", "bumpMap", "normalMap",
    "alphaMap", "clearcoatMap", "clearcoatRoughnessMap", "clearcoatNormalMap"];

fn dispose(value: &JsValue) -> Result<(), JsValue> {
    if !absent(value) { method(value, "dispose", &[])?; }
    Ok(())
}

/// Preserve graph traversal/disposal order. Shared material and texture slots
/// are deduplicated by JS identity; cached base textures never enter this set.
#[wasm_bindgen]
pub fn book_dispose_resources(group: JsValue, inside: JsValue, surface: JsValue) -> Result<(), JsValue> {
    let materials = Set::new(&JsValue::UNDEFINED);
    materials.add(&inside);
    let textures = Set::new(&JsValue::UNDEFINED);
    textures.add(&get(&surface, "map")); textures.add(&get(&surface, "channels"));
    let captured = materials.clone();
    let visit = Closure::wrap(Box::new(move |node: JsValue| {
        let result = (|| -> Result<(), JsValue> {
            dispose(&get(&node, "geometry"))?;
            let material = get(&node, "material");
            if truthy(&material) {
                // Use concat so caller-provided material arrays retain their
                // native spread/identity semantics, just like Three's API.
                let values = method(&Array::new().into(), "concat", &[&material])?;
                for value in Array::from(&values).iter() { captured.add(&value); }
            }
            Ok(())
        })();
        if let Err(error) = result { wasm_bindgen::throw_val(error); }
    }) as Box<dyn FnMut(JsValue)>);
    method(&group, "traverse", &[visit.as_ref()])?;
    for item in js_sys::try_iter(materials.as_ref())?.unwrap() {
        let material = item?;
        for key in TEXTURE_SLOTS { let texture = get(&material, key); if truthy(&texture) { textures.add(&texture); } }
        method(&material, "dispose", &[])?;
    }
    for item in js_sys::try_iter(textures.as_ref())?.unwrap() { dispose(&item?)?; }
    Ok(())
}

/// Commit both relief maps atomically from the model's perspective. Shared
/// finish slots point at one material map and old maps are released once.
#[wasm_bindgen]
pub fn book_adopt_relief_textures(cover: JsValue, previous: &Set, normal: JsValue, material: JsValue) -> Result<Set, JsValue> {
    let fresh = Set::new(&JsValue::UNDEFINED);
    fresh.add(&normal); fresh.add(&material);
    for item in js_sys::try_iter(previous.as_ref())?.unwrap() {
        let old = item?; if !fresh.has(&old) { method(&old, "dispose", &[])?; }
    }
    for key in ["clearcoatNormalMap", "clearcoatMap"] {
        let old = get(&cover, key);
        if truthy(&old) && !fresh.has(&old) && !previous.has(&old) { method(&old, "dispose", &[])?; }
    }
    set(&cover, "clearcoatNormalMap", &normal)?;
    for key in ["metalnessMap", "roughnessMap", "clearcoatRoughnessMap", "clearcoatMap"] { set(&cover, key, &material)?; }
    Ok(fresh)
}
