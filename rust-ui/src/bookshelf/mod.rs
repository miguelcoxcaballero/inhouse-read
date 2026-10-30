//! The shelf screen: its flyout editor today, the rest of the screen as it moves here. Everything that
//! decides, sequences or draws is Rust; the host keeps what only the browser can do (three.js, storage,
//! the book model, the scene) and calls these parts through plain objects.
mod util;
mod ctx;
mod style;
mod editor;
mod editor_edit;
mod editor_relief;
mod editor_pick;
mod pieces;
mod flyout;
mod flyout_motion;
mod returning;
mod covers;
mod objects;
mod drag;
mod trash;
mod screen_plan;
mod screen_render;
mod screen_nodes;
mod screen_lifecycle;
mod text_length;
mod text_length_queue;
mod screen_prefs;
mod frame;
mod mount;
pub use ctx::RustShelfCtx;
