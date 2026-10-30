//! The espeak-ng phonemizer of the synthesis worker and the Android client (phonemizer.js): one Emscripten module at a
//! time, replaced every `limit` calls and after a call that threw, the extra dictionaries fetched once and written into
//! each fresh filesystem, the output read back from what the program printed. The lifetime rules are the voice core's
//! (rust-core/src/phonemizer_runtime.rs); the host keeps the Emscripten factory and its print hooks, the dictionary
//! fetch and its AbortController, and the promise chain that serialises the callers.
use std::cell::{Cell, RefCell};
use std::collections::HashMap;
use std::rc::Rc;
use js_sys::{Array, JsString, Object, Reflect, Uint8Array};
use wasm_bindgen::prelude::*;
use crate::eager::{eager, settled};
use crate::host::{absent, get, method, read, set, text_value};
use crate::phonemizer_runtime as runtime;

type R<T = JsValue> = Result<T, JsValue>;
fn error(message: &str) -> JsValue { js_sys::Error::new(message).into() }
fn released() -> JsValue { error("phonemizer was released") }
/// `new Error(message, {cause})` of a message made of these pieces, each as a template literal shows it, UTF-16 kept as it
/// is. The realm's own Error, whatever the global object is called.
fn error_of(parts: &[&JsValue], options: Option<&JsValue>) -> R {
    let mut message = JsString::from("");
    for part in parts { message = message.concat(&text_value(part)); }
    let error = js_sys::Error::new("");
    Reflect::set(&error, &JsValue::from_str("message"), &message)?;
    if let Some(cause) = options {
        // InstallErrorCause: an own, non-enumerable data property.
        let descriptor = Object::new();
        set(&descriptor, "value", cause)?;
        set(&descriptor, "writable", &JsValue::TRUE)?;
        set(&descriptor, "configurable", &JsValue::TRUE)?;
        Reflect::define_property(&error, &JsValue::from_str("cause"), &descriptor)?;
    }
    Ok(error.into())
}
/// `await f()` for an async function `f` of the original: its body starts at once and the caller goes on one job after
/// it settled, as many microtasks later as the JavaScript took.
async fn awaited(body: impl std::future::Future<Output = R<()>> + 'static) -> R<()> {
    settled(eager(async move { body.await.map(|_| JsValue::UNDEFINED) }).into()).await.map(|_| ())
}
const ALIASES: [(&str, &str); 3] = [("nb", "no"), ("nn", "no"), ("zh", "cmn")];

/// `String(espeakVoice || '').toLowerCase().split(/[-_]/)[0]`, through its alias, when it is one of `names`; else ''.
fn dictionary_name(espeak_voice: &JsValue, names: &JsValue) -> String {
    let text = if espeak_voice.is_truthy() { text_value(espeak_voice) } else { JsValue::from_str("") };
    let lower: Vec<u16> = text.unchecked_into::<JsString>().to_lower_case().iter().collect();
    let end = lower.iter().position(|&unit| unit == b'-' as u16 || unit == b'_' as u16).unwrap_or(lower.len());
    let base = String::from_utf16_lossy(&lower[..end]);
    let name = ALIASES.iter().find(|(alias, _)| *alias == base).map_or(base.as_str(), |(_, name)| name).to_string();
    let known = Array::from(names).includes(&JsValue::from_str(&name), 0);
    if known { name } else { String::new() }
}

/// `extraDictionaryOf`: 'ru' -> 'ru', 'nb' -> 'no', 'es-419' -> '' (that one is in the data pack).
#[wasm_bindgen]
pub fn voice_phonemizer_dictionary_of(espeak_voice: JsValue, names: JsValue) -> String { dictionary_name(&espeak_voice, &names) }

/// `value?.PThread?.terminateAllThreads?.()`, whatever it throws (the module is single threaded).
fn terminate(value: &JsValue) {
    let threads = get(value, "PThread");
    let _ = crate::host::method_opt(&threads, "terminateAllThreads", &[]);
}

struct Inner {
    plan: *mut runtime::Phonemizer,
    host: JsValue,
    names: JsValue,
    module: RefCell<JsValue>,
    line: RefCell<JsValue>,
    errors: RefCell<Array>,
    generation: Cell<f64>,
    downloaded: RefCell<HashMap<String, JsValue>>,
}
impl Drop for Inner { fn drop(&mut self) { unsafe { runtime::phonemizer_runtime_free(self.plan) } } }

impl Inner {
    fn current(&self, token: f64) -> bool { unsafe { runtime::phonemizer_runtime_current(self.plan, token) != 0 } }
    fn check(&self) -> R<()> { if self.current(self.generation.get()) { Ok(()) } else { Err(released()) } }
    fn dictionary(&self, id: u32, operation: u32) -> i32 { unsafe { runtime::phonemizer_runtime_dictionary(self.plan, id, operation) } }
    fn module(&self) -> JsValue { self.module.borrow().clone() }
    fn close(&self) { unsafe { runtime::phonemizer_runtime_close(self.plan) } }

    /// A fresh Emscripten module: the old one is let go first, and a late one is dropped if the plan moved on meanwhile.
    async fn build(self: Rc<Self>) -> R<()> {
        let token = unsafe { runtime::phonemizer_runtime_build(self.plan) };
        if token.is_nan() { return Err(released()); }
        self.generation.set(token);
        *self.line.borrow_mut() = JsValue::NULL;
        *self.errors.borrow_mut() = Array::new();
        let old = self.module.replace(JsValue::NULL);
        terminate(&old);
        let created = settled(method(&self.host, "create", &[&JsValue::from_f64(token)])?).await?;
        if unsafe { runtime::phonemizer_runtime_accept(self.plan, token) } == 0 { terminate(&created); return Err(released()); }
        *self.module.borrow_mut() = created;
        Ok(())
    }

    /// The espeak-ng dictionary the voice needs, in this module's filesystem: from the shipped pack, the bytes already
    /// fetched for an earlier module, or the network.
    async fn ensure_dictionary(self: Rc<Self>, espeak_voice: JsValue) -> R<()> {
        self.check()?;
        let name = dictionary_name(&espeak_voice, &self.names);
        if name.is_empty() { return Ok(()); }
        let id = Array::from(&self.names).index_of(&JsValue::from_str(&name), 0) as u32;
        let action = self.dictionary(id, 0);
        if action == 0 { return Ok(()); }
        // Some of these dictionaries are already in the shipped pack. Creating the same file again throws EEXIST before
        // the first word (Pim/nl, among others). Inspect the real module rather than guessing its packaged languages.
        let module = self.module();
        let analyze = read(&module, "FS_analyzePath")?;
        if !absent(&analyze) {
            let path = JsValue::from_str(&format!("/espeak-ng-data/{name}_dict"));
            let found = analyze.dyn_ref::<js_sys::Function>().ok_or_else(|| js_sys::TypeError::new("module.FS_analyzePath is not a function"))?.call1(&module, &path)?;
            if get(&found, "exists").is_truthy() { self.dictionary(id, 2); return Ok(()); }
        }
        let mut bytes = if action == 2 { self.downloaded.borrow().get(&name).cloned().unwrap_or(JsValue::UNDEFINED) } else { JsValue::NULL };
        if action == 1 {
            let response = settled(method(&self.host, "fetch", &[&JsValue::from_str(&name)])?).await?;
            self.check()?;
            if !get(&response, "ok").is_truthy() {
                let status = if absent(&response) { JsValue::UNDEFINED } else { get(&response, "status") };
                let status = if absent(&status) { JsValue::from_str("no response") } else { status };
                return Err(error_of(&[&JsValue::from_str(&format!("phonemizer dictionary \"{name}\" not available (")), &status, &JsValue::from_str(")")], None)?);
            }
            let buffer = settled(method(&response, "arrayBuffer", &[])?).await?;
            bytes = Uint8Array::new(&buffer).into();
            self.check()?;
            self.downloaded.borrow_mut().insert(name.clone(), bytes.clone());
            self.dictionary(id, 1);
        }
        let module = self.module();
        if !read(&module, "FS_createDataFile")?.is_function() { return Err(error("phonemizer module cannot take extra dictionaries")); }
        method(&module, "FS_createDataFile", &[&JsValue::from_str("/espeak-ng-data"), &JsValue::from_str(&format!("{name}_dict")), &bytes,
            &JsValue::TRUE, &JsValue::TRUE, &JsValue::TRUE])?;
        self.dictionary(id, 2);
        Ok(())
    }

    /// One run of the program: it prints one JSON object, `{"phoneme_ids":[...], ...}`.
    fn run(&self, text: &JsValue, espeak_voice: &JsValue) -> R<()> {
        if unsafe { runtime::phonemizer_runtime_attempt(self.plan) } == 0 { return Err(released()); }
        *self.line.borrow_mut() = JsValue::NULL;
        *self.errors.borrow_mut() = Array::new();
        let input = Object::new();
        set(&input, "text", text)?;
        let input = js_sys::JSON::stringify(&Array::of1(&input))?;
        let args = Array::new();
        for value in [JsValue::from_str("-l"), espeak_voice.clone(), JsValue::from_str("--input"), input.into(), JsValue::from_str("--espeak_data"), JsValue::from_str("/espeak-ng-data")] { args.push(&value); }
        method(&self.module(), "callMain", &[&args])?;
        Ok(())
    }

    async fn phonemize(self: Rc<Self>, text: JsValue, espeak_voice: JsValue) -> R {
        let action = unsafe { runtime::phonemizer_runtime_begin(self.plan) };
        if action < 0 { return Err(released()); }
        if action == 1 { awaited(self.clone().build()).await?; }
        awaited(self.clone().ensure_dictionary(espeak_voice.clone())).await?;
        if let Err(first) = self.run(&text, &espeak_voice) {
            // A module that threw is not trusted again: a fresh one gets this text once more, and only then is it an error.
            if unsafe { runtime::phonemizer_runtime_retry(self.plan) } == 0 { return Err(first); }
            let again = async {
                awaited(self.clone().build()).await?;
                awaited(self.clone().ensure_dictionary(espeak_voice.clone())).await?;
                self.run(&text, &espeak_voice)
            }.await;
            if let Err(second) = again {
                // `second?.message || first?.message || second || first`
                let reason = [get(&second, "message"), get(&first, "message"), second.clone()].into_iter().find(|value| value.is_truthy()).unwrap_or(first);
                return Err(error_of(&[&JsValue::from_str("phonemizer failed: "), &reason], Some(&second))?);
            }
        }
        let line = self.line.borrow().clone();
        let result = if absent(&line) { JsValue::NULL } else { js_sys::JSON::parse(&String::from(text_value(&line).unchecked_into::<JsString>())).unwrap_or(JsValue::NULL) };
        if !result.is_truthy() {
            let errors = self.errors.borrow().clone();
            let start = JsValue::from_str("phonemizer gave no output");
            return Err(if errors.length() > 0 { error_of(&[&start, &JsValue::from_str(": "), &errors.join(" ").into()], None)? } else { error_of(&[&start], None)? });
        }
        let ids = get(&result, "phoneme_ids");
        Ok(if ids.is_truthy() { ids } else { Array::new().into() })
    }
}

/// One phonemizer: `host` is `{create(token), fetch(name), abort()}` (see phonemizer.js), `names` the extra dictionaries.
#[wasm_bindgen]
pub struct VoicePhonemizer { inner: Rc<Inner> }

#[wasm_bindgen]
impl VoicePhonemizer {
    #[wasm_bindgen(constructor)]
    pub fn new(limit: f64, host: JsValue, names: JsValue) -> R<VoicePhonemizer> {
        let plan = runtime::phonemizer_runtime_new(limit);
        if plan.is_null() { return Err(error("Cannot allocate phonemizer state")); }
        Ok(VoicePhonemizer { inner: Rc::new(Inner { plan, host, names, module: RefCell::new(JsValue::NULL), line: RefCell::new(JsValue::NULL),
            errors: RefCell::new(Array::new()), generation: Cell::new(f64::NAN), downloaded: RefCell::new(HashMap::new()) }) })
    }
    /// Builds the first module; a failure releases the plan.
    pub fn start(&self) -> js_sys::Promise {
        let inner = self.inner.clone();
        eager(async move {
            // The body of the first build is this promise's own, as `await build()` was the creator's single wait.
            if let Err(error) = inner.clone().build().await { inner.close(); return Err(error); }
            Ok(JsValue::UNDEFINED)
        })
    }
    /// The phoneme ids of `text`; the host runs one at a time.
    pub fn phonemize(&self, text: JsValue, espeak_voice: JsValue) -> js_sys::Promise { eager(self.inner.clone().phonemize(text, espeak_voice)) }
    /// The module `token` printed a line: only the current module is heard.
    pub fn print(&self, token: f64, text: JsValue) { if self.inner.current(token) { *self.inner.line.borrow_mut() = text; } }
    pub fn print_error(&self, token: f64, text: JsValue) { if self.inner.current(token) { let errors = self.inner.errors.borrow().clone(); errors.push(&text); } }
    pub fn destroy(&self) -> R<()> {
        self.inner.close();
        method(&self.inner.host, "abort", &[])?;
        let old = self.inner.module.replace(JsValue::NULL);
        terminate(&old);
        self.inner.downloaded.borrow_mut().clear();
        Ok(())
    }
}
