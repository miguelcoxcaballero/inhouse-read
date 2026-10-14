//! Restores old local imports from the already-authorized library folder.
//! The folder handle, the file reads and the records stay behind host callbacks.
use wasm_bindgen::prelude::*;
use js_sys::{Array,Promise};
use crate::host::*;

/// `host`: `{supported, getHandle, readFile, clearBookLength, newContentRevision}`.
async fn restore(library:JsValue,host:JsValue)->Result<JsValue,JsValue>{
 let supported=call(&host,"supported",&[])?;
 if !supported.is_truthy(){return Ok(0.into());}
 let handle=call_async(&host,"getHandle",&[]).await?;
 if !handle.is_truthy(){return Ok(0.into());}
 let permission=call_async(&handle,"queryPermission",&[&object(&[("mode","read".into())])]).await?;
 if permission.as_string().as_deref()!=Some("granted"){return Ok(0.into());}
 let all=Array::from(&call_async(&library,"listAll",&[]).await?);
 let books:Vec<JsValue>=all.iter().filter(|book|
  get(book,"sourceType").as_string().as_deref()==Some("local")&&!get(book,"driveFileId").is_truthy()
  &&!get(book,"content").is_truthy()&&get(book,"folderFileName").is_truthy()).collect();
 let mut restored=0;
 for book in books{
  let file=call_async(&host,"readFile",&[&handle,&get(&book,"folderFileName")]).await?;
  if !file.is_truthy()||number(&get(&file,"size"))!=number(&get(&book,"size")){continue;}
  // `file.type || book.mimeType || 'application/octet-stream'`
  let mime=[get(&file,"type"),get(&book,"mimeType")].into_iter().find(|value|value.is_truthy()).unwrap_or_else(||"application/octet-stream".into());
  let content=construct("Blob",&[&Array::of1(&file).into(),&object(&[("type",mime.clone())])])?;
  let fields=object(&[("content",content),("mimeType",mime)]);
  assign(&fields,&call(&host,"clearBookLength",&[])?)?;
  set(&fields,"contentRevision",&call(&host,"newContentRevision",&[])?);
  call_async(&library,"patch",&[&get(&book,"id"),&fields]).await?;
  restored+=1;
 }
 Ok(restored.into())
}

#[wasm_bindgen(js_name=restoreLegacyBookBytes)]
pub fn restore_legacy_book_bytes(library:JsValue,host:JsValue)->Promise{to_promise(restore(library,host))}
