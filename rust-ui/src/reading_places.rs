//! Compare/toggle bookmarks without cloning persisted records through WASM.
//! The requested locator is serialized once, retaining JSON's existing semantics.
use wasm_bindgen::{prelude::*,JsCast};
use js_sys::{Array,Function,JsString,JSON};
#[wasm_bindgen]
extern "C"{
 type Place;
 #[wasm_bindgen(method,getter,catch)]fn locator(this:&Place)->Result<JsValue,JsValue>;
 #[wasm_bindgen(method,getter,catch)]fn fraction(this:&Place)->Result<JsValue,JsValue>;
 #[wasm_bindgen(catch,js_name=Number)]fn numeric(value:&JsValue)->Result<f64,JsValue>;
}
fn fraction(value:&JsValue)->Result<f64,JsValue>{
 let value=value.unchecked_ref::<Place>().fraction()?;
 if value.is_bigint(){return Err(js_sys::TypeError::new("Cannot convert a BigInt value to a number").into());}
 match value.as_f64(){Some(number)=>Ok(number),None=>numeric(&value)}
}
fn key(value:&JsValue)->Result<JsString,JsValue>{JSON::stringify(&value.unchecked_ref::<Place>().locator()?)}
fn matches(place:&JsValue,target:&JsString,location:&JsValue)->Result<bool,JsValue>{Ok(key(place)?==*target&&(fraction(place)?-fraction(location)?).abs()<0.0001)}
#[wasm_bindgen]
pub fn reading_marked(bookmarks:Array,location:JsValue)->Result<bool,JsValue>{
 if bookmarks.length()==0{return Ok(false);}let target=key(&location)?;
 for place in bookmarks.iter(){if matches(&place,&target,&location)?{return Ok(true);}}Ok(false)
}
#[wasm_bindgen]
pub fn reading_toggle(bookmarks:Array,location:JsValue,create:Function)->Result<Array,JsValue>{
 let target=if bookmarks.length()>0{Some(key(&location)?)}else{None};
 let mut duplicate=false;
 if let Some(target)=&target{for place in bookmarks.iter(){if matches(&place,target,&location)?{duplicate=true;break;}}}
 if duplicate{
  let output=Array::new();let target=target.unwrap();
  // Evaluate the full filter, matching the previous callback/error behavior,
  // even when only the first hundred remaining bookmarks will be retained.
  for place in bookmarks.iter(){if !matches(&place,&target,&location)?{output.push(&place);}}
  Ok(output.slice(0,100))
 }else{let place=create.call0(&JsValue::UNDEFINED)?;bookmarks.unshift(&place);Ok(bookmarks.slice(0,100))}
}
#[wasm_bindgen]
pub fn reading_history(history:Array,origin:JsValue)->Array{
 let output=Array::new();output.push(&origin);for place in history.iter().take(19){output.push(&place);}output
}
