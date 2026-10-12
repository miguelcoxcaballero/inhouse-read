//! Dispatch each utterance only after its page-join candidate is ready.
//! Timer and promise callbacks are host-owned; Rust owns the state decisions.
use wasm_bindgen::{prelude::*,JsCast};
use js_sys::{Array,Function,Object,Reflect};
use crate::reader_actions::{get,set,call,one};
const FAILED:&str="No se pudo iniciar la voz natural. Pulsa Reintentar para volver a usarla.";
const MISSING:&str="La voz natural seleccionada no está instalada. Descárgala de nuevo.";
fn absent(v:&JsValue)->bool{v.is_null()||v.is_undefined()}
fn optional(v:&JsValue,key:&str)->Result<JsValue,JsValue>{if absent(v){Ok(JsValue::UNDEFINED)}else{get(v,key)}}
fn maybe(v:&JsValue,key:&str,args:&Array)->Result<JsValue,JsValue>{let method=optional(v,key)?;if absent(&method){Ok(JsValue::UNDEFINED)}else{method.dyn_into::<Function>().map_err(|_|JsValue::from(js_sys::TypeError::new("Speech dispatch method is not callable")))?.apply(v,args)}}
fn active(host:&JsValue,id:&JsValue)->Result<bool,JsValue>{Ok(get(host,"utteranceId")?==*id&&get(host,"state")?==JsValue::from_str("playing"))}
fn notify(host:&JsValue,message:&str)->Result<(),JsValue>{one(host,"notify",&message.into())?;Ok(())}
#[wasm_bindgen]
extern "C"{
 #[wasm_bindgen(catch,js_name=Number)]fn number(v:&JsValue)->Result<f64,JsValue>;
 #[wasm_bindgen(catch,js_name=String)]fn string(v:&JsValue)->Result<String,JsValue>;
}
#[wasm_bindgen]
pub fn voice_join_ready(host:JsValue,generation:JsValue,index:JsValue)->Result<(),JsValue>{
 if get(&host,"generation")?!=generation||get(&host,"state")?!=JsValue::from_str("playing")||get(&host,"index")?!=index{return Ok(());}
 call(&host,"joinPageSentence")?;set(&Reflect::get(&get(&host,"items")?,&index)?,"joinChecked",&JsValue::TRUE)?;call(&host,"speakCurrent")?;Ok(())
}
#[wasm_bindgen]
pub fn voice_speak_current(host:JsValue,voices:Function,base:Function,is_neural:Function,now:Function,join:Function)->Result<(),JsValue>{
 if get(&host,"state")?!=JsValue::from_str("playing"){return Ok(());}
 let index=get(&host,"index")?;let current=Reflect::get(&get(&host,"items")?,&index)?;
 let needs=get(&host,"needsPageJoin")?.dyn_into::<Function>().map_err(|_|JsValue::from(js_sys::TypeError::new("Join decision is not callable")))?.call2(&host,&current,&index)?;
 if needs.is_truthy()&&!get(&current,"joinChecked")?.is_truthy(){
  call(&host,"prepareAhead")?;let promise=optional(&get(&host,"aheadPage")?,"promise")?;
  if promise.is_truthy(){join.call4(&JsValue::UNDEFINED,&host,&promise,&get(&host,"generation")?,&get(&host,"index")?)?;return Ok(());}
  set(&current,"joinChecked",&JsValue::TRUE)?;
 }
 let generation=get(&host,"generation")?;let index=get(&host,"index")?;let time=now.call0(&JsValue::UNDEFINED)?;let count=get(&host,"spoken")?;
 let spoken=number(&if count.is_truthy(){count}else{0.into()})?+1.0;set(&host,"spoken",&spoken.into())?;
 let id:JsValue=format!("{}-{}-{}-{}",string(&generation)?,string(&index)?,string(&time)?,string(&spoken.into())?).into();set(&host,"utteranceId",&id)?;
 let text=Reflect::get(&get(&host,"chunks")?,&get(&host,"index")?)?;let selected=one(&host,"voiceFor",&text)?;let language=get(&selected,"language")?;let voice=get(&selected,"voice")?;set(&host,"spokenWith",&voice)?;
 if optional(&voice,"neural")?.is_truthy(){get(&host,"speakNeural")?.dyn_into::<Function>().map_err(|_|JsValue::from(js_sys::TypeError::new("Neural dispatch is not callable")))?.call3(&host,&id,&text,&voice)?;return Ok(());}
 set(&host,"neuralOff",&"not-installed".into())?;
 let available:Array=voices.call0(&JsValue::UNDEFINED)?.unchecked_into();let mut exists=false;
 for i in 0..available.length(){if Reflect::has(&available,&i.into())?&&get(&available.get(i),"base")?==base.call1(&JsValue::UNDEFINED,&language)?{exists=true;break;}}
 let voice=get(&host,"voice")?;
 let message=if voice.is_truthy()&&is_neural.call1(&JsValue::UNDEFINED,&voice)?.is_truthy(){MISSING}else if exists{"Descarga una voz natural para este idioma."}else{"No hay voz natural para este idioma. Elige uno de los idiomas disponibles."};
 one(&host,"fail",&message.into())?;Ok(())
}
#[wasm_bindgen]
pub fn voice_wait_started(host:JsValue,id:JsValue)->Result<(),JsValue>{
 if active(&host,&id)?&&get(&host,"startedId")?!=id&&!get(&host,"waiting")?.is_truthy(){set(&host,"waiting",&JsValue::TRUE)?;notify(&host,"Preparando la voz natural…")?;}Ok(())
}
#[wasm_bindgen]
pub fn voice_speak_neural(host:JsValue,id:JsValue,text:JsValue,voice:JsValue,engine:Function,native:Function,clear:Function,timer:Function,failed:Function)->Result<bool,JsValue>{
 let engine=engine.call0(&JsValue::UNDEFINED)?;
 if !engine.is_truthy(){set(&host,"neuralOff",&"init-failed".into())?;one(&host,"fail",&FAILED.into())?;return Ok(false);}
 clear.call1(&JsValue::UNDEFINED,&get(&host,"presentTimer")?)?;one(&host,"useTransport",&"neural".into())?;
 let next=one(&host,"upcomingFor",&voice)?;clear.call1(&JsValue::UNDEFINED,&get(&host,"waitTimer")?)?;
 set(&host,"waitTimer",&timer.call2(&JsValue::UNDEFINED,&host,&id)?)?;
 let result=(||{
  let item=Reflect::get(&get(&host,"items")?,&get(&host,"index")?)?;let marks=optional(&item,"marks")?;let offsets=Array::new();
  if !absent(&marks){let marks:Array=marks.unchecked_into();offsets.set_length(marks.length());for i in 0..marks.length(){if Reflect::has(&marks,&i.into())?{offsets.set(i,get(&marks.get(i),"offset")?);}}}
  let args=Object::new();for(key,value)in[("text",text),("voiceId",get(&voice,"id")?),("rate",get(&host,"rate")?),("id",id.clone()),("upcoming",get(&next,"upcoming")?),("deferAfter",get(&next,"deferAfter")?)]{set(&args,key,&value)?;}
  if offsets.length()>0{set(&args,"marks",&offsets)?;}one(&engine,"speak",&args)?;
  let session=optional(&native.call0(&JsValue::UNDEFINED)?,"session")?;set(&host,"nativeSession",&if session.is_truthy(){session}else{get(&host,"nativeSession")?})?;Ok::<(),JsValue>(())
 })();
 if result.is_err(){failed.call2(&JsValue::UNDEFINED,&host,&id)?;}Ok(true)
}
#[wasm_bindgen]
pub fn voice_engine_failed(host:JsValue,detail:JsValue,clear:Function,engine:Function,ignore:Function)->Result<(),JsValue>{
 if !active(&host,&get(&detail,"id")?)?||get(&host,"transport")?!=JsValue::from_str("neural"){return Ok(());}
 let reason=get(&detail,"reason")?;clear.call1(&JsValue::UNDEFINED,&get(&host,"waitTimer")?)?;set(&host,"waiting",&JsValue::FALSE)?;
 let _=(||maybe(&engine.call0(&JsValue::UNDEFINED)?,"stop",&Array::new()))();
 if (reason==JsValue::from_str("synth-failed")||reason==JsValue::from_str("init-failed"))&&number(&get(&host,"neuralRetries")?)?<3.0{
  set(&host,"neuralRetries",&(number(&get(&host,"neuralRetries")?)?+1.0).into())?;set(&host,"waiting",&JsValue::TRUE)?;notify(&host,"Reiniciando la voz natural…")?;call(&host,"speakCurrent")?;return Ok(());
 }
 set(&host,"neuralOff",&if reason.is_truthy(){reason.clone()}else{"synth-failed".into()})?;
 if reason==JsValue::from_str("not-installed"){
  one(&get(&host,"missing")?,"add",&optional(&get(&host,"spokenWith")?,"id")?)?;
  let pending=maybe(&engine.call0(&JsValue::UNDEFINED)?,"refresh",&Array::new())?;ignore.call1(&JsValue::UNDEFINED,&pending)?;
 }
 call(&host,"pause")?;notify(&host,if reason==JsValue::from_str("not-installed"){MISSING}else{FAILED})?;Ok(())
}
#[wasm_bindgen]
pub fn voice_removed(host:JsValue,id:JsValue)->Result<(),JsValue>{
 one(&get(&host,"missing")?,"add",&id)?;
 if get(&host,"state")?==JsValue::from_str("playing")&&optional(&get(&host,"spokenWith")?,"id")?==id{call(&host,"pause")?;notify(&host,"Voz natural quitada. Elige otra voz natural para continuar.")?;}Ok(())
}
#[wasm_bindgen]
pub fn voice_sleep_expired(host:JsValue)->Result<(),JsValue>{call(&host,"stop")?;notify(&host,"Temporizador terminado.")?;Ok(())}
#[wasm_bindgen]
pub fn voice_set_sleep(host:JsValue,minutes:JsValue,clear:Function,timer:Function)->Result<(),JsValue>{
 clear.call1(&JsValue::UNDEFINED,&get(&host,"sleepTimer")?)?;
 if number(&minutes)?>0.0{set(&host,"sleepTimer",&timer.call2(&JsValue::UNDEFINED,&host,&(number(&minutes)?*60000.0).into())?)?;}Ok(())
}
