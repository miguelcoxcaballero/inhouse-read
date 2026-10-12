//! Serialize reader actions and invalidate obsolete work without blocking a
//! newly opened book behind an old persistence or pagination operation.
use std::{cell::{Cell,RefCell},rc::Rc};
use wasm_bindgen::prelude::*;
use wasm_bindgen_futures::{future_to_promise,JsFuture};
use js_sys::{Function,Promise};
struct Queue{generation:Cell<f64>,navigating:Cell<bool>,tail:RefCell<Promise>}
#[wasm_bindgen]
pub struct RustReaderNavigation{queue:Rc<Queue>}
fn current(queue:&Queue,generation:f64,validate:&Function)->Result<bool,JsValue>{
 if queue.generation.get()!=generation{return Ok(false);}Ok(validate.call0(&JsValue::UNDEFINED)?.is_truthy())
}
#[wasm_bindgen]
impl RustReaderNavigation{
 #[wasm_bindgen(constructor)]
 pub fn new()->Self{Self{queue:Rc::new(Queue{generation:Cell::new(0.0),navigating:Cell::new(false),tail:RefCell::new(Promise::resolve(&JsValue::UNDEFINED))})}}
 #[wasm_bindgen(getter)]pub fn generation(&self)->f64{self.queue.generation.get()}
 #[wasm_bindgen(getter)]pub fn navigating(&self)->bool{self.queue.navigating.get()}
 pub fn cancel(&self){self.queue.generation.set(self.queue.generation.get()+1.0);self.queue.navigating.set(false);*self.queue.tail.borrow_mut()=Promise::resolve(&JsValue::UNDEFINED);}
 pub fn enqueue(&self,action:Function,validate:Function)->Promise{
  let queue=self.queue.clone();let generation=queue.generation.get();let previous=queue.tail.borrow().clone();
  let promise=future_to_promise(async move{
   // A failed action does not discard a link/page turn queued behind it.
   let _=JsFuture::from(previous).await;
   if !current(&queue,generation,&validate)?{return Ok(JsValue::UNDEFINED);}
   queue.navigating.set(true);
   let outcome=match action.call1(&JsValue::UNDEFINED,&validate){Ok(value)=>JsFuture::from(Promise::resolve(&value)).await,Err(error)=>Err(error)};
   if current(&queue,generation,&validate)?{queue.navigating.set(false);}
   outcome
  });
  *self.queue.tail.borrow_mut()=promise.clone();promise
 }
}
impl Drop for RustReaderNavigation{fn drop(&mut self){self.cancel();}}
