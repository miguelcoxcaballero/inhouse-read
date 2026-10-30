//! The Supertonic runtime of the synthesis worker and the Android client (supertonic-runtime.js): its four ONNX sessions
//! and style tensors, one utterance at a time cut into chunks, each chunk through the duration predictor, the text
//! encoder, the denoising steps and the vocoder, the page boundaries estimated from prefix/suffix durations, and the
//! joined, sped-up result. The numbers are the voice core's (supertonic_runtime.rs, supertonic_text.rs, through
//! voice_kernels.rs); ONNX Runtime, the random source with Math.log/Math.cos (supertonicNoise) and the tempo
//! (speedUpSpeech) are the host's, handed in as `kit`. Every `await` of an inner async function of the original is an
//! eager promise its caller awaits, so the microtasks between two boundaries are the original's.
use std::cell::{Cell, RefCell};
use std::future::Future;
use std::rc::Rc;
use js_sys::{Array, Float32Array, Function, JsString, Object, Promise, Reflect, Set};
use wasm_bindgen::prelude::*;
use wasm_bindgen::JsCast;
use crate::eager::{eager, settled};
use crate::host::{absent, call, get, get_at, method, method_opt, num, read, set, text_value};
use crate::supertonic_runtime as runtime;
use crate::supertonic_catalog as catalog;
use crate::voice_kernels as kernels;

type R<T = JsValue> = Result<T, JsValue>;
fn error(message: &str) -> JsValue { js_sys::Error::new(message).into() }
fn text(value: &str) -> JsValue { JsValue::from_str(value) }
fn n(value: f64) -> JsValue { JsValue::from_f64(value) }
fn string(value: &JsValue) -> String { String::from(text_value(value).unchecked_into::<JsString>()) }
/// `Object.assign(new Error('Lectura cancelada'), {name:'AbortError', code:'aborted'})`.
fn cancelled() -> JsValue {
    let error = error("Lectura cancelada");
    let _ = set(&error, "name", &text("AbortError"));
    let _ = set(&error, "code", &text("aborted"));
    error
}
fn record(pairs: &[(&str, &JsValue)]) -> R { let o = Object::new(); for (key, value) in pairs { set(&o, key, value)?; } Ok(o.into()) }
/// `await f()` of an async function `f` of the original: its body runs at once and the caller resumes one job after it
/// settled.
async fn awaited(body: impl Future<Output = R> + 'static) -> R { settled(eager(body).into()).await }
/// `t?.dispose?.()`, whatever it throws.
fn release_tensor(tensor: &JsValue) { let _ = method_opt(tensor, "dispose", &[]); }
/// `new ort.Tensor(type, data, dims)`.
fn tensor(ort: &JsValue, kind: &str, data: &JsValue, dims: &JsValue) -> R {
    let constructor = read(ort, "Tensor")?.dyn_into::<Function>().map_err(|_| JsValue::from(js_sys::TypeError::new("ort.Tensor is not a constructor")))?;
    Reflect::construct(&constructor, &Array::of3(&text(kind), data, dims))
}
fn shape(dims: &[f64]) -> JsValue { dims.iter().map(|&value| n(value)).collect::<Array>().into() }
/// `new Float32Array(length).fill(1)`.
fn ones(length: f64) -> R { let values = Float32Array::new(&n(length)); values.fill(1.0, 0, values.length()); Ok(values.into()) }
fn values_of(object: &JsValue) -> R<Array> {
    if absent(object) { return Err(js_sys::TypeError::new("Cannot convert undefined or null to object").into()); }
    Ok(Object::values(&Object::from(object.clone())))
}
fn length(value: &JsValue) -> f64 { num(&get(value, "length")) }

struct Inner {
    ort: JsValue,
    kit: JsValue,
    indexer: JsValue,
    random: JsValue,
    yield_to_messages: JsValue,
    steps: f64,
    sample_rate: f64,
    chunk_size: f64,
    latent_dim: f64,
    sessions: JsValue,
    style_tensors: JsValue,
    state: Cell<*mut runtime::RuntimeState>,
    running: RefCell<JsValue>,
}
impl Drop for Inner { fn drop(&mut self) { unsafe { runtime::supertonic_state_free(self.state.replace(std::ptr::null_mut())) } } }
type Shared = Rc<Inner>;

impl Inner {
    fn active(&self) -> bool { unsafe { runtime::supertonic_state_active(self.state.get()) != 0 } }
    /// `normalizeSupertonicText`: `<es>text.</es>` for the model, or '' when nothing speakable is left.
    fn normalize(&self, value: &JsValue, lang: &JsValue) -> R<JsString> { normalize(&self.kit, value, lang) }
    fn style(&self, style: &JsValue) -> R { Reflect::get(&self.style_tensors, style) }
}
/// `SUPERTONIC_LANGUAGES.includes(lang)`.
fn is_language(lang: &JsValue) -> bool { lang.as_string().is_some_and(|lang| catalog::is_language(&lang)) }
fn normalize(_kit: &JsValue, value: &JsValue, lang: &JsValue) -> R<JsString> {
    if !is_language(lang) {
        return Err(error(&format!("Idioma Supertonic no disponible: {}", string(lang))));
    }
    let source = if value.is_truthy() { text_value(value) } else { text("") };
    kernels::voice_host_supertonic_normalize(source.unchecked_into::<JsString>().normalize("NFKD").into(), lang.clone())
}
/// `normalizeSupertonicText(text, lang)` (the export of supertonic-runtime.js).
#[wasm_bindgen]
pub fn voice_supertonic_normalize(text: JsValue, lang: JsValue, kit: JsValue) -> R<JsString> { normalize(&kit, &text, &lang) }

/// `!state.active() || !isActive()` is the cancellation.
fn check(inner: &Inner, active: &JsValue) -> R<()> {
    if !inner.active() || !call(active, "isActive", &[])?.is_truthy() { return Err(cancelled()); }
    Ok(())
}
/// One session run between two checks; its outputs join the tensors this chunk releases.
async fn run(inner: Shared, active: JsValue, live: Set, name: &'static str, feeds: JsValue) -> R {
    check(&inner, &active)?;
    let output = settled(method(&get(&inner.sessions, name), "run", &[&feeds])?).await?;
    for value in values_of(&output)?.iter() { live.add(&value); }
    check(&inner, &active)?;
    Ok(output)
}
/// Lets 'cancel'/'load' messages in, then checks.
async fn checkpoint(inner: Shared, active: JsValue) -> R {
    settled(call(&inner.yield_to_messages, "yieldToMessages", &[])?).await?;
    check(&inner, &active)?;
    Ok(JsValue::UNDEFINED)
}
/// `drop(t)`: a tensor of this chunk is released as soon as it is no longer needed.
fn drop_tensor(live: &Set, value: &JsValue) { if live.delete(value) { release_tensor(value); } }
fn own(live: &Set, value: JsValue) -> JsValue { live.add(&value); value }

/// The prefix/suffix duration of `value`, 0 when nothing speakable is left or the model says nothing usable.
async fn predict(inner: Shared, lang: JsValue, selected: JsValue, active: JsValue, live: Set, value: JsValue) -> R {
    let normalized = inner.normalize(&value, &lang)?;
    if normalized.length() == 0 { return Ok(n(0.0)); }
    let values: JsValue = kernels::voice_host_supertonic_ids(normalized.into(), inner.indexer.clone())?.into();
    let count = length(&values);
    let ids = own(&live, tensor(&inner.ort, "int64", &values, &shape(&[1.0, count]))?);
    let mask = own(&live, tensor(&inner.ort, "float32", &ones(count)?, &shape(&[1.0, 1.0, count]))?);
    let feeds = record(&[("text_ids", &ids), ("style_dp", &get(&selected, "dp")), ("text_mask", &mask)])?;
    let result = awaited(run(inner.clone(), active, live.clone(), "duration_predictor", feeds)).await?;
    let output = get(&result, "duration");
    let duration = num(&get_at(&get(&output, "data"), 0));
    drop_tensor(&live, &ids); drop_tensor(&live, &mask); drop_tensor(&live, &output);
    Ok(n(if duration.is_finite() && duration > 0.0 { duration } else { 0.0 }))
}

/// One chunk of the utterance: `[pcm, timeline]`, the audio at normal speed and its estimated page boundaries.
async fn infer(inner: Shared, value: JsValue, lang: JsValue, style: JsValue, rate: JsValue, active: JsValue, marks: JsValue) -> R {
    let live = Set::new(&JsValue::UNDEFINED);
    let result = infer_owned(inner, value, lang, style, rate, active, marks, live.clone()).await;
    for tensor in live.values().into_iter().flatten() { release_tensor(&tensor); }
    result
}
#[allow(clippy::too_many_arguments)]
async fn infer_owned(inner: Shared, value: JsValue, lang: JsValue, style: JsValue, rate: JsValue, active: JsValue, marks: JsValue, live: Set) -> R {
    let ort = inner.ort.clone();
    check(&inner, &active)?;
    let normalized = inner.normalize(&value, &lang)?;
    if normalized.length() == 0 { return Ok(Array::of2(&Float32Array::new_with_length(0), &Array::new()).into()); }
    let ids: JsValue = kernels::voice_host_supertonic_ids(normalized.into(), inner.indexer.clone())?.into();
    let count = length(&ids);
    let text_ids = own(&live, tensor(&ort, "int64", &ids, &shape(&[1.0, count]))?);
    let text_mask = own(&live, tensor(&ort, "float32", &ones(count)?, &shape(&[1.0, 1.0, count]))?);
    let selected = inner.style(&style)?;
    let feeds = record(&[("text_ids", &text_ids), ("style_dp", &read(&selected, "dp")?), ("text_mask", &text_mask)])?;
    let dp = awaited(run(inner.clone(), active.clone(), live.clone(), "duration_predictor", feeds)).await?;
    let duration = get(&dp, "duration");
    let seconds = runtime::supertonic_seconds(num(&get_at(&get(&duration, "data"), 0)), num(&rate));
    drop_tensor(&live, &duration);
    if runtime::supertonic_duration_ok(seconds) == 0 { return Err(error("Duración de audio fuera de rango")); }
    awaited(checkpoint(inner.clone(), active.clone())).await?;
    let feeds = record(&[("text_ids", &text_ids), ("style_ttl", &read(&selected, "ttl")?), ("text_mask", &text_mask)])?;
    let encoded = awaited(run(inner.clone(), active.clone(), live.clone(), "text_encoder", feeds)).await?;
    let frames = runtime::supertonic_audio_frames(seconds, inner.sample_rate, inner.chunk_size);
    let noise = call(&get(&inner.kit, "noise"), "supertonicNoise", &[&n(inner.latent_dim * frames), &inner.random])?;
    let mut latent = own(&live, tensor(&ort, "float32", &noise, &shape(&[1.0, inner.latent_dim, frames]))?);
    let latent_mask = own(&live, tensor(&ort, "float32", &ones(frames)?, &shape(&[1.0, 1.0, frames]))?);
    let total_step = own(&live, tensor(&ort, "float32", &Float32Array::new_from_slice(&[inner.steps as f32]).into(), &shape(&[1.0]))?);
    let mut step = 0.0;
    while step < inner.steps {
        awaited(checkpoint(inner.clone(), active.clone())).await?;
        let current_step = own(&live, tensor(&ort, "float32", &Float32Array::new_from_slice(&[step as f32]).into(), &shape(&[1.0]))?);
        let feeds = record(&[("noisy_latent", &latent), ("text_emb", &read(&encoded, "text_emb")?), ("style_ttl", &read(&selected, "ttl")?),
            ("latent_mask", &latent_mask), ("text_mask", &text_mask), ("current_step", &current_step), ("total_step", &total_step)])?;
        let output = awaited(run(inner.clone(), active.clone(), live.clone(), "vector_estimator", feeds)).await?;
        let denoised = read(&output, "denoised_latent")?;
        if !denoised.is_truthy() { return Err(error("El modelo no generó audio")); }
        drop_tensor(&live, &latent); drop_tensor(&live, &current_step); latent = denoised;
        step += 1.0;
    }
    awaited(checkpoint(inner.clone(), active.clone())).await?;
    let output = awaited(run(inner.clone(), active.clone(), live.clone(), "vocoder", record(&[("latent", &latent)])?)).await?;
    let wav = get(&get(&output, "wav_tts"), "data");
    if !get(&wav, "length").is_truthy() { return Err(error("El modelo devolvió audio vacío")); }
    // Every generated frame: cutting at the predicted length clipped the last syllables, and the quiet tail is trimmed
    // later anyway.
    let pcm = Float32Array::new(&method(&wav, "slice", &[&n(0.0), &n(frames * inner.chunk_size)])?);
    if pcm.to_vec().iter().any(|value| !value.is_finite()) { return Err(error("El modelo devolvió audio inválido")); }
    // This model exposes total durations, not token alignment. Estimate the boundary from its own prefix/suffix duration
    // predictor, without running the acoustic decoder again or splitting the generated waveform.
    let timeline = Array::new();
    let text = value.clone();
    for offset in js_sys::try_iter(&marks)?.ok_or_else(|| JsValue::from(js_sys::TypeError::new("marks is not iterable")))? {
        let offset = offset?;
        let before = method(&text, "slice", &[&n(0.0), &offset])?;
        let before = num(&awaited(predict(inner.clone(), lang.clone(), selected.clone(), active.clone(), live.clone(), before)).await?);
        let after = method(&text, "slice", &[&offset])?;
        let after = num(&awaited(predict(inner.clone(), lang.clone(), selected.clone(), active.clone(), live.clone(), after)).await?);
        if before + after > 0.0 {
            let sample = runtime::supertonic_mark_sample(f64::from(pcm.length()), before, after);
            timeline.push(&record(&[("offset", &offset), ("sample", &n(sample)), ("estimated", &JsValue::TRUE)])?);
        }
    }
    Ok(Array::of2(&pcm, &timeline).into())
}

/// The utterance: its chunks one after the other, joined with the planned gaps, then sped up with its marks.
async fn utterance(inner: Shared, value: JsValue, lang: JsValue, style: JsValue, rate: JsValue, active: JsValue, marks: JsValue) -> R {
    let chunks = kernels::voice_host_supertonic_chunks(if value.is_truthy() { text_value(&value) } else { text("") },
        if ["ko", "ja"].iter().any(|name| crate::host::text(&lang, name)) { 120 } else { 300 })?;
    let (parts, timeline) = (Array::new(), Array::new());
    let mut search_from = n(0.0);
    if chunks.length() > 32 { return Err(error("Texto de voz demasiado largo")); }
    let join = runtime::supertonic_join_new(inner.sample_rate);
    if join.is_null() { return Err(error("Duración de audio fuera de rango")); }
    let result = async {
        for chunk in chunks.iter() {
            let start = method(&value, "indexOf", &[&chunk, &search_from])?;
            search_from = n(num(&start) + length(&chunk));
            let local: JsValue = kernels::voice_host_supertonic_local_marks(marks.clone(), num(&start), num(&search_from)).into();
            let answer = awaited(infer(inner.clone(), chunk.clone(), lang.clone(), style.clone(), rate.clone(), active.clone(), local)).await?;
            let (pcm, chunk_marks) = (get_at(&answer, 0), get_at(&answer, 1));
            let offset = unsafe { runtime::supertonic_join_append(join, length(&pcm) as usize) };
            if offset == -2.0 { return Err(error("Audio demasiado largo")); }
            if offset < 0.0 { continue; }
            if method(&marks, "includes", &[&start])?.is_truthy() { timeline.push(&record(&[("offset", &start), ("sample", &n(offset))])?); }
            for mark in Array::from(&chunk_marks).iter() {
                let moved = Object::assign(&Object::new(), &Object::from(mark.clone()));
                set(&moved, "offset", &n(num(&get(&mark, "offset")) + num(&start)))?;
                set(&moved, "sample", &n(num(&get(&mark, "sample")) + offset))?;
                timeline.push(&moved);
            }
            parts.push(&record(&[("pcm", &pcm), ("offset", &n(offset))])?);
        }
        check(&inner, &active)?;
        // Typed arrays are host audio buffers; their initial zeroes also supply the planned inter-chunk gaps.
        let pcm = Float32Array::new_with_length(unsafe { runtime::supertonic_join_length(join) } as u32);
        for part in parts.iter() { pcm.set(&get(&part, "pcm"), num(&get(&part, "offset")) as u32); }
        let sped = call(&get(&inner.kit, "speedUp"), "speedUpSpeech", &[&pcm.into(), &n(inner.sample_rate), &rate, &timeline.clone().into()])?;
        let out = Object::assign(&Object::new(), &Object::from(sped));
        set(&out, "sampleRate", &n(inner.sample_rate))?;
        Ok(JsValue::from(out))
    }.await;
    unsafe { runtime::supertonic_join_free(join) };
    result
}

/// A loaded Supertonic voice: `synthesize(text, options)` one utterance at a time, `dispose()`.
#[wasm_bindgen]
pub struct VoiceSupertonic { inner: Shared }

#[wasm_bindgen]
impl VoiceSupertonic {
    #[wasm_bindgen(getter, js_name = sampleRate)]
    pub fn sample_rate(&self) -> f64 { self.inner.sample_rate }
    /// `{pcm, marks, sampleRate}` of `text`: options `{lang, style='F1', rate=1, isActive=()=>true, marks=[]}`.
    pub fn synthesize(&self, value: JsValue, options: JsValue) -> R<Promise> {
        let options = if options.is_undefined() { Object::new().into() } else { options };
        let field = |key: &str| read(&options, key);
        let lang = field("lang")?;
        let style = { let style = field("style")?; if style.is_undefined() { text("F1") } else { style } };
        let rate = { let rate = field("rate")?; if rate.is_undefined() { n(1.0) } else { rate } };
        let active = { let active = field("isActive")?; if active.is_undefined() { get(&self.inner.kit, "always") } else { active } };
        let marks = { let marks = field("marks")?; if marks.is_undefined() { Array::new().into() } else { marks } };
        let inner = self.inner.clone();
        let valid = is_language(&lang) && inner.style(&style)?.is_truthy();
        let token = unsafe { runtime::supertonic_state_begin(inner.state.get(), u32::from(valid), rate.as_f64().unwrap_or(f64::NAN)) };
        if token < 0.0 {
            let reason = if token == -1.0 { cancelled() } else { error(if token == -2.0 { "Síntesis ya en curso" } else { "Opciones de voz inválidas" }) };
            return Ok(Promise::reject(&reason));
        }
        let job = eager(utterance(inner.clone(), value, lang, style, rate, active, marks));
        *inner.running.borrow_mut() = job.clone().into();
        let (owner, settled_job) = (inner.clone(), job.clone());
        let finished = Closure::once_into_js(move || {
            unsafe { runtime::supertonic_state_finish(owner.state.get(), token.trunc().rem_euclid(4294967296.0) as u32) };
            let current = owner.running.borrow().clone();
            if current == JsValue::from(settled_job) { *owner.running.borrow_mut() = JsValue::NULL; }
        });
        let tail = method(&job.clone().into(), "finally", &[&finished])?;
        method(&tail, "catch", &[&get(&inner.kit, "noop")])?;
        Ok(job)
    }
    /// Waits for the running utterance, then releases the style tensors and the sessions.
    pub fn dispose(&self) -> Promise {
        let inner = self.inner.clone();
        eager(async move {
            if unsafe { runtime::supertonic_state_close(inner.state.get()) } == 0 { return Ok(JsValue::UNDEFINED); }
            let result = async {
                let running = inner.running.borrow().clone();
                if !absent(&running) { settled(method(&running, "catch", &[&get(&inner.kit, "noop")])?).await?; }
                awaited(release_all(inner.clone())).await
            }.await;
            unsafe { runtime::supertonic_state_free(inner.state.replace(std::ptr::null_mut())) };
            result.map(|_| JsValue::UNDEFINED)
        })
    }
}

/// The style tensors, then the sessions, in the order they were made.
async fn release_all(inner: Shared) -> R { release(inner.style_tensors.clone(), inner.sessions.clone()).await }
async fn release(style_tensors: JsValue, sessions: JsValue) -> R {
    for style in values_of(&style_tensors)?.iter() { release_tensor(&get(&style, "ttl")); release_tensor(&get(&style, "dp")); }
    for session in values_of(&sessions)?.iter() {
        let released = method_opt(&session, "release", &[])?.unwrap_or(JsValue::UNDEFINED);
        settled(released).await?;
    }
    Ok(JsValue::UNDEFINED)
}

/// `createSupertonicRuntime`: `options` as the JavaScript wrapper resolved them, `kit` the host's catalogue and helpers.
#[wasm_bindgen]
pub fn voice_supertonic_create(options: JsValue, kit: JsValue) -> Promise {
    eager(async move {
        let field = |key: &str| get(&options, key);
        let (ort, indexer) = (field("ort"), field("indexer"));
        if !get(&ort, "InferenceSession").is_truthy() || !get(&ort, "Tensor").is_truthy() || !Array::is_array(&indexer) {
            return Err(error("Configuración Supertonic inválida"));
        }
        let steps = field("steps");
        let config = kernels::voice_host_supertonic_config(field("config"), steps.clone())?;
        let (sessions, style_tensors) = (JsValue::from(Object::new()), JsValue::from(Object::new()));
        let built = async {
            let buffers = field("buffers");
            for name in ["duration_predictor", "text_encoder", "vector_estimator", "vocoder"] {
                let buffer = get(&buffers, name);
                if !get(&buffer, "byteLength").is_truthy() { return Err(error(&format!("Falta el modelo {name}"))); }
                let providers = Array::of1(&text("wasm"));
                let settings = record(&[("executionProviders", &providers.into()), ("graphOptimizationLevel", &text("all")),
                    ("enableCpuMemArena", &JsValue::FALSE), ("enableMemPattern", &JsValue::FALSE)])?;
                let session = settled(method(&read(&ort, "InferenceSession")?, "create", &[&read(&buffers, name)?, &settings])?).await?;
                set(&sessions, name, &session)?;
            }
            // `buffers = null`: the model bytes are not kept alive past their sessions.
            drop(buffers);
            Reflect::delete_property(&Object::from(options.clone()), &text("buffers"))?;
            let styles = field("styles");
            for &name in catalog::LEGACY_STYLES {
                if !get(&styles, name).is_truthy() { return Err(error(&format!("Falta el estilo {name}"))); }
            }
            let present: Vec<&str> = catalog::STYLES.iter().copied().filter(|&name| get(&styles, name).is_truthy()).collect();
            for name in present {
                let raw = get(&styles, name);
                let tensors = JsValue::from(Object::new());
                set(&style_tensors, name, &tensors)?;
                for (key, field) in [("ttl", "style_ttl"), ("dp", "style_dp")] {
                    let source = read(&raw, field)?;
                    let dims = get(&source, "dims");
                    let data = get(&source, "data");
                    let data = if absent(&data) { JsValue::UNDEFINED } else {
                        // The engine's own message for the original `source?.data?.flat(Infinity)`.
                        let flat = read(&data, "flat")?.dyn_into::<Function>().map_err(|_| JsValue::from(js_sys::TypeError::new("source?.data?.flat is not a function")))?;
                        flat.call1(&data, &n(f64::INFINITY))?
                    };
                    let valid = Array::is_array(&dims) && Array::is_array(&data) && {
                        let values: Vec<f64> = Array::from(&data).iter().map(|value| value.as_f64().unwrap_or(f64::NAN)).collect();
                        kernels::voice_host_style_valid(dims.clone(), &values)
                    };
                    if !valid { return Err(error(&format!("Estilo {name} inválido"))); }
                    set(&tensors, key, &tensor(&ort, "float32", &Float32Array::new(&data).into(), &dims)?)?;
                }
            }
            Ok(())
        }.await;
        if let Err(error) = built { awaited(release(style_tensors, sessions)).await?; return Err(error); }
        let inner = Rc::new(Inner {
            ort, indexer, kit: kit.clone(), random: field("random"), yield_to_messages: field("yieldToMessages"), steps: num(&steps),
            sample_rate: num(&get(&config, "sampleRate")), chunk_size: num(&get(&config, "chunkSize")), latent_dim: num(&get(&config, "latentDim")),
            sessions, style_tensors, state: Cell::new(runtime::supertonic_state_new()), running: RefCell::new(JsValue::NULL),
        });
        Ok(VoiceSupertonic { inner }.into())
    })
}
