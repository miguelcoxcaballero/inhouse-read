//! The arithmetic and decisions of a book's view (rust-core/src/book_view.rs, compiled into this module by
//! `#[path]`) over one arena of this module's memory. The host writes a kernel's inputs in its region, calls
//! `book_view_run` and reads the answer from the same region; every kernel has its own region, so a measurement
//! taken in the middle of a plan cannot overwrite the plan's inputs. Nothing is allocated per call.
use std::cell::UnsafeCell;
use wasm_bindgen::prelude::*;
use crate::book_view;

/// Words of the arena; the regions are book-view-wasm.js's.
const WORDS: usize = 304;
struct Arena(UnsafeCell<[f64; WORDS]>);
// SAFETY: the module runs on one thread.
unsafe impl Sync for Arena {}
static ARENA: Arena = Arena(UnsafeCell::new([0.0; WORDS]));
fn at(word: usize) -> *mut f64 { unsafe { ARENA.0.get().cast::<f64>().add(word) } }

/// Where the arena is in this module's memory.
#[wasm_bindgen]
pub fn book_view_arena() -> u32 { at(0) as u32 }

/// Run the kernel whose region starts at `word`: 0 the view's sizes, 16 the return frame, 50 the copy rectangle,
/// 70 the pose, 94 the image fit, 102 the corner bounds, 213 the page bounds, 271 the page zoom, 290 the reading
/// pose. Answers the kernel's code (1 for those that have none, 0 for no kernel).
#[wasm_bindgen]
pub fn book_view_run(word: u32) -> u32 {
    unsafe {
        match word {
            0 => book_view::book_view_plan(at(0)),
            16 => return book_view::book_return_frame(at(16)),
            50 => return book_view::book_copy_rectangle(at(50)),
            70 => book_view::book_pose(at(70)),
            94 => book_view::book_fit_image(at(94)),
            102 => book_view::book_corner_bounds(at(102)),
            213 => book_view::book_page_bounds(at(213)),
            271 => return book_view::book_page_zoom(at(271)),
            290 => book_view::book_reading_pose(at(290)),
            _ => return 0,
        }
    }
    1
}

/// An image of `image_width` x `image_height` centred whole in `width` x `height`: x, y, width, height.
pub fn fit(image_width: f64, image_height: f64, width: f64, height: f64) -> [f64; 4] {
    let mut io = [image_width, image_height, width, height, 0.0, 0.0, 0.0, 0.0];
    unsafe { book_view::book_fit_image(io.as_mut_ptr()); }
    [io[4], io[5], io[6], io[7]]
}

/// The pose of a book opened flat with its whole spread in view (`planReadingBookPose`), for the shelf's opening
/// and return: x, y and scale from the core, then the open, unturned pose around them.
pub fn reading_pose(width: f64, height: f64, thickness: f64, viewport_width: f64, viewport_height: f64, center_x: f64,
    center_y: f64) -> JsValue {
    let mut io = [width, height, thickness, viewport_width, viewport_height, center_x, center_y, 0.0, 0.0, 0.0];
    unsafe { book_view::book_reading_pose(io.as_mut_ptr()); }
    let pose = js_sys::Object::new();
    for (key, value) in [("x", io[7]), ("y", io[8]), ("scale", io[9]), ("angle", 0.0), ("pitch", 0.0), ("roll", 0.0),
        ("coverOpen", 1.0), ("bookmarkWithdraw", 0.0)] {
        let _ = js_sys::Reflect::set(&pose, &JsValue::from_str(key), &JsValue::from_f64(value));
    }
    pose.into()
}

/// A view's sizes (`planBookView`): from shelf flag, device pixel ratio, window width, viewport width and
/// height, book width, height and thickness, the pixel ratio, the canvas width and height, the open spread's
/// window width, the closed book's, and their height.
pub fn sizes(input: [f64; 8]) -> [f64; 6] {
    let mut io = [0.0; 14];
    io[..8].copy_from_slice(&input);
    unsafe { book_view::book_view_plan(io.as_mut_ptr()); }
    [io[8], io[9], io[10], io[11], io[12], io[13]]
}

/// Screen bounds of a plane (`planPageBounds`): `io` holds width, height, viewport width and height, offset left
/// and top, then the world, inverse camera and projection matrices; answers left, top, width, height.
pub fn page_bounds(io: &mut [f64; 58]) -> [f64; 4] {
    unsafe { book_view::book_page_bounds(io.as_mut_ptr()); }
    [io[54], io[55], io[56], io[57]]
}

/// The pose that lays the page over a target (`planPageZoom`): page bounds, target, offset left and top, centre x
/// and y, origin x, y and scale; x, y and scale, or nothing when either rectangle has no area.
pub fn page_zoom(input: [f64; 15]) -> Option<[f64; 3]> {
    let mut io = [0.0; 19];
    io[..15].copy_from_slice(&input);
    if unsafe { book_view::book_page_zoom(io.as_mut_ptr()) } != 1 { return None; }
    Some([io[16], io[17], io[18]])
}
