//! Incremental cover palette: histogram, ranking and distinct colour selection.
//! Host computes the original RGB->OKLab values, preserving Math.cbrt.
//! Vec insertion order is observable; maps are lookup indexes only.
use std::collections::HashMap;

const PIXEL_LIMIT: usize = 512 * 512;
const BIN_LIMIT: usize = 32768;
const BIN_STRIDE: usize = 7;
const COLOR_LIMIT: usize = 10;

#[derive(Clone)]
struct Bin { count: u32, mode_count: u32, packed: u32, representative: f64, lab: [f64; 3] }
struct Cell { coords: [i32; 3], count: u32, bin: usize, density: u32, mode: usize }
pub struct Palette {
    pixels: usize, scanned: usize, opaque: u32,
    bin_index: Vec<usize>, frequencies: HashMap<u32, u32>, bins: Vec<Bin>, labs: usize,
    cell_index: HashMap<[i32; 3], usize>, cells: Vec<Cell>, grouped: usize, neighbors: usize,
    order: Vec<usize>, flat: Vec<usize>, rare: f64, minimum: f64,
    cursor: usize, pending: Option<usize>, support_at: usize, support: u32,
    chosen: Vec<(usize, u32)>, sorted: bool, finished: bool,
}
fn stronger(a: &Bin, b: &Bin) -> bool {
    a.mode_count > b.mode_count || a.mode_count == b.mode_count
        && (a.count > b.count || a.count == b.count && a.packed < b.packed)
}
fn distance(a: &[f64; 3], b: &[f64; 3]) -> f64 {
    let x = a[0] - b[0]; let y = a[1] - b[1]; let z = a[2] - b[2];
    x * x + y * y + z * z
}
fn rgb(packed: u32) -> [f64; 3] { [(packed >> 16) as f64, ((packed >> 8) & 255) as f64, (packed & 255) as f64] }
fn edge_blend(job: &Palette, bin: &Bin) -> bool {
    if bin.mode_count as f64 >= job.rare { return false; }
    for a in 0..job.flat.len() { for b in a + 1..job.flat.len() {
        let from = rgb(job.bins[job.flat[a]].packed); let to = rgb(job.bins[job.flat[b]].packed);
        let value = rgb(bin.packed); let delta = [to[0]-from[0], to[1]-from[1], to[2]-from[2]];
        let mut length = 0.0; let mut dot = 0.0;
        for c in 0..3 { length += delta[c]*delta[c]; dot += (value[c]-from[c])*delta[c]; }
        if length == 0.0 { continue; }
        let t = dot / length; if t <= 0.02 || t >= 0.98 { continue; }
        let mut error = 0.0;
        for c in 0..3 { let d = value[c]-from[c]-t*delta[c]; error += d*d; }
        if error <= 3.0 { return true; }
    }}
    false
}

/// Opaque job ownership: create once, free exactly once. The host alone owns
/// this handle. No JavaScript callbacks or retained host pixel pointers.
#[no_mangle]
pub extern "C" fn relief_palette_new(pixels: usize) -> *mut Palette {
    if pixels == 0 || pixels > PIXEL_LIMIT { return std::ptr::null_mut(); }
    Box::into_raw(Box::new(Palette {
        pixels, scanned: 0, opaque: 0, bin_index: vec![usize::MAX; BIN_LIMIT],
        frequencies: HashMap::new(), bins: Vec::new(), labs: 0,
        cell_index: HashMap::new(), cells: Vec::new(), grouped: 0, neighbors: 0,
        order: Vec::new(), flat: Vec::new(), rare: 0.0, minimum: 0.0,
        cursor: 0, pending: None, support_at: 0, support: 0,
        chosen: Vec::new(), sorted: false, finished: false,
    }))
}
#[no_mangle]
pub unsafe extern "C" fn relief_palette_free(pointer: *mut Palette) {
    if !pointer.is_null() { drop(Box::from_raw(pointer)); }
}
#[no_mangle]
pub unsafe extern "C" fn relief_palette_count(pointer: *const Palette, kind: u32) -> usize {
    if pointer.is_null() { return 0; } let job = &*pointer;
    match kind { 0 => job.bins.len(), 1 => job.opaque as usize, 2 => job.cells.len(), _ => 0 }
}
#[no_mangle]
pub unsafe extern "C" fn relief_palette_pixels(pointer: *mut Palette, rgba: *const u8, from: usize, end: usize) -> u32 {
    if pointer.is_null() || rgba.is_null() { return 0; } let job = &mut *pointer;
    if from != job.scanned || end < from || end > job.pixels { return 0; }
    let bytes = std::slice::from_raw_parts(rgba, job.pixels * 4);
    for index in from..end {
        let at = index * 4; if bytes[at+3] < 128 { continue; }
        job.opaque += 1;
        let r = bytes[at] as u32; let g = bytes[at+1] as u32; let b = bytes[at+2] as u32;
        let key = ((r >> 3) << 10 | (g >> 3) << 5 | b >> 3) as usize;
        let packed = r << 16 | g << 8 | b;
        let frequency = job.frequencies.entry(packed).or_insert(0); *frequency += 1;
        let mut representative = 0.0;
        for value in [r, g, b] { let offset = (value & 7) as f64 - 3.5; representative += offset * offset; }
        let position = if job.bin_index[key] == usize::MAX {
            let position = job.bins.len(); job.bin_index[key] = position;
            job.bins.push(Bin { count: 0, mode_count: 0, packed, representative, lab: [0.0;3] }); position
        } else { job.bin_index[key] };
        let bin = &mut job.bins[position]; bin.count += 1;
        if *frequency > bin.mode_count || *frequency == bin.mode_count
            && (representative < bin.representative || representative == bin.representative && packed < bin.packed) {
            bin.packed = packed; bin.representative = representative; bin.mode_count = *frequency;
        }
    }
    job.scanned = end; 1
}
/// Bins remain in first-appearance order. Output: count, modeCount, r,g,b,
/// packed RGB and representativeDistance. Host adds the exact lab triplet.
#[no_mangle]
pub unsafe extern "C" fn relief_palette_bins(pointer: *const Palette, from: usize, end: usize, output: *mut f64) -> u32 {
    if pointer.is_null() || output.is_null() { return 0; } let job = &*pointer;
    if job.scanned != job.pixels || end < from || end > job.bins.len() { return 0; }
    let out = std::slice::from_raw_parts_mut(output, (end-from)*BIN_STRIDE);
    for (i, bin) in job.bins[from..end].iter().enumerate() {
        let channels = rgb(bin.packed); let at = i * BIN_STRIDE;
        out[at..at+BIN_STRIDE].copy_from_slice(&[bin.count as f64, bin.mode_count as f64,
            channels[0], channels[1], channels[2], bin.packed as f64, bin.representative]);
    }
    1
}
#[no_mangle]
pub unsafe extern "C" fn relief_palette_labs(pointer: *mut Palette, from: usize, end: usize, input: *const f64) -> u32 {
    if pointer.is_null() || input.is_null() { return 0; } let job = &mut *pointer;
    if from != job.labs || end < from || end > job.bins.len() || job.scanned != job.pixels { return 0; }
    let values = std::slice::from_raw_parts(input, (end-from)*3);
    if values.iter().any(|v| !v.is_finite() || v.abs() > 1000.0) { return 0; }
    for index in from..end { job.bins[index].lab.copy_from_slice(&values[(index-from)*3..(index-from+1)*3]); }
    job.labs = end; 1
}
#[no_mangle]
pub unsafe extern "C" fn relief_palette_cells(pointer: *mut Palette, from: usize, end: usize) -> u32 {
    if pointer.is_null() { return 0; } let job = &mut *pointer;
    if from != job.grouped || end < from || end > job.bins.len() || job.labs != job.bins.len() { return 0; }
    for index in from..end {
        let bin = &job.bins[index]; let coords = bin.lab.map(|v| (v / 3.0).floor() as i32);
        let position = if let Some(&position) = job.cell_index.get(&coords) { position }
        else { let position = job.cells.len(); job.cell_index.insert(coords, position);
            job.cells.push(Cell { coords, count: 0, bin: index, density: 0, mode: index }); position };
        let cell = &mut job.cells[position]; cell.count += bin.count;
        if stronger(bin, &job.bins[cell.bin]) { cell.bin = index; }
    }
    job.grouped = end; 1
}
#[no_mangle]
pub unsafe extern "C" fn relief_palette_neighbors(pointer: *mut Palette, from: usize, end: usize) -> u32 {
    if pointer.is_null() { return 0; } let job = &mut *pointer;
    if from != job.neighbors || end < from || end > job.cells.len() || job.grouped != job.bins.len() { return 0; }
    for index in from..end {
        let cell = &job.cells[index]; let coords = cell.coords; let mut density = 0; let mut mode = cell.bin;
        for dl in -1..=1 { for da in -1..=1 { for db in -1..=1 {
            if let Some(&neighbor) = job.cell_index.get(&[coords[0]+dl, coords[1]+da, coords[2]+db]) {
                let other = &job.cells[neighbor];
                if distance(&job.bins[cell.bin].lab, &job.bins[other.bin].lab) <= 36.0 {
                    density += other.count; if stronger(&job.bins[other.bin], &job.bins[mode]) { mode = other.bin; }
                }
            }
        }}}
        job.cells[index].density = density; job.cells[index].mode = mode;
    }
    job.neighbors = end; 1
}
#[no_mangle]
pub unsafe extern "C" fn relief_palette_sort(pointer: *mut Palette) -> u32 {
    if pointer.is_null() { return 0; } let job = &mut *pointer;
    if job.sorted || job.scanned != job.pixels || job.neighbors != job.cells.len() || job.grouped != job.bins.len() { return 0; }
    job.order = (0..job.cells.len()).collect();
    job.order.sort_by(|&a, &b| job.cells[b].density.cmp(&job.cells[a].density)
        .then_with(|| job.cells[b].count.cmp(&job.cells[a].count))
        .then_with(|| job.bins[job.cells[a].bin].packed.cmp(&job.bins[job.cells[b].bin].packed)));
    let limit = 8.0f64.max(job.opaque as f64 * 0.05);
    job.flat = job.bins.iter().enumerate().filter(|(_,bin)| bin.mode_count as f64 >= limit).map(|(i,_)|i).collect();
    let maximum = job.flat.iter().map(|&i| job.bins[i].mode_count).max().unwrap_or(0);
    job.rare = 2.0f64.max((maximum as f64 * 0.005).ceil());
    job.minimum = 1.0f64.max((job.opaque as f64 * 0.0025).ceil());
    job.sorted = true; 1
}
/// 1: pending candidate; 0: complete; -1: invalid sequence. Skipped candidates
/// do not introduce extra host yields, matching the reference generator.
#[no_mangle]
pub unsafe extern "C" fn relief_palette_next(pointer: *mut Palette) -> i32 {
    if pointer.is_null() { return -1; } let job = &mut *pointer;
    if !job.sorted || job.pending.is_some() || job.finished { return -1; }
    while job.cursor < job.order.len() && job.chosen.len() < COLOR_LIMIT {
        let cell = &job.cells[job.order[job.cursor]]; job.cursor += 1;
        if (cell.density as f64) < job.minimum { job.finished = true; return 0; }
        let index = cell.mode; let bin = &job.bins[index];
        if edge_blend(job, bin) || job.chosen.iter().any(|&(other,_)| distance(&job.bins[other].lab, &bin.lab) < 144.0) { continue; }
        job.pending = Some(index); job.support_at = 0; job.support = 0; return 1;
    }
    job.finished = true; 0
}
#[no_mangle]
pub unsafe extern "C" fn relief_palette_support(pointer: *mut Palette, from: usize, end: usize) -> u32 {
    if pointer.is_null() { return 0; } let job = &mut *pointer;
    let Some(index) = job.pending else { return 0; };
    if from != job.support_at || end < from || end > job.bins.len() { return 0; }
    for bin in &job.bins[from..end] { if distance(&job.bins[index].lab, &bin.lab) <= 36.0 { job.support += bin.count; } }
    job.support_at = end; 1
}
#[no_mangle]
pub unsafe extern "C" fn relief_palette_accept(pointer: *mut Palette) -> u32 {
    if pointer.is_null() { return 0; } let job = &mut *pointer;
    let Some(index) = job.pending else { return 0; };
    if job.support_at != job.bins.len() { return 0; }
    if job.support as f64 >= job.minimum { job.chosen.push((index,job.support)); }
    job.pending = None; 1
}
#[no_mangle]
pub unsafe extern "C" fn relief_palette_finish(pointer: *mut Palette, output: *mut f64) -> i32 {
    if pointer.is_null() || output.is_null() { return -1; } let job = &mut *pointer;
    if !job.finished || job.pending.is_some() { return -1; }
    job.chosen.sort_by(|&(a,sa),&(b,sb)| sb.cmp(&sa).then_with(|| job.bins[a].packed.cmp(&job.bins[b].packed)));
    let out = std::slice::from_raw_parts_mut(output, COLOR_LIMIT*2);
    for (i,&(index,supported)) in job.chosen.iter().enumerate() { out[i*2] = index as f64; out[i*2+1] = supported as f64; }
    job.chosen.len() as i32
}
