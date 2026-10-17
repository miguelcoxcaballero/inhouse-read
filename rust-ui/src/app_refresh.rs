//! Root shelf refresh decisions after the existing parallel loading gate.
//! JS retains SDK adapters, DOM event wiring and its currently shared globals.
use wasm_bindgen::prelude::*;
use js_sys::{Array,Object,Promise};
use crate::host::{read,method,truthy,absent,set};
use crate::cloud_host;
type R<T> = Result<T,JsValue>;
fn or(a:JsValue,b:impl FnOnce()->R<JsValue>)->R<JsValue>{if truthy(&a){Ok(a)}else{b()}}
fn deferred(state:&JsValue,host:&JsValue)->R<bool>{Ok(truthy(&read(state,"appDisposed")?)||truthy(&method(&read(host,"nativeImportShelfGate")?,"deferRefresh",&[])?))}
#[wasm_bindgen]
pub fn app_refresh_after_load(host:JsValue,stored:JsValue,account:JsValue,immediate:JsValue)->Promise{cloud_host::start(async move{
 let state=read(&host,"state")?;let library=read(&host,"library")?;let pending=Array::new();
 for book in Array::from(&stored).iter(){
  let title=crate::book_title::book_normalize_title(or(read(&book,"title")?,||read(&book,"name"))?,JsValue::UNDEFINED)?;
  let author=crate::book_title::book_normalize_author(read(&book,"author")?)?;let patch=Object::new();let mut changed=false;
  if title!=read(&book,"title")?{set(patch.as_ref(),"title",&title)?;changed=true;}
  if author!=or(read(&book,"author")?,||Ok("".into()))?{set(patch.as_ref(),"author",&if truthy(&author){author}else{JsValue::NULL})?;changed=true;}
  pending.push(&if changed{method(&library,"patch",&[&read(&book,"id")?,patch.as_ref()])?}else{book});
 }
 let normalized=cloud_host::settle(Ok(Promise::all(&pending).into())).await?;
 let books=Array::new();for book in Array::from(&normalized).iter(){if crate::book_data::book_is_visible(book.clone(),account.clone())?{books.push(&book);}}
 if deferred(&state,&host)?{return Ok(JsValue::UNDEFINED);}
 if truthy(&read(&state,"cloudRoomChanged")?)&&truthy(&read(&read(&read(&host,"els")?,"readerScreen")?,"hidden")?)&&!truthy(&read(&state,"closingReader")?){
  let shelf=read(&state,"shelf")?;if !absent(&shelf){method(&shelf,"destroy",&[])?;}
  set(&state,"shelf",&JsValue::NULL)?;set(&state,"shelfRecords",&JsValue::NULL)?;set(&state,"cloudRoomChanged",&JsValue::FALSE)?;
 }
 for book in books.iter(){let task=method(&read(&host,"wordCountQueue")?,"ensure",&[&book])?;method(&task,"catch",&[&read(&host,"warnPreparation")?])?;}
 if truthy(&read(&state,"shelf")?)&&truthy(&read(&state,"shelfRecords")?)
  &&truthy(&crate::library_store::library_same_records(read(&state,"shelfRecords")?,books.clone().into(),read(&host,"libraryHost")?)?)
  &&read(&state,"shelfLengthStatusVersion")?==read(&state,"lengthStatusVersion")?{return Ok(JsValue::UNDEFINED);}
 set(&state,"shelfRecords",books.as_ref())?;set(&state,"shelfLengthStatusVersion",&read(&state,"lengthStatusVersion")?)?;
 if !truthy(&read(&state,"shelf")?){set(&state,"shelf",&method(&host,"createShelf",&[books.as_ref()])?)?;}
 else{
  if !truthy(&immediate)&&truthy(&read(&read(&state,"shelf")?,"queueRefresh")?){method(&read(&state,"shelf")?,"queueRefresh",&[books.as_ref()])?;}
  else{method(&read(&state,"shelf")?,"update",&[books.as_ref()])?;}
 }
 Ok(JsValue::UNDEFINED)
})}
