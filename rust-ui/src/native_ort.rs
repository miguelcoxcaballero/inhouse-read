//! The ONNX Runtime surface of Android's native executor: one bridge token per runtime, numbered requests answered by
//! 'inhouse-inference' events, a model upload in 128 KiB base64 slices with an executor fence after four slices (or 4 ms
//! of encoding when the bridge can fence), feeds and outputs as typed base64 tensors, and a release that rejects every
//! request still waiting. A real inference completion returns through WebView.evaluateJavascript, so synthesis does not
//! wait for a background Worker message queue. No timer or fake audio. The runtime state is a plain JavaScript object
//! (env, bridge, token, pending, sequence, closed); the tensor codec and the event listener are the host's (native-ort.js).
use std::{cell::RefCell,rc::Rc};
use wasm_bindgen::{prelude::*,JsCast};
use js_sys::{Array,Function,Object,Promise,Uint8Array};
use crate::host::{get,read,set,method,method_opt,call,construct,absent,num};
use crate::eager::{eager,settled};

type R<T=JsValue>=Result<T,JsValue>;
const SLICE:u32=131072;
fn st(v:&str)->JsValue{JsValue::from_str(v)}
fn n(v:f64)->JsValue{JsValue::from_f64(v)}
fn t(v:&JsValue)->bool{v.is_truthy()}
/// `Object.assign(new Error(message), {code:'init-failed'})`.
fn failure(message:&JsValue)->R{let error=construct("Error",&[message])?;set(&error,"code",&st("init-failed"))?;Ok(error)}
fn fail(message:&str)->R{failure(&st(message))}
fn closed(o:&JsValue)->bool{t(&get(o,"closed"))}
fn pending(o:&JsValue)->R{read(o,"pending")}
fn token(o:&JsValue)->R{read(o,"token")}
fn bridge(o:&JsValue)->R{read(o,"bridge")}

/// A runtime on `bridge`, or an error when the native executor does not speak protocol 1. Its token is unique per page.
#[wasm_bindgen]
pub fn native_ort_open(env:JsValue,bridge:JsValue)->R{
 let protocol=if absent(&bridge){None}else{method_opt(&bridge,"getProtocol",&[])?};
 if protocol.is_none_or(|p|p!=n(1.0)){return Err(fail("Native inference unavailable")?);}
 let random:JsValue=method(&n(js_sys::Math::random()),"toString",&[&n(36.0)])?;
 let id=js_sys::JsString::from(format!("{}-",js_sys::Date::now())).concat(&method(&random,"slice",&[&n(2.0)])?);
 let o=Object::new();
 set(&o,"env",&env)?;set(&o,"bridge",&bridge)?;set(&o,"token",&id)?;set(&o,"pending",&js_sys::Map::new())?;
 set(&o,"sequence",&n(0.0))?;set(&o,"closed",&JsValue::FALSE)?;
 Ok(o.into())
}
/// The answer of one request: an event for another runtime or for a forgotten request changes nothing.
#[wasm_bindgen]
pub fn native_ort_event(o:JsValue,event:JsValue)->R<()>{
 let m=read(&event,"detail")?;
 if !t(&m)||read(&m,"token")?!=token(&o)?{return Ok(());}
 let id=read(&m,"id")?;let waiting=method(&pending(&o)?,"get",&[&id])?;
 if !t(&waiting){return Ok(());}
 method(&pending(&o)?,"delete",&[&id])?;
 let problem=read(&m,"error")?;
 if t(&problem){method(&waiting,"reject",&[&failure(&problem)?])?;}else{method(&waiting,"resolve",&[&read(&m,"value")?])?;}
 Ok(())
}
/// A numbered request: `invoke(id)` asks the bridge; its event settles the promise. A released runtime rejects at once.
fn request(o:&JsValue,invoke:impl FnOnce(JsValue)->R<()>)->Promise{
 let mut invoke=Some(invoke);
 Promise::new(&mut |resolve:Function,reject:Function|{
  let asked=(||->R<()>{
   if closed(o){reject.call1(&JsValue::UNDEFINED,&fail("Native inference released")?)?;return Ok(());}
   let id=n(num(&read(o,"sequence")?)+1.0);set(o,"sequence",&id)?;
   let waiting=Object::new();set(&waiting,"resolve",&resolve)?;set(&waiting,"reject",&reject)?;
   method(&pending(o)?,"set",&[&id,&waiting])?;
   if let Err(error)=invoke.take().map_or(Ok(()),|f|f(id.clone())){method(&pending(o)?,"delete",&[&id])?;reject.call1(&JsValue::UNDEFINED,&error)?;}
   Ok(())
  })();
  if let Err(error)=asked{let _=reject.call1(&JsValue::UNDEFINED,&error);}
 })
}
/// Rejects every waiting request and closes the bridge token. Twice is harmless.
#[wasm_bindgen]
pub fn native_ort_dispose(o:JsValue)->R<()>{
 if closed(&o){return Ok(());}
 set(&o,"closed",&JsValue::TRUE)?;
 method(&read(&o,"env")?,"removeEventListener",&[&st("inhouse-inference"),&read(&o,"listener")?])?;
 let list=Array::from(&method(&pending(&o)?,"values",&[])?);
 for i in 0..list.length(){method(&list.get(i),"reject",&[&fail("Native inference released")?])?;}
 method(&pending(&o)?,"clear",&[])?;method(&bridge(&o)?,"dispose",&[&token(&o)?])?;
 Ok(())
}

fn live(o:&JsValue,id:&JsValue)->R<bool>{Ok(!closed(o)&&t(&method(&pending(o)?,"has",&[id])?))}
fn now(env:&JsValue)->R<f64>{
 let value=match method_opt(&get(env,"performance"),"now",&[])?{Some(v)=>v,None=>JsValue::UNDEFINED};
 Ok(if absent(&value){js_sys::Date::now()}else{num(&value)})
}
/// The upload of one model: start, the ordered slices with their fences, finish. It stops quietly when the runtime or
/// the request was released.
async fn upload(o:JsValue,id:JsValue,bytes:Uint8Array,codec:JsValue)->R<()>{
 if !live(&o,&id)?{return Ok(());}
 let (bridge,env,token)=(bridge(&o)?,read(&o,"env")?,token(&o)?);
 let length=bytes.length();
 method(&bridge,"startModel",&[&token,&id,&n(f64::from(length))])?;
 let (mut slice_start,mut chunks)=(now(&env)?,0);
 let mut offset=0u32;
 while offset<length{
  if !live(&o,&id)?{return Ok(());}
  let data=call(&read(&codec,"encode")?,"encode",&[&bytes.subarray(offset,offset.saturating_add(SLICE).min(length)),&env])?;
  method(&bridge,"modelChunk",&[&token,&id,&n(f64::from(offset)),&data])?;
  chunks+=1;
  // Preserve the original exact arguments, bytes and ordered offsets. Session keys are positive request ids; release(0)
  // cannot remove one. Its reply is a genuine executor/UI callback, not a background timer.
  if f64::from(offset)+f64::from(SLICE)<f64::from(length)&&(chunks>=4||read(&bridge,"release")?.is_function()&&now(&env)?-slice_start>=4.0){
   let (bridge2,token2)=(bridge.clone(),token.clone());
   let value=settled(request(&o,move|request|{method(&bridge2,"release",&[&token2,&request,&n(0.0)])?;Ok(())}).into()).await?;
   if !live(&o,&id)?{return Ok(());}
   if !value.is_null(){return Err(fail("Invalid native upload fence")?);}
   slice_start=now(&env)?;chunks=0;
  }
  offset=offset.saturating_add(SLICE);
 }
 if !live(&o,&id)?{return Ok(());}
 method(&bridge,"finishModel",&[&token,&id])?;
 Ok(())
}

type Reaction=Closure<dyn FnMut(JsValue)>;
/// `promise.catch(failed)`: both reactions are released as soon as the promise settles either way.
fn on_reject(promise:&Promise,failed:impl FnOnce(JsValue)+'static)->R<()>{
 let pair:Rc<RefCell<Option<(Reaction,Reaction)>>>=Rc::new(RefCell::new(None));
 let action=Rc::new(RefCell::new(Some(failed)));
 let (p1,p2,a2)=(pair.clone(),pair.clone(),action.clone());
 let fulfilled=Closure::wrap(Box::new(move|_:JsValue|{p1.borrow_mut().take();}) as Box<dyn FnMut(JsValue)>);
 let rejected=Closure::wrap(Box::new(move|reason:JsValue|{let work=a2.borrow_mut().take();if let Some(work)=work{work(reason);}p2.borrow_mut().take();}) as Box<dyn FnMut(JsValue)>);
 method(promise,"then",&[fulfilled.as_ref(),rejected.as_ref()])?;
 *pair.borrow_mut()=Some((fulfilled,rejected));
 let _=action;Ok(())
}
/// A session of the native executor for `model`; `session` (host) turns the executor's answer into the session object.
#[wasm_bindgen]
pub fn native_ort_create(o:JsValue,model:JsValue,codec:JsValue,session:JsValue)->Promise{
 eager(async move{
  let bytes:Uint8Array=if model.is_instance_of::<Uint8Array>(){model.unchecked_into()}else{construct("Uint8Array",&[&model])?.unchecked_into()};
  if bytes.byte_length()==0{return Err(fail("Empty model")?);}
  // Protocol 1 includes release(). A missing endpoint must not fall back to an unbounded synchronous upload; small
  // legacy fixtures stay bounded.
  if closed(&o){return Err(fail("Native inference released")?);}
  if bytes.length()>4*SLICE&&!read(&bridge(&o)?,"release")?.is_function(){return Err(fail("Native upload fence unavailable")?);}
  let runtime=o.clone();
  let value=settled(request(&o,move|id|{
   let (o,job)=(runtime.clone(),id.clone());
   let started=eager(async move{upload(o,job,bytes,codec).await.map(|()|JsValue::UNDEFINED)});
   let (o,job)=(runtime,id);
   on_reject(&started,move|reason|{
    let Ok(pending)=pending(&o) else{return};
    let waiting=method(&pending,"get",&[&job]).unwrap_or(JsValue::UNDEFINED);
    if !t(&waiting){return;}
    let _=method(&pending,"delete",&[&job]);let _=method(&waiting,"reject",&[&reason]);
    // Only the existing native dispose cleans an interrupted upload. The other owned requests are rejected first.
    let _=native_ort_dispose(o);
   })
  }).into()).await?;
  call(&session,"session",&[&o,&value])
 })
}
/// One inference: the feeds go out as base64 tensors, the outputs come back decoded, by name.
#[wasm_bindgen]
pub fn native_ort_run(o:JsValue,record:JsValue,feeds:JsValue,codec:JsValue)->Promise{
 eager(async move{
  if t(&read(&record,"released")?){return Err(fail("Native session released")?);}
  let (env,encode)=(read(&o,"env")?,read(&codec,"encode")?);
  let tensors=Object::new();
  for entry in Object::entries(feeds.unchecked_ref()).iter(){
   let pair:Array=entry.unchecked_into();let tensor=pair.get(1);
   let out=Object::new();set(&out,"type",&read(&tensor,"type")?)?;set(&out,"dims",&read(&tensor,"dims")?)?;
   set(&out,"data",&call(&encode,"encode",&[&read(&tensor,"data")?,&env])?)?;
   set(&tensors,&String::from(pair.get(0).as_string().unwrap_or_default()),&out)?;
  }
  let json=js_sys::JSON::stringify(&tensors)?;
  let (bridge,token,key)=(bridge(&o)?,token(&o)?,read(&read(&record,"value")?,"session")?);
  let outputs=settled(request(&o,move|id|{method(&bridge,"run",&[&token,&id,&key,&json])?;Ok(())}).into()).await?;
  let decode=read(&codec,"decode")?;
  let decoded=Array::new();
  for entry in Object::entries(outputs.unchecked_ref()).iter(){
   let pair:Array=entry.unchecked_into();
   decoded.push(&Array::of2(&pair.get(0),&call(&decode,"decode",&[&pair.get(1),&env])?));
  }
  Ok(Object::from_entries(&decoded)?.into())
 })
}
/// Frees the executor's session once; later calls do nothing.
#[wasm_bindgen]
pub fn native_ort_release(o:JsValue,record:JsValue)->Promise{
 eager(async move{
  if t(&read(&record,"released")?){return Ok(JsValue::UNDEFINED);}
  set(&record,"released",&JsValue::TRUE)?;
  let (bridge,token,key)=(bridge(&o)?,token(&o)?,read(&read(&record,"value")?,"session")?);
  settled(request(&o,move|id|{method(&bridge,"release",&[&token,&id,&key])?;Ok(())}).into()).await?;
  Ok(JsValue::UNDEFINED)
 })
}
