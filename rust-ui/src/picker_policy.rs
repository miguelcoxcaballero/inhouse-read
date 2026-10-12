//! Natural-voice availability and first-use offer policy.
use wasm_bindgen::prelude::*;
use js_sys::{Array,Function,Object,Reflect,JSON};
use crate::reader_actions::{get,set,call,one,two};
fn absent(v:&JsValue)->bool{v.is_null()||v.is_undefined()}
fn optional(v:&JsValue,key:&str)->Result<JsValue,JsValue>{if absent(v){Ok(JsValue::UNDEFINED)}else{get(v,key)}}
fn object(values:&[(&str,JsValue)])->Result<Object,JsValue>{let v=Object::new();for(k,x)in values{set(&v,k,x)?;}Ok(v)}
fn own(target:&Object,key:&JsValue,value:JsValue)->Result<(),JsValue>{let descriptor=object(&[("value",value),("writable",JsValue::TRUE),("enumerable",JsValue::TRUE),("configurable",JsValue::TRUE)])?;if Reflect::define_property(target,key,&descriptor)?{Ok(())}else{Err(js_sys::TypeError::new("Cannot define voice preference").into())}}
#[wasm_bindgen]extern "C"{
 #[wasm_bindgen(catch,js_name=Number)]fn number(v:&JsValue)->Result<f64,JsValue>;
 #[wasm_bindgen(catch,js_name=String)]fn string(v:&JsValue)->Result<JsValue,JsValue>;
 #[wasm_bindgen(catch,js_name=Object)]fn boxed(v:&JsValue)->Result<Object,JsValue>;
}
#[wasm_bindgen]
pub fn picker_state(host:JsValue,engine:JsValue,voice:JsValue,messages:JsValue)->Result<Object,JsValue>{
 let id=get(&voice,"id")?;let downloads=get(&engine,"downloads")?;
 let download=if absent(&downloads){JsValue::UNDEFINED}else{one(&downloads,"get",&id)?};
 if one(&get(&engine,"installed")?,"has",&id)?.is_truthy(){return object(&[("name","installed".into())]);}
 if one(&get(&host,"tasks")?,"has",&id)?.is_truthy()||optional(&download,"state")?==JsValue::from_str("downloading"){return object(&[("name","downloading".into()),("download",download)]);}
 if one(&get(&host,"errors")?,"has",&id)?.is_truthy()||optional(&download,"state")?==JsValue::from_str("error"){
  let mut message=one(&get(&host,"errors")?,"get",&id)?;
  if !message.is_truthy(){message=Reflect::get(&messages,&optional(&download,"code")?)?;}
  if !message.is_truthy(){message=get(&messages,"default")?;}
  return object(&[("name","error".into()),("message",message)]);
 }object(&[("name","idle".into())])
}
#[wasm_bindgen]
pub fn picker_dismissed(read:Function)->JsValue{
 let value=(||{let stored=read.call0(&JsValue::UNDEFINED)?;let raw=if stored.is_truthy(){string(&stored)?.as_string().unwrap_or_default()}else{"{}".into()};JSON::parse(&raw)})();
 match value{Ok(value)if value.is_truthy()=>value,_=>Object::new().into()}
}
#[wasm_bindgen]
pub fn picker_snoozed(host:JsValue,base:JsValue,now:Function)->Result<bool,JsValue>{
 let dismissed=boxed(&call(&host,"dismissed")?)?;let at=Reflect::get(&dismissed,&base)?;
 Ok(at==JsValue::TRUE||(number(&at)?>0.0&&number(&now.call0(&JsValue::UNDEFINED)?)?-number(&at)?<30.0*864e5))
}
#[wasm_bindgen]
pub fn picker_dismiss(host:JsValue,base:Function,now:Function,write:Function)->Result<(),JsValue>{
 let base=base.call1(&JsValue::UNDEFINED,&get(&host,"bookLang")?)?;
 let result=(||{
  let source=boxed(&call(&host,"dismissed")?)?;let values=Object::new();
  for key in Object::keys(&source).iter(){own(&values,&key,Reflect::get(&source,&key)?)?;}
  // A computed object-literal key is an own data property, including __proto__.
  own(&values,&base,now.call0(&JsValue::UNDEFINED)?)?;
  write.call1(&JsValue::UNDEFINED,&JSON::stringify(&values)?.into())?;Ok::<(),JsValue>(())
 })();let _=result;call(&host,"render")?;Ok(())
}
#[wasm_bindgen]
pub fn picker_offer_for(host:JsValue,engine:JsValue,voices:Array,base:Function,recommend:Function,device:JsValue)->Result<JsValue,JsValue>{
 let base=base.call1(&JsValue::UNDEFINED,&get(&host,"bookLang")?)?;
 if !engine.is_truthy()||!base.is_truthy()||!get(&get(&host,"host")?,"voice")?.is_truthy()||one(&host,"snoozed",&base)?.is_truthy(){return Ok(JsValue::NULL);}
 for voice in voices.iter(){if get(&voice,"base")?==base&&one(&get(&engine,"installed")?,"has",&get(&voice,"id")?)?.is_truthy(){return Ok(JsValue::NULL);}}
 recommend.call3(&JsValue::UNDEFINED,&voices,&get(&host,"bookLang")?,&device)
}
#[wasm_bindgen]
pub fn picker_render_offer(host:JsValue,engine:JsValue,voices:JsValue)->Result<(),JsValue>{
 let voice=two(&host,"offerFor",&engine,&voices)?;let state=if voice.is_truthy(){two(&host,"state",&engine,&voice)?}else{JsValue::NULL};
 two(&get(&host,"view")?,"renderOffer",&voice,&state)?;Ok(())
}
