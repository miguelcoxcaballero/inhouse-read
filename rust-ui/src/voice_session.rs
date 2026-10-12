//! Session defaults, event gating and privacy-limited native diagnostics.
use std::cell::RefCell;
use wasm_bindgen::{prelude::*,JsCast};
use js_sys::{Array,Function,Object,Map,Set,RegExp};
use crate::reader_actions::{get,set,call,one,two};
fn absent(v:&JsValue)->bool{v.is_null()||v.is_undefined()}
fn optional(v:&JsValue,key:&str)->Result<JsValue,JsValue>{if absent(v){Ok(JsValue::UNDEFINED)}else{get(v,key)}}
fn object(values:&[(&str,JsValue)])->Result<Object,JsValue>{let v=Object::new();for(k,x)in values{set(&v,k,x)?;}Ok(v)}
fn maybe(v:&JsValue,key:&str)->Result<JsValue,JsValue>{let method=optional(v,key)?;if absent(&method){Ok(JsValue::UNDEFINED)}else{method.dyn_into::<Function>().map_err(|_|JsValue::from(js_sys::TypeError::new("Diagnostic method is not callable")))?.call0(v)}}
#[wasm_bindgen]
extern "C"{
 #[wasm_bindgen(catch,js_name=Number)]fn number(v:&JsValue)->Result<f64,JsValue>;
 #[wasm_bindgen(catch,js_name=String)]fn string(v:&JsValue)->Result<JsValue,JsValue>;
 #[wasm_bindgen(catch,js_name=Object)]fn boxed(v:&JsValue)->Result<JsValue,JsValue>;
}
#[wasm_bindgen]
pub fn voice_initialize(host:JsValue,reader:JsValue,on_state:JsValue)->Result<(),JsValue>{
 for(key,value)in[("reader",reader),("onState",on_state),("state","stopped".into()),("generation",0.into()),("openingLayout",0.into()),("index",0.into()),("chunks",Array::new().into()),("items",Array::new().into()),("source",JsValue::NULL),("preparingPage",JsValue::NULL),("deferredPage",JsValue::NULL),("resumeNextPage",JsValue::FALSE),("aheadPage",JsValue::NULL),("diagnosticAdvance",JsValue::NULL),("diagnosticStarts",0.into()),("diagnosticDones",0.into()),("rate",1.into()),("voice","".into()),("languageOverride","".into()),("options",object(&[("footnotes",JsValue::FALSE),("multilingual",JsValue::FALSE),("skipHeaders",JsValue::FALSE)])?.into()),("transport",JsValue::NULL),("neuralOff","".into()),("missing",Set::new(&JsValue::UNDEFINED).into()),("neuralRetries",0.into())]{set(&host,key,&value)?;}Ok(())
}
#[wasm_bindgen]
pub fn voice_event(host:JsValue,kind:String,detail:JsValue,pcm:Function)->Result<(),JsValue>{
 match kind.as_str(){
  "inhouse-tts"=>{
   if optional(&detail,"id")?!=get(&host,"utteranceId")?||get(&host,"state")?!=JsValue::from_str("playing"){return Ok(());}
   let kind=get(&detail,"type")?;
   if kind==JsValue::from_str("start"){set(&host,"diagnosticStarts",&(number(&get(&host,"diagnosticStarts")?)?+1.0).into())?;one(&host,"engineStarted",&get(&detail,"id")?)?;}
   if kind==JsValue::from_str("boundary"){two(&host,"present",&get(&detail,"id")?,&get(&detail,"offset")?)?;}
   if kind==JsValue::from_str("done"){set(&host,"diagnosticDones",&(number(&get(&host,"diagnosticDones")?)?+1.0).into())?;one(&host,"engineEnded",&get(&detail,"id")?)?;call(&host,"advance")?;}
   if kind==JsValue::from_str("interrupted"){call(&host,"pause")?;}
   if kind==JsValue::from_str("error"){one(&host,"engineFailed",&detail)?;}
  },
  "inhouse-speech-layout"=>{set(&host,"openingLayout",&(number(&get(&host,"openingLayout")?)?+1.0).into())?;set(&host,"openingPlan",&JsValue::NULL)?;call(&host,"refreshPageBreaks")?;},
  "inhouse-speech-hold"=>{if get(&host,"state")?!=JsValue::from_str("playing"){return Ok(());}set(&detail,"handled",&JsValue::TRUE)?;if !get(&detail,"probe")?.is_truthy(){one(&host,"seekToPoint",&detail)?;}},
  "inhouse-audio-control"=>{
   if !pcm.call0(&JsValue::UNDEFINED)?.is_truthy()||!get(&host,"nativeSession")?.is_truthy()||optional(&detail,"session")?!=get(&host,"nativeSession")?{return Ok(());}
   let action=get(&detail,"action")?;
   if action==JsValue::from_str("pause"){call(&host,"pause")?;}else if action==JsValue::from_str("stop"){call(&host,"stop")?;}else if action==JsValue::from_str("play")&&get(&host,"state")?==JsValue::from_str("paused"){call(&host,"play")?;}
  },_=>()
 }Ok(())
}
fn numeric(v:JsValue)->JsValue{if v.as_f64().is_some_and(|n|n.is_finite()&&n>=0.0){v}else{0.into()}}
fn integer(v:&JsValue,min:f64,max:f64)->bool{v.as_f64().is_some_and(|n|n.is_finite()&&n.fract()==0.0&&n>=min&&n<=max)}
fn bounded(v:JsValue,max:f64)->JsValue{if integer(&v,0.0,max){v}else{0.into()}}
fn diagnostic_engine(engine:&Function)->Result<JsValue,JsValue>{let value=maybe(&engine.call0(&JsValue::UNDEFINED)?,"getDiagnosticState")?;Ok(if absent(&value){JsValue::NULL}else{value})}
#[wasm_bindgen]
pub fn voice_diagnostic(host:JsValue,session:JsValue,native:Function,engine:Function,document:JsValue)->Result<JsValue,JsValue>{
 let native_session=get(&host,"nativeSession")?;if !native_session.is_truthy()||session!=native_session{return Ok(JsValue::NULL);}
 let reader=get(&get(&host,"reader")?,"speechDiagnosticState")?;let position=get(&get(&host,"reader")?,"speechPosition")?;
 let advance=get(&host,"diagnosticAdvance")?;let advance=if optional(&advance,"generation")?==get(&host,"generation")?{advance}else{JsValue::NULL};
 let visibility=get(&document,"visibilityState")?;let visibility=if ["visible","hidden","prerender"].iter().any(|v|visibility==JsValue::from_str(v)){visibility}else{"unknown".into()};
 let reader_kind=optional(&reader,"kind")?;let reader_kind=if ["pdf","foliate"].iter().any(|v|reader_kind==JsValue::from_str(v)){reader_kind}else{"none".into()};
 let index=optional(&position,"index")?;let index=if integer(&index,0.0,f64::INFINITY){index}else{JsValue::NULL};
 let reader_data=object(&[("kind",reader_kind),("index",index),("followPending",numeric(optional(&reader,"followPending")?)),("pageTurnPending",numeric(optional(&reader,"pageTurnPending")?))])?;
 let paginator=optional(&reader,"paginator")?;
 if paginator.is_truthy(){set(&reader_data,"paginator",&object(&[("turnStage",bounded(get(&paginator,"turnStage")?,3.0)),("displayStage",bounded(get(&paginator,"displayStage")?,6.0)),("sectionLoadPending",get(&paginator,"sectionLoadPending")?.is_truthy().into()),("viewLoadPending",get(&paginator,"viewLoadPending")?.is_truthy().into()),("viewReady",bounded(get(&paginator,"viewReady")?,3.0))])?.into())?;}
 let utterance=get(&host,"utteranceId")?;let stage=optional(&advance,"stage")?;
 Ok(object(&[
  ("schema",1.into()),("sessionMatches",JsValue::TRUE),("nativeSessionMatches",(optional(&native.call0(&JsValue::UNDEFINED)?,"session")?==get(&host,"nativeSession")?).into()),
  ("hidden",get(&document,"hidden")?.is_truthy().into()),("visibility",visibility),("state",get(&host,"state")?),("generation",get(&host,"generation")?),
  ("utteranceSequence",numeric(get(&host,"spoken")?)),("utterancePresent",utterance.is_truthy().into()),("utteranceStarted",(utterance.is_truthy()&&get(&host,"startedId")?==utterance).into()),
  ("index",get(&host,"index")?),("chunkCount",get(&get(&host,"chunks")?,"length")?),("itemCount",get(&get(&host,"items")?,"length")?),
  ("ttsStarts",get(&host,"diagnosticStarts")?),("ttsDones",get(&host,"diagnosticDones")?),("advanceStage",if stage.is_truthy(){stage}else{"idle".into()}),
  ("preparingPage",(optional(&get(&host,"preparingPage")?,"generation")?==get(&host,"generation")?).into()),("deferredPage",get(&host,"deferredPage")?.is_truthy().into()),("aheadPage",get(&host,"aheadPage")?.is_truthy().into()),
  ("reader",reader_data.into()),("engine",diagnostic_engine(&engine)?)
 ])?.into())
}
thread_local!{static PATTERNS:RefCell<Option<(RegExp,RegExp,RegExp)>>=const{RefCell::new(None)};}
fn patterns()->(RegExp,RegExp,RegExp){PATTERNS.with(|slot|{let mut slot=slot.borrow_mut();slot.get_or_insert_with(||(RegExp::new("\\[(?:\\d{1,3}|[*†‡])\\]","g"),RegExp::new("\\(\\s*(?:note|nota)\\s+\\d+\\s*\\)","gi"),RegExp::new("\\n+",""))).clone()})}
fn key(line:&JsValue)->Result<JsValue,JsValue>{call(&boxed(&call(&boxed(line)?,"trim")?)?,"toLocaleLowerCase")}
#[wasm_bindgen]
pub fn voice_prepare_text(host:JsValue,text:JsValue)->Result<JsValue,JsValue>{
 let mut value=string(&if text.is_truthy(){text}else{"".into()})?;let options=get(&host,"options")?;let(notes,labels,lines)=patterns();
 if !get(&options,"footnotes")?.is_truthy(){value=two(&boxed(&value)?,"replace",&notes.into(),&"".into())?;value=two(&boxed(&value)?,"replace",&labels.into(),&"".into())?;}
 if get(&options,"skipHeaders")?.is_truthy(){
  let lines:Array=one(&boxed(&value)?,"split",&lines.into())?.unchecked_into();let counts=Map::new();
  for line in lines.iter(){let key=key(&line)?;let length=number(&get(&boxed(&key)?,"length")?)?;if length>0.0&&length<90.0{counts.set(&key,&(counts.get(&key).as_f64().unwrap_or(0.0)+1.0).into());}}
  let kept=Array::new();for line in lines.iter(){let key=key(&line)?;if !(number(&get(&boxed(&key)?,"length")?)?<90.0&&counts.get(&key).as_f64().unwrap_or(0.0)>1.0){kept.push(&line);}}
  value=kept.join(" ").into();
 }Ok(value)
}
