//! Independent numeric kernels. Host owns all bounded allocations.
mod abi;
#[cfg(feature = "voice")]
mod hebrew;
#[cfg(feature = "voice")]
mod duration_marks;
#[cfg(feature = "app")]
mod reader_preferences;
#[cfg(feature = "app")]
mod book_format;
#[cfg(feature = "app")]
mod speech_tempo;
#[cfg(feature = "app")]
mod font;
#[cfg(feature = "app")]
mod bookmark;
#[cfg(feature = "app")]
mod binding;
#[cfg(feature = "app")]
mod page_mesh;
#[cfg(feature = "decor")]
mod plant_leaf;
#[cfg(feature = "app")]
mod cover_color;
#[cfg(feature = "app")]
mod color_mask;
#[cfg(feature = "app")]
mod relief_palette;
#[cfg(feature = "app")]
mod shelf_placement;
#[cfg(feature = "app")]
mod spine_seed;
#[cfg(feature = "app")]
mod shelf_model;
#[cfg(feature = "app")]
mod speech_normalize;
#[cfg(feature = "app")]
mod speech_fragments;
#[cfg(feature = "decor")]
mod plant_preview;
#[cfg(feature = "decor")]
mod plant_glaze;
#[cfg(feature = "decor")]
mod plant_pottery;
#[cfg(feature = "decor")]
mod plant_soil;
#[cfg(feature = "decor")]
mod plant_foliage;
#[cfg(feature = "decor")]
mod plant_cactus;
#[cfg(feature = "decor")]
mod plant_pot;
#[cfg(feature = "decor")]
mod plant_ivy;
#[cfg(feature = "decor")]
mod plant_subdivide;
#[cfg(feature = "decor")]
mod plant_monstera;
#[cfg(feature = "app")]
mod pdf_layout;
#[cfg(feature = "app")]
mod pdf_rows;
#[cfg(feature = "app")]
mod pdf_order;
#[cfg(feature = "app")]
mod pcm;
#[cfg(feature = "app")]
mod book_surface;
#[cfg(feature = "app")]
mod relief;
#[cfg(feature = "app")]
mod book_motion;
#[cfg(feature = "app")]
mod pdf_images;
#[cfg(feature = "app")]
mod pdf_figures;
#[cfg(feature = "app")]
mod pdf_stream;
#[cfg(feature = "app")]
mod timber;
#[cfg(feature = "decor")]
mod lamp_surface;
#[cfg(feature = "app")]
mod mesh_compact;
#[cfg(feature = "app")]
mod metal_sheet;
#[cfg(feature = "app")]
mod mesh_finish;
#[cfg(feature = "app")]
mod book_cloth;

#[cfg(feature = "app")]
mod font_glyph;

#[cfg(feature = "app")]
mod font_prepare;

#[cfg(feature = "app")]
mod shelf_occlusion;

#[cfg(feature="app")]
mod studio_scan;
#[cfg(feature="app")]
mod cover_seed;
#[cfg(feature="app")]
mod jsnum;
#[cfg(feature="app")]
mod catalogue;
#[cfg(feature="app")]
mod lamp_kelvin;
