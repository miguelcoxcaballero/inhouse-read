//! Private drag policy for the placement preview. Small shelves and the first moves retain the
//! direct implementation. Preparing an owned session is paid only when an eligible gesture
//! continues. The owner invalidates this controller when its input changes. The objects, options,
//! session and both implementations are host values; this decides which of them answers.
use std::cell::{Cell,RefCell};
use wasm_bindgen::prelude::*;
use js_sys::{Array,Object};
use crate::host::*;

/// `session?.name(...args)` for a session that exists: a missing method fails with the engine's message.
fn optional_method(session:&JsValue,name:&str,args:&[&JsValue])->Result<JsValue,JsValue>{
 if !read(session,name)?.is_function(){return Err(js_sys::TypeError::new(&format!("session?.{name} is not a function")).into());}
 method(session,name,args)
}

#[wasm_bindgen]
pub struct ShelfPlacementPreview{
 objects:RefCell<JsValue>,options:RefCell<JsValue>,session:RefCell<JsValue>,
 make_session:JsValue,direct:JsValue,minimum_objects:f64,direct_moves:f64,
 moves:Cell<f64>,prepared:Cell<bool>,disposed:Cell<bool>,
}

#[wasm_bindgen]
impl ShelfPlacementPreview{
 /// `make_session(objects, options)` prepares an owned session (or answers `null`);
 /// `direct(objects, key, { shelf, x }, options)` is the unchanged one-shot implementation.
 #[wasm_bindgen(constructor)]
 pub fn new(objects:JsValue,options:JsValue,make_session:JsValue,direct:JsValue,minimum_objects:f64,direct_moves:f64)->ShelfPlacementPreview{
  ShelfPlacementPreview{objects:RefCell::new(objects),options:RefCell::new(options),session:RefCell::new(JsValue::NULL),
   make_session,direct,minimum_objects,direct_moves,moves:Cell::new(0.0),prepared:Cell::new(false),disposed:Cell::new(false)}
 }
 #[wasm_bindgen(js_name=move)]
 pub fn move_to(&self,core:&JsValue,key:&JsValue,shelf:&JsValue,x:&JsValue)->Result<JsValue,JsValue>{
  if self.disposed.get(){return Ok(JsValue::UNDEFINED);}
  self.moves.set(self.moves.get()+1.0);
  let objects=self.objects.borrow().clone();
  if Array::is_array(&objects)&&num(&read(&objects,"length")?)>=self.minimum_objects&&self.moves.get()>self.direct_moves&&truthy(core){
   if !self.prepared.get(){
    self.prepared.set(true);
    let options=self.options.borrow().clone();
    let session=call(&self.make_session,"createShelfPlacementSession",&[&objects,&options])?;
    *self.session.borrow_mut()=session;
   }
   // session?.move(core, key, shelf, x)
   let session=self.session.borrow().clone();
   let result=if absent(&session){JsValue::UNDEFINED}else{optional_method(&session,"move",&[core,key,shelf,x])?};
   if self.disposed.get(){return Ok(JsValue::UNDEFINED);}
   if !result.is_undefined(){return Ok(result);}
  }
  let target=Object::new();set(&target,"shelf",shelf)?;set(&target,"x",x)?;
  let (objects,options)=(self.objects.borrow().clone(),self.options.borrow().clone());
  let result=call(&self.direct,"moveShelfDecoration",&[&objects,key,&target,&options])?;
  Ok(if self.disposed.get(){JsValue::UNDEFINED}else{result})
 }
 pub fn dispose(&self)->Result<(),JsValue>{
  self.disposed.set(true);
  let session=self.session.borrow().clone();
  if !absent(&session){optional_method(&session,"dispose",&[])?;}
  *self.session.borrow_mut()=JsValue::NULL;
  *self.objects.borrow_mut()=JsValue::NULL;*self.options.borrow_mut()=JsValue::NULL;
  Ok(())
 }
}
