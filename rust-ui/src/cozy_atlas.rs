//! The recorded clip atlas of the shelf's sounds (src/assets/sfx: 16-bit PCM plus an index): its
//! groups of takes, which take an event plays (never the same one twice running, slightly
//! detuned), and the Web Audio buffers made from them, or the synthesised fallback of an event the
//! atlas lacks. Fetching the atlas stays with the host (cozy-sounds.js), whose `store` holds the
//! samples, the groups and the caches; `engine` is the shelf module the host reaches (it names the
//! clips of an event and synthesises PCM).
use js_sys::{Array, Float32Array, Int16Array, JsString, Map, Object, Reflect};
use wasm_bindgen::{prelude::*, JsCast};
use crate::host::{absent, call, get, method, num, read, text_value, truthy};

fn key(name: &str) -> JsValue { JsValue::from_str(name) }
fn join(parts: &[&JsValue]) -> JsValue {
    let mut text = JsString::from("");
    for (index, part) in parts.iter().enumerate() {
        if index > 0 { text = text.concat(&key(":")); }
        text = text.concat(&text_value(part));
    }
    text.into()
}
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

fn store_map(store: &JsValue, name: &str) -> Result<Map, JsValue> { Ok(read(store, name)?.unchecked_into()) }

/// The atlas takes of an event, or null for the synthesised sound; the engine lists the groups, most specific first.
fn takes_for(engine: &JsValue, store: &JsValue, kind: &JsValue, material: &JsValue, level: &JsValue) -> Result<JsValue, JsValue> {
    if !truthy(&read(store, "ready")?) { return Ok(JsValue::NULL); }
    let routes = store_map(store, "routes")?;
    let route = join(&[kind, material, level]);
    if routes.has(&route) { return Ok(routes.get(&route)); }
    let groups = store_map(store, "groups")?;
    let mut takes = JsValue::NULL;
    let named = (|| -> Result<JsValue, JsValue> {
        let clip = get(engine, "cozy_clip");
        let names = if absent(&clip) { JsValue::UNDEFINED } else { call(&clip, "cozy_clip", &[kind, material, level])? };
        Ok(text_value(&if truthy(&names) { names } else { key("") }))
    })();
    if let Ok(names) = named {
        for group in names.unchecked_into::<JsString>().split(",").iter() {
            if groups.has(&group) { takes = groups.get(&group); break; }
        }
    }
    routes.set(&route, &takes);
    Ok(takes)
}

fn clip_buffer(store: &JsValue, audio: &JsValue, clip: &JsValue) -> Result<JsValue, JsValue> {
    let buffers = store_map(store, "buffers")?;
    let name = key("clip:").unchecked_into::<JsString>().concat(&text_value(&read(clip, "name")?));
    let cached = buffers.get(&name);
    if truthy(&cached) { return Ok(cached); }
    let (offset, length) = (num(&read(clip, "offset")?), read(clip, "length")?);
    let size = num(&length) as u32;
    let samples: Int16Array = read(store, "samples")?.unchecked_into();
    let pcm: Vec<f32> = samples.subarray(offset as u32, offset as u32 + size).to_vec().into_iter().map(|sample| (f64::from(sample) / 32768.0) as f32).collect();
    let buffer = method(audio, "createBuffer", &[&JsValue::from_f64(1.0), &length, &read(clip, "rate")?])?;
    let channel = Float32Array::new_with_length(size);
    channel.copy_from(&pcm);
    method(&buffer, "copyToChannel", &[channel.as_ref(), &JsValue::from_f64(0.0)])?;
    buffers.set(&name, &buffer);
    Ok(buffer)
}

/// `{buffer, rate}` for an event: a random recorded take of its most specific atlas group (detuned
/// by at most 4 %), or its synthesised PCM, cached per level and variant; null when it has none.
#[wasm_bindgen]
pub fn cozy_atlas_buffer(engine: &JsValue, store: &JsValue, audio: &JsValue, kind: &JsValue, material: &JsValue, level: &JsValue, variant: &JsValue) -> Result<JsValue, JsValue> {
    let mut rate = 1.0;
    let takes = takes_for(engine, store, kind, material, level)?;
    let buffer = if truthy(&takes) {
        let takes: Array = takes.unchecked_into();
        let count = f64::from(takes.length());
        let group = read(&takes.get(0), "name")?;
        let last_take = store_map(store, "lastTake")?;
        let last = last_take.get(&group);
        let mut index = (js_sys::Math::random() * count).floor();
        if count > 1.0 && last == JsValue::from_f64(index) { index = (index + 1.0) % count; }
        last_take.set(&group, &JsValue::from_f64(index));
        let buffer = clip_buffer(store, audio, &takes.get(index as u32))?;
        rate = 1.0 + (js_sys::Math::random() * 2.0 - 1.0) * 0.04;
        buffer
    } else {
        let buffers = store_map(store, "buffers")?;
        let name = join(&[kind, material, level, variant]);
        let cached = buffers.get(&name);
        if truthy(&cached) { cached } else {
            let pcm = method(engine, "cozy_sound", &[kind, material, variant, level])?;
            let length = read(&pcm, "length")?;
            if !truthy(&length) { return Ok(JsValue::NULL); }
            let buffer = method(audio, "createBuffer", &[&JsValue::from_f64(1.0), &length, &method(engine, "cozy_sample_rate", &[])?])?;
            method(&buffer, "copyToChannel", &[&pcm, &JsValue::from_f64(0.0)])?;
            buffers.set(&name, &buffer);
            buffer
        }
    };
    let answer = Object::new();
    Reflect::set(&answer, &key("buffer"), &buffer)?;
    Reflect::set(&answer, &key("rate"), &JsValue::from_f64(rate))?;
    Ok(answer.into())
}
