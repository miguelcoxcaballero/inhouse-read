//! Where a device keeps its sync checkpoints: the `checkpoints` store of the IndexedDB database
//! `inhouse-read-cloud-state` (library-sized, so not synchronous localStorage). Reading, replacing
//! and merging one, each in its own transaction; the frozen JavaScript original is
//! tests/unit/helpers/reference-cloud-backup-state.js.
use std::{cell::{Cell,RefCell},rc::Rc};
use wasm_bindgen::prelude::*;
use js_sys::{Function,Promise};
use crate::host::{self,read,method,global,truthy};
use crate::cloud_host::{self,object,settle};
use crate::library_store::{handler,release_now,idb_request};
type R<T>=Result<T,JsValue>;
const STORE:&str="checkpoints";
const FAILED:&str="No se pudo guardar el estado de sincronización.";
thread_local!{static CONNECTION:RefCell<Option<Promise>>=const{RefCell::new(None)};}
fn s(value:&str)->JsValue{JsValue::from_str(value)}
fn empty()->JsValue{object(&[("books",js_sys::Object::new().into()),("settings",js_sys::Object::new().into())])}
/// `value || { books:{}, settings:{} }`.
fn or_empty(value:JsValue)->JsValue{if truthy(&value){value}else{empty()}}
/// One connection per page, opened on first use; a failed open is forgotten so the next call tries
/// again (an open that throws at once stays, as the original's rejected promise did).
fn database()->Promise{
 if let Some(open)=CONNECTION.with(|connection|connection.borrow().clone()){return open;}
 let open=Promise::new(&mut|resolve:Function,reject:Function|{
  let opened=(||->R<()>{
   let request=method(&read(&global(),"indexedDB")?,"open",&[&s("inhouse-read-cloud-state"),&JsValue::from_f64(1.0)])?;
   let keys=Rc::new(Cell::new([0u64;3]));
   let target=request.clone();
   let (upgrade,upgraded)=handler(move|_|{if let Err(error)=read(&target,"result").and_then(|db|method(&db,"createObjectStore",&[&s(STORE)])){wasm_bindgen::throw_val(error)}});
   let (target,ks)=(request.clone(),keys.clone());
   let (ok,success)=handler(move|_|{release_now(&ks.get());match read(&target,"result"){Ok(db)=>{let _=resolve.call1(&JsValue::UNDEFINED,&db);}Err(error)=>wasm_bindgen::throw_val(error)}});
   let (target,ks,fail)=(request.clone(),keys.clone(),reject.clone());
   let (err,failure)=handler(move|_|{release_now(&ks.get());CONNECTION.with(|connection|connection.borrow_mut().take());
    match read(&target,"error"){Ok(error)=>{let _=fail.call1(&JsValue::UNDEFINED,&error);}Err(error)=>wasm_bindgen::throw_val(error)}});
   keys.set([upgrade,ok,err]);
   host::set(&request,"onupgradeneeded",&upgraded)?;host::set(&request,"onsuccess",&success)?;host::set(&request,"onerror",&failure)
  })();
  if let Err(error)=opened{let _=reject.call1(&JsValue::UNDEFINED,&error);}
 });
 CONNECTION.with(|connection|*connection.borrow_mut()=Some(open.clone()));
 open
}
/// The completion of a write: `complete` resolves (with `value`, or with the event when there is
/// none, as `transaction.oncomplete = resolve` did), `abort` rejects with the transaction's error
/// or a plain one, `error` rejects with the transaction's error.
/// `also` is a handler of a request of the same transaction, released with these.
fn committed(transaction:&JsValue,value:Rc<RefCell<Option<JsValue>>>,also:u64,resolve:Function,reject:&Function)->R<()>{
 let keys=Rc::new(Cell::new([0u64;4]));
 let ks=keys.clone();
 let (done,complete)=handler(move|event|{release_now(&ks.get());let result=value.borrow_mut().take().unwrap_or(event);let _=resolve.call1(&JsValue::UNDEFINED,&result);});
 let (target,ks,fail)=(transaction.clone(),keys.clone(),reject.clone());
 let (aborted,abort)=handler(move|_|{release_now(&ks.get());
  match read(&target,"error"){Ok(error)=>{let error=if truthy(&error){error}else{cloud_host::error(FAILED)};let _=fail.call1(&JsValue::UNDEFINED,&error);}Err(error)=>wasm_bindgen::throw_val(error)}});
 let (target,fail)=(transaction.clone(),reject.clone());
 let (failed,error)=handler(move|_|match read(&target,"error"){Ok(error)=>{let _=fail.call1(&JsValue::UNDEFINED,&error);}Err(error)=>wasm_bindgen::throw_val(error)});
 keys.set([done,aborted,failed,also]);
 let wired=host::set(transaction,"oncomplete",&complete).and_then(|_|host::set(transaction,"onabort",&abort)).and_then(|_|host::set(transaction,"onerror",&error));
 if wired.is_err(){release_now(&[done,aborted,failed,also]);}
 wired
}
fn writing(db:&JsValue)->R<(JsValue,JsValue)>{
 let transaction=method(db,"transaction",&[&s(STORE),&s("readwrite")])?;
 let store=method(&transaction,"objectStore",&[&s(STORE)])?;Ok((transaction,store))
}

/// The checkpoint kept under `key`, or an empty one.
#[wasm_bindgen]
pub fn backup_checkpoint_read(key:JsValue)->Promise{cloud_host::start(async move{
 let db=settle(Ok(database().into())).await?;
 let request=method(&method(&method(&db,"transaction",&[&s(STORE)])?,"objectStore",&[&s(STORE)])?,"get",&[&key])?;
 Ok(or_empty(settle(Ok(idb_request(&request)?.into())).await?))
})}
/// Replace the checkpoint under `key`.
#[wasm_bindgen]
pub fn backup_checkpoint_save(key:JsValue,value:JsValue)->Promise{cloud_host::start(async move{
 let db=settle(Ok(database().into())).await?;
 let saved=Promise::new(&mut|resolve:Function,reject:Function|{
  let written=writing(&db).and_then(|(transaction,store)|{
   method(&store,"put",&[&value,&key])?;
   committed(&transaction,Rc::new(RefCell::new(None)),0,resolve,&reject)
  });
  if let Err(error)=written{let _=reject.call1(&JsValue::UNDEFINED,&error);}
 });
 settle(Ok(saved.into())).await
})}
/// Merge field registers into the checkpoint under `key` inside one transaction, so an older
/// network write cannot replace a newer local or direct checkpoint. Resolves with what was stored.
#[wasm_bindgen]
pub fn backup_checkpoint_merge(key:JsValue,value:JsValue)->Promise{cloud_host::start(async move{
 let db=settle(Ok(database().into())).await?;
 let saved=Promise::new(&mut|resolve:Function,reject:Function|{
  let started=writing(&db).and_then(|(transaction,store)|{
   let merged=Rc::new(RefCell::new(None));
   let request=method(&store,"get",&[&key])?;
   let (kept,target,transaction_too,fail,key,value)=(merged.clone(),request.clone(),transaction.clone(),reject.clone(),key.clone(),value.clone());
   let (id,found)=handler(move|_|{
    let stored=read(&target,"result").and_then(|current|{
     let next=super::live::library_merge_checkpoint(or_empty(current),value.clone());
     *kept.borrow_mut()=Some(next.clone());method(&store,"put",&[&next,&key])
    });
    if let Err(error)=stored{let _=method(&transaction_too,"abort",&[]);let _=fail.call1(&JsValue::UNDEFINED,&error);}
   });
   if let Err(error)=host::set(&request,"onsuccess",&found){release_now(&[id]);return Err(error);}
   committed(&transaction,merged,id,resolve,&reject)
  });
  if let Err(error)=started{let _=reject.call1(&JsValue::UNDEFINED,&error);}
 });
 settle(Ok(saved.into())).await
})}
