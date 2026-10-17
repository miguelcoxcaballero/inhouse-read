//! One crate, two WebAssembly modules (the same way rust-core builds app, decor and voice):
//! `ui` holds the reader and catalogue components, loaded with the reader chunk; `shelf` holds
//! the pointer state machines of the live shelf (view swipe, pinch zoom), small enough to be
//! fetched with the page head and ready before the first shelf frame.
#[cfg(any(feature = "ui", feature = "shelf"))]
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
mod book_customization;
