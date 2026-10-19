//! Short shelf cues: admission, voice ownership and audio-device sleeping.
//! Browser objects and callback cycles are GC-owned; no Rust closure or native
//! allocation survives a call. Recorded-buffer selection remains a host port.
use wasm_bindgen::{prelude::*,JsCast};
use js_sys::{Array,Promise,Reflect,Set};
use crate::host::{absent,call,method,num,read,set,truthy,jmin,jmax};
use crate::cloud_host::object;
type R<T> = Result<T,JsValue>;
#[wasm_bindgen]
extern "C" {
 #[wasm_bindgen(catch,js_name=Number)]
 fn sound_number(value:&JsValue)->R<f64>;
}
fn s(value:&str)->JsValue{value.into()}
fn invoke(host:&JsValue,name:&str,args:&[&JsValue])->R<JsValue>{call(&read(host,name)?,name,args)}
fn global(host:&JsValue)->R<JsValue>{read(host,"global")}
fn window(host:&JsValue,name:&str,args:&[&JsValue])->R<JsValue>{method(&global(host)?,name,args)}
fn now(host:&JsValue)->R<f64>{Ok(num(&method(&read(&global(host)?,"performance")?,"now",&[])?))}
fn hidden(host:&JsValue)->R<bool>{Ok(read(&read(host,"document")?,"visibilityState")?==s("hidden"))}
fn collection(state:&JsValue,name:&str)->R<Set>{Ok(read(state,name)?.unchecked_into())}
fn silence(host:&JsValue,promise:&JsValue)->R<JsValue>{method(promise,"catch",&[&read(host,"ignore")?])}
fn clear_idle(host:&JsValue,state:&JsValue)->R<()>{window(host,"clearTimeout",&[&read(state,"idle")?])?;Ok(())}
fn state_is(audio:&JsValue,state:&str)->R<bool>{Ok(!absent(audio)&&read(audio,"state")?==s(state))}
fn suspend(host:&JsValue,audio:&JsValue)->R<()>{if state_is(audio,"running")?{silence(host,&method(audio,"suspend",&[])?)?;}Ok(())}
fn numeric(value:&JsValue)->R<f64>{let value=match value.as_f64(){Some(value)=>value,None=>sound_number(value)?};Ok(if value.is_nan(){0.0}else{value})}
fn equals(value:&JsValue,number:f64)->bool{value.as_f64()==Some(number)}

#[wasm_bindgen]
pub fn cozy_transport_new(muted:bool)->JsValue{object(&[
 ("context",JsValue::NULL),("master",JsValue::NULL),("unlocked",false.into()),("muted",muted.into()),
 ("serial",0.into()),("idle",0.into()),("owners",0.into()),("viewUntil",f64::NEG_INFINITY.into()),
 ("voices",Set::new(&JsValue::UNDEFINED).into()),("tails",Set::new(&JsValue::UNDEFINED).into()),
])}

#[wasm_bindgen]
pub fn cozy_transport_enabled(host:JsValue,state:JsValue)->R<bool>{enabled(&host,&state)}
fn enabled(host:&JsValue,state:&JsValue)->R<bool>{Ok(num(&read(state,"owners")?)>0.0&&!truthy(&read(state,"muted")?)&&truthy(&read(state,"unlocked")?)&&!hidden(host)?)}

#[wasm_bindgen]
pub fn cozy_transport_level(strength:JsValue)->R<u32>{let value=numeric(&strength)?;Ok(if value<0.33{0}else if value<0.66{1}else{2})}

#[wasm_bindgen]
pub fn cozy_transport_stop(host:JsValue,state:JsValue)->R<()>{stop(&host,&state)}
fn stop(host:&JsValue,state:&JsValue)->R<()>{
 clear_idle(host,state)?;set(state,"idle",&0.into())?;
 let voices=collection(state,"voices")?;let tails=collection(state,"tails")?;
 let all=Array::from(&voices);for voice in Array::from(&tails){all.push(&voice);}
 for voice in all{
  let source=read(&voice,"source")?;
  let _=(||->R<()>{set(&source,"onended",&JsValue::NULL)?;method(&source,"stop",&[])?;Ok(())})();
  disconnect(&voice)?;
 }
 voices.clear();tails.clear();suspend(host,&read(state,"context")?)
}
fn disconnect(voice:&JsValue)->R<()>{
 method(&read(voice,"source")?,"disconnect",&[])?;method(&read(voice,"gain")?,"disconnect",&[])?;
 let pan=read(voice,"pan")?;if !absent(&pan){method(&pan,"disconnect",&[])?;}Ok(())
}

#[wasm_bindgen]
pub fn cozy_transport_park(host:JsValue,state:JsValue)->R<()>{park(&host,&state)}
fn park(host:&JsValue,state:&JsValue)->R<()>{
 clear_idle(host,state)?;if !truthy(&read(state,"owners")?){return Ok(());}
 if collection(state,"voices")?.size()==0{
  set(state,"idle",&window(host,"setTimeout",&[&read(host,"idle")?,&180.into()])?)?;
 }Ok(())
}

#[wasm_bindgen]
pub fn cozy_transport_idle(host:JsValue,state:JsValue)->R<()>{
 set(&state,"idle",&0.into())?;if collection(&state,"voices")?.size()==0{suspend(&host,&read(&state,"context")?)?;}Ok(())
}

#[wasm_bindgen]
pub fn cozy_transport_prime_ended(source:JsValue)->R<()>{set(&source,"onended",&JsValue::NULL)?;method(&source,"disconnect",&[])?;Ok(())}

#[wasm_bindgen]
pub fn cozy_transport_failed(host:JsValue,state:JsValue,playing:bool)->R<()>{
 set(&state,"unlocked",&false.into())?;if playing{stop(&host,&state)?;}Ok(())
}

#[wasm_bindgen]
pub fn cozy_transport_unlock(host:JsValue,state:JsValue)->R<()>{unlock(&host,&state)}
fn unlock(host:&JsValue,state:&JsValue)->R<()>{
 if !truthy(&read(state,"owners")?)||truthy(&read(state,"muted")?)||hidden(host)?{return Ok(());}
 let global=global(host)?;let constructor=read(&global,"AudioContext")?;
 let constructor=if truthy(&constructor){constructor}else{read(&global,"webkitAudioContext")?};
 if !truthy(&constructor){return Ok(());}
 let result=(||->R<()>{
  let old=read(state,"context")?;
  if !truthy(&old)||state_is(&old,"closed")?{
   stop(host,state)?;
   let arguments=Array::new();arguments.push(&object(&[("latencyHint",s("interactive"))]));
   let audio=Reflect::construct(constructor.unchecked_ref(),&arguments)?;set(state,"context",&audio)?;
   let master=method(&audio,"createGain",&[])?;set(state,"master",&master)?;
   set(&read(&master,"gain")?,"value",&0.42.into())?;method(&master,"connect",&[&read(&audio,"destination")?])?;
   invoke(host,"clearBuffers",&[])?;
   let prime=method(&audio,"createBufferSource",&[])?;
   set(&prime,"buffer",&method(&audio,"createBuffer",&[&1.into(),&1.into(),&24000.into()])?)?;
   method(&prime,"connect",&[&master])?;set(&prime,"onended",&invoke(host,"primeEnded",&[&prime])?)?;method(&prime,"start",&[])?;
  }
  set(state,"unlocked",&true.into())?;clear_idle(host,state)?;invoke(host,"loadAtlas",&[])?;
  let audio=read(state,"context")?;
  let resumed=if state_is(&audio,"suspended")?{method(&audio,"resume",&[])?}else{Promise::resolve(&JsValue::UNDEFINED).into()};
  method(&resumed,"then",&[&read(host,"park")?,&read(host,"unlockFailed")?])?;Ok(())
 })();
 if result.is_err(){set(state,"unlocked",&false.into())?;}Ok(())
}

#[wasm_bindgen]
pub fn cozy_transport_voice_ended(host:JsValue,state:JsValue,voice:JsValue)->R<()>{
 collection(&state,"voices")?.delete(&voice);collection(&state,"tails")?.delete(&voice);disconnect(&voice)?;park(&host,&state)
}

#[wasm_bindgen]
pub fn cozy_transport_play(host:JsValue,state:JsValue,kind:JsValue,material:JsValue,strength:JsValue,pan:JsValue)->R<()>{
 if [4.0,8.0,11.0,18.0].iter().any(|value|equals(&kind,*value)){return Ok(());}
 if !enabled(&host,&state)?||!truthy(&read(&state,"context")?){return Ok(());}
 if (equals(&kind,31.0)||equals(&kind,32.0))&&now(&host)?<num(&read(&state,"viewUntil")?){return Ok(());}
 if equals(&kind,33.0)||equals(&kind,34.0){set(&state,"viewUntil",&(now(&host)?+550.0).into())?;}
 let audio=read(&state,"context")?;let requested=now(&host)?;let serial=num(&read(&state,"serial")?);
 set(&state,"serial",&(serial+1.0).into())?;
 let variant=serial%3.0;let level=cozy_transport_level(strength.clone())?;let resuming=state_is(&audio,"suspended")?;
 if resuming{method(&method(&audio,"resume",&[])?,"catch",&[&read(&host,"playFailed")?])?;}
 if read(&state,"context")?!=audio||!enabled(&host,&state)?||(!state_is(&audio,"running")?&&!(resuming&&state_is(&audio,"suspended")?))||now(&host)?-requested>180.0{return Ok(());}
 let result=(||->R<()>{
  let plan=invoke(&host,"buffer",&[&audio,&kind,&material,&JsValue::from(level),&variant.into()])?;
  if absent(&plan){return Ok(());}
  clear_idle(&host,&state)?;
  let voices=collection(&state,"voices")?;
  if voices.size()>=4{
   let first=Array::from(&voices).get(0);voices.delete(&first);collection(&state,"tails")?.add(&first);
   method(&read(&read(&first,"gain")?,"gain")?,"setTargetAtTime",&[&0.into(),&read(&audio,"currentTime")?,&0.006.into()])?;
   method(&read(&first,"source")?,"stop",&[&(num(&read(&audio,"currentTime")?)+0.025).into()])?;
  }
  let source=method(&audio,"createBufferSource",&[])?;let gain=method(&audio,"createGain",&[])?;
  set(&source,"buffer",&read(&plan,"buffer")?)?;
  let playback_rate=read(&source,"playbackRate")?;if truthy(&playback_rate){set(&playback_rate,"value",&read(&plan,"rate")?)?;}
  set(&read(&gain,"gain")?,"value",&jmax(0.0,jmin(1.0,numeric(&strength)?)).into())?;method(&source,"connect",&[&gain])?;
  let factory=read(&audio,"createStereoPanner")?;
  let stereo=if absent(&factory){JsValue::UNDEFINED}else{method(&audio,"createStereoPanner",&[])?};
  if truthy(&stereo){
   set(&read(&stereo,"pan")?,"value",&jmax(-0.7,jmin(0.7,numeric(&pan)?)).into())?;
   method(&gain,"connect",&[&stereo])?;method(&stereo,"connect",&[&read(&state,"master")?])?;
  }else{method(&gain,"connect",&[&read(&state,"master")?])?;}
  let voice=object(&[("source",source.clone()),("gain",gain),("pan",stereo)]);voices.add(&voice);
  set(&source,"onended",&invoke(&host,"voiceEnded",&[&voice])?)?;method(&source,"start",&[])?;Ok(())
 })();
 if result.is_err(){park(&host,&state)?;}Ok(())
}

#[wasm_bindgen]
pub fn cozy_transport_muted(host:JsValue,state:JsValue,muted:bool)->R<()>{
 set(&state,"muted",&muted.into())?;invoke(&host,"persistPreference",&[])?;
 if muted{stop(&host,&state)}else{unlock(&host,&state)}
}

#[wasm_bindgen]
pub fn cozy_transport_attach(host:JsValue,state:JsValue,root:JsValue)->R<JsValue>{
 set(&state,"owners",&(num(&read(&state,"owners")?)+1.0).into())?;
 let registration=object(&[("root",root.clone()),("disposed",false.into())]);
 let callbacks=invoke(&host,"attachment",&[&registration])?;set(&registration,"callbacks",&callbacks)?;
 let gesture=read(&callbacks,"gesture")?;
 method(&root,"addEventListener",&[&s("pointerdown"),&gesture,&object(&[("capture",true.into()),("passive",true.into())])])?;
 method(&root,"addEventListener",&[&s("keydown"),&gesture,&true.into()])?;
 method(&read(&host,"document")?,"addEventListener",&[&s("visibilitychange"),&read(&callbacks,"hidden")?])?;
 window(&host,"addEventListener",&[&s("pagehide"),&read(&callbacks,"pageHidden")?])?;
 read(&callbacks,"dispose")
}

#[wasm_bindgen]
pub fn cozy_transport_gesture(host:JsValue,state:JsValue,event:JsValue)->R<()>{if truthy(&read(&event,"isTrusted")?){unlock(&host,&state)?;}Ok(())}

#[wasm_bindgen]
pub fn cozy_transport_hidden(host:JsValue,state:JsValue)->R<()>{if hidden(&host)?{stop(&host,&state)?;}Ok(())}

#[wasm_bindgen]
pub fn cozy_transport_dispose(host:JsValue,state:JsValue,registration:JsValue)->R<()>{
 if truthy(&read(&registration,"disposed")?){return Ok(());}set(&registration,"disposed",&true.into())?;
 let root=read(&registration,"root")?;let callbacks=read(&registration,"callbacks")?;let gesture=read(&callbacks,"gesture")?;
 method(&root,"removeEventListener",&[&s("pointerdown"),&gesture,&true.into()])?;
 method(&root,"removeEventListener",&[&s("keydown"),&gesture,&true.into()])?;
 method(&read(&host,"document")?,"removeEventListener",&[&s("visibilitychange"),&read(&callbacks,"hidden")?])?;
 window(&host,"removeEventListener",&[&s("pagehide"),&read(&callbacks,"pageHidden")?])?;
 let owners=num(&read(&state,"owners")?)-1.0;set(&state,"owners",&owners.into())?;
 if owners==0.0{
  stop(&host,&state)?;let audio=read(&state,"context")?;
  set(&state,"master",&JsValue::NULL)?;set(&state,"context",&JsValue::NULL)?;invoke(&host,"clearBuffers",&[])?;set(&state,"unlocked",&false.into())?;
  let _=(||->R<()>{if !absent(&audio){let result=method(&audio,"close",&[])?;if !absent(&result){silence(&host,&result)?;}}Ok(())})();
 }Ok(())
}
