//! Drive fallback polling sleeps completely when no account/network/visible
//! page can use it. Host timers hold GC-owned callbacks; Rust owns eligibility,
//! cadence and generation checks, including queued callbacks after cancellation.
use wasm_bindgen::prelude::*;
use crate::host::{read,method,set,truthy,absent,num};
type R<T=()> = Result<T,JsValue>;
fn state(host:&JsValue)->R<JsValue>{read(host,"state")}
fn eligible(host:&JsValue)->R<bool>{
 if truthy(&read(&state(host)?,"appDisposed")?)||truthy(&read(&read(host,"document")?,"hidden")?)||!truthy(&method(host,"online",&[])?) {return Ok(false);}
 Ok(truthy(&method(host,"hasDriveSession",&[])?)||truthy(&method(host,"getRememberedDriveProfile",&[])?) )
}
#[wasm_bindgen]
pub fn app_drive_poll_update(host:&JsValue)->R{
 let state=state(host)?;let timer=read(&state,"drivePollTimer")?;
 if !eligible(host)?{
  if !absent(&timer){
   method(host,"cancelDrivePoll",&[&timer])?;
   set(&state,"drivePollTimer",&JsValue::NULL)?;
   set(&state,"drivePollGeneration",&(num(&read(&state,"drivePollGeneration")?)+1.0).into())?;
  }
 }else if absent(&timer){
  let generation=num(&read(&state,"drivePollGeneration")?)+1.0;
  set(&state,"drivePollGeneration",&generation.into())?;
  let timer=method(host,"armDrivePoll",&[&generation.into(),&5000.0.into()])?;
  set(&state,"drivePollTimer",&timer)?;
 }
 Ok(())
}
#[wasm_bindgen]
pub fn app_drive_poll_tick(host:&JsValue,generation:f64)->R{
 let state=state(host)?;
 if generation!=num(&read(&state,"drivePollGeneration")?)||absent(&read(&state,"drivePollTimer")?){return Ok(());}
 set(&state,"drivePollTimer",&JsValue::NULL)?;
 if !eligible(host)?{return Ok(());}
 let result=if truthy(&read(&read(host,"libraryBackup")?,"task")?){Ok(JsValue::UNDEFINED)}else{method(host,"pollDrive",&[])};
 // Preserve interval-style recovery if a synchronous poll callback throws.
 let rescheduled=app_drive_poll_update(host);
 result?;rescheduled
}
