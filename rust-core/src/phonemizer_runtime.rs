//! Lifetime policy for the bounded espeak heap; host owns Emscripten/FS handles.
use std::collections::HashSet;

pub struct Phonemizer {
    calls: f64,
    limit: f64,
    generation: f64,
    alive: bool,
    ready: bool,
    retried: bool,
    downloaded: HashSet<u32>,
    written: HashSet<u32>,
}

#[no_mangle]
pub extern "C" fn phonemizer_runtime_new(limit: f64) -> *mut Phonemizer {
    Box::into_raw(Box::new(Phonemizer {
        calls: 0.0, limit, generation: 0.0, alive: true, ready: false, retried: false,
        downloaded: HashSet::new(), written: HashSet::new(),
    }))
}

#[no_mangle]
pub unsafe extern "C" fn phonemizer_runtime_free(state: *mut Phonemizer) {
    if !state.is_null() { drop(Box::from_raw(state)); }
}

/// -1 released; 0 reuse; 1 rebuild. A job gets at most one failure recovery.
#[no_mangle]
pub unsafe extern "C" fn phonemizer_runtime_begin(state: *mut Phonemizer) -> i32 {
    let Some(state) = state.as_mut() else { return -1 };
    if !state.alive { return -1; }
    state.retried = false;
    (!state.ready || state.calls >= state.limit) as i32
}

#[no_mangle]
pub unsafe extern "C" fn phonemizer_runtime_build(state: *mut Phonemizer) -> f64 {
    let Some(state) = state.as_mut() else { return f64::NAN };
    if !state.alive { return f64::NAN; }
    state.generation += 1.0;
    state.ready = false;
    state.calls = 0.0;
    state.written.clear();
    state.generation
}

#[no_mangle]
pub unsafe extern "C" fn phonemizer_runtime_current(state: *const Phonemizer, generation: f64) -> u32 {
    state.as_ref().is_some_and(|state| state.alive && state.generation == generation) as u32
}

#[no_mangle]
pub unsafe extern "C" fn phonemizer_runtime_accept(state: *mut Phonemizer, generation: f64) -> u32 {
    let Some(state) = state.as_mut() else { return 0 };
    if !state.alive || state.generation != generation { return 0; }
    state.ready = true;
    1
}

#[no_mangle]
pub unsafe extern "C" fn phonemizer_runtime_attempt(state: *mut Phonemizer) -> u32 {
    let Some(state) = state.as_mut() else { return 0 };
    if !state.alive || !state.ready { return 0; }
    state.calls += 1.0;
    1
}

#[no_mangle]
pub unsafe extern "C" fn phonemizer_runtime_retry(state: *mut Phonemizer) -> u32 {
    let Some(state) = state.as_mut() else { return 0 };
    if !state.alive || state.retried { return 0; }
    state.retried = true;
    state.ready = false;
    1
}

/// Lookup: 0 installed, 1 fetch, 2 write cached bytes, -1 released.
/// Operation 1 records retained bytes; 2 records a file in this heap.
#[no_mangle]
pub unsafe extern "C" fn phonemizer_runtime_dictionary(state: *mut Phonemizer, id: u32, operation: u32) -> i32 {
    let Some(state) = state.as_mut() else { return -1 };
    if !state.alive { return -1; }
    match operation {
        1 => { state.downloaded.insert(id); }
        2 => { state.written.insert(id); }
        _ => {}
    }
    if state.written.contains(&id) { 0 } else if state.downloaded.contains(&id) { 2 } else { 1 }
}

#[no_mangle]
pub unsafe extern "C" fn phonemizer_runtime_close(state: *mut Phonemizer) {
    if let Some(state) = state.as_mut() {
        state.alive = false;
        state.ready = false;
        state.generation += 1.0;
        state.written.clear();
        state.downloaded.clear();
    }
}
