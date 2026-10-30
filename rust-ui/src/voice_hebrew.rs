//! The Hebrew phonemizer of the synthesis worker and the Android client (hebrew.js createHebrewPhonemizer): Nakdimon's
//! ONNX session restores the niqqud a text lacks, then the official rules turn it into the voice's phoneme ids. One
//! text at a time; a destroyed phonemizer answers nothing more and releases its session after the work it had queued.
use std::cell::{Cell, RefCell};
use std::rc::Rc;
use js_sys::{Array, ArrayBuffer, JsString, Object, Promise, Reflect, Set, Uint8Array};
use wasm_bindgen::prelude::*;
use wasm_bindgen::JsCast;
use crate::eager::{eager, settled};
use crate::host::{get, get_at, method, method_opt, read, set, text_value};
use crate::voice_kernels as kernels;

type R<T = JsValue> = Result<T, JsValue>;
fn error(message: &str) -> JsValue { js_sys::Error::new(message).into() }
fn released() -> JsValue { error("Hebrew phonemizer was released") }
fn text(value: &str) -> JsValue { JsValue::from_str(value) }
/// `/[ְ-ׇּֿׁׂ]/u.test(text)`: the text is already pointed.
fn pointed(units: &[u16]) -> bool { units.iter().any(|&unit| matches!(unit, 0x5b0..=0x5bc | 0x5bf | 0x5c1 | 0x5c2 | 0x5c7)) }
/// `Array.from(text)`: one string per code point, a lone surrogate on its own.
fn letters(value: &JsString) -> R<Array> {
    let units: Vec<u16> = value.iter().collect();
    let out = Array::new();
    let mut at = 0;
    while at < units.len() {
        let pair = (0xd800..=0xdbff).contains(&units[at]) && at + 1 < units.len() && (0xdc00..=0xdfff).contains(&units[at + 1]);
        let end = if pair { at + 2 } else { at + 1 };
        out.push(&JsString::from_char_code(&units[at..end]).into());
        at = end;
    }
    Ok(out)
}

struct Inner { ort: JsValue, session: JsValue, id_map: JsValue, kit: JsValue, destroyed: Cell<bool>, chain: RefCell<JsValue>, destruction: RefCell<JsValue> }

async fn phonemize(inner: Rc<Inner>, value: JsValue) -> R {
    if inner.destroyed.get() { return Err(released()); }
    let mut value: JsString = if value.is_truthy() { text_value(&value).unchecked_into() } else { JsString::from("") };
    let units: Vec<u16> = value.iter().collect();
    if !pointed(&units) && !units.is_empty() {
        let letters = letters(&value)?;
        let dims = Array::of2(&JsValue::from_f64(1.0), &JsValue::from_f64(f64::from(letters.length())));
        let constructor = read(&inner.ort, "Tensor")?.dyn_into::<js_sys::Function>().map_err(|_| JsValue::from(js_sys::TypeError::new("ort.Tensor is not a constructor")))?;
        let input = Reflect::construct(&constructor, &Array::of3(&text("float32"), &kernels::voice_host_nakdimon_ids(value.clone().into())?.into(), &dims))?;
        let mut outputs = JsValue::UNDEFINED;
        let merged = async {
            let feeds = Object::new();
            Reflect::set(&feeds, &get_at(&read(&inner.session, "inputNames")?, 0), &input)?;
            outputs = settled(method(&inner.session, "run", &[&feeds.into()])?).await?;
            if inner.destroyed.get() { return Err(released()); }
            kernels::voice_host_merge_niqqud(letters.into(), outputs.clone())
        }.await;
        // Every tensor once, whatever happened: the input and each output.
        let tensors = Set::new(&JsValue::UNDEFINED);
        tensors.add(&input);
        let found = if outputs.is_truthy() { Object::values(&Object::from(outputs.clone())) } else { Array::new() };
        for tensor in found.iter() { tensors.add(&tensor); }
        for tensor in tensors.values().into_iter().flatten() { let _ = method_opt(&tensor, "dispose", &[]); }
        value = merged?;
    }
    kernels::voice_host_ipa_ids(kernels::voice_host_hebrew_ipa(value.into())?.into(), inner.id_map.clone()).map(JsValue::from)
}

/// A Hebrew phonemizer: `phonemize(text)` runs after the texts asked before it, `destroy()` once.
#[wasm_bindgen]
pub struct VoiceHebrew { inner: Rc<Inner> }

#[wasm_bindgen]
impl VoiceHebrew {
    pub fn phonemize(&self, value: JsValue) -> R {
        let inner = self.inner.clone();
        let chain = self.inner.chain.borrow().clone();
        let run = Closure::once_into_js(move || -> JsValue { eager(phonemize(inner, value)).into() });
        let job = method(&chain, "then", &[&run])?;
        *self.inner.chain.borrow_mut() = method(&job, "catch", &[&get(&self.inner.kit, "noop")])?;
        Ok(job)
    }
    pub fn destroy(&self) -> R {
        self.inner.destroyed.set(true);
        let current = self.inner.destruction.borrow().clone();
        if current.is_truthy() { return Ok(current); }
        let session = self.inner.session.clone();
        let release = Closure::once_into_js(move || -> Result<JsValue, JsValue> { method(&session, "release", &[]) });
        let destruction = method(&self.inner.chain.borrow().clone(), "then", &[&release])?;
        *self.inner.destruction.borrow_mut() = destruction.clone();
        Ok(destruction)
    }
}

/// `createHebrewPhonemizer({ort, model, config})`: cached Nakdimon bytes are passed from the page; nothing is downloaded.
#[wasm_bindgen]
pub fn voice_hebrew_create(options: JsValue, kit: JsValue) -> Promise {
    eager(async move {
        let (ort, model, config) = (read(&options, "ort")?, read(&options, "model")?, read(&options, "config")?);
        if !model.is_instance_of::<ArrayBuffer>() || !get(&model, "byteLength").is_truthy() { return Err(error("Hebrew phonemizer model is not available")); }
        let id_map = get(&config, "phoneme_id_map");
        let complete = ["_", "^", "$"].iter().all(|mark| { let ids = get(&id_map, mark); Array::is_array(&ids) && get(&ids, "length").is_truthy() });
        if !complete { return Err(error("Hebrew phoneme id map is not available")); }
        let settings = Object::new();
        set(&settings, "executionProviders", &Array::of1(&text("wasm")).into())?;
        set(&settings, "graphOptimizationLevel", &text("all"))?;
        set(&settings, "enableCpuMemArena", &JsValue::FALSE)?;
        set(&settings, "enableMemPattern", &JsValue::FALSE)?;
        let bytes: JsValue = Uint8Array::new(&model).into();
        let session = settled(method(&read(&ort, "InferenceSession")?, "create", &[&bytes, &settings.into()])?).await?;
        let inputs = get(&read(&session, "inputNames")?, "length").is_truthy();
        let mut heads = true;
        if inputs {
            let outputs = read(&session, "outputNames")?;
            for name in ["N", "D", "S"] {
                if !method_opt(&outputs, "includes", &[&text(name)])?.is_some_and(|found| found.is_truthy()) { heads = false; break; }
            }
        }
        if !inputs || !heads {
            let release = method(&session, "release", &[])?;
            settled(method(&release, "catch", &[&get(&kit, "noop")])?).await?;
            return Err(error("Nakdimon session has invalid inputs or outputs"));
        }
        let inner = Inner { ort, session, id_map, kit, destroyed: Cell::new(false), chain: RefCell::new(Promise::resolve(&JsValue::UNDEFINED).into()), destruction: RefCell::new(JsValue::NULL) };
        Ok(VoiceHebrew { inner: Rc::new(inner) }.into())
    })
}
