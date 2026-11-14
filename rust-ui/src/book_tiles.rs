//! The small rasters every book shares, made once per page: the cloth's and the paper's normal tiles, the
//! swallowtail cut of a ribbon and the two tiles of the weave. The kernels are the numeric core's
//! (rust-core/src/book_surface.rs, compiled into this module), run here in plain Rust calls; the handful of
//! sines the threads need are the engine's own (`Math.sin`), asked for exactly as the kernels' plans list them.
use crate::book_surface::{book_ribbon_notch, book_surface_pixels, book_surface_plan, book_weave_pixels, book_weave_plan};
use js_sys::Math;
use wasm_bindgen::prelude::*;

/// The answers to a plan's requests (operation, a, b): these plans only ask for sines.
fn answered<const N: usize>(requests: &[f64], count: usize) -> [f64; N] {
    let mut answers = [0.0; N];
    for (slot, answer) in answers.iter_mut().enumerate().take(count) {
        if requests[slot * 3] == crate::host_math::SIN { *answer = Math::sin(requests[slot * 3 + 1]); }
    }
    answers
}

/// The 128 x 128 RGBA normals of a tile: plain-weave cloth (kind 0) or the tooth of paper (kind 1).
pub(crate) fn surface(kind: u32) -> Option<Vec<u8>> {
    if kind > 1 { return None; }
    let mut requests = [0.0; 8 * 3];
    // SAFETY: the plan writes at most 8 triples; the kernel reads 8 sines and fills 128 x 128 floats and RGBA bytes.
    let count = unsafe { book_surface_plan(kind, requests.as_mut_ptr()) } as usize;
    let sines: [f64; 8] = answered(&requests, count);
    let (mut field, mut pixels) = (vec![0f32; 128 * 128], vec![0u8; 128 * 128 * 4]);
    (unsafe { book_surface_pixels(kind, sines.as_ptr(), field.as_mut_ptr(), pixels.as_mut_ptr()) } == 1).then_some(pixels)
}

/// The mask of a ribbon's cut, `width` x `height` RGBA (each up to 512).
pub(crate) fn notch(width: usize, height: usize) -> Option<Vec<u8>> {
    if width == 0 || height == 0 || width > 512 || height > 512 { return None; }
    let mut pixels = vec![0u8; width * height * 4];
    // SAFETY: the kernel fills width x height RGBA bytes.
    (unsafe { book_ribbon_notch(width, height, pixels.as_mut_ptr()) } == 1).then_some(pixels)
}

/// Both tiles of the weave, 128 x 128 RGBA each: the colour tile, then the packed height / roughness / metal one.
pub(crate) fn weave() -> Vec<u8> {
    let mut requests = [0.0; 4 * 3];
    // SAFETY: the plan writes 4 triples; the kernel reads 4 sines and fills 64 x 64 floats and two RGBA tiles.
    let count = unsafe { book_weave_plan(requests.as_mut_ptr()) } as usize;
    let sines: [f64; 4] = answered(&requests, count);
    let (mut field, mut pixels) = (vec![0f32; 64 * 64], vec![0u8; 128 * 128 * 8]);
    unsafe { book_weave_pixels(sines.as_ptr(), field.as_mut_ptr(), pixels.as_mut_ptr()); }
    pixels
}

/// The bytes of a tile's normals ("cloth" or "paper"), of a ribbon's cut and of the weave (colour, then
/// channels), as owned arrays: what the textures and the weave's canvases are made from.
#[wasm_bindgen]
pub fn book_tile_normal_bytes(kind: &str) -> Option<Vec<u8>> {
    match kind { "cloth" => surface(0), "paper" => surface(1), _ => None }
}
#[wasm_bindgen]
pub fn book_ribbon_notch_bytes(width: f64, height: f64) -> Option<Vec<u8>> {
    // Whole sizes only, as the mask's caller always asked.
    if width.fract() != 0.0 || height.fract() != 0.0 || !(1.0..=512.0).contains(&width) || !(1.0..=512.0).contains(&height) { return None; }
    notch(width as usize, height as usize)
}
#[wasm_bindgen]
pub fn book_weave_bytes() -> Vec<u8> { weave() }
