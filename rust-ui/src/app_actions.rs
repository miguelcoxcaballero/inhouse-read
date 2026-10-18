//! Shared root book actions. Native futures start synchronously until their
//! first await, preserving cancellation and selection-generation ownership.
use wasm_bindgen::{prelude::*,JsCast};
use js_sys::{Array,Object,Promise,Reflect};
use crate::host::{read,method,truthy,set};
use crate::cloud_host;
type R<T> = Result<T,JsValue>;
#[wasm_bindgen]
pub fn app_persist_book_state(host:JsValue,id:JsValue,fields:JsValue)->Promise{cloud_host::start(async move{
 cloud_host::settle(method(&read(&host,"progressWrites")?,"patch",&[&id,&fields])).await?;
 if read(&host,"onLocalBookChange")?.is_function(){method(&host,"onLocalBookChange",&[&id,&Object::keys(fields.unchecked_ref()).into()])?;}
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
 if read(&host,"onLocalBookChange")?.is_function(){method(&host,"onLocalBookChange",&[&read(&book,"id")?,&Array::of1(&"visible".into()).into()])?;}
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
  if read(&host,"onLocalBookChange")?.is_function(){method(&host,"onLocalBookChange",&[&id,&Array::of2(&"coverAppearance".into(),&"coverAppearanceKey".into()).into()])?;}
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

// Native book-placement/order callbacks. The host adapters only connect SDK
// Array.map callbacks to these decisions; arrays keep holes and custom methods.
#[wasm_bindgen]
pub fn app_placement_record(host:JsValue,row:JsValue)->R<JsValue>{
 let id=read(&row,"id")?;let source=read(&row,"shelfPosition")?;
 let position=crate::book_customization::book_shelf_position(source.clone())?;
 if truthy(&id)&&(truthy(&position)||source.is_null()){
  let entries=Array::new();cloud_host::data_entry(&entries,&"shelfPosition".into(),&position);
  let fields:JsValue=Object::from_entries(entries.as_ref())?.into();
  Ok(app_persist_book_state(host,id,fields).into())
 }else{Ok(Promise::resolve(&JsValue::UNDEFINED).into())}
}
#[wasm_bindgen]
pub fn app_order_record(host:JsValue,row:JsValue)->R<JsValue>{
 let id=read(&row,"id")?;let order=read(&row,"shelfOrder")?;let entries=Array::new();
 cloud_host::data_entry(&entries,&"shelfOrder".into(),&order);
 Ok(app_persist_book_state(host,id,Object::from_entries(entries.as_ref())?.into()).into())
}
fn mapped(host:&JsValue,rows:&JsValue,key:&str)->R<Promise>{
 let function=read(rows,"map")?;let callback=method(host,key,&[])?;
 let function=function.dyn_ref::<js_sys::Function>().ok_or_else(||js_sys::TypeError::new("map is not a function"))?;
 let values=function.call1(rows,&callback)?;Ok(Promise::all(values.unchecked_ref()))
}
#[wasm_bindgen]
pub fn app_placement_changed(host:JsValue,options:JsValue)->R<Promise>{
 let rows=read(&options,"books")?;let rows=if rows.is_undefined(){Array::new().into()}else{rows};
 mapped(&host,&rows,"placementMapper")
}
#[wasm_bindgen]
pub fn app_order_changed(host:JsValue,rows:JsValue)->R<Promise>{mapped(&host,&rows,"orderMapper")}
