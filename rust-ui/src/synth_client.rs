//! Page-side handle of the synthesis worker (worker.js has the protocol): the routing of its answers, the calls that wait
//! for one, the synth jobs, the teardown, and the preparation of a voice (start the worker, read the model out of Cache
//! Storage while it starts, load it). It knows nothing about audio or about reading: it turns messages into promises and
//! callbacks. The state stays on the JavaScript client (worker, calls, jobs, loaded, ready, loading, config) and its
//! VoiceClientPlan ledger; the closures the worker and the promises call back are the host's (client.js).
use wasm_bindgen::{prelude::*,JsCast};
use wasm_bindgen_futures::JsFuture;
use crate::eager::eager;
use js_sys::{Array,Object,Promise};
use crate::host::{get,read,set,method,call,construct,absent};

type R<T=JsValue>=Result<T,JsValue>;
fn st(v:&str)->JsValue{JsValue::from_str(v)}
fn t(v:&JsValue)->bool{v.is_truthy()}

/// Error whose `code` is the 'error' reason of the engine contract: `Object.assign(new Error(message), {code}, cause ? {cause} : {})`.
#[wasm_bindgen]
pub fn synth_client_error(code:JsValue,message:JsValue,cause:JsValue)->R{
 let error=construct("Error",&[&message])?;
 set(&error,"code",&code)?;
 if t(&cause){set(&error,"cause",&cause)?;}
 Ok(error)
}
fn failure(code:&str,message:&str)->R{synth_client_error(st(code),st(message),JsValue::UNDEFINED)}
fn released()->R{failure("init-failed","worker was released")}

fn plan(s:&JsValue)->R{read(s,"plan")}
fn values(map:&JsValue)->R<Array>{Ok(Array::from(&method(map,"values",&[])?))}
/// `try { worker?.terminate() } catch {}`.
fn terminate(worker:&JsValue){if !absent(worker){let _=method(worker,"terminate",&[]);}}
fn reject_all(list:&Array,error:&JsValue)->R<()>{for i in 0..list.length(){method(&list.get(i),"reject",&[error])?;}Ok(())}

/// One message of the worker: a call answered (resolved or rejected), a job's plan/chunk/end/error, or a stage receipt.
#[wasm_bindgen]
pub fn synth_client_message(s:JsValue,m:JsValue)->R<()>{
 let action=crate::host::num(&method(&plan(&s)?,"message",&[&m])?);
 if action==7.0{
  let stage=read(&s,"onStage");
  // Diagnostics never settle a job: a failing receipt is ignored.
  if let Ok(stage)=stage{if !absent(&stage){let _=stage.dyn_ref::<js_sys::Function>().ok_or(JsValue::NULL).and_then(|f|{
   let args=Array::of4(&get(&m,"domain"),&get(&m,"stage"),&get(&m,"id"),&get(&m,"part"));f.apply(&s,&args)});}}
  return Ok(());
 }
 if action==1.0||action==2.0{
  let (calls,id)=(read(&s,"calls")?,read(&m,"id")?);
  let pending=method(&calls,"get",&[&id])?;method(&calls,"delete",&[&id])?;
  if action==1.0{method(&pending,"resolve",&[&m])?;}
  else{method(&pending,"reject",&[&synth_client_error(st("init-failed"),read(&m,"error")?,JsValue::UNDEFINED)?])?;}
  return Ok(());
 }
 if action==0.0||action.is_nan(){return Ok(());}
 let (jobs,id)=(read(&s,"jobs")?,read(&m,"id")?);
 let job=method(&jobs,"get",&[&id])?;
 if action==3.0{let plan=read(&job,"onPlan")?;if !absent(&plan){call_this(&plan,&job,&[&read(&m,"counts")?])?;}}
 else if action==4.0{method(&job,"onChunk",&[&m])?;}
 else if action==5.0{method(&jobs,"delete",&[&id])?;method(&job,"onEnd",&[])?;}
 else if action==6.0{method(&jobs,"delete",&[&id])?;method(&job,"onError",&[&synth_client_error(st("synth-failed"),read(&m,"error")?,JsValue::UNDEFINED)?])?;}
 Ok(())
}
/// `job.onPlan?.(counts)`: a present non-function throws as the engine does.
fn call_this(function:&JsValue,this:&JsValue,args:&[&JsValue])->R{
 let f=function.dyn_ref::<js_sys::Function>().ok_or_else(||JsValue::from(js_sys::TypeError::new("onPlan is not a function")))?;
 let list=Array::new();for a in args{list.push(a);}f.apply(this,&list)
}

/// The worker died or sent what cannot be read: everything is released and every running job gets the error.
#[wasm_bindgen]
pub fn synth_client_crash(s:JsValue,error:JsValue)->R<()>{
 let jobs=values(&read(&s,"jobs")?)?;
 method(&s,"dispose",&[&error])?;
 for i in 0..jobs.length(){method(&jobs.get(i),"onError",&[&error])?;}
 Ok(())
}

/// A request the worker answers with the same id: `{...message, id}` is posted and the promise settles with its answer.
#[wasm_bindgen]
pub fn synth_client_call(s:JsValue,message:JsValue,transfer:JsValue)->Promise{
 Promise::new(&mut |resolve:js_sys::Function,reject:js_sys::Function|{
  let posted=(||->R<()>{
   let id=method(&plan(&s)?,"next",&[&st("call")])?;
   let pending=Object::new();set(&pending,"resolve",&resolve)?;set(&pending,"reject",&reject)?;
   method(&read(&s,"calls")?,"set",&[&id,&pending])?;
   let body=Object::assign(&Object::new(),message.unchecked_ref());set(&body,"id",&id)?;
   method(&read(&s,"worker")?,"postMessage",&[&body,&transfer])?;Ok(())
  })();
  if let Err(error)=posted{let _=reject.call1(&JsValue::UNDEFINED,&error);}
 })
}
fn transfer_none()->JsValue{Array::new().into()}

/// Runs a synth job: registers its handlers and posts it. Returns the job id (the host returns `{id, cancel}`).
#[wasm_bindgen]
pub fn synth_client_synth(s:JsValue,request:JsValue,handlers:JsValue)->R{
 let (text,rate,speaker)=(read(&request,"text")?,read(&request,"rate")?,read(&request,"speaker")?);
 let (lang,style,marks)=(read(&request,"lang")?,read(&request,"style")?,read(&request,"marks")?);
 let worker=read(&s,"worker")?;
 if !t(&worker){return Err(failure("init-failed","worker is not running")?);}
 let id=method(&plan(&s)?,"next",&[&st("job")])?;
 method(&read(&s,"jobs")?,"set",&[&id,&handlers])?;
 let message=Object::new();
 set(&message,"type",&st("synth"))?;set(&message,"id",&id)?;set(&message,"text",&text)?;set(&message,"rate",&rate)?;set(&message,"speaker",&speaker)?;
 if t(&lang){set(&message,"lang",&lang)?;}
 if t(&style){set(&message,"style",&style)?;}
 if !absent(&marks)&&t(&get(&marks,"length")){set(&message,"marks",&marks)?;}
 method(&read(&s,"worker")?,"postMessage",&[&message])?;
 Ok(id)
}
/// After it, no handler of the job is called any more; the worker forgets it too.
#[wasm_bindgen]
pub fn synth_client_cancel(s:JsValue,id:JsValue)->R<()>{
 if t(&method(&plan(&s)?,"cancel",&[&id])?){
  method(&read(&s,"jobs")?,"delete",&[&id])?;
  let worker=read(&s,"worker")?;
  if !absent(&worker){let message=Object::new();set(&message,"type",&st("cancel"))?;set(&message,"id",&id)?;method(&worker,"postMessage",&[&message])?;}
 }
 Ok(())
}

/// Terminates the worker (frees the ~0.6 GB of its WASM heap); the next prepare() rebuilds it from the cached model.
#[wasm_bindgen]
pub fn synth_client_dispose(s:JsValue,error:JsValue)->R<()>{
 let error=if error.is_undefined(){released()?}else{error};
 let worker=read(&s,"worker")?;
 let calls=values(&read(&s,"calls")?)?;
 let preparations=Array::from(&read(&s,"preparations")?);
 method(&plan(&s)?,"dispose",&[])?;
 set(&s,"preparationChain",&Promise::resolve(&JsValue::UNDEFINED))?;
 for key in ["worker","ready","loaded","loading","config"]{set(&s,key,&JsValue::NULL)?;}
 method(&read(&s,"calls")?,"clear",&[])?;method(&read(&s,"jobs")?,"clear",&[])?;
 method(&read(&s,"preparations")?,"clear",&[])?;
 terminate(&worker);
 reject_all(&calls,&error)?;
 for i in 0..preparations.length(){call(&preparations.get(i),"reject",&[&error])?;}
 Ok(())
}

fn model(s:&JsValue,operation:f64,key:&JsValue)->R<bool>{Ok(t(&method(&plan(s)?,"model",&[&JsValue::from_f64(operation),key])?))}
fn current(s:&JsValue,generation:&JsValue)->R<bool>{Ok(t(&method(&plan(s)?,"current",&[generation])?))}
fn same_worker(s:&JsValue,worker:&JsValue)->R<bool>{Ok(read(s,"worker")?==*worker)}
async fn settle(value:JsValue)->R{JsFuture::from(Promise::resolve(&value)).await}

/// What the worker needs to load the voice, read out of Cache Storage while the worker starts. `readConfig` is asked at
/// once; the rest follows the config: the shared Supertonic pack, or the Piper model (and the Hebrew pointing model).
fn read_voice(s:&JsValue,key:&JsValue,worker:&JsValue,generation:&JsValue)->R<Promise>{
 let config=method(s,"readConfig",&[key])?;
 let (s,key,worker,generation)=(s.clone(),key.clone(),worker.clone(),generation.clone());
 Ok(eager(async move{
  let config=settle(config).await?;
  if !same_worker(&s,&worker)?||!current(&s,&generation)?{return Err(released()?);}
  let out=Object::new();set(&out,"config",&config)?;
  if crate::host::num(&method(&plan(&s)?,"classifyRuntime",&[&config])?)==2.0{
   let buffers=settle(method(&s,"readRuntimeAssets",&[&key])?).await?;set(&out,"buffers",&buffers)?;
   return Ok(out.into());
  }
  let both=Array::of2(&method(&s,"readModel",&[&key])?,&method(&s,"readPhonemizerModel",&[&key])?);
  let both=Array::from(&JsFuture::from(Promise::all(&both)).await?);
  set(&out,"model",&both.get(0))?;set(&out,"phonemizerModel",&both.get(1))?;
  Ok(out.into())
 }))
}

/// Starts the worker if needed and makes `key` the voice it holds. Resolves with the voice's config. `generation` is the
/// ledger capture of the prepare() that queued this work: a release in between makes it fail without touching anything.
#[wasm_bindgen]
pub fn synth_client_prepare(s:JsValue,key:JsValue,generation:JsValue)->Promise{eager(prepare(s,key,generation))}
async fn prepare(s:JsValue,key:JsValue,generation:JsValue)->R{
 if !t(&method(&plan(&s)?,"pending",&[&generation])?){return Err(released()?);}
 settle(method(&plan(&s)?,"ready",&[])?).await?;
 if !current(&s,&generation)?{return Err(released()?);}
 // ORT session.release() does not shrink WASM's grown heap. A family change terminates that worker; language/profile
 // changes share the same pack.
 if model(&s,1.0,&key)?{
  let (worker,calls,jobs)=(read(&s,"worker")?,values(&read(&s,"calls")?)?,values(&read(&s,"jobs")?)?);
  let error=failure("init-failed","voice runtime was replaced")?;
  for name in ["worker","ready","loaded","config"]{set(&s,name,&JsValue::NULL)?;}
  method(&read(&s,"calls")?,"clear",&[])?;method(&read(&s,"jobs")?,"clear",&[])?;method(&plan(&s)?,"model",&[&JsValue::from_f64(3.0)])?;
  terminate(&worker);
  reject_all(&calls,&error)?;
  for i in 0..jobs.length(){method(&jobs.get(i),"onError",&[&error])?;}
 }
 method(&s,"_spawn",&[])?;
 let worker=read(&s,"worker")?;
 if !t(&read(&s,"ready")?){
  let init=Object::new();
  set(&init,"type",&st("init"))?;set(&init,"ortBase",&read(&s,"ortBase")?)?;set(&init,"phonBase",&read(&s,"phonBase")?)?;
  if t(&read(&s,"onStage")?){set(&init,"diagnostics",&JsValue::TRUE)?;}
  if model(&s,4.0,&key)?{set(&init,"runtime",&st("supertonic3"))?;}
  set(&s,"ready",&synth_client_call(s.clone(),init.into(),transfer_none()).into())?;
 }
 let reading=if model(&s,0.0,&key)?{None}else{
  let promise=read_voice(&s,&key,&worker,&generation)?;
  crate::promises::after(&promise,||{})?;
  Some(promise)
 };
 if let Err(error)=settle(read(&s,"ready")?).await{
  if same_worker(&s,&worker)?&&current(&s,&generation)?{method(&s,"dispose",&[])?;}
  return Err(error);
 }
 if !same_worker(&s,&worker)?||!current(&s,&generation)?{return Err(released()?);}
 if model(&s,0.0,&key)?{return read(&s,"config");}
 let voice=settle(reading.map_or(JsValue::NULL,JsValue::from)).await?;
 let (config,model_bytes,phonemizer,buffers)=(read(&voice,"config")?,read(&voice,"model")?,read(&voice,"phonemizerModel")?,read(&voice,"buffers")?);
 if !same_worker(&s,&worker)?||!current(&s,&generation)?{return Err(released()?);}
 let transfer=Array::new();
 if t(&buffers){
  let unique=js_sys::Set::new(&Object::values(buffers.unchecked_ref()));
  unique.for_each(&mut |value,_,_|{transfer.push(&value);});
 }else if t(&phonemizer){transfer.push(&model_bytes);transfer.push(&phonemizer);}
 else{transfer.push(&model_bytes);}
 let load=Object::new();
 set(&load,"type",&st("load"))?;set(&load,"voice",&key)?;set(&load,"config",&config)?;
 if t(&buffers){set(&load,"buffers",&buffers)?;}else{set(&load,"model",&model_bytes)?;}
 if t(&phonemizer){set(&load,"phonemizerModel",&phonemizer)?;}
 let loaded=JsFuture::from(synth_client_call(s.clone(),load.into(),transfer.into())).await?;
 if !same_worker(&s,&worker)?||!current(&s,&generation)?{return Err(released()?);}
 model(&s,2.0,&key)?;
 set(&s,"loaded",&key)?;set(&s,"config",&config)?;set(&s,"createMs",&read(&loaded,"createMs")?)?;
 Ok(config)
}
