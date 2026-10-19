//! Leases for decoded covers and immutable paper-tone measurement identities.
//! Browser callbacks are GC-owned bound functions, not rooted Rust futures.
use wasm_bindgen::{prelude::*, JsCast};
use js_sys::{Array, Map, Object, Promise, Set, WeakMap};
use crate::host::*;
type R<T> = Result<T, JsValue>;
thread_local! {
    static IMAGES: Map = Map::new();
    static TONES: WeakMap = WeakMap::new();
    static PENDING: WeakMap = WeakMap::new();
    static SHARED: WeakMap = WeakMap::new();
}
fn state(fields: &[(&str, JsValue)]) -> R<JsValue> {
    let value: JsValue = Object::new().into();
    for (name, field) in fields { set(&value,name,field)?; }
    Ok(value)
}
fn key(value: &JsValue) -> Object { value.clone().unchecked_into() }
fn object_key(value: &JsValue) -> bool { value.is_object() || value.is_function() }
fn bound(host: &JsValue, name: &str, value: &JsValue) -> R<JsValue> {
    method(&read(host,name)?,"bind",&[&JsValue::UNDEFINED,value])
}
fn evict(entry: &JsValue) -> R<()> {
    let url = read(entry,"url")?;
    IMAGES.with(|images| { if images.get(&url) == *entry { images.delete(&url); } });
    Ok(())
}
fn notify(entry: &JsValue, failed: bool) -> R<()> {
    let listeners: Set = read(entry,"listeners")?.unchecked_into();
    let mut error = None;
    // Preserve live Set iteration: a callback can acquire/release another lease.
    for listener in js_sys::try_iter(listeners.as_ref())?.unwrap() {
        let listener = listener?;
        let result = if failed { method(&listener,"onError",&[]) }
            else { method(&listener,"onImage",&[&read(entry,"image")?,entry]) };
        if let Err(cause) = result { if error.is_none() { error = Some(cause); } }
    }
    listeners.clear();
    if let Some(error) = error { Err(error) } else { Ok(()) }
}
#[wasm_bindgen]
pub fn cover_image_failed(entry: JsValue) -> R<()> {
    clear_timeout(&read(&entry,"timer")?)?;
    set(&entry,"failed",&JsValue::TRUE)?; evict(&entry)?;
    notify(&entry,true)
}
#[wasm_bindgen]
pub fn cover_image_loaded(entry: JsValue, texture: JsValue) -> R<()> {
    clear_timeout(&read(&entry,"timer")?)?;
    let result = if truthy(&read(&entry,"failed")?) || !truthy(&read(&entry,"users")?) { Ok(()) }
        else { set(&entry,"image",&read(&texture,"image")?)?; notify(&entry,false) };
    // A listener failure must not leak the loader's temporary GPU texture.
    method(&texture,"dispose",&[])?;
    result
}
#[wasm_bindgen]
pub fn cover_image_release(lease: JsValue) -> R<()> {
    if truthy(&read(&lease,"released")?) { return Ok(()); }
    set(&lease,"released",&JsValue::TRUE)?;
    let entry = read(&lease,"entry")?;
    method(&read(&entry,"listeners")?,"delete",&[&read(&lease,"listener")?])?;
    let users = num(&read(&entry,"users")?) - 1.0; set(&entry,"users",&users.into())?;
    if users == 0.0 {
        let released = method(&read(&entry,"host")?,"releaseRaster",&[&entry]);
        clear_timeout(&read(&entry,"timer")?)?; evict(&entry)?;
        released?;
    }
    Ok(())
}
#[wasm_bindgen]
pub fn cover_image_acquire(host: JsValue, url: JsValue, on_image: JsValue, on_error: JsValue) -> R<JsValue> {
    let mut entry = IMAGES.with(|images| images.get(&url));
    let start = entry.is_undefined();
    if start {
        entry = state(&[("host",host.clone()),("url",url.clone()),("image",JsValue::NULL),
            ("failed",JsValue::FALSE),("users",0.0.into()),("listeners",Set::new(&JsValue::UNDEFINED).into()),("timer",0.0.into())])?;
        IMAGES.with(|images| images.set(&url,&entry));
    }
    let listener = state(&[("onImage",on_image), ("onError",on_error)])?;
    set(&entry,"users",&(num(&read(&entry,"users")?) + 1.0).into())?;
    let lease = state(&[("entry",entry.clone()),("listener",listener.clone()),("released",JsValue::FALSE)])?;
    let setup = (|| -> R<()> {
        if truthy(&read(&entry,"image")?) { call(&read(&listener,"onImage")?,"onImage",&[&read(&entry,"image")?,&entry])?; }
        else if truthy(&read(&entry,"failed")?) { call(&read(&listener,"onError")?,"onError",&[])?; }
        else { method(&read(&entry,"listeners")?,"add",&[&listener])?; }
        if start {
            let fail = bound(&host,"failed",&entry)?;
            let prefix = text_of(&url).to_ascii_lowercase();
            if !prefix.starts_with("blob:") && !prefix.starts_with("data:") {
                set(&entry,"timer",&set_timeout(&fail,6000.0)?)?;
            }
            method(&host,"load",&[&url,&bound(&host,"loaded",&entry)?,&fail])?;
        }
        Ok(())
    })();
    if let Err(error) = setup { let _ = cover_image_release(lease); return Err(error); }
    bound(&host,"release",&lease)
}
#[wasm_bindgen]
pub fn cover_image_loaded_for(url: JsValue) -> JsValue {
    get(&IMAGES.with(|images| images.get(&url)),"image")
}
#[wasm_bindgen]
pub fn cover_warm_done(warm: JsValue, image: JsValue) -> R<()> {
    set(&warm,"completed",&JsValue::TRUE)?;
    let release = bound(&read(&warm,"host")?,"warmRelease",&warm)?;
    let result = state(&[("image",image),("release",release)])?;
    set(&warm,"result",&result)?;
    if truthy(&read(&warm,"release")?) { call(&read(&warm,"resolve")?,"resolve",&[&result])?; }
    Ok(())
}
#[wasm_bindgen]
pub fn cover_warm_failed(warm: JsValue) -> R<()> { cover_warm_done(warm,JsValue::NULL) }
#[wasm_bindgen]
pub fn cover_warm_release(warm: JsValue) -> R<()> {
    call_opt(&read(&warm,"release")?,"release",&[])?; Ok(())
}
#[wasm_bindgen]
pub fn cover_image_warm(host: JsValue, url: JsValue) -> Promise {
    if !truthy(&url) { return Promise::resolve(&JsValue::NULL); }
    Promise::new(&mut |resolve,reject| {
        let setup = (|| -> R<()> {
            let warm = state(&[("host",host.clone()),("resolve",resolve.into()),("completed",JsValue::FALSE),
                ("release",JsValue::UNDEFINED),("result",JsValue::UNDEFINED)])?;
            let release = cover_image_acquire(host.clone(),url.clone(),bound(&host,"warmDone",&warm)?,bound(&host,"warmFailed",&warm)?)?;
            set(&warm,"release",&release)?;
            if truthy(&read(&warm,"completed")?) { call(&read(&warm,"resolve")?,"resolve",&[&read(&warm,"result")?])?; }
            Ok(())
        })();
        if let Err(error) = setup { let _ = reject.call1(&JsValue::UNDEFINED,&error); }
    })
}

#[wasm_bindgen]
pub fn paper_tone_key(source: JsValue, token: JsValue) -> JsValue {
    if object_key(&token) { token } else { source }
}
fn sampling_key(source: JsValue, token: JsValue) -> JsValue {
    let token = paper_tone_key(source,token);
    let shared = SHARED.with(|shared| shared.get(&key(&token)));
    if truthy(&shared) { shared } else { token }
}
#[wasm_bindgen]
pub fn paper_tone_share(target: JsValue, source: JsValue) -> bool {
    if !object_key(&target) || !object_key(&source) { return false; }
    let source = sampling_key(JsValue::NULL,source);
    let target_key = key(&target);
    if target == source || TONES.with(|tones| tones.has(&target_key)) || PENDING.with(|pending| pending.has(&target_key)) { return false; }
    SHARED.with(|shared| {
        if shared.has(&target_key) { shared.get(&target_key) == source }
        else { shared.set(&target_key,&source); true }
    })
}
#[wasm_bindgen]
pub fn paper_tone_read(host: JsValue, source: JsValue, token: JsValue) -> JsValue {
    let token = key(&sampling_key(source.clone(),token));
    if TONES.with(|tones| tones.has(&token)) { return TONES.with(|tones| tones.get(&token)); }
    let tone = method(&host,"sample",&[&source]).unwrap_or(JsValue::NULL);
    TONES.with(|tones| tones.set(&token,&tone)); tone
}
fn aborted(state: &JsValue) -> bool { truthy(&get(&get(state,"signal"),"aborted")) }
fn valid_tone(tone: &JsValue) -> bool {
    if tone.is_null() { return true; }
    if !Array::is_array(tone) || num(&get(tone,"length")) != 3.0 { return false; }
    (0..3).all(|i| get_at(tone,i).as_f64().is_some_and(|n| n.is_finite() && n.fract()==0.0 && (0.0..=255.0).contains(&n)))
}
#[wasm_bindgen]
pub fn paper_tone_measured(job: JsValue, result: JsValue) -> R<bool> {
    let entries: Array = read(&job,"missing")?.unchecked_into();
    if aborted(&job) || !Array::is_array(&result) || num(&get(&result,"length")) != entries.length() as f64 { return Ok(false); }
    let result: Array = result.unchecked_into();
    if !result.iter().all(|tone| valid_tone(&tone)) { return Ok(false); }
    for (i,entry) in entries.iter().enumerate() {
        let tone = result.get(i as u32);
        if !tone.is_null() { Object::freeze(&key(&tone)); }
        TONES.with(|tones| tones.set(&key(&get(&entry,"toneKey")),&tone));
    }
    Ok(true)
}
#[wasm_bindgen]
pub fn paper_tone_clear_pending(job: JsValue) -> R<()> {
    let promise = read(&job,"promise")?;
    for entry in Array::from(&read(&job,"missing")?).iter() {
        let token = key(&get(&entry,"toneKey"));
        PENDING.with(|pending| { if pending.get(&token) == promise { pending.delete(&token); } });
    }
    Ok(())
}
#[wasm_bindgen]
pub fn paper_tone_after_pending(job: JsValue) -> R<JsValue> {
    if aborted(&job) { return Ok(JsValue::FALSE); }
    let entries: Array = read(&job,"entries")?.unchecked_into();
    let missing = Array::new();
    for entry in entries.iter() { if !TONES.with(|tones| tones.has(&key(&get(&entry,"toneKey")))) { missing.push(&entry); } }
    if missing.length()==0 { return Ok((entries.length()>0).into()); }
    set(&job,"missing",missing.as_ref())?;
    let host = read(&job,"host")?;
    let measured = method(&host,"measure",&[missing.as_ref(),&read(&job,"signal")?])?;
    let promise = method(&Promise::resolve(&measured),"then",&[&bound(&host,"measured",&job)?])?;
    set(&job,"promise",&promise)?;
    for entry in missing.iter() { PENDING.with(|pending| pending.set(&key(&get(&entry,"toneKey")),&promise)); }
    method(&promise,"finally",&[&bound(&host,"clearPending",&job)?])
}
#[wasm_bindgen]
pub fn paper_tone_prepare(host: JsValue, snapshot: JsValue, signal: JsValue) -> R<JsValue> {
    if truthy(&get(&signal,"aborted")) || !["Worker","OffscreenCanvas","createImageBitmap"].iter().all(|name| get(&global(),name).is_function()) {
        return Ok(Promise::resolve(&JsValue::FALSE).into());
    }
    let dedup = Map::new();
    for entry in [snapshot.clone(),get(&snapshot,"paper")] {
        let source = get(&entry,"source"); let token = get(&entry,"toneKey");
        if truthy(&source) && object_key(&token) {
            let token = sampling_key(source.clone(),token);
            dedup.set(&token,&state(&[("source",source),("toneKey",token.clone())])?);
        }
    }
    let entries = Array::from(&method(dedup.as_ref(),"values",&[])?);
    let existing = Array::new();
    for entry in entries.iter() {
        let pending = PENDING.with(|pending| pending.get(&key(&get(&entry,"toneKey"))));
        if truthy(&pending) { existing.push(&pending); }
    }
    let job = state(&[("host",host.clone()),("entries",entries.into()),("signal",signal)])?;
    if existing.length()>0 {
        method(&Promise::all(existing.as_ref()),"then",&[&bound(&host,"afterPending",&job)?])
    } else { Ok(Promise::resolve(&paper_tone_after_pending(job)?).into()) }
}
