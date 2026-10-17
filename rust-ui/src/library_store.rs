//! Library decisions and atomic read/modify/write operations. The host supplies
//! IndexedDB request/completion promises; no module load happens in a transaction.
use wasm_bindgen::prelude::*;
use js_sys::{Array,Object,Promise};
use crate::host::{read,method,truthy,absent,call,global};
use crate::cloud_host::{self,object,copy_data_entries,data_entry};
type R<T> = Result<T,JsValue>;
const BOOKS:&str="books";const REMOVED:&str="removed-books";
fn s(value:&str)->JsValue{JsValue::from_str(value)}
fn optional(value:&JsValue,key:&str)->R<JsValue>{if absent(value){Ok(JsValue::UNDEFINED)}else{read(value,key)}}
fn or(a:JsValue,b:JsValue)->JsValue{if truthy(&a){a}else{b}}
fn coalesce(a:JsValue,b:JsValue)->JsValue{if absent(&a){b}else{a}}
fn opts(value:&JsValue,key:&str,fallback:JsValue)->R<JsValue>{let value=read(value,key)?;Ok(if value.is_undefined(){fallback}else{value})}
fn callback(env:&JsValue,name:&str,args:&[&JsValue])->R<JsValue>{call(&read(env,name)?,name,args)}
async fn wait(value:R<JsValue>)->R<JsValue>{cloud_host::settle(value).await}
async fn request(env:&JsValue,value:R<JsValue>)->R<JsValue>{wait(callback(env,"wrap",&[&value?])).await}
async fn db(value:&JsValue)->R<JsValue>{wait(Ok(value.clone())).await}
fn now()->R<JsValue>{method(&read(&global(),"Date")?,"now",&[])}
fn number(value:&JsValue)->R<f64>{Ok(crate::host::num(&call(&read(&global(),"Number")?,"Number",&[value])?))}
fn joined(values:&[JsValue])->R<JsValue>{method(&s(""),"concat",&values.iter().collect::<Vec<_>>())}
fn fields(parts:&[&JsValue])->R<JsValue>{let entries=Array::new();for part in parts{copy_data_entries(&entries,part)?;}Ok(Object::from_entries(&entries.into())?.into())}
fn complete(env:&JsValue,transaction:&JsValue)->R<JsValue>{callback(env,"committed",&[transaction])}
fn store_at(db:&JsValue,name:&str,mode:&str)->R<JsValue>{method(&method(db,"transaction",&[&s(name),&s(mode)])?,"objectStore",&[&s(name)])}
fn transaction(db:&JsValue)->R<JsValue>{let names=Array::new();names.push(&s(BOOKS));names.push(&s(REMOVED));method(db,"transaction",&[&names.into(),&s("readwrite")])}
fn matches(removal:&JsValue,source:&JsValue)->R<bool>{
 if read(removal,"id")?==read(source,"id")?{return Ok(true);}
 if truthy(&read(removal,"cloudAccountId")?)&&truthy(&read(source,"cloudAccountId")?)&&read(removal,"cloudAccountId")?!=read(source,"cloudAccountId")?{return Ok(false);}
 if truthy(&read(removal,"driveFileId")?)&&truthy(&read(source,"driveFileId")?){return Ok(read(removal,"driveFileId")?==read(source,"driveFileId")?);}
 Ok(truthy(&read(removal,"name")?)&&truthy(&read(source,"name")?)&&read(removal,"name")?==read(source,"name")?&&number(&read(removal,"size")?)?==number(&read(source,"size")?)?)
}
fn fallback(source:&JsValue,previous:&JsValue,key:&str)->R<JsValue>{
 let value=read(source,key)?;if truthy(&value){Ok(value)}else{read(previous,key)}
}
fn removal_identity(source:&JsValue,previous:&JsValue)->R<JsValue>{
 let previous=if previous.is_undefined(){Object::new().into()}else{previous.clone()};
 let entries=Array::new();data_entry(&entries,&s("id"),&read(source,"id")?);
 let name=fallback(source,&previous,"name")?;data_entry(&entries,&s("name"),&or(name,s("")));
 let size=read(source,"size")?;let size=number(&if absent(&size){read(&previous,"size")?}else{size})?;
 data_entry(&entries,&s("size"),&JsValue::from_f64(if size.is_nan()||size==0.0{0.0}else{size}));
 if truthy(&fallback(source,&previous,"driveFileId")?){
  data_entry(&entries,&s("driveFileId"),&fallback(source,&previous,"driveFileId")?);
 }
 if truthy(&fallback(source,&previous,"cloudAccountId")?){
  data_entry(&entries,&s("cloudAccountId"),&fallback(source,&previous,"cloudAccountId")?);
 }
 let removed=read(&previous,"removedAt")?;data_entry(&entries,&s("removedAt"),&if truthy(&removed){removed}else{now()?});
 Ok(Object::from_entries(&entries.into())?.into())
}
#[wasm_bindgen]
pub fn library_id_for_source(source:JsValue)->R<JsValue>{
 // Destructuring reads every field before deciding which source kind applies.
 let kind=read(&source,"sourceType")?;let drive=read(&source,"driveFileId")?;let name=read(&source,"name")?;let size=read(&source,"size")?;
 if kind==s("drive")&&truthy(&drive){joined(&[s("drive:"),drive])}else{joined(&[s("local:"),name,s(":"),size])}
}
#[wasm_bindgen]
pub fn library_get(database:JsValue,env:JsValue,id:JsValue)->Promise{cloud_host::start(async move{
 let store=store_at(&db(&database).await?,BOOKS,"readonly")?;
 Ok(coalesce(request(&env,method(&store,"get",&[&id])).await?,JsValue::NULL))
})}
#[wasm_bindgen]
pub fn library_is_removed(database:JsValue,env:JsValue,source:JsValue)->Promise{cloud_host::start(async move{
 let source=if source.is_string(){object(&[("id",source)])}else{source};if !truthy(&source){return Ok(JsValue::FALSE);}
 let store=store_at(&db(&database).await?,REMOVED,"readonly")?;
 let removals=request(&env,method(&store,"getAll",&[])).await?;
 for removal in Array::from(&removals).iter(){if matches(&removal,&source)?{return Ok(JsValue::TRUE);}}Ok(JsValue::FALSE)
})}
#[wasm_bindgen]
pub fn library_add(database:JsValue,env:JsValue,partial:JsValue,options:JsValue)->Promise{cloud_host::start(async move{
 let restore=opts(&options,"restoreRemoved",JsValue::FALSE)?;
 let id=read(&partial,"id")?;let id=if absent(&id){library_id_for_source(partial.clone())?}else{id};
 let transaction=transaction(&db(&database).await?)?;let completion=complete(&env,&transaction)?;
 let store=method(&transaction,"objectStore",&[&s(BOOKS)])?;let removed=method(&transaction,"objectStore",&[&s(REMOVED)])?;
 let removals=request(&env,method(&removed,"getAll",&[])).await?;let matching=Array::new();
 for removal in Array::from(&removals).iter(){
  // The spread is evaluated for each predicate, including its getter order.
  if matches(&removal,&fields(&[&partial,&object(&[("id",id.clone())])])?)?{matching.push(&removal);}
 }
 if matching.length()>0&&!truthy(&restore){wait(Ok(completion)).await?;return Ok(JsValue::NULL);}
 if truthy(&restore){for removal in matching.iter(){method(&removed,"delete",&[&read(&removal,"id")?])?;}}
 let existing=request(&env,method(&store,"get",&[&id])).await?;let time=now()?;
 let all=method(&read(&global(),"Object")?,"entries",&[&partial])?;let defined=Array::new();
 for pair in Array::from(&all).iter(){let pair=Array::from(&pair);if !pair.get(1).is_undefined(){defined.push(&pair);}}
 let defined:JsValue=Object::from_entries(&defined.into())?.into();
 let entries=Array::new();data_entry(&entries,&s("progressFraction"),&JsValue::from_f64(0.0));copy_data_entries(&entries,&existing)?;copy_data_entries(&entries,&defined)?;
 data_entry(&entries,&s("id"),&id);data_entry(&entries,&s("addedAt"),&coalesce(optional(&existing,"addedAt")?,time.clone()));data_entry(&entries,&s("lastOpenedAt"),&time);
 let record:JsValue=Object::from_entries(&entries.into())?.into();request(&env,method(&store,"put",&[&record])).await?;wait(Ok(completion)).await?;Ok(record)
})}
#[wasm_bindgen]
pub fn library_update_progress(database:JsValue,env:JsValue,id:JsValue,progress:JsValue,locator:JsValue)->Promise{cloud_host::start(async move{
 let store=store_at(&db(&database).await?,BOOKS,"readwrite")?;let completion=complete(&env,&read(&store,"transaction")?)?;
 let existing=request(&env,method(&store,"get",&[&id])).await?;if !truthy(&existing){return Ok(JsValue::NULL);}
 let time=now()?;let record=fields(&[&existing,&object(&[("progressFraction",progress),("locator",locator),("progressUpdatedAt",time.clone()),("progressDirty",JsValue::TRUE),("lastOpenedAt",time)])])?;
 request(&env,method(&store,"put",&[&record])).await?;wait(Ok(completion)).await?;Ok(record)
})}
#[wasm_bindgen]
pub fn library_remove_from_shelf(database:JsValue,env:JsValue,book:JsValue,options:JsValue)->Promise{cloud_host::start(async move{
 let removed_at=read(&options,"removedAt")?;let id=if book.is_string(){book.clone()}else{optional(&book,"id")?};if !truthy(&id){return Ok(JsValue::NULL);}
 let transaction=transaction(&db(&database).await?)?;let completion=complete(&env,&transaction)?;
 let store=method(&transaction,"objectStore",&[&s(BOOKS)])?;let removed=method(&transaction,"objectStore",&[&s(REMOVED)])?;
 let record=request(&env,method(&store,"get",&[&id])).await?;let previous=request(&env,method(&removed,"get",&[&id])).await?;
 let source=fields(&[&if book.is_object()&&!book.is_function(){book}else{Object::new().into()},&record,&object(&[("id",id.clone())])])?;
 let removal=removal_identity(&source,&previous)?;
 if removed_at.as_f64().is_some_and(|n|n.is_finite()&&n>0.0){crate::host::set(&removal,"removedAt",&removed_at)?;}
 method(&removed,"put",&[&removal])?;method(&store,"delete",&[&id])?;wait(Ok(completion)).await?;Ok(removal)
})}
#[wasm_bindgen]
pub fn library_remember_removed(database:JsValue,env:JsValue,book:JsValue,drive:JsValue,account:JsValue)->Promise{cloud_host::start(async move{
 let store=store_at(&db(&database).await?,REMOVED,"readwrite")?;let completion=complete(&env,&read(&store,"transaction")?)?;
 let previous=request(&env,method(&store,"get",&[&read(&book,"id")?])).await?;
 if truthy(&previous){let source=fields(&[&book,&object(&[("driveFileId",drive),("cloudAccountId",account)])])?;method(&store,"put",&[&removal_identity(&source,&previous)?])?;}
 wait(Ok(completion)).await?;Ok(JsValue::UNDEFINED)
})}
#[wasm_bindgen]
pub fn library_patch(database:JsValue,env:JsValue,id:JsValue,patch:JsValue,options:JsValue)->Promise{cloud_host::start(async move{
 let guard=read(&options,"ifCurrent")?;let store=store_at(&db(&database).await?,BOOKS,"readwrite")?;let completion=complete(&env,&read(&store,"transaction")?)?;
 let existing=request(&env,method(&store,"get",&[&id])).await?;if !truthy(&existing){return Ok(JsValue::NULL);}
 if truthy(&guard)&&!truthy(&call(&guard,"ifCurrent",&[&existing])?){wait(Ok(completion)).await?;return Ok(JsValue::NULL);}
 let record=fields(&[&existing,&patch,&object(&[("id",id)])])?;request(&env,method(&store,"put",&[&record])).await?;wait(Ok(completion)).await?;Ok(record)
})}
#[wasm_bindgen]
pub fn library_set_cover(database:JsValue,env:JsValue,id:JsValue,cover:JsValue)->Promise{cloud_host::start(async move{
 let store=store_at(&db(&database).await?,BOOKS,"readwrite")?;let completion=complete(&env,&read(&store,"transaction")?)?;
 let existing=request(&env,method(&store,"get",&[&id])).await?;if !truthy(&existing){return Ok(JsValue::NULL);}
 let record=fields(&[&existing,&object(&[("cover",cover),("coverUpdatedAt",now()?)])])?;request(&env,method(&store,"put",&[&record])).await?;wait(Ok(completion)).await?;Ok(record)
})}
