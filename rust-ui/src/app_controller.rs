//! What app.js still decided between its hosts: the adoption of the reader's own word count and the
//! follow-up of a saved reading position. app.js keeps the objects these act on (library, queues, cloud
//! sync) and calls in here; every call is the one it made, in the same order.
use wasm_bindgen::{prelude::*,JsCast};
use wasm_bindgen_futures::JsFuture;
use js_sys::{Function,Object,Promise};
use crate::host::{absent,get,global,method,read,set,truthy};
use crate::cloud_host::start;
type R<T=()>=Result<T,JsValue>;

fn state(host:&JsValue)->R<JsValue>{read(host,"state")}
fn object(fields:&[(&str,JsValue)])->R<JsValue>{let value:JsValue=Object::new().into();for (key,field) in fields{set(&value,key,field)?;}Ok(value)}
/// A JS function owned by the garbage collector, like an arrow function in an options object.
fn function<F:?Sized+wasm_bindgen::closure::WasmClosure>(closure:Closure<F>)->JsValue{closure.into_js_value()}
fn assign(target:&JsValue,sources:&[&JsValue])->R{
 let assign=get(&get(&global(),"Object"),"assign");
 let mut args=vec![target];args.extend_from_slice(sources);
 assign.unchecked_ref::<Function>().apply(&JsValue::UNDEFINED,&args.into_iter().collect::<js_sys::Array>())?;Ok(())
}

/// The open reader counted the book's words: keep that count instead of parsing the book again in a
/// detached worker. A replacement file never inherits the old count, so the record is patched only while
/// it still holds the same content revision.
#[wasm_bindgen]
pub fn app_length_metadata(host:JsValue,record:JsValue,metadata:JsValue)->Promise{start(async move{
 if truthy(&read(&state(&host)?,"appDisposed")?){return Ok(JsValue::UNDEFINED)}
 let revision=read(&record,"contentRevision")?;
 let fields=object(&[("wordCount",read(&metadata,"wordCount")?),("wordCountComplete",read(&metadata,"wordCountComplete")?),
  ("wordCountVersion",read(&metadata,"wordCountVersion")?),("wordCountContentRevision",revision.clone()),("lengthDirty",JsValue::TRUE)])?;
 if !truthy(&revision){return Ok(JsValue::UNDEFINED)}
 let candidate:JsValue=Object::new().into();
 assign(&candidate,&[&record,&fields])?;
 if !crate::length_metadata::length_is_ready(candidate)?{return Ok(JsValue::UNDEFINED)}
 let expected=revision.clone();
 let current=function(Closure::<dyn FnMut(JsValue)->R<bool>>::new(move|current:JsValue|{
  Ok(truthy(&get(&current,"content"))&&read(&current,"contentRevision")?==expected)
 }));
 let patched=method(&read(&host,"library")?,"patch",&[&read(&record,"id")?,&fields,&object(&[("ifCurrent",current)])?])?;
 let saved=JsFuture::from(Promise::resolve(&patched)).await?;
 if !truthy(&saved){return Ok(JsValue::UNDEFINED)}
 method(&read(&host,"wordCountQueue")?,"cancel",&[&read(&record,"id")?])?;
 let state=state(&host)?;
 set(&state,"lengthStatusVersion",&JsValue::from_f64(crate::host::num(&read(&state,"lengthStatusVersion")?)+1.0))?;
 crate::app_shell::app_schedule_length_refresh(&host)?;
 if truthy(&read(&saved,"driveFileId")?)&&truthy(&method(&host,"hasDriveSession",&[])?){
  method(&read(&host,"cloudSync")?,"scheduleProgress",&[&read(&saved,"id")?])?;
  method(&host,"scheduleLibraryBackup",&[])?;
 }
 Ok(JsValue::UNDEFINED)
})}

/// A reading position (or a book's appearance) was saved: remember the position the reader may return to,
/// tell the room, schedule the cloud's copy of the progress and the library backup.
#[wasm_bindgen]
pub fn app_progress_saved(host:JsValue,record:JsValue,book_id:JsValue,fields:JsValue)->R{
 let fields=if fields.is_undefined(){js_sys::Array::new().into()}else{fields};
 if !truthy(&read(&state(&host)?,"appDisposed")?)&&truthy(&method(&fields,"includes",&[&"progressFraction".into()])?){
  let position=object(&[("fraction",get(&record,"progressFraction")),("locator",get(&record,"locator"))])?;
  method(&method(&host,"readerPositionGuard",&[])?,"remember",&[&book_id,&position])?;
 }
 method(&host,"onLocalBookChange",&[&book_id,&fields])?;
 if truthy(&get(&record,"driveFileId"))&&truthy(&method(&host,"hasDriveSession",&[])?){
  method(&read(&host,"cloudSync")?,"scheduleProgress",&[&book_id])?;
 }
 method(&host,"scheduleLibraryBackup",&[])?;
 Ok(())
}
