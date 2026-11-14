//! The members of the neural engine (engine.js `NeuralEngine`) that wait for something: refreshing the installed set,
//! downloading and removing a voice, warming the worker up and preparing it for a run. Each was an `async` method (or
//! a promise chain) in JavaScript that called two to five exports of neural_engine.rs with a wait between them; here
//! the same steps follow each other without leaving the module. `eager` runs a body the way an `async function`
//! runs: at once up to its first wait, and on in the reaction job of what it waits for, so every step keeps its
//! microtask. The engine object stays the JavaScript one (its fields, its EventTarget, its injected store and client).
use js_sys::{Array, Function, Object, Promise, Set};
use wasm_bindgen::prelude::*;
use crate::eager::eager;
use crate::quick_wait::{wait, Wait};
use crate::host::{get_at, method, num, read, set};
use crate::neural_engine::{neural_client, neural_install_begin, neural_install_done, neural_install_failed, neural_install_finally, neural_install_progress,
    neural_installed_changed, neural_list, neural_listed, neural_prepare_begin, neural_prepare_failed, neural_prepare_ready, neural_remove_begin,
    neural_remove_end, neural_warm_begin, neural_warm_done, neural_warm_failed};

type R<T = JsValue> = Result<T, JsValue>;
/// `await value`.
fn settled(value: JsValue) -> Wait { wait(&value) }

/// `refresh()`: re-reads Cache Storage; fires 'change' when the installed set differs. A listing that fails is an
/// empty one.
#[wasm_bindgen]
pub fn neural_refresh(e: JsValue) -> Promise {
    eager(async move {
        let listed: R = async {
            let pair = neural_list(e.clone())?;
            let value = settled(get_at(&pair, 0)).await?;
            neural_listed(e.clone(), value, get_at(&pair, 1).is_truthy())
        }.await;
        neural_installed_changed(e, listed.unwrap_or_else(|_| Set::new(&JsValue::UNDEFINED).into()))?;
        Ok(JsValue::UNDEFINED)
    })
}

/// One progress report of a download: the store calls it bound to its engine, its siblings and the cell that keeps
/// the fraction last published.
#[wasm_bindgen]
pub fn neural_install_step(e: JsValue, siblings: JsValue, cell: JsValue, progress: JsValue) -> R<()> {
    let last = neural_install_progress(e, siblings, num(&read(&cell, "last")?), progress)?;
    set(&cell, "last", &JsValue::from_f64(last))
}

/// `install(id, { signal } = {})`: downloads a voice with progress and resolves when it is usable; the answer of a
/// download of the same model that is already running is that download's own promise. `ui` is this module as
/// JavaScript sees it (for the bound progress callback) and `store_error` the store's error class.
#[wasm_bindgen]
pub fn neural_install(e: JsValue, id: JsValue, options: JsValue, ui: JsValue, store_error: JsValue) -> Promise {
    eager(async move {
        let signal = if options.is_undefined() { JsValue::UNDEFINED } else { read(&options, "signal")? };
        let begun = neural_install_begin(e.clone(), id, signal)?;
        if !Array::is_array(&begun) { return Ok(begun); } // nothing to do, or the download of this model that is already running
        let (voice, siblings, abort) = (get_at(&begun, 0), get_at(&begun, 1), get_at(&begun, 2));
        let host = e.clone();
        let job = eager(async move {
            let e = host;
            let cell: JsValue = Object::new().into();
            set(&cell, "last", &JsValue::from_f64(0.0))?;
            let downloaded: R<()> = async {
                let step: Function = read(&ui, "neural_install_step")?.dyn_into().map_err(|_| JsValue::from(js_sys::TypeError::new("neural_install_step is not a function")))?;
                let store = read(&e, "store")?;
                let piper = read(&voice, "piperId")?;
                let request: JsValue = Object::new().into();
                set(&request, "signal", &read(&abort, "signal")?)?;
                set(&request, "onProgress", &step.bind3(&JsValue::NULL, &e, &siblings, &cell))?;
                settled(method(&store, "download", &[&piper, &request])?).await?;
                neural_install_done(e.clone(), siblings.clone())
            }.await;
            // catch (error) { throw failed(error) } finally { ... }
            let outcome = match downloaded {
                Ok(()) => Ok(JsValue::UNDEFINED),
                Err(error) => Err(neural_install_failed(e.clone(), siblings.clone(), error, store_error).unwrap_or_else(|thrown| thrown)),
            };
            neural_install_finally(e, read(&voice, "piperId")?, abort)?;
            outcome
        });
        method(&read(&e, "installing")?, "set", &[&read(&get_at(&begun, 0), "piperId")?, &job])?;
        Ok(job.into())
    })
}

/// `remove(id)`: deletes a downloaded voice.
#[wasm_bindgen]
pub fn neural_remove(e: JsValue, id: JsValue) -> Promise {
    eager(async move {
        let voice = neural_remove_begin(e.clone(), id)?;
        if !voice.is_truthy() { return Ok(JsValue::UNDEFINED); }
        settled(method(&read(&e, "store")?, "remove", &[&read(&voice, "piperId")?])?).await?;
        neural_remove_end(e, voice)?;
        Ok(JsValue::UNDEFINED)
    })
}

/// `warmUp(voiceId)`: starts the worker and loads the voice's model ahead of the first speak() (a cold start is 3-6 s:
/// worker, ONNX Runtime, a 63 MB model). Resolves when ready, never rejects; the idle teardown still applies if
/// nothing is spoken.
#[wasm_bindgen]
pub fn neural_warm_up(e: JsValue, voice_id: JsValue) -> Promise {
    eager(async move {
        let voice = neural_warm_begin(e.clone(), voice_id)?;
        if !voice.is_truthy() { return Ok(JsValue::FALSE); }
        // let client = this.client; try { client = made; await client.prepare(...); ... } catch { failed(client) }
        let before = read(&e, "client")?;
        let made = neural_client(e.clone());
        let client = made.clone().unwrap_or(before);
        let ready: R<bool> = async {
            let client = made?;
            settled(method(&client, "prepare", &[&read(&voice, "piperId")?])?).await?;
            neural_warm_done(e.clone(), client)
        }.await;
        Ok(JsValue::from_bool(match ready { Ok(ready) => ready, Err(_) => neural_warm_failed(e, client)? }))
    })
}

/// `_prepare(run)`: starts preparing the worker for a run and, when that settles, lets the run go on or fails it.
#[wasm_bindgen]
pub fn neural_prepare(e: JsValue, run: JsValue) -> R<()> {
    let Ok(begun) = neural_prepare_begin(e.clone(), run.clone()) else { return neural_prepare_failed(e, run) };
    let (promise, started, cold) = (get_at(&begun, 0), num(&get_at(&begun, 1)), get_at(&begun, 2).is_truthy());
    // Promise.resolve(promise).then(ready, failed): nobody holds the outcome.
    let _ = eager(async move {
        match settled(promise).await { Ok(_) => neural_prepare_ready(e, run, started, cold)?, Err(_) => neural_prepare_failed(e, run)? }
        Ok(JsValue::UNDEFINED)
    });
    Ok(())
}
