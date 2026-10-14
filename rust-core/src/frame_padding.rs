//! Reserve at most 16 empty logical pixels across a one-axis native shrink of
//! a book's frame. The host passes the numbers it read (NaN for anything that
//! was not a number) and applies the answer to its own objects.

fn whole(value: f64) -> bool { value.is_finite() && value.fract() == 0.0 }
fn positive(value: f64) -> bool { whole(value) && value > 0.0 }

/// The previous frame is a usable pixel-aligned predecessor: the scale is a
/// whole number, the frames are whole and positive, the physical size is
/// exactly previous * ratio and the extra width is at most 16 px.
fn aligned(allowed: f64, frame: [f64; 2], previous: [f64; 2], ratio: f64, physical: [f64; 2]) -> bool {
    allowed != 0.0 && whole(ratio) && ratio >= 1.0 && frame.iter().chain(previous.iter()).all(|&v| positive(v))
        && previous[0] - frame[0] <= 16.0 && physical[0] == previous[0] * ratio && physical[1] == previous[1] * ratio
}

/// Whether the previous width replaces the frame's (same height, wider by 1..16 px).
#[no_mangle]
pub extern "C" fn padded_frame_width(allowed: f64, frame_width: f64, frame_height: f64, previous_x: f64, previous_y: f64,
    ratio: f64, physical_width: f64, physical_height: f64) -> u32 {
    (aligned(allowed, [frame_width, frame_height], [previous_x, previous_y], ratio, [physical_width, physical_height])
        && previous_y == frame_height && previous_x > frame_width) as u32
}

/// Padded size, written to `out` as [width, height]; 0 keeps the original.
/// Small blank rows are kept as well, but never a page-sized framebuffer.
/// # Safety
/// `out` points to two writable, 8-byte aligned f64 values.
#[no_mangle]
pub unsafe extern "C" fn padded_frame_size(allowed: f64, frame_width: f64, frame_height: f64, previous_x: f64, previous_y: f64,
    ratio: f64, physical_width: f64, physical_height: f64, out: *mut f64) -> u32 {
    if out.is_null() || (out as usize) % 8 != 0 { return 0; }
    if !aligned(allowed, [frame_width, frame_height], [previous_x, previous_y], ratio, [physical_width, physical_height])
        || previous_x < frame_width { return 0; }
    let height = if previous_y == frame_height { frame_height }
        else if previous_y <= 384.0 && previous_y > frame_height && previous_y - frame_height <= 128.0 { previous_y }
        else { return 0 };
    std::slice::from_raw_parts_mut(out, 2).copy_from_slice(&[previous_x, height]);
    1
}
