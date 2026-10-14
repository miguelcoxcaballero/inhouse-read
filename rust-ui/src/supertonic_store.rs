//! One immutable Supertonic pack for all languages and styles. Each file streams into Cache Storage, is verified, and the
//! completion marker is written last. Interrupted downloads can reuse complete verified files, but never appear installed.
//! The store object keeps the injected browser services, the running job and its controller; the stall timer and the stream
//! transform of one file live exactly as long as that file's download.
use std::{cell::{Cell,RefCell},rc::Rc};
use wasm_bindgen::{prelude::*,JsCast};
use wasm_bindgen_futures::JsFuture;
use js_sys::{Array,Object,Promise};
use crate::host::{get,read,set,num,absent,method,call};

type R<T=JsValue>=Result<T,JsValue>;
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
fn forget(promise:&JsValue){if let Some(promise)=promise.dyn_ref::<Promise>(){NOOP.with(|function|{let _=promise.catch(function);});}}
fn failure(code:&str,message:&str,cause:&JsValue)->JsValue{
 let error=js_sys::Error::new(message);let _=set(&error,"cause",cause);let _=set(&error,"code",&st(code));error.into()
}
fn aborted()->JsValue{failure("aborted","Descarga cancelada",&JsValue::UNDEFINED)}
fn construct(name:&str,args:&[&JsValue])->R{
 let ctor:js_sys::Function=get(&crate::host::global(),name).dyn_into().map_err(|_|JsValue::from(js_sys::TypeError::new(&format!("{name} is not a constructor"))))?;
 let list=Array::new();for a in args{list.push(a);}
 js_sys::Reflect::construct(&ctor,&list)
}
fn hash_hex(bytes:&[u8])->String{bytes.iter().map(|b|format!("{b:02x}")).collect()}
fn file_stem(path:&str,extension:&str)->String{path.rsplit('/').next().unwrap_or("").replacen(extension,"",1)}
fn manifest_of(assets:&JsValue,base:&JsValue)->R<String>{
 let list=arr(assets);let out=Array::new();
 for i in 0..list.length(){
  let asset=list.get(i);let item=Object::new();
  set(&item,"path",&read(&asset,"path")?)?;
  let url=read(&asset,"url")?;set(&item,"url",&if t(&url){url}else{st(&format!("{}{}",string(base),string(&read(&asset,"path")?)))})?;
  set(&item,"bytes",&read(&asset,"bytes")?)?;set(&item,"sha256",&read(&asset,"sha256")?)?;
  out.push(&item);
 }
 Ok(js_sys::JSON::stringify(&out)?.as_string().unwrap_or_default())
}
async fn open(s:&JsValue)->R{
 let caches=read(s,"caches")?;
 if !t(&caches){return Err(failure("storage","El dispositivo no permite guardar voces",&JsValue::UNDEFINED));}
 aw(method(&caches,"open",&[&st("inhouse-supertonic3-v1")])?).await
}
#[wasm_bindgen]
pub async fn supertonic_cache(s:JsValue)->R{open(&s).await}
/// The marker and every file it lists, still verified byte for byte: the assets of the installed pack, or null.
async fn committed(s:&JsValue,revision:&JsValue)->R{
 let cache=open(s).await?;
 let base=read(s,"base")?;
 let marker=aw(method(&cache,"match",&[&read(s,"marker")?])?).await?;
 if !t(&marker){return Ok(JsValue::NULL);}
 let assets=(async{
  let record=aw(method(&marker,"json",&[])?).await?;
  if read(&record,"revision")?!=*revision{return Ok::<JsValue,JsValue>(JsValue::NULL);}
  let manifest=read(&record,"manifest")?;
  if manifest==read(s,"manifest")?{return read(s,"assets");}
  let legacy=read(s,"legacyAssets")?;
  if num(&read(&legacy,"length")?)!=0.0&&manifest==st(&manifest_of(&legacy,&base)?){return Ok(legacy);}
  Ok(JsValue::NULL)
 }).await.unwrap_or(JsValue::NULL);
 if !t(&assets){return Ok(JsValue::NULL);}
 let list=arr(&assets);
 for i in 0..list.length(){
  let asset=list.get(i);
  let found=aw(method(&cache,"match",&[&st(&format!("{}{}",string(&base),string(&read(&asset,"path")?)))])?).await?;
  if !t(&found){return Ok(JsValue::NULL);}
  let headers=read(&found,"headers")?;
  if method(&headers,"get",&[&st("x-inhouse-sha256")])?!=read(&asset,"sha256")?||number(&method(&headers,"get",&[&st("content-length")])?)!=num(&read(&asset,"bytes")?){return Ok(JsValue::NULL);}
 }
 Ok(assets)
}
#[wasm_bindgen]
pub async fn supertonic_committed(s:JsValue,revision:JsValue)->R{committed(&s,&revision).await}
#[wasm_bindgen]
pub async fn supertonic_installed(s:JsValue,revision:JsValue)->R<bool>{Ok(committed(&s,&revision).await?==read(&s,"assets")?)}
#[wasm_bindgen]
pub async fn supertonic_styles(s:JsValue,revision:JsValue)->R{
 let assets=committed(&s,&revision).await?;let styles=js_sys::Set::new(&JsValue::UNDEFINED);
 if t(&assets){let list=arr(&assets);for i in 0..list.length(){let path=string(&read(&list.get(i),"path")?);if path.starts_with("voice_styles/"){styles.add(&st(&file_stem(&path,".json")));}}}
 Ok(styles.into())
}
/// Reads the four ONNX graphs of the pack, verified by size, keyed by their file stem.
#[wasm_bindgen]
pub async fn supertonic_read_assets(s:JsValue,revision:JsValue)->R{
 let assets=committed(&s,&revision).await?;
 if !t(&assets){return Err(failure("missing","Descarga primero el paquete de voces",&JsValue::UNDEFINED));}
 let cache=open(&s).await?;let base=string(&read(&s,"base")?);let buffers=Object::new();
 let list=arr(&assets);
 for i in 0..list.length(){
  let asset=list.get(i);let path=string(&read(&asset,"path")?);
  if !path.ends_with(".onnx"){continue;}
  let response=aw(method(&cache,"match",&[&st(&format!("{base}{path}"))])?).await?;
  if !t(&response){return Err(failure("missing","Falta un archivo de la voz",&JsValue::UNDEFINED));}
  let bytes=aw(method(&response,"arrayBuffer",&[])?).await?;
  if num(&read(&bytes,"byteLength")?)!=num(&read(&asset,"bytes")?){return Err(failure("storage","El modelo guardado está incompleto",&JsValue::UNDEFINED));}
  set(&buffers,&file_stem(&path,".onnx"),&bytes)?;
 }
 Ok(buffers.into())
}
#[wasm_bindgen]
pub async fn supertonic_read_config(s:JsValue,revision:JsValue)->R{
 let assets=committed(&s,&revision).await?;
 if !t(&assets){return Err(failure("missing","Descarga primero el paquete de voces",&JsValue::UNDEFINED));}
 let cache=open(&s).await?;let base=string(&read(&s,"base")?);
 let json=|path:String|{let cache=cache.clone();let base=base.clone();async move{
  let response=aw(method(&cache,"match",&[&st(&format!("{base}{path}"))])?).await?;
  if !t(&response){return Err(failure("missing","Falta la configuración de la voz",&JsValue::UNDEFINED));}
  aw(method(&response,"json",&[])?).await
 }};
 let config=json("onnx/tts.json".into()).await?;let indexer=json("onnx/unicode_indexer.json".into()).await?;let styles=Object::new();
 let list=arr(&assets);
 for i in 0..list.length(){let path=string(&read(&list.get(i),"path")?);if path.starts_with("voice_styles/"){set(&styles,&file_stem(&path,".json"),&json(path.clone()).await?)?;}}
 let out=Object::new();set(&out,"config",&config)?;set(&out,"indexer",&indexer)?;set(&out,"styles",&styles)?;Ok(out.into())
}
#[wasm_bindgen]
pub async fn supertonic_remove(s:JsValue)->R<()>{
 set(&s,"generation",&n(num(&read(&s,"generation")?)+1.0))?;
 let controller=read(&s,"controller")?;if !absent(&controller){method(&controller,"abort",&[])?;}
 let job=read(&s,"job")?;if !absent(&job){if let Ok(p)=method(&job,"catch",&[&NOOP.with(|f|f.as_ref().clone())]){let _=aw(p).await;}}
 let cache=open(&s).await?;
 aw(method(&cache,"delete",&[&read(&s,"marker")?])?).await?;
 let assets=arr(&read(&s,"assets")?);let base=string(&read(&s,"base")?);
 for i in 0..assets.length(){aw(method(&cache,"delete",&[&st(&format!("{base}{}",string(&read(&assets.get(i),"path")?)))])?).await?;}
 Ok(())
}
/// The install job: every file in order, each reused when it already verifies. `url_of` names where an asset comes from.
#[wasm_bindgen]
pub async fn supertonic_install(s:JsValue,controller:JsValue,generation:f64,signal:JsValue,on_progress:JsValue,revision:JsValue,url_of:JsValue)->R{
 let check={let s=s.clone();let controller=controller.clone();move||->R<()>{
  if t(&get(&get(&controller,"signal"),"aborted"))||num(&read(&s,"generation")?)!=generation{return Err(aborted());}
  Ok(())
 }};
 check()?;
 let cache=open(&s).await?;
 // A failed optional expansion must leave the previous offline pack usable. New/invalid installs still have no completion marker until all hashes pass.
 if !t(&committed(&s,&revision).await?){aw(method(&cache,"delete",&[&read(&s,"marker")?])?).await?;}
 let assets=arr(&read(&s,"assets")?);let base=string(&read(&s,"base")?);
 let mut total=0.0;for i in 0..assets.length(){total+=num(&read(&assets.get(i),"bytes")?);}
 let mut received=0.0_f64;
 let progress=|received:f64,path:&JsValue|->R<()>{let value=Object::new();set(&value,"received",&n(received))?;set(&value,"total",&n(total))?;set(&value,"fraction",&n(received/total))?;if !path.is_undefined(){set(&value,"path",path)?;}call(&on_progress,"onProgress",&[&value])?;Ok(())};
 for i in 0..assets.length(){
  let asset=assets.get(i);let path=read(&asset,"path")?;let bytes=num(&read(&asset,"bytes")?);let sha=read(&asset,"sha256")?;
  check()?;
  let url=st(&format!("{base}{}",string(&path)));
  let old=aw(method(&cache,"match",&[&url])?).await?;
  if t(&old)&&method(&read(&old,"headers")?,"get",&[&st("x-inhouse-sha256")])?==sha&&number(&method(&read(&old,"headers")?,"get",&[&st("content-length")])?)==bytes{received+=bytes;progress(received,&path)?;continue;}
  let loaded=Rc::new(Cell::new(0.0_f64));
  let timer:Rc<RefCell<Option<JsValue>>>=Rc::new(RefCell::new(None));
  let stall=num(&read(&s,"stallMs")?);
  let stop=Closure::<dyn FnMut()>::new({let controller=controller.clone();move||{let _=method(&controller,"abort",&[&st("stall")]);}});
  let touch={let timer=timer.clone();let stop=stop.as_ref().clone();move||{
   if let Some(id)=timer.borrow_mut().take(){let _=crate::host::clear_timeout(&id);}
   *timer.borrow_mut()=crate::host::set_timeout(&stop,stall).ok();
  }};
  let outcome:R<()>=async{
   touch();
   let init=Object::new();set(&init,"signal",&read(&controller,"signal")?)?;
   let response=aw(call(&read(&s,"fetchFn")?,"fetch",&[&call(&url_of,"supertonicAssetUrl",&[&asset,&read(&s,"base")?])?,&init])?).await?;check()?;
   if !t(&read(&response,"ok")?){return Err(failure("http",&format!("HTTP {}: {}",string(&read(&response,"status")?),string(&path)),&JsValue::UNDEFINED));}
   let kind=if string(&path).ends_with(".json"){"application/json"}else{"application/octet-stream"};
   let head=Object::new();set(&head,"content-type",&st(kind))?;set(&head,"content-length",&st(&format!("{bytes}")))?;
   let headers=construct("Headers",&[&head])?;
   let body=get(&response,"body");
   let transform={
    let (check,touch,loaded,path,sink,on_progress)=(check.clone(),touch.clone(),loaded.clone(),path.clone(),received,on_progress.clone());
    Closure::<dyn FnMut(JsValue,JsValue)>::new(move|chunk:JsValue,out:JsValue|{
     let step=||->R<()>{
      check()?;touch();
      loaded.set(loaded.get()+num(&read(&chunk,"byteLength")?));
      if loaded.get()>bytes{return Err(failure("http","Tamaño de voz incorrecto",&JsValue::UNDEFINED));}
      let value=Object::new();set(&value,"received",&n(sink+loaded.get()))?;set(&value,"total",&n(total))?;set(&value,"fraction",&n((sink+loaded.get())/total))?;set(&value,"path",&path)?;
      call(&on_progress,"onProgress",&[&value])?;
      method(&out,"enqueue",&[&chunk])?;Ok(())
     };
     if let Err(error)=step(){wasm_bindgen::throw_val(error);}
    })
   };
   let stream=if absent(&body){JsValue::UNDEFINED}else{
    let spec=Object::new();set(&spec,"transform",transform.as_ref())?;
    method(&body,"pipeThrough",&[&construct("TransformStream",&[&spec])?])?
   };
   if absent(&stream){return Err(failure("http","Respuesta de voz vacía",&JsValue::UNDEFINED));}
   let put=Object::new();set(&put,"headers",&headers)?;
   aw(method(&cache,"put",&[&url,&construct("Response",&[&stream,&put])?])?).await?;
   if let Some(id)=timer.borrow_mut().take(){let _=crate::host::clear_timeout(&id);}
   drop(transform);
   check()?;
   let stored=aw(method(&aw(method(&cache,"match",&[&url])?).await?,"arrayBuffer",&[])?).await?;
   let digest=aw(method(&read(&read(&s,"crypto")?,"subtle")?,"digest",&[&st("SHA-256"),&stored])?).await?;
   if num(&read(&stored,"byteLength")?)!=bytes||st(&hash_hex(&js_sys::Uint8Array::new(&digest).to_vec()))!=sha{
    return Err(failure("http","La descarga no coincide con el modelo publicado",&JsValue::UNDEFINED));
   }
   // Mark reusable only AFTER checksum validation. A tab closing during hashing must not turn an unverified partial install into a valid file.
   check()?;
   let verified=aw(method(&cache,"match",&[&url])?).await?;method(&headers,"set",&[&st("x-inhouse-sha256"),&sha])?;
   let again=Object::new();set(&again,"headers",&headers)?;
   aw(method(&cache,"put",&[&url,&construct("Response",&[&read(&verified,"body")?,&again])?])?).await?;check()?;
   Ok(())
  }.await;
  if let Some(id)=timer.borrow_mut().take(){let _=crate::host::clear_timeout(&id);}
  if let Err(error)=outcome{
   if let Ok(deleting)=method(&cache,"delete",&[&url]){forget(&deleting);let _=aw(deleting).await;}
   if t(&get(&signal,"aborted"))||num(&read(&s,"generation")?)!=generation{return Err(aborted());}
   if get(&get(&controller,"signal"),"reason")==st("stall"){return Err(failure("offline","La descarga se interrumpió. Puedes reanudarla.",&error));}
   if t(&get(&error,"code")){return Err(error);}
   let quota=get(&error,"name")==st("QuotaExceededError");
   return Err(failure(if quota{"storage"}else{"offline"},if quota{"No hay espacio para guardar las voces"}else{"No se pudo descargar la voz"},&error));
  }
  received+=bytes;
 }
 check()?;
 if let Ok(Some(asked))=crate::host::method_opt(&read(&s,"storage")?,"persist",&[]){forget(&asked);let _=aw(asked).await;}
 check()?;
 let record=Object::new();set(&record,"revision",&revision)?;set(&record,"manifest",&read(&s,"manifest")?)?;set(&record,"bytes",&n(total))?;
 let head=Object::new();set(&head,"content-type",&st("application/json"))?;let put=Object::new();set(&put,"headers",&head)?;
 aw(method(&cache,"put",&[&read(&s,"marker")?,&construct("Response",&[&st(&js_sys::JSON::stringify(&record)?.as_string().unwrap_or_default()),&put])?])?).await?;
 check()?;
 progress(total,&JsValue::UNDEFINED)?;
 let result=Object::new();set(&result,"bytes",&n(total))?;Ok(result.into())
}
/// The manifest the marker must carry for these assets.
#[wasm_bindgen]
pub fn supertonic_manifest(assets:JsValue,base:JsValue)->R<String>{manifest_of(&assets,&base)}
