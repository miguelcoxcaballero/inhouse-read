//! Lazy reader ownership after a module is available. The pre-WASM stand-in
//! and this policy share one plain state; adoption cannot lose an in-flight
//! Promise. Import, engine and browser callbacks stay owned by JavaScript.
use wasm_bindgen::prelude::*;
use js_sys::{Array, Reflect};
use crate::host::*;
type R<T> = Result<T, JsValue>;
fn optional(value:&JsValue,key:&str)->R<JsValue>{if absent(value){Ok(JsValue::UNDEFINED)}else{read(value,key)}}
#[wasm_bindgen]
pub fn reader_lazy_load(state:&JsValue,kit:&JsValue,reload:bool)->R<JsValue>{
 let previous=read(state,"loading")?;if truthy(&previous){return Ok(previous);}
 let pending=method(kit,"begin",&[])?;
 let pending=method(&pending,"then",&[&read(kit,"loaded")?])?;
 let pending=method(&pending,"catch",&[&method(kit,"failure",&[&reload.into()])?])?;
 set(state,"loading",&pending)?;Ok(pending)
}
#[wasm_bindgen]
pub fn reader_lazy_loaded(state:&JsValue,parts:&JsValue)->R<JsValue>{
 // Promise.all always supplies the two browser values in this order.
 let reader_experience=read(&read(parts,"0")?,"ReaderExperience")?;
 if !truthy(&read(parts,"1")?){return Err(js_sys::Error::new("Rust UI is unavailable").into());}
 let previous=read(state,"experience")?;if truthy(&previous){return Ok(previous);}
 let constructor=reader_experience.dyn_ref::<js_sys::Function>().ok_or_else(||js_sys::TypeError::new("ReaderExperience is not a constructor"))?;
 let args=Array::new();args.push(&read(state,"reader")?);args.push(&read(state,"options")?);
 let experience=Reflect::construct(constructor,&args)?;set(state,"experience",&experience)?;Ok(experience)
}
#[wasm_bindgen]
pub fn reader_lazy_failed(state:&JsValue,kit:&JsValue,reload:bool,error:JsValue)->R<JsValue>{
 set(state,"loading",&JsValue::NULL)?;
 if reload{method(kit,"reload",&[])?;}
 Err(error)
}
#[wasm_bindgen]
pub fn reader_lazy_prefetch(state:&JsValue,kit:&JsValue)->R<JsValue>{
 let pending=reader_lazy_load(state,kit,false)?;method(&pending,"catch",&[&read(kit,"ignore")?])
}
#[wasm_bindgen]
pub fn reader_lazy_get(state:&JsValue,name:&str,kit:&JsValue)->R<JsValue>{
 let experience=read(state,"experience")?;
 if name=="loaded"{return Ok(truthy(&experience).into());}
 if name=="preferences"{return if truthy(&experience){read(&experience,"preferences")}else{crate::reading_preferences_policy::stored(&read(kit,"normalize")?)};}
 let value=optional(&experience,name)?;
 if absent(&value){read(&read(state,"idle")?,name)}else{Ok(value)}
}
#[wasm_bindgen]
pub fn reader_lazy_reload_preferences(state:&JsValue,kit:&JsValue)->R<()>{
 let experience=read(state,"experience")?;
 if truthy(&experience){let value=crate::reading_preferences_policy::stored(&read(kit,"normalize")?)?;set(&experience,"preferences",&value)?;}
 Ok(())
}
#[wasm_bindgen]
pub fn reader_lazy_close_voice(state:&JsValue)->R<()>{
 let experience=read(state,"experience")?;
 if optional(&experience,"closeVoice")?.is_function(){method(&experience,"closeVoice",&[])?;}
 else{method_opt(&optional(&experience,"voice")?,"stop",&[])?;}
 Ok(())
}
#[wasm_bindgen]
pub fn reader_lazy_dispatch(state:&JsValue,name:&str,args:&Array,optional_method:bool)->R<JsValue>{
 let experience=read(state,"experience")?;if absent(&experience){return Ok(JsValue::UNDEFINED);}
 let args=args.iter().collect::<Vec<_>>();let args=args.iter().collect::<Vec<_>>();
 if optional_method{Ok(method_opt(&experience,name,&args)?.unwrap_or(JsValue::UNDEFINED))}else{method(&experience,name,&args)}
}
