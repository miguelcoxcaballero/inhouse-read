//! Cover relief as resumable jobs: the palette of a cover, the colours it proposes and the exclusive
//! pigment maps of chosen colours, end to end. The host copies the pixels in once, calls `step` until it
//! returns 0 (every step is one bounded chunk of work; a result of 1 asks the host to give the main
//! thread back before the next one, 2 to carry on at once) and reads the results before freeing the job.
//! OKLab follows Ottosson's matrices with the host's own sRGB-to-linear table (its `**` rounding is the
//! engine's) and V8's cube root (FreeBSD s_cbrt.c), so every colour distance is bit-identical to the
//! JavaScript original.
use std::sync::OnceLock;
use crate::color_mask::{relief_color_mask_count, relief_color_mask_pixels};
use crate::cover_seed::relief_cover_seed;
use crate::relief::{relief_distance_init, relief_distance_rows, relief_membership_pixels, relief_pigment_pixels};
use crate::relief_palette::*;

const PIXEL_LIMIT: usize = 512 * 512;
const YIELD: i32 = 1;
const GO_ON: i32 = 2;

/// V8's `Math.cbrt` (fdlibm / FreeBSD s_cbrt.c, Bruce D. Evans' version): rough 5-bit estimate, a
/// polynomial to 23 bits, rounding away from zero, then one Newton step. Not `f64::cbrt`, whose library
/// version may differ in the last bit.
fn cbrt(x: f64) -> f64 {
    const B1: u32 = 715_094_163;
    const B2: u32 = 696_219_795;
    const P0: f64 = 1.87595182427177009643;
    const P1: f64 = -1.88497979543377169875;
    const P2: f64 = 1.621429720105354466140;
    const P3: f64 = -0.758397934778766047437;
    const P4: f64 = 0.145996192886612446982;
    let bits = x.to_bits();
    let sign = (bits >> 32) as u32 & 0x8000_0000;
    let hx = (bits >> 32) as u32 & 0x7fff_ffff;
    let low = bits as u32;
    if hx >= 0x7ff0_0000 { return x + x; }
    let mut t;
    if hx < 0x0010_0000 {
        if (hx | low) == 0 { return x; }
        t = f64::from_bits(0x4350_0000u64 << 32) * x;
        let high = (t.to_bits() >> 32) as u32;
        t = f64::from_bits(((sign | ((high & 0x7fff_ffff) / 3 + B2)) as u64) << 32);
    } else {
        t = f64::from_bits(((sign | (hx / 3 + B1)) as u64) << 32);
    }
    let mut r = (t * t) * (t / x);
    t *= (P0 + r * (P1 + r * P2)) + ((r * r) * r) * (P3 + r * P4);
    t = f64::from_bits(t.to_bits().wrapping_add(0x8000_0000) & 0xffff_ffff_c000_0000);
    let s = t * t;
    r = x / s;
    let w = t + t;
    r = (r - t) / (w + r);
    t + t * r
}

/// The sRGB-to-linear table of the original: 256 values the host computes once with its own `**` (a
/// last-bit difference with `powf` would move colours across a ball's edge). Set before the first job.
static LINEAR: OnceLock<[f64; 256]> = OnceLock::new();

/// Install the table: 256 finite values in [0, 1]. A second call must bring the same values.
/// # Safety
/// `table` points to 256 readable f64 values.
#[no_mangle]
pub unsafe extern "C" fn relief_linear_set(table: *const f64) -> u32 {
    if table.is_null() { return 0; }
    let values = std::slice::from_raw_parts(table, 256);
    if values.iter().any(|v| !v.is_finite() || *v < 0.0 || *v > 1.0) { return 0; }
    let mut copy = [0.0; 256];
    copy.copy_from_slice(values);
    let _ = LINEAR.set(copy);
    u32::from(LINEAR.get().is_some_and(|known| known.iter().zip(values).all(|(a, b)| a.to_bits() == b.to_bits())))
}

/// OKLab * 100 of one 8-bit colour (Euclidean distances are Delta-E OK).
fn oklab(r: u8, g: u8, b: u8) -> [f64; 3] {
    let table = LINEAR.get().expect("linear table");
    let (r, g, b) = (table[r as usize], table[g as usize], table[b as usize]);
    let l = cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    let m = cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    let s = cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    [100.0 * (0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s),
     100.0 * (1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s),
     100.0 * (0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s)]
}

/// OKLab * 100 of one 8-bit colour into `out[0..3]`; 0 while the table is missing.
/// # Safety
/// `out` points to 3 writable f64 values.
#[no_mangle]
pub unsafe extern "C" fn relief_oklab(r: u32, g: u32, b: u32, out: *mut f64) -> u32 {
    if out.is_null() || r > 255 || g > 255 || b > 255 || LINEAR.get().is_none() { return 0; }
    std::slice::from_raw_parts_mut(out, 3).copy_from_slice(&oklab(r as u8, g as u8, b as u8));
    1
}

fn distance2(a: &[f64; 3], b: &[f64; 3]) -> f64 {
    let x = a[0] - b[0];
    let y = a[1] - b[1];
    let z = a[2] - b[2];
    x * x + y * y + z * z
}

/// One step of a chunked loop over `total` items: the end of the chunk that starts at `cursor`, and
/// whether the host should give the thread back after it (a full chunk did, like the original loops).
fn chunk(cursor: usize, size: usize, total: usize) -> (usize, bool) {
    let end = (cursor + size).min(total);
    (end, end - cursor == size)
}

/// Lab of every pixel that counts (alpha 128 and up), in chunks.
fn labs_chunk(rgba: &[u8], labs: &mut [f64], cursor: usize, end: usize) {
    for i in cursor..end {
        if rgba[i * 4 + 3] >= 128 {
            labs[i * 3..i * 3 + 3].copy_from_slice(&oklab(rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]));
        }
    }
}

struct Colour { rgb: [u8; 3], lab: [f64; 3], tolerance: f64, pixels: u32 }

enum Stage { Pixels, Labs, Cells, Neighbors, Sort, Next, Support, Finish, PixelLabs, Masks, Done }

pub struct Analysis {
    width: usize, height: usize, rgba: Vec<u8>, palette: *mut Palette, cursor: usize, stage: Stage,
    bins: usize, bin_labs: Vec<[f64; 3]>, colours: Vec<Colour>, pixel_labs: Vec<f64>, alpha: Vec<u8>,
    masks: Vec<Vec<f32>>, current: usize, seed: f64, opaque: u32, support: usize,
}
impl Drop for Analysis { fn drop(&mut self) { unsafe { relief_palette_free(self.palette) } } }

impl Analysis {
    fn step(&mut self) -> i32 {
        let count = self.width * self.height;
        let palette = self.palette;
        unsafe {
            match self.stage {
                Stage::Pixels => {
                    let (end, full) = chunk(self.cursor, 1024, count);
                    if relief_palette_pixels(palette, self.rgba.as_ptr(), self.cursor, end) != 1 { return -1; }
                    self.cursor = end;
                    if end == count {
                        self.bins = relief_palette_count(palette, 0);
                        self.opaque = relief_palette_count(palette, 1) as u32;
                        self.stage = Stage::Labs;
                        self.cursor = 0;
                    }
                    if full { YIELD } else { GO_ON }
                }
                Stage::Labs => {
                    let (end, full) = chunk(self.cursor, 256, self.bins);
                    let mut fields = vec![0.0; (end - self.cursor) * 7];
                    if relief_palette_bins(palette, self.cursor, end, fields.as_mut_ptr()) != 1 { return -1; }
                    let mut labs = Vec::with_capacity((end - self.cursor) * 3);
                    for entry in fields.chunks(7) {
                        let lab = oklab(entry[2] as u8, entry[3] as u8, entry[4] as u8);
                        labs.extend_from_slice(&lab);
                        self.bin_labs.push(lab);
                    }
                    if relief_palette_labs(palette, self.cursor, end, labs.as_ptr()) != 1 { return -1; }
                    self.cursor = end;
                    if end >= self.bins { self.stage = Stage::Cells; self.cursor = 0; }
                    if full { YIELD } else { GO_ON }
                }
                Stage::Cells => {
                    let (end, full) = chunk(self.cursor, 256, self.bins);
                    if relief_palette_cells(palette, self.cursor, end) != 1 { return -1; }
                    self.cursor = end;
                    if end >= self.bins { self.stage = Stage::Neighbors; self.cursor = 0; }
                    if full { YIELD } else { GO_ON }
                }
                Stage::Neighbors => {
                    let cells = relief_palette_count(palette, 2);
                    let (end, full) = chunk(self.cursor, 32, cells);
                    if relief_palette_neighbors(palette, self.cursor, end) != 1 { return -1; }
                    self.cursor = end;
                    if end >= cells { self.stage = Stage::Sort; }
                    if full { YIELD } else { GO_ON }
                }
                Stage::Sort => {
                    if relief_palette_sort(palette) != 1 { return -1; }
                    self.stage = Stage::Next;
                    YIELD
                }
                Stage::Next => match relief_palette_next(palette) {
                    1 => { self.stage = Stage::Support; self.support = 0; GO_ON }
                    0 => { self.stage = Stage::Finish; GO_ON }
                    _ => -1,
                },
                Stage::Support => {
                    let (end, full) = chunk(self.support, 512, self.bins);
                    if relief_palette_support(palette, self.support, end) != 1 { return -1; }
                    self.support = end;
                    if end >= self.bins {
                        if relief_palette_accept(palette) != 1 { return -1; }
                        self.stage = Stage::Next;
                        return YIELD;
                    }
                    if full { YIELD } else { GO_ON }
                }
                Stage::Finish => {
                    let mut chosen = [0.0; 20];
                    let found = relief_palette_finish(palette, chosen.as_mut_ptr());
                    if found < 0 { return -1; }
                    for index in 0..found as usize {
                        let bin = chosen[index * 2] as usize;
                        let mut fields = [0.0; 7];
                        if relief_palette_bins(palette, bin, bin + 1, fields.as_mut_ptr()) != 1 { return -1; }
                        self.colours.push(Colour { rgb: [fields[2] as u8, fields[3] as u8, fields[4] as u8],
                            lab: self.bin_labs[bin], tolerance: 6.0, pixels: 0 });
                    }
                    // Radii are less than half every inter-centre distance, so the generated choices stay disjoint.
                    for index in 0..self.colours.len() {
                        let mut nearest = f64::INFINITY;
                        for other in 0..self.colours.len() {
                            if other != index {
                                let distance = distance2(&self.colours[index].lab, &self.colours[other].lab).sqrt();
                                nearest = if distance < nearest { distance } else { nearest };
                            }
                        }
                        let radius = if nearest * 0.45 < 6.0 { nearest * 0.45 } else { 6.0 };
                        self.colours[index].tolerance = (radius * 100.0).floor() / 100.0;
                    }
                    let seed = relief_cover_seed(self.rgba.as_ptr(), self.width, self.height);
                    if seed < 0.0 { return -1; }
                    self.seed = seed;
                    self.cursor = 0;
                    if self.colours.is_empty() { self.stage = Stage::Done; } else {
                        self.stage = Stage::PixelLabs;
                        self.pixel_labs = vec![0.0; count * 3];
                        self.alpha = (0..count).map(|i| self.rgba[i * 4 + 3]).collect();
                    }
                    GO_ON
                }
                Stage::PixelLabs => {
                    let (end, full) = chunk(self.cursor, 1024, count);
                    labs_chunk(&self.rgba, &mut self.pixel_labs, self.cursor, end);
                    self.cursor = end;
                    if end == count { self.stage = Stage::Masks; self.cursor = 0; self.current = 0; self.masks.push(vec![0.0; count]); }
                    if full { YIELD } else { GO_ON }
                }
                Stage::Masks => {
                    let (end, full) = chunk(self.cursor, 1024, count);
                    let colour = &self.colours[self.current];
                    let (target, tolerance) = (colour.lab, colour.tolerance);
                    let mask = &mut self.masks[self.current];
                    let result = relief_color_mask_count(self.pixel_labs.as_ptr(), self.alpha.as_ptr(),
                        mask[self.cursor..].as_mut_ptr(), count, self.cursor, end, target[0], target[1], target[2], tolerance);
                    if result < 1 { return -1; }
                    self.colours[self.current].pixels += result - 1;
                    self.cursor = end;
                    if end == count {
                        self.current += 1;
                        self.cursor = 0;
                        if self.current == self.colours.len() { self.stage = Stage::Done; } else { self.masks.push(vec![0.0; count]); }
                    }
                    if full { YIELD } else { GO_ON }
                }
                Stage::Done => 0,
            }
        }
    }
    fn finished(&self) -> bool { matches!(self.stage, Stage::Done) }
}

/// Pigment maps of 1..10 colours, each classified against its own ball and exclusive per pixel.
pub struct Maps {
    width: usize, height: usize, rgba: Vec<u8>, alpha: Vec<u8>, labs: Vec<f64>, layers: Vec<([f64; 3], f64, f64)>,
    single: bool, stage: MapStage, cursor: usize, layer: usize, membership: Vec<f32>, hard: Vec<u8>,
    distance: Vec<f32>, owners: Vec<u8>, mask: Vec<u8>, heights: Vec<f32>, height_bytes: Vec<u8>, reverse_end: usize,
}
enum MapStage { Labs, Membership, Hard, Init, Forward, Reverse, Pigment, Done }

impl Maps {
    fn step(&mut self) -> i32 {
        let count = self.width * self.height;
        let (width, height) = (self.width as u32, self.height as u32);
        unsafe {
            match self.stage {
                MapStage::Labs => {
                    let (end, full) = chunk(self.cursor, 1024, count);
                    labs_chunk(&self.rgba, &mut self.labs, self.cursor, end);
                    self.cursor = end;
                    if end == count { self.stage = MapStage::Membership; self.cursor = 0; }
                    if full { YIELD } else { GO_ON }
                }
                MapStage::Membership => {
                    let (end, full) = chunk(self.cursor, 1024, count);
                    let (target, tolerance, _) = self.layers[self.layer];
                    if relief_color_mask_pixels(self.labs.as_ptr(), self.alpha.as_ptr(), self.membership[self.cursor..].as_mut_ptr(),
                        count, self.cursor, end, target[0], target[1], target[2], tolerance) != 1 { return -1; }
                    self.cursor = end;
                    if end == count { self.stage = MapStage::Hard; self.cursor = 0; }
                    if full { YIELD } else { GO_ON }
                }
                MapStage::Hard => {
                    let (end, full) = chunk(self.cursor, 4096, count);
                    if relief_membership_pixels(self.membership.as_ptr(), self.hard.as_mut_ptr(), count as u32, self.cursor as u32, end as u32) != 1 { return -1; }
                    self.cursor = end;
                    if end == count { self.stage = MapStage::Init; self.cursor = 0; }
                    if full { YIELD } else { GO_ON }
                }
                MapStage::Init => {
                    let (end, full) = chunk(self.cursor, 8192, count);
                    if relief_distance_init(self.hard.as_ptr(), self.distance.as_mut_ptr(), count as u32, self.cursor as u32, end as u32) != 1 { return -1; }
                    self.cursor = end;
                    if end == count { self.stage = MapStage::Forward; self.cursor = 0; }
                    if full && end < count { YIELD } else { GO_ON }
                }
                MapStage::Forward => {
                    let (end, full) = chunk(self.cursor, 16, self.height);
                    if relief_distance_rows(self.distance.as_mut_ptr(), width, height, self.cursor as u32, end as u32, 0) != 1 { return -1; }
                    self.cursor = end;
                    if end == self.height { self.stage = MapStage::Reverse; self.reverse_end = self.height; }
                    if full { YIELD } else { GO_ON }
                }
                MapStage::Reverse => {
                    let from = self.reverse_end.saturating_sub(16);
                    if relief_distance_rows(self.distance.as_mut_ptr(), width, height, from as u32, self.reverse_end as u32, 1) != 1 { return -1; }
                    self.reverse_end = from;
                    if from == 0 { self.stage = MapStage::Pigment; self.cursor = 0; }
                    YIELD
                }
                MapStage::Pigment => {
                    let (end, full) = chunk(self.cursor, 1024, count);
                    let bevel = (1.2f64).max(self.width.max(self.height) as f64 * 0.003);
                    let (owner, height_mm) = if self.single { (0u32, 0.0) } else { (self.layer as u32 + 1, self.layers[self.layer].2) };
                    let owners = if self.single { std::ptr::null_mut() } else { self.owners.as_mut_ptr() };
                    let heights = if self.single { std::ptr::null_mut() } else { self.heights.as_mut_ptr() };
                    let bytes = if self.single { self.height_bytes.as_mut_ptr() } else { std::ptr::null_mut() };
                    if relief_pigment_pixels(self.membership.as_ptr(), self.distance.as_ptr(), owners, self.mask.as_mut_ptr(), heights, bytes,
                        count as u32, self.cursor as u32, end as u32, bevel, height_mm, owner) != 1 { return -1; }
                    self.cursor = end;
                    if end == count {
                        self.layer += 1;
                        self.cursor = 0;
                        self.stage = if self.layer == self.layers.len() { MapStage::Done } else { MapStage::Membership };
                    }
                    if full { YIELD } else { GO_ON }
                }
                MapStage::Done => 0,
            }
        }
    }
    fn finished(&self) -> bool { matches!(self.stage, MapStage::Done) }
}

pub enum Job { Analysis(Box<Analysis>), Maps(Box<Maps>) }

fn shaped(rgba: *const u8, width: usize, height: usize) -> bool {
    LINEAR.get().is_some() && !rgba.is_null() && width > 0 && height > 0 && width.checked_mul(height).is_some_and(|n| n <= PIXEL_LIMIT)
}

/// A palette analysis of a cover raster.
/// # Safety
/// `rgba` points to width*height*4 readable bytes (copied here; no pointer is retained).
#[no_mangle]
pub unsafe extern "C" fn relief_analysis_new(rgba: *const u8, width: usize, height: usize) -> *mut Job {
    if !shaped(rgba, width, height) { return std::ptr::null_mut(); }
    let palette = relief_palette_new(width * height);
    if palette.is_null() { return std::ptr::null_mut(); }
    Box::into_raw(Box::new(Job::Analysis(Box::new(Analysis {
        width, height, rgba: std::slice::from_raw_parts(rgba, width * height * 4).to_vec(), palette, cursor: 0, stage: Stage::Pixels,
        bins: 0, bin_labs: Vec::new(), colours: Vec::new(), pixel_labs: Vec::new(), alpha: Vec::new(),
        masks: Vec::new(), current: 0, seed: 0.0, opaque: 0, support: 0,
    }))))
}

/// Pigment maps of the layers `[r, g, b, tolerance, height_mm]`; `single` builds the standalone byte map.
/// # Safety
/// `rgba` has width*height*4 readable bytes; `layers` has `count`*5 readable f64 values.
#[no_mangle]
pub unsafe extern "C" fn relief_maps_new(rgba: *const u8, width: usize, height: usize, layers: *const f64, count: usize, single: u32) -> *mut Job {
    if !shaped(rgba, width, height) || layers.is_null() || count == 0 || count > 10 || (single != 0 && count != 1) {
        return std::ptr::null_mut();
    }
    let mut parsed = Vec::with_capacity(count);
    for layer in std::slice::from_raw_parts(layers, count * 5).chunks(5) {
        if !layer.iter().all(|v| v.is_finite()) || layer[..3].iter().any(|v| *v < 0.0 || *v > 255.0 || v.fract() != 0.0)
            || layer[3] <= 0.0 || layer[3] > 12.0 || layer[4] < 0.0 { return std::ptr::null_mut(); }
        parsed.push((oklab(layer[0] as u8, layer[1] as u8, layer[2] as u8), layer[3], layer[4]));
    }
    let n = width * height;
    Box::into_raw(Box::new(Job::Maps(Box::new(Maps {
        width, height, rgba: std::slice::from_raw_parts(rgba, n * 4).to_vec(),
        alpha: std::slice::from_raw_parts(rgba, n * 4).chunks(4).map(|pixel| pixel[3]).collect(), labs: vec![0.0; n * 3], layers: parsed,
        single: single != 0, stage: MapStage::Labs, cursor: 0, layer: 0, membership: vec![0.0; n], hard: vec![0; n],
        distance: vec![0.0; n], owners: vec![0; n], mask: vec![0; n], heights: vec![0.0; n], height_bytes: vec![0; n], reverse_end: 0,
    }))))
}

/// 1: give the thread back, then call again; 2: call again at once; 0: finished; negative: the job failed.
/// # Safety
/// `job` comes from a `relief_*_new` call and has not been freed.
#[no_mangle]
pub unsafe extern "C" fn relief_job_step(job: *mut Job) -> i32 {
    match job.as_mut() {
        Some(Job::Analysis(a)) => if a.finished() { 0 } else { a.step() },
        Some(Job::Maps(m)) => if m.finished() { 0 } else { m.step() },
        None => -1,
    }
}

/// # Safety
/// `job` is null or comes from a `relief_*_new` call and is freed exactly once.
#[no_mangle]
pub unsafe extern "C" fn relief_job_free(job: *mut Job) { if !job.is_null() { drop(Box::from_raw(job)); } }

/// Analysis results: 0 seed, 1 opaque pixels, 2 colour count.
/// # Safety
/// `job` is a live job.
#[no_mangle]
pub unsafe extern "C" fn relief_analysis_value(job: *const Job, which: u32) -> f64 {
    let Some(Job::Analysis(a)) = job.as_ref() else { return -1.0 };
    if !a.finished() { return -1.0; }
    match which { 0 => a.seed, 1 => a.opaque as f64, 2 => a.colours.len() as f64, _ => -1.0 }
}

/// One colour as `[r, g, b, tolerance, positive pixels]`.
/// # Safety
/// `job` is live and `out` has 5 writable f64 values.
#[no_mangle]
pub unsafe extern "C" fn relief_analysis_colour(job: *const Job, index: usize, out: *mut f64) -> u32 {
    let Some(Job::Analysis(a)) = job.as_ref() else { return 0 };
    let Some(colour) = a.colours.get(index) else { return 0 };
    if out.is_null() || !a.finished() { return 0; }
    std::slice::from_raw_parts_mut(out, 5).copy_from_slice(&[colour.rgb[0] as f64, colour.rgb[1] as f64, colour.rgb[2] as f64, colour.tolerance, colour.pixels as f64]);
    1
}

/// The f32 membership plane of one analysed colour.
/// # Safety
/// `job` is live; the pointer is valid until the job is freed.
#[no_mangle]
pub unsafe extern "C" fn relief_analysis_mask(job: *const Job, index: usize) -> *const f32 {
    match job.as_ref() {
        Some(Job::Analysis(a)) if a.finished() => a.masks.get(index).map_or(std::ptr::null(), |m| m.as_ptr()),
        _ => std::ptr::null(),
    }
}

/// A finished map plane: 0 owners, 1 mask, 2 heights (f32), 3 height bytes.
/// # Safety
/// `job` is live; the pointer is valid until the job is freed.
#[no_mangle]
pub unsafe extern "C" fn relief_maps_plane(job: *const Job, which: u32) -> *const u8 {
    let Some(Job::Maps(m)) = job.as_ref() else { return std::ptr::null() };
    if !m.finished() { return std::ptr::null(); }
    match which { 0 => m.owners.as_ptr(), 1 => m.mask.as_ptr(), 2 => m.heights.as_ptr() as *const u8, 3 => m.height_bytes.as_ptr(), _ => std::ptr::null() }
}
