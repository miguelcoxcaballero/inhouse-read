//! Cache ownership and prepared-page validity. Pixel/GPU references stay opaque.
use std::cell::{Cell,RefCell};
use wasm_bindgen::{prelude::*};
use js_sys::{Function,Object,Reflect,JSON};
#[wasm_bindgen]
extern "C"{
 #[wasm_bindgen(js_name=Object,catch)] fn boxed(value:&JsValue)->Result<JsValue,JsValue>;
 #[wasm_bindgen(js_name=Number,catch)] fn number(value:&JsValue)->Result<f64,JsValue>;
}
fn prop(value:&JsValue,key:&str)->Result<JsValue,JsValue>{if value.is_null()||value.is_undefined(){Ok(JsValue::UNDEFINED)}else{Reflect::get(&boxed(value)?,&key.into())}}
fn nullish(value:JsValue)->JsValue{if value.is_null()||value.is_undefined(){JsValue::NULL}else{value}}
fn json_same(a:JsValue,b:JsValue)->Result<bool,JsValue>{Ok(JSON::stringify(&nullish(a))?==JSON::stringify(&nullish(b))?)}
fn numeric(value:&JsValue)->Result<f64,JsValue>{let n=number(value)?;Ok(if n==0.0||n.is_nan(){0.0}else{n})}
fn finite(value:JsValue)->Option<f64>{value.as_f64().filter(|n|n.is_finite())}
fn reason(value:&str)->JsValue{value.into()}
fn mismatch(a:&JsValue,b:&JsValue,translation:bool)->Result<JsValue,JsValue>{
 if !a.is_truthy()||!b.is_truthy(){return Ok(reason("missing"))}
 for (key,why) in [("bookId","book"),("epoch","engine")]{if prop(a,key)?!=prop(b,key)?{return Ok(reason(why))}}
 if !json_same(prop(a,"locator")?,prop(b,"locator")?)?{return Ok(reason("saved-position"))}
 if !((numeric(&prop(a,"fraction")?)?-numeric(&prop(b,"fraction")?)?).abs()<=1e-9){return Ok(reason("saved-position"))}
 if !json_same(prop(a,"location")?,prop(b,"location")?)?{return Ok(reason("reader-position"))}
 for edge in ["left","top","width","height"]{
  if finite(prop(&prop(a,"viewport")?,edge)?).is_none()||finite(prop(&prop(b,"viewport")?,edge)?).is_none(){return Ok(reason("viewport"))}
  if translation&&(edge=="left"||edge=="top"){continue}
  if !((numeric(&prop(&prop(a,"viewport")?,edge)?)?-numeric(&prop(&prop(b,"viewport")?,edge)?)?).abs()<=0.5){return Ok(reason("viewport"))}
 }
 for (key,why) in [("pixelRatio","pixel-ratio"),("preferences","preferences"),("theme","theme"),("filter","filter")]{if prop(a,key)?!=prop(b,key)?{return Ok(reason(why))}}
 Ok(JsValue::NULL)
}
#[wasm_bindgen]
pub fn prepared_page_mismatch(a:JsValue,b:JsValue,translation:bool)->Result<JsValue,JsValue>{mismatch(&a,&b,translation)}
#[wasm_bindgen]
pub struct RustPreparedPageCache{generation:Cell<f64>,entry:RefCell<JsValue>,last_book:RefCell<JsValue>,last_discard:RefCell<JsValue>,rebase:Function}
impl RustPreparedPageCache{
 fn discard(&self,why:JsValue){if self.entry.borrow().is_truthy(){*self.last_discard.borrow_mut()=why}*self.entry.borrow_mut()=JsValue::NULL;}
}
#[wasm_bindgen]
impl RustPreparedPageCache{
 #[wasm_bindgen(constructor)]
 pub fn new(state:JsValue,rebase:Function)->Result<Self,JsValue>{Ok(Self{generation:Cell::new(prop(&state,"generation")?.as_f64().unwrap_or(0.0)),entry:RefCell::new(nullish(prop(&state,"entry")?)),last_book:RefCell::new(prop(&state,"lastBookId")?),last_discard:RefCell::new(prop(&state,"lastDiscard")?),rebase})}
 pub fn begin(&self,book:JsValue)->Result<JsValue,JsValue>{self.generation.set(self.generation.get()+1.0);self.discard(reason("new-work"));*self.last_book.borrow_mut()=book.clone();let ticket=Object::new();Reflect::set(&ticket,&"bookId".into(),&book)?;Reflect::set(&ticket,&"generation".into(),&self.generation.get().into())?;Ok(ticket.into())}
 #[wasm_bindgen(js_name=isCurrent)]
 pub fn is_current(&self,ticket:JsValue)->Result<bool,JsValue>{Ok(ticket.is_truthy()&&prop(&ticket,"generation")?==JsValue::from_f64(self.generation.get()))}
 pub fn store(&self,ticket:JsValue,key:JsValue,snapshot:JsValue)->Result<bool,JsValue>{
  if !self.is_current(ticket.clone())?||!snapshot.is_truthy()||prop(&ticket,"bookId")?!=prop(&key,"bookId")?{return Ok(false)}
  let entry=Object::new();Reflect::set(&entry,&"key".into(),&key)?;Reflect::set(&entry,&"snapshot".into(),&snapshot)?;*self.entry.borrow_mut()=entry.into();Ok(true)
 }
 pub fn take(&self,key:JsValue)->Result<JsValue,JsValue>{
  let held=self.entry.replace(JsValue::NULL);if !held.is_truthy(){return Ok(JsValue::NULL)}
  let held_key=prop(&held,"key")?;let why=mismatch(&held_key,&key,true)?;
  if why.is_truthy(){*self.last_discard.borrow_mut()=why;return Ok(JsValue::NULL)}
  let snapshot=prop(&held,"snapshot")?;let bounds=prop(&snapshot,"displayBounds")?;
  let dx=numeric(&prop(&prop(&key,"viewport")?,"left")?)?-numeric(&prop(&prop(&held_key,"viewport")?,"left")?)?;
  let dy=numeric(&prop(&prop(&key,"viewport")?,"top")?)?-numeric(&prop(&prop(&held_key,"viewport")?,"top")?)?;
  let valid=if !bounds.is_truthy(){false}else{let mut valid=true;for edge in ["left","top","width","height"]{if finite(prop(&bounds,edge)?).is_none(){valid=false;break}}valid};
  if !valid||!(numeric(&prop(&bounds,"width")?)?>0.0&&numeric(&prop(&bounds,"height")?)?>0.0)||!(numeric(&prop(&bounds,"left")?)?+dx).is_finite()||!(numeric(&prop(&bounds,"top")?)?+dy).is_finite(){*self.last_discard.borrow_mut()=reason("viewport");return Ok(JsValue::NULL)}
  if dx!=0.0||dy!=0.0{let destination=self.rebase.call3(&JsValue::UNDEFINED,&bounds,&JsValue::from_f64(numeric(&prop(&bounds,"left")?)?+dx),&JsValue::from_f64(numeric(&prop(&bounds,"top")?)?+dy))?;Reflect::set(&boxed(&snapshot)?,&"displayBounds".into(),&destination)?;}
  Ok(snapshot)
 }
 pub fn has(&self,book:JsValue)->Result<bool,JsValue>{let entry=self.entry.borrow().clone();Ok(prop(&prop(&entry,"key")?,"bookId")?==book)}
 pub fn peek(&self)->Result<JsValue,JsValue>{let entry=self.entry.borrow().clone();Ok(nullish(prop(&entry,"snapshot")?))}
 pub fn invalidate(&self,why:JsValue){self.generation.set(self.generation.get()+1.0);self.discard(why)}
 #[wasm_bindgen(js_name=invalidateBook)]
 pub fn invalidate_book(&self,book:JsValue,why:JsValue)->Result<(),JsValue>{if self.owns_book(book)?{self.invalidate(why)}Ok(())}
 #[wasm_bindgen(js_name=ownsBook)]
 pub fn owns_book(&self,book:JsValue)->Result<bool,JsValue>{Ok(self.has(book.clone())?||*self.last_book.borrow()==book)}
 #[wasm_bindgen(getter,js_name=lastDiscard)]
 pub fn last_discard(&self)->JsValue{self.last_discard.borrow().clone()}
}
