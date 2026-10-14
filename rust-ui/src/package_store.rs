//! The two stores behind one engine: Piper models and the shared Supertonic pack answer separately, and a store that fails to
//! answer contributes nothing to the listing.
use wasm_bindgen::{prelude::*,JsCast};
use wasm_bindgen_futures::JsFuture;
use js_sys::{Array,Promise};
use crate::host::{get,read,method};

type R<T=JsValue>=Result<T,JsValue>;
fn st(v:&str)->JsValue{JsValue::from_str(v)}
fn t(v:&JsValue)->bool{v.is_truthy()}
fn arr(v:&JsValue)->Array{v.clone().unchecked_into()}
async fn both(s:&JsValue,second:&str)->R<(JsValue,JsValue)>{
 let pair=Array::of2(&method(&read(s,"piper")?,"list",&[])?,&method(&read(s,"supertonic")?,second,&[])?);
 let results=arr(&JsFuture::from(Promise::all_settled(&pair)).await?);
 Ok((results.get(0),results.get(1)))
}
fn fulfilled(outcome:&JsValue)->bool{get(outcome,"status")==st("fulfilled")}
/// Installed model keys of both runtimes.
#[wasm_bindgen]
pub async fn package_list(s:JsValue,pack:JsValue)->R{
 let (piper,shared)=both(&s,"installed").await?;let out=js_sys::Set::new(&JsValue::UNDEFINED);
 if fulfilled(&piper){for id in js_sys::try_iter(&get(&piper,"value"))?.ok_or_else(||JsValue::from(js_sys::TypeError::new("not iterable")))?{out.add(&id?);}}
 if fulfilled(&shared)&&t(&get(&shared,"value")){out.add(&pack);}
 Ok(out.into())
}
/// Ids of the voices whose files are present: a Supertonic style needs its profile file, a Piper voice its model.
#[wasm_bindgen]
pub async fn package_voices(s:JsValue,voices:JsValue)->R{
 let (piper,styles)=both(&s,"availableStyles").await?;let out=js_sys::Set::new(&JsValue::UNDEFINED);
 let list=arr(&voices);
 for i in 0..list.length(){
  let voice=list.get(i);
  let present=if read(&voice,"runtime")?==st("supertonic3"){fulfilled(&styles)&&t(&method(&get(&styles,"value"),"has",&[&read(&voice,"style")?])?)}
   else{fulfilled(&piper)&&t(&method(&get(&piper,"value"),"has",&[&read(&voice,"piperId")?])?)};
  if present{out.add(&read(&voice,"id")?);}
 }
 Ok(out.into())
}
