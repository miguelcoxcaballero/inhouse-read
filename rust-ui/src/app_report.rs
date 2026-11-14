//! What the app only reports or lets pass: the handlers given to `promise.catch` and the console's warnings.
//! These were one-line functions on app.js's host objects (`warnPreparation`, `ignoreCloseError`, ...).
//! Each handler is made once per page and never dropped, like the function expression it replaces; it is an
//! `Fn`, so a console that throws leaves it callable.
use std::cell::RefCell;
use js_sys::Function;
use wasm_bindgen::prelude::*;
use wasm_bindgen::JsCast;
use crate::host::{get,global,method};
type R<T>=Result<T,JsValue>;
thread_local!{
 static IGNORE:Function=Closure::<dyn Fn()>::new(||{}).into_js_value().unchecked_into();
 static WARNERS:RefCell<Vec<(&'static str,Function)>>=const{RefCell::new(Vec::new())};
}
/// `console.warn(label, value)` with the page's console as it is when called; what it throws is returned.
pub fn warn(label:&str,value:&JsValue)->R<()>{method(&get(&global(),"console"),"warn",&[&label.into(),value]).map(|_|())}
/// `() => {}`.
pub fn ignore()->JsValue{IGNORE.with(|function|function.clone().into())}
/// `error => console.warn(label, error)`.
pub fn warner(label:&'static str)->JsValue{
 WARNERS.with(|warners|{
  if let Some((_,function))=warners.borrow().iter().find(|(known,_)|*known==label){return function.clone().into();}
  let function:Function=Closure::<dyn Fn(JsValue)->R<()>>::new(move|error:JsValue|warn(label,&error)).into_js_value().unchecked_into();
  warners.borrow_mut().push((label,function.clone()));function.into()
 })
}
