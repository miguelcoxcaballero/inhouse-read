//! The cabinet's physical layout request (shelf-model-layout-wasm.js): one call of the numeric core's
//! `shelf_model` (rust-core/src/shelf_model.rs, a separate WebAssembly module with its own memory) per measured
//! layout. This module does what the JavaScript host did around the kernel: it reads the measured entries, writes
//! the core's arena, calls the kernel and builds the modelled rows and entries (each entry a copy of the measured
//! one with its modelled measures, in the same key order). An engine that is missing, refuses memory, fails or
//! rejects the request answers `null`; a bay that is not a whole row throws the TypeError the original arithmetic
//! threw; every arena it obtained is released, and a failure to release it wins, as a `finally` that throws does.
use js_sys::{Array, Float64Array, Function, Object, Reflect};
use wasm_bindgen::{prelude::*, JsCast};

use crate::host::{absent, get, num, read, text, truthy};

type R<T> = Result<T, JsValue>;

const MAX_ENTRIES: u32 = 1 << 17;
const MAX_ROWS: u32 = 1 << 17;
const ROW: usize = 7;
const ENTRY: usize = 8;

#[wasm_bindgen]
extern "C" {
    /// `Number(value)`, with its exception returned (the conversions of a typed array's `set`).
    #[wasm_bindgen(catch, js_name = Number)]
    fn number(value: &JsValue) -> Result<f64, JsValue>;
}

/// The property names of the per-entry work, made once: making a JS string from Rust decodes it every time.
struct Keys {
    kind: JsValue, x: JsValue, shelf: JsValue, height: JsValue, width: JsValue, depth: JsValue, style: JsValue,
    height_ratio: JsValue, mount: JsValue, y: JsValue, rooftop: JsValue, depth_inset: JsValue, left: JsValue,
    right: JsValue, unit: JsValue, padding: JsValue, top: JsValue, ceiling: JsValue, bottom: JsValue,
}

impl Keys {
    fn new() -> Keys {
        let key = JsValue::from_str;
        Keys { kind: key("kind"), x: key("x"), shelf: key("shelf"), height: key("height"), width: key("width"), depth: key("depth"),
            style: key("style"), height_ratio: key("heightRatio"), mount: key("mount"), y: key("y"), rooftop: key("rooftop"),
            depth_inset: key("depthInset"), left: key("left"), right: key("right"), unit: key("unit"), padding: key("padding"),
            top: key("top"), ceiling: key("ceiling"), bottom: key("bottom") }
    }
}

thread_local! {
    static KEYS: Keys = Keys::new();
}

/// `value[key]` for a cached key, throwing like the engine for null or undefined.
fn take(value: &JsValue, key: &JsValue) -> R<JsValue> {
    if absent(value) {
        return Err(js_sys::TypeError::new(&format!("Cannot read properties of {} (reading '{}')", if value.is_null() { "null" } else { "undefined" },
            key.as_string().unwrap_or_default())).into());
    }
    Reflect::get(&crate::host::boxed(value), key)
}

/// `engine.name(...args)`, its exception returned.
fn invoke(engine: &JsValue, name: &str, args: &[JsValue]) -> R<JsValue> {
    let function = read(engine, name)?;
    if !function.is_function() {
        return Err(js_sys::TypeError::new(&format!("core.{name} is not a function")).into());
    }
    function.unchecked_ref::<Function>().apply(engine, &args.iter().collect::<Array>())
}

/// `new Float64Array(buffer, offset, length)`, its exception returned.
fn view(buffer: &JsValue, offset: f64, length: f64) -> R<Float64Array> {
    let class = Reflect::get(&js_sys::global(), &JsValue::from_str("Float64Array"))?;
    Ok(Reflect::construct(class.unchecked_ref(), &Array::of3(buffer, &offset.into(), &length.into()))?.unchecked_into())
}

fn number_value(value: f64) -> JsValue { JsValue::from_f64(value) }

/// The modelled layout (the host's `hydrate`).
fn hydrate(k: &Keys, layout: &JsValue, shelf_type: &JsValue, rows: f64, data: &[f64]) -> R<JsValue> {
    let modelled = Array::new();
    let mut index = 0usize;
    while (index as f64) < rows {
        let p = 4 + index * ROW;
        let row: JsValue = Object::new().into();
        for (key, value) in [(&k.left, data[p]), (&k.right, data[p + 1]), (&k.unit, data[p + 2]), (&k.padding, data[p + 3]), (&k.top, data[p + 4]),
            (&k.ceiling, data[p + 5]), (&k.bottom, data[p + 6])] {
            Reflect::set(&row, key, &number_value(value))?;
        }
        modelled.push(&row);
        index += 1;
    }
    let measured: Array = read(layout, "entries")?.unchecked_into();
    let entries = Array::new();
    let first = 4 + rows as usize * ROW;
    for (index, entry) in measured.iter().enumerate() {
        let p = first + index * ROW;
        let copy: JsValue = Object::assign(&Object::new(), entry.unchecked_ref()).into();
        Reflect::set(&copy, &k.x, &number_value(data[p]))?;
        Reflect::set(&copy, &k.height, &number_value(data[p + 1]))?;
        Reflect::set(&copy, &k.width, &number_value(data[p + 2]))?;
        let kind = take(&entry, &k.kind)?;
        let lamp = text(&kind, "lamp");
        if lamp || text(&kind, "plant") && truthy(&take(&entry, &k.depth)?) {
            Reflect::set(&copy, &k.depth, &number_value(data[p + 3]))?;
        }
        Reflect::set(&copy, &k.y, &number_value(data[p + 4]))?;
        if !lamp {
            let raised = data[p + 5];
            Reflect::set(&copy, &k.rooftop, &JsValue::from_bool(raised != 0.0 && !raised.is_nan()))?;
        }
        Reflect::set(&copy, &k.depth_inset, &number_value(data[p + 6]))?;
        entries.push(&copy);
    }
    let result: JsValue = Object::assign(&Object::new(), layout.unchecked_ref()).into();
    crate::host::set(&result, "entries", &entries)?;
    crate::host::set(&result, "rows", &modelled)?;
    crate::host::set(&result, "shelfType", shelf_type)?;
    crate::host::set(&result, "unitWidth", &read(layout, "width")?)?;
    crate::host::set(&result, "unitCount", &number_value(data[3]))?;
    crate::host::set(&result, "width", &number_value(data[0]))?;
    crate::host::set(&result, "height", &number_value(data[1]))?;
    crate::host::set(&result, "depth", &number_value(data[2]))?;
    Ok(result)
}

fn request(k: &Keys, core: &JsValue, layout: &JsValue, spec: &JsValue, shelf_type: &JsValue, book_height: &JsValue) -> R<JsValue> {
    if !get(core, "shelf_model").is_function() || !truthy(layout) {
        return Ok(JsValue::NULL);
    }
    let rows = read(layout, "rows")?;
    let entries = read(layout, "entries")?;
    if !Array::is_array(&rows) || !Array::is_array(&entries) {
        return Ok(JsValue::NULL);
    }
    let (rows, entries): (Array, Array) = (rows.unchecked_into(), entries.unchecked_into());
    if rows.length() > MAX_ROWS || entries.length() > MAX_ENTRIES || read(layout, "width")?.as_f64().is_none() {
        return Ok(JsValue::NULL);
    }
    let count = entries.length() as usize;
    let bottoms = read(spec, "shelfBottoms")?;
    let slots = num(&read(&bottoms, "length")?);
    let row_count = crate::host::jmax(1.0, (f64::from(rows.length()) / slots).ceil()) * slots;
    let mut config: Vec<JsValue> = ["width", "height", "depth", "postSize", "shelfRimHeight", "ceilingOffset", "usableDepth"]
        .iter().map(|key| read(spec, key)).collect::<R<_>>()?;
    config.push(book_height.clone());
    config.push(number_value(slots));
    config.extend(Array::from(&bottoms).iter());
    // Each entry as 8 numbers; Float64Array stores apply ToNumber, which is what the original's arithmetic did.
    let mut input = vec![0.0; count * ENTRY];
    for index in 0..count {
        let entry = entries.get(index as u32);
        let kind = take(&entry, &k.kind)?;
        let kind = if text(&kind, "lamp") { 2.0 } else if text(&kind, "plant") { 1.0 } else { 0.0 };
        // A string offset would concatenate in the original; the shelf's own measurement never produces one.
        let x = take(&entry, &k.x)?;
        let Some(x) = x.as_f64() else { return Ok(JsValue::NULL) };
        let p = index * ENTRY;
        let shelf = take(&entry, &k.shelf)?;
        input[p] = if absent(&shelf) { 0.0 } else { num(&shelf) };
        input[p + 1] = x;
        input[p + 2] = num(&take(&entry, &k.height)?);
        input[p + 3] = num(&take(&entry, &k.width)?);
        input[p + 4] = num(&take(&entry, &k.depth)?);
        input[p + 5] = if kind != 0.0 { 1.0 } else { num(&take(&take(&entry, &k.style)?, &k.height_ratio)?) };
        input[p + 6] = kind;
        input[p + 7] = if text(&take(&entry, &k.mount)?, "undershelf") { 1.0 } else { 0.0 };
    }
    let output_at = (config.len() + input.len()) as f64;
    let output_length = 4.0 + row_count * ROW as f64 + (count * ROW) as f64;
    let length = output_at + output_length;
    let pointer = match invoke(core, "alloc_f64", &[number_value(length)]) {
        Ok(pointer) if truthy(&pointer) => num(&pointer),
        _ => return Ok(JsValue::NULL),
    };
    let measured = (|| -> R<Option<Vec<f64>>> {
        let arena = view(&read(&read(core, "memory")?, "buffer")?, pointer, length)?;
        let mut words = Vec::with_capacity(config.len() + input.len());
        for value in &config {
            words.push(number(value)?);
        }
        words.extend_from_slice(&input);
        arena.subarray(0, words.len() as u32).copy_from(&words);
        let status = invoke(core, "shelf_model", &[read(layout, "width")?, number_value(f64::from(rows.length())), number_value(count as f64),
            number_value(pointer), number_value(pointer + (config.len() * 8) as f64), number_value(pointer + output_at * 8.0), number_value(output_length)])?;
        // The original read `.bottom` of an undefined row for a bay that is not a whole row number.
        if status.as_f64() == Some(2.0) {
            return Err(js_sys::TypeError::new("Cannot read properties of undefined (reading 'bottom')").into());
        }
        if status.as_f64() != Some(1.0) {
            return Ok(None);
        }
        Ok(Some(view(&read(&read(core, "memory")?, "buffer")?, pointer + output_at * 8.0, output_length)?.to_vec()))
    })();
    let result = match measured {
        Ok(Some(data)) => hydrate(k, layout, shelf_type, row_count, &data),
        Ok(None) => Ok(JsValue::NULL),
        Err(error) if error.is_instance_of::<js_sys::TypeError>() => Err(error),
        Err(_) => Ok(JsValue::NULL),
    };
    invoke(core, "free_f64", &[number_value(pointer), number_value(length)])?;
    result
}

/// `rustShelfModelLayout(core, layout, spec, shelfType, bookHeight)`: the measured layout at the cabinet's real
/// proportions, overflow in further units, or `null` when the core cannot answer.
#[wasm_bindgen]
pub fn shelf_model_request(core: &JsValue, layout: &JsValue, spec: &JsValue, shelf_type: &JsValue, book_height: &JsValue) -> R<JsValue> {
    KEYS.with(|k| request(k, core, layout, spec, shelf_type, book_height))
}

thread_local! {
    /// cos/sin of the light and foot-ring directions, from the host's Math, read once.
    static ANGLES: Vec<f64> = crate::occlusion_table::occlusion_angles();
}

/// `Number.isFinite(value)`.
fn finite(value: &JsValue) -> bool { value.as_f64().is_some_and(f64::is_finite) }

/// The contact shadows of a cabinet (shelf-occlusion-wasm.js): positions and linear RGBA drawn by the numeric
/// core's `shelf_occlusion` from the raw cabinet measures, shelf rows, feet and floor light, as
/// `[positions, colours]`, each a Float32Array with its own buffer. The host makes the geometry.
#[wasm_bindgen]
#[allow(clippy::too_many_arguments)]
pub fn shelf_occlusion_request(core: &JsValue, width: &JsValue, height: &JsValue, depth: &JsValue, floor_y: &JsValue, bottoms: &JsValue,
    footprints: &JsValue, floor_light: &JsValue) -> R<Array> {
    // The feet that make a ring: finite numbers and a positive radius (`[f.x, f.z, f.radius].every(Number.isFinite)`).
    let mut feet: Vec<[f64; 3]> = Vec::new();
    for foot in Array::from(footprints).iter() {
        if !truthy(&foot) {
            continue;
        }
        let (x, z, radius) = (read(&foot, "x")?, read(&foot, "z")?, read(&foot, "radius")?);
        if finite(&x) && finite(&z) && finite(&radius) && num(&read(&foot, "radius")?) > 0.0 {
            feet.push([num(&x), num(&z), num(&radius)]);
        }
    }
    let light: Option<Vec<f64>> = if Array::is_array(floor_light) {
        let list: &Array = floor_light.unchecked_ref();
        let values: Vec<JsValue> = list.iter().collect();
        (list.length() == 4 && values.iter().all(finite)).then(|| values.iter().map(num).collect())
    } else {
        None
    };
    let rows: Vec<JsValue> = Array::from(bottoms).iter().collect();
    let input_length = 90 + rows.len() + feet.len() * 3;
    let most = rows.len() * 78 + 66 + if light.is_some() { 360 } else { 0 } + feet.len() * 300;
    let length = input_length + (most * 7).div_ceil(2);
    let pointer = invoke(core, "alloc_f64", &[number_value(length as f64)])?;
    if !truthy(&pointer) {
        return Err(js_sys::Error::new("El módulo numérico no pudo reservar memoria.").into());
    }
    let pointer = num(&pointer);
    let drawn = (|| -> R<Array> {
        let mut input = vec![0.0; input_length];
        input[0] = number(width)?;
        input[1] = number(height)?;
        input[2] = number(depth)?;
        input[3] = number(floor_y)?;
        if let Some(light) = &light {
            input[6..10].copy_from_slice(light);
        }
        for (index, value) in rows.iter().enumerate() {
            input[10 + index] = number(value)?;
        }
        for (index, foot) in feet.iter().enumerate() {
            let at = 10 + rows.len() + index * 3;
            input[at..at + 3].copy_from_slice(foot);
        }
        ANGLES.with(|angles| input[input_length - 80..].copy_from_slice(angles));
        view(&read(&read(core, "memory")?, "buffer")?, pointer, input_length as f64)?.copy_from(&input);
        let output = pointer + (input_length * 8) as f64;
        let vertices = invoke(core, "shelf_occlusion", &[number_value(pointer), number_value(rows.len() as f64), number_value(feet.len() as f64),
            number_value(if light.is_some() { 1.0 } else { 0.0 }), number_value(output)])?;
        if !truthy(&vertices) {
            return Err(js_sys::Error::new("El módulo numérico no pudo calcular las sombras.").into());
        }
        let vertices = num(&vertices) as u32;
        let class = Reflect::get(&js_sys::global(), &JsValue::from_str("Float32Array"))?;
        let values: js_sys::Float32Array = Reflect::construct(class.unchecked_ref(),
            &Array::of3(&read(&read(core, "memory")?, "buffer")?, &output.into(), &f64::from(vertices * 7).into()))?.unchecked_into();
        Ok(Array::of2(&values.slice(0, vertices * 3), &values.slice(vertices * 3, vertices * 7)))
    })();
    invoke(core, "free_f64", &[number_value(pointer), number_value(length as f64)])?;
    drawn
}
