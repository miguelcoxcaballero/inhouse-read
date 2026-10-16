//! Independent numeric kernels. Host owns all bounded allocations.
mod abi;
#[cfg(feature = "voice")]
mod hebrew;
#[cfg(feature = "voice")]
mod duration_marks;
// The synthesis worker's kernels (cleaning, tempo, boundaries, the per-chunk flow) live in the
// voice core alone: the worker loads those few KB and not the app core.
#[cfg(feature = "voice")]
mod voice_math;
#[cfg(feature = "voice")]
mod pcm;
#[cfg(feature = "voice")]
mod speech_tempo;
#[cfg(feature = "voice")]
mod synth_flow;
#[cfg(feature = "voice")]
mod supertonic_text;
#[cfg(feature = "app")]
mod reader_preferences;
#[cfg(feature = "app")]
mod book_format;
#[cfg(feature = "app")]
mod font;
#[cfg(feature = "app")]
mod host_math;
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
mod jsmath;
#[cfg(feature = "app")]
mod shelf_lighting;
#[cfg(feature = "app")]
mod shelf_occluder;
#[cfg(feature = "app")]
mod shelf_pixel;
#[cfg(feature = "app")]
mod shelf_placement;
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
mod book_surface;
#[cfg(feature = "app")]
mod relief;
#[cfg(feature = "app")]
mod book_motion;
#[cfg(feature = "app")]
mod book_view;
#[cfg(feature = "app")]
mod pdf_images;
#[cfg(feature = "app")]
mod pdf_figures;
#[cfg(feature = "app")]
mod pdf_stream;
#[cfg(feature = "app")]
mod timber;
#[cfg(feature = "app")]
mod cabinet_model;
#[cfg(feature = "decor")]
mod lamp_surface;
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
mod cover_relief;
// Tables and layout of the shelf. The plant, pot and lamp tables belong to the
// decor core (its bytes decide whether saved bakes stay valid); the cabinets,
// the spine palette and the layout kernels belong to the app core.
#[cfg(any(feature="app", feature="decor"))]
mod jsnum;
#[cfg(any(feature="app", feature="decor"))]
mod json;
#[cfg(any(feature="app", feature="decor"))]
mod cabinet;
#[cfg(feature="app")]
mod catalogue;
#[cfg(feature="app")]
mod shelf_layout;
#[cfg(feature="decor")]
mod plant_catalogue;
#[cfg(feature="decor")]
mod lamp_kelvin;
#[cfg(feature="app")]
mod book_colors;
#[cfg(feature="app")]
mod frame_padding;
#[cfg(feature="app")]
mod shell_signature;
#[cfg(feature="app")]
mod file_name;
