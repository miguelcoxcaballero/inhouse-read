//! The cover relief's pixel passes as jobs of the shelf module. The kernels are the numeric core's own
//! sources (rust-core/src/{relief,relief_palette,color_mask,cover_seed,cover_relief}.rs, compiled into this
//! module by `#[path]`), so a pass is ordinary Rust calls over planes this job owns: the host copies its
//! planes in once, calls `step` until it answers 0 (1 gives the main thread back, at the same points as the
//! original generators) and reads `result`. The host frees the job in a `finally`; a job the host lost is
//! released with its handle.
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Once;
use js_sys::{Array, Float32Array, Object, Reflect, Uint8Array, Uint8ClampedArray};
use wasm_bindgen::prelude::*;
use wasm_bindgen::JsCast;
use crate::host::{get, num, truthy};
use crate::relief::{relief_compose_pixels, relief_material_pixels, relief_normal_rows, relief_normal_selected_rows,
    relief_preview_rows, relief_render_buffer, relief_render_free, relief_render_new, relief_render_step, relief_rgba_planes, ReliefRender};
use crate::relief_jobs::{relief_analysis_colour, relief_analysis_mask, relief_analysis_new, relief_analysis_value, relief_job_free,
    relief_job_step, relief_linear_set, relief_maps_new, relief_maps_plane, Job};

const LIMIT: f64 = 1_048_576.0;
const JOB_LIMIT: f64 = 262_144.0;
static LIVE: AtomicU32 = AtomicU32::new(0);
static TABLE: Once = Once::new();

#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_namespace = Math, js_name = hypot)]
    fn host_hypot3(x: f64, y: f64, z: f64) -> f64;
}

fn refused() -> JsValue { js_sys::TypeError::new("El núcleo de relieve no admite estos datos").into() }
fn failed() -> JsValue { js_sys::Error::new("El núcleo de relieve rechazó los datos").into() }

/// `Number.isInteger`.
fn integer(value: &JsValue) -> Option<f64> { value.as_f64().filter(|n| n.is_finite() && n.fract() == 0.0) }
/// `Number.isFinite` (no coercion).
fn finite(value: &JsValue) -> Option<f64> { value.as_f64().filter(|n| n.is_finite()) }
/// Width and height of a plane set within `limit` pixels.
fn shape(value: &JsValue, limit: f64) -> Option<(usize, usize)> {
    let (width, height) = (integer(&get(value, "width"))?, integer(&get(value, "height"))?);
    if width > 0.0 && height > 0.0 && width * height <= limit { Some((width as usize, height as usize)) } else { None }
}
/// A view of this module's own memory could be detached by the allocation that copies it.
fn foreign(buffer: JsValue) -> bool {
    let memory = wasm_bindgen::memory();
    Reflect::get(&memory, &"buffer".into()).map_or(true, |own| !Object::is(&own, &buffer))
}
/// The bytes of a `Uint8Array` or `Uint8ClampedArray` of exactly `length` elements.
fn bytes(value: &JsValue, length: usize) -> Option<Vec<u8>> {
    if let Some(array) = value.dyn_ref::<Uint8Array>() {
        if array.length() as usize == length && foreign(array.buffer().into()) { return Some(array.to_vec()); }
    } else if let Some(array) = value.dyn_ref::<Uint8ClampedArray>() {
        if array.length() as usize == length && foreign(array.buffer().into()) { return Some(array.to_vec()); }
    }
    None
}
fn floats(value: &JsValue, length: usize) -> Option<Vec<f32>> {
    let array = value.dyn_ref::<Float32Array>()?;
    if array.length() as usize == length && foreign(array.buffer().into()) { Some(array.to_vec()) } else { None }
}
fn clamped(data: &[u8]) -> JsValue { Uint8ClampedArray::from(data).into() }
fn plain(data: &[u8]) -> JsValue { Uint8Array::from(data).into() }
fn put(target: &Object, key: &str, value: &JsValue) { let _ = Reflect::set(target, &JsValue::from_str(key), value); }
/// `{ ...maps, layers, mask, gloss, heightMap, foil:new Uint8Array(count) }` from the composed planes.
fn composed(maps: &JsValue, layers: &JsValue, planes: &[u8], count: usize) -> JsValue {
    let out = Object::assign(&Object::new(), maps.unchecked_ref());
    put(&out, "layers", layers);
    put(&out, "mask", &plain(&planes[..count]));
    put(&out, "gloss", &plain(&planes[count..count * 2]));
    put(&out, "heightMap", &plain(&planes[count * 2..count * 3]));
    put(&out, "foil", &Uint8Array::new_with_length(count as u32).into());
    out.into()
}
/// The sRGB curve is the host's own `**`: the palette takes its 256 values before the first job.
fn tabled() -> bool {
    TABLE.call_once(|| { let table = crate::cover_relief::relief_linear_table(); unsafe { relief_linear_set(table.as_ptr()); } });
    true
}
/// The RGBA raster of a palette or map job.
fn raster(image: &JsValue) -> Option<(usize, usize, Vec<u8>)> {
    let (width, height) = shape(image, JOB_LIMIT)?;
    let data = bytes(&get(image, "data"), width * height * 4)?;
    if tabled() { Some((width, height, data)) } else { None }
}

struct Normals { height: Vec<u8>, owners: Vec<u8>, mask: Vec<u8>, foil: Vec<u8>, gloss: Vec<u8>, out: Vec<u8>,
    width: u32, rows: u32, from: u32, has_owners: u32, preserve: u32, unit: f64, selected: bool, has_mask: u32 }
struct Material { foil: Vec<u8>, gloss: Vec<u8>, owners: Vec<u8>, profiles: Vec<f64>, out: Vec<u8>, count: u32, from: u32,
    preserve: u32, numbers: [f64; 4] }
struct Compose { owners: Vec<u8>, mask: Vec<u8>, height: Vec<f32>, strengths: Vec<f64>, out: Vec<u8>, count: u32, from: u32,
    maps: JsValue, layers: JsValue }
struct Preview { image: Vec<u8>, height: Vec<u8>, foil: Vec<u8>, gloss: Vec<u8>, mask: Vec<u8>, coefficients: [f64; 7], out: Vec<u8>,
    width: u32, rows: u32, map_width: u32, map_height: u32, from: u32, preserve: u32 }
struct Render { job: *mut ReliefRender, count: usize, compose: bool, maps: JsValue, layers: JsValue, output: Object, pixels: JsValue }

enum Work {
    Analysis(*mut Job, usize),
    Maps(*mut Job, usize, bool),
    Render(Render),
    Normals(Normals),
    Material(Material),
    Compose(Compose),
    Preview(Preview),
    Done,
}

#[wasm_bindgen]
pub struct ReliefJob { work: Work, result: JsValue }

impl Drop for ReliefJob {
    fn drop(&mut self) {
        LIVE.fetch_sub(1, Ordering::Relaxed);
        unsafe {
            match self.work {
                Work::Analysis(job, _) | Work::Maps(job, _, _) => relief_job_free(job),
                Work::Render(ref render) => relief_render_free(render.job),
                _ => {}
            }
        }
    }
}

fn job(work: Work) -> ReliefJob { LIVE.fetch_add(1, Ordering::Relaxed); ReliefJob { work, result: JsValue::UNDEFINED } }

/// Jobs made and not yet freed (lifetime tests).
#[wasm_bindgen]
pub fn relief_jobs_live() -> u32 { LIVE.load(Ordering::Relaxed) }

/// `{ height, foil, gloss }`: the three material planes of `maps` as opaque grey RGBA, in one pass.
#[wasm_bindgen]
pub fn relief_planes_rgba(maps: &JsValue) -> Result<JsValue, JsValue> {
    let (width, height) = shape(maps, LIMIT).ok_or_else(refused)?;
    let count = width * height;
    let mut input = Vec::with_capacity(count * 3);
    for key in ["heightMap", "foil", "gloss"] { input.extend_from_slice(&bytes(&get(maps, key), count).ok_or_else(refused)?); }
    let mut output = vec![0u8; count * 12];
    if unsafe { relief_rgba_planes(input.as_ptr(), output.as_mut_ptr(), count as u32) } != 1 { return Err(refused()); }
    let out = Object::new();
    put(&out, "height", &clamped(&output[..count * 4]));
    put(&out, "foil", &clamped(&output[count * 4..count * 8]));
    put(&out, "gloss", &clamped(&output[count * 8..]));
    Ok(out.into())
}

#[wasm_bindgen]
impl ReliefJob {
    /// Colour analysis of a cover raster: the proposals of `relief_analysis_result`.
    pub fn analysis(image: &JsValue) -> Result<ReliefJob, JsValue> {
        crate::cover_relief::relief_validate_raster(image)?;
        let (width, height, data) = raster(image).ok_or_else(refused)?;
        let made = unsafe { relief_analysis_new(data.as_ptr(), width, height) };
        if made.is_null() { return Err(refused()); }
        Ok(job(Work::Analysis(made, width * height)))
    }

    /// Exclusive pigment maps of `layers` (`{ color, tolerance, heightMM }`); `single` gives the byte maps of
    /// one standalone colour, otherwise owners, base mask and base height.
    pub fn maps(image: &JsValue, layers: &JsValue, single: bool) -> Result<ReliefJob, JsValue> {
        let (width, height, data) = raster(image).ok_or_else(refused)?;
        if !Array::is_array(layers) { return Err(refused()); }
        let layers: &Array = layers.unchecked_ref();
        if layers.length() < 1 || layers.length() > 10 { return Err(refused()); }
        let mut fields = Vec::with_capacity(layers.length() as usize * 5);
        for layer in layers.iter() {
            let colour = get(&layer, "color").as_string().ok_or_else(refused)?;
            fields.extend_from_slice(&crate::cover_relief::rgb_of(&colour));
            fields.push(num(&get(&layer, "tolerance")));
            let height_mm = get(&layer, "heightMM");
            fields.push(if height_mm.is_null() || height_mm.is_undefined() { 0.0 } else { num(&height_mm) });
        }
        let made = unsafe { relief_maps_new(data.as_ptr(), width, height, fields.as_ptr(), layers.length() as usize, u32::from(single)) };
        if made.is_null() { return Err(refused()); }
        Ok(job(Work::Maps(made, width * height, single)))
    }

    /// Composition (with `layers`), normals and, with `rgba`, the grey planes of `maps` in one job.
    pub fn render(maps: &JsValue, unit: &JsValue, selection_alpha: &JsValue, rgba: bool, layers: &JsValue) -> Result<ReliefJob, JsValue> {
        let (width, height) = shape(maps, LIMIT).ok_or_else(refused)?;
        let count = width * height;
        let unit = finite(unit).ok_or_else(refused)?;
        let compose = !layers.is_null();
        let (owners_value, mask_value) = (get(maps, "owners"), get(maps, "mask"));
        let (preserve, selected) = (truthy(&get(maps, "preserveInk")), truthy(selection_alpha));
        let owners = if truthy(&owners_value) { Some(bytes(&owners_value, count).ok_or_else(refused)?) } else { None };
        let mut strengths = Vec::new();
        let (mut base_mask, mut base_height, mut height_map) = (Vec::new(), Vec::new(), Vec::new());
        if compose {
            if !Array::is_array(layers) { return Err(refused()); }
            let list: &Array = layers.unchecked_ref();
            if list.length() > 10 || owners.is_none() { return Err(refused()); }
            base_mask = bytes(&get(maps, "baseMask"), count).ok_or_else(refused)?;
            base_height = floats(&get(maps, "baseHeight"), count).ok_or_else(refused)?;
            for layer in list.iter() { strengths.push(finite(&get(&layer, "strength")).ok_or_else(refused)?); }
        } else {
            height_map = bytes(&get(maps, "heightMap"), count).ok_or_else(refused)?;
        }
        let has_mask = compose || (truthy(&mask_value) && (preserve || selected));
        let extra = rgba || (selected && !has_mask);
        // preserveInk without a mask is refused here: there is nothing to copy.
        let mask = if !compose && (has_mask || preserve) { Some(bytes(&mask_value, count).ok_or_else(refused)?) } else { None };
        let planes = if !compose && extra {
            Some((bytes(&get(maps, "foil"), count).ok_or_else(refused)?, bytes(&get(maps, "gloss"), count).ok_or_else(refused)?))
        } else { None };
        let flags = u32::from(owners.is_some()) | u32::from(preserve) << 1 | u32::from(selected) << 2 | u32::from(has_mask) << 3
            | u32::from(compose) << 4 | u32::from(rgba) << 5;
        let made = relief_render_new(width as u32, height as u32, flags, unit, strengths.len() as u32);
        if made.is_null() { return Err(refused()); }
        unsafe {
            let fill = |index: u32, data: &[u8]| std::ptr::copy_nonoverlapping(data.as_ptr(), relief_render_buffer(made, index), data.len());
            if let Some(owners) = &owners { fill(1, owners); }
            if compose {
                fill(5, &base_mask);
                std::ptr::copy_nonoverlapping(base_height.as_ptr(), relief_render_buffer(made, 6).cast::<f32>(), count);
                std::ptr::copy_nonoverlapping(strengths.as_ptr(), relief_render_buffer(made, 7).cast::<f64>(), strengths.len());
            } else {
                fill(0, &height_map);
                if let Some(mask) = &mask { fill(2, mask); }
                if let Some((foil, gloss)) = &planes { fill(3, foil); fill(4, gloss); }
            }
        }
        Ok(job(Work::Render(Render { job: made, count, compose, maps: maps.clone(), layers: layers.clone(), output: Object::new(), pixels: maps.clone() })))
    }

    /// Tangent-space normals (RGBA) of the height map; with `selection_alpha` the selection rides in the alpha.
    pub fn normals(maps: &JsValue, unit: &JsValue, selection_alpha: &JsValue) -> Result<ReliefJob, JsValue> {
        let (width, height) = shape(maps, LIMIT).ok_or_else(refused)?;
        let count = width * height;
        let height_map = bytes(&get(maps, "heightMap"), count).ok_or_else(refused)?;
        let (owners_value, mask_value) = (get(maps, "owners"), get(maps, "mask"));
        let (preserve, selected, masked) = (truthy(&get(maps, "preserveInk")), truthy(selection_alpha), truthy(&mask_value));
        let owners = if truthy(&owners_value) { Some(bytes(&owners_value, count).ok_or_else(refused)?) } else { None };
        let mask = if preserve || (selected && masked) { bytes(&mask_value, count).ok_or_else(refused)? } else { Vec::new() };
        let unit = finite(unit).ok_or_else(refused)?;
        let (mut foil, mut gloss) = (Vec::new(), Vec::new());
        if selected && !masked {
            foil = bytes(&get(maps, "foil"), count).ok_or_else(refused)?;
            gloss = bytes(&get(maps, "gloss"), count).ok_or_else(refused)?;
        }
        Ok(job(Work::Normals(Normals { height: height_map, has_owners: u32::from(owners.is_some()), owners: owners.unwrap_or_default(), mask, foil, gloss,
            out: vec![0; count * 4], width: width as u32, rows: height as u32, from: 0, preserve: u32::from(preserve), unit, selected,
            has_mask: u32::from(masked) })))
    }

    /// The packed material map (clearcoat, roughness ratio, metalness, clearcoat-roughness ratio) of a finish.
    pub fn material(maps: &JsValue, clearcoat: &JsValue, roughness: &JsValue, clearcoat_roughness: &JsValue) -> Result<ReliefJob, JsValue> {
        let options = crate::cover_relief::relief_material_options(&get(maps, "layers"), clearcoat, roughness, clearcoat_roughness)?;
        let (width, height) = shape(maps, LIMIT).ok_or_else(refused)?;
        let count = width * height;
        let foil = bytes(&get(maps, "foil"), count).ok_or_else(refused)?;
        let gloss = bytes(&get(maps, "gloss"), count).ok_or_else(refused)?;
        let listed = get(&options, "profiles");
        let length = if listed.is_undefined() { 0 } else { listed.unchecked_ref::<Array>().length() };
        let owners = if length > 0 { bytes(&get(maps, "owners"), count).ok_or_else(refused)? } else { Vec::new() };
        if length > 10 { return Err(refused()); }
        let mut numbers = [0.0; 4];
        for (slot, key) in numbers.iter_mut().zip(["base", "foilRoughness", "glossRoughness", "glossCoatRoughness"]) {
            *slot = finite(&get(&options, key)).ok_or_else(refused)?;
        }
        let mut profiles = Vec::with_capacity(length as usize * 2);
        if length > 0 {
            for profile in listed.unchecked_ref::<Array>().iter() {
                profiles.push(num(&get(&profile, "roughness")));
                profiles.push(num(&get(&profile, "clearcoatRoughness")));
            }
        }
        if profiles.iter().any(|value| !value.is_finite()) { return Err(refused()); }
        Ok(job(Work::Material(Material { foil, gloss, owners, profiles, out: vec![0; count * 4], count: count as u32, from: 0,
            preserve: u32::from(truthy(&get(maps, "preserveInk"))), numbers })))
    }

    /// The classified ownership of `maps` recomposed with the strengths of `selection`.
    pub fn compose(maps: &JsValue, selection: &JsValue) -> Result<ReliefJob, JsValue> {
        let layers = crate::cover_relief::relief_selected_layers(maps, selection)?;
        let (width, height) = shape(maps, LIMIT).ok_or_else(refused)?;
        let count = width * height;
        let owners = bytes(&get(maps, "owners"), count).ok_or_else(refused)?;
        let mask = bytes(&get(maps, "baseMask"), count).ok_or_else(refused)?;
        let base = floats(&get(maps, "baseHeight"), count).ok_or_else(refused)?;
        if layers.length() > 10 { return Err(refused()); }
        let strengths: Vec<f64> = layers.iter().map(|layer| num(&get(&layer, "strength"))).collect();
        if strengths.iter().any(|value| !value.is_finite()) { return Err(refused()); }
        Ok(job(Work::Compose(Compose { owners, mask, height: base, strengths, out: vec![0; count * 3], count: count as u32, from: 0,
            maps: maps.clone(), layers: layers.into() })))
    }

    /// The shaded preview card (RGBA), lit from the top-left.
    pub fn preview(image: &JsValue, maps: &JsValue, slope: &JsValue) -> Result<ReliefJob, JsValue> {
        let k = crate::cover_relief::relief_shade_scale(slope)?;
        let (width, height) = shape(image, LIMIT).ok_or_else(refused)?;
        let (map_width, map_height) = shape(maps, LIMIT).ok_or_else(refused)?;
        let (count, map_count) = (width * height, map_width * map_height);
        let data = bytes(&get(image, "data"), count * 4).ok_or_else(refused)?;
        let height_map = bytes(&get(maps, "heightMap"), map_count).ok_or_else(refused)?;
        let foil = bytes(&get(maps, "foil"), map_count).ok_or_else(refused)?;
        let gloss = bytes(&get(maps, "gloss"), map_count).ok_or_else(refused)?;
        let preserve = truthy(&get(maps, "preserveInk"));
        let mask = if preserve { bytes(&get(maps, "mask"), map_count).ok_or_else(refused)? } else { Vec::new() };
        if !k.is_finite() || k.abs() > 1e6 { return Err(refused()); }
        let mut light = [-0.52, 0.58, 0.63];
        let length = host_hypot3(light[0], light[1], light[2]);
        for value in &mut light { *value /= length; }
        let mut half = [light[0], light[1], light[2] + 1.0];
        let length = host_hypot3(half[0], half[1], half[2]);
        for value in &mut half { *value /= length; }
        Ok(job(Work::Preview(Preview { image: data, height: height_map, foil, gloss, mask,
            coefficients: [light[0], light[1], light[2], half[0], half[1], half[2], k], out: vec![0; count * 4],
            width: width as u32, rows: height as u32, map_width: map_width as u32, map_height: map_height as u32, from: 0, preserve: u32::from(preserve) })))
    }

    /// 1: give the main thread back and call again; 0: finished, `result` is ready.
    pub fn step(&mut self) -> Result<u32, JsValue> {
        unsafe {
            match &mut self.work {
                Work::Analysis(job, _) | Work::Maps(job, _, _) => loop {
                    match relief_job_step(*job) { 0 => break, 1 => return Ok(1), 2 => {} _ => return Err(failed()) }
                },
                Work::Render(render) => loop {
                    let code = relief_render_step(render.job);
                    match code {
                        0 => break,
                        1 => return Ok(1),
                        2 => {}
                        3..=6 => {
                            let plane = std::slice::from_raw_parts(relief_render_buffer(render.job, 9), render.count * 4);
                            put(&render.output, ["normal", "height", "foil", "gloss"][code as usize - 3], &clamped(plane));
                            if code == 3 && render.compose {
                                let planes = std::slice::from_raw_parts(relief_render_buffer(render.job, 8), render.count * 3);
                                render.pixels = composed(&render.maps, &render.layers, planes, render.count);
                            }
                        }
                        _ => return Err(failed()),
                    }
                },
                Work::Normals(w) => {
                    if w.from < w.rows {
                        let to = (w.from + 16).min(w.rows);
                        let done = if w.selected {
                            relief_normal_selected_rows(w.height.as_ptr(), w.owners.as_ptr(), w.mask.as_ptr(), w.out.as_mut_ptr(), w.width, w.rows,
                                w.from, to, w.has_owners, w.preserve, w.unit, w.has_mask, w.foil.as_ptr(), w.gloss.as_ptr())
                        } else {
                            relief_normal_rows(w.height.as_ptr(), w.owners.as_ptr(), w.mask.as_ptr(), w.out.as_mut_ptr(), w.width, w.rows,
                                w.from, to, w.has_owners, w.preserve, w.unit)
                        };
                        if done != 1 { return Err(failed()); }
                        let full = w.from + 16 <= w.rows;
                        w.from += 16;
                        if full { return Ok(1); }
                    }
                }
                Work::Material(w) => {
                    if w.from < w.count {
                        let to = (w.from + 4096).min(w.count);
                        if relief_material_pixels(w.foil.as_ptr(), w.gloss.as_ptr(), w.owners.as_ptr(), w.profiles.as_ptr(), w.out.as_mut_ptr(), w.count,
                            w.from, to, (w.profiles.len() / 2) as u32, w.preserve, w.numbers[0], w.numbers[1], w.numbers[2], w.numbers[3]) != 1 { return Err(failed()); }
                        let full = w.from + 4096 <= w.count;
                        w.from += 4096;
                        if full { return Ok(1); }
                    }
                }
                Work::Compose(w) => {
                    if w.from < w.count {
                        let to = (w.from + 1024).min(w.count);
                        if relief_compose_pixels(w.owners.as_ptr(), w.mask.as_ptr(), w.height.as_ptr(), w.strengths.as_ptr(), w.out.as_mut_ptr(), w.count,
                            w.from, to, w.strengths.len() as u32) != 1 { return Err(failed()); }
                        let full = w.from + 1024 <= w.count;
                        w.from += 1024;
                        if full { return Ok(1); }
                    }
                }
                Work::Preview(w) => {
                    if w.from < w.rows {
                        let to = (w.from + 8).min(w.rows);
                        if relief_preview_rows(w.image.as_ptr(), w.height.as_ptr(), w.foil.as_ptr(), w.gloss.as_ptr(), w.mask.as_ptr(), w.coefficients.as_ptr(),
                            w.out.as_mut_ptr(), w.width, w.rows, w.map_width, w.map_height, w.from, to, w.preserve) != 1 { return Err(failed()); }
                        let full = w.from + 8 <= w.rows;
                        w.from += 8;
                        if full { return Ok(1); }
                    }
                }
                Work::Done => return Ok(0),
            }
        }
        self.finish()?;
        Ok(0)
    }

    /// What the finished job made; the arrays are the host's own.
    pub fn result(&self) -> JsValue { self.result.clone() }
}

impl ReliefJob {
    fn finish(&mut self) -> Result<(), JsValue> {
        let work = std::mem::replace(&mut self.work, Work::Done);
        self.result = unsafe {
            match &work {
                Work::Analysis(job, count) => {
                    let (seed, opaque, found) = (relief_analysis_value(*job, 0), relief_analysis_value(*job, 1), relief_analysis_value(*job, 2));
                    let whole = |value: f64| value.is_finite() && value.fract() == 0.0;
                    let outcome = if !whole(seed) || seed < 0.0 || !whole(opaque) || !whole(found) || !(0.0..=10.0).contains(&found) { Err(refused()) } else {
                        let colours = Array::new();
                        let mut outcome = Ok(());
                        for index in 0..found as usize {
                            let mut fields = [0.0; 5];
                            if relief_analysis_colour(*job, index, fields.as_mut_ptr()) != 1 { outcome = Err(failed()); break; }
                            let colour = Object::new();
                            put(&colour, "rgb", &Array::of3(&fields[0].into(), &fields[1].into(), &fields[2].into()));
                            put(&colour, "tolerance", &fields[3].into());
                            put(&colour, "pixels", &fields[4].into());
                            put(&colour, "mask", &Float32Array::from(std::slice::from_raw_parts(relief_analysis_mask(*job, index), *count)).into());
                            colours.push(&colour);
                        }
                        outcome.and_then(|()| {
                            let report = Object::new();
                            put(&report, "seed", &seed.into());
                            put(&report, "opaque", &opaque.into());
                            put(&report, "colours", &colours);
                            crate::cover_relief::relief_analysis_result(&report.into())
                        })
                    };
                    relief_job_free(*job);
                    outcome?
                }
                Work::Maps(job, count, single) => {
                    let plane = |which: u32| plain(std::slice::from_raw_parts(relief_maps_plane(*job, which), *count));
                    let out = Object::new();
                    if *single {
                        let mask = plane(1);
                        put(&out, "mask", &mask);
                        put(&out, "gloss", &mask.unchecked_ref::<Uint8Array>().slice(0, *count as u32));
                        put(&out, "heightMap", &plane(3));
                    } else {
                        put(&out, "owners", &plane(0));
                        put(&out, "baseMask", &plane(1));
                        put(&out, "baseHeight", &Float32Array::from(std::slice::from_raw_parts(relief_maps_plane(*job, 2).cast::<f32>(), *count)).into());
                    }
                    relief_job_free(*job);
                    out.into()
                }
                Work::Render(render) => {
                    relief_render_free(render.job);
                    let out = Object::assign(&Object::new(), &render.output);
                    put(&out, "pixels", &render.pixels);
                    out.into()
                }
                Work::Normals(w) => clamped(&w.out),
                Work::Material(w) => clamped(&w.out),
                Work::Preview(w) => clamped(&w.out),
                Work::Compose(w) => composed(&w.maps, &w.layers, &w.out, w.count as usize),
                Work::Done => JsValue::UNDEFINED,
            }
        };
        Ok(())
    }
}
