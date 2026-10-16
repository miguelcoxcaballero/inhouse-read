//! Arithmetic and decisions of a book's view: the pixel ratio and compact framebuffer
//! sizes, which part of the framebuffer a return needs (with the capacity a motion
//! reserves), which part is copied to the snapshot canvas, where the model stands, the
//! projected bounds of boards and pages, and the pose that zooms a page onto the reader's.
//! The host measures (matrices, bounds, objects); every number it gets back comes from
//! the same IEEE operations, in the same order, as the JavaScript they replace
//! (`Math.round` rounds half up, `Math.min/max` order the zeros and propagate NaN).
//! Each kernel takes one `io` block of f64: inputs first, outputs after them.
use crate::jsmath::Mat4;
use crate::jsnum::{max, min, round};

fn whole(value: f64) -> bool { value.is_finite() && value.fract() == 0.0 }
fn flag(value: f64) -> bool { value != 0.0 }
fn block<'a>(io: *mut f64, length: usize) -> &'a mut [f64] {
    // SAFETY: every export documents the length of its block; the host owns it.
    unsafe { std::slice::from_raw_parts_mut(io, length) }
}

/// Pixel ratio and sizes of a view. In: shelf, device ratio, window width, viewport width and
/// height, book width, height and thickness. Out [8..]: pixel ratio, canvas width and height,
/// width of the open spread's window, of the closed book's, and its height.
/// # Safety
/// `io` points to 14 writable f64.
#[no_mangle]
pub unsafe extern "C" fn book_view_plan(io: *mut f64) {
    let io = block(io, 14);
    let (shelf, requested, inner, vw, vh) = (flag(io[0]), io[1], io[2], io[3], io[4]);
    let (width, height, thickness) = (io[5], io[6], io[7]);
    let ratio = if shelf { min(requested, if inner < 600.0 { 1.5 } else { 2.0 }) } else { min(requested, 2.0) };
    io[8] = ratio;
    io[9] = (vw * ratio).ceil();
    io[10] = (vh * ratio).ceil();
    io[11] = min(vw, (((width * 2.0 + thickness) * 1.25 + 64.0) / 64.0).ceil() * 64.0);
    io[12] = min(vw, (((width + thickness) * 1.25 + 64.0) / 64.0).ceil() * 64.0);
    io[13] = min(vh, ((height * 1.45 + 64.0) / 64.0).ceil() * 64.0);
}

/// Whether the viewport, the frame and the pixel ratio line up on whole physical pixels.
#[no_mangle]
pub extern "C" fn book_frame_aligned(vw: f64, vh: f64, ratio: f64, x: f64, y: f64, width: f64, height: f64) -> u32 {
    [vw * ratio, vh * ratio, x * ratio, y * ratio, width * ratio, height * ratio].iter().all(|&v| whole(v)) as u32
}

/// The window of the framebuffer a return frame needs. In: compact, direct, adaptive, measure
/// only, pose scale, pixel ratio, viewport width and height, cover opening, closed and open
/// compact widths, compact height, bounds known, left, top, right, bottom, then the reserved
/// capacity of the motion (present, width, height) and of the native hold (present, width,
/// height). Out [23..]: 0 = whole viewport, 1 = window, 2 = bounds needed first; x, y, width,
/// height; the capacities after the call (a reservation grows even when the answer is the
/// whole viewport).
/// # Safety
/// `io` points to 34 writable f64.
#[no_mangle]
pub unsafe extern "C" fn book_return_frame(io: *mut f64) -> u32 {
    let io = block(io, 34);
    io.copy_within(17..23, 28);
    let (vw, vh) = (io[6], io[7]);
    let result = |io: &mut [f64], code: f64| { io[23] = code; code as u32 };
    if !flag(io[0]) || (io[4] > 1.05 && !flag(io[1])) || !whole(io[5]) || !whole(vw) || !whole(vh) { return result(io, 0.0); }
    if !flag(io[12]) { return result(io, 2.0); }
    let (mut left, mut top, mut right, mut bottom) = (io[13], io[14], io[15], io[16]);
    if ![left, top, right, bottom].iter().all(|v| v.is_finite()) { return result(io, 0.0); }
    left = max(0.0, left); top = max(0.0, top); right = min(vw, right); bottom = min(vh, bottom);
    let adaptive = flag(io[2]) && flag(io[1]);
    let measure = flag(io[3]);
    let mut frame_width = if adaptive { min(vw, ((right - left + 48.0) / 64.0).ceil() * 64.0) }
        else if io[8] == 0.0 { io[9] } else { io[10] };
    let mut frame_height = if adaptive { min(vh, ((bottom - top + 48.0) / 64.0).ceil() * 64.0) } else { io[11] };
    // Reserve the flight's largest compact window once, rather than resetting the native
    // framebuffer at every 64px boundary. Unexpected bounds can grow the reservation, never
    // clip geometry or reduce resolution.
    if adaptive && flag(io[28]) && !measure {
        frame_width = max(frame_width, io[29]); io[29] = frame_width;
        frame_height = max(frame_height, io[30]); io[30] = frame_height;
    }
    if adaptive && flag(io[31]) {
        frame_width = max(frame_width, io[32]);
        frame_height = max(frame_height, io[33]);
        if !measure { io[32] = frame_width; io[33] = frame_height; }
    }
    if adaptive && frame_width == vw && frame_height == vh { return result(io, 0.0); }
    if right < left || bottom < top || (frame_width < vw && right - left + 48.0 > frame_width)
        || (frame_height < vh && bottom - top + 48.0 > frame_height) { return result(io, 0.0); }
    io[24] = if frame_width == vw { 0.0 } else { round((left + right - frame_width) / 2.0) };
    io[25] = if frame_height == vh { 0.0 } else { round((top + bottom - frame_height) / 2.0) };
    io[26] = frame_width;
    io[27] = frame_height;
    result(io, 1.0)
}

/// The rectangle of the framebuffer copied to the snapshot canvas. In: viewport width and
/// height, pixel ratio, canvas width and height, frame x, y, width and height, bounds known,
/// left, top, right, bottom, pose scale. Out [15..]: 0 = everything, 1 = rectangle, 2 =
/// bounds needed first; x, y, width, height.
/// # Safety
/// `io` points to 20 writable f64.
#[no_mangle]
pub unsafe extern "C" fn book_copy_rectangle(io: *mut f64) -> u32 {
    let io = block(io, 20);
    let result = |io: &mut [f64], code: f64| { io[15] = code; code as u32 };
    let ratio = io[2];
    // Preserve the existing resampling when logical and physical pixels do not line up.
    if book_frame_aligned(io[0], io[1], ratio, io[5], io[6], io[7], io[8]) == 0 { return result(io, 0.0); }
    if !flag(io[9]) { return result(io, 2.0); }
    let (left, top, right, bottom) = (io[10], io[11], io[12], io[13]);
    if ![left, top, right, bottom].iter().all(|v| v.is_finite()) { return result(io, 0.0); }
    // Includes displaced cover relief and antialiased edges, at the same scale as the book.
    let margin = max(8.0, 48.0 * io[14].abs());
    let x = max(max(0.0, io[5] * ratio), ((left - margin) * ratio).floor());
    let y = max(max(0.0, io[6] * ratio), ((top - margin) * ratio).floor());
    let end_x = min(min(io[3], (io[5] + io[7]) * ratio), ((right + margin) * ratio).ceil());
    let end_y = min(min(io[4], (io[6] + io[8]) * ratio), ((bottom + margin) * ratio).ceil());
    io[16] = x; io[17] = y;
    io[18] = max(0.0, end_x - x);
    io[19] = max(0.0, end_y - y);
    result(io, 1.0)
}

/// Where the model stands for a pose. In: opening and withdrawal (already resolved against the
/// previous pose), centre x and y, viewport width and height, pose x, y, pitch, angle, roll
/// (degrees) and scale, then whether the pose names a page theme, that theme and the current one.
/// Out [15..]: clamped opening and withdrawal, model x and y, rotation x, y and z (radians),
/// scale, page theme.
/// # Safety
/// `io` points to 24 writable f64.
#[no_mangle]
pub unsafe extern "C" fn book_pose(io: *mut f64) {
    let io = block(io, 24);
    io[15] = max(0.0, min(1.0, io[0]));
    io[16] = max(0.0, min(1.0, io[1]));
    io[17] = io[2] - io[4] / 2.0 + io[6];
    io[18] = io[5] / 2.0 - io[3] - io[7];
    io[19] = io[8] * std::f64::consts::PI / 180.0;
    io[20] = io[9] * std::f64::consts::PI / 180.0;
    io[21] = io[10] * std::f64::consts::PI / 180.0;
    io[22] = io[11];
    // Number(theme) || 0, held to 0..1; a pose without one keeps the current theme.
    let theme = if io[12] != 0.0 { let t = io[13]; max(0.0, min(1.0, if t.is_nan() || t == 0.0 { 0.0 } else { t })) } else { io[14] };
    io[23] = theme;
}

/// A fitted rectangle: an image of the given size contained in a box, centred. In: image
/// width and height, box width and height. Out [4..]: x, y, width, height.
/// # Safety
/// `io` points to 8 writable f64.
#[no_mangle]
pub unsafe extern "C" fn book_fit_image(io: *mut f64) {
    let io = block(io, 8);
    let scale = min(io[2] / io[0], io[3] / io[1]);
    let (w, h) = (io[0] * scale, io[1] * scale);
    io[4] = (io[2] - w) / 2.0;
    io[5] = (io[3] - h) / 2.0;
    io[6] = w;
    io[7] = h;
}

fn matrix(source: &[f64]) -> Mat4 { let mut e = [0.0; 16]; e.copy_from_slice(&source[..16]); Mat4(e) }

/// Screen bounds of boxes seen by a camera. In: viewport width and height, left and top
/// offset, the camera's inverse world and projection matrices, the number of boxes (at most
/// 3), whether the offset applies, then per box its min and max corner, whether it has a
/// world matrix and that matrix. Out [107..]: left, top, right, bottom of every projected
/// corner (the unions of an empty list stay at +/-infinity, as Math.min() and Math.max() of
/// nothing do).
/// # Safety
/// `io` points to 111 writable f64.
#[no_mangle]
pub unsafe extern "C" fn book_corner_bounds(io: *mut f64) {
    let io = block(io, 111);
    let (vw, vh, off_left, off_top) = (io[0], io[1], io[2], io[3]);
    let (inverse, projection) = (matrix(&io[4..]), matrix(&io[20..]));
    let count = (io[36].max(0.0) as usize).min(3);
    let offset = flag(io[37]);
    let (mut left, mut top, mut right, mut bottom) = (f64::INFINITY, f64::INFINITY, f64::NEG_INFINITY, f64::NEG_INFINITY);
    for n in 0..count {
        let record = &io[38 + n * 23..38 + (n + 1) * 23];
        let world = if flag(record[6]) { Some(matrix(&record[7..])) } else { None };
        for xi in 0..2 { for yi in 0..2 { for zi in 0..2 {
            let mut point = [record[xi * 3], record[yi * 3 + 1], record[zi * 3 + 2]];
            if let Some(world) = &world { point = world.apply(point); }
            let screen = projection.apply(inverse.apply(point));
            let mut x = (screen[0] + 1.0) * vw / 2.0;
            let mut y = (1.0 - screen[1]) * vh / 2.0;
            if offset { x += off_left; y += off_top; }
            left = min(left, x); right = max(right, x); top = min(top, y); bottom = max(bottom, y);
        }}}
    }
    io[107] = left; io[108] = top; io[109] = right; io[110] = bottom;
}

/// Bounds of the fitted page image: four corners of a plane of the given size through its world
/// matrix and the camera. In: plane width and height, viewport width and height, left and top
/// offset, the plane's world matrix, the camera's inverse world and projection matrices.
/// Out [54..]: left, top, width, height.
/// # Safety
/// `io` points to 58 writable f64.
#[no_mangle]
pub unsafe extern "C" fn book_page_bounds(io: *mut f64) {
    let io = block(io, 58);
    let (width, height, vw, vh, off_left, off_top) = (io[0], io[1], io[2], io[3], io[4], io[5]);
    let (world, inverse, projection) = (matrix(&io[6..]), matrix(&io[22..]), matrix(&io[38..]));
    let mut xs = [0.0; 4];
    let mut ys = [0.0; 4];
    for (n, (x, y)) in [(-width / 2.0, -height / 2.0), (width / 2.0, -height / 2.0), (-width / 2.0, height / 2.0), (width / 2.0, height / 2.0)].into_iter().enumerate() {
        let screen = projection.apply(inverse.apply(world.apply([x, y, 0.0])));
        xs[n] = (screen[0] + 1.0) * vw / 2.0 + off_left;
        ys[n] = (1.0 - screen[1]) * vh / 2.0 + off_top;
    }
    let low = |v: &[f64; 4]| min(min(min(v[0], v[1]), v[2]), v[3]);
    let high = |v: &[f64; 4]| max(max(max(v[0], v[1]), v[2]), v[3]);
    let (left, top) = (low(&xs), low(&ys));
    io[54] = left;
    io[55] = top;
    io[56] = high(&xs) - left;
    io[57] = high(&ys) - top;
}

/// The pose that lays the fitted page over a target rectangle in the reader. In: page bounds
/// (left, top, width, height), target (left, top, width, height), offset left and top, centre x
/// and y, origin pose x, y and scale. Out [15..]: 1 when usable, x, y, scale.
/// # Safety
/// `io` points to 19 writable f64.
#[no_mangle]
pub unsafe extern "C" fn book_page_zoom(io: *mut f64) -> u32 {
    let io = block(io, 19);
    io[15] = 0.0;
    if !(io[2] > 0.0 && io[3] > 0.0 && io[6] > 0.0 && io[7] > 0.0) { return 0; }
    let factor = min(io[6] / io[2], io[7] / io[3]);
    let image_x = io[0] + io[2] / 2.0;
    let image_y = io[1] + io[3] / 2.0;
    let model_x = io[8] + io[10] + io[12];
    let model_y = io[9] + io[11] + io[13];
    io[16] = io[12] + io[4] + io[6] / 2.0 - image_x + (1.0 - factor) * (image_x - model_x);
    io[17] = io[13] + io[5] + io[7] / 2.0 - image_y + (1.0 - factor) * (image_y - model_y);
    io[18] = io[14] * factor;
    io[15] = 1.0;
    1
}

/// The pose of a book opened flat to read, whole spread in view. In: book width, height and
/// thickness, viewport width and height, centre x and y. Out [7..]: x, y, scale.
/// # Safety
/// `io` points to 10 writable f64.
#[no_mangle]
pub unsafe extern "C" fn book_reading_pose(io: *mut f64) {
    let io = block(io, 10);
    let (width, height, thickness, vw, vh) = (io[0], io[1], io[2], io[3], io[4]);
    let scale = min(min(1.0, vw * 0.86 / (width * 2.0 + thickness * 0.8)), vh * 0.66 / height);
    io[7] = vw / 2.0 - io[5] + width * scale / 2.0;
    io[8] = vh * 0.44 - io[6];
    io[9] = scale;
}
