//! Keep room construction behind an Android inbox transfer and reader opening.
use std::cell::Cell;
use wasm_bindgen::prelude::*;
use js_sys::Function;
#[wasm_bindgen]
pub struct RustImportShelfGate{active:Cell<bool>,pending:Cell<bool>,reader:Function,refresh:Function}
#[wasm_bindgen]
impl RustImportShelfGate{
 #[wasm_bindgen(constructor)]
 pub fn new(active:bool,pending:bool,reader:Function,refresh:Function)->Self{Self{active:Cell::new(active),pending:Cell::new(pending),reader,refresh}}
 #[wasm_bindgen(js_name=setActive)]
 pub fn set_active(&self,value:JsValue)->Result<(),JsValue>{
  self.active.set(value.is_truthy());
  if self.active.get(){self.pending.set(true)}
  else if self.pending.get()&&!self.reader.call0(&JsValue::UNDEFINED)?.is_truthy(){self.pending.set(false);self.refresh.call0(&JsValue::UNDEFINED)?;}
  Ok(())
 }
 #[wasm_bindgen(js_name=deferRefresh)]
 pub fn defer_refresh(&self)->Result<bool,JsValue>{
  if self.active.get()||(self.pending.get()&&self.reader.call0(&JsValue::UNDEFINED)?.is_truthy()){return Ok(true)}
  self.pending.set(false);Ok(false)
 }
}
