//! Keep browsing separate from the audible cursor. Async seeks are gated by the
//! original generation; returning to audio also checks the browsing epoch.
use wasm_bindgen::{prelude::*,JsCast};
use wasm_bindgen_futures::{future_to_promise,JsFuture};
use js_sys::{Array,Function,Object,Promise};
use crate::reader_actions::{get,set,call,one,invoke};
use crate::voice_join::spread;
fn absent(v:&JsValue)->bool{v.is_null()||v.is_undefined()}
fn optional(v:&JsValue,key:&str)->Result<JsValue,JsValue>{if absent(v){Ok(JsValue::UNDEFINED)}else{get(v,key)}}
fn maybe(v:&JsValue,key:&str,args:&Array)->Result<JsValue,JsValue>{let method=optional(v,key)?;if absent(&method){Ok(JsValue::UNDEFINED)}else{method.dyn_into::<Function>().map_err(|_|JsValue::from(js_sys::TypeError::new("Speech navigation is not callable")))?.apply(v,args)}}
async fn wait(value:Result<JsValue,JsValue>)->Result<JsValue,JsValue>{JsFuture::from(Promise::resolve(&value?)).await}
fn active(host:&JsValue,generation:&JsValue)->Result<bool,JsValue>{Ok(get(host,"generation")?==*generation&&get(host,"state")?==JsValue::from_str("playing"))}
#[wasm_bindgen]
extern "C"{
 #[wasm_bindgen(catch,js_name=Number)]fn number(value:&JsValue)->Result<f64,JsValue>;
}
fn contains(item:&JsValue,offset:f64)->Result<bool,JsValue>{let sentence=get(item,"sentence")?;if !sentence.is_truthy(){return Ok(false);}Ok(offset>=number(&get(&sentence,"start")?)?&&offset<number(&get(&sentence,"end")?)?)}
#[wasm_bindgen]
pub fn voice_browse(host:JsValue,add:Function)->Result<(),JsValue>{
 let state=get(&host,"state")?;if !["playing","paused","loading"].iter().any(|s|state==JsValue::from_str(s)){return Ok(());}
 let epoch=get(&host,"browseEpoch")?;let epoch=if epoch.is_truthy(){epoch}else{0.into()};
 let next=if let Some(n)=epoch.as_f64(){(n+1.0).into()}else{add.call2(&JsValue::UNDEFINED,&epoch,&1.into())?};
 set(&host,"browseEpoch",&next)?;set(&host,"browsing",&JsValue::TRUE)?;
 maybe(&get(&host,"reader")?,"browseSpeech",&Array::new())?;call(&host,"notify")?;Ok(())
}
#[wasm_bindgen]
pub fn voice_return_audio(host:JsValue)->Result<Promise,JsValue>{
 if !get(&host,"browsing")?.is_truthy(){return Ok(Promise::resolve(&JsValue::UNDEFINED));}
 let epoch=get(&host,"browseEpoch")?;let generation=get(&host,"generation")?;
 let pending=maybe(&get(&host,"reader")?,"returnToSpeech",&Array::new());
 Ok(future_to_promise(async move{
  wait(pending).await?;
  if get(&host,"browseEpoch")?!=epoch||get(&host,"generation")?!=generation{return Ok(JsValue::UNDEFINED);}
  set(&host,"browsing",&JsValue::FALSE)?;call(&host,"notify")?;Ok(JsValue::UNDEFINED)
 }))
}
#[wasm_bindgen]
pub fn voice_continue_page(host:JsValue,navigate:JsValue)->Result<Promise,JsValue>{
 call(&host,"browse")?;
 let pending=if absent(&navigate){Ok(JsValue::UNDEFINED)}else{navigate.dyn_into::<Function>().map_err(|_|JsValue::from(js_sys::TypeError::new("Navigation is not callable"))).and_then(|f|f.call0(&JsValue::UNDEFINED))};
 Ok(future_to_promise(async move{wait(pending).await?;Ok(JsValue::UNDEFINED)}))
}
#[wasm_bindgen]
pub fn voice_jump_point(host:JsValue,doc:JsValue,x:JsValue,y:JsValue)->Result<bool,JsValue>{
 if get(&host,"state")?!=JsValue::from_str("playing"){return Ok(false);}
 let source=get(&host,"source")?;if !optional(&source,"offsetAtPoint")?.is_function(){return Ok(false);}
 let offset=match invoke(&source,"offsetAtPoint",&Array::of3(&doc,&x,&y)){Ok(value)=>match value.as_f64(){Some(n) if n.is_finite()=>n,_=>return Ok(false)},Err(_)=>return Ok(false)};
 let items:Array=get(&host,"items")?.unchecked_into();let mut hit=None;
 for index in 0..items.length(){if contains(&items.get(index),offset)?{hit=Some(index);break;}}
 let Some(hit)=hit else{return Ok(false)};let start=get(&get(&items.get(hit),"sentence")?,"start")?;let mut first=hit;
 while first>0&&optional(&get(&items.get(first-1),"sentence")?,"start")?==start{first-=1;}
 set(&host,"index",&first.into())?;call(&host,"restart")?;Ok(true)
}
#[wasm_bindgen]
pub fn voice_seek_point(host:JsValue,doc:JsValue,x:JsValue,y:JsValue)->Result<Promise,JsValue>{
 let generation=get(&host,"generation")?;
 let request=Object::new();set(&request,"visible",&JsValue::TRUE)?;
 let pending=(||maybe(&get(&host,"reader")?,"getSpeechSource",&Array::of1(&request)))();
 Ok(future_to_promise(async move{
  let outcome=async{
   let source=wait(pending).await?;if !active(&host,&generation)?{return Ok(());}
   let offset=maybe(&source,"offsetAtPoint",&Array::of3(&doc,&x,&y))?;
   let Some(offset)=offset.as_f64().filter(|n|n.is_finite()) else{return Ok(())};
   let input=spread(&source)?;set(&input,"start",&0.into())?;
   let plan=wait(one(&host,"prepare",&input)).await?;if !active(&host,&generation)?{return Ok(());}
   let items:Array=get(&plan,"items")?.unchecked_into();let mut hit=None;
   for item in items.iter(){if contains(&item,offset)?{hit=Some(item);break;}}
   let Some(hit)=hit else{return Ok(())};
   call(&host,"stop")?;
   let kept=Array::new();for index in 0..items.length(){if !js_sys::Reflect::has(&items,&index.into())?{continue;}let item=items.get(index);
    if number(&get(&item,"start")?)?>=number(&get(&get(&hit,"sentence")?,"start")?)?{kept.push(&item);}}
   let adopted=Object::new();set(&adopted,"source",&source)?;set(&adopted,"items",&kept)?;one(&host,"adopt",&adopted)?;
   set(&host,"state",&"playing".into())?;set(&host,"waiting",&JsValue::TRUE)?;
   one(&host,"notify",&"Preparando la voz natural…".into())?;call(&host,"speakCurrent")?;Ok::<(),JsValue>(())
  }.await;
  // Stale frames or a hold outside text do not change the listening cursor.
  let _=outcome;Ok(JsValue::UNDEFINED)
 }))
}
