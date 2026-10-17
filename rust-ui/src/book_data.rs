//! Local originals, account visibility and the selected book's editable names.
//! All decisions stay synchronous until the original IndexedDB commit is awaited.
use wasm_bindgen::{prelude::*,JsCast};
use js_sys::{Array,Function,Object,Reflect};
use crate::host::{read,truthy,absent,boxed,method};
use crate::cloud_host::{self,object,data_entry,copy_data_entries};
use crate::length_metadata::{length_clear_count,length_new_revision};
type R<T> = Result<T,JsValue>;
fn optional(value:&JsValue,key:&str)->R<JsValue>{if absent(value){Ok(JsValue::UNDEFINED)}else{read(value,key)}}
fn setting(options:&JsValue,key:&str)->R<JsValue>{let value=read(options,key)?;Ok(if value.is_undefined(){JsValue::FALSE}else{value})}
#[wasm_bindgen]
pub fn book_is_visible(book:JsValue,account:JsValue)->R<bool>{
 if !truthy(&book){return Ok(false);}
 Ok(truthy(&read(&book,"content")?)||read(&book,"sourceType")?!=JsValue::from_str("drive")
  ||truthy(&account)&&(!truthy(&read(&book,"cloudAccountId")?)||read(&book,"cloudAccountId")?==account))
}
#[wasm_bindgen]
pub fn book_cloud_state(book:JsValue,options:JsValue)->R<JsValue>{
 let connected=setting(&options,"connected")?;
 Ok(object(&[("connected",JsValue::from_bool(truthy(&connected))),("saved",JsValue::from_bool(truthy(&optional(&book,"driveFileId")?)))]))
}
#[wasm_bindgen]
pub fn book_needs_drive_download(book:JsValue)->R<bool>{Ok(truthy(&optional(&book,"driveFileId")?)&&!truthy(&read(&book,"content")?))}
async fn store(library:JsValue,file:JsValue,fields:JsValue,restore:JsValue,reuse:JsValue)->R<JsValue>{
 let parts=Array::new();parts.push(&file);
 let content=cloud_host::construct("Blob",&[&parts.into(),&object(&[("type",read(&file,"type")?)])])?;
 // && retains lazy/repeated getters, including a revision changing while copied.
 let preserve=if truthy(&reuse)&&read(&fields,"contentRevision")?.is_string(){truthy(&read(&fields,"contentRevision")?)}else{false};
 let entries=Array::new();copy_data_entries(&entries,&fields)?;
 data_entry(&entries,&"content".into(),&content);
 if !preserve{copy_data_entries(&entries,&length_clear_count())?;data_entry(&entries,&"contentDriveChecksum".into(),&JsValue::NULL);}
 let revision=if preserve{read(&fields,"contentRevision")?}else{length_new_revision()?};
 data_entry(&entries,&"contentRevision".into(),&revision);
 let record:JsValue=Object::from_entries(&entries.into())?.into();
 cloud_host::settle(method(&library,"addOrTouch",&[&record,&object(&[("restoreRemoved",restore)])])).await
}
#[wasm_bindgen]
pub fn book_store_file(library:JsValue,file:JsValue,fields:JsValue,options:JsValue)->js_sys::Promise{cloud_host::start(async move{
 // Parameter destructuring happens outside the storage-error catch.
 let restore=setting(&options,"restoreRemoved")?;let reuse=setting(&options,"reuseStoredContent")?;
 match store(library,file,fields,restore,reuse).await{
  Ok(record)=>Ok(record),Err(cause)=>{
   let error=cloud_host::error_with_cause("No se pudo guardar el libro en este dispositivo. Libera espacio y vuelve a importarlo.",cause);
   crate::host::set(&error,"code",&"LOCAL_BOOK_STORAGE_FAILED".into())?;Err(error)
  }
 }
})}
#[wasm_bindgen]
pub fn book_refresh_selected_names(experience:JsValue,book:JsValue)->R<JsValue>{
 if !truthy(&book)||absent(&read(&book,"id")?){return Ok(JsValue::UNDEFINED);}
 let source=boxed(&book);let mut keys=Vec::new();
 // filter then map: read every accepted value twice in the original order.
 for key in ["spineTitleOverride","author"]{
  let descriptor=Reflect::get_own_property_descriptor(source.unchecked_ref::<Object>(),&key.into())?;
  if !absent(&descriptor)&&!read(&book,key)?.is_undefined(){keys.push(key);}
 }
 let entries=Array::new();for key in keys{data_entry(&entries,&key.into(),&read(&book,key)?);}
 let fields:JsValue=Object::from_entries(&entries.into())?.into();
 if absent(&experience){return Ok(JsValue::UNDEFINED);}
 let callback=read(&experience,"refreshNames")?;if absent(&callback){return Ok(JsValue::UNDEFINED);}
 let id=read(&book,"id")?;
 callback.dyn_ref::<Function>().ok_or_else(||js_sys::TypeError::new("refreshNames is not a function"))?.call2(&experience,&id,&fields)
}
