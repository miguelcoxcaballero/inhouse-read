//! Natural voice warming follows the current book generation and engine.
//! Host-owned scheduling closures keep callback ownership out of the WASM heap.
use wasm_bindgen::{prelude::*,JsCast};
use js_sys::{Array,Function,Object};
use crate::reader_actions::{get,set,call,one};
fn absent(v:&JsValue)->bool{v.is_null()||v.is_undefined()}
fn optional(v:&JsValue,key:&str)->Result<JsValue,JsValue>{if absent(v){Ok(JsValue::UNDEFINED)}else{get(v,key)}}
fn maybe(v:&JsValue,key:&str,args:&Array)->Result<JsValue,JsValue>{let method=optional(v,key)?;if absent(&method){Ok(JsValue::UNDEFINED)}else{method.dyn_into::<Function>().map_err(|_|JsValue::from(js_sys::TypeError::new("Voice warm method is not callable")))?.apply(v,args)}}
fn current(host:&JsValue,context:&JsValue)->Result<bool,JsValue>{Ok(one(host,"isWarmCurrent",context)?.is_truthy())}
fn signature(engine:&JsValue)->Result<JsValue,JsValue>{
 if !engine.is_truthy(){return Ok("".into());}
 let installed=get(engine,"installed")?;let values=Array::new();
 for value in js_sys::try_iter(&installed)?.ok_or_else(||JsValue::from(js_sys::TypeError::new("Installed voices are not iterable")))?{values.push(&value?);}
 call(&values,"sort")?;one(&values,"join",&",".into())
}
#[wasm_bindgen]
extern "C"{#[wasm_bindgen(catch,js_name=Number)]fn number(v:&JsValue)->Result<f64,JsValue>;}
#[wasm_bindgen]
pub fn picker_warm_context(host:JsValue)->Result<Object,JsValue>{
 let value=Object::new();set(&value,"generation",&get(&host,"warmGeneration")?)?;set(&value,"book",&get(&get(&host,"host")?,"book")?)?;Ok(value)
}
#[wasm_bindgen]
pub fn picker_warm_current(host:JsValue,context:JsValue)->Result<bool,JsValue>{
 let book=optional(&context,"book")?;Ok(book.is_truthy()&&book==get(&get(&host,"host")?,"book")?&&get(&context,"generation")?==get(&host,"warmGeneration")?)
}
#[wasm_bindgen]
pub fn picker_used(read:Function)->bool{read.call0(&JsValue::UNDEFINED).map(|v|v==JsValue::from_str("1")).unwrap_or(false)}
#[wasm_bindgen]
pub fn picker_warm(host:JsValue,schedule:Function)->Result<(),JsValue>{
 if get(&host,"warmed")?.is_truthy(){return Ok(());}
 set(&host,"warmed",&JsValue::TRUE)?;let context=call(&host,"warmContext")?;
 set(&host,"warmHandle",&schedule.call2(&JsValue::UNDEFINED,&host,&context)?)?;Ok(())
}
#[wasm_bindgen]
pub fn picker_warm_fire(host:JsValue,context:JsValue)->Result<(),JsValue>{
 set(&host,"warmHandle",&JsValue::NULL)?;
 if current(&host,&context)?{let options=Object::new();set(&options,"warm",&call(&host,"used")?)?;one(&host,"refresh",&options)?;}Ok(())
}
#[wasm_bindgen]
pub fn picker_cancel_warm(host:JsValue,cancel_idle:JsValue,clear:Function)->Result<(),JsValue>{
 set(&host,"warmGeneration",&(number(&get(&host,"warmGeneration")?)?+1.0).into())?;set(&host,"warmed",&JsValue::FALSE)?;
 let handle=get(&host,"warmHandle")?;set(&host,"warmHandle",&JsValue::NULL)?;
 if optional(&handle,"idle")?.is_truthy(){if cancel_idle.is_function(){cancel_idle.unchecked_into::<Function>().call1(&JsValue::UNDEFINED,&get(&handle,"id")?)?;}}
 else if handle.is_truthy(){clear.call1(&JsValue::UNDEFINED,&get(&handle,"id")?)?;}Ok(())
}
#[wasm_bindgen]
pub fn picker_refresh(host:JsValue,warm:JsValue,load:Function)->Result<(),JsValue>{let context=call(&host,"warmContext")?;load.call3(&JsValue::UNDEFINED,&host,&context,&warm)?;Ok(())}
#[wasm_bindgen]
pub fn picker_loaded(host:JsValue,context:JsValue,warm:JsValue)->Result<(),JsValue>{if current(&host,&context)?{one(&host,"attach",&warm)?;}Ok(())}
#[wasm_bindgen]
pub fn picker_engine_status(host:JsValue,engine:JsValue,write:Function)->Result<(),JsValue>{
 if get(&engine,"status")?==JsValue::from_str("speaking")&&!call(&host,"used")?.is_truthy(){let _=write.call0(&JsValue::UNDEFINED);}Ok(())
}
#[wasm_bindgen]
pub fn picker_engine_refreshed(host:JsValue,context:JsValue,warm:JsValue)->Result<(),JsValue>{if warm.is_truthy()&&current(&host,&context)?{call(&host,"warmUp")?;}Ok(())}
#[wasm_bindgen]
pub fn picker_attach(host:JsValue,warm:JsValue,engine:Function,bind:Function,refresh:Function)->Result<(),JsValue>{
 let context=call(&host,"warmContext")?;let engine=engine.call0(&JsValue::UNDEFINED)?;
 if engine.is_truthy()&&engine!=get(&host,"engine")?{
  set(&host,"engine",&engine)?;bind.call2(&JsValue::UNDEFINED,&host,&engine)?;refresh.call4(&JsValue::UNDEFINED,&host,&engine,&context,&warm)?;
 }else if engine.is_truthy()&&warm.is_truthy(){call(&host,"warmUp")?;}
 if !engine.is_truthy(){set(&host,"engine",&JsValue::NULL)?;}call(&get(&host,"host")?,"populateVoices")?;Ok(())
}
#[wasm_bindgen]
pub fn picker_warm_up(host:JsValue,engine:Function,ignore:Function,active:Function)->Result<(),JsValue>{
 if !current(&host,&call(&host,"warmContext")?)?{return Ok(());}
 let result=(||{
  let engine=engine.call0(&JsValue::UNDEFINED)?;let voice=optional(&maybe(&get(&get(&host,"host")?,"voice")?,"voiceFor",&Array::of1(&"".into()))?,"voice")?;
  if optional(&engine,"warmUp")?.is_truthy()&&optional(&voice,"neural")?.is_truthy()&&get(&voice,"installed")?.is_truthy(){
   let context=call(&host,"warmContext")?;ignore.call1(&JsValue::UNDEFINED,&one(&engine,"warmUp",&get(&voice,"id")?)?)?;
   let callback=active.call2(&JsValue::UNDEFINED,&host,&context)?;
   ignore.call1(&JsValue::UNDEFINED,&maybe(&get(&get(&host,"host")?,"voice")?,"preparePlayback",&Array::of1(&callback))?)?;
  }Ok::<(),JsValue>(())
 })();let _=result;Ok(())
}
#[wasm_bindgen]
pub fn picker_changed(host:JsValue,engine:Function,schedule:Function)->Result<(),JsValue>{
 let signature=signature(&engine.call0(&JsValue::UNDEFINED)?)?;
 if signature!=get(&host,"signature")?{set(&host,"signature",&signature)?;call(&get(&host,"host")?,"populateVoices")?;return Ok(());}
 if get(&host,"frame")?.is_truthy(){return Ok(());}
 set(&host,"frame",&schedule.call1(&JsValue::UNDEFINED,&host)?)?;Ok(())
}
#[wasm_bindgen]
pub fn picker_paint_frame(host:JsValue)->Result<(),JsValue>{set(&host,"frame",&0.into())?;call(&host,"paint")?;Ok(())}
#[wasm_bindgen]
pub fn picker_paint(host:JsValue,engine:Function)->Result<(),JsValue>{let engine=engine.call0(&JsValue::UNDEFINED)?;if engine.is_truthy()&&one(&host,"patchProgress",&engine)?.is_truthy(){return Ok(());}call(&host,"render")?;Ok(())}
