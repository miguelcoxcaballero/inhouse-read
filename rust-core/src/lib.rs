//! Numeric application kernels. Browser APIs and persistence remain in the
//! host. No network, files, threads, or imported JavaScript are used here.
//! The host owns each allocation and passes only validated, bounded slices.

mod font;
mod bookmark;
mod binding;
mod page_mesh;
mod plant_leaf;
mod cover_color;
mod color_mask;
mod relief_palette;
mod shelf_placement;
mod shelf_model;
mod speech_normalize;
mod speech_fragments;
mod plant_preview;
mod pdf_layout;
mod pdf_rows;
mod pcm;
mod book_surface;
mod relief;

#[no_mangle]
pub extern "C" fn core_abi_version() -> u32 { 1 }

/// Eight-byte-aligned, zeroed arena shared by numeric kernels. The JS owner
/// must release with the same element count and recreate views after growth.
#[no_mangle]
pub extern "C" fn alloc_f64(length: usize) -> *mut f64 {
    if length == 0 || length > 16_777_216 { return std::ptr::null_mut(); }
    Box::into_raw(vec![0.0; length].into_boxed_slice()) as *mut f64
}

/// # Safety
/// `pointer` must be a live arena returned by alloc_f64 with this exact length.
#[no_mangle]
pub unsafe extern "C" fn free_f64(pointer: *mut f64, length: usize) {
    if !pointer.is_null() && length > 0 {
        drop(Box::from_raw(std::ptr::slice_from_raw_parts_mut(pointer, length)));
    }
}
