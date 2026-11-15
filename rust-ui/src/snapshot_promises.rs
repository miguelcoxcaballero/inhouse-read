//! The promise plumbing a page snapshot asks the browser for (page_snapshot.rs): a deadline around a decode, the read
//! of a local Blob, its data URL and an image load. Each one builds the same promise, with the same reactions attached
//! in the same order, as the four functions of page-snapshot.js did, so a snapshot continues at the microtask it did.
//!
//! The functions the browser keeps (a timer, the two reactions of a wait, the handlers of a FileReader) are one closure
//! per realm with no captured state, bound to their arguments with `Function.prototype.bind`: they are collected with
//! the promise, the timer or the reader they are bound to, as the arrow functions were.
//! The frozen originals are tests/unit/helpers/reference-snapshot-promises.js.
use js_sys::{Function, Promise};
use wasm_bindgen::prelude::*;
use crate::host::{clear_timeout, clock, construct, global, jmax, method, num, read, set, set_timeout};

type R<T = JsValue> = Result<T, JsValue>;
fn function<F: ?Sized + wasm_bindgen::closure::WasmClosure>(closure: Closure<F>) -> Function { closure.into_js_value().unchecked_into() }
/// `new Promise(executor)`, an executor that throws rejecting it.
fn promise(mut executor: impl FnMut(&Function, &Function) -> R<()>) -> JsValue {
    Promise::new(&mut |resolve: Function, reject: Function| {
        if let Err(error) = executor(&resolve, &reject) { let _ = reject.call1(&JsValue::UNDEFINED, &error); }
    }).into()
}

thread_local! {
    /// `() => reject(new Error('Reading image decode timed out'))`.
    static TIMED_OUT: Function = function(Closure::<dyn FnMut(Function) -> R>::new(|reject: Function|
        reject.call1(&JsValue::UNDEFINED, &js_sys::Error::new("Reading image decode timed out"))));
    /// `value => { clearTimeout(timer); resolve(value) }`, and the same with `reject` and the error.
    static IN_TIME: Function = function(Closure::<dyn FnMut(JsValue, Function, JsValue) -> R>::new(|timer: JsValue, settle: Function, value: JsValue| {
        clear_timeout(&timer)?;
        settle.call1(&JsValue::UNDEFINED, &value)
    }));
    /// `() => resolve(reader.result)`.
    static READ: Function = function(Closure::<dyn FnMut(Function, JsValue) -> R>::new(|resolve: Function, reader: JsValue| resolve.call1(&JsValue::UNDEFINED, &read(&reader, "result")?)));
    /// `() => reject(reader.error)`.
    static UNREADABLE: Function = function(Closure::<dyn FnMut(Function, JsValue) -> R>::new(|reject: Function, reader: JsValue| reject.call1(&JsValue::UNDEFINED, &read(&reader, "error")?)));
    /// `response => response.blob()`.
    static BLOB: Function = function(Closure::<dyn FnMut(JsValue) -> R>::new(|response: JsValue| method(&response, "blob", &[])));
}

/// `beforeDeadline(promise, deadline)`: `promise`, or a rejection once the clock reaches `deadline`.
pub fn before_deadline(waited: &JsValue, deadline: &JsValue) -> R {
    Ok(promise(|resolve, reject| {
        let timer = set_timeout(TIMED_OUT.with(|timed_out| timed_out.bind1(&JsValue::NULL, reject)).as_ref(), jmax(0.0, num(deadline) - clock()?))?;
        let (kept, failed) = IN_TIME.with(|in_time| (in_time.bind2(&JsValue::NULL, &timer, resolve), in_time.bind2(&JsValue::NULL, &timer, reject)));
        method(&Promise::resolve(waited).into(), "then", &[kept.as_ref(), failed.as_ref()]).map(drop)
    }))
}

/// `blobDataURL(blob)`: the `data:` URL of a Blob.
pub fn blob_data_url(blob: &JsValue) -> R {
    Ok(promise(|resolve, reject| {
        let reader = construct("FileReader", &[])?;
        set(&reader, "onload", &READ.with(|read| read.bind2(&JsValue::NULL, resolve, &reader)))?;
        set(&reader, "onerror", &UNREADABLE.with(|unreadable| unreadable.bind2(&JsValue::NULL, reject, &reader)))?;
        method(&reader, "readAsDataURL", &[blob]).map(drop)
    }))
}

/// `localBlob(href)`: `fetch(href).then(response => response.blob())`. Only ever asked for a `blob:` URL the book
/// already loaded, so no request leaves the device.
pub fn local_blob(href: &JsValue) -> R {
    let response = crate::host::function_of(&global(), "fetch", &[href])?;
    method(&response, "then", &[BLOB.with(|blob| blob.clone()).as_ref()])
}

/// `loadImage(image, url)`: settles when the image has loaded `url` or failed to.
pub fn load_image(image: &JsValue, url: &JsValue) -> R {
    Ok(promise(|resolve, reject| {
        set(image, "onload", resolve)?;
        set(image, "onerror", reject)?;
        set(image, "src", url)
    }))
}

/// The four of them for the differential test: `[beforeDeadline, localBlob, blobDataURL, loadImage][which](a, b)`.
#[wasm_bindgen]
pub fn snapshot_promise(which: u32, a: JsValue, b: JsValue) -> R {
    match which { 0 => before_deadline(&a, &b), 1 => local_blob(&a), 2 => blob_data_url(&a), _ => load_image(&a, &b) }
}
