//! One in-flight GPU frame per book animation. A zero-time fence poll leaves input and the
//! compositor free while a slow driver finishes that frame. Missing or lost contexts retain the
//! existing RAF path; there is no finish or readback. The WebGL context and its sync objects stay
//! host objects.
use std::cell::{Cell,RefCell};
use wasm_bindgen::prelude::*;
use crate::host::*;

#[wasm_bindgen]
pub struct AnimationFrameFence{gl:JsValue,sync:RefCell<Option<JsValue>>,usable:Cell<bool>}

/// `typeof gl?.[name] === 'function'`.
fn is_function(gl:&JsValue,name:&str)->Result<bool,JsValue>{if absent(gl){Ok(false)}else{Ok(read(gl,name)?.is_function())}}

#[wasm_bindgen]
impl AnimationFrameFence{
 #[wasm_bindgen(constructor)]
 pub fn new(gl:JsValue)->Result<AnimationFrameFence,JsValue>{
  let mut usable=true;
  for name in ["fenceSync","clientWaitSync","deleteSync","flush"]{if !is_function(&gl,name)?{usable=false;break;}}
  Ok(AnimationFrameFence{gl,sync:RefCell::new(None),usable:Cell::new(usable)})
 }
 /// Delete the pending fence, if there is one; a driver that refuses retires the fence path.
 pub fn dispose(&self){
  let previous=self.sync.borrow_mut().take();
  if let Some(previous)=previous{if method(&self.gl,"deleteSync",&[&previous]).is_err(){self.usable.set(false);}}
 }
 /// Whether the frame in flight has finished (or nothing is in flight).
 pub fn ready(&self)->bool{
  if self.sync.borrow().is_none(){return true;}
  let verdict=(||->Result<Option<bool>,JsValue>{
   if truthy(&method_opt(&self.gl,"isContextLost",&[])?.unwrap_or(JsValue::UNDEFINED)){self.dispose();self.usable.set(false);return Ok(Some(true));}
   let sync=self.sync.borrow().clone().unwrap_or(JsValue::UNDEFINED);
   let status=method(&self.gl,"clientWaitSync",&[&sync,&JsValue::from_f64(0.0),&JsValue::from_f64(0.0)])?;
   if status==read(&self.gl,"TIMEOUT_EXPIRED")?{return Ok(Some(false));}
   if status!=read(&self.gl,"ALREADY_SIGNALED")?&&status!=read(&self.gl,"CONDITION_SATISFIED")?{self.usable.set(false);}
   Ok(None)
  })();
  match verdict{
   Ok(Some(answer))=>return answer,
   Ok(None)=>{}
   Err(_)=>self.usable.set(false),
  }
  self.dispose();true
 }
 /// Fence the commands submitted so far and flush them, unless the path was retired.
 pub fn submit(&self){
  if !self.usable.get(){return;}
  self.dispose();
  let outcome=(||->Result<(),JsValue>{
   let sync=method(&self.gl,"fenceSync",&[&read(&self.gl,"SYNC_GPU_COMMANDS_COMPLETE")?,&JsValue::from_f64(0.0)])?;
   // A falsy sync is no fence at all.
   let made=truthy(&sync);
   *self.sync.borrow_mut()=if made{Some(sync)}else{None};
   if made{method(&self.gl,"flush",&[])?;}else{self.usable.set(false);}
   Ok(())
  })();
  if outcome.is_err(){self.dispose();self.usable.set(false);}
 }
}
