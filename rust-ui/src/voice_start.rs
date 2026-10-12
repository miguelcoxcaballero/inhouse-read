//! Start/resume ordering for the audiobook. Stop the retired native session
//! before unlock; page plans and cancellation generations remain original handles.
use wasm_bindgen::{prelude::*,JsCast};
use wasm_bindgen_futures::{future_to_promise,JsFuture};
use js_sys::{Function,Promise,JSON};
use crate::reader_actions::{get,set,call,one};
const PREPARING:&str="Preparando la voz natural…";
const FAILED:&str="No se pudo iniciar la voz natural. Pulsa Reintentar para volver a usarla.";
fn absent(value:&JsValue)->bool{value.is_null()||value.is_undefined()}
fn optional(value:&JsValue,key:&str)->Result<JsValue,JsValue>{if absent(value){Ok(JsValue::UNDEFINED)}else{get(value,key)}}
fn notify(host:&JsValue,text:&str)->Result<(),JsValue>{one(host,"notify",&text.into())?;Ok(())}
fn failed(host:&JsValue,text:&str)->Result<JsValue,JsValue>{one(host,"fail",&text.into())}
fn current(host:&JsValue,generation:&JsValue)->Result<bool,JsValue>{Ok(get(host,"generation")?==*generation)}
fn playing(host:&JsValue)->Result<(),JsValue>{set(host,"state",&"playing".into())?;set(host,"waiting",&JsValue::TRUE)?;notify(host,PREPARING)?;call(host,"speakCurrent")?;Ok(())}
async fn wait(value:Result<JsValue,JsValue>)->Result<JsValue,JsValue>{JsFuture::from(Promise::resolve(&value?)).await}
#[wasm_bindgen]
extern "C"{
 #[wasm_bindgen(catch,js_name=Number)]fn number(value:&JsValue)->Result<f64,JsValue>;
 #[wasm_bindgen(catch,js_name=Object)]fn boxed(value:&JsValue)->Result<JsValue,JsValue>;
}
#[wasm_bindgen]
pub fn voice_restart_visible(host:JsValue)->Result<JsValue,JsValue>{
 let saved=get(&host,if get(&host,"state")?==JsValue::from_str("paused"){"pausedLocation"}else{"stoppedLocation"})?;
 let state=get(&host,"state")?;if state!=JsValue::from_str("paused")&&state!=JsValue::from_str("stopped"){return Ok(JsValue::FALSE);}
 let browsing=get(&host,"browsing")?;if browsing.is_truthy(){return Ok(browsing);}
 if saved.is_undefined(){return Ok(JsValue::FALSE);}
 let encoded:JsValue=JSON::stringify(&get(&get(&host,"reader")?,"location")?)?.into();Ok((saved!=encoded).into())
}
#[wasm_bindgen]
pub fn voice_play(host:JsValue,load:Function,engine:Function,unlock:Function,native:Function)->Result<Promise,JsValue>{
 let state=get(&host,"state")?;
 if state==JsValue::from_str("playing")||state==JsValue::from_str("loading"){return Ok(Promise::resolve(&JsValue::UNDEFINED));}
 call(&host,"retryNeural")?;
 if call(&host,"restartFromVisiblePage")?.is_truthy(){call(&host,"stop")?;set(&host,"completeOpening",&JsValue::TRUE)?;}
 unlock.call0(&JsValue::UNDEFINED)?;
 let session=optional(&native.call0(&JsValue::UNDEFINED)?,"session")?;set(&host,"nativeSession",&if session.is_truthy(){session}else{JsValue::NULL})?;
 if get(&host,"state")?==JsValue::from_str("paused")&&get(&get(&host,"chunks")?,"length")?.is_truthy()&&!get(&host,"resumeNextPage")?.is_truthy(){playing(&host)?;return Ok(Promise::resolve(&JsValue::UNDEFINED));}
 let generation:JsValue=(number(&get(&host,"generation")?)?+1.0).into();set(&host,"generation",&generation)?;
 set(&host,"state",&"loading".into())?;notify(&host,PREPARING)?;
 // Call load inside the tap's synchronous phase, including its synchronous error.
 let loaded=match load.call0(&JsValue::UNDEFINED){Ok(value)=>Promise::resolve(&value),Err(_)=>{if current(&host,&generation)?{failed(&host,"No se pudo preparar el texto.")?;}return Ok(Promise::resolve(&JsValue::UNDEFINED));}};
 Ok(future_to_promise(async move{
  let outcome=async{
   JsFuture::from(loaded).await?;if !current(&host,&generation)?{return Ok(JsValue::UNDEFINED);}
   let engine=engine.call0(&JsValue::UNDEFINED)?;
   if !engine.is_truthy(){return failed(&host,"Este dispositivo no puede reproducir voces naturales.");}
   let refresh=async{let method=get(&engine,"refresh")?;let value=if absent(&method){JsValue::UNDEFINED}else{method.dyn_into::<Function>().map_err(|_|JsValue::from(js_sys::TypeError::new("Voice refresh is not callable")))?.call0(&engine)?};wait(Ok(value)).await}.await;
   if refresh.is_err(){if !current(&host,&generation)?{return Ok(JsValue::UNDEFINED);}set(&host,"neuralOff",&"init-failed".into())?;return failed(&host,FAILED);}
   if !current(&host,&generation)?{return Ok(JsValue::UNDEFINED);}
   let next=if get(&host,"resumeNextPage")?.is_truthy(){wait(one(&host,"prepareNext",&generation)).await?}else{JsValue::UNDEFINED};
   if !current(&host,&generation)?{return Ok(JsValue::UNDEFINED);}
   if next.is_null(){call(&host,"stop")?;notify(&host,"Final del libro.")?;return Ok(JsValue::UNDEFINED);}
   let plan=if next.is_truthy(){next}else{wait(call(&host,"prepareOpening")).await?};set(&host,"openingPlan",&JsValue::NULL)?;
   if !current(&host,&generation)?{return Ok(JsValue::UNDEFINED);}
   one(&host,"adopt",&plan)?;
   let complete=get(&host,"completeOpening")?;set(&host,"completeOpening",&JsValue::FALSE)?;set(&host,"resumeNextPage",&JsValue::FALSE)?;
   if !get(&get(&host,"chunks")?,"length")?.is_truthy()&&complete.is_truthy(){
    let text=optional(&get(&plan,"source")?,"text")?;
    if !absent(&text)&&call(&boxed(&text)?,"trim")?.is_truthy(){return failed(&host,"No empieza ninguna frase completa en esta página. Cambia de página para continuar.");}
   }
   if !get(&get(&host,"chunks")?,"length")?.is_truthy(){return failed(&host,"Esta página no contiene texto legible. Los PDF escaneados necesitan reconocimiento de texto para escucharlos.");}
   playing(&host)?;Ok(JsValue::UNDEFINED)
  }.await;
  match outcome{Ok(value)=>Ok(value),Err(_)=>{if current(&host,&generation)?{failed(&host,"No se pudo preparar el texto.")?;}Ok(JsValue::UNDEFINED)}}
 }))
}
