mod room_motion;
// The live shelf's pointer controllers. Everything here runs from the first frame on, so
// the module is fetched and compiled with the page head and awaited before the shelf is drawn.
mod shelf_zoom;
mod shelf_view_gesture;
mod native_resize;
mod native_presentation;
mod shelf_trash;
mod shelf_models;
mod shelf_catalog;
mod catalog_studio;
mod studio_environment;
mod shelf_light_rig;
mod bookshelf_return;
mod animation_fence;
mod placement_preview;
mod local_drop;
mod scene_view;
mod scene_frame;
mod scene_entries;
mod book_gravity;
mod cozy_audio;
mod cozy_transport;
mod cozy_synth;
mod decor_contacts;
mod scene_plan;
mod scene_quality;
mod scene_hit_hull;
mod occlusion_table;
#[path="../../rust-core/src/jsmath.rs"]
mod jsmath;
#[path="../../rust-core/src/cabinet.rs"]
mod cabinet;
mod earcut;
mod three_geo;
mod three_shape;
mod metal_sheet;
mod mesh_finish;
mod mesh_compact;
mod geo_packet;
mod geo_probe;
mod three_curve;
mod three_math;
mod lamp_model;
mod lamp_light;
mod lamp_material;
mod catalog_camera;
mod decor_adapters;
mod plant_parts;
mod plant_model;
mod baggebo_model;
mod spine_surface;
mod cover_editor;
mod book_reflection;
mod cover_relief;
mod cloud_host;
mod bookshelf;
mod book_paint;
// Home projections must use the already-ready shelf runtime; UI is deferred until
// a reader/catalog is opened. Share the kernels rather than wake that module.
mod book_projection;
mod foliage;
mod packet_host;
mod plant_build;
mod shelf_model_host;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub fn shelf_abi_version() -> u32 { 1 }

/// Diagnostic counter for ownership regressions at the browser/WASM boundary.
#[wasm_bindgen]
pub fn shelf_live_handles() -> u32 { wasm_bindgen::externref_heap_live_count() }

/// Timer and frame callbacks the module still owns: zero once everything scheduled has run or been cancelled.
#[wasm_bindgen]
pub fn shelf_pending_callbacks() -> u32 { crate::host::pending_callbacks() as u32 }

/// The BAGGEBO's geometry as a packet (see `baggebo_model::template`).
#[wasm_bindgen]
pub fn baggebo_template() -> Vec<u8> { baggebo_model::template() }

/// The geometry of a shelf lamp (0 MITTLED puck, 1 TRIPOD, otherwise the lantern) as a packet, fitted by `scale`
/// (see `lamp_model::lamp`).
#[wasm_bindgen]
pub fn lamp_geometry(kind: u32, segments: u32, scale: f64) -> Vec<u8> { lamp_model::lamp(kind, segments as usize, scale) }

/// The first `count` numbers of the PRNG of a plant seeded by the UTF-16 units of `seed` (`randomFor(seed)`).
#[wasm_bindgen]
pub fn plant_random(seed: &[u16], count: u32) -> Vec<f64> {
    let mut rng = plant_parts::Rng::new(seed);
    (0..count).map(|_| rng.next()).collect()
}

/// A shelf plant as a baked scene packet (see `plant_model::plant`): the PRNG of `seed` has already given `skip` numbers
/// to the host. `dims`: width, pot radius, pot height, soil fraction of the pot, foliage height above the soil, growth
/// height and total height, all in the plant's scene units.
#[wasm_bindgen]
#[allow(clippy::too_many_arguments)]
pub fn plant_model(seed: &[u16], skip: u32, variant: &str, pot_id: &str, pot_model: &str, catalog: bool, detailed: bool, dims: &[f64]) -> Vec<u8> {
    plant_model::plant(&plant_model::Plant { seed, skip: skip as usize, variant: plant_parts::Variant::parse(variant), catalog, detailed, pot_id, pot_model,
        width: dims[0], radius: dims[1], pot_height: dims[2], soil_fraction: dims[3], above: dims[4], growth_height: dims[5], height: dims[6] })
}

/// The 32 x 32 RGBA powder-coat grain texture of the BAGGEBO's paint.
#[wasm_bindgen]
pub fn baggebo_paint_texture() -> Vec<u8> { baggebo_model::paint_texture() }

/// A BAGGEBO fitted to `width` (600 mm when it is not a positive finite number) from its specification:
/// `{ width, scale, physicalDimensions, shelfPositions }`. Uniform scaling preserves the real proportions;
/// every shelf keeps its bottom, its scene y and its height above the floor.
#[wasm_bindgen]
pub fn baggebo_layout(width: &JsValue, spec: &JsValue) -> Result<JsValue, JsValue> {
    use crate::host::{read, set};
    let actual = match width.as_f64() { Some(value) if value.is_finite() && value > 0.0 => value, _ => 600.0 };
    let dimensions = read(spec, "dimensions")?;
    let scale = actual / crate::host::num(&read(&dimensions, "width")?);
    let (height, depth) = (crate::host::num(&read(&dimensions, "height")?), crate::host::num(&read(&dimensions, "depth")?));
    let object = |fields: &[(&str, f64)]| -> Result<JsValue, JsValue> {
        let value: JsValue = js_sys::Object::new().into();
        for (key, number) in fields { set(&value, key, &JsValue::from_f64(*number))?; }
        Ok(value)
    };
    let positions = js_sys::Array::new();
    for bottom in js_sys::Array::from(&read(spec, "shelfBottoms")?).iter() {
        let bottom = crate::host::num(&bottom);
        positions.push(&object(&[("bottom", bottom * scale), ("y", -bottom * scale), ("fromFloor", (height - bottom) * scale)])?);
    }
    let layout: JsValue = js_sys::Object::new().into();
    set(&layout, "width", &actual.into())?;
    set(&layout, "scale", &scale.into())?;
    set(&layout, "physicalDimensions", &object(&[("width", actual), ("depth", depth * scale), ("height", height * scale)])?)?;
    set(&layout, "shelfPositions", &positions.into())?;
    Ok(layout)
}

/// The BAGGEBO's materials by role (the template's material indices), in the order they are made; `"paint"`
/// stands for the powder-coat texture.
#[wasm_bindgen]
pub fn baggebo_materials() -> String {
    concat!("[",
        r##"{"role":"paint","class":"MeshPhysicalMaterial","name":"Warm white epoxy polyester powder-coated steel","options":{"color":16251126,"roughness":0.36,"metalness":0.08,"bumpMap":"paint","bumpScale":0.024,"clearcoat":0.16,"clearcoatRoughness":0.4}},"##,
        r##"{"role":"meshPaint","class":"MeshStandardMaterial","name":"Open expanded white-painted steel","options":{"color":16251126,"roughness":0.38,"metalness":0.08,"bumpMap":"paint","bumpScale":0.018,"side":2}},"##,
        r##"{"role":"hardware","class":"MeshStandardMaterial","name":"Zinc plated recessed fixing heads","options":{"color":13750989,"roughness":0.32,"metalness":0.5,"vertexColors":true}},"##,
        r##"{"role":"foot","class":"MeshStandardMaterial","name":"Polypropylene adjustable feet","options":{"color":15263967,"roughness":0.76,"metalness":0}}"##,
        "]").to_string()
}

/// The room's transform for the lamps' lights: `out[0]` is 1 when lights may follow it, `out[1..17]` its inverse
/// (see `lamp_light::root`). `false` for a buffer of the wrong size.
#[wasm_bindgen]
pub fn lamp_root(transform: &[f64], out: &mut [f64]) -> bool { lamp_light::root(transform, out) }

/// The lights each kind of lamp gets out of `limit` (see `lamp_light::quota`).
#[wasm_bindgen]
pub fn lamp_quota(counts: &[f64], limit: f64, out: &mut [f64]) -> bool { lamp_light::quota(counts, limit, out) }

/// Which lamps are lit and which slot each takes (see `lamp_light::plan`).
#[wasm_bindgen]
pub fn lamp_plan(candidates: &[f64], slots: &[f64], quota: &[f64], middle: f64, out: &mut [f64]) -> bool {
    lamp_light::plan(candidates, slots, quota, middle, out)
}

/// The aim of a point light or (`spot`) a cone (see `lamp_light::light`).
#[wasm_bindgen]
pub fn lamp_light(spot: bool, input: &[f64], out: &mut [f64]) -> bool { lamp_light::light(spot, input, out) }

/// The aim of the strips of a filament fixture (see `lamp_light::filaments`).
#[wasm_bindgen]
pub fn lamp_filaments(input: &[f64], out: &mut [f64]) -> bool { lamp_light::filaments(input, out) }

mod book_surface_policy;
