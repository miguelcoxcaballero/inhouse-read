//! Saved plant normalization. Browser catalogue objects retain their identity;
//! Rust owns alias precedence, legacy sizes, seed and material-colour repair.
use wasm_bindgen::prelude::*;
use js_sys::{Array,JsString,Object};
use crate::host::*;
use crate::cloud_host::{copy_data_entries,data_entry};
type R<T>=Result<T,JsValue>;
fn or(value:JsValue,next:impl FnOnce()->R<JsValue>)->R<JsValue>{if truthy(&value){Ok(value)}else{next()}}
#[wasm_bindgen]
pub fn plant_resolve_record(host:&JsValue,given:&JsValue)->R<JsValue>{
 let empty:JsValue=Object::new().into();let entry=if given.is_undefined(){&empty}else{given};
 let explicit=method(host,"getCatalogPlant",&[&read(entry,"catalogId")?])?;if truthy(&explicit){return Ok(explicit);}
 let name=or(read(entry,"variant")?,||or(read(entry,"catalogId")?,||Ok("".into())))?;
 let alias=JsString::from(method(&global(),"String",&[&name])?).trim().to_lower_case();let aliases=read(host,"legacy")?;
 let id=if Object::has_own(aliases.unchecked_ref(),alias.as_ref()){read(&aliases,&alias.as_string().unwrap_or_default())?}else{"monstera".into()};
 method(host,"getCatalogPlant",&[&id])
}
#[wasm_bindgen]
pub fn plant_normalize_record(host:&JsValue,record:&JsValue)->R<JsValue>{
 if !truthy(record)||read(record,"key")?.as_string().is_none()||!truthy(&method(&read(record,"key")?,"trim",&[])?) {return Ok(JsValue::NULL);}
 let plant=plant_resolve_record(host,record)?;let pot=method(host,"getCatalogPot",&[&read(record,"potId")?])?;
 let explicit=if absent(&pot){JsValue::UNDEFINED}else{read(&pot,"id")?};
 let pot_id=or(explicit,||read(&read(host,"referencePots")?,&text_of(&read(&plant,"id")?)))?;
 let size=method(host,"plantDimensions",&[&read(&plant,"id")?,&pot_id])?;
 let entries=Array::new();copy_data_entries(&entries,record)?;
 if !read(record,"potColorId")?.is_undefined(){let color=method(host,"getPotColor",&[&pot_id,&read(record,"potColorId")?])?;data_entry(&entries,&"potColorId".into(),&read(&color,"id")?);}
 let seed=if read(record,"seed")?.as_string().is_some()&&truthy(&read(record,"seed")?){read(record,"seed")?}else{read(record,"key")?};
 for(key,value)in[("seed",seed),("catalogId",read(&plant,"id")?),("variant",read(&plant,"variant")?),("potId",pot_id),("width",read(&size,"width")?),("height",read(&size,"height")?)]{data_entry(&entries,&key.into(),&value);}
 Ok(Object::from_entries(entries.as_ref())?.into())
}
