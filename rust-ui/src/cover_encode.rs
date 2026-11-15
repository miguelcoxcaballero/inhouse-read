//! The JPEG of a PDF's cover (cover-encode.js `encodePdfCover`). A PDF cover keeps its original dimensions and JPEG
//! quality. Reading pixels for HTMLCanvasElement.toBlob can wait for queued GPU work on the UI thread; a transferred
//! bitmap lets a worker perform that readback and encoding. Older WebViews, blocked workers and unsupported bitmap
//! transfers retain the canvas's own encoder. An aborted import must never start a second job.
//!
//! One cover is encoded per imported PDF. The body runs like the `async function` it was (`eager`): every wait is
//! where an `await` stood, and `try`/`catch`/`finally` are spelled out below. The functions the worker and the signal
//! keep are one closure per realm with no captured state, bound to the job they belong to with
//! `Function.prototype.bind` and collected with it.
//! The frozen original is tests/unit/helpers/reference-cover-encode.js.
use js_sys::{Array, Function, Object, Promise};
use wasm_bindgen::prelude::*;
use crate::eager::{eager, settled};
use crate::host::{absent, call, function_of, global, method, read, set};

type R<T = JsValue> = Result<T, JsValue>;
fn st(value: &str) -> JsValue { JsValue::from_str(value) }
fn function<F: ?Sized + wasm_bindgen::closure::WasmClosure>(closure: Closure<F>) -> Function { closure.into_js_value().unchecked_into() }
fn unavailable() -> JsValue { js_sys::Error::new("Cover encoder unavailable").into() }
/// `signal?.aborted`.
fn aborted(signal: &JsValue) -> R<bool> { Ok(!absent(signal) && read(signal, "aborted")?.is_truthy()) }
/// `typeof globalThis[name] === 'function'`.
fn offered(name: &str) -> R<bool> { Ok(read(&global(), name)?.is_function()) }
/// `value instanceof Blob`, throwing like the engine when Blob is not a constructor.
fn is_blob(value: &JsValue) -> R<bool> {
    let blob = read(&global(), "Blob")?;
    let blob = blob.dyn_ref::<Function>().ok_or_else(|| JsValue::from(js_sys::TypeError::new("Right-hand side of 'instanceof' is not callable")))?;
    if !value.is_object() { return Ok(false); }
    let prototype = read(blob, "prototype")?;
    Ok(prototype.dyn_ref::<Object>().ok_or_else(|| JsValue::from(js_sys::TypeError::new("Function has non-object prototype in instanceof check")))?.is_prototype_of(value))
}

/// The end of the worker's job, once: `finish(value, error)`.
fn finish(job: &JsValue, value: &JsValue, error: &JsValue) -> R<()> {
    if read(job, "settled")?.is_truthy() { return Ok(()); }
    set(job, "settled", &JsValue::TRUE)?;
    let signal = read(job, "signal")?;
    if !absent(&signal) { method(&signal, "removeEventListener", &[&st("abort"), &read(job, "abort")?])?; }
    let worker = read(job, "worker")?;
    for handler in ["onmessageerror", "onerror", "onmessage"] { set(&worker, handler, &JsValue::NULL)?; }
    if error.is_truthy() { call(&read(job, "reject")?, "reject", &[error])?; } else { call(&read(job, "resolve")?, "resolve", &[value])?; }
    Ok(())
}
thread_local! {
    /// `() => finish(null)`.
    static ABORT: Function = function(Closure::<dyn FnMut(JsValue) -> R<()>>::new(|job: JsValue| finish(&job, &JsValue::NULL, &JsValue::UNDEFINED)));
    /// `event => event.data?.blob instanceof Blob ? finish(event.data.blob) : finish(null, new Error('Cover encoder unavailable'))`.
    static MESSAGE: Function = function(Closure::<dyn FnMut(JsValue, JsValue) -> R<()>>::new(|job: JsValue, event: JsValue| {
        let data = read(&event, "data")?;
        let blob = if absent(&data) { JsValue::UNDEFINED } else { read(&data, "blob")? };
        if is_blob(&blob)? { finish(&job, &read(&read(&event, "data")?, "blob")?, &JsValue::UNDEFINED) } else { finish(&job, &JsValue::NULL, &unavailable()) }
    }));
    /// `event => { event?.preventDefault?.(); finish(null, new Error('Cover encoder unavailable')) }`.
    static FAILED: Function = function(Closure::<dyn FnMut(JsValue, JsValue) -> R<()>>::new(|job: JsValue, event: JsValue| {
        crate::host::method_opt(&event, "preventDefault", &[])?;
        finish(&job, &JsValue::NULL, &unavailable())
    }));
}

/// The worker's answer: a Blob, null when the import was given up, or a rejection when the worker cannot encode.
fn encoded(worker: &JsValue, bitmap: &JsValue, signal: &JsValue) -> JsValue {
    Promise::new(&mut |resolve: Function, reject: Function| {
        let started = (|| -> R<()> {
            let job: JsValue = Object::new().into();
            for (name, value) in [("settled", &JsValue::FALSE), ("signal", signal), ("worker", worker), ("resolve", resolve.as_ref()), ("reject", reject.as_ref())] { set(&job, name, value)?; }
            let abort: JsValue = ABORT.with(|abort| abort.bind1(&JsValue::NULL, &job)).into();
            set(&job, "abort", &abort)?;
            set(worker, "onmessage", &MESSAGE.with(|message| message.bind1(&JsValue::NULL, &job)))?;
            let failed: JsValue = FAILED.with(|failed| failed.bind1(&JsValue::NULL, &job)).into();
            set(worker, "onmessageerror", &failed)?;
            set(worker, "onerror", &failed)?;
            if !absent(signal) {
                let once: JsValue = Object::new().into();
                set(&once, "once", &JsValue::TRUE)?;
                method(signal, "addEventListener", &[&st("abort"), &abort, &once])?;
            }
            if aborted(signal)? { return finish(&job, &JsValue::NULL, &JsValue::UNDEFINED); }
            let message: JsValue = Object::new().into();
            set(&message, "bitmap", bitmap)?;
            if let Err(error) = method(worker, "postMessage", &[&message, &Array::of1(bitmap)]) { finish(&job, &JsValue::NULL, &error)?; }
            Ok(())
        })();
        if let Err(error) = started { let _ = reject.call1(&JsValue::UNDEFINED, &error); }
    }).into()
}

/// `encodePdfCover(canvas, {signal} = {})`: the cover as a JPEG Blob, or null for an import that was given up.
/// `create_worker` starts the encoder (its URL is the page's to name).
#[wasm_bindgen]
pub fn cover_encode_pdf(canvas: JsValue, options: JsValue, create_worker: Function) -> Promise {
    eager(async move {
        let signal = if options.is_undefined() { JsValue::UNDEFINED } else { read(&options, "signal")? };
        if aborted(&signal)? { return Ok(JsValue::NULL); }
        if offered("Worker")? && offered("OffscreenCanvas")? && offered("createImageBitmap")? {
            let (mut bitmap, mut worker) = (JsValue::UNDEFINED, JsValue::UNDEFINED);
            // try: `Ok(answer)` is what the function returns from inside it.
            let attempt: R = async {
                bitmap = settled(function_of(&global(), "createImageBitmap", &[&canvas])?).await?;
                if aborted(&signal)? { return Ok(JsValue::NULL); }
                worker = create_worker.call0(&JsValue::UNDEFINED)?;
                let blob = settled(encoded(&worker, &bitmap, &signal)).await?;
                Ok(if aborted(&signal)? { JsValue::NULL } else { blob })
            }.await;
            // catch: the canvas keeps its own encoder, unless the import was given up meanwhile.
            let answer = match attempt { Ok(answer) => Ok(Some(answer)), Err(_) => aborted(&signal).map(|gone| gone.then_some(JsValue::NULL)) };
            // finally
            if !absent(&worker) { method(&worker, "terminate", &[])?; }
            if !absent(&bitmap) { method(&bitmap, "close", &[])?; }
            if let Some(answer) = answer? { return Ok(answer); }
        }
        Ok(Promise::new(&mut |resolve: Function, reject: Function| {
            if let Err(error) = method(&canvas, "toBlob", &[resolve.as_ref(), &st("image/jpeg"), &JsValue::from_f64(0.9)]) { let _ = reject.call1(&JsValue::UNDEFINED, &error); }
        }).into())
    })
}
