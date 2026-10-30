//! Downloaded voices live in Cache Storage ('inhouse-neural-voices-v1'), keyed by the very URL they were fetched from: the
//! model (.onnx, ~63 MB) and its config (.onnx.json). The model is written LAST, so "model present" means "voice complete";
//! an interrupted download leaves nothing usable behind (Cache.put is atomic).
//!
//! The download is streamed with progress and is abortable. On flaky mobile data it survives dropped connections: the bytes
//! received so far are kept in memory and the transfer continues with a Range request (If-Range with the ETag, so a file
//! replaced upstream is never glued together); a server that ignores Range, or a Range request that fails before a single
//! byte arrives, makes it start again cleanly. Sizes are checked against Content-Length and, when it can be reached, against
//! the catalogue (voices.json) of the voice repository. A connection that goes silent without closing is given up on after
//! `stallMs` without a byte and takes the same resume path. The store object keeps the injected browser services; the
//! timers and listeners of one read live exactly as long as that read.
use std::{cell::RefCell,rc::Rc};
use wasm_bindgen::{prelude::*,JsCast};
use wasm_bindgen_futures::JsFuture;
use js_sys::{Array,Function,Object,Promise};
use crate::host::{get,read,set,num,absent,method,call};

type R<T=JsValue>=Result<T,JsValue>;
const CACHE_NAME:&str="inhouse-neural-voices-v1";
fn st(v:&str)->JsValue{JsValue::from_str(v)}
fn n(v:f64)->JsValue{JsValue::from_f64(v)}
fn t(v:&JsValue)->bool{v.is_truthy()}
fn arr(v:&JsValue)->Array{v.clone().unchecked_into()}
async fn aw(v:JsValue)->R{JsFuture::from(Promise::resolve(&v)).await}
#[wasm_bindgen]
extern "C"{
 #[wasm_bindgen(js_name=String)]fn string(v:&JsValue)->String;
 #[wasm_bindgen(js_name=Number)]fn number(v:&JsValue)->f64;
}
thread_local!{static NOOP:Closure<dyn FnMut(JsValue)>=Closure::new(|_|{});}
fn noop()->JsValue{NOOP.with(|function|function.as_ref().clone())}
/// `promise.catch(() => {})`: an observer that must never surface as an unhandled rejection.
fn forget(promise:&JsValue){if let Some(promise)=promise.dyn_ref::<Promise>(){NOOP.with(|function|{let _=promise.catch(function);});}}

/// Error with a `code` the UI maps to Spanish copy: 'offline' | 'http' | 'storage' | 'aborted'.
fn failure(code:&str,message:&str,cause:Option<&JsValue>)->JsValue{
 let error=js_sys::Error::new(if message.is_empty(){code}else{message});
 let _=set(&error,"code",&st(code));
 if let Some(cause)=cause{if t(cause){let _=set(&error,"cause",cause);}}
 error.into()
}
#[wasm_bindgen]
pub fn store_error(code:JsValue,message:JsValue,cause:JsValue)->JsValue{
 let error=js_sys::Error::new(&if t(&message){string(&message)}else{string(&code)});
 let _=set(&error,"code",&code);
 if t(&cause){let _=set(&error,"cause",&cause);}
 error.into()
}
fn aborted()->JsValue{failure("aborted","aborted",None)}
fn is_abort(error:&JsValue)->bool{get(error,"name")==st("AbortError")||get(error,"code")==st("aborted")}
fn is_aborted(signal:&JsValue)->bool{t(&get(signal,"aborted"))}
fn global(name:&str)->JsValue{get(&crate::host::global(),name)}
fn construct(name:&str,args:&[&JsValue])->R{
 let ctor:Function=global(name).dyn_into().map_err(|_|JsValue::from(js_sys::TypeError::new(&format!("{name} is not a constructor"))))?;
 let list=Array::new();for a in args{list.push(a);}
 js_sys::Reflect::construct(&ctor,&list)
}
async fn open_cache(s:&JsValue)->R{
 let opened=(||method(&read(s,"caches")?,"open",&[&st(CACHE_NAME)]))();
 let storage=|cause:JsValue|failure("storage","Cache Storage is not available",Some(&cause));
 match opened{Ok(promise)=>aw(promise).await.map_err(storage),Err(cause)=>Err(storage(cause))}
}
fn urls(s:&JsValue,piper:&JsValue)->R{method(s,"urls",&[piper])}

/// piperIds whose model AND config are both stored.
#[wasm_bindgen]
pub async fn store_list(s:JsValue,voices:JsValue)->R{
 let found=js_sys::Set::new(&JsValue::UNDEFINED);
 if !t(&read(&s,"supported")?){return Ok(found.into());}
 let cache=open_cache(&s).await?;
 let have=js_sys::Set::new(&JsValue::UNDEFINED);
 let keys=arr(&aw(method(&cache,"keys",&[])?).await?);
 for i in 0..keys.length(){have.add(&read(&keys.get(i),"url")?);}
 let base=string(&method(&s,"baseFn",&[])?);
 for url in js_sys::try_iter(&have)?.ok_or_else(||JsValue::from(js_sys::TypeError::new("not iterable")))?{
  let url=string(&url?);
  if !url.starts_with(&base)||!url.ends_with(".onnx"){continue;}
  let tail=&url[url.rfind('/').map_or(0,|at|at+1)..url.len()-".onnx".len()];
  let piper=js_sys::decode_uri_component(tail)?;
  if have.has(&st(&format!("{url}.json"))){found.add(&piper);}
 }
 // Author-hosted voices and auxiliary models have URLs outside the ordinary Piper base.
 let list=arr(&voices);
 for i in 0..list.length(){
  let piper=read(&list.get(i),"piperId")?;let known=urls(&s,&piper)?;
  let companion=read(&known,"phonemizerModel")?;
  if have.has(&read(&known,"model")?)&&have.has(&read(&known,"config")?)&&(!t(&companion)||have.has(&companion)){found.add(&piper);}
  else{found.delete(&piper);}
 }
 Ok(found.into())
}
#[wasm_bindgen]
pub async fn store_has(s:JsValue,piper:JsValue)->R<bool>{
 if !t(&read(&s,"supported")?){return Ok(false);}
 let cache=open_cache(&s).await?;let known=urls(&s,&piper)?;
 if !t(&aw(method(&cache,"match",&[&read(&known,"model")?])?).await?){return Ok(false);}
 if !t(&aw(method(&cache,"match",&[&read(&known,"config")?])?).await?){return Ok(false);}
 let companion=read(&known,"phonemizerModel")?;
 Ok(!t(&companion)||t(&aw(method(&cache,"match",&[&companion])?).await?))
}
/// One stored file of a voice as a Response, or the 'not downloaded' error.
async fn stored(s:&JsValue,piper:&JsValue,key:&str,suffix:&str)->R{
 let cache=open_cache(s).await?;let known=urls(s,piper)?;
 let response=aw(method(&cache,"match",&[&read(&known,key)?])?).await?;
 if !t(&response){return Err(failure("http",&format!("{}{suffix}",string(piper)),None));}
 Ok(response)
}
/// The voice's .onnx.json, parsed.
#[wasm_bindgen]
pub async fn store_read_config(s:JsValue,piper:JsValue)->R{aw(method(&stored(&s,&piper,"config"," is not downloaded").await?,"json",&[])?).await}
/// The model bytes (a fresh ArrayBuffer each time, so it can be transferred to the worker).
#[wasm_bindgen]
pub async fn store_read_model(s:JsValue,piper:JsValue)->R{aw(method(&stored(&s,&piper,"model"," is not downloaded").await?,"arrayBuffer",&[])?).await}
/// The Hebrew pointing model is installed with the voice and never fetched during playback.
#[wasm_bindgen]
pub async fn store_read_phonemizer(s:JsValue,piper:JsValue)->R{
 if !t(&read(&urls(&s,&piper)?,"phonemizerModel")?){return Ok(JsValue::NULL);}
 aw(method(&stored(&s,&piper,"phonemizerModel",": phonemizer is not downloaded").await?,"arrayBuffer",&[])?).await
}
#[wasm_bindgen]
pub async fn store_remove(s:JsValue,piper:JsValue)->R<()>{
 if !t(&read(&s,"supported")?){return Ok(());}
 let cache=open_cache(&s).await?;let known=urls(&s,&piper)?;
 for key in ["model","config"]{aw(method(&cache,"delete",&[&read(&known,key)?])?).await?;}
 let companion=read(&known,"phonemizerModel")?;
 if t(&companion){aw(method(&cache,"delete",&[&companion])?).await?;}
 Ok(())
}
/// Asks the browser not to evict the voices under storage pressure. Best effort, never throws.
#[wasm_bindgen]
pub async fn store_persist(s:JsValue)->bool{
 let asked=(||crate::host::method_opt(&read(&s,"storage")?,"persist",&[]))();
 match asked{Ok(Some(promise))=>aw(promise).await.map(|value|t(&value)).unwrap_or(false),_=>false}
}
/// Size the repository's catalogue promises for the model, or 0 when unknown (offline mirror, slow, or not listed).
#[wasm_bindgen]
pub async fn store_expected_size(s:JsValue,piper:JsValue,signal:JsValue)->R<f64>{
 let attempt=async{
  let known=urls(&s,&piper)?;
  let promised=read(&known,"modelBytes")?;if t(&promised){return Ok::<f64,JsValue>(num(&promised));}
  let init=Object::new();set(&init,"signal",&signal)?;
  let headers=Object::new();set(&headers,"accept",&st("application/json"))?;set(&init,"headers",&headers)?;
  let response=aw(call(&read(&s,"fetchFn")?,"fetch",&[&read(&known,"catalogue")?,&init])?).await?;
  if !t(&read(&response,"ok")?){return Ok(0.0);}
  let list=aw(method(&response,"json",&[])?).await?;
  let entry=get(&get(&get(&list,&string(&piper)),"files"),&string(&read(&known,"key")?));
  let bytes=number(&get(&entry,"size_bytes"));
  Ok(if bytes.is_nan(){0.0}else{bytes})
 }.await;
 match attempt{Ok(bytes)=>Ok(bytes),Err(error)=>if is_abort(&error){Err(aborted())}else{Ok(0.0)}}
}

async fn fetch_checked(s:&JsValue,url:&JsValue,signal:&JsValue,headers:Option<&JsValue>)->R{
 let options=Object::new();set(&options,"signal",signal)?;
 if let Some(headers)=headers{set(&options,"headers",headers)?;}
 let response=match (||call(&read(s,"fetchFn")?,"fetch",&[url,&options]))(){Ok(promise)=>aw(promise).await,Err(error)=>Err(error)};
 let response=match response{
  Ok(response)=>response,
  Err(error)=>return Err(if is_abort(&error)||is_aborted(signal){aborted()}else{failure("offline","No hay conexión",Some(&error))})
 };
 if !t(&read(&response,"ok")?){return Err(failure("http",&format!("HTTP {} for {}",string(&read(&response,"status")?),string(url)),None));}
 Ok(response)
}
/// reader.read(), but a connection that sends nothing for `stallMs` is cancelled and counts as dropped (retried by the caller);
/// an abort ends the wait at once.
async fn read_or_stall(reader:&JsValue,signal:&JsValue,stall:f64)->R{
 let reject_slot:Rc<RefCell<Option<Function>>>=Rc::new(RefCell::new(None));
 let slot=reject_slot.clone();
 let interrupted=Promise::new(&mut |_resolve,reject|{*slot.borrow_mut()=Some(reject);});
 forget(&interrupted);
 let cancel_reader={let reader=reader.clone();move||{if let Ok(promise)=method(&reader,"cancel",&[]){forget(&promise);}}};
 let mut timer=None;let mut _timer_closure=None;let mut _abort_listener=None;
 if stall>0.0{
  let reject=reject_slot.clone();let cancel=cancel_reader.clone();
  let closure=Closure::<dyn FnMut()>::new(move||{cancel();if let Some(reject)=reject.borrow().as_ref(){let _=reject.call1(&JsValue::UNDEFINED,&js_sys::TypeError::new("connection stalled"));}});
  timer=crate::host::set_timeout(closure.as_ref(),stall).ok();_timer_closure=Some(closure);
 }
 if !absent(signal){
  let reject=reject_slot.clone();let cancel=cancel_reader.clone();
  _abort_listener=crate::host::listen(signal,"abort",None,false,move|_|{cancel();if let Some(reject)=reject.borrow().as_ref(){let _=reject.call1(&JsValue::UNDEFINED,&aborted());}Ok(())}).ok();
 }
 let raced=method(reader,"read",&[]).map(|reading|Promise::race(&Array::of2(&reading,&interrupted)));
 let outcome=match raced{Ok(race)=>JsFuture::from(race).await,Err(error)=>Err(error)};
 if let Some(id)=timer{let _=crate::host::clear_timeout(&id);}
 outcome
}
fn contains_http_failure(message:&str)->bool{
 message.match_indices("HTTP ").any(|(at,_)|{let rest=&message[at+5..];rest.starts_with("416")||(rest.starts_with('5')&&rest[1..].chars().take(2).filter(|c|c.is_ascii_digit()).count()==2)})
}
/// Streams `url` into memory, riding out connection drops. Returns the received chunks.
async fn fetch_body(s:&JsValue,url:&JsValue,signal:&JsValue,expected:f64,progress:&mut dyn FnMut(f64,f64,f64)->R<()>)->R{
 let mut parts=Array::new();let mut received=0.0_f64;let mut total=if expected!=0.0&&!expected.is_nan(){expected}else{0.0};
 let mut etag=JsValue::from_str("");let mut ranged=true;let mut attempt=0u32;
 loop{
  let resume=received>0.0&&ranged;let mut got_bytes=false;
  let outcome:R=async{
   let headers=Object::new();
   if resume{set(&headers,"range",&st(&format!("bytes={received}-")))?;if t(&etag){set(&headers,"if-range",&etag)?;}}
   let response=fetch_checked(s,url,signal,Some(&headers)).await?;
   let response_headers=read(&response,"headers")?;
   if resume&&read(&response,"status")?==n(206.0){
    // The server must continue exactly where we stopped, otherwise we would corrupt the file.
    let range=method(&response_headers,"get",&[&st("content-range")])?;let range=if t(&range){string(&range)}else{String::new()};
    let start=range.find("bytes ").and_then(|at|{
     let rest=&range[at+6..];let digits:String=rest.chars().take_while(|c|c.is_ascii_digit()).collect();
     if digits.is_empty()||!rest[digits.len()..].starts_with('-'){None}else{digits.parse::<f64>().ok()}
    }).unwrap_or(f64::NAN);
    if start!=received{return Err(failure("http","unexpected Content-Range",None));}
   }else{parts=Array::new();received=0.0;} // a plain 200: the whole file again (server ignored Range, or this is the first try)
   let tag=method(&response_headers,"get",&[&st("etag")])?;if t(&tag){etag=tag;}
   let length=number(&method(&response_headers,"get",&[&st("content-length")])?);
   if length!=0.0&&!length.is_nan(){total=received+length;}
   let body=get(&response,"body");
   if absent(&body){ // no streaming (old WebView): take it in one piece
    let whole=construct("Uint8Array",&[&aw(method(&response,"arrayBuffer",&[])?).await?])?;
    parts.push(&whole);received+=num(&read(&whole,"length")?);got_bytes=true;
    progress(received,if total!=0.0{total}else{received},1.0)?;
   }else{
    let reader=method(&body,"getReader",&[])?;
    loop{
     if is_aborted(signal){forget(&method(&reader,"cancel",&[])?);return Err(aborted());}
     let step=read_or_stall(&reader,signal,num(&read(s,"stallMs")?)).await?;
     if t(&read(&step,"done")?){break;}
     let value=read(&step,"value")?;parts.push(&value);received+=num(&read(&value,"length")?);got_bytes=true;
     progress(received,total,if total!=0.0{(received/total).min(1.0)}else{0.0})?;
    }
   }
   if total!=0.0&&received<total{return Err(JsValue::from(js_sys::TypeError::new("connection closed early")));} // retried below
   Ok(parts.clone().into())
  }.await;
  match outcome{
   Ok(done)=>return Ok(done),
   Err(error)=>{
    if is_abort(&error)||is_aborted(signal){return Err(failure("aborted","aborted",Some(&error)));}
    // Server answers (4xx/5xx...) are final, except a refused range (416): that means "start over".
    let message=string(&get(&error,"message"));
    if get(&error,"code")==st("http")&&!contains_http_failure(&message){return Err(error);}
    if resume&&!got_bytes{ranged=false;} // the resume request itself did not work: next time the clean way
    if message.contains("HTTP 416"){parts=Array::new();received=0.0;ranged=false;}
    if f64::from(attempt)>=num(&read(s,"maxRetries")?){
     return Err(if t(&get(&error,"code")){error}else{failure(if t(&method(s,"online",&[])?){"http"}else{"offline"},"La descarga se interrumpió",Some(&error))});
    }
    aw(method(s,"sleep",&[&n((700.0*2f64.powi(attempt as i32)).min(8000.0),),signal])?).await?;
    attempt+=1;
   }
  }
 }
}
fn hex(bytes:&[u8])->String{bytes.iter().map(|b|format!("{b:02x}")).collect()}
fn report(on_progress:&JsValue,received:f64,total:f64,fraction:f64)->R<()>{
 let value=Object::new();set(&value,"received",&n(received))?;set(&value,"total",&n(total))?;set(&value,"fraction",&n(fraction))?;
 call(on_progress,"onProgress",&[&value])?;Ok(())
}
fn sum_lengths(parts:&JsValue)->R<f64>{let list=arr(parts);let mut sum=0.0;for i in 0..list.length(){sum+=num(&read(&list.get(i),"length")?);}Ok(sum)}
fn octet_stream(length:Option<f64>)->R{
 let headers=Object::new();set(&headers,"content-type",&st("application/octet-stream"))?;
 if let Some(length)=length{set(&headers,"content-length",&st(&format!("{length}")))?;}
 let init=Object::new();set(&init,"headers",&headers)?;Ok(init.into())
}
/// Downloads a voice into the cache. `onProgress({received,total,fraction})` is called as bytes arrive (total is 0 while
/// unknown). Resolves with {bytes}. Rejects with an Error whose `code` is 'offline' | 'http' | 'storage' | 'aborted'.
/// The espeak dictionary a voice needs is fetched through the phonemizer's own verified cache (voice_dictionary.rs, which
/// also runs inside the synthesis worker).
#[wasm_bindgen]
pub async fn store_download(s:JsValue,piper:JsValue,options:JsValue)->R{
 let signal=if absent(&options){JsValue::UNDEFINED}else{read(&options,"signal")?};
 let on_progress=if absent(&options){noop()}else{let given=read(&options,"onProgress")?;if given.is_undefined(){noop()}else{given}};
 let name=string(&piper);
 if !t(&read(&s,"supported")?){return Err(failure("storage","Cache Storage is not available",None));}
 if is_aborted(&signal){return Err(aborted());}
 if !t(&method(&s,"online",&[])?){return Err(failure("offline","No hay conexión",None));}
 let known=urls(&s,&piper)?;
 let (model,config,companion)=(read(&known,"model")?,read(&known,"config")?,read(&known,"phonemizerModel")?);
 let companion_size=match read(&known,"phonemizerSize")?{size if size.is_undefined()=>0.0,size=>num(&size)};
 let companion_hash=read(&known,"phonemizerSha256")?;
 let config_response=fetch_checked(&s,&config,&signal,None).await?;
 let config_text=aw(method(&config_response,"text",&[])?).await?;
 let parsed=js_sys::JSON::parse(&string(&config_text)).map_err(|cause|failure("http",&format!("{name}: invalid config"),Some(&cause)))?;
 let hebrew=get(&parsed,"phoneme_type")==st("hebrew");
 if t(&companion)&&!hebrew{return Err(failure("http",&format!("{name}: invalid Hebrew config"),None));}
 let dictionary=if hebrew{JsValue::NULL}else{crate::voice_dictionary::needed(&get(&get(&parsed,"espeak"),"voice"))?};
 let dictionary_size={let size=num(&get(&dictionary,"bytes"));if size.is_nan(){0.0}else{size}};
 let extra=companion_size+dictionary_size;
 let expected=aw(method(&s,"expectedSize",&[&piper,&signal])?).await?;
 let expected_size=num(&expected);
 let parts=fetch_body(&s,&model,&signal,expected_size,&mut |received,total,fraction|{
  if extra!=0.0{report(&on_progress,received,if total!=0.0{total+extra}else{0.0},if total!=0.0{received/(total+extra)}else{0.0})}
  else{report(&on_progress,received,total,fraction)}
 }).await?;
 let bytes=sum_lengths(&parts)?;
 if t(&expected)&&bytes!=expected_size{return Err(failure("http",&format!("{name}: size {bytes} instead of {expected_size}"),None));}
 let mut auxiliary=JsValue::NULL;
 if t(&companion){
  let chunks=fetch_body(&s,&companion,&signal,companion_size,&mut |received,_,_|report(&on_progress,bytes+received,bytes+companion_size,(bytes+received)/(bytes+companion_size))).await?;
  let kind=Object::new();set(&kind,"type",&st("application/octet-stream"))?;
  auxiliary=construct("Blob",&[&chunks,&kind])?;
  if num(&read(&auxiliary,"size")?)!=companion_size{return Err(failure("http",&format!("{name}: incomplete phonemizer"),None));}
  let digest=aw(method(&read(&global("crypto"),"subtle")?,"digest",&[&st("SHA-256"),&aw(method(&auxiliary,"arrayBuffer",&[])?).await?])?).await?;
  if st(&hex(&js_sys::Uint8Array::new(&digest).to_vec()))!=companion_hash{return Err(failure("http",&format!("{name}: invalid phonemizer checksum"),None));}
 }
 if is_aborted(&signal){return Err(aborted());}
 if t(&dictionary){
  let options=Object::new();
  set(&options,"caches",&read(&s,"caches")?)?;set(&options,"fetch",&read(&s,"fetchFn")?)?;set(&options,"signal",&signal)?;
  let sink=on_progress.clone();let before=bytes+companion_size;let whole=bytes+extra;
  let callback=Closure::<dyn FnMut(JsValue)>::new(move|progress:JsValue|{let received=num(&get(&progress,"received"));let _=report(&sink,before+received,whole,(before+received)/whole);});
  set(&options,"onProgress",callback.as_ref())?;
  let url=crate::voice_dictionary::url_of(&method(&s,"dictionaryBase",&[])?,&get(&dictionary,"name"))?;
  aw(crate::voice_dictionary::fetch(&url,&options).into()).await?;
  drop(callback);
 }
 aw(method(&s,"persist",&[])?).await?;
 let cache=open_cache(&s).await?;
 if is_aborted(&signal){return Err(aborted());}
 let written:R<()>=async{
  let json=Object::new();set(&json,"content-type",&st("application/json"))?;
  let head=Object::new();set(&head,"headers",&json)?;
  aw(method(&cache,"put",&[&config,&construct("Response",&[&config_text,&head])?])?).await?;
  if is_aborted(&signal){return Err(aborted());}
  if t(&auxiliary){
   aw(method(&cache,"put",&[&companion,&construct("Response",&[&auxiliary,&octet_stream(Some(num(&read(&auxiliary,"size")?)))?])?])?).await?;
   if is_aborted(&signal){return Err(aborted());}
  }
  let kind=Object::new();set(&kind,"type",&st("application/octet-stream"))?;
  aw(method(&cache,"put",&[&model,&construct("Response",&[&construct("Blob",&[&parts,&kind])?,&octet_stream(Some(bytes))?])?])?).await?;
  if is_aborted(&signal){return Err(aborted());}
  Ok(())
 }.await;
 if let Err(error)=written{
  let mut stale=vec![config.clone(),model.clone()];if t(&companion){stale.push(companion.clone());}
  for key in &stale{if let Ok(deleting)=method(&cache,"delete",&[key]){forget(&deleting);let _=aw(deleting).await;}}
  return Err(if is_abort(&error){failure("aborted","aborted",Some(&error))}else{failure("storage","No hay espacio para guardar la voz",Some(&error))});
 }
 let total=bytes+if t(&auxiliary){num(&read(&auxiliary,"size")?)}else{0.0}+dictionary_size;
 report(&on_progress,total,total,1.0)?;
 let result=Object::new();set(&result,"bytes",&n(total))?;Ok(result.into())
}
