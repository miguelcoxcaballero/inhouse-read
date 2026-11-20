//! The poses of a book's motion: the numeric core's monotone Hermite sampler and its real-time clock
//! (rust-core/src/book_motion.rs, compiled into this module by `#[path]`), run in place for the motions of
//! book_view_motion.rs. A motion owns one prepared table and one clock from the moment it is opened until it is
//! closed; every frame is one sample here and one visit to the host, which makes the pose object.
use std::cell::RefCell;
use wasm_bindgen::prelude::*;
use crate::book_motion as kernel;

#[wasm_bindgen]
extern "C" {
    /// The view's host. `pose` makes the pose a frame draws: the eight components, and the page's theme when
    /// every keyframe says where it goes.
    pub type PoseHost;
    #[wasm_bindgen(method, structural, catch)]
    fn pose(this: &PoseHost, themed: bool, x: f64, y: f64, scale: f64, angle: f64, pitch: f64, roll: f64,
        cover_open: f64, bookmark_withdraw: f64, page_theme: f64) -> Result<JsValue, JsValue>;
    /// `Number(value)`, which throws for a symbol.
    #[wasm_bindgen(js_name = Number, catch)]
    fn number_of(value: &JsValue) -> Result<f64, JsValue>;
}

const KEYS: [&str; 9] = ["x", "y", "scale", "angle", "pitch", "roll", "coverOpen", "bookmarkWithdraw", "pageTheme"];
struct Sampler { table: Vec<f64>, count: usize, themed: bool, clock: [f64; 4], duration: f64 }
thread_local! { static OPEN: RefCell<Vec<Option<Sampler>>> = const { RefCell::new(Vec::new()) }; }

fn refused() -> JsValue {
    js_sys::RangeError::new("El movimiento del libro necesita entre 2 y 1024 fotogramas y el módulo numérico cargado.").into()
}
/// `Number(value ?? fallback)`.
fn numeric(value: JsValue, fallback: f64) -> Result<f64, JsValue> {
    if value.is_null_or_undefined() { return Ok(fallback); }
    match value.as_f64() { Some(number) => Ok(number), None => number_of(&value) }
}
/// The keyframes as the kernel reads them: per frame its offset (evenly spaced when it names none) and the nine
/// components (0 for one it leaves out; the theme only when every frame has one).
fn keyframes(frames: &JsValue) -> Result<(Vec<f64>, usize, bool), JsValue> {
    if !js_sys::Array::is_array(frames) { return Err(JsValue::NULL); }
    let list: &js_sys::Array = frames.unchecked_ref();
    let count = list.length() as usize;
    if !(2..=1024).contains(&count) { return Err(JsValue::NULL); }
    let mut themed = true;
    for index in 0..count {
        let transform = crate::host::read(&list.get(index as u32), "transform")?;
        if crate::host::read(&transform, "pageTheme")?.is_null_or_undefined() { themed = false; break; }
    }
    let mut source = vec![0.0; count * 10];
    for index in 0..count {
        let frame = list.get(index as u32);
        source[index * 10] = numeric(crate::host::read(&frame, "offset")?, index as f64 / (count - 1) as f64)?;
        let transform = crate::host::read(&frame, "transform")?;
        for (key, name) in KEYS.iter().enumerate() {
            if key == 8 && !themed { continue; }
            source[index * 10 + key + 1] = numeric(crate::host::read(&transform, name)?, 0.0)?;
        }
    }
    Ok((source, count, themed))
}

/// Prepare a motion from its keyframes: its number, or the original refusal (fewer than 2 or more than 1024
/// frames, or keyframes that cannot be read).
pub fn open(frames: &JsValue) -> Result<u32, JsValue> {
    let (source, count, themed) = keyframes(frames).map_err(|_| refused())?;
    let mut table = vec![0.0; count * 19];
    if unsafe { kernel::book_motion_prepare(source.as_ptr(), count, table.as_mut_ptr()) } != 1 { return Err(refused()); }
    let sampler = Sampler { table, count, themed, clock: [0.0; 4], duration: 0.0 };
    Ok(OPEN.with(|open| {
        let mut open = open.borrow_mut();
        let slot = match open.iter().position(Option::is_none) { Some(slot) => slot, None => { open.push(None); open.len() - 1 } };
        open[slot] = Some(sampler);
        slot as u32 + 1
    }))
}
fn with<T>(id: u32, run: impl FnOnce(&mut Sampler) -> T) -> Option<T> {
    OPEN.with(|open| open.borrow_mut().get_mut((id as usize).wrapping_sub(1)).and_then(Option::as_mut).map(run))
}
/// The pose at `progress`, made by the host; undefined for a motion already closed.
pub fn pose(id: u32, progress: f64, host: &JsValue) -> Result<JsValue, JsValue> {
    let Some((v, themed)) = with(id, |sampler| {
        let mut v = [0.0; 9];
        unsafe { kernel::book_motion_sample(sampler.table.as_ptr(), sampler.count, progress, v.as_mut_ptr()); }
        (v, sampler.themed)
    }) else { return Ok(JsValue::UNDEFINED) };
    host.unchecked_ref::<PoseHost>().pose(themed, v[0], v[1], v[2], v[3], v[4], v[5], v[6], v[7], v[8])
}
/// Start the motion's clock: real time, so a slow device finishes each phase on schedule.
pub fn start(id: u32, milliseconds: f64, now: f64) {
    with(id, |sampler| { sampler.duration = milliseconds; unsafe { kernel::book_motion_clock_start(sampler.clock.as_mut_ptr(), milliseconds, now); } });
}
/// One frame of the clock: the motion's progress, 1 for a motion already closed.
/// The clock started again at `now`, with the same duration: the motion is back at its beginning.
pub fn restart(id: u32, now: f64) {
    with(id, |sampler| unsafe { kernel::book_motion_clock_start(sampler.clock.as_mut_ptr(), sampler.duration, now); });
}
pub fn step(id: u32, now: f64) -> f64 {
    with(id, |sampler| unsafe { kernel::book_motion_clock_step(sampler.clock.as_mut_ptr(), sampler.duration, now) }).unwrap_or(1.0)
}
pub fn close(id: u32) {
    OPEN.with(|open| if let Some(slot) = open.borrow_mut().get_mut((id as usize).wrapping_sub(1)) { *slot = None; });
}

// The same motion on its own, for whoever samples keyframes without a view (the differential tests).
#[wasm_bindgen]
pub fn book_sampler_open(frames: &JsValue) -> Result<u32, JsValue> { open(frames) }
#[wasm_bindgen]
pub fn book_sampler_pose(id: u32, progress: f64, host: &JsValue) -> Result<JsValue, JsValue> { pose(id, progress, host) }
#[wasm_bindgen]
pub fn book_sampler_start(id: u32, milliseconds: f64, now: f64) { start(id, milliseconds, now) }
#[wasm_bindgen]
pub fn book_sampler_step(id: u32, now: f64) -> f64 { step(id, now) }
#[wasm_bindgen]
pub fn book_sampler_close(id: u32) { close(id) }
/// How many motions are open (diagnostics: every motion a view starts is closed when it ends).
#[wasm_bindgen]
pub fn book_samplers_open() -> u32 { OPEN.with(|open| open.borrow().iter().flatten().count() as u32) }
