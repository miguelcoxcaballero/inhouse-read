//! The synthesis worker after its start-up (worker.js keeps the start-up: the routing before a voice module exists, the
//! dynamic import of ONNX Runtime and the creation of the phonemizer). Here: the release of a voice, the loading of
//! one (Piper with its phonemizer and, for Hebrew, Nakdimon; or the Supertonic pack), the queue of synthesis jobs and
//! each job: a Supertonic utterance in one piece, or a Piper fragment phonemized, its page boundaries placed, cut into
//! sentences, each run on the model, finished and posted as soon as it is ready, with the cancellation checks between
//! every step. The kernels (scales, sentence split, cleaning, rests, tempo, duration output) are called here on Rust
//! values, never through JavaScript. `w` is the worker's state object (worker.js `host`): the plan, the messages and
//! the three factories the tests replace stay JavaScript, and so does the state itself, which the garbage collector
//! owns; nothing here outlives a call except the futures it started.
//!
//! Every wait is where the JavaScript had one: a call of what was an `async function` continues one microtask after
//! its body ended (`called`), exactly as `await f()` did.
//!
//!   page -> worker
//!     {type:'init',  id, ortBase, phonBase}                   load onnxruntime-web (files of OUR site) and the phonemizer
//!     {type:'load',  id, voice, config, model|buffers, phonemizerModel?} create sessions from cached bytes
//!     {type:'synth', id, text, rate, speaker, lang?, style?}  speak `text`: replies with plan + chunks (below), queued FIFO
//!     {type:'cancel', id}                                     forget a queued/running synth (a running segment finishes first)
//!     {type:'free'}                                           release the session
//!   worker -> page
//!     {type:'ready'|'loaded'|'freed', id, ...}                answers to init / load / free
//!     {type:'plan',  id, counts:[phoneme ids per sentence]}   right after phonemising, so the page can predict durations
//!     {type:'chunk', id, index, last, pcm:Float32Array, sampleRate, ms}   one sentence of audio, ready to play (ms = compute time)
//!     {type:'end',   id}                                      synth finished
//!     {type:'error', id, error}                               anything that failed (the worker stays usable)
use std::future::Future;
use js_sys::{Array, Float32Array, Function, JsString, Object, Promise, Reflect};
use wasm_bindgen::prelude::*;
use crate::eager::eager;
use crate::quick_wait::{wait, Wait};
use std::{cell::RefCell, collections::HashMap};
use crate::host::{absent, boxed, call, get_at, jmax, js_round, num, text_value};
use crate::voice_kernels::{voice_host_expose_durations, voice_host_finish_piper, voice_host_finish_supertonic, voice_host_phoneme_marks, voice_host_piper_scales, voice_host_split_segments};

type R<T = JsValue> = Result<T, JsValue>;
// The realm's own names, as the worker's JavaScript wrote them. Not properties of `js_sys::global()`: that is `self`
// first, and the unit tests give the worker a `self` of their own.
#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(thread_local_v2, js_name = BigInt)]
    static BIG_INT: JsValue;
    #[wasm_bindgen(thread_local_v2, js_name = BigInt64Array)]
    static LONGS: JsValue;
    #[wasm_bindgen(thread_local_v2, js_name = Float32Array)]
    static FLOATS: Function;
    #[wasm_bindgen(thread_local_v2, js_name = Uint8Array)]
    static BYTES: Function;
    /// `performance.now()` of the worker.
    #[wasm_bindgen(js_namespace = performance, js_name = now, catch)]
    fn clock() -> R<f64>;
    // What a sentence asks of the worker's state again and again, as calls with plain numbers: no value to make for the
    // call and none to drop after it.
    type Host;
    #[wasm_bindgen(method, catch, js_name = stage)]
    fn host_stage(this: &Host, domain: f64, stage: f64, id: &JsValue, part: f64) -> R<()>;
    #[wasm_bindgen(method, catch, js_name = post)]
    fn host_post(this: &Host, message: &JsValue, transfer: &JsValue) -> R<()>;
    type Plan;
    #[wasm_bindgen(method, catch, js_name = workerActive)]
    fn worker_active(this: &Plan, id: &JsValue) -> R<bool>;
    /// A plain object being filled in.
    type Fields;
    #[wasm_bindgen(method, setter)]
    fn set_index(this: &Fields, value: f64);
    #[wasm_bindgen(method, setter)]
    fn set_ms(this: &Fields, value: f64);
    #[wasm_bindgen(method, setter)]
    fn set_base(this: &Fields, value: f64);
    #[wasm_bindgen(method, setter)]
    fn set_last(this: &Fields, value: bool);
    #[wasm_bindgen(method, setter)]
    fn set_first(this: &Fields, value: bool);
}
fn construct(class: &'static wasm_bindgen::JsThreadLocal<Function>, value: &JsValue) -> R { Reflect::construct(&class.with(Function::clone), &Array::of1(value)) }
// A job reads and writes a few dozen named properties per sentence. Each name is made a JavaScript string once and
// kept: making it again on every use cost more than the property access itself.
thread_local! { static KEYS: RefCell<HashMap<&'static str, &'static JsValue>> = RefCell::new(HashMap::new()); }
/// The JavaScript string of a name this file uses (a fixed, small set: each is kept for the life of the worker).
fn text(name: &'static str) -> &'static JsValue { KEYS.with(|keys| *keys.borrow_mut().entry(name).or_insert_with(|| Box::leak(Box::new(JsValue::from_str(name))))) }
fn keyed<T>(name: &'static str, with: impl FnOnce(&JsValue) -> T) -> T { with(text(name)) }
/// `value.key`, undefined where the engine would fail.
fn get(value: &JsValue, key: &'static str) -> JsValue { if absent(value) { return JsValue::UNDEFINED; } keyed(key, |key| Reflect::get(&boxed(value), key).unwrap_or(JsValue::UNDEFINED)) }
/// `value.key`, failing like the engine for null/undefined or a failing getter.
fn read(value: &JsValue, key: &'static str) -> R { keyed(key, |key| at(value, key)) }
fn set(value: &JsValue, key: &'static str, next: &JsValue) -> R<()> { keyed(key, |key| Reflect::set(value, key, next))?; Ok(()) }
/// `target.name(...args)`, failing like a missing method.
fn method(target: &JsValue, name: &'static str, args: &[&JsValue]) -> R {
    let function = read(target, name)?;
    let Some(function) = function.dyn_ref::<Function>() else { return Err(js_sys::TypeError::new(&format!("{name} is not a function")).into()) };
    match args {
        [] => function.call0(target), [a] => function.call1(target, a), [a, b] => function.call2(target, a, b), [a, b, c] => function.call3(target, a, b, c),
        _ => function.apply(target, &args.iter().copied().collect::<Array>()),
    }
}
fn error(message: &str) -> JsValue { js_sys::Error::new(message).into() }
fn n(value: f64) -> JsValue { JsValue::from_f64(value) }
fn record(pairs: &[(&'static str, &JsValue)]) -> R { let o = Object::new(); for (key, value) in pairs { set(&o, key, value)?; } Ok(o.into()) }
/// `await value`.
fn settled(value: JsValue) -> Wait { wait(&value) }
/// `await f(...)` of an `async function`: its body, then the microtask its promise took to hand the answer (or the
/// failure) back.
async fn called<T>(body: impl Future<Output = R<T>>) -> R<T> { let answer = body.await; settled(JsValue::UNDEFINED).await?; answer }
/// `value[key]` for any key, failing like the engine on null or undefined.
fn at(value: &JsValue, key: &JsValue) -> R {
    if absent(value) { return Err(js_sys::TypeError::new(&format!("Cannot read properties of {} (reading '{}')", if value.is_null() { "null" } else { "undefined" }, text_value(key).as_string().unwrap_or_default())).into()); }
    Reflect::get(&boxed(value), key)
}
/// `new Float32Array(Math.max(0, Math.round(sampleRate * ms / 1000)))`.
fn silence(sample_rate: &JsValue, ms: f64) -> R { construct(&FLOATS, &n(jmax(0.0, js_round(num(sample_rate) * ms / 1000.0)))) }
/// `new Float32Array(data)` as numbers: the copy out of the tensor, whose buffer lives in ONNX Runtime's heap.
fn samples(data: &JsValue) -> R<Vec<f32>> { Ok(match data.dyn_ref::<Float32Array>() { Some(data) => data.to_vec(), None => construct(&FLOATS, data)?.unchecked_into::<Float32Array>().to_vec() }) }
/// `String(error?.stack || error)`.
fn failure(error: &JsValue) -> JsValue { let stack = get(error, "stack"); text_value(if stack.is_truthy() { &stack } else { error }) }
fn truthy(w: &JsValue, key: &'static str) -> bool { get(w, key).is_truthy() }
/// `[...text].length`: code points, a lone surrogate counting as one.
fn points(value: &JsValue) -> f64 {
    let Some(value) = value.dyn_ref::<JsString>() else { return f64::from(Array::from(value).length()) };
    let units: Vec<u16> = value.iter().collect();
    let pairs = units.windows(2).filter(|pair| (0xd800..=0xdbff).contains(&pair[0]) && (0xdc00..=0xdfff).contains(&pair[1])).count();
    // Overlapping windows never pair one unit twice: a low surrogate cannot start a pair.
    (units.len() - pairs) as f64
}
/// `stage(domain, stage, id)`: a receipt for the native diagnostic bridge, posted only when it asked for them.
fn stage(w: &JsValue, domain: f64, stage: f64, id: &JsValue, part: Option<f64>) -> R<()> { w.unchecked_ref::<Host>().host_stage(domain, stage, id, part.unwrap_or(0.0)) }
/// `post(message, transfer = [])`.
fn post(w: &JsValue, message: &JsValue, transfer: Option<&JsValue>) -> R<()> {
    match transfer {
        Some(buffer) => w.unchecked_ref::<Host>().host_post(message, &Array::of1(buffer)),
        None => w.unchecked_ref::<Host>().host_post(message, &JsValue::UNDEFINED),
    }
}
/// `() => plan.workerActive(id)`.
fn active_for(plan: &JsValue, id: &JsValue) -> R { Ok(read(plan, "workerActive")?.dyn_into::<Function>().map_err(|_| JsValue::from(js_sys::TypeError::new("plan.workerActive is not a function")))?.bind1(plan, id).into()) }

struct Worker { w: JsValue, plan: JsValue, id: JsValue }
impl Worker {
    /// `performance.now()` of the worker.
    fn now(&self) -> R<f64> { clock() }
    fn active(&self) -> R<bool> { self.plan.unchecked_ref::<Plan>().worker_active(&self.id) }
    fn stage(&self, domain: f64, step: f64, part: Option<f64>) -> R<()> { stage(&self.w, domain, step, &self.id, part) }
    fn post(&self, message: &JsValue, transfer: Option<&JsValue>) -> R<()> { post(&self.w, message, transfer) }
    fn plan_message(&self, counts: &Array) -> R<()> { self.post(&record(&[("type", text("plan")), ("id", &self.id), ("counts", &counts.clone().into())])?, None) }
    /// The short rest of a fragment with nothing speakable (an ornament, "..."): the reading keeps flowing.
    fn rest(&self, sample_rate: &JsValue, ms: f64) -> R<()> {
        let pcm = silence(sample_rate, 120.0)?;
        let message = record(&[("type", text("chunk")), ("id", &self.id), ("index", &n(0.0)), ("last", &JsValue::TRUE), ("pcm", &pcm),
            ("sampleRate", sample_rate), ("ms", &n(ms))])?;
        self.post(&message, Some(&get(&pcm, "buffer")))
    }
}

async fn supertonic(job: &Worker, runtime: JsValue, value: JsValue, request: [JsValue; 4]) -> R<()> {
    let [rate, lang, style, marks] = request;
    job.plan_message(&Array::of1(&n(1f64.max(points(&value)))))?;
    let started = job.now()?;
    job.stage(3.0, 3.0, None)?;
    let options = record(&[("lang", &lang), ("style", &style), ("rate", &rate), ("marks", &marks), ("isActive", &active_for(&job.plan, &job.id)?)])?;
    let answer = settled(method(&runtime, "synthesize", &[&value, &options])?).await?;
    let (raw, sample_rate) = (read(&answer, "pcm")?, read(&answer, "sampleRate")?);
    let timeline = { let marks = read(&answer, "marks")?; if marks.is_undefined() { Array::new().into() } else { marks } };
    job.stage(3.0, 4.0, None)?;
    if !job.active()? { return Ok(()); }
    if !raw.is_instance_of::<Float32Array>() || !sample_rate.gt(&n(0.0)) { return Err(error("invalid Supertonic audio")); }
    // The SDK deliberately returns no samples when normalization removes all speakable text (for example an ornament).
    // Keep Piper's short-rest policy.
    if num(&get(&raw, "length")) == 0.0 { return job.rest(&sample_rate, job.now()? - started); }
    let done = voice_host_finish_supertonic(raw.unchecked_ref::<Float32Array>().to_vec(), value, timeline, record(&[("sampleRate", &sample_rate), ("rate", &rate)])?)?;
    if !done.is_truthy() { return Err(error("invalid Supertonic audio")); } // a sample that is not a number
    let pcm = read(&done, "pcm")?;
    let message = record(&[("type", text("chunk")), ("id", &job.id), ("index", &n(0.0)), ("last", &JsValue::TRUE), ("pcm", &pcm),
        ("sampleRate", &sample_rate), ("ms", &n(job.now()? - started)), ("marks", &read(&done, "marks")?)])?;
    // Inference already yields between its steps. This fragment is complete: 'end' follows at once so the page can
    // request its next prefetched fragment.
    job.post(&message, Some(&read(&pcm, "buffer")?))
}

/// One Piper run of a sentence's phoneme ids: the model's audio and, when the model exposes them, its phoneme durations.
/// Both leave ONNX Runtime's heap as one copy straight into this module.
async fn run_segment(w: &JsValue, ids: &JsValue, rate: &JsValue, speaker: &JsValue) -> R<(Vec<f32>, Option<Vec<f32>>)> {
    let inference = { let inference = read(&get(w, "config"), "inference")?; if inference.is_truthy() { inference } else { Object::new().into() } };
    let scales = voice_host_piper_scales(inference, rate.clone())?;
    let ort = get(w, "ort");
    let (int64, big, longs) = (text("int64"), BIG_INT.with(JsValue::clone), LONGS.with(JsValue::clone));
    let tensor = |kind: &JsValue, data: &JsValue, dims: &[f64]| -> R {
        let dims = dims.iter().map(|&value| n(value)).collect::<Array>();
        Ok(Reflect::construct(read(&ort, "Tensor")?.unchecked_ref(), &Array::of3(kind, data, &dims))?.into())
    };
    let one = |value: &JsValue| -> R { let cell = Array::of1(&call(&big, "BigInt", &[value])?); method(&longs, "from", &[&cell.into()]) };
    let feeds: JsValue = Object::new().into();
    let length = read(ids, "length")?;
    set(&feeds, "input", &tensor(&int64, &method(&longs, "from", &[ids, &big])?, &[1.0, num(&length)])?)?;
    set(&feeds, "input_lengths", &tensor(&int64, &one(&length)?, &[1.0])?)?;
    set(&feeds, "scales", &tensor(text("float32"), &scales.into(), &[3.0])?)?;
    if method(&read(&get(w, "session"), "inputNames")?, "includes", &[text("sid")])?.is_truthy() {
        set(&feeds, "sid", &tensor(&int64, &one(&if speaker.is_truthy() { speaker.clone() } else { n(0.0) })?, &[1.0])?)?;
    }
    let out = settled(method(&get(w, "session"), "run", &[&feeds])?).await?;
    let output = at(&out, &read(&read(&get(w, "session"), "outputNames")?, "0")?)?;
    let pcm = samples(&read(&output, "data")?)?; // a copy: the tensor's buffer lives in the wasm heap
    let name = get(w, "durationOutput");
    let durations = if name.is_truthy() { let found = at(&out, &name)?; if found.is_truthy() { Some(samples(&read(&found, "data")?)?) } else { None } } else { None };
    for held in [&out, &feeds] {
        // value.dispose?.()
        for value in Object::values(held.unchecked_ref()).iter() { if let Some(dispose) = read(&value, "dispose")?.dyn_ref::<Function>() { dispose.call0(&value)?; } }
    }
    Ok((pcm, durations))
}

async fn piper(job: &Worker, value: JsValue, request: [JsValue; 4]) -> R<()> {
    let [rate, speaker, marks, _] = request;
    let w = &job.w;
    let sample_rate = read(&read(&read(w, "config")?, "audio")?, "sample_rate")?;
    job.stage(3.0, 1.0, None)?;
    let phonemize = get(w, "phonemize");
    let ids = settled(call(&phonemize, "phonemize", &[&value])?).await?;
    if !job.active()? { return Ok(()); }
    let points: JsValue = if get(w, "durationOutput").is_truthy() {
        settled(voice_host_phoneme_marks(value.clone(), marks, ids.clone(), phonemize.unchecked_into()).into()).await?
    } else { Array::new().into() };
    job.stage(3.0, 2.0, None)?;
    if !job.active()? { return Ok(()); }
    let segments: JsValue = voice_host_split_segments(ids)?.into();
    if num(&get(&segments, "length")) == 0.0 {
        job.plan_message(&Array::of1(&n(0.0)))?;
        return job.rest(&sample_rate, 0.0);
    }
    let counts = Array::from(&segments).iter().map(|ids| get(&ids, "length")).collect::<Array>();
    job.plan_message(&counts)?;
    let mut base = 0.0;
    let mut index = 0.0;
    while index < num(&get(&segments, "length")) {
        if !job.active()? { return Ok(()); }
        let started = job.now()?;
        job.stage(3.0, 3.0, Some(index))?;
        let segment = get_at(&segments, index as u32);
        let (raw, durations) = called(run_segment(w, &segment, &rate, &speaker)).await?;
        job.stage(3.0, 4.0, Some(index))?;
        if !job.active()? { return Ok(()); }
        let last = index == num(&get(&segments, "length")) - 1.0;
        let count = get(&segment, "length");
        // Cleaned, its page boundaries placed, sped up, and with its rests: sentences of one fragment are separated by a
        // rest at their start; the rest after the fragment comes with its last one (both shorten with the speaking rate).
        let options = record(&[("sampleRate", &sample_rate), ("model", &get(w, "voice")), ("rate", &rate)])?;
        { let fields = options.unchecked_ref::<Fields>(); fields.set_last(last); fields.set_first(index == 0.0); fields.set_base(base); }
        set(&options, "count", &count)?;
        let done = voice_host_finish_piper(raw, durations, points.clone(), value.clone(), options)?;
        base += num(&count);
        if !job.active()? { return Ok(()); }
        let pcm = read(&done, "pcm")?;
        let message = record(&[("type", text("chunk")), ("id", &job.id)])?;
        { let fields = message.unchecked_ref::<Fields>(); fields.set_index(index); fields.set_last(last); }
        set(&message, "pcm", &pcm)?; set(&message, "sampleRate", &sample_rate)?;
        message.unchecked_ref::<Fields>().set_ms(job.now()? - started);
        set(&message, "marks", &read(&done, "marks")?)?;
        job.post(&message, Some(&read(&pcm, "buffer")?))?;
        job.stage(3.0, 5.0, Some(index))?;
        // A segment of compute blocks this thread; yielding between segments lets 'cancel'/'load' messages in.
        settled(method(w, "yieldToMessages", &[])?).await?;
        job.stage(3.0, 6.0, Some(index))?;
        index += 1.0;
    }
    Ok(())
}

/// `synth(job)`: speaks `job.text` with the loaded voice, posting its plan and its chunks.
async fn synth(w: &JsValue, request: &JsValue) -> R<()> {
    // const { id, text, rate, speaker, lang, style, marks = [] } = job
    let id = read(request, "id")?;
    let value = read(request, "text")?;
    let rate = read(request, "rate")?;
    let speaker = read(request, "speaker")?;
    let lang = read(request, "lang")?;
    let style = read(request, "style")?;
    let marks = { let marks = read(request, "marks")?; if marks.is_undefined() { Array::new().into() } else { marks } };
    let job = Worker { plan: get(w, "plan"), w: w.clone(), id };
    let runtime = get(w, "supertonic");
    if runtime.is_truthy() { supertonic(&job, runtime, value, [rate, lang, style, marks]).await } else { piper(&job, value, [rate, speaker, marks, JsValue::UNDEFINED]).await }
}

/// Releases whatever voice is held: the Piper session, Nakdimon, the Supertonic sessions. A release that fails is over.
async fn release(w: &JsValue) -> R<()> {
    let (session, hebrew, runtime) = (get(w, "session"), get(w, "hebrew"), get(w, "supertonic"));
    for key in ["session", "hebrew", "supertonic", "config", "voice"] { set(w, key, &JsValue::NULL)?; }
    let (plan, quiet) = (get(w, "plan"), get(w, "noop"));
    if truthy(&plan, "pointer") { method(&plan, "model", &[&n(3.0)])?; }
    if session.is_truthy() { settled(method(&method(&session, "release", &[])?, "catch", &[&quiet])?).await?; }
    if hebrew.is_truthy() { settled(method(&method(&hebrew, "destroy", &[])?, "catch", &[&quiet])?).await?; }
    if runtime.is_truthy() { settled(method(&Promise::resolve(&method(&runtime, "dispose", &[])?).into(), "catch", &[&quiet])?).await?; }
    Ok(())
}

/// `while (plan.draining) await drainDone`: a cancelled synth finishes its segment first.
async fn drained(w: &JsValue) -> R<()> { while truthy(&get(w, "plan"), "draining") { settled(get(w, "drainDone")).await?; } Ok(()) }

/// Makes the message's voice the one held: `{createMs}` and, for Piper, the session's `inputs`.
async fn load(w: &JsValue, m: &JsValue) -> R {
    let (key, cfg, model, phonemizer_model, buffers) = (read(m, "voice")?, read(m, "config")?, read(m, "model")?, read(m, "phonemizerModel")?, read(m, "buffers")?);
    drained(w).await?;
    called(release(w)).await?;
    let (started, plan) = (clock()?, get(w, "plan"));
    let kind = num(&method(&plan, "classifyRuntime", &[&cfg])?);
    let held = async {
        let ort = get(w, "ort");
        if kind == 2.0 {
            let options = record(&[("ort", &ort), ("buffers", &buffers), ("config", &read(&cfg, "config")?), ("indexer", &read(&cfg, "indexer")?), ("styles", &read(&cfg, "styles")?)])?;
            set(w, "supertonic", &settled(method(w, "createSupertonicRuntime", &[&options])?).await?)?;
            return Ok(false);
        }
        if !truthy(w, "phonemizer") && kind != 1.0 { set(w, "phonemizer", &settled(method(w, "createPhonemizer", &[&record(&[("base", &get(w, "phonBase"))])?])?).await?)?; }
        if kind == 1.0 { set(w, "hebrew", &settled(method(w, "createHebrewPhonemizer", &[&record(&[("ort", &ort), ("model", &phonemizer_model), ("config", &cfg)])?])?).await?)?; }
        let aligned = voice_host_expose_durations(construct(&BYTES, &model)?)?;
        set(w, "durationOutput", &read(&aligned, "name")?)?;
        // Every fragment has another length, so the shapes change on each run. With the memory arena and the
        // memory-pattern planner on (ort's defaults) each new shape keeps its buffers and the WASM heap only grows: a
        // phone's WebView runs out of memory after a sentence or two and the worker dies. Off, buffers are freed after
        // every run (a little slower, flat memory).
        let options = record(&[("executionProviders", &Array::of1(text("wasm")).into()), ("graphOptimizationLevel", text("all")),
            ("enableCpuMemArena", &JsValue::FALSE), ("enableMemPattern", &JsValue::FALSE)])?;
        set(w, "session", &settled(method(&read(&ort, "InferenceSession")?, "create", &[&read(&aligned, "bytes")?, &options])?).await?)?;
        Ok(true)
    }.await;
    let piper = match held { Ok(piper) => piper, Err(error) => { called(release(w)).await?; return Err(error); } };
    set(w, "config", &cfg)?; set(w, "voice", &key)?; method(&plan, "model", &[&n(2.0), &key])?;
    let answer = record(&[("createMs", &n(clock()? - started))])?;
    if piper { set(&answer, "inputs", &read(&get(w, "session"), "inputNames")?)?; }
    Ok(answer)
}

/// The queue: every admitted job in order, each answered with 'end' or 'error' unless it was cancelled meanwhile.
async fn drain(w: JsValue) -> R {
    let mut finish = None;
    set(&w, "drainDone", &Promise::new(&mut |resolve, _| finish = Some(resolve)).into())?;
    let (plan, jobs) = (get(&w, "plan"), get(&w, "jobs"));
    let run = async {
        loop {
            let id = method(&plan, "take", &[])?;
            if id.as_f64().is_some_and(f64::is_nan) { return Ok(()); }
            let job = method(&jobs, "get", &[&id])?;
            method(&jobs, "delete", &[&id])?;
            if !method(&plan, "workerActive", &[&id])?.is_truthy() { continue; }
            let spoken: R<()> = async {
                if !truthy(&w, "session") && !truthy(&w, "supertonic") { return Err(error("no voice loaded")); }
                called(synth(&w, &job)).await?;
                stage(&w, 3.0, 7.0, &read(&job, "id")?, None)?;
                if method(&plan, "workerActive", &[&id])?.is_truthy() { post(&w, &record(&[("type", text("end")), ("id", &id)])?, None)?; }
                Ok(())
            }.await;
            if let Err(error) = spoken {
                if method(&plan, "workerActive", &[&id])?.is_truthy() { post(&w, &record(&[("type", text("error")), ("id", &id), ("error", &failure(&error))])?, None)?; }
            }
            method(&plan, "cancel", &[&id])?;
        }
    }.await;
    method(&plan, "stopDraining", &[])?;
    if let Some(finish) = finish { finish.call0(&JsValue::UNDEFINED)?; }
    run.map(|()| JsValue::UNDEFINED)
}

/// A 'synth' message: admits the job (a retransmitted id is never inferred twice) and starts the queue if it is idle.
#[wasm_bindgen]
pub fn voice_worker_enqueue(w: JsValue, m: JsValue) -> R<()> {
    let id = read(&m, "id")?;
    let action = num(&method(&get(&w, "plan"), "enqueue", &[&id])?);
    if action == 2.0 { return Err(error("invalid synthesis request id")); }
    if action == 3.0 { return Ok(()); }
    method(&get(&w, "jobs"), "set", &[&id, &m])?;
    if action == 1.0 { let _ = eager(drain(w)); }
    Ok(())
}

/// What a message does after the voice chain reached it, answered with `answer` or with the failure as an 'error'.
fn chained<F: Future<Output = R> + 'static>(w: JsValue, m: JsValue, answer: &'static str, step: impl FnOnce(JsValue, JsValue) -> F + 'static) -> Promise {
    eager(async move {
        let done: R<()> = async {
            let (host, message) = (w.clone(), m.clone());
            let next = Closure::once_into_js(move |_: JsValue| eager(step(host, message)));
            let running = method(&read(&w, "loadChain")?, "then", &[&next])?;
            set(&w, "loadChain", &method(&running, "catch", &[&get(&w, "noop")])?)?;
            let result = settled(running).await?;
            let reply = record(&[("type", &text(answer)), ("id", &read(&m, "id")?)])?;
            if result.is_object() { Object::assign(reply.unchecked_ref(), result.unchecked_ref()); }
            post(&w, &reply, None)
        }.await;
        if let Err(error) = done { post(&w, &record(&[("type", text("error")), ("id", &get(&m, "id")), ("error", &failure(&error))])?, None)?; }
        Ok(JsValue::UNDEFINED)
    })
}

/// A 'load' message, once the worker is initialized: loads follow each other, and 'loaded' carries what `load` answered.
#[wasm_bindgen]
pub fn voice_worker_load(w: JsValue, m: JsValue) -> Promise {
    chained(w, m, "loaded", |w, m| async move {
        let id = read(&m, "id")?;
        stage(&w, 2.0, 1.0, &id, None)?;
        let result = called(load(&w, &m)).await?;
        stage(&w, 2.0, 2.0, &read(&m, "id")?, None)?;
        Ok(result)
    })
}

/// A 'free' message: after the running job and any load, the voice is released and every queued job forgotten.
#[wasm_bindgen]
pub fn voice_worker_free(w: JsValue, m: JsValue) -> Promise {
    chained(w, m, "freed", |w, _| async move {
        drained(&w).await?;
        called(release(&w)).await?;
        method(&get(&w, "plan"), "invalidate", &[])?;
        method(&get(&w, "jobs"), "clear", &[])?;
        Ok(JsValue::UNDEFINED)
    })
}
