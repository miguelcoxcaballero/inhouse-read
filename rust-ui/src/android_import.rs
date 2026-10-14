//! Consume the Android intent inbox without passing entire books as base64 strings: the pending
//! entries are read chunk by chunk, handed over as one File and acknowledged only after the app
//! has stored it. The native bridge, the timers and the page visibility stay behind host callbacks.
//! `host`: `{bridge, onFile, onError, onActivity, canImport, pollMs, hidden, yieldTask, interval, clearInterval, listen}`.
use std::{cell::{Cell,RefCell},rc::Rc};
use wasm_bindgen::{prelude::*,JsCast};
use js_sys::{Array,Function,Set,Uint8Array};
use crate::cloud_host::*;

#[wasm_bindgen]
extern "C"{
 /// The platform's own base64 decoder, with its own errors.
 #[wasm_bindgen(js_name=atob,catch)]fn atob(value:&str)->Result<String,JsValue>;
}
/// `Uint8Array.from(atob(encoded), char => char.charCodeAt(0))`: the binary string as bytes.
fn decode(encoded:&str)->Result<Vec<u8>,JsValue>{Ok(atob(encoded)?.chars().map(|symbol|symbol as u32 as u8).collect())}

struct Core{host:JsValue,bridge:JsValue,busy:Cell<bool>,stopped:Cell<bool>,failures:Set,
 interval:RefCell<JsValue>,listener:RefCell<JsValue>,callbacks:RefCell<Vec<Closure<dyn FnMut()>>>}

impl Core{
 async fn report(&self,error:&JsValue)->Result<(),JsValue>{
  // `await onError?.(error)`: even a missing handler takes one turn of the microtask queue.
  let handler=get(&self.host,"onError");
  let outcome=if handler.is_function(){call(&self.host,"onError",&[error])}else{Ok(JsValue::UNDEFINED)};
  settle(outcome).await?;Ok(())
 }
 fn activity(&self,active:bool)->Result<(),JsValue>{
  if get(&self.host,"onActivity").is_function(){call(&self.host,"onActivity",&[&active.into()])?;}Ok(())
 }
 fn can_import(&self)->Result<bool,JsValue>{Ok(call(&self.host,"canImport",&[])?.is_truthy())}

 async fn consume(self:Rc<Self>)->Result<(),JsValue>{
  if self.stopped.get()||self.busy.get()||!self.can_import()?||call(&self.host,"hidden",&[])?.is_truthy(){return Ok(());}
  self.busy.set(true);
  let mut active=false;
  let mut outcome=self.drain(&mut active).await;
  if let Err(failure)=outcome{outcome=self.report(&failure).await;}
  self.busy.set(false);
  if active{outcome=outcome.and(self.activity(false));}
  outcome
 }
 /// The body of the original's outer `try`: every entry of the inbox, one after the other.
 async fn drain(&self,active:&mut bool)->Result<(),JsValue>{
  let entries=parse(&call(&self.bridge,"pending",&[])?)?;
  if !Array::is_array(&entries){return Err(js_sys::TypeError::new("entries.some is not a function").into());}
  let entries=Array::from(&entries);
  if entries.iter().any(|entry|!self.failures.has(&get(&entry,"id"))){*active=true;self.activity(true)?;}
  for entry in entries.iter(){
   if self.stopped.get()||!self.can_import()?{break;}
   let id=get(&entry,"id");
   if self.failures.has(&id){continue;}
   match self.import(&entry,&id).await{
    Ok(true)=>{},
    Ok(false)=>return Ok(()),
    Err(failure)=>{
     let storage=get(&failure,"code").as_string().as_deref()==Some("LOCAL_BOOK_STORAGE_FAILED");
     if storage{self.failures.add(&id);}
     self.report(&failure).await?;
     // Keep the native original when IndexedDB could not commit it. A return to this app after
     // freeing space retries the same inbox file.
     if !storage{call(&self.bridge,"acknowledge",&[&id])?;}
    }
   }
  }
  Ok(())
 }
 /// One entry: its bytes in chunks, then the app's import. `false` when the importer was stopped midway.
 async fn import(&self,entry:&JsValue,id:&JsValue)->Result<bool,JsValue>{
  let failed=get(entry,"error");
  if failed.is_truthy(){return Err(error(&string(&failed)));}
  let size=get(entry,"size");
  let total=size.as_f64().filter(|total|total.fract()==0.0&&total.abs()<=9007199254740991.0&&*total>0.0)
   .ok_or_else(||error("El archivo está vacío o no se pudo leer."))?;
  let chunks=Array::new();
  let mut offset=0.0;
  while offset<total{
   if self.stopped.get(){return Ok(false);}
   let encoded=call(&self.bridge,"readChunk",&[id,&offset.into()])?;
   let bytes=decode(&string(&encoded))?;
   if bytes.is_empty()||offset+bytes.len() as f64>total{return Err(error("No se pudo leer el archivo completo. Vuelve a abrirlo desde Archivos."));}
   chunks.push(&Uint8Array::from(bytes.as_slice()));offset+=bytes.len() as f64;
   settle(call(&self.host,"yieldTask",&[])).await?;
  }
  let kind=or(get(entry,"mimeType"),"application/octet-stream".into());
  let file=construct("File",&[&chunks,&get(entry,"name"),&object(&[("type",kind)])])?;
  settle(call(&self.host,"onFile",&[&file])).await?;
  call(&self.bridge,"acknowledge",&[id])?;Ok(true)
 }
 fn poll(self:&Rc<Self>){
  // Like the original's `consume()`: it runs up to its first await at once, and a failure of its own
  // is an unhandled rejection of the promise nobody holds.
  let core=self.clone();
  let _ = start(async move{core.consume().await.map(|_|JsValue::UNDEFINED)});
 }
}

#[wasm_bindgen]
pub struct RustAndroidImports{core:Rc<Core>}
#[wasm_bindgen]
impl RustAndroidImports{
 #[wasm_bindgen(constructor)]
 pub fn new(host:JsValue)->Result<RustAndroidImports,JsValue>{
  let core=Rc::new(Core{bridge:get(&host,"bridge"),host,busy:Cell::new(false),stopped:Cell::new(false),failures:Set::new(&JsValue::UNDEFINED),
   interval:RefCell::new(JsValue::UNDEFINED),listener:RefCell::new(JsValue::UNDEFINED),callbacks:RefCell::new(Vec::new())});
  let ticker={let core=core.clone();Closure::wrap(Box::new(move||core.poll())as Box<dyn FnMut()>)};
  *core.interval.borrow_mut()=call(&core.host,"interval",&[ticker.as_ref(),&get(&core.host,"pollMs")])?;
  let visibility={let core=core.clone();Closure::wrap(Box::new(move||{
   if !call(&core.host,"hidden",&[]).map(|hidden|hidden.is_truthy()).unwrap_or(false){core.failures.clear();}
   core.poll();
  })as Box<dyn FnMut()>)};
  *core.listener.borrow_mut()=call(&core.host,"listen",&[visibility.as_ref()])?;
  core.callbacks.borrow_mut().extend([ticker,visibility]);
  core.poll();
  Ok(RustAndroidImports{core})
 }
 pub fn stop(&self)->Result<(),JsValue>{
  let core=&self.core;
  core.stopped.set(true);
  call(&core.host,"clearInterval",&[&core.interval.borrow().clone()])?;
  let remove=core.listener.borrow().clone();
  if remove.is_function(){remove.unchecked_ref::<Function>().call0(&JsValue::UNDEFINED)?;}
  // The callbacks own the importer: releasing them ends the cycle.
  core.callbacks.borrow_mut().clear();
  Ok(())
 }
}
