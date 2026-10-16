//! Shelf-screen arguments and saved preferences, keeping the original read/write order and fallbacks.
use wasm_bindgen::prelude::*;
use js_sys::Array;
use super::{util::*,objects::{SHELF_PLANTS_KEY,SHELF_LAMPS_KEY}};

#[wasm_bindgen]
pub fn shelf_normalize_args(second:JsValue,third:JsValue)->JsValue{
 if Array::is_array(&second){return obj(&[("books",&second),("options",&or(third,obj(&[])))]);}
 let options=or(second,obj(&[]));
 obj(&[("books",&or(get(&options,"books"),Array::new().into())),("options",&options)])
}

#[wasm_bindgen]
pub fn shelf_stored_type(env:JsValue)->JsValue{
 let attempt=||->R<JsValue>{call(&read(&env,"normalizeShelfType")?,"normalizeShelfType",&[&local_storage_get("inhouse-read-shelf-type")?])};
 attempt().unwrap_or_else(|_|s("walnut"))
}

#[wasm_bindgen]
pub fn shelf_stored_view(fallback:JsValue)->JsValue{
 let attempt=||->R<JsValue>{
  let value=local_storage_get("inhouse-read-shelf-view")?;
  Ok(if value==s("spine")||value==s("isometric"){value}else{fallback.clone()})
 };
 attempt().unwrap_or(fallback)
}

fn parsed_preference(key:&str,fallback:&str)->R<JsValue>{
 let json=get(&global(),"JSON");
 method(&json,"parse",&[&or(local_storage_get(key)?,s(fallback))])
}

#[wasm_bindgen]
pub fn shelf_saved_plants(env:JsValue)->JsValue{
 let attempt=||->R<JsValue>{
  let saved=parsed_preference(SHELF_PLANTS_KEY,"null")?;
  if !Array::is_array(&saved){return Ok(null());}
  let mapped=Array::new();
  for (index,record) in array_of(&saved).iter().enumerate(){
   mapped.push(&call(&read(&env,"normalizeShelfPlant")?,"normalizeShelfPlant",&[record,&f(index as f64),&saved])?);
  }
  let plants=Array::new();for record in mapped.iter(){if truthy(&record){plants.push(&record);}}
  let plants:JsValue=plants.into();
  if json(&plants)?!=json(&saved)?{
   // A failed migration write never hides the models already read successfully.
   let persist=||->R{local_storage_set(SHELF_PLANTS_KEY,&json(&plants)?)};let _=persist();
  }
  Ok(plants)
 };
 attempt().unwrap_or_else(|_|null())
}

#[wasm_bindgen]
pub fn shelf_saved_lamps(env:JsValue)->JsValue{
 let attempt=||->R<JsValue>{
  let saved=parsed_preference(SHELF_LAMPS_KEY,"[]")?;
  if !Array::is_array(&saved){return Ok(Array::new().into());}
  let keys=new_set()?;let mapped=Array::new();
  for (index,record) in array_of(&saved).iter().enumerate(){
   mapped.push(&call(&read(&env,"normalizeShelfLamp")?,"normalizeShelfLamp",&[record,&f(index as f64),&saved])?);
  }
  let lamps=Array::new();
  for record in mapped.iter(){
   if !truthy(&record)||map_has(&keys,&get(&record,"key")){continue;}
   method(&keys,"add",&[&get(&record,"key")])?;lamps.push(&record);
  }
  Ok(lamps.into())
 };
 attempt().unwrap_or_else(|_|Array::new().into())
}

#[wasm_bindgen]
pub fn shelf_forget_boot_poster(){
 let attempt=||->R{for key in ["ihr-poster-img","ihr-poster-meta","ihr-lib-sig"]{local_storage_remove(key)?;}Ok(())};
 let _=attempt();
}
