//! Audible-start presentation and sentence highlighting. Preserve source handles
//! and only commit a detached page after the corresponding PCM has started.
use wasm_bindgen::{prelude::*,JsCast};
use js_sys::{Array,Function,Object,Reflect};
use crate::reader_actions::{get,set,call,one};
fn absent(v:&JsValue)->bool{v.is_null()||v.is_undefined()}
fn optional(v:&JsValue,key:&str)->Result<JsValue,JsValue>{if absent(v){Ok(JsValue::UNDEFINED)}else{get(v,key)}}
fn maybe(v:&JsValue,key:&str,args:&Array)->Result<JsValue,JsValue>{let method=get(v,key)?;if absent(&method){Ok(JsValue::UNDEFINED)}else{method.dyn_into::<Function>().map_err(|_|JsValue::from(js_sys::TypeError::new("Speech presentation method is not callable")))?.apply(v,args)}}
fn optional_call(v:&JsValue,key:&str,args:&Array)->Result<JsValue,JsValue>{if absent(v){Ok(JsValue::UNDEFINED)}else{maybe(v,key,args)}}
fn timer(host:&JsValue,key:&str,clear:&Function)->Result<(),JsValue>{clear.call1(&JsValue::UNDEFINED,&get(host,key)?)?;Ok(())}
fn notify(host:&JsValue,text:&str)->Result<(),JsValue>{one(host,"notify",&text.into())?;Ok(())}
#[wasm_bindgen]
extern "C"{#[wasm_bindgen(catch,js_name=Number)]fn number(value:&JsValue)->Result<f64,JsValue>;}
#[wasm_bindgen]
pub fn voice_engine_started(host:JsValue,id:JsValue,clear:Function,native:Function)->Result<(),JsValue>{
 if id!=get(&host,"utteranceId")?||get(&host,"state")?!=JsValue::from_str("playing"){return Ok(());}
 set(&host,"startedId",&id)?;timer(&host,"waitTimer",&clear)?;
 if get(&host,"waiting")?.is_truthy(){set(&host,"waiting",&JsValue::FALSE)?;call(&host,"notify")?;}
 one(&host,"present",&id)?;
 let native=native.call0(&JsValue::UNDEFINED)?;let position=get(&get(&host,"reader")?,"speechPosition")?;
 if optional(&native,"session")?==get(&host,"nativeSession")?&&optional(&position,"index")?.as_f64().is_some_and(|n|n.is_finite()&&n.fract()==0.0){
  let _=(||{let bridge=get(&native,"bridge")?;let mark=get(&bridge,"mark")?;if !absent(&mark){
   let args=Array::of4(&get(&native,"session")?,&id,&get(&position,"index")?,&get(&position,"kind")?);
   mark.dyn_into::<Function>().map_err(|_|JsValue::from(js_sys::TypeError::new("Native mark is not callable")))?.apply(&bridge,&args)?;
  }Ok::<(),JsValue>(())})();
 }
 if get(&host,"state")?==JsValue::from_str("playing"){call(&host,"prepareAhead")?;}Ok(())
}
#[wasm_bindgen]
pub fn voice_engine_ended(host:JsValue,id:JsValue)->Result<(),JsValue>{
 set(&host,"neuralRetries",&0.into())?;
 if get(&host,"startedId")?!=id&&optional(&get(&host,"source")?,"activate")?.is_truthy(){call(&host,"pause")?;notify(&host,"No se pudo iniciar la voz natural. Pulsa Reintentar para volver a usarla.")?;return Ok(());}
 if get(&host,"startedId")?!=id{one(&host,"present",&id)?;}Ok(())
}
fn find_mark(marks:JsValue,offset:&JsValue,later:bool)->Result<JsValue,JsValue>{
 if absent(&marks){return Ok(JsValue::UNDEFINED);}
 let marks:Array=marks.unchecked_into();
 for index in 0..marks.length(){let mark=marks.get(index);let value=get(&mark,"offset")?;
  if if later{number(&value)?>number(offset)?}else{value==*offset}{return Ok(mark);}
 }Ok(JsValue::UNDEFINED)
}
#[wasm_bindgen]
pub fn voice_present(host:JsValue,id:JsValue,offset:JsValue,clear:Function,ignore:Function)->Result<(),JsValue>{
 timer(&host,"presentTimer",&clear)?;
 if id!=get(&host,"utteranceId")?||get(&host,"state")?!=JsValue::from_str("playing"){return Ok(());}
 let item=Reflect::get(&get(&host,"items")?,&get(&host,"index")?)?;
 let boundary=if offset.is_truthy(){find_mark(optional(&item,"marks")?,&offset,false)?}else{JsValue::NULL};
 if offset.is_truthy()&&!boundary.is_truthy(){return Ok(());}
 let source=optional(&boundary,"source")?;let source=if source.is_truthy(){source}else{get(&host,"source")?};
 if !source.is_truthy()||!optional(&item,"sentence")?.is_truthy(){return Ok(());}
 if get(&source,"activate")?.is_truthy(){
  if get(&host,"startedId")?!=id{return Ok(());}
  if call(&source,"activate").ok()!=Some(JsValue::TRUE){call(&host,"pause")?;notify(&host,"No se pudo mostrar la página. Pulsa Reintentar para continuar.")?;return Ok(());}
  set(&host,"deferredPage",&JsValue::NULL)?;
 }
 let sentence=optional(&boundary,"sentence")?;let sentence=if sentence.is_truthy(){sentence}else{get(&item,"sentence")?};let start=get(&sentence,"start")?;let end=get(&sentence,"end")?;
 let _=(||{
  let shown=get(&host,"shown")?;
  if !shown.is_truthy()||get(&shown,"source")?!=source||get(&shown,"start")?!=start||get(&shown,"end")?!=end{
   if shown.is_truthy()&&get(&shown,"source")?!=source{maybe(&get(&shown,"source")?,"clear",&Array::new())?;}
   let shown=Object::new();set(&shown,"source",&source)?;set(&shown,"start",&start)?;set(&shown,"end",&end)?;set(&host,"shown",&shown)?;
   maybe(&source,"highlight",&Array::of2(&start,&end))?;
  }
  let first=optional(&boundary,"start")?;let first=if absent(&first){get(&item,"start")?}else{first};
  let next=find_mark(get(&item,"marks")?,&offset,true)?;
  let last=if next.is_truthy()&&(!get(&next,"source")?.is_truthy()||get(&next,"source")?==source){get(&next,"start")?}else{
   let end=optional(&optional(&boundary,"sentence")?,"end")?;if absent(&end){get(&item,"end")?}else{end}
  };
  let followed=maybe(&source,"follow",&Array::of2(&first,&last))?;ignore.call1(&JsValue::UNDEFINED,&followed)?;Ok::<(),JsValue>(())
 })();Ok(())
}
#[wasm_bindgen]
pub fn voice_unpaint(host:JsValue,clear:Function)->Result<(),JsValue>{
 timer(&host,"presentTimer",&clear)?;let shown=get(&host,"shown")?;set(&host,"shown",&JsValue::NULL)?;
 if !absent(&shown){maybe(&get(&shown,"source")?,"clear",&Array::new())?;}
 if get(&host,"source")?!=optional(&shown,"source")?{optional_call(&get(&host,"source")?,"clear",&Array::new())?;}Ok(())
}
