//! Books copied into a folder the person chose once (File System Access API): a name that never
//! overwrites a different file, the copy itself, reading it back, the permission the browser may
//! have revoked meanwhile, the directory handle remembered in IndexedDB and the browser's picker.
use wasm_bindgen::prelude::*;
use js_sys::{JsString,Promise};
use crate::cloud_host::*;
use crate::library_store::idb_request;
// The cleaning itself, on UTF-16 units; its raw export is the numeric core's and is not called here.
#[allow(dead_code)]
#[path="../../rust-core/src/file_name.rs"]
mod file_name;

#[wasm_bindgen]
extern "C"{
 #[wasm_bindgen(js_name=String)]fn js_text(value:&JsValue)->JsString;
}

const DB_NAME:&str="inhouse-read-folder";
const DB_VERSION:f64=1.0;
const STORE:&str="handles";
const HANDLE_KEY:&str="library-folder";

/// `String(name)` with every run of reserved characters replaced by one underscore, trimmed; "libro" when
/// nothing is left. A well-formed name crosses once each way; one with a lone surrogate, which a Rust string
/// cannot hold, is read and written unit by unit so it comes back as it was.
#[wasm_bindgen(js_name=sanitizeFileName)]
pub fn sanitize_file_name(name:JsValue)->JsString{
 let text=js_text(&name);
 if let Some(plain)=text.as_string(){
  let original:&JsValue=text.as_ref();
  if JsValue::from_str(&plain)==*original{
   let clean=file_name::sanitize(&plain.encode_utf16().collect::<Vec<u16>>());
   return JsString::from(String::from_utf16_lossy(&clean));
  }
 }
 let clean=file_name::sanitize(&text.iter().collect::<Vec<u16>>());
 let mut result=JsString::from("");
 for part in clean.chunks(8192){result=result.concat(&JsString::from_char_code(part));}
 result
}

/// `indexedDB.open(DB_NAME, DB_VERSION)`, making the store on its first version.
async fn open_handles()->Result<JsValue,JsValue>{
 let request=call(&read(&global(),"indexedDB")?,"open",&[&DB_NAME.into(),&DB_VERSION.into()])?;
 // Owned by this call until the request settles (an upgrade comes before the success), then released: a
 // handler that is never called must not stay in the module's table, and it holds nothing of the request
 // (it reads it from its event), so neither keeps the other alive.
 let upgrade=Closure::<dyn FnMut(JsValue)>::new(move|event:JsValue|{
  let made=(||{
   let database=read(&read(&event,"target")?,"result")?;
   if !call(&read(&database,"objectStoreNames")?,"contains",&[&STORE.into()])?.is_truthy(){call(&database,"createObjectStore",&[&STORE.into()])?;}
   Ok::<(),JsValue>(())
  })();
  if let Err(error)=made{wasm_bindgen::throw_val(error);}
 });
 set(&request,"onupgradeneeded",upgrade.as_ref());
 let opened=settle(Ok(idb_request(&request)?.into())).await;
 set(&request,"onupgradeneeded",&JsValue::NULL);
 drop(upgrade);
 opened
}
fn handles(database:&JsValue,mode:&str)->Result<JsValue,JsValue>{
 call(&call(database,"transaction",&[&STORE.into(),&mode.into()])?,"objectStore",&[&STORE.into()])
}
async fn saved_handle()->Result<JsValue,JsValue>{
 let database=open_handles().await?;
 let handle=settle(Ok(idb_request(&call(&handles(&database,"readonly")?,"get",&[&HANDLE_KEY.into()])?)?.into())).await?;
 Ok(if nullish(&handle){JsValue::NULL}else{handle})
}
/// Asks the person for a folder and remembers it for the next time.
async fn choose()->Result<JsValue,JsValue>{
 let window=read(&global(),"window")?;
 let picker=read(&window,"showDirectoryPicker")?;
 let Some(picker)=wasm_bindgen::JsCast::dyn_ref::<js_sys::Function>(&picker) else{return Err(js_sys::TypeError::new("window.showDirectoryPicker is not a function").into());};
 let handle=settle(picker.call1(&window,&object(&[("id","inhouse-read-library".into()),("mode","readwrite".into())]))).await?;
 let database=open_handles().await?;
 settle(Ok(idb_request(&call(&handles(&database,"readwrite")?,"put",&[&handle,&HANDLE_KEY.into()])?)?.into())).await?;
 Ok(handle)
}

/// The handle stored by an earlier session, or null when no folder was ever chosen. The host answers null
/// itself where the browser has no folder picker.
#[wasm_bindgen(js_name=folderSavedHandle)]
pub fn folder_saved_handle()->Promise{start(saved_handle())}

#[wasm_bindgen(js_name=chooseFolder)]
pub fn choose_folder()->Promise{start(choose())}

/// A free name for `size` bytes: the same name when a file of that size is already there (the same
/// book), otherwise the first `name-2.ext`, `name-3.ext`... that is not taken by a different file.
async fn resolve_name(handle:JsValue,name:JsValue,size:JsValue)->Result<JsValue,JsValue>{
 let text=string(&name);
 let (base,extension)=match text.rfind('.'){Some(dot)=>(&text[..dot],&text[dot..]),None=>(text.as_str(),"")};
 let mut candidate=name.clone();
 let mut attempt=1u32;
 loop{
  // `await handle.getFileHandle(candidate).catch(() => null)`
  let pending=call(&handle,"getFileHandle",&[&candidate])?;
  let existing=settle(Ok(pending)).await.unwrap_or(JsValue::NULL);
  if !existing.is_truthy(){return Ok(candidate);}
  let found=settle(call(&existing,"getFile",&[])).await?;
  if get(&found,"size")==size{return Ok(candidate);}
  attempt+=1;
  candidate=format!("{base}-{attempt}{extension}").into();
 }
}

#[wasm_bindgen(js_name=resolveNonCollidingName)]
pub fn resolve_non_colliding_name(handle:JsValue,name:JsValue,size:JsValue)->Promise{start(resolve_name(handle,name,size))}

/// Copies the file into the folder under a name of its own; the final name is the answer.
#[wasm_bindgen(js_name=saveFileIntoFolder)]
pub fn save_file_into_folder(handle:JsValue,file:JsValue)->Promise{
 start(async move{
  let safe:JsValue=sanitize_file_name(get(&file,"name")).into();
  let name=settle(Ok(resolve_non_colliding_name(handle.clone(),safe,get(&file,"size")).into())).await?;
  let file_handle=settle(call(&handle,"getFileHandle",&[&name,&object(&[("create",JsValue::TRUE)])])).await?;
  let writable=settle(call(&file_handle,"createWritable",&[])).await?;
  settle(call(&writable,"write",&[&file])).await?;
  settle(call(&writable,"close",&[])).await?;
  Ok(name)
 })
}

/// The file by name, or null when it is no longer there (deleted, moved, permission gone).
#[wasm_bindgen(js_name=readFileFromFolder)]
pub fn read_file_from_folder(handle:JsValue,name:JsValue)->Promise{
 start(async move{
  let read=async{
   let file_handle=settle(call(&handle,"getFileHandle",&[&name])).await?;
   settle(call(&file_handle,"getFile",&[])).await
  };
  Ok(read.await.unwrap_or(JsValue::NULL))
 })
}

/// The permission of a stored directory may have lapsed (the browser revokes it when unused, or the
/// person did): it has to be asked for again before reading or writing. Asking needs a recent user
/// gesture; without one the browser throws instead of denying, which counts as a denial.
#[wasm_bindgen(js_name=ensureFolderPermission)]
pub fn ensure_folder_permission(handle:JsValue)->Promise{
 start(async move{
  if !handle.is_truthy(){return Ok(JsValue::FALSE);}
  let options=object(&[("mode","readwrite".into())]);
  let granted=|state:&JsValue|state.as_string().as_deref()==Some("granted");
  if granted(&settle(call(&handle,"queryPermission",&[&options])).await?){return Ok(JsValue::TRUE);}
  Ok(JsValue::from_bool(match settle(call(&handle,"requestPermission",&[&options])).await{Ok(state)=>granted(&state),Err(_)=>false}))
 })
}

/// A stored folder with a valid permission, or a new one the person picks. `supported` is the host's
/// `isFolderApiSupported()`: without a picker there is no stored folder to look for.
#[wasm_bindgen(js_name=getOrChooseFolder)]
pub fn get_or_choose_folder(supported:bool)->Promise{
 start(async move{
  let handle=settle(Ok(if supported{folder_saved_handle().into()}else{JsValue::NULL})).await?;
  if handle.is_truthy(){
   let allowed=settle(Ok(ensure_folder_permission(handle.clone()).into())).await?;
   if allowed.is_truthy(){return Ok(handle);}
  }
  settle(Ok(choose_folder().into())).await
 })
}
