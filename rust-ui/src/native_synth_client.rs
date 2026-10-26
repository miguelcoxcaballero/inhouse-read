//! The Android synthesis client: the same Piper/Nakdimon/Supertonic models and PCM processing as the worker, run on the
//! native ONNX executor with native completion events. Here: the preparation of a voice (the release of the previous one,
//! the model read and the cold phonemizer started side by side, the generation checks that keep a late result out of the
//! next voice), the serial chain of synth jobs and the synthesis of one fragment. The state stays on the JavaScript client;
//! the ONNX Runtime tensors and runs, the phonemizer closure and the promise reactions are the host's (native-client.js).
use std::{cell::RefCell,rc::Rc};
use wasm_bindgen::{prelude::*,JsCast};
use wasm_bindgen_futures::JsFuture;
use crate::eager::eager;
use js_sys::{Array,Float32Array,Object,Promise};
use crate::host::{get,read,set,method,call,construct,absent,num,clock};

type R<T=JsValue>=Result<T,JsValue>;
fn st(v:&str)->JsValue{JsValue::from_str(v)}
fn n(v:f64)->JsValue{JsValue::from_f64(v)}
fn t(v:&JsValue)->bool{v.is_truthy()}
async fn settle(value:JsValue)->R{JsFuture::from(Promise::resolve(&value)).await}

/// `Object.assign(new Error(message), {code})`.
fn coded(message:&str,code:&str)->R{let error=construct("Error",&[&st(message)])?;set(&error,"code",&st(code))?;Ok(error)}
fn failure(message:&str)->R{coded(message,"init-failed")}
fn plan(s:&JsValue)->R{read(s,"plan")}
fn plan_call(s:&JsValue,name:&str,args:&[&JsValue])->R{method(&plan(s)?,name,args)}
fn current(s:&JsValue,generation:&JsValue)->R<bool>{Ok(t(&plan_call(s,"current",&[generation])?))}
fn check(s:&JsValue,generation:&JsValue)->R<()>{if current(s,generation)?{Ok(())}else{Err(failure("Voice released")?)}}
/// `await value?.name()`: an absent value is still one await.
async fn settle_opt(value:&JsValue,name:&str)->R{let result=if absent(value){JsValue::UNDEFINED}else{method(value,name,&[])?};settle(result).await}
fn options(pairs:&[(&str,&JsValue)])->R{let o=Object::new();for (key,value) in pairs{set(&o,key,value)?;}Ok(o.into())}
/// `Promise.reject(error)` when a synchronous host call threw, so it settles like the async function that made it.
fn promised(result:R)->JsValue{match result{Ok(value)=>value,Err(error)=>Promise::reject(&error).into()}}

/// The aligned Piper model: the duration output it exposes, and its session on the native executor.
async fn piper_session(s:&JsValue,ort:&JsValue,model:JsValue,kit:&JsValue)->R{
 let bytes=construct("Uint8Array",&[&model])?;
 let aligned=call(&read(kit,"exposePiperDurations")?,"exposePiperDurations",&[&bytes])?;
 set(s,"durationOutput",&read(&aligned,"name")?)?;
 settle(method(&read(ort,"InferenceSession")?,"create",&[&read(&aligned,"bytes")?])?).await
}

/// Makes `key` the voice the client holds, after the jobs already queued and in the order prepare() was asked.
#[wasm_bindgen]
pub fn native_client_prepare(s:JsValue,key:JsValue,generation:JsValue,kit:JsValue)->Promise{eager(prepare(s,key,generation,kit))}
async fn prepare(s:JsValue,key:JsValue,generation:JsValue,kit:JsValue)->R{
 if !t(&plan_call(&s,"pending",&[&generation])?){return Err(failure("Voice released")?);}
 // Only an actual voice preparation loads the small shared runtime ledger.
 let voice_core=plan_call(&s,"ready",&[])?;crate::promises::after(&voice_core,||{})?;
 settle(voice_core).await?;check(&s,&generation)?;settle(read(&s,"chain")?).await?;check(&s,&generation)?;
 if t(&plan_call(&s,"model",&[&n(0.0),&key])?){return read(&s,"config");}
 settle_opt(&read(&s,"session")?,"release").await?;settle_opt(&read(&s,"hebrew")?,"destroy").await?;settle_opt(&read(&s,"supertonic")?,"dispose").await?;
 check(&s,&generation)?;
 for name in ["session","hebrew","supertonic","loaded"]{set(&s,name,&JsValue::NULL)?;}
 plan_call(&s,"model",&[&n(3.0)])?;
 if !t(&read(&s,"ort")?){let made=method(&s,"createOrt",&[&options(&[("env",&read(&s,"env")?)])?])?;set(&s,"ort",&made)?;}
 let ort=read(&s,"ort")?;
 let config=settle(method(&read(&s,"store")?,"readConfig",&[&key])?).await?;check(&s,&generation)?;
 let kind=num(&plan_call(&s,"classifyRuntime",&[&config])?);
 if kind==2.0{
  let buffers=settle(method(&read(&s,"store")?,"readRuntimeAssets",&[&key])?).await?;check(&s,&generation)?;
  // Inference itself yields to the native executor. A microtask between lightweight recipe steps adds no frozen
  // MessageChannel dependency.
  let request=options(&[("ort",&ort),("buffers",&buffers),("config",&read(&config,"config")?),("indexer",&read(&config,"indexer")?),
   ("styles",&read(&config,"styles")?),("yieldToMessages",&read(&kit,"immediate")?)])?;
  let runtime=settle(call(&read(&kit,"createSupertonicRuntime")?,"createSupertonicRuntime",&[&request])?).await?;
  if !current(&s,&generation)?{settle(method(&runtime,"dispose",&[])?).await?;check(&s,&generation)?;}
  set(&s,"supertonic",&runtime)?;
 }else if kind==1.0{
  // Both Hebrew graphs share the single native upload slot.
  let pointing=settle(method(&read(&s,"store")?,"readPhonemizerModel",&[&key])?).await?;check(&s,&generation)?;
  let request=options(&[("ort",&ort),("model",&pointing),("config",&config)])?;
  let hebrew=settle(call(&read(&kit,"createHebrewPhonemizer")?,"createHebrewPhonemizer",&[&request])?).await?;
  if !current(&s,&generation)?{settle(method(&hebrew,"destroy",&[])?).await?;check(&s,&generation)?;}
  set(&s,"hebrew",&hebrew)?;
  let model=settle(method(&read(&s,"store")?,"readModel",&[&key])?).await?;check(&s,&generation)?;
  let session=piper_session(&s,&ort,model,&kit).await?;
  if !current(&s,&generation)?{settle(method(&session,"release",&[])?).await?;check(&s,&generation)?;}
  set(&s,"session",&session)?;
 }else{
  // Reading/uploading the acoustic model and initializing the phonemizer are independent: both start now. Both are
  // drained on error, so a late job never installs resources into the next requested voice.
  let phon_ready=if t(&read(&s,"phon")?){Promise::resolve(&JsValue::UNDEFINED)}else{
   let made=promised(method(&s,"createPhon",&[&options(&[("base",&read(&s,"phonBase")?)])?]));
   let (s,generation)=(s.clone(),generation.clone());
   eager(async move{
    let phon=settle(made).await?;
    if !current(&s,&generation)?{method(&phon,"destroy",&[])?;return Err(failure("Voice released")?);}
    set(&s,"phon",&phon)?;Ok(JsValue::UNDEFINED)
   })
  };
  let session=Rc::new(RefCell::new(JsValue::UNDEFINED));
  let model=promised(read(&s,"store").and_then(|store|method(&store,"readModel",&[&key])));
  let model_ready={
   let (s,generation,ort,kit,session)=(s.clone(),generation.clone(),ort.clone(),kit.clone(),session.clone());
   eager(async move{
    let model=settle(model).await?;check(&s,&generation)?;
    let bytes=construct("Uint8Array",&[&model])?;
    let aligned=call(&read(&kit,"exposePiperDurations")?,"exposePiperDurations",&[&bytes])?;
    set(&s,"durationOutput",&read(&aligned,"name")?)?;
    let made=settle(method(&read(&ort,"InferenceSession")?,"create",&[&read(&aligned,"bytes")?])?).await?;
    *session.borrow_mut()=made;check(&s,&generation)?;Ok(JsValue::UNDEFINED)
   })
  };
  let outcomes=Array::from(&JsFuture::from(Promise::all_settled(&Array::of2(&phon_ready,&model_ready))).await?);
  let failed=outcomes.iter().find(|outcome|get(outcome,"status")==st("rejected"));
  if let Some(failed)=failed{
   let loaded=session.borrow().clone();
   if !absent(&loaded){if let Ok(released)=method(&loaded,"release",&[]){let _=settle(released).await;}}
   else{let _=settle(JsValue::UNDEFINED).await;}
   return Err(get(&failed,"reason"));
  }
  check(&s,&generation)?;set(&s,"session",&session.borrow())?;
 }
 check(&s,&generation)?;plan_call(&s,"model",&[&n(2.0),&key])?;set(&s,"config",&config)?;set(&s,"loaded",&key)?;
 Ok(config)
}

/// A job asked for before the voice core existed: it fails with the engine's words unless a release forgot it.
#[wasm_bindgen]
pub fn native_client_unloaded(s:JsValue,id:JsValue,generation:JsValue,handlers:JsValue)->R<()>{
 if t(&plan_call(&s,"pending",&[&generation])?)&&t(&method(&read(&s,"jobs")?,"delete",&[&id])?){
  method(&handlers,"onError",&[&coded("No voice loaded","synth-failed")?])?;
 }
 Ok(())
}

fn finish(s:&JsValue,id:&JsValue)->R<()>{plan_call(s,"cancel",&[id])?;method(&read(s,"jobs")?,"delete",&[id])?;Ok(())}
/// One queued job: synthesise it, then end it (or fail it) unless it was cancelled or the client released meanwhile.
#[wasm_bindgen]
pub fn native_client_job(s:JsValue,request:JsValue,handlers:JsValue,active:JsValue,id:JsValue,kit:JsValue)->Promise{
 eager(async move{job(s,request,handlers,active,id,kit).await.map(|()|JsValue::UNDEFINED)})
}
async fn job(s:JsValue,request:JsValue,handlers:JsValue,active:JsValue,id:JsValue,kit:JsValue)->R<()>{
 let live=||->R<bool>{Ok(t(&call(&active,"active",&[])?))};
 if !live()?{return Ok(());}
 match synthesize(&s,&request,&handlers,&active,&kit).await{
  Ok(())=>if live()?{finish(&s,&id)?;method(&handlers,"onEnd",&[])?;},
  Err(error)=>if live()?{
   finish(&s,&id)?;
   let target:Object=crate::host::boxed(&error).unchecked_into();
   let code:Object=options(&[("code",&st("synth-failed"))])?.unchecked_into();
   method(&handlers,"onError",&[&Object::assign(&target,&code)])?;
  }
 }
 Ok(())
}

/// `[...text].length`: code points, a lone surrogate counting as one (the string iterator, as Array.from uses it).
fn code_points(text:&JsValue)->f64{f64::from(Array::from(text).length())}
fn on_plan(handlers:&JsValue,counts:&Array)->R<()>{
 let plan=read(handlers,"onPlan")?;
 if !absent(&plan){let f=plan.dyn_ref::<js_sys::Function>().ok_or_else(||JsValue::from(js_sys::TypeError::new("onPlan is not a function")))?;f.call1(handlers,counts)?;}
 Ok(())
}
fn chunk(pairs:&[(&str,&JsValue)])->R{options(pairs)}

async fn synthesize(s:&JsValue,request:&JsValue,handlers:&JsValue,active:&JsValue,kit:&JsValue)->R<()>{
 let (text,rate,speaker,lang,style)=(read(request,"text")?,read(request,"rate")?,read(request,"speaker")?,read(request,"lang")?,read(request,"style")?);
 let marks=read(request,"marks")?;let marks=if marks.is_undefined(){Array::new().into()}else{marks};
 let (config,ort,key,session)=(read(s,"config")?,read(s,"ort")?,read(s,"loaded")?,read(s,"session")?);
 let (phon,hebrew,duration_output,kind)=(read(s,"phon")?,read(s,"hebrew")?,read(s,"durationOutput")?,read(&plan(s)?,"runtimeKind")?);
 if !t(&config)||!t(&ort){return Err(failure("No voice loaded")?);}
 let live=||->R<bool>{Ok(t(&call(active,"active",&[])?))};
 let supertonic=read(s,"supertonic")?;
 if t(&supertonic){
  on_plan(handlers,&Array::of1(&n(crate::host::jmax(1.0,code_points(&text)))))?;
  let start=clock()?;
  let asked=options(&[("lang",&lang),("style",&style),("rate",&rate),("marks",&marks),("isActive",active)])?;
  let result=settle(method(&supertonic,"synthesize",&[&text,&asked])?).await?;
  let (raw,sample_rate,timeline)=(read(&result,"pcm")?,read(&result,"sampleRate")?,read(&result,"marks")?);
  let timeline=if timeline.is_undefined(){Array::new().into()}else{timeline};
  if !live()?{return Ok(());}
  if !raw.is_instance_of::<Float32Array>(){return Err(failure("Invalid audio")?);}
  let done=call(&read(kit,"finishSupertonic")?,"finishSupertonic",&[&raw,&text,&timeline,&options(&[("sampleRate",&sample_rate),("rate",&rate)])?])?;
  if !t(&done){return Err(failure("Invalid audio")?);} // a sample that is not a number
  let pcm=if t(&read(&raw,"length")?){read(&done,"pcm")?}else{call(&read(kit,"silence")?,"silence",&[&sample_rate,&n(120.0)])?};
  let ms=n(clock()?-start);
  method(handlers,"onChunk",&[&chunk(&[("index",&n(0.0)),("last",&JsValue::TRUE),("pcm",&pcm),("sampleRate",&sample_rate),("ms",&ms),("marks",&read(&done,"marks")?)])?])?;
  return Ok(());
 }
 let phonemize=method(s,"_phonemizer",&[&kind,&hebrew,&phon,&config])?;
 let ids=settle(call(&phonemize,"phonemize",&[&text])?).await?;
 let points=if t(&duration_output){settle(call(&read(kit,"phonemeMarks")?,"phonemeMarks",&[&text,&marks,&ids,&phonemize])?).await?}else{Array::new().into()};
 if !live()?{return Ok(());}
 let segments=Array::from(&call(&read(kit,"splitSegments")?,"splitSegments",&[&ids])?);
 let sample_rate=read(&read(&config,"audio")?,"sample_rate")?;
 let counts=if segments.length()>0{segments.iter().map(|part|get(&part,"length")).collect::<Array>()}else{Array::of1(&n(0.0))};
 on_plan(handlers,&counts)?;
 if segments.length()==0{
  let pcm=call(&read(kit,"silence")?,"silence",&[&sample_rate,&n(120.0)])?;
  method(handlers,"onChunk",&[&chunk(&[("index",&n(0.0)),("last",&JsValue::TRUE),("pcm",&pcm),("sampleRate",&sample_rate),("ms",&n(0.0))])?])?;
  return Ok(());
 }
 let mut base=0.0;
 for index in 0..segments.length(){
  if !live()?{return Ok(());}
  let part=segments.get(index);let start=clock()?;
  let out=settle(method(s,"_run",&[&ort,&session,&part,&config,&rate,&speaker,&duration_output])?).await?;
  if !live()?{return Ok(());}
  let last=index+1==segments.length();let count=num(&get(&part,"length"));
  let shape=options(&[("sampleRate",&sample_rate),("model",&key),("rate",&rate),("last",&JsValue::from_bool(last)),("first",&JsValue::from_bool(index==0)),("base",&n(base)),("count",&n(count))])?;
  let done=call(&read(kit,"finishPiper")?,"finishPiper",&[&read(&out,"raw")?,&read(&out,"durations")?,&points,&text,&shape])?;
  base+=count;
  let ms=n(clock()?-start);
  method(handlers,"onChunk",&[&chunk(&[("index",&n(f64::from(index))),("last",&JsValue::from_bool(last)),("pcm",&read(&done,"pcm")?),("sampleRate",&sample_rate),("ms",&ms),("marks",&read(&done,"marks")?)])?])?;
 }
 Ok(())
}

/// Releases everything native: jobs are forgotten, the phonemizer and the executor are destroyed.
#[wasm_bindgen]
pub fn native_client_dispose(s:JsValue)->R<()>{
 plan_call(&s,"dispose",&[])?;method(&read(&s,"jobs")?,"clear",&[])?;
 for name in ["loading","loaded","config"]{set(&s,name,&JsValue::NULL)?;}
 let phon=read(&s,"phon")?;if !absent(&phon){method(&phon,"destroy",&[])?;}set(&s,"phon",&JsValue::NULL)?;
 let ort=read(&s,"ort")?;if !absent(&ort){method(&ort,"dispose",&[])?;}set(&s,"ort",&JsValue::NULL)?;
 for name in ["session","hebrew","supertonic"]{set(&s,name,&JsValue::NULL)?;}
 set(&s,"chain",&Promise::resolve(&JsValue::UNDEFINED))?;set(&s,"preparationChain",&Promise::resolve(&JsValue::UNDEFINED))?;
 Ok(())
}
