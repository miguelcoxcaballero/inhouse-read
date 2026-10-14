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
mod spine_surface;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub fn shelf_abi_version() -> u32 { 1 }

/// Diagnostic counter for ownership regressions at the browser/WASM boundary.
#[wasm_bindgen]
pub fn shelf_live_handles() -> u32 { wasm_bindgen::externref_heap_live_count() }
