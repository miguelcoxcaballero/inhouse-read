//! One synthesis job of the synthesis worker (worker.js `synth`): a Supertonic utterance in one piece, or a Piper
//! fragment phonemized, its page boundaries placed, cut into sentences, each run, finished and posted as soon as it
//! is ready, with the cancellation checks between every step. The worker keeps its state, the ONNX run of one
//! sentence, the phonemizer closure and its messages; `w` hands them over (see worker.js).
use js_sys::{Array, Float32Array, JsString, Object, Promise};
use wasm_bindgen::prelude::*;
use crate::eager::{eager, settled};
use crate::host::{call, get, method, num, read, set};

type R<T = JsValue> = Result<T, JsValue>;
fn error(message: &str) -> JsValue { js_sys::Error::new(message).into() }
fn n(value: f64) -> JsValue { JsValue::from_f64(value) }
fn text(value: &str) -> JsValue { JsValue::from_str(value) }
fn record(pairs: &[(&str, &JsValue)]) -> R { let o = Object::new(); for (key, value) in pairs { set(&o, key, value)?; } Ok(o.into()) }
/// `[...text].length`: code points, a lone surrogate counting as one.
fn points(value: &JsValue) -> f64 {
    let Some(value) = value.dyn_ref::<JsString>() else { return f64::from(Array::from(value).length()) };
    let units: Vec<u16> = value.iter().collect();
    let pairs = units.windows(2).filter(|pair| (0xd800..=0xdbff).contains(&pair[0]) && (0xdc00..=0xdfff).contains(&pair[1])).count();
    // Overlapping windows never pair one unit twice: a low surrogate cannot start a pair.
    (units.len() - pairs) as f64
}

struct Worker { w: JsValue, plan: JsValue, id: JsValue }
impl Worker {
    /// `performance.now()` of the worker.
    fn now(&self) -> R<f64> { Ok(num(&method(&self.w, "now", &[])?)) }
    fn active(&self) -> R<bool> { Ok(method(&self.plan, "workerActive", &[&self.id])?.is_truthy()) }
    fn stage(&self, domain: f64, stage: f64, part: Option<f64>) -> R<()> {
        match part {
            Some(part) => method(&self.w, "stage", &[&n(domain), &n(stage), &self.id, &n(part)])?,
            None => method(&self.w, "stage", &[&n(domain), &n(stage), &self.id])?,
        };
        Ok(())
    }
    fn post(&self, message: &JsValue, transfer: Option<&JsValue>) -> R<()> {
        match transfer {
            Some(buffer) => method(&self.w, "post", &[message, &Array::of1(buffer).into()])?,
            None => method(&self.w, "post", &[message])?,
        };
        Ok(())
    }
    fn plan_message(&self, counts: &Array) -> R<()> { self.post(&record(&[("type", &text("plan")), ("id", &self.id), ("counts", &counts.clone().into())])?, None) }
    /// The short rest of a fragment with nothing speakable (an ornament, "..."): the reading keeps flowing.
    fn rest(&self, sample_rate: &JsValue, ms: f64) -> R<()> {
        let pcm = method(&self.w, "silence", &[sample_rate, &n(120.0)])?;
        let message = record(&[("type", &text("chunk")), ("id", &self.id), ("index", &n(0.0)), ("last", &JsValue::TRUE), ("pcm", &pcm),
            ("sampleRate", sample_rate), ("ms", &n(ms))])?;
        self.post(&message, Some(&get(&pcm, "buffer")))
    }
}

async fn supertonic(job: &Worker, runtime: JsValue, value: JsValue, request: [JsValue; 4]) -> R<()> {
    let [rate, lang, style, marks] = request;
    job.plan_message(&Array::of1(&n(1f64.max(points(&value)))))?;
    let started = job.now()?;
    job.stage(3.0, 3.0, None)?;
    let options = record(&[("lang", &lang), ("style", &style), ("rate", &rate), ("marks", &marks), ("isActive", &method(&job.w, "activeFor", &[&job.id])?)])?;
    let answer = settled(method(&runtime, "synthesize", &[&value, &options])?).await?;
    let (raw, sample_rate) = (read(&answer, "pcm")?, read(&answer, "sampleRate")?);
    let timeline = { let marks = read(&answer, "marks")?; if marks.is_undefined() { Array::new().into() } else { marks } };
    job.stage(3.0, 4.0, None)?;
    if !job.active()? { return Ok(()); }
    if !raw.is_instance_of::<Float32Array>() || !sample_rate.gt(&n(0.0)) { return Err(error("invalid Supertonic audio")); }
    // The SDK deliberately returns no samples when normalization removes all speakable text (for example an ornament).
    // Keep Piper's short-rest policy.
    if num(&get(&raw, "length")) == 0.0 { return job.rest(&sample_rate, job.now()? - started); }
    let done = call(&get(&job.w, "finishSupertonic"), "finishSupertonic", &[&raw, &value, &timeline, &record(&[("sampleRate", &sample_rate), ("rate", &rate)])?])?;
    if !done.is_truthy() { return Err(error("invalid Supertonic audio")); } // a sample that is not a number
    let pcm = read(&done, "pcm")?;
    let message = record(&[("type", &text("chunk")), ("id", &job.id), ("index", &n(0.0)), ("last", &JsValue::TRUE), ("pcm", &pcm),
        ("sampleRate", &sample_rate), ("ms", &n(job.now()? - started)), ("marks", &read(&done, "marks")?)])?;
    // Inference already yields between its steps. This fragment is complete: 'end' follows at once so the page can
    // request its next prefetched fragment.
    job.post(&message, Some(&read(&pcm, "buffer")?))
}

async fn piper(job: &Worker, value: JsValue, request: [JsValue; 4]) -> R<()> {
    let [rate, speaker, marks, _] = request;
    let w = &job.w;
    let sample_rate = read(&read(&read(w, "config")?, "audio")?, "sample_rate")?;
    job.stage(3.0, 1.0, None)?;
    let phonemize = get(w, "phonemize");
    let ids = settled(call(&phonemize, "phonemize", &[&value])?).await?;
    if !job.active()? { return Ok(()); }
    let points = if get(w, "durationOutput").is_truthy() {
        settled(call(&get(w, "phonemeMarks"), "phonemeMarks", &[&value, &marks, &ids, &phonemize])?).await?
    } else { Array::new().into() };
    job.stage(3.0, 2.0, None)?;
    if !job.active()? { return Ok(()); }
    let segments = call(&get(w, "splitSegments"), "splitSegments", &[&ids])?;
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
        let segment = crate::host::get_at(&segments, index as u32);
        let output = settled(call(&get(w, "runSegment"), "runSegment", &[&segment, &record(&[("rate", &rate), ("speaker", &speaker)])?])?).await?;
        let (raw, durations) = (read(&output, "pcm")?, read(&output, "durations")?);
        job.stage(3.0, 4.0, Some(index))?;
        if !job.active()? { return Ok(()); }
        let last = index == num(&get(&segments, "length")) - 1.0;
        let count = get(&segment, "length");
        // Cleaned, its page boundaries placed, sped up, and with its rests: sentences of one fragment are separated by a
        // rest at their start; the rest after the fragment comes with its last one (both shorten with the speaking rate).
        let options = record(&[("sampleRate", &sample_rate), ("model", &get(w, "voice")), ("rate", &rate), ("last", &JsValue::from_bool(last)),
            ("first", &JsValue::from_bool(index == 0.0)), ("base", &n(base)), ("count", &count)])?;
        let done = call(&get(w, "finishPiper"), "finishPiper", &[&raw, &durations, &points, &value, &options])?;
        base += num(&count);
        if !job.active()? { return Ok(()); }
        let pcm = read(&done, "pcm")?;
        let message = record(&[("type", &text("chunk")), ("id", &job.id), ("index", &n(index)), ("last", &JsValue::from_bool(last)), ("pcm", &pcm),
            ("sampleRate", &sample_rate), ("ms", &n(job.now()? - started)), ("marks", &read(&done, "marks")?)])?;
        job.post(&message, Some(&read(&pcm, "buffer")?))?;
        job.stage(3.0, 5.0, Some(index))?;
        settled(call(&get(w, "yieldToMessages"), "yieldToMessages", &[])?).await?;
        job.stage(3.0, 6.0, Some(index))?;
        index += 1.0;
    }
    Ok(())
}

/// `synth(job)`: speaks `job.text` with the loaded voice, posting its plan and its chunks.
#[wasm_bindgen]
pub fn voice_worker_synth(w: JsValue, request: JsValue) -> Promise {
    eager(async move {
        // const { id, text, rate, speaker, lang, style, marks = [] } = job
        let id = read(&request, "id")?;
        let value = read(&request, "text")?;
        let rate = read(&request, "rate")?;
        let speaker = read(&request, "speaker")?;
        let lang = read(&request, "lang")?;
        let style = read(&request, "style")?;
        let marks = { let marks = read(&request, "marks")?; if marks.is_undefined() { Array::new().into() } else { marks } };
        let job = Worker { plan: get(&w, "plan"), w: w.clone(), id };
        let runtime = get(&w, "supertonic");
        if runtime.is_truthy() { supertonic(&job, runtime, value, [rate, lang, style, marks]).await?; }
        else { piper(&job, value, [rate, speaker, marks, JsValue::UNDEFINED]).await?; }
        Ok(JsValue::UNDEFINED)
    })
}
