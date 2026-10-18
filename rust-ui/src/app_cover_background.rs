//! Background cover upgrades use GC-owned Promise callbacks. No native future
//! retains an entry/promise cycle while a browser decoder or storage waits.
use wasm_bindgen::prelude::*;
use js_sys::{Array,Object,Promise};
use crate::host::{read,set,method,truthy,absent,num,jmax};
use crate::cloud_host as c;
type R<T>=Result<T,JsValue>;
fn object(fields:&[(&str,JsValue)])->R<JsValue>{let entries=Array::new();for(k,v)in fields{c::data_entry(&entries,&(*k).into(),v);}Ok(Object::from_entries(entries.as_ref())?.into())}
fn opt(value:&JsValue,key:&str)->R<JsValue>{if absent(value){Ok(JsValue::UNDEFINED)}else{read(value,key)}}
fn current(host:&JsValue,flight:&JsValue)->R<bool>{
 let state=read(host,"state")?;let signal=read(&read(flight,"controller")?,"signal")?;
 if truthy(&read(&state,"appDisposed")?)||truthy(&read(&signal,"aborted")?){return Ok(false);}
 let closing=truthy(&read(&state,"closingReader")?);let id=read(&state,"currentBookId")?;let record=read(flight,"record")?;
 Ok((!closing&&read(&read(host,"reader")?,"epoch")?==read(flight,"epoch")?&&id==read(&record,"id")?)
  ||(truthy(&read(&read(flight,"entry")?,"retainedOnClose")?)&&(id.is_null()||(closing&&id==read(&record,"id")?))))
}
#[wasm_bindgen]
pub fn app_cover_bitmap_small(bitmap:JsValue)->R<bool>{
 let small=jmax(num(&read(&bitmap,"width")?),num(&read(&bitmap,"height")?))<800.0;
 method(&bitmap,"close",&[])?;Ok(small)
}
#[wasm_bindgen]
pub fn app_cover_bitmap_failed()->bool{false}
fn needs_upgrade(host:&JsValue,record:&JsValue)->R<JsValue>{
 if !truthy(&read(record,"cover")?){return Ok(Promise::resolve(&JsValue::TRUE).into());}
 let global=read(host,"global")?;
 if read(record,"format")?!=JsValue::from_str("PDF")||!read(&global,"createImageBitmap")?.is_function(){return Ok(Promise::resolve(&JsValue::FALSE).into());}
 // Only decoder/measurement failures are ignored. Errors from the earlier
 // record checks reject the async stage, like the original function.
 let measured=(||->R<JsValue>{
  let bitmap=method(&global,"createImageBitmap",&[&read(record,"cover")?])?;
  let task=method(Promise::resolve(&bitmap).as_ref(),"then",&[&read(host,"measureSmallCover")?])?;
  method(&task,"catch",&[&read(host,"coverBitmapFailed")?])
 })();
 match measured{Ok(task)=>Ok(task),Err(_)=>Ok(Promise::resolve(&JsValue::FALSE).into())}
}
#[wasm_bindgen]
pub fn app_cover_fetch(host:JsValue,flight:JsValue,needed:JsValue)->R<JsValue>{
 if !truthy(&needed)||!current(&host,&flight)?{return Ok(JsValue::NULL);}
 let mut fields=vec![("signal",read(&read(&flight,"controller")?,"signal")?)];
 if truthy(&read(&flight,"firstCover")?)&&read(&read(&flight,"record")?,"format")?==JsValue::from_str("PDF"){fields.push(("retainOnClose",JsValue::TRUE));}
 method(&read(&host,"reader")?,"getCoverBlob",&[&object(&fields)?])
}
#[wasm_bindgen]
pub fn app_cover_patch_allowed(host:JsValue,flight:JsValue,latest:JsValue)->R<bool>{
 if !current(&host,&flight)?{return Ok(false);}
 if !truthy(&read(&flight,"firstCover")?){return Ok(true);}
 if truthy(&read(&latest,"cover")?){return Ok(false);}
 let record=read(&flight,"record")?;
 Ok(!truthy(&read(&record,"contentRevision")?)||read(&latest,"contentRevision")?==read(&record,"contentRevision")?)
}
#[wasm_bindgen]
pub fn app_cover_persist(host:JsValue,flight:JsValue,blob:JsValue)->R<JsValue>{
 if !(num(&opt(&blob,"size")?)>0.0)||!current(&host,&flight)?{return Ok(JsValue::UNDEFINED);}
 let record=read(&flight,"record")?;let now=method(&host,"now",&[])?;
 let fields=object(&[("cover",blob),("coverUpdatedAt",now)])?;
 let settings=object(&[("ifCurrent",method(&host,"coverPatchGuard",&[&flight])?)])?;
 method(&read(&host,"library")?,"patch",&[&read(&record,"id")?,&fields,&settings])
}
#[wasm_bindgen]
pub fn app_cover_updated(host:JsValue,flight:JsValue,updated:JsValue)->R<()>{
 if truthy(&updated)&&current(&host,&flight)?{method(&host,"refreshShelf",&[])?;}Ok(())
}
#[wasm_bindgen]
pub fn app_cover_failed(host:JsValue,flight:JsValue,error:JsValue)->R<()>{
 if !truthy(&read(&read(&flight,"controller")?,"signal").and_then(|signal|read(&signal,"aborted"))?){method(&read(&host,"console")?,"warn",&[&"No se pudo extraer la portada:".into(),&error])?;}Ok(())
}
#[wasm_bindgen]
pub fn app_cover_finished(host:JsValue,flight:JsValue)->R<()>{
 let covers=read(&host,"coverUpgrades")?;let record=read(&flight,"record")?;
 if method(&covers,"get",&[&read(&record,"id")?])?==read(&flight,"entry")?{method(&covers,"delete",&[&read(&record,"id")?])?;}
 method(&host,"scheduleLibraryBackup",&[])?;Ok(())
}
#[wasm_bindgen]
pub fn app_extract_cover_background(host:JsValue,record:JsValue)->R<JsValue>{
 let state=read(&host,"state")?;
 if truthy(&read(&state,"closingReader")?)||read(&state,"currentBookId")?!=read(&record,"id")?{return Ok(Promise::resolve(&JsValue::UNDEFINED).into());}
 let epoch=read(&read(&host,"reader")?,"epoch")?;let covers=read(&host,"coverUpgrades")?;let previous=method(&covers,"get",&[&read(&record,"id")?])?;
 if opt(&previous,"epoch")?==epoch{return read(&previous,"promise");}
 let controller=c::construct("AbortController",&[])?;let first=JsValue::from_bool(!truthy(&read(&record,"cover")?));
 let entry=object(&[("epoch",epoch.clone()),("controller",controller.clone()),("firstCover",first.clone()),("retainedOnClose",JsValue::FALSE)])?;
 let flight=object(&[("record",record.clone()),("epoch",epoch),("controller",controller),("firstCover",first),("entry",entry.clone())])?;
 let callbacks=method(&host,"coverFlowCallbacks",&[&flight])?;
 let mut task:JsValue=match needs_upgrade(&host,&record){Ok(task)=>task,Err(error)=>Promise::reject(&error).into()};
 for key in ["fetch","persist","updated"]{task=method(&task,"then",&[&read(&callbacks,key)?])?;}
 task=method(&task,"catch",&[&read(&callbacks,"failed")?])?;
 task=method(&task,"finally",&[&read(&callbacks,"finish")?])?;
 set(&entry,"promise",&task)?;method(&covers,"set",&[&read(&record,"id")?,&entry])?;Ok(task)
}
