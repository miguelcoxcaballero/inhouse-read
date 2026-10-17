//! Validated book appearance/positions; numerical colour kernels stay in Core.
use wasm_bindgen::{prelude::*,JsCast};
use js_sys::{Array,Object,Reflect};
use crate::host::{read,method,absent,truthy,set};
use crate::cloud_host;
type R<T> = Result<T,JsValue>;
#[wasm_bindgen]
extern "C"{
 #[wasm_bindgen(js_namespace=Number,js_name=isSafeInteger,catch)]fn safe_integer(value:&JsValue)->Result<bool,JsValue>;
 #[wasm_bindgen(js_namespace=Number,js_name=isFinite,catch)]fn finite_number(value:&JsValue)->Result<bool,JsValue>;
 #[wasm_bindgen(js_namespace=Math,js_name=min,catch)]fn minimum(a:f64,b:&JsValue)->Result<JsValue,JsValue>;
 #[wasm_bindgen(js_namespace=Math,js_name=max,catch)]fn maximum(a:f64,b:&JsValue)->Result<JsValue,JsValue>;
}
fn s(value:&str)->JsValue{value.into()}
fn optional(value:&JsValue,key:&str)->R<JsValue>{if absent(value){Ok(JsValue::UNDEFINED)}else{read(value,key)}}
fn present(value:&JsValue,key:&str)->R<bool>{Reflect::has(&if truthy(value){value.clone()}else{Object::new().into()},&s(key))}
fn clamp(value:JsValue,low:f64,high:f64)->R<JsValue>{maximum(low,&minimum(high,&value)?)}
fn fields(entries:&[(&str,JsValue)])->R<JsValue>{let values=Array::new();for(key,value)in entries{cloud_host::data_entry(&values,&s(key),value);}Ok(Object::from_entries(values.as_ref())?.into())}
#[wasm_bindgen]
pub fn book_spine_finish(value:JsValue)->JsValue{if value==s("gold")||value==s("silver"){value}else{s("matte")}}
#[wasm_bindgen]
pub fn book_surface_finish(value:JsValue,fallback:JsValue,finishes:JsValue)->R<JsValue>{
 if value.is_string()&&Object::has_own(finishes.unchecked_ref(),&value){return Ok(value);}
 Ok(if fallback.is_string()&&Object::has_own(finishes.unchecked_ref(),&fallback){fallback}else{s("satin")})
}
#[wasm_bindgen]
pub fn book_shelf_position(value:JsValue)->R<JsValue>{
 if !truthy(&value)||!safe_integer(&read(&value,"shelf")?)?{return Ok(JsValue::NULL);}
 // ToNumeric preserves the second getter's relational coercion, including BigInt.
 let shelf_test=crate::library_store::to_numeric(read(&value,"shelf")?)?;
 if shelf_test.lt(&JsValue::from_f64(0.0))||!finite_number(&read(&value,"x")?)?{return Ok(JsValue::NULL);}
 let shelf=read(&value,"shelf")?;let x=clamp(read(&value,"x")?,0.0,1.0)?;
 fields(&[("shelf",shelf),("x",x)])
}
#[wasm_bindgen]
pub fn book_spine_customization(book:JsValue,env:JsValue)->R<JsValue>{
 let result:JsValue=Object::new().into();
 if optional(&book,"shelfPosition")?.is_null(){set(&result,"shelfPosition",&JsValue::NULL)?;}
 else{let position=book_shelf_position(optional(&book,"shelfPosition")?)?;if truthy(&position){set(&result,"shelfPosition",&position)?;}}
 for key in ["spineColorOverride","spineTextColor"]{
  if optional(&book,key)?.is_null(){set(&result,key,&JsValue::NULL)?;}
  else if truthy(&method(&env,"normalizedHex",&[&optional(&book,key)?])?){set(&result,key,&method(&env,"normalizedHex",&[&read(&book,key)?])?)?;}
 }
 for key in ["spineFinish","spineTextFinish"]{if present(&book,key)?{set(&result,key,&book_spine_finish(read(&book,key)?))?;}}
 let finishes=read(&env,"finishes")?;
 if present(&book,"coverFinish")?{set(&result,"coverFinish",&book_surface_finish(read(&book,"coverFinish")?,s("satin"),finishes.clone())?)?;}
 if present(&book,"coverRelief")?{set(&result,"coverRelief",&method(&env,"normalizeCoverRelief",&[&read(&book,"coverRelief")?])?)?;}
 if present(&book,"pageEdgeFinish")?{set(&result,"pageEdgeFinish",&book_surface_finish(read(&book,"pageEdgeFinish")?,s("satin"),finishes.clone())?)?;}
 if present(&book,"spineSurfaceFinish")?{set(&result,"spineSurfaceFinish",&book_surface_finish(read(&book,"spineSurfaceFinish")?,s("matte"),finishes)?)?;}
 if optional(&book,"spineEngraved")?.as_bool().is_some(){set(&result,"spineEngraved",&read(&book,"spineEngraved")?)?;}
 if optional(&book,"spineTitleOverride")?.is_string(){set(&result,"spineTitleOverride",&method(&read(&book,"spineTitleOverride")?,"slice",&[&JsValue::from_f64(0.0),&JsValue::from_f64(120.0)])?)?;}
 if present(&book,"author")?{set(&result,"author",&crate::book_title::book_normalize_author(read(&book,"author")?)?)?;}
 let family=optional(&book,"spineFontFamily")?;
 if ["Playfair Display","Lora","Cormorant Garamond","DM Sans","Montserrat","Oswald"].iter().any(|font|family==s(font)){set(&result,"spineFontFamily",&read(&book,"spineFontFamily")?)?;}
 if finite_number(&optional(&book,"spineFontSize")?)?{set(&result,"spineFontSize",&clamp(read(&book,"spineFontSize")?,8.0,48.0)?)?;}
 if finite_number(&optional(&book,"spineAuthorFontSize")?)?{set(&result,"spineAuthorFontSize",&clamp(read(&book,"spineAuthorFontSize")?,6.0,36.0)?)?;}
 Ok(result)
}
