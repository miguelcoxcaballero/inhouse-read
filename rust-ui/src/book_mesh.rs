//! The meshes of a book whose plans need the engine's own `Math`: the page block, the stack of read leaves,
//! both endpapers, the curved binding and the ribbon. The kernels are the numeric core's own sources
//! (rust-core/src/{page_mesh,binding,bookmark}.rs, compiled into this module by `#[path]`), so a mesh is one
//! call from the host: the plan's stages run here and the sines, cosines, powers and lengths they ask for are
//! answered by the host's `Math` between them, one batch per round (host_math.rs): two crossings a mesh.
//!
//! A mesh is returned as one owned record of 32-bit words the host installs views of: eight header words
//! (vertices, indices, flags, indices of the first group, 0, 0, 0, words in the record), then position (3),
//! normal (3), uv (2) and, with `COLOURS`, colour (3) as f32, then the index as u16 (u32 with `WIDE`).
//! The ribbon runs every frame of a flight: its arenas are kept per section count and the host reads the
//! result in place through `book_mesh_memory`.
use std::cell::RefCell;
use std::collections::HashMap;
use js_sys::{Function, Reflect, Uint8Array, Uint8ClampedArray};
use wasm_bindgen::prelude::*;
use wasm_bindgen::JsCast;
use crate::{binding, bookmark, page_mesh};

const WIDE: u32 = 1;
const COLOURS: u32 = 2;
const NORMALS_CHANGED: u32 = 4;
const GROUPS: u32 = 8;
const HEAD: usize = 8;

#[wasm_bindgen]
extern "C" {
    /// The host's `Math` over this module's memory (host-math.js): `count` (operation, a, b) requests at byte
    /// `requests`, one answer each at byte `results`. One crossing per round, whatever it asks.
    pub type HostMath;
    #[wasm_bindgen(method, structural)]
    fn resolve(this: &HostMath, requests: u32, results: u32, count: u32);
}
/// A round of host Math. The host writes `results` through its own view of the memory.
fn resolve(math: &HostMath, requests: &[f64], results: &mut [f64], count: usize) {
    debug_assert!(requests.len() >= count * 3 && results.len() >= count);
    math.resolve(requests.as_ptr() as u32, results.as_mut_ptr() as u32, count as u32);
}

/// An empty record of `vertices` and `indices`; the kernels fill it through `floats` and `index`.
fn record(vertices: usize, indices: usize, flags: u32, first_group: usize, raw: bool) -> Vec<u32> {
    let floats = vertices * if flags & COLOURS != 0 { 11 } else { 8 };
    let words = HEAD + floats + if flags & WIDE != 0 { indices } else { indices.div_ceil(2) };
    let mut data: Vec<u32> = if raw {
        // The binding's kernel writes every array whole; only the header and the index's odd half word start as zeros.
        let mut data = Vec::with_capacity(words);
        unsafe { data.set_len(words); }
        data[..HEAD].fill(0); data[words - 1] = 0;
        data
    } else { vec![0; words] };
    data[0] = vertices as u32; data[1] = indices as u32; data[2] = flags; data[3] = first_group as u32; data[7] = words as u32;
    data
}
/// Where attribute `slot` (0 position, 1 normal, 2 uv, 3 colour, 4 index) of a record starts.
fn at(data: &mut [u32], slot: usize) -> *mut u32 {
    let vertices = data[0] as usize;
    let floats = [0, 3, 6, 8, if data[2] & COLOURS != 0 { 11 } else { 8 }][slot] * vertices;
    data[HEAD + floats..].as_mut_ptr()
}

type Stage = unsafe extern "C" fn(*const f64, *mut f64) -> u32;
type Second = unsafe extern "C" fn(*const f64, *const f64, *mut f64, *mut f64) -> u32;
type Finish = unsafe extern "C" fn(*const f64, *const f64, *mut f64, *mut f32, *mut f32, *mut f32, *mut f32, *mut u16);

/// A paper mesh planned in two rounds of host Math. `counts`: vertices, indices, coefficients, first and second requests.
fn paper_mesh(math: &HostMath, stages: (Stage, Second, Finish), params: &[f64; 6], counts: [usize; 5], first_group: usize) -> Vec<u32> {
    let [vertices, indices, coefficients, first, second] = counts;
    let mut asked = vec![0.0; first.max(second) * 3];
    let mut answered = vec![0.0; first.max(second)];
    let mut data = vec![0.0; coefficients];
    unsafe {
        let count = stages.0(params.as_ptr(), asked.as_mut_ptr()) as usize;
        if count == 0 { return Vec::new(); } // sizes the plan does not take
        resolve(math, &asked, &mut answered, count);
        // The second stage reads the first answers while it writes its own requests.
        let mut next = vec![0.0; second * 3];
        let count = stages.1(params.as_ptr(), answered.as_ptr(), data.as_mut_ptr(), next.as_mut_ptr()) as usize;
        let mut lengths = vec![0.0; second];
        resolve(math, &next, &mut lengths, count);
        let mut out = record(vertices, indices, COLOURS | GROUPS, first_group, false);
        stages.2(params.as_ptr(), lengths.as_ptr(), data.as_mut_ptr(), at(&mut out, 0).cast(), at(&mut out, 1).cast(),
            at(&mut out, 2).cast(), at(&mut out, 3).cast(), at(&mut out, 4).cast());
        out
    }
}

/// The text block of a rounded-and-backed binding (`pageBlockGeometry`); empty for sizes the plan does not take.
#[wasm_bindgen]
pub fn book_mesh_page_block(math: &HostMath, width: f64, height: f64, thickness: f64, board: f64, inset: f64, detail: bool) -> Vec<u32> {
    let (columns, rows) = if detail { (16, 6) } else { (8, 3) };
    let vertices = 2 * (columns + 1) * (rows + 1) + 2 * (columns + 1) + 8;
    let indices = columns * rows * 12 + columns * 6 + 12;
    paper_mesh(math, (page_mesh::page_block_plan_a, page_mesh::page_block_plan_b, page_mesh::page_block_finish),
        &[width, height, thickness, board, inset, if detail { 1.0 } else { 0.0 }],
        [vertices, indices, (columns + 1) * 3 + rows + 1, 1 + (columns + 1) + (rows + 1), columns + 1], indices)
}

/// The gathering of leaves already read (`leafStackGeometry`): the faces are group 0, the edges group 1.
#[wasm_bindgen]
pub fn book_mesh_leaf_stack(math: &HostMath, width: f64, height: f64, depth: f64, board: f64, inset: f64, columns: f64) -> Vec<u32> {
    if columns.fract() != 0.0 || !(1.0..=512.0).contains(&columns) { return Vec::new(); }
    let n = columns as usize;
    paper_mesh(math, (page_mesh::leaf_stack_plan_a, page_mesh::leaf_stack_plan_b, page_mesh::leaf_stack_finish),
        &[width, height, depth, board, inset, columns], [6 * (n + 1) + 4, n * 18 + 6, (n + 1) * 3, n + 1, n + 1], n * 6)
}

/// Both endpapers in one transfer: the pastedown's record, then the first page's.
#[wasm_bindgen]
pub fn book_mesh_paper_planes(paste_width: f64, paste_height: f64, page_width: f64, page_height: f64, inset: f64, overview: bool) -> Vec<u32> {
    let columns = if overview { 3 } else { 10 };
    let paste = (columns + 1) * 2;
    let (vertices, indices) = (paste + 6, columns * 6 + 12);
    let (mut positions, mut normals, mut uvs, mut colours) = (vec![0f32; vertices * 3], vec![0f32; vertices * 3], vec![0f32; vertices * 2], vec![0f32; vertices * 3]);
    let mut index = vec![0u16; indices];
    if unsafe { page_mesh::book_paper_planes(paste_width, paste_height, page_width, page_height, inset, overview as u32,
        positions.as_mut_ptr(), normals.as_mut_ptr(), uvs.as_mut_ptr(), colours.as_mut_ptr(), index.as_mut_ptr()) } == 0 { return Vec::new(); }
    let mut out = Vec::new();
    for (from, to, first, last) in [(0, paste, 0, columns * 6), (paste, vertices, columns * 6, indices)] {
        let mut part = record(to - from, last - first, COLOURS, 0, false);
        for (slot, source, size) in [(0, &positions, 3), (1, &normals, 3), (2, &uvs, 2), (3, &colours, 3)] {
            let target = at(&mut part, slot).cast::<f32>();
            unsafe { std::ptr::copy_nonoverlapping(source[from * size..].as_ptr(), target, (to - from) * size); }
        }
        unsafe { std::ptr::copy_nonoverlapping(index[first..].as_ptr(), at(&mut part, 4).cast::<u16>(), last - first); }
        out.extend_from_slice(&part);
    }
    out
}

/// Where `(u, v)` falls in the alpha channel of a spine's relief raster (the sampler the host hands to a binding).
#[wasm_bindgen]
pub fn book_mesh_relief_index(u: f64, v: f64, width: u32, height: u32) -> f64 { binding::binding_relief_index(u, v, width, height) }

/// The half-ellipse binding (`bindingGeometry`). `relief` is nothing, a sampler made by the host over a spine's
/// raster (its `pixels` are read here, once) or any `(u, v)` function, called for every vertex in mesh order.
/// Empty for sizes the plan does not take.
#[wasm_bindgen]
pub fn book_mesh_binding(math: &HostMath, width: f64, height: f64, thickness: f64, segments: f64, relief: &JsValue, relief_rows: f64) -> Result<Vec<u32>, JsValue> {
    let raised = !relief.is_falsy();
    let rows = if raised { relief_rows } else { 1.0 };
    let whole = |value: f64, most: f64| value.fract() == 0.0 && (1.0..=most).contains(&value);
    if ![width, height, thickness].iter().all(|value| value.is_finite() && *value > 0.0) || !whole(segments, 512.0) || !whole(rows, 1024.0)
        || (segments + 1.0) * (rows + 1.0) > 200_000.0 || raised && !relief.is_function() { return Ok(Vec::new()); }
    let (columns, lines) = (segments as usize, rows as usize);
    let vertices = (columns + 1) * (lines + 1);
    let params = [width, height, thickness, segments, rows];
    let mut asked = vec![0.0; (columns + 1) * 6];
    let mut answered = vec![0.0; (columns + 1) * 2];
    let mut data = vec![0.0; (columns + 1) * 5];
    let mut lengths = vec![0.0; columns + 1];
    unsafe {
        let count = binding::binding_plan_a(params.as_ptr(), asked.as_mut_ptr()) as usize;
        if count == 0 { return Ok(Vec::new()); }
        resolve(math, &asked, &mut answered, count);
        let count = binding::binding_plan_b(params.as_ptr(), answered.as_ptr(), data.as_mut_ptr(), asked.as_mut_ptr()) as usize;
        resolve(math, &asked, &mut lengths, count);
    }
    let mut samples = Vec::new();
    if raised {
        samples.resize(vertices, 0.0);
        let pixels = Reflect::get(relief, &JsValue::from_str("pixels"))?;
        let raster = if let Some(bytes) = pixels.dyn_ref::<Uint8Array>() { Some(bytes.to_vec()) }
            else { pixels.dyn_ref::<Uint8ClampedArray>().map(|bytes| bytes.to_vec()) };
        if let Some(raster) = raster {
            if raster.len() != 256 * 1024 * 4 || unsafe { binding::binding_sample_relief(raster.as_ptr(), 256, 1024, columns as u32, lines as u32, samples.as_mut_ptr()) } != 1 {
                return Err(js_sys::Error::new("Native binding relief rejected").into());
            }
        } else {
            // Any other sampler keeps its observable order and exact coordinates; it may call back into this module.
            let sample: &Function = relief.unchecked_ref();
            for i in 0..=columns { for j in 0..=lines {
                let value = sample.call2(&JsValue::UNDEFINED, &JsValue::from_f64(i as f64 / columns as f64), &JsValue::from_f64(j as f64 / lines as f64))?;
                samples[i * (lines + 1) + j] = value.unchecked_into_f64();
            } }
        }
    }
    let count = columns * lines * 6;
    // Three reserves index 65535 for primitive restart, so a mesh that reaches it uses u32.
    let wide = vertices - 1 >= 65535;
    let mut index: Vec<u32> = Vec::with_capacity(count);
    let mut out = record(vertices, count, if wide { WIDE } else { 0 } | if raised { NORMALS_CHANGED } else { 0 }, 0, true);
    unsafe {
        binding::binding_finish(params.as_ptr(), lengths.as_ptr(), data.as_mut_ptr(), if raised { samples.as_ptr() } else { std::ptr::null() },
            at(&mut out, 0).cast(), at(&mut out, 1).cast(), at(&mut out, 2).cast(), index.as_mut_ptr());
        index.set_len(count);
        if wide { std::ptr::copy_nonoverlapping(index.as_ptr(), at(&mut out, 4), count); }
        else { let narrow = at(&mut out, 4).cast::<u16>(); for (i, value) in index.iter().enumerate() { *narrow.add(i) = *value as u16; } }
    }
    Ok(out)
}

/// The arenas of a ribbon of one section count: nothing is allocated while it flies.
struct Ribbon { crowd: Vec<f64>, data: Vec<f64>, distances: Vec<f64>, asked: Vec<f64>, answered: Vec<f64>, turned: Vec<f64>, twist: Vec<f64>,
    positions: Vec<f32>, uvs: Vec<f32>, normals: Vec<f32>, indices: Vec<u16> }
impl Ribbon {
    fn new(math: &HostMath, steps: usize) -> Ribbon {
        let (count, asked) = (steps + 1, 1 + 7 * (steps + 1));
        let mut ribbon = Ribbon { crowd: vec![0.0; 64], data: vec![0.0; count * 7], distances: vec![0.0; count], asked: vec![0.0; asked * 3],
            answered: vec![0.0; asked], turned: vec![0.0; count * 6], twist: vec![0.0; count * 2],
            positions: vec![0.0; count * 12], uvs: vec![0.0; count * 8], normals: vec![0.0; count * 12], indices: vec![0; steps * 24 + 12] };
        unsafe {
            bookmark::bookmark_topology(ribbon.indices.as_mut_ptr(), steps);
            // The powers the crowding of the fold uses depend on the section count alone.
            let crowd = bookmark::bookmark_constants(steps, ribbon.asked.as_mut_ptr()) as usize;
            resolve(math, &ribbon.asked, &mut ribbon.crowd, crowd);
        }
        ribbon
    }
}
thread_local! {
    static RIBBONS: RefCell<HashMap<u32, Ribbon>> = RefCell::new(HashMap::new());
    /// What the last ribbon left for the host: vertices, then where its positions, uvs, normals and indices are, and how many indices.
    static LAST: RefCell<[u32; 6]> = const { RefCell::new([0; 6]) };
}

/// This module's memory, for the views the host answers its Math and reads a ribbon through.
#[wasm_bindgen]
pub fn book_mesh_memory() -> JsValue { wasm_bindgen::memory() }

/// The ribbon at one pose (`bookmarkGeometry`). Returns where six u32 describe the result (see `LAST`), 0 for
/// measures or a section count the plan does not take. The arrays are scratch: the next ribbon of that count rewrites them.
#[wasm_bindgen]
#[allow(clippy::too_many_arguments)]
pub fn book_mesh_ribbon(math: &HostMath, width: f64, height: f64, thickness: f64, progress: f64, peek: f64, open: f64, withdraw: f64, segments: f64, seed: f64, legacy: bool) -> u32 {
    let params = [width, height, thickness, progress, peek, open, withdraw, segments, seed];
    if !params.iter().enumerate().all(|(i, value)| i == 7 || value.is_finite()) || width <= 0.0 || height <= 0.0 || thickness <= 0.0 { return 0; }
    let steps = bookmark::bookmark_steps(segments);
    if steps == 0 { return 0; }
    RIBBONS.with(|ribbons| {
        let mut ribbons = ribbons.borrow_mut();
        let r = ribbons.entry(steps).or_insert_with(|| Ribbon::new(math, steps as usize));
        let (p, crowd) = (params.as_ptr(), r.crowd.as_ptr());
        unsafe {
            let asked = if legacy { bookmark::bookmark_plan_a(p, crowd, r.asked.as_mut_ptr()) } else { bookmark::bookmark_plan_a_refined(p, crowd, r.asked.as_mut_ptr()) } as usize;
            resolve(math, &r.asked, &mut r.answered, asked);
            let twisted = if legacy { bookmark::bookmark_plan_b(p, crowd, r.answered.as_ptr(), r.data.as_mut_ptr(), r.turned.as_mut_ptr()) }
                else { bookmark::bookmark_plan_b_refined(p, crowd, r.answered.as_ptr(), r.data.as_mut_ptr(), r.turned.as_mut_ptr()) } as usize;
            resolve(math, &r.turned, &mut r.twist, twisted);
            if legacy { bookmark::bookmark_finish(p, r.twist.as_ptr(), r.data.as_mut_ptr(), r.distances.as_mut_ptr(), r.positions.as_mut_ptr(), r.uvs.as_mut_ptr(), r.normals.as_mut_ptr(), r.indices.as_ptr()) }
            else { bookmark::bookmark_finish_refined(p, r.twist.as_ptr(), r.data.as_mut_ptr(), r.distances.as_mut_ptr(), r.positions.as_mut_ptr(), r.uvs.as_mut_ptr(), r.normals.as_mut_ptr(), r.indices.as_ptr()) }
        }
        LAST.with(|last| {
            let mut last = last.borrow_mut();
            *last = [steps + 1, r.positions.as_ptr() as u32, r.uvs.as_ptr() as u32, r.normals.as_ptr() as u32, r.indices.as_ptr() as u32, r.indices.len() as u32];
            last.as_ptr() as u32
        })
    })
}
