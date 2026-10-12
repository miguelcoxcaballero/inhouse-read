//! Diagnostic counter for ownership regressions at the browser/WASM boundary.
use wasm_bindgen::prelude::*;
#[wasm_bindgen]
pub fn ui_live_handles()->u32{wasm_bindgen::externref_heap_live_count()}
