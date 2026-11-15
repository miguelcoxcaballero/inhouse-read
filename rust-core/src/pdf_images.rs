//! Clipping paths of a page's picture footprints, from the PDF renderer's transformed unit-square corners.
//! Colour-managed drawing remains in PDF.js/Canvas. The composite bounds of the pictures and their place in the
//! reading stream are rust-ui (pdf_pictures.rs), which is where the reader that asks for them lives.
/// Ordered, equally wound parallelograms for restoring original image colours.
/// No bounding-box substitution: rotated images must not restore paper wedges.
/// # Safety
/// Input is count*6 f64, output has room for count*8 f64. The caller owns both.
#[no_mangle]
pub unsafe extern "C" fn pdf_image_paths(input: *const f64, count: usize,
    width: f64, height: f64, output: *mut f64) -> usize {
    if count > 32768 || !width.is_finite() || !height.is_finite()
        || width <= 0.0 || height <= 0.0 { return usize::MAX; }
    if count == 0 { return 0; }
    let source = std::slice::from_raw_parts(input, count * 6);
    let target = std::slice::from_raw_parts_mut(output, count * 8);
    let mut written = 0;
    for c in source.chunks_exact(6) {
        if c.iter().any(|v| !v.is_finite()) { continue; }
        let [ax, ay, bx, by, cx, cy] = [c[0], c[1], c[2], c[3], c[4], c[5]];
        let mirrored = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax) < 0.0;
        let (first_x, first_y, last_x, last_y) = if mirrored { (cx, cy, bx, by) }
            else { (bx, by, cx, cy) };
        target[written * 8..written * 8 + 8].copy_from_slice(&[
            ax * width, ay * height, first_x * width, first_y * height,
            (bx + cx - ax) * width, (by + cy - ay) * height,
            last_x * width, last_y * height,
        ]);
        written += 1;
    }
    written
}
