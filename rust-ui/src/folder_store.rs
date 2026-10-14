//! Books copied into a folder the person chose once (File System Access API): a name that never
//! overwrites a different file, the copy itself, reading it back, and the permission the browser may
//! have revoked meanwhile. Directory handles and the picker stay with the host.
use wasm_bindgen::prelude::*;
use js_sys::Promise;
use crate::cloud_host::*;

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
/// `sanitize` is the host's file-name cleaner.
#[wasm_bindgen(js_name=saveFileIntoFolder)]
pub fn save_file_into_folder(handle:JsValue,file:JsValue,sanitize:js_sys::Function)->Promise{
 start(async move{
  let safe=invoke(&sanitize,&[&get(&file,"name")])?;
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

/// A stored folder with a valid permission, or a new one the person picks.
#[wasm_bindgen(js_name=getOrChooseFolder)]
pub fn get_or_choose_folder(saved:js_sys::Function,choose:js_sys::Function)->Promise{
 start(async move{
  let handle=settle(invoke(&saved,&[])).await?;
  if handle.is_truthy(){
   let allowed=settle(Ok(ensure_folder_permission(handle.clone()).into())).await?;
   if allowed.is_truthy(){return Ok(handle);}
  }
  settle(invoke(&choose,&[])).await
 })
}
