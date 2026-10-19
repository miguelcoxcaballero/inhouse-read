//! App backup and live-room capture retries. SDK/storage calls and GC-owned
//! timer callbacks stay host bindings; queue state and sequencing live here.
use wasm_bindgen::prelude::*;
use js_sys::{Object,Promise};
use crate::host::{read,method,set,truthy,absent,num,set_timeout,clear_timeout};
use crate::cloud_host;
type R<T=()> = Result<T,JsValue>;
fn state(host:&JsValue)->R<JsValue>{read(host,"state")}
fn account(host:&JsValue)->R<JsValue>{let profile=read(&state(host)?,"driveProfile")?;if absent(&profile){Ok(JsValue::UNDEFINED)}else{read(&profile,"id")}}
#[wasm_bindgen]
pub fn app_backup_schedule(host:&JsValue)->R {
 let state=state(host)?;clear_timeout(&read(&state,"backupTimer")?)?;
 if !truthy(&method(host,"hasDriveSession",&[])?)&&!truthy(&method(host,"getRememberedDriveProfile",&[])?) {return Ok(());}
 let timer=set_timeout(&read(host,"backupCallback")?,350.0)?;set(&state,"backupTimer",&timer)
}
#[wasm_bindgen]
pub fn app_backup_run(host:JsValue)->Promise {cloud_host::start(async move {
 set(&state(&host)?,"backupTimer",&JsValue::NULL)?;
 let opts:JsValue=Object::new().into();set(&opts,"silent",&JsValue::TRUE)?;
 if let Err(error)=cloud_host::settle(method(&host,"syncLibraryToDrive",&[&opts])).await {method(&host,"backupFailure",&[&error])?;}
 Ok(JsValue::UNDEFINED)
})}
#[wasm_bindgen]
pub fn app_room_capture_schedule(host:&JsValue,delay:f64)->R {
 let state=state(host)?;set(&state,"roomCaptureAgain",&JsValue::TRUE)?;
 if truthy(&read(&state,"roomCaptureBusy")?)||!absent(&read(&state,"roomCaptureTimer")?)||!truthy(&account(host)?){return Ok(());}
 let timer=set_timeout(&read(host,"captureCallback")?,delay)?;set(&state,"roomCaptureTimer",&timer)
}
#[wasm_bindgen]
pub fn app_room_capture_run(host:JsValue)->Promise {cloud_host::start(async move {
 let state=state(&host)?;set(&state,"roomCaptureTimer",&JsValue::NULL)?;
 let account=account(&host)?;if !truthy(&account){return Ok(JsValue::UNDEFINED);}
 set(&state,"roomCaptureBusy",&JsValue::TRUE)?;set(&state,"roomCaptureAgain",&JsValue::FALSE)?;
 let result=async {
  cloud_host::settle(method(&host,"captureRoom",&[&account])).await?;
  cloud_host::settle(method(&host,"drainLive",&[&account])).await?;
  set(&state,"roomCaptureFailures",&0.0.into())
 }.await;
 let warned=if let Err(error)=result {
  let failures=num(&read(&state,"roomCaptureFailures")?)+1.0;
  set(&state,"roomCaptureFailures",&failures.into())?;set(&state,"roomCaptureAgain",&JsValue::TRUE)?;
  method(&host,"warnRoom",&[&error]).map(|_|())
 }else{Ok(())};
 // Exactly like finally: queue cleanup/rescheduling also runs if warning throws.
 set(&state,"roomCaptureBusy",&JsValue::FALSE)?;
 if truthy(&read(&state,"roomCaptureAgain")?) {
  let failures=num(&read(&state,"roomCaptureFailures")?);
  let delay=if failures!=0.0 {(250.0*2.0_f64.powf(failures.min(5.0))).min(10000.0)}else{32.0};
  app_room_capture_schedule(&host,delay)?;
 }
 warned?;Ok(JsValue::UNDEFINED)
})}
#[wasm_bindgen]
pub fn app_room_book_changed(host:&JsValue,id:JsValue,fields:JsValue)->R {
 let account=account(host)?;
 if truthy(&account)&&truthy(&method(host,"markBookChanged",&[&account,&id,&fields])?){app_room_capture_schedule(host,32.0)?;}
 Ok(())
}
