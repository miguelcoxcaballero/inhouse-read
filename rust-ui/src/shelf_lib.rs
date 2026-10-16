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
mod scene_view;
mod scene_frame;
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

/// The 32 x 32 RGBA powder-coat grain texture of the BAGGEBO's paint.
#[wasm_bindgen]
pub fn baggebo_paint_texture() -> Vec<u8> { baggebo_model::paint_texture() }
