//! Prepare one detached physical page without moving the visible/audible cursor.
//! The callback factory lives in JS so reader-held callbacks never create a
//! cross-heap host/closure cycle; all validity decisions execute here.
use wasm_bindgen::{prelude::*,JsCast};
use wasm_bindgen_futures::{future_to_promise,JsFuture};
use js_sys::{Array,Function,Object,Promise,Reflect};
use crate::reader_actions::{get,set,call,one};
fn absent(v:&JsValue)->bool{v.is_null()||v.is_undefined()}
fn optional(v:&JsValue,key:&str)->Result<JsValue,JsValue>{if absent(v){Ok(JsValue::UNDEFINED)}else{get(v,key)}}
fn maybe(v:&JsValue,key:&str,args:&Array)->Result<JsValue,JsValue>{let method=optional(v,key)?;if absent(&method){Ok(JsValue::UNDEFINED)}else{method.dyn_into::<Function>().map_err(|_|JsValue::from(js_sys::TypeError::new("Page method is not callable")))?.apply(v,args)}}
async fn wait(value:Result<JsValue,JsValue>)->Result<JsValue,JsValue>{JsFuture::from(Promise::resolve(&value?)).await}
fn clear(source:&JsValue)->Result<(),JsValue>{maybe(source,"clear",&Array::new())?;Ok(())}
#[wasm_bindgen]
extern "C"{#[wasm_bindgen(catch,js_name=Number)]fn number(value:&JsValue)->Result<f64,JsValue>;}
#[wasm_bindgen]
pub fn voice_page_valid(plan:JsValue)->bool{
 (||{let source=optional(&plan,"source")?;let valid=optional(&source,"isValid")?;
  Ok::<bool,JsValue>(!valid.is_truthy()||call(&source,"isValid")?==JsValue::TRUE)
 })().unwrap_or(false)
}
#[wasm_bindgen]
pub fn voice_clear_ahead(host:JsValue)->Result<(),JsValue>{
 let ahead=get(&host,"aheadPage")?;set(&host,"aheadPage",&JsValue::NULL)?;
 if ahead.is_truthy(){set(&ahead,"cancelled",&JsValue::TRUE)?;clear(&optional(&optional(&ahead,"plan")?,"source")?)?;}Ok(())
}
#[wasm_bindgen]
pub fn voice_ahead_active(host:JsValue,request:JsValue)->Result<bool,JsValue>{
 if get(&request,"cancelled")?.is_truthy()||get(&request,"generation")?!=get(&host,"generation")?||get(&host,"state")?!=JsValue::from_str("playing"){return Ok(false);}
 let source=get(&host,"source")?;Ok(source==get(&request,"source")?||source==optional(&get(&request,"plan")?,"source")?)
}
#[wasm_bindgen]
pub fn voice_prepare_ahead(host:JsValue,make_active:Function,engine:Function)->Result<(),JsValue>{
 let ahead=get(&host,"aheadPage")?;
 if optional(&optional(&ahead,"error")?,"name")?==JsValue::from_str("AbortError")||{
  let plan=optional(&ahead,"plan")?;plan.is_truthy()&&!one(&host,"pagePlanValid",&plan)?.is_truthy()
 }{call(&host,"clearAhead")?;}
 if get(&host,"state")?!=JsValue::from_str("playing")||get(&host,"aheadPage")?.is_truthy()||get(&host,"deferredPage")?.is_truthy()||number(&get(&get(&host,"chunks")?,"length")?)?-number(&get(&host,"index")?)?-1.0>4.0||!get(&get(&host,"reader")?,"getNextSpeechSource")?.is_function(){return Ok(());}
 let request:Object=Object::new();set(&request,"generation",&get(&host,"generation")?)?;set(&request,"source",&get(&host,"source")?)?;set(&request,"plan",&JsValue::UNDEFINED)?;set(&request,"cancelled",&JsValue::FALSE)?;set(&host,"aheadPage",&request)?;
 let active=make_active.call2(&JsValue::UNDEFINED,&host,&request)?;
 let pending=(||{let args=Object::new();set(&args,"isActive",&active)?;set(&args,"afterPage",&optional(&get(&host,"source")?,"physicalPage")?)?;one(&get(&host,"reader")?,"getNextSpeechSource",&args)})();
 let saved=request.clone();let promise=future_to_promise(async move{
  let mut source=JsValue::UNDEFINED;
  let result=async{
   source=wait(pending).await?;
   if !voice_ahead_active(host.clone(),request.clone().into())?{clear(&source)?;return Ok(JsValue::UNDEFINED);}
   if source.is_undefined()&&get(&host,"aheadPage")?==JsValue::from(request.clone()){set(&host,"aheadPage",&JsValue::NULL)?;}
   let plan=if absent(&source){source.clone()}else{wait(one(&host,"prepare",&source)).await?};set(&request,"plan",&plan)?;
   if !voice_ahead_active(host.clone(),request.clone().into())?{clear(&source)?;set(&request,"plan",&JsValue::UNDEFINED)?;return Ok(JsValue::UNDEFINED);}
   call(&host,"joinPageSentence")?;
   let selection=one(&host,"voiceFor",&Reflect::get(&get(&host,"chunks")?,&get(&host,"index")?)?)?;let voice=get(&selection,"voice")?;
   if voice.is_truthy()&&number(&get(&host,"index")?)?<number(&get(&get(&host,"chunks")?,"length")?)?{
    let next=one(&host,"upcomingFor",&voice)?;let engine=engine.call0(&JsValue::UNDEFINED)?;
    let extend=optional(&engine,"extendUpcoming")?;
    if !absent(&extend){
     let args=Object::new();set(&args,"id",&get(&host,"utteranceId")?)?;set(&args,"voiceId",&get(&voice,"id")?)?;set(&args,"rate",&get(&host,"rate")?)?;set(&args,"upcoming",&get(&next,"upcoming")?)?;set(&args,"deferAfter",&get(&next,"deferAfter")?)?;
     extend.dyn_into::<Function>().map_err(|_|JsValue::from(js_sys::TypeError::new("Audio extension is not callable")))?.call1(&engine,&args)?;
    }
   }
   get(&request,"plan")
  }.await;
  match result{Ok(value)=>Ok(value),Err(error)=>{clear(&source)?;set(&request,"error",&error)?;Ok(JsValue::UNDEFINED)}}
 });set(&saved,"promise",&promise)?;Ok(())
}
#[wasm_bindgen]
pub fn voice_revalidate_next(host:JsValue,plan:JsValue,generation:JsValue)->Result<Promise,JsValue>{
 if one(&host,"pagePlanValid",&plan)?.is_truthy(){return Ok(Promise::resolve(&plan));}
 clear(&optional(&plan,"source")?)?;
 if get(&host,"generation")?!=generation||get(&host,"state")?!=JsValue::from_str("playing"){return Ok(Promise::resolve(&JsValue::UNDEFINED));}
 Ok(Promise::resolve(&one(&host,"prepareNext",&generation)?))
}
#[wasm_bindgen]
pub fn voice_adopt_plan(host:JsValue,plan:JsValue)->Result<(),JsValue>{
 let source=get(&plan,"source")?;let items=get(&plan,"items")?;maybe(&source,"adopt",&Array::new())?;
 set(&host,"source",&source)?;set(&host,"items",&items)?;
 let input:Array=items.unchecked_into();let chunks=Array::new_with_length(input.length());
 for index in 0..input.length(){if Reflect::has(&input,&index.into())?{chunks.set(index,get(&input.get(index),"text")?);}}
 set(&host,"chunks",&chunks)?;set(&host,"index",&0.into())?;
 set(&host,"deferredPage",&if optional(&source,"activate")?.is_function(){source}else{JsValue::NULL})?;Ok(())
}
