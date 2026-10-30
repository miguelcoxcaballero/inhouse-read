//! One crate, two WebAssembly modules (the same way rust-core builds app, decor and voice):
//! `ui` holds the reader and catalogue components, loaded with the reader chunk; `shelf` holds
//! the pointer state machines of the live shelf (view swipe, pinch zoom), small enough to be
//! fetched with the page head and ready before the first shelf frame.
#[cfg(any(feature = "ui", feature = "shelf", feature = "voice"))]
mod host;
#[cfg(feature = "ui")]
include!("ui_lib.rs");
#[cfg(feature = "shelf")]
include!("shelf_lib.rs");

#[cfg(any(feature = "ui", feature = "shelf"))]
mod length_metadata;

#[cfg(any(feature = "ui", feature = "shelf"))]
mod book_data;

#[cfg(any(feature = "ui", feature = "shelf"))]
mod library_store;

#[cfg(any(feature = "ui", feature = "shelf"))]
mod book_title;

#[cfg(feature = "shelf")]
mod app_refresh;

#[cfg(any(feature = "ui", feature = "shelf"))]
mod app_actions;

#[cfg(any(feature = "ui", feature = "shelf"))]
mod app_reader_preparation;

#[cfg(any(feature = "ui", feature = "shelf"))]
mod app_reader_close;

#[cfg(any(feature = "ui", feature = "shelf"))]
mod app_reader_opening;

#[cfg(any(feature = "ui", feature = "shelf"))]
mod app_file_content;

#[cfg(any(feature = "ui", feature = "shelf"))]
mod reader_position;

#[cfg(any(feature = "ui", feature = "shelf"))]
mod app_reader_relocate;

#[cfg(any(feature = "ui", feature = "shelf"))]
mod app_cover_background;

#[cfg(any(feature = "ui", feature = "shelf"))]
mod book_customization;

#[cfg(any(feature = "ui", feature = "shelf"))]
mod room_physics_sync;

#[cfg(feature = "shelf")]
mod book_model_policy;

#[cfg(feature = "shelf")]
mod plant_surface_queue;

#[cfg(feature = "shelf")]
mod cover_raster_cache;

#[cfg(feature = "shelf")]
mod book_presentation;

#[cfg(feature = "shelf")]
mod plant_surface_policy;

#[cfg(feature = "shelf")]
mod plant_records;

#[cfg(feature = "shelf")]
mod gpu_program_policy;

#[cfg(any(feature = "ui", feature = "shelf"))]
mod cover_relief_portable;

#[cfg(feature = "shelf")]
mod shelf_bake_cache;

#[cfg(feature = "shelf")]
mod shelf_furniture_policy;

#[cfg(any(feature = "ui", feature = "shelf"))]
mod record_normalization;

#[cfg(feature = "shelf")]
mod shelf_metadata;

#[cfg(feature = "ui")]
mod live_transport;

#[cfg(any(feature = "ui", feature = "shelf"))]
mod app_room_coordination;

#[cfg(feature = "shelf")]
mod book_image_resources;

#[cfg(feature = "shelf")]
mod plant_layout_policy;

#[cfg(feature = "shelf")]
mod idle_startup_policy;

#[cfg(feature = "shelf")]
mod book_view_motion;
#[cfg(any(feature = "ui", feature = "shelf"))]
mod app_cloud_actions;
#[cfg(any(feature = "ui", feature = "shelf"))]
mod book_share;

#[cfg(any(feature = "ui", feature = "shelf"))]
mod app_drive_poll;

#[cfg(feature = "ui")]
mod reading_preferences_policy;

#[cfg(feature = "ui")]
mod reader_experience_policy;

#[cfg(feature = "ui")]
mod reader_lazy_policy;

#[cfg(any(feature = "ui", feature = "voice"))]
mod voice_dictionary;

#[cfg(feature = "voice")]
include!("voice_lib.rs");
