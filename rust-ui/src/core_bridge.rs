//! What rust-ui reports when a kernel of the numeric core (rust-core, its own module and memory,
//! reached through the exports object the host passes in) had nothing to say: the same messages as
//! readers/core-required.js. The kernels' arena bridges stay in JavaScript where they are per-page
//! paths: driven from here (tests/unit and the readers DOC note), the picture bounds of a page cost
//! 20-100 us instead of 1-8 us, every argument, view and call crossing the boundary.
use wasm_bindgen::prelude::*;
use crate::host::truthy;

/// What `coreRequired` (readers/core-required.js) throws when a kernel had nothing to say.
pub fn required(core: &JsValue, failure: &str) -> JsValue {
    let message = if truthy(core) { failure } else { "El módulo numérico no se pudo cargar. Recarga la página." };
    js_sys::Error::new(message).into()
}
