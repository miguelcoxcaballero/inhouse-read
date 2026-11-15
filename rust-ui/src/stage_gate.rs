//! Selection settlement, idle readiness and explicit open/cancel races.
//!
//! Holds the heavy page work back until it can no longer disturb the pull-out animation. `settled`
//! resolves true once the lifted book sits still (false when the selection was cancelled); the work then
//! waits for an idle slice. An open request (`release("open")`) lets it go at once, because somebody is
//! waiting for the result; any other release (the selection was dismissed or replaced) ends the wait
//! without work. `wait` resolves true to proceed, false to skip.
//!
//! A gate is a plain record of the page (released, settled, release). Its promise handlers are the two
//! functions this module makes once, bound by the page to the gate's idle callback or to an answer: the
//! page owns every bound function and what it holds, so a gate keeps nothing of this module alive and
//! nothing of the page is kept here, however its promises end.
use std::cell::RefCell;
use wasm_bindgen::{prelude::*,JsCast};
use js_sys::{Array,Function,Object,Promise,Reflect};
use crate::host::read;
#[wasm_bindgen]
extern "C"{
 #[wasm_bindgen(extends=Promise)] type StagePromise;
 #[wasm_bindgen(method,js_name=then,catch)] fn chain(this:&StagePromise,yes:&JsValue,no:&JsValue)->Result<Promise,JsValue>;
}
type Step=Closure<dyn FnMut(JsValue,JsValue)->Result<JsValue,JsValue>>;
thread_local!{static STEPS:RefCell<Option<(Function,Function)>>=const{RefCell::new(None)};}
/// `(idle, ok)`: the settled selection waits for an idle slice; `(answer, _)`: that answer.
fn steps()->(Function,Function){
 STEPS.with(|made|made.borrow_mut().get_or_insert_with(||{
  let stage:Step=Closure::wrap(Box::new(|idle:JsValue,ok:JsValue|{
   // An async handler returns a promise even on its early false branch.
   if !ok.is_truthy(){return Ok(Promise::resolve(&JsValue::FALSE).into())}
   let promise=match idle.unchecked_ref::<Function>().call0(&JsValue::UNDEFINED){Ok(value)=>Promise::resolve(&value),Err(error)=>return Ok(Promise::reject(&error).into())};
   Ok(promise.unchecked_ref::<StagePromise>().chain(&steps().1.bind1(&JsValue::UNDEFINED,&JsValue::TRUE),&JsValue::UNDEFINED)?.into())
  }));
  let answer:Step=Closure::wrap(Box::new(|answer:JsValue,_:JsValue|Ok(answer)));
  (stage.into_js_value().unchecked_into(),answer.into_js_value().unchecked_into())
 }).clone())
}
#[inline(never)]
pub fn open(settled:JsValue,idle:JsValue)->Result<JsValue,JsValue>{
 let mut release=None;let released=Promise::new(&mut|yes,_|release=Some(yes));
 // No signal from the shelf (a book opened some other way): nothing to wait for.
 let settled=if settled.is_null()||settled.is_undefined(){Promise::resolve(&JsValue::TRUE)}else{
  let (stage,answer)=steps();
  Promise::resolve(&settled).unchecked_ref::<StagePromise>().chain(&stage.bind1(&JsValue::UNDEFINED,&idle),&answer.bind1(&JsValue::UNDEFINED,&JsValue::FALSE))?
 };
 let gate=Object::new();
 Reflect::set(&gate,&"released".into(),&released)?;Reflect::set(&gate,&"settled".into(),&settled)?;
 Reflect::set(&gate,&"release".into(),&release.expect("Synchronous Promise executor"))?;
 Ok(gate.into())
}
#[inline(never)]
pub fn wait(gate:&JsValue)->Result<Promise,JsValue>{
 let races=Array::new();races.push(&read(gate,"released")?);races.push(&read(gate,"settled")?);Ok(Promise::race(&races))
}
#[inline(never)]
pub fn release(gate:&JsValue,reason:&JsValue)->Result<(),JsValue>{
 read(gate,"release")?.unchecked_into::<Function>().call1(&JsValue::UNDEFINED,&JsValue::from_bool(*reason==JsValue::from_str("open")))?;Ok(())
}
