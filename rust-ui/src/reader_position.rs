//! A layout notification without an anchor must never replace a committed
//! reading position. All strings and locator identities stay in UTF-16.
use wasm_bindgen::{prelude::*,JsCast};
use js_sys::{Array,Object,JsString};
use crate::host::{read,absent,truthy,jmax,jmin};
use crate::cloud_host as c;
type R<T>=Result<T,JsValue>;
fn object(fields:&[(&str,JsValue)])->R<JsValue>{let entries=Array::new();for(k,v)in fields{c::data_entry(&entries,&(*k).into(),v);}Ok(Object::from_entries(entries.as_ref())?.into())}
fn opt(v:&JsValue,k:&str)->R<JsValue>{if absent(v){Ok(JsValue::UNDEFINED)}else{read(v,k)}}
fn integer(v:&JsValue)->Option<f64>{v.as_f64().filter(|v|v.is_finite()&&v.fract()==0.0)}
fn anchor(v:&JsValue)->bool{v.is_string()&&v.unchecked_ref::<JsString>().trim().length()>0}
#[wasm_bindgen]
pub fn reader_persistable_position(location:JsValue)->R<JsValue>{
 if !truthy(&location){return Ok(JsValue::NULL);}
 let fraction=read(&location,"fraction")?;let Some(fraction)=fraction.as_f64().filter(|v|v.is_finite())else{return Ok(JsValue::NULL);};
 let locator=read(&location,"locator")?;
 let valid=if opt(&locator,"kind")?==JsValue::from_str("cfi")&&anchor(&read(&locator,"value")?){
  Some(object(&[("kind","cfi".into()),("value",read(&locator,"value")?)])?)
 }else if opt(&locator,"kind")?==JsValue::from_str("pdf-page")&&integer(&read(&locator,"value")?).is_some_and(|v|v>0.0){
  let mut fields=vec![("kind","pdf-page".into()),("value",read(&locator,"value")?)];
  if integer(&read(&locator,"textOffset")?).is_some_and(|v|v>0.0){fields.push(("textOffset",read(&locator,"textOffset")?));}
  Some(object(&fields)?)
 }else{None};
 if let Some(locator)=valid{object(&[("fraction",jmin(1.0,jmax(0.0,fraction)).into()),("locator",locator)])}else{Ok(JsValue::NULL)}
}
#[wasm_bindgen]
pub fn reader_persistable_relocation(event:JsValue,engine:JsValue)->R<JsValue>{
 let fraction=read(&event,"fraction")?;let cfi=read(&event,"cfi")?;let index=read(&event,"index")?;let offset=read(&event,"textOffset")?;
 let locator=if anchor(&cfi){object(&[("kind","cfi".into()),("value",cfi)])?}
 else if engine==JsValue::from_str("pdf")&&integer(&index).is_some_and(|v|v>=0.0){object(&[("kind","pdf-page".into()),("value",(index.as_f64().unwrap()+1.0).into()),("textOffset",offset)])?}
 else{JsValue::NULL};
 reader_persistable_position(object(&[("fraction",fraction),("locator",locator)])?)
}
