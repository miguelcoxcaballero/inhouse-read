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

// One step is a coarse scan row or one refined placement. The host can yield
// between steps without moving the immutable image or losing floating-point order.
fn advance(gray: &[u8], near: &[f32], width: i32, height: i32, rows: i32,
    mask: &Mask<'_>, state: &mut [f64], budget: u32) -> u32 {
    if state[0] == 0.0 { state.copy_from_slice(&[1.0, 1.0, 5.0, 1.0, 5.0, 0.0, 0.0]); }
    for _ in 0..budget {
        if state[0] == 1.0 {
            let y = state[2] as i32;
            if y <= rows - mask.height - 2 {
                let mut x = 1;
                while x <= width - mask.width - 1 {
                    let score = perimeter_score(gray, near, i64::from(y) * i64::from(width) + i64::from(x), mask);
                    if score > state[5] { state[5] = score; state[3] = x as f64; state[4] = y as f64; }
                    x += 8;
                }
                state[2] += 8.0;
                continue;
            }
            state[0] = 2.0;
            state[1] = 1.max(state[3] as i32 - 8) as f64;
            state[2] = 5.max(state[4] as i32 - 8) as f64;
        }
        if state[0] == 2.0 {
            let max_x = (width - mask.width - 1).min(state[3] as i32 + 8);
            let max_y = (rows - mask.height - 2).min(state[4] as i32 + 8);
            if state[1] as i32 > max_x { state[1] = 1.max(state[3] as i32 - 8) as f64; state[2] += 3.0; }
            if state[2] as i32 > max_y || state[1] as i32 > max_x { state[0] = 3.0; return 1; }
            let (x, y) = (state[1] as i32, state[2] as i32);
            let coarse = perimeter_score(gray, near, i64::from(y) * i64::from(width) + i64::from(x), mask);
            let combined = shape_score(gray, width, height, mask, x, y) * 400.0 + coarse * 0.12;
            if combined > state[6] { state[6] = combined; }
            state[1] += 3.0;
        }
        if state[0] == 3.0 { return 1; }
    }
    0
}

/// Same validated buffers as font_score, plus seven initialized f64 state slots.
/// Returns 1 on completion, 0 when more steps remain, 2 for invalid dimensions.
#[no_mangle]
pub unsafe extern "C" fn font_score_step(
    gray_ptr: *const u8, near_ptr: *const f32, width: i32, height: i32, rows: i32,
    mask_ptr: *const u8, mask_width: i32, mask_height: i32, area: f64,
    perimeter_ptr: *const i32, perimeter_len: usize,
    foreground_ptr: *const i32, foreground_len: usize,
    background_ptr: *const i32, background_len: usize,
    state_ptr: *mut f64, budget: u32,
) -> u32 {
    if width < 1 || height < 1 || rows < 1 || rows > height || mask_width < 1 || mask_height < 1 { return 2; }
    let Some(count) = (width as usize).checked_mul(height as usize) else { return 2; };
    let Some(mask_count) = (mask_width as usize).checked_mul(mask_height as usize) else { return 2; };
    let mask = Mask {
        width: mask_width, height: mask_height, area,
        pixels: std::slice::from_raw_parts(mask_ptr, mask_count),
        perimeter: std::slice::from_raw_parts(perimeter_ptr, perimeter_len),
        foreground: std::slice::from_raw_parts(foreground_ptr, foreground_len),
        background: std::slice::from_raw_parts(background_ptr, background_len),
    };
    advance(std::slice::from_raw_parts(gray_ptr, count), std::slice::from_raw_parts(near_ptr, count),
        width, height, rows, &mask, std::slice::from_raw_parts_mut(state_ptr, 7), budget)
}

// Canvas owns shaping and locale case conversion. Rust retains the title wrap
// state and search policy; UTF-16 preserves lone surrogates and browser indices.
pub struct TitleWrap {
    text: Vec<u16>, ends: Vec<usize>, next: usize, start: usize, end: usize,
    word_start: usize, word_end: usize, pending: bool, measure: bool,
    lines: Vec<u32>, finished: bool,
}
#[no_mangle]
pub unsafe extern "C" fn font_wrap_new(text: *const u16, len: usize) -> *mut TitleWrap {
    if len > 1_048_576 { return std::ptr::null_mut(); }
    let text = std::slice::from_raw_parts(text, len);
    let mut normalized=Vec::with_capacity(len);let mut ends=Vec::new();
    for word in text.split(|c| crate::speech_normalize::whitespace(*c)).filter(|word|!word.is_empty()) {
        if !normalized.is_empty() { normalized.push(32); }
        normalized.extend_from_slice(word);ends.push(normalized.len());
    }
    Box::into_raw(Box::new(TitleWrap {text:normalized,ends,next:0,start:0,end:0,
        word_start:0,word_end:0,pending:false,measure:false,lines:Vec::new(),finished:false}))
}
/// 0 = finished. Otherwise start + end * 2^21 + measure * 2^42.
/// These bounded UTF-16 spans are exact integers in f64; the browser only
/// slices its own string for Canvas shaping, without per-word string copies.
#[no_mangle]
pub unsafe extern "C" fn font_wrap_step(handle:*mut TitleWrap, measured:f64, max_width:f64) -> f64 {
    let Some(state)=handle.as_mut() else {return 0.0;};
    if state.finished {return 0.0;}
    if state.pending {
        if state.measure && measured>max_width {
            if state.lines.len()<8 {state.lines.extend_from_slice(&[state.start as u32,state.end as u32]);}
            state.start=state.word_start;
        }
        state.end=state.word_end;state.pending=false;
    }
    if state.next==state.ends.len() {
        if state.end>state.start && state.lines.len()<8 {state.lines.extend_from_slice(&[state.start as u32,state.end as u32]);}
        state.finished=true;return 0.0;
    }
    state.measure=state.end>state.start;
    state.word_start=if state.next==0 {0} else {state.ends[state.next-1]+1};
    state.word_end=state.ends[state.next];
    let start=if state.measure {state.start} else {state.word_start};
    state.next+=1;state.pending=true;
    start as f64 + state.word_end as f64*2_097_152.0 + if state.measure {4_398_046_511_104.0} else {0.0}
}
#[no_mangle]
pub unsafe extern "C" fn font_wrap_text(handle:*const TitleWrap) -> *const u16 {
    handle.as_ref().map_or(std::ptr::null(),|state|state.text.as_ptr())
}
#[no_mangle]
pub unsafe extern "C" fn font_wrap_text_len(handle:*const TitleWrap) -> usize {
    handle.as_ref().map_or(0,|state|state.text.len())
}
#[no_mangle]
pub unsafe extern "C" fn font_wrap_result(handle:*const TitleWrap) -> *const u32 {
    handle.as_ref().map_or(std::ptr::null(),|state|state.lines.as_ptr())
}
#[no_mangle]
pub unsafe extern "C" fn font_wrap_result_len(handle:*const TitleWrap) -> usize {
    handle.as_ref().map_or(0,|state|state.lines.len())
}
#[no_mangle]
pub unsafe extern "C" fn font_wrap_free(handle:*mut TitleWrap) {
    if !handle.is_null() {drop(Box::from_raw(handle));}
}

/// Eight scalar fields per raster request: case, alignment, size, canvas
/// height, text x, line height, line width and shared wrapping-cache key.
#[no_mangle]
pub unsafe extern "C" fn font_search_plan(case_changes:u32, width:f64, out:*mut f64) -> usize {
    let count = if case_changes != 0 { 24 } else { 12 };
    let out = std::slice::from_raw_parts_mut(out, count * 8);
    let mut at=0;
    for upper in 0..if case_changes != 0 { 2 } else { 1 } {
        for align in 0..3 {
            for (index,size) in [11.0_f64,16.0,22.0,29.0].into_iter().enumerate() {
                let x=match align { 1=>1.0, 2=>width-1.0, _=>width/2.0 };
                out[at..at+8].copy_from_slice(&[upper as f64,align as f64,size,
                    (size*5.5).ceil(),x,size*1.08,width-2.0,(upper*4+index) as f64]);
                at+=8;
            }
        }
    }
    count
}
#[no_mangle]
pub extern "C" fn font_mask_fits(mask_width:f64, mask_height:f64, width:f64, rows:f64) -> u32 {
    (!(mask_width > width-2.0 || mask_height > rows-8.0)) as u32
}
#[no_mangle]
pub unsafe extern "C" fn font_family_max(values:*const f64,len:usize) -> f64 {
    let mut result=0.0_f64;
    for &score in std::slice::from_raw_parts(values,len) {
        if score.is_nan() { return f64::NAN; }
        if score>result { result=score; }
    }
    result
}
#[no_mangle]
pub unsafe extern "C" fn font_family_select(values:*const f64,len:usize) -> i32 {
    if len == 0 || len > 6 { return -1; }
    let values=std::slice::from_raw_parts(values,len);
    let mut indices:Vec<usize>=(0..len).collect();
    indices.sort_by(|&a,&b| values[b].partial_cmp(&values[a]).unwrap_or(std::cmp::Ordering::Equal));
    let best=indices[0];
    let margin=if len>1 { (values[best]-values[indices[1]])/values[best].max(1.0) } else { 0.0 };
    if values[best]<18.0 || margin<0.035 { -1 } else { best as i32 }
}

// A family renders the same title at three alignments. Canvas measurement is
// alignment-independent: retain its eight case/size wraps for this one family.
// The cache owns only completed wraps, and is dropped with the generator.
pub struct TitleWrapCache { entries:[Option<Box<TitleWrap>>;8] }
#[no_mangle]
pub extern "C" fn font_wrap_cache_new() -> *mut TitleWrapCache {
    Box::into_raw(Box::new(TitleWrapCache{entries:std::array::from_fn(|_|None)}))
}
#[no_mangle]
pub unsafe extern "C" fn font_wrap_cache_get(cache:*const TitleWrapCache,key:usize) -> *const TitleWrap {
    cache.as_ref().and_then(|state|state.entries.get(key)).and_then(|entry|entry.as_deref())
        .map_or(std::ptr::null(),|state|state as *const TitleWrap)
}
#[no_mangle]
pub unsafe extern "C" fn font_wrap_cache_store(cache:*mut TitleWrapCache,key:usize,wrap:*mut TitleWrap) -> u32 {
    let Some(cache)=cache.as_mut() else {return 0;};
    if key>=8 || wrap.is_null() || !(*wrap).finished {return 0;}
    cache.entries[key]=Some(Box::from_raw(wrap));1
}
#[no_mangle]
pub unsafe extern "C" fn font_wrap_cache_free(cache:*mut TitleWrapCache) {
    if !cache.is_null() {drop(Box::from_raw(cache));}
}
