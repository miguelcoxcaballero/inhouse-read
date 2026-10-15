// The live shelf's pointer controllers. Everything here runs from the first frame on, so
// the module is fetched and compiled with the page head and awaited before the shelf is drawn.
mod shelf_zoom;
mod shelf_view_gesture;
mod native_resize;
mod native_presentation;
mod shelf_trash;
mod bookshelf_return;
mod animation_fence;
mod placement_preview;
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
mod plant_parts;
mod plant_model;
mod baggebo_model;
mod spine_surface;
mod cover_editor;
mod book_reflection;
mod cover_relief;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub fn shelf_abi_version() -> u32 { 1 }

/// Diagnostic counter for ownership regressions at the browser/WASM boundary.
#[wasm_bindgen]
pub fn shelf_live_handles() -> u32 { wasm_bindgen::externref_heap_live_count() }

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
