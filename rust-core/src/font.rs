//! Original title-font matcher, with one image retained by the worker bridge.
//! Keep f64 operations in their JavaScript order: scores decide visible fonts.

fn sample<T: Copy + Into<f64>>(values: &[T], at: i64) -> f64 {
    if at < 0 { return f64::NAN; }
    values.get(at as usize).map(|value| (*value).into()).unwrap_or(f64::NAN)
}

fn mean_at(gray: &[u8], base: i64, points: &[i32]) -> f64 {
    if points.is_empty() { return 0.0; }
    let mut sum = 0.0;
    for &point in points { sum += sample(gray, base + i64::from(point)); }
    sum / points.len() as f64
}

struct Mask<'a> {
    width: i32, height: i32, pixels: &'a [u8], area: f64,
    perimeter: &'a [i32], foreground: &'a [i32], background: &'a [i32],
}

fn perimeter_score(gray: &[u8], near: &[f32], base: i64, mask: &Mask<'_>) -> f64 {
    let mut total = 0.0;
    for &point in mask.perimeter { total += sample(near, base + i64::from(point)); }
    let contrast = (mean_at(gray, base, mask.foreground) - mean_at(gray, base, mask.background)).abs();
    total / mask.perimeter.len() as f64 + contrast * 0.8
}

fn shape_score(gray: &[u8], width: i32, height: i32, mask: &Mask<'_>, x: i32, y: i32) -> f64 {
    let mut border = 0.0;
    let mut border_count = 0;
    let mut offset = -2;
    while offset < mask.width + 2 {
        let column = (x + offset).clamp(0, width - 1);
        let above = y - 2;
        let below = y + mask.height + 1;
        if above >= 0 && above < height { border += sample(gray, i64::from(above) * i64::from(width) + i64::from(column)); border_count += 1; }
        if below >= 0 && below < height { border += sample(gray, i64::from(below) * i64::from(width) + i64::from(column)); border_count += 1; }
        offset += 3;
    }
    offset = -2;
    while offset < mask.height + 2 {
        let row = i64::from((y + offset).clamp(0, height - 1)) * i64::from(width);
        let left = x - 2;
        let right = x + mask.width + 1;
        if left >= 0 && left < width { border += sample(gray, row + i64::from(left)); border_count += 1; }
        if right >= 0 && right < width { border += sample(gray, row + i64::from(right)); border_count += 1; }
        offset += 3;
    }
    let background = border / border_count.max(1) as f64;
    let bright_text = background < 128.0;
    let threshold = if bright_text { background + 46.0 } else { background - 46.0 };
    let mut observed = 0.0;
    let mut both = 0.0;
    for my in 0..mask.height {
        let row = i64::from(y + my) * i64::from(width) + i64::from(x);
        let cells = my as usize * mask.width as usize;
        for mx in 0..mask.width {
            let value = sample(gray, row + i64::from(mx));
            if if bright_text { value > threshold } else { value < threshold } {
                observed += 1.0;
                both += f64::from(mask.pixels[cells + mx as usize]);
            }
        }
    }
    let union = mask.area + observed - both;
    if union != 0.0 { both / union } else { 0.0 }
}

#[no_mangle]
pub unsafe extern "C" fn font_score(
    gray_ptr: *const u8, near_ptr: *const f32, width: i32, height: i32, rows: i32,
    mask_ptr: *const u8, mask_width: i32, mask_height: i32, area: f64,
    perimeter_ptr: *const i32, perimeter_len: usize,
    foreground_ptr: *const i32, foreground_len: usize,
    background_ptr: *const i32, background_len: usize,
) -> f64 {
    if width < 1 || height < 1 || rows < 1 || rows > height || mask_width < 1 || mask_height < 1 {
        return f64::NAN;
    }
    let Some(count) = (width as usize).checked_mul(height as usize) else { return f64::NAN; };
    let Some(mask_count) = (mask_width as usize).checked_mul(mask_height as usize) else { return f64::NAN; };
    let gray = std::slice::from_raw_parts(gray_ptr, count);
    let near = std::slice::from_raw_parts(near_ptr, count);
    let mask = Mask {
        width: mask_width, height: mask_height, area,
        pixels: std::slice::from_raw_parts(mask_ptr, mask_count),
        perimeter: std::slice::from_raw_parts(perimeter_ptr, perimeter_len),
        foreground: std::slice::from_raw_parts(foreground_ptr, foreground_len),
        background: std::slice::from_raw_parts(background_ptr, background_len),
    };
    let mut best_x = 1;
    let mut best_y = 5;
    let mut mask_score = 0.0;
    let mut y = 5;
    while y <= rows - mask.height - 2 {
        let mut x = 1;
        while x <= width - mask.width - 1 {
            let score = perimeter_score(gray, near, i64::from(y) * i64::from(width) + i64::from(x), &mask);
            if score > mask_score { mask_score = score; best_x = x; best_y = y; }
            x += 8;
        }
        y += 8;
    }
    let mut matched_shape_score = 0.0;
    y = 5.max(best_y - 8);
    while y <= (rows - mask.height - 2).min(best_y + 8) {
        let mut x = 1.max(best_x - 8);
        while x <= (width - mask.width - 1).min(best_x + 8) {
            let coarse = perimeter_score(gray, near, i64::from(y) * i64::from(width) + i64::from(x), &mask);
            let combined = shape_score(gray, width, height, &mask, x, y) * 400.0 + coarse * 0.12;
            if combined > matched_shape_score { matched_shape_score = combined; }
            x += 3;
        }
        y += 3;
    }
    matched_shape_score
}
