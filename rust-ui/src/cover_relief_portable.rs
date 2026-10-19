//! Portable cover selections shared by the shelf and Drive/reader module.
//! No pixel kernels or browser scheduling are needed to normalize saved state.
use wasm_bindgen::prelude::*;
use js_sys::{Array,Math,Object};
use crate::host::*;
const LEGACY_IDS:[&str;8]=["lettering","foil","frame","emblem","varnish","band","grain","panel"];
fn colour_id_text(id:&str)->bool{matches!(id,"color-1"|"color-2"|"color-3"|"color-4"|"color-5"|"color-6"|"color-7"|"color-8"|"color-9"|"color-10")}
pub(super) fn colour_id(value:&JsValue)->bool{value.as_string().is_some_and(|id|colour_id_text(&id))}
fn known_id(value:&JsValue)->bool{value.as_string().is_some_and(|id|colour_id_text(&id)||LEGACY_IDS.contains(&id.as_str()))}
pub(super) fn record(fields:&[(&str,JsValue)])->Result<JsValue,JsValue>{let value=Object::new();for(key,item)in fields{set(&value,key,item)?;}Ok(value.into())}
#[wasm_bindgen]
extern "C"{
 #[wasm_bindgen(catch,js_name=Number)]fn relief_number(value:&JsValue)->Result<f64,JsValue>;
}

fn normalise(value:&JsValue)->Result<JsValue,JsValue>{
 if !truthy(value)||!value.is_object()||value.is_function(){return Ok(JsValue::NULL);}
 if Array::is_array(&read(value,"layers")?){
  let sliced=method(&read(value,"layers")?,"slice",&[&0.into(),&10.into()])?;
  let iter=js_sys::try_iter(&boxed(&sliced))?.ok_or_else(||JsValue::from(js_sys::TypeError::new("value.layers.slice is not a function or its return value is not iterable")))?;
  let layers=Array::new();let mut colours=std::collections::HashSet::new();
  for entry in iter{
   let entry=entry?;
   if !truthy(&entry)||Array::is_array(&read(&entry,"layers")?){continue;}
   let layer=normalise(&entry)?;
   if !truthy(&layer)||!colour_id(&read(&layer,"id")?){continue;}
   let colour=read(&layer,"color")?.as_string().unwrap_or_default();
   if colours.insert(colour){layers.push(&layer);}
  }
  return if layers.length()>0{record(&[("layers",layers.into())])}else{Ok(JsValue::NULL)};
 }
 if !known_id(&read(value,"id")?){return Ok(JsValue::NULL);}
 let initial=read(value,"strength")?;
 let number=if absent(&initial){0.75}else{relief_number(&read(value,"strength")?)?};
 let strength=if number.is_finite(){Math::round(jmin(1.0,jmax(0.0,number))*100.0)/100.0}else{0.75};
 if colour_id(&read(value,"id")?){
  if !read(value,"color")?.is_string(){return Ok(JsValue::NULL);}
  let colour=read(value,"color")?.as_string().unwrap_or_default();
  if colour.len()!=7||!colour.starts_with('#')||!colour.as_bytes()[1..].iter().all(u8::is_ascii_hexdigit){return Ok(JsValue::NULL);}
  let tolerance=read(value,"tolerance")?;
  let Some(tolerance)=tolerance.as_f64().filter(|n|n.is_finite()&&*n>=1.0&&*n<=12.0)else{return Ok(JsValue::NULL);};
  let id=read(value,"id")?;
  let colour=method(&read(value,"color")?,"toLowerCase",&[])?;
  return record(&[("id",id),("color",colour),("tolerance",(Math::round(tolerance*100.0)/100.0).into()),("strength",strength.into())]);
 }
 record(&[("id",read(value,"id")?),("strength",strength.into())])
}

#[wasm_bindgen]
pub fn normalize_cover_relief(value:&JsValue)->Result<JsValue,JsValue>{normalise(value)}

#[wasm_bindgen]
pub fn cover_relief_layers(value:&JsValue)->Result<Array,JsValue>{
 let normalized=normalise(value)?;
 if truthy(&normalized){
  let layers=read(&normalized,"layers")?;
  if truthy(&layers){return Ok(layers.unchecked_into());}
  if colour_id(&read(&normalized,"id")?){let result=Array::new();result.push(&normalized);return Ok(result);}
 }
 Ok(Array::new())
}

