//! Detached word-count work: revision guards, serial execution, cancellation and
//! commit policy. The host only manufactures JS continuations; no persistent
//! native callback owns a library, record or queue after its work has settled.
use wasm_bindgen::prelude::*;
use super::util::*;
use crate::length_metadata as length;
fn optional(value:&JsValue,key:&str)->R<JsValue>{if nullish(value){Ok(undef())}else{read(value,key)}}
fn callback(env:&JsValue,name:&str,args:&[&JsValue])->R<JsValue>{call(&read(env,name)?,name,args)}
fn id_of(book:&JsValue)->R<JsValue>{if book.is_string(){Ok(book.clone())}else{optional(book,"id")}}
#[wasm_bindgen]
pub fn length_queue_active(state:&JsValue,id:&JsValue,entry:&JsValue)->bool{
 !gb(state,"disposed")&&!gb(entry,"cancelled")&&map_get(&get(state,"entries"),id)==*entry
}
#[wasm_bindgen]
pub fn length_queue_missing_revision(current:&JsValue)->Result<bool,JsValue>{Ok(truthy(&read(current,"content")?)&&!truthy(&read(current,"contentRevision")?))}
#[wasm_bindgen]
pub fn length_queue_can_commit(state:&JsValue,id:&JsValue,entry:&JsValue,current:&JsValue)->Result<bool,JsValue>{
 Ok(length_queue_active(state,id,entry)&&truthy(&read(current,"content")?)&&read(current,"contentRevision")?==get(entry,"revision"))
}
#[wasm_bindgen]
pub fn length_queue_geometry(state:&JsValue,book:&JsValue)->Result<JsValue,JsValue>{
 if length::length_is_ready(book.clone())?{return Ok(s("ready"));}
 let entry=map_get(&get(state,"entries"),&optional(book,"id")?);
 Ok(if optional(&entry,"revision")?==optional(book,"contentRevision")?&&get(&entry,"status")==s("failed"){s("failed")}
 else if truthy(&optional(book,"content")?){s("pending")}else{s("needs-source")})
}
async fn ensure(state:JsValue,env:JsValue,book:JsValue)->R<JsValue>{
 if gb(&state,"disposed"){return Ok(null());}
 let id=id_of(&book)?;let library=read(&env,"library")?;
 let mut record=if book.is_object()&&!book.is_function(){book}else if truthy(&id){settle(method(&library,"get",&[&id])?).await?}else{id.clone()};
 if !truthy(&record)||gb(&state,"disposed")||length::length_is_ready(record.clone())?||!truthy(&read(&record,"content")?){return Ok(or(record,null()));}
 if !truthy(&read(&record,"contentRevision")?){
  let revision=callback(&env,"newRevision",&[])?;
  let options=obj(&[("ifCurrent",&read(&env,"missingRevision")?)]);
  record=settle(method(&library,"patch",&[&id,&obj(&[("contentRevision",&revision)]),&options])?).await?;
  if !truthy(&record){record=settle(method(&library,"get",&[&id])?).await?;}
  if !truthy(&optional(&record,"content")?)||gb(&state,"disposed"){return Ok(null());}
  if length::length_is_ready(record.clone())?{return Ok(record);}
 }
 let entries=get(&state,"entries");let previous=map_get(&entries,&id);
 if optional(&previous,"revision")?==read(&record,"contentRevision")?{return read(&previous,"task");}
 if truthy(&previous){putb(&previous,"cancelled",true);}
 let entry=obj(&[("revision",&read(&record,"contentRevision")?),("status",&s("pending")),("cancelled",&JsValue::FALSE),("task",&null())]);
 let caught=method(&get(&state,"tail"),"catch",&[&read(&env,"ignore")?])?;
 let job=callback(&env,"makeJob",&[&id,&entry])?;let failure=callback(&env,"makeFailure",&[&id,&entry,&record])?;
 let task=method(&method(&caught,"then",&[&job])?,"catch",&[&failure])?;
 put(&entry,"task",&task);map_set(&entries,&id,&entry);
 put(&state,"tail",&method(&task,"catch",&[&read(&env,"ignore")?])?);Ok(task)
}
#[wasm_bindgen]
pub fn length_queue_ensure(state:JsValue,env:JsValue,book:JsValue)->JsValue{run(ensure(state,env,book))}
async fn execute(state:JsValue,env:JsValue,id:JsValue,entry:JsValue)->R<JsValue>{
 if !length_queue_active(&state,&id,&entry){return Ok(null());}
 let library=read(&env,"library")?;let latest=settle(method(&library,"get",&[&id])?).await?;
 if !truthy(&latest)||read(&latest,"contentRevision")?!=get(&entry,"revision")||!truthy(&read(&latest,"content")?){return Ok(null());}
 let content=read(&latest,"content")?;
 let name=read(&latest,"name")?;let name=if truthy(&name){name}else{or(read(&latest,"title")?,s("libro"))};
 let mime=read(&latest,"mimeType")?;let mime=if truthy(&mime){mime}else{or(read(&read(&latest,"content")?,"type")?,s(""))};
 let file=construct("File",&[&arr(&[&content]),&name,&obj(&[("type",&mime)])])?;
 let active=callback(&env,"makeActive",&[&id,&entry])?;
 let measured=match callback(&env,"measureFile",&[&file,&obj(&[("isActive",&active)])]){
  Ok(value)=>settle(value).await,Err(error)=>Err(error)
 };
 let measured=match measured{Ok(value)=>value,Err(error)=>{if length_queue_active(&state,&id,&entry){callback(&env,"onError",&[&error,&latest])?;}null()}};
 if !length_queue_active(&state,&id,&entry){return Ok(null());}
 let measured=if length::length_has_complete_count(measured.clone())?{length::length_complete_count(read(&measured,"wordCount")?)}else{null()};
 if !truthy(&measured){put(&entry,"status",&s("failed"));callback(&env,"onChange",&[&null(),&obj(&[("id",&id),("status",&s("failed"))])])?;return Ok(null());}
 put(&measured,"wordCountContentRevision",&get(&entry,"revision"));putb(&measured,"lengthDirty",true);
 let guard=callback(&env,"makeCommitGuard",&[&id,&entry])?;
 let saved=settle(method(&library,"patch",&[&id,&measured,&obj(&[("ifCurrent",&guard)])])?).await?;
 if truthy(&saved){put(&entry,"status",&s("ready"));callback(&env,"onChange",&[&saved,&obj(&[("id",&id),("status",&s("ready"))])])?;}
 Ok(saved)
}
#[wasm_bindgen]
pub fn length_queue_run(state:JsValue,env:JsValue,id:JsValue,entry:JsValue)->JsValue{run(execute(state,env,id,entry))}
#[wasm_bindgen]
pub fn length_queue_failed(state:&JsValue,env:&JsValue,id:&JsValue,entry:&JsValue,record:&JsValue,error:&JsValue)->Result<JsValue,JsValue>{
 if length_queue_active(state,id,entry){put(entry,"status",&s("failed"));callback(env,"onError",&[error,record])?;callback(env,"onChange",&[&null(),&obj(&[("id",id),("status",&s("failed"))])])?;}Ok(null())
}
#[wasm_bindgen]
pub fn length_queue_cancel(state:&JsValue,id:&JsValue){let entries=get(state,"entries");let entry=map_get(&entries,id);if truthy(&entry){putb(&entry,"cancelled",true);}map_delete(&entries,id);}
#[wasm_bindgen]
pub fn length_queue_retry(state:JsValue,env:JsValue,book:JsValue,receiver:JsValue)->Result<JsValue,JsValue>{
 let id=id_of(&book)?;method(&receiver,"cancel",&[&id])?;let task=length_queue_ensure(state,env.clone(),book);
 callback(&env,"onChange",&[&null(),&obj(&[("id",&id),("status",&s("pending"))])])?;Ok(task)
}
#[wasm_bindgen]
pub fn length_queue_dispose(state:&JsValue)->Result<(),JsValue>{
 putb(state,"disposed",true);let entries=get(state,"entries");
 if let Some(values)=js_sys::try_iter(&method(&entries,"values",&[])?)?{for entry in values{putb(&entry?,"cancelled",true);}}
 method(&entries,"clear",&[])?;Ok(())
}
