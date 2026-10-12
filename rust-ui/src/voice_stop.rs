//! Audiobook interruption and reset. Cancel timers and native transport in the
//! original order, invalidating pending generation work before notifications.
use wasm_bindgen::{prelude::*,JsCast};
use js_sys::{Array,Function,JSON,Reflect};
use crate::reader_actions::{get,set,call,one};
fn absent(value:&JsValue)->bool{value.is_null()||value.is_undefined()}
fn optional(value:&JsValue,key:&str)->Result<JsValue,JsValue>{if absent(value){Ok(JsValue::UNDEFINED)}else{get(value,key)}}
fn optional_call(value:&JsValue,key:&str)->Result<(),JsValue>{let method=get(value,key)?;if !absent(&method){method.dyn_into::<Function>().map_err(|_|JsValue::from(js_sys::TypeError::new("Voice method is not callable")))?.call0(value)?;}Ok(())}
fn clear(host:&JsValue,key:&str,clear:&Function)->Result<(),JsValue>{clear.call1(&JsValue::UNDEFINED,&get(host,key)?)?;Ok(())}
#[wasm_bindgen]
extern "C"{#[wasm_bindgen(catch,js_name=Number)]fn number(value:&JsValue)->Result<f64,JsValue>;}
fn generation(host:&JsValue)->Result<(),JsValue>{set(host,"generation",&(number(&get(host,"generation")?)?+1.0).into())}
#[wasm_bindgen]
pub fn voice_cancel(host:JsValue,reason:JsValue,clear_timer:Function,native:Function,engine:Function)->Result<(),JsValue>{
 set(&host,"utteranceId",&JsValue::NULL)?;clear(&host,"presentTimer",&clear_timer)?;clear(&host,"waitTimer",&clear_timer)?;set(&host,"waiting",&JsValue::FALSE)?;
 if get(&host,"transport")?==JsValue::from_str("neural")||native.call0(&JsValue::UNDEFINED)?.is_truthy(){
  set(&host,"transport",&JsValue::NULL)?;
  let result=(||->Result<(),JsValue>{let engine=engine.call0(&JsValue::UNDEFINED)?;
   if reason==JsValue::from_str("restart")&&optional(&engine,"cancelCurrent")?.is_truthy(){call(&engine,"cancelCurrent")?;}
   else if reason==JsValue::from_str("pause")&&optional(&engine,"pause")?.is_truthy(){call(&engine,"pause")?;}
   else if !absent(&engine){call(&engine,"stop")?;}Ok(())})();let _=result;
 }Ok(())
}
#[wasm_bindgen]
pub fn voice_pause(host:JsValue)->Result<(),JsValue>{
 if get(&host,"state")?!=JsValue::from_str("playing")&&get(&host,"state")?!=JsValue::from_str("loading"){return Ok(());}
 let deferred=get(&host,"deferredPage")?;let pending=if deferred.is_truthy(){true}else{optional(&get(&host,"preparingPage")?,"generation")?==get(&host,"generation")?};
 let item=Reflect::get(&get(&host,"items")?,&get(&host,"index")?)?;let original=optional(&item,"unjoined")?;
 if original.is_truthy(){Reflect::set(&get(&host,"items")?,&get(&host,"index")?,&original)?;Reflect::set(&get(&host,"chunks")?,&get(&host,"index")?,&get(&original,"text")?)?;}
 if pending{set(&host,"resumeNextPage",&JsValue::TRUE)?;}
 call(&host,"clearAhead")?;set(&host,"diagnosticAdvance",&JsValue::NULL)?;
 set(&host,"pausedLocation",&JSON::stringify(&get(&get(&host,"reader")?,"location")?)?.into())?;
 generation(&host)?;set(&host,"state",&"paused".into())?;one(&host,"cancelUtterance",&"pause".into())?;call(&host,"unpaint")?;
 if pending{set(&host,"chunks",&Array::new())?;set(&host,"items",&Array::new())?;set(&host,"source",&JsValue::NULL)?;set(&host,"index",&0.into())?;set(&host,"deferredPage",&JsValue::NULL)?;}
 if number(&get(&host,"index")?)?>=number(&get(&get(&host,"chunks")?,"length")?)?{set(&host,"chunks",&Array::new())?;}
 call(&host,"notify")?;Ok(())
}
#[wasm_bindgen]
pub fn voice_stop(host:JsValue,clear_timer:Function)->Result<(),JsValue>{
 set(&host,"stoppedLocation",&JSON::stringify(&get(&get(&host,"reader")?,"location")?)?.into())?;
 set(&host,"completeOpening",&JsValue::FALSE)?;set(&host,"openingPlan",&JsValue::NULL)?;call(&host,"clearAhead")?;set(&host,"diagnosticAdvance",&JsValue::NULL)?;
 generation(&host)?;set(&host,"state",&"stopped".into())?;call(&host,"cancelUtterance")?;call(&host,"unpaint")?;
 set(&host,"browsing",&JsValue::FALSE)?;optional_call(&get(&host,"reader")?,"stopSpeech")?;set(&host,"nativeSession",&JsValue::NULL)?;
 set(&host,"preparingPage",&JsValue::NULL)?;set(&host,"deferredPage",&JsValue::NULL)?;set(&host,"resumeNextPage",&JsValue::FALSE)?;
 set(&host,"chunks",&Array::new())?;set(&host,"items",&Array::new())?;set(&host,"source",&JsValue::NULL)?;set(&host,"index",&0.into())?;
 call(&get(&host,"missing")?,"clear")?;set(&host,"spokenWith",&JsValue::NULL)?;clear(&host,"sleepTimer",&clear_timer)?;call(&host,"notify")?;Ok(())
}
#[wasm_bindgen]
pub fn voice_restart(host:JsValue)->Result<(),JsValue>{
 if get(&host,"state")?!=JsValue::from_str("playing")||number(&get(&host,"index")?)?>=number(&get(&get(&host,"chunks")?,"length")?)?{return Ok(());}
 call(&host,"clearAhead")?;one(&host,"cancelUtterance",&"restart".into())?;set(&host,"waiting",&JsValue::TRUE)?;
 one(&host,"notify",&"Preparando la voz natural…".into())?;call(&host,"speakCurrent")?;Ok(())
}
#[wasm_bindgen]
pub fn voice_retry(host:JsValue)->Result<(),JsValue>{set(&host,"neuralOff",&"".into())?;set(&host,"neuralRetries",&0.into())?;call(&get(&host,"missing")?,"clear")?;Ok(())}
#[wasm_bindgen]
pub fn voice_fail(host:JsValue,message:JsValue)->Result<(),JsValue>{call(&host,"stop")?;one(&host,"notify",&message)?;Ok(())}
