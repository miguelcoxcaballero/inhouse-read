//! Shared root book actions. Native futures start synchronously until their
//! first await, preserving cancellation and selection-generation ownership.
use wasm_bindgen::prelude::*;
use js_sys::{Array,Object,Promise,Reflect};
use crate::host::{read,method,truthy,set};
use crate::cloud_host;
type R<T> = Result<T,JsValue>;
#[wasm_bindgen]
pub fn app_persist_book_state(host:JsValue,id:JsValue,fields:JsValue)->Promise{cloud_host::start(async move{
 cloud_host::settle(method(&read(&host,"progressWrites")?,"patch",&[&id,&fields])).await?;
 method(&host,"scheduleLibraryBackup",&[])?;Ok(JsValue::UNDEFINED)
})}
#[wasm_bindgen]
pub fn app_finish_removed_preparation(host:JsValue,book:JsValue,generation:JsValue)->R<JsValue>{
 let state=read(&host,"state")?;
 if read(&state,"preparationGeneration")?!=generation||truthy(&read(&state,"requestedPreparationId")?)
  ||truthy(&read(&state,"currentBookId")?)&&read(&state,"currentBookId")?!=read(&book,"id")?{return Ok(JsValue::UNDEFINED);}
 let els=read(&host,"els")?;let screen=read(&els,"readerScreen")?;let classes=read(&screen,"classList")?;
 if !truthy(&method(&classes,"contains",&[&"is-preparing".into()])?){return Ok(JsValue::UNDEFINED);}
 method(&read(&host,"reader")?,"close",&[])?;method(&read(&host,"readingExperience")?,"reset",&[])?;
 set(&state,"currentBookId",&JsValue::NULL)?;set(&state,"activePreparedBookId",&JsValue::NULL)?;
 set(&screen,"hidden",&JsValue::TRUE)?;method(&classes,"remove",&[&"is-preparing".into()])?;
 set(&read(&els,"readerViewport")?,"innerHTML",&"".into())?;Ok(JsValue::UNDEFINED)
}
#[wasm_bindgen]
pub fn app_remove_from_shelf(host:JsValue,book:JsValue)->Promise{cloud_host::start(async move{
 let state=read(&host,"state")?;
 let owns=read(&state,"requestedPreparationId")?==read(&book,"id")?||read(&state,"activePreparedBookId")?==read(&book,"id")?;
 if read(&state,"requestedPreparationId")?==read(&book,"id")?{
  let generation=read(&state,"preparationGeneration")?.as_f64().unwrap_or(f64::NAN)+1.0;
  set(&state,"preparationGeneration",&generation.into())?;set(&state,"requestedPreparationId",&JsValue::NULL)?;
 }
 let generation=read(&state,"preparationGeneration")?;
 method(&read(&host,"preparedBooks")?,"delete",&[&read(&book,"id")?])?;
 method(&read(&host,"coverUpgrades")?,"delete",&[&read(&book,"id")?])?;
 let preparing=read(&state,"readerPreparationQueue")?;
 let removal=cloud_host::settle(method(&read(&host,"cloudSync")?,"removeFromShelf",&[&book])).await?;
 method(&host,"scheduleLibraryBackup",&[])?;
 if owns{
  let caught=method(&preparing,"catch",&[&read(&host,"ignoreRemovalPreparationError")?])?;
  let cleanup=method(&host,"removedPreparationCleanup",&[&book,&generation])?;
  let finished=method(&caught,"then",&[&cleanup])?;
  method(&finished,"catch",&[&read(&host,"warnRemovalPreparation")?])?;
 }
 Ok(removal)
})}
#[wasm_bindgen]
pub fn app_book_remove(host:JsValue,book:JsValue)->R<Promise>{
 method(&read(&host,"wordCountQueue")?,"cancel",&[&read(&book,"id")?])?;
 method(&read(&host,"preparedPages")?,"invalidateBook",&[&read(&book,"id")?,&"removed".into()])?;
 method(&host,"releasePageGate",&[&"removed".into(),&read(&book,"id")?])?;
 let task=app_remove_from_shelf(host.clone(),book.clone());
 Ok(cloud_host::start(async move{
 let removal=cloud_host::settle(Ok(task.into())).await?;
 let state=read(&host,"state")?;
 if truthy(&read(&state,"shelfRecords")?){
  let records=Array::new();for record in Array::from(&read(&state,"shelfRecords")?).iter(){
   if read(&record,"id")?!=read(&book,"id")?{records.push(&record);}
  }set(&state,"shelfRecords",records.as_ref())?;
 }
 Ok(removal)
}))}
#[wasm_bindgen]
pub fn app_cover_appearance(host:JsValue,book:JsValue,appearance:JsValue,key:JsValue)->R<Promise>{
 let id=read(&book,"id")?;let entries=Array::new();
 cloud_host::data_entry(&entries,&"coverAppearance".into(),&appearance);
 cloud_host::data_entry(&entries,&"coverAppearanceKey".into(),&key);
 let patch:JsValue=Object::from_entries(entries.as_ref())?.into();
 let task=method(&read(&host,"library")?,"patch",&[&id,&patch])?;
 Ok(cloud_host::start(async move{
  let record=cloud_host::settle(Ok(task)).await?;
  method(&host,"scheduleLibraryBackup",&[])?;Ok(record)
 }))
}

#[wasm_bindgen]
pub fn app_book_customization(host:JsValue,book:JsValue,fields:JsValue)->R<JsValue>{
 if Reflect::has(&fields,&"spineTitleOverride".into())?||Reflect::has(&fields,&"author".into())?{
  method(&read(&host,"readingExperience")?,"refreshNames",&[&read(&book,"id")?,&fields])?;
 }
 Ok(app_persist_book_state(host,read(&book,"id")?,fields).into())
}
