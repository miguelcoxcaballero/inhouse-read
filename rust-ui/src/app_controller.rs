//! What app.js still decided between its hosts: the adoption of the reader's own word count, the
//! follow-up of a saved reading position, the length queue's changes, the Android import, the page's
//! lifecycle listeners, the end of a shelf refresh and the launch frame's idle test. app.js keeps the
//! objects these act on (library, queues, cloud sync) and calls in here; every call is the one it made,
//! in the same order.
use wasm_bindgen::{prelude::*,JsCast};
use wasm_bindgen_futures::JsFuture;
use js_sys::{Function,Object,Promise};
use crate::host::{absent,clear_timeout,get,global,method,read,set,truthy};
use crate::cloud_host::start;
type R<T=()>=Result<T,JsValue>;

fn state(host:&JsValue)->R<JsValue>{read(host,"state")}
/// `app.shelf?.isInteracting`.
fn interacting(state:&JsValue)->R<bool>{let shelf=read(state,"shelf")?;Ok(!absent(&shelf)&&truthy(&read(&shelf,"isInteracting")?))}

/// The end of a shelf refresh, once the library, the bakes and the shelf and numeric modules are in: sort
/// the start-up read, give way to a newer deploy or a native import, rebuild the shelf, and retry a room
/// refresh that an interaction held back.
#[wasm_bindgen]
pub fn app_refresh_loaded(host:JsValue,stored:JsValue,first_read:bool,account:JsValue,immediate:JsValue)->Promise{start(async move{
 let stored=if first_read{method(&host,"recentFirst",&[&stored])?}else{stored};
 let state=state(&host)?;
 // The page is being replaced by a newer deploy: building this shelf would only hold that up.
 let deploy=read(&host,"deployCheck")?;
 if truthy(&read(&state,"appDisposed")?)||(!absent(&deploy)&&truthy(&method(&deploy,"reloading",&[])?))
  ||truthy(&method(&read(&host,"nativeImportShelfGate")?,"deferRefresh",&[])?){return Ok(JsValue::UNDEFINED)}
 let result=JsFuture::from(crate::app_refresh::app_refresh_after_load(host.clone(),stored,account,immediate)).await?;
 if interacting(&state)?{method(&host,"retryRoomRefresh",&[])?;}
 Ok(result)
})}

/// Whether the settled shelf may be saved as the next launch's first paint: nobody is using it.
#[wasm_bindgen]
pub fn app_launch_idle(host:JsValue)->R<bool>{
 let state=state(&host)?;
 Ok(!truthy(&read(&state,"appDisposed")?)&&truthy(&read(&read(&read(&host,"els")?,"readerScreen")?,"hidden")?)
  &&!interacting(&state)?&&!truthy(&read(&state,"closingReader")?))
}

/// Drive sync changed a record (or the whole library): update the shelf's copy, then refresh the shelf.
#[wasm_bindgen]
pub fn app_cloud_changed(host:JsValue,record:JsValue)->R<JsValue>{
 if truthy(&record){crate::host::method_opt(&read(&state(&host)?,"shelf")?,"updateCloudRecord",&[&record])?;}
 method(&host,"refreshShelf",&[])
}
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

/// The book-length queue finished (or changed) a count: batch the shelf's refresh, and give a Drive book's
/// new length to the cloud copy and the library backup.
#[wasm_bindgen]
pub fn app_length_change(host:JsValue,record:JsValue)->R{
 let state=state(&host)?;
 if truthy(&read(&state,"appDisposed")?){return Ok(())}
 set(&state,"lengthStatusVersion",&JsValue::from_f64(crate::host::num(&read(&state,"lengthStatusVersion")?)+1.0))?;
 // Batch short books: rebuilding the shelf once per completed chapter or library record would spend far
 // more time drawing than counting text.
 crate::app_shell::app_schedule_length_refresh(&host)?;
 if truthy(&get(&record,"driveFileId"))&&truthy(&method(&host,"hasDriveSession",&[])?){
  method(&read(&host,"cloudSync")?,"scheduleProgress",&[&read(&record,"id")?])?;
  method(&host,"scheduleLibraryBackup",&[])?;
 }
 Ok(())
}

/// `pagehide`: a discarded page has no shelf to update. A page kept for the back/forward cache keeps its
/// queues alive; one that is actually leaving withdraws every callback that could still touch it.
#[wasm_bindgen]
pub fn app_page_hide(host:JsValue,event:JsValue)->R{
 if truthy(&read(&event,"persisted")?){return Ok(())}
 let state=state(&host)?;
 set(&state,"appDisposed",&JsValue::TRUE)?;
 method(&read(&host,"profileView")?,"destroy",&[])?;
 method(&host,"releaseShelfSoundPreference",&[])?;
 method(&read(&host,"readingStreak")?,"destroy",&[])?;
 method(&read(&host,"nativeImportShelfGate")?,"destroy",&[])?;
 method(&read(&host,"shelfRefreshQueue")?,"dispose",&[])?;
 clear_timeout(&read(&state,"lengthRefreshTimer")?)?;
 set(&state,"lengthRefreshTimer",&JsValue::NULL)?;
 method(&read(&host,"wordCountQueue")?,"dispose",&[])?;
 clear_timeout(&read(&state,"backupTimer")?)?;
 if !read(&state,"drivePollTimer")?.is_null(){crate::app_drive_poll::app_drive_poll_update(&read(&host,"driveActions")?)?;}
 clear_timeout(&read(&state,"roomCaptureTimer")?)?;
 method(&host,"releasePositionGuard",&[])?;
 clear_timeout(&read(&state,"roomRefreshRetry")?)?;
 method(&read(&host,"liveRoom")?,"destroy",&[])?;
 Ok(())
}

/// The page is visible again: a count that finished while it was hidden refreshes the shelf now.
#[wasm_bindgen]
pub fn app_length_visibility(host:JsValue)->R{
 let state=state(&host)?;
 if !truthy(&read(&read(&host,"document")?,"hidden")?)&&read(&state,"shelfLengthStatusVersion")?!=read(&state,"lengthStatusVersion")?{
  crate::app_shell::app_schedule_length_refresh(&host)?;
 }
 Ok(())
}

/// Another tab changed one of the shelf's settings: apply it here too.
#[wasm_bindgen]
pub fn app_storage_changed(host:JsValue,event:JsValue)->R{
 let key=read(&event,"key")?;
 if read(&event,"storageArea")?==read(&global(),"localStorage")?&&!absent(&key)
  &&truthy(&method(&key,"startsWith",&[&"inhouse-read-shelf-".into()])?){
  method(&host,"applyCloudSettings",&[&js_sys::Array::of1(&key).into()])?;
 }
 Ok(())
}

/// A room setting changed on this device: a signed-in account captures the room for the other devices.
#[wasm_bindgen]
pub fn app_room_setting_changed(host:JsValue,detail:JsValue)->R{
 let account=get(&read(&state(&host)?,"driveProfile")?,"id");
 if truthy(&account)&&truthy(&method(&read(&host,"libraryBackup")?,"markSettingChanged",&[&account,&detail])?){
  method(&host,"scheduleRoomCapture",&[])?;
 }
 Ok(())
}

/// A book handed over by Android: fold the open cover, let the open book's last position finish saving
/// (its failure does not stop the import), then open the file, restoring it if it had been removed. The
/// import resolves after the loading wrapper has released its controls; its successful result already
/// guarantees committed original bytes.
#[wasm_bindgen]
pub fn app_import_file(host:JsValue,file:JsValue)->Promise{start(async move{
 let shelf=read(&state(&host)?,"shelf")?;
 if !absent(&shelf){JsFuture::from(Promise::resolve(&method(&shelf,"close",&[])?)).await?;}
 let pending=method(&read(&host,"progressWrites")?,"get",&[&read(&state(&host)?,"currentBookId")?])?;
 if !absent(&pending){
  let ignore=function(Closure::<dyn FnMut(JsValue)>::new(|_:JsValue|{}));
  JsFuture::from(Promise::resolve(&method(&pending,"catch",&[&ignore])?)).await?;
 }
 let opened=method(&host,"openFile",&[&file,&object(&[("restoreRemoved",JsValue::TRUE)])?])?;
 JsFuture::from(Promise::resolve(&opened)).await
})}
