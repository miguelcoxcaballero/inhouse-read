//! espeak-ng dictionaries from the same piper-tts-web 1.1.2/espeak-ng build as the shipped phonemizer, kept verified in
//! Cache Storage ('inhouse-neural-dictionaries-v1'). Unlike the phonemizer's in-memory filesystem, Cache Storage survives a
//! cold worker and offline reading: the voice download (the UI module) and the phonemizer (the voice module, inside the
//! synthesis worker) use this SAME URL and cache, so a downloaded voice's first sentence can be spoken offline even when its
//! language has never been loaded into an Emscripten filesystem.
//!
//! The exact lengths and checksums below are checked against public/neural-voice/phon/dict in unit tests. The frozen
//! JavaScript original is tests/unit/helpers/reference-dictionary-cache.js. Cache Storage, fetch, the stream reader,
//! Response and crypto.subtle stay the browser's: they are looked up at call time as the bare names were.
use std::{cell::RefCell,rc::Rc};
use wasm_bindgen::{prelude::*,JsCast};
use wasm_bindgen_futures::{JsFuture,future_to_promise};
use js_sys::{Array,JsString,Object,Promise,Uint8Array};
use crate::host::{absent,call,construct,get,global,method,method_opt,num,number_string,read,set};

type R<T=JsValue>=Result<T,JsValue>;
pub(crate) const CACHE_NAME:&str="inhouse-neural-dictionaries-v1";
/// (name, exact bytes, SHA-256) of every dictionary that is NOT inside piper_phonemize.data.
const DESCRIPTORS:&[(&str,u32,&str)]=&[
 ("ar",478165,"72316426e797777fe4df9420935a3b6a79b37d7e3f3948537ba71cd7b21b2541"),
 ("bg",87051,"8fa3adec8e18a3e695b2bbea1d4780182e17222d8b9f8da9908a237828f6b063"),
 ("cmn",1566335,"109aaa7708d3727382acb3ae41d8e2094a7e2bb9f651a81835be22a6f08071fe"),
 ("el",72841,"5d9f759750131da777d2fd4f06aa602ed746d38f27b84dd9a2d4a550f2cd452e"),
 ("hi",92143,"5a68c9532624e57ac845b26ce1e2e5034c4f6353bede46ecbe57e583ec8effd6"),
 ("no",4178,"43b828f8c1709e7abb23a0cc6416fb32e4814e3f1ff1db4baf2935bf7c77c9ff"),
 ("ru",8532392,"f0f6181bbbf9e53cd1e8f9d26bde8fc62119c4f78181948f961cb29866e5e585"),
 ("sr",46832,"770cae9c516e48af7896629faf4abefaf041e1fd4ae184011aad07b97196f613"),
 ("uk",3492,"a779bb0f51ce5cebb650a4e2282162fc8c44609210a2baa700f81f3e83e6e10c"),
 ("vi",52608,"64ff5187eb58f8033ebc326df0c2ebce5b65cc1db895656b5fc198762764dceb"),
];
/// Locale codes whose dictionary has another name.
const ALIASES:&[(&str,&str)]=&[("nb","no"),("nn","no"),("zh","cmn")];

#[wasm_bindgen]
extern "C"{
 #[wasm_bindgen(catch,js_name=String)]fn js_string(value:&JsValue)->Result<JsString,JsValue>;
}
thread_local!{
 /// One frozen descriptor object per dictionary, so every caller of this module gets the same object for a name.
 static FROZEN:RefCell<Vec<JsValue>>=const{RefCell::new(Vec::new())};
 static NOOP:Closure<dyn FnMut(JsValue)>=Closure::new(|_|{});
}
fn noop()->JsValue{NOOP.with(|function|function.as_ref().clone())}
fn descriptor(index:usize)->R{
 FROZEN.with(|cell|{
  let mut list=cell.borrow_mut();
  if list.is_empty(){
   for (name,bytes,sha256) in DESCRIPTORS{
    let object=Object::new();
    set(&object,"name",&JsValue::from_str(name))?;set(&object,"bytes",&JsValue::from_f64(f64::from(*bytes)))?;set(&object,"sha256",&JsValue::from_str(sha256))?;
    list.push(Object::freeze(&object).into());
   }
  }
  Ok(list[index].clone())
 })
}
fn index_of(name:&str)->Option<usize>{DESCRIPTORS.iter().position(|(known,_,_)|*known==name)}
fn name_of(index:usize)->&'static str{DESCRIPTORS[index].0}
fn size_of(index:usize)->f64{f64::from(DESCRIPTORS[index].1)}

/// `Object.assign(new Error(message), {code}, cause ? {cause} : {})`.
fn resource_error(code:&str,message:&str,cause:Option<&JsValue>)->JsValue{
 let error=js_sys::Error::new(message);
 let _=set(&error,"code",&JsValue::from_str(code));
 if let Some(cause)=cause{if cause.is_truthy(){let _=set(&error,"cause",cause);}}
 error.into()
}
fn aborted()->JsValue{resource_error("aborted","Dictionary download aborted",None)}
/// `signal?.aborted`, truthy.
fn is_aborted(signal:&JsValue)->R<bool>{Ok(!absent(signal)&&read(signal,"aborted")?.is_truthy())}
fn check_abort(signal:&JsValue)->R<()>{if is_aborted(signal)?{Err(aborted())}else{Ok(())}}
/// `error?.code === 'aborted'`.
fn aborted_code(error:&JsValue)->bool{get(error,"code").as_string().is_some_and(|code|code=="aborted")}
/// `error?.name === 'AbortError' || error?.code === 'aborted' || signal?.aborted`.
fn abort_like(error:&JsValue,signal:&JsValue)->R<bool>{
 Ok(get(error,"name").as_string().is_some_and(|name|name=="AbortError")||aborted_code(error)||is_aborted(signal)?)
}
/// `` `${value}` ``: a Symbol cannot be put in a template.
fn template(value:&JsValue)->R<JsString>{
 if value.is_symbol(){return Err(js_sys::TypeError::new("Cannot convert a Symbol value to a string").into())}
 js_string(value)
}
fn text(value:&JsValue)->R<String>{Ok(template(value)?.as_string().unwrap_or_default())}
async fn settled(value:JsValue)->R{JsFuture::from(Promise::resolve(&value)).await}
fn progress(on_progress:&JsValue,received:f64,total:f64,fraction:f64)->R<()>{
 let entry=Object::new();
 set(&entry,"received",&JsValue::from_f64(received))?;set(&entry,"total",&JsValue::from_f64(total))?;set(&entry,"fraction",&JsValue::from_f64(fraction))?;
 call(on_progress,"onProgress",&[&entry]).map(drop)
}

/// The dictionary the config's actual espeak voice needs, or null for an embedded/unknown language:
/// `String(espeakVoice || '').toLowerCase().split(/[-_]/)[0]`, then the aliases.
pub(crate) fn needed(espeak_voice:&JsValue)->R{
 let value=if espeak_voice.is_truthy(){js_string(espeak_voice)?}else{JsString::from("")};
 let lower=value.to_lower_case().as_string().unwrap_or_default();
 let base=lower.split(['-','_']).next().unwrap_or("");
 let name=ALIASES.iter().find(|(alias,_)|*alias==base).map_or(base,|(_,name)|name);
 match index_of(name){Some(index)=>descriptor(index),None=>Ok(JsValue::NULL)}
}
/// `` `${base}dict/${name}_dict` ``, keeping every UTF-16 unit of both parts.
pub(crate) fn url_of(base:&JsValue,name:&JsValue)->R{
 let base=template(base)?;let name=template(name)?;
 Ok(base.concat(&"dict/".into()).concat(&name).concat(&"_dict".into()).into())
}
/// The verified descriptor of a dictionary URL and the cache key (the absolute URL).
fn descriptor_of(url:&JsValue)->R<(usize,JsValue)>{
 let parsed=(||{
  let location=get(&global(),"location");
  let base=if absent(&location){JsValue::UNDEFINED}else{read(&location,"href")?};
  construct("URL",&[url,&base])
 })().map_err(|error|resource_error("http","Invalid dictionary URL",Some(&error)))?;
 let pathname=text(&read(&parsed,"pathname")?)?;
 let tail=&pathname[pathname.rfind('/').map_or(0,|at|at+1)..];
 let name=tail.strip_suffix("_dict").filter(|name|!name.is_empty()&&name.bytes().all(|byte|byte.is_ascii_lowercase()));
 let Some(index)=name.and_then(index_of)else{
  return Err(resource_error("http",&format!("No verified dictionary descriptor for {pathname}"),None));
 };
 Ok((index,read(&parsed,"href")?))
}

/// Settles with `promise`, or rejects promptly with 'aborted' when the signal fires, even when a cache or fetch double
/// ignores its AbortSignal. `cancel` is best effort. Without a signal the value is handed back as it is.
fn abortable(promise:JsValue,signal:&JsValue,cancel:Option<Rc<dyn Fn()>>)->R{
 if !signal.is_truthy(){return Ok(promise)}
 let best_effort=|cancel:&Option<Rc<dyn Fn()>>|if let Some(cancel)=cancel{cancel()};
 if read(signal,"aborted")?.is_truthy(){
  NOOP.with(|function|{let _=Promise::resolve(&promise).catch(function);});
  best_effort(&cancel);
  return Ok(Promise::reject(&aborted()).into());
 }
 let listener:Rc<RefCell<Option<Closure<dyn FnMut()>>>>=Rc::new(RefCell::new(None));
 let mut function=JsValue::UNDEFINED;
 let interruption=Promise::new(&mut |_resolve,reject|{
  let (cancel,refuse)=(cancel.clone(),reject.clone());
  let closure=Closure::<dyn FnMut()>::new(move||{best_effort(&cancel);let _=refuse.call1(&JsValue::UNDEFINED,&aborted());});
  function=closure.as_ref().clone();
  *listener.borrow_mut()=Some(closure);
  let once=Object::new();
  let added=set(&once,"once",&JsValue::TRUE).and_then(|()|method(signal,"addEventListener",&[&"abort".into(),&function,&once]));
  // What the Promise executor throws becomes its rejection.
  if let Err(error)=added{let _=reject.call1(&JsValue::UNDEFINED,&error);}
 });
 let race=Promise::race(&Array::of2(&promise,&interruption));
 let (signal,owned)=(signal.clone(),listener);
 let finish=Closure::once_into_js(move||->R<()>{
  let removed=method(&signal,"removeEventListener",&[&"abort".into(),&function]);
  drop(owned.borrow_mut().take());
  removed.map(drop)
 });
 method(&race,"finally",&[&finish])
}

/// Exact size and SHA-256 of the bytes, or an 'http' error.
async fn validate(bytes:&JsValue,index:usize,signal:&JsValue)->R<()>{
 check_abort(signal)?;
 let name=name_of(index);
 let length=read(bytes,"byteLength")?;
 if length.as_f64()!=Some(size_of(index)){
  return Err(resource_error("http",&format!("Dictionary {name}: {} bytes instead of {}",text(&length)?,DESCRIPTORS[index].1),None));
 }
 let crypto=get(&global(),"crypto");
 if absent(&crypto)||!read(&crypto,"subtle")?.is_truthy(){return Err(resource_error("http","Dictionary checksum verification is unavailable",None))}
 let digest=method(&read(&read(&global(),"crypto")?,"subtle")?,"digest",&[&"SHA-256".into(),bytes])?;
 let digest=settled(abortable(digest,signal,None)?).await?;
 check_abort(signal)?;
 let hash:String=Uint8Array::new(&digest).to_vec().iter().map(|byte|format!("{byte:02x}")).collect();
 if hash!=DESCRIPTORS[index].2{return Err(resource_error("http",&format!("Dictionary {name}: SHA-256 mismatch"),None))}
 Ok(())
}
fn response_of(bytes:&JsValue)->R{
 let headers=Object::new();
 set(&headers,"content-type",&"application/octet-stream".into())?;
 set(&headers,"content-length",&js_string(&read(bytes,"byteLength")?)?.into())?;
 let init=Object::new();set(&init,"headers",&headers)?;
 construct("Response",&[bytes,&init.into()])
}
/// `reader.cancel().catch(() => {})`, never throwing.
fn cancel_reader(reader:&JsValue){let _=method(reader,"cancel",&[]).and_then(|cancelling|method(&cancelling,"catch",&[&noop()]));}

/// The body of a network response, verified. Descriptors pin the exact verified size: streamed chunks are written
/// directly into their final buffer instead of retaining every chunk and duplicating the whole dictionary at the end.
async fn read_network(response:&JsValue,index:usize,signal:&JsValue,on_progress:&JsValue)->R{
 let total=size_of(index);
 let body=read(response,"body")?;
 // `response.body?.getReader?.()`, failing with the engine's own message for a getReader that is not a function.
 let get_reader=if absent(&body){JsValue::UNDEFINED}else{read(&body,"getReader")?};
 let reader=if absent(&get_reader){JsValue::UNDEFINED}else{
  get_reader.dyn_ref::<js_sys::Function>().ok_or_else(||JsValue::from(js_sys::TypeError::new("response.body?.getReader is not a function")))?.call0(&body)?
 };
 if !reader.is_truthy(){
  let bytes=settled(abortable(method(response,"arrayBuffer",&[])?,signal,None)?).await?;
  validate(&bytes,index,signal).await?;
  progress(on_progress,num(&read(&bytes,"byteLength")?),total,1.0)?;
  return Ok(bytes)
 }
 let mut received=0.0;
 let result:R=async{
  let name=name_of(index);
  let bytes=Uint8Array::new_with_length(DESCRIPTORS[index].1);
  loop{
   check_abort(signal)?;
   let source=reader.clone();
   let cancel:Rc<dyn Fn()>=Rc::new(move||cancel_reader(&source));
   let step=settled(abortable(method(&reader,"read",&[])?,signal,Some(cancel))?).await?;
   if absent(&step){
    let what=if step.is_null(){"null"}else{"undefined"};
    return Err(js_sys::TypeError::new(&format!("Cannot destructure property 'done' of '(intermediate value)' as it is {what}.")).into())
   }
   let (done,value)=(read(&step,"done")?,read(&step,"value")?);
   if done.is_truthy(){break}
   let offset=received;
   received+=num(&read(&value,"byteLength")?);
   if received>total{return Err(resource_error("http",&format!("Dictionary {name}: response exceeds expected size"),None))}
   method(&bytes,"set",&[&value,&JsValue::from_f64(offset)])?;
   progress(on_progress,received,total,received/total)?;
  }
  if received!=total{return Err(resource_error("http",&format!("Dictionary {name}: {} bytes instead of {}",number_string(received),DESCRIPTORS[index].1),None))}
  let buffer:JsValue=bytes.buffer().into();
  validate(&buffer,index,signal).await?;
  Ok(buffer)
 }.await;
 if result.is_err(){cancel_reader(&reader)}
 let _=method_opt(&reader,"releaseLock",&[]);
 result
}

/// What fetchDictionary does before its first await: the options, the descriptor and the opening of the cache.
struct Start{caches_opened:R,signal:JsValue,fetch:JsValue,on_progress:JsValue,index:usize,key:JsValue}
fn begin(url:&JsValue,options:&JsValue)->R<Start>{
 let options=if options.is_undefined(){Object::new().into()}else{options.clone()};
 if options.is_null(){return Err(js_sys::TypeError::new("Cannot destructure 'options' as it is null.").into())}
 let or_global=|value:JsValue,name:&str|if value.is_undefined(){get(&global(),name)}else{value};
 let caches=or_global(read(&options,"caches")?,"caches");
 let fetch=or_global(read(&options,"fetch")?,"fetch");
 let signal=read(&options,"signal")?;
 let on_progress=match read(&options,"onProgress")?{given if given.is_undefined()=>noop(),given=>given};
 check_abort(&signal)?;
 let (index,key)=descriptor_of(url)?;
 if absent(&caches)||!read(&caches,"open")?.is_truthy(){return Err(resource_error("storage","Dictionary Cache Storage is unavailable",None))}
 let caches_opened=method(&caches,"open",&[&CACHE_NAME.into()]).and_then(|opening|abortable(opening,&signal,None));
 Ok(Start{caches_opened,signal,fetch,on_progress,index,key})
}
async fn finish(start:Start)->R{
 let Start{caches_opened,signal,fetch,on_progress,index,key}=start;
 let (name,total)=(name_of(index),size_of(index));
 let opened=match caches_opened{Ok(opening)=>settled(opening).await,Err(error)=>Err(error)};
 let cache=opened.map_err(|error|if aborted_code(&error){error}else{resource_error("storage","Cannot open dictionary cache",Some(&error))})?;
 progress(&on_progress,0.0,total,0.0)?;
 let matched=match method(&cache,"match",&[&key]).and_then(|matching|abortable(matching,&signal,None)){Ok(matching)=>settled(matching).await,Err(error)=>Err(error)};
 let stored=matched.map_err(|error|if aborted_code(&error){error}else{resource_error("storage","Cannot read dictionary cache",Some(&error))})?;
 if stored.is_truthy(){
  let read_back:R=async{
   if !read(&stored,"ok")?.is_truthy(){return Err(resource_error("http",&format!("Dictionary {name}: cached HTTP {}",text(&read(&stored,"status")?)?),None))}
   let bytes=settled(abortable(method(&stored,"arrayBuffer",&[])?,&signal,None)?).await?;
   validate(&bytes,index,&signal).await?;
   Ok(bytes)
  }.await;
  let bytes=match read_back{
   Ok(bytes)=>bytes,
   Err(error)=>{
    if aborted_code(&error){return Err(error)}
    let evicting=method(&method(&cache,"delete",&[&key])?,"catch",&[&noop()])?;
    settled(abortable(evicting,&signal,None)?).await?;
    return Err(if get(&error,"code").is_truthy(){error}else{resource_error("http",&format!("Dictionary {name}: corrupt cached response"),Some(&error))})
   }
  };
  progress(&on_progress,num(&read(&bytes,"byteLength")?),total,1.0)?;
  return response_of(&bytes)
 }
 check_abort(&signal)?;
 let fetched:R=async{
  if !fetch.is_function(){return Err(js_sys::Error::new("Fetch is unavailable").into())}
  let init=Object::new();set(&init,"signal",&signal)?;
  settled(abortable(call(&fetch,"fetch",&[&key,&init.into()])?,&signal,None)?).await
 }.await;
 let response=match fetched{
  Ok(response)=>response,
  Err(error)=>return Err(if abort_like(&error,&signal)?{aborted()}else{resource_error("offline",&format!("Dictionary {name}: network unavailable"),Some(&error))}),
 };
 if absent(&response)||!read(&response,"ok")?.is_truthy(){
  let status=if absent(&response){JsValue::UNDEFINED}else{read(&response,"status")?};
  let status=if absent(&status){"no response".to_owned()}else{text(&status)?};
  return Err(resource_error("http",&format!("Dictionary {name}: HTTP {status}"),None))
 }
 let bytes=match read_network(&response,index,&signal,&on_progress).await{
  Ok(bytes)=>bytes,
  Err(error)=>return Err(if abort_like(&error,&signal)?{aborted()}
   else if get(&error,"code").is_truthy(){error}else{resource_error("http",&format!("Dictionary {name}: interrupted response"),Some(&error))}),
 };
 check_abort(&signal)?;
 let stored:R=async{
  let response=response_of(&bytes)?;
  settled(abortable(method(&cache,"put",&[&key,&response])?,&signal,None)?).await
 }.await;
 stored.map_err(|error|if aborted_code(&error){error}else{resource_error("storage","Cannot save dictionary for offline reading",Some(&error))})?;
 check_abort(&signal)?;
 progress(&on_progress,num(&read(&bytes,"byteLength")?),total,1.0)?;
 response_of(&bytes)
}
/// A fresh verified Response for a dictionary URL: from the cache, or downloaded (with progress), verified and stored.
/// Rejects with an Error whose `code` is 'http' | 'offline' | 'storage' | 'aborted'. Everything up to the opening of the
/// cache happens before this returns, as in an async function.
pub(crate) fn fetch(url:&JsValue,options:&JsValue)->Promise{
 match begin(url,options){Ok(start)=>future_to_promise(finish(start)),Err(error)=>Promise::reject(&error)}
}

#[wasm_bindgen]
pub fn voice_dictionary_needed(espeak_voice:JsValue)->R{needed(&espeak_voice)}
#[wasm_bindgen]
pub fn voice_dictionary_url(base:JsValue,name:JsValue)->R{url_of(&base,&name)}
#[wasm_bindgen]
pub fn voice_dictionary_fetch(url:JsValue,options:JsValue)->Promise{fetch(&url,&options)}
