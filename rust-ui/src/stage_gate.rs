//! Selection settlement, idle readiness and explicit open/cancel races.
use wasm_bindgen::{prelude::*,JsCast};
use js_sys::{Array,Function,Promise};
#[wasm_bindgen]
extern "C"{
 #[wasm_bindgen(extends=Promise)] type StagePromise;
 #[wasm_bindgen(method,js_name=then,catch)] fn chain(this:&StagePromise,yes:&JsValue,no:&JsValue)->Result<Promise,JsValue>;
}
type Handler=Closure<dyn FnMut(JsValue)->Result<JsValue,JsValue>>;
#[wasm_bindgen]
pub struct RustStageGate{released:Promise,settled:Promise,release:Function}
#[wasm_bindgen]
impl RustStageGate{
 #[wasm_bindgen(constructor)]
 pub fn new(settled:JsValue,idle:Function)->Result<Self,JsValue>{
  let mut release=None;let released=Promise::new(&mut|yes,_|release=Some(yes));
  let settled=if settled.is_null()||settled.is_undefined(){Promise::resolve(&JsValue::TRUE)}else{
   let handler:Handler=Closure::wrap(Box::new(move|ok:JsValue|{
    // An async handler returns a promise even on its early false branch.
    if !ok.is_truthy(){return Ok(Promise::resolve(&JsValue::FALSE).into())}
    let result=idle.call0(&JsValue::UNDEFINED);
    let promise=match result{Ok(value)=>Promise::resolve(&value),Err(error)=>return Ok(Promise::reject(&error).into())};
    let done=Closure::wrap(Box::new(move|_:JsValue|JsValue::TRUE)as Box<dyn FnMut(JsValue)->JsValue>);
    Ok(promise.unchecked_ref::<StagePromise>().chain(&done.into_js_value(),&JsValue::UNDEFINED)?.into())
   })as Box<dyn FnMut(JsValue)->Result<JsValue,JsValue>>);
   let failed=Closure::wrap(Box::new(move|_:JsValue|JsValue::FALSE)as Box<dyn FnMut(JsValue)->JsValue>);
   Promise::resolve(&settled).unchecked_ref::<StagePromise>().chain(&handler.into_js_value(),&failed.into_js_value())?
  };
  Ok(Self{released,settled,release:release.expect("Synchronous Promise executor")})
 }
 pub fn wait(&self)->Promise{let races=Array::new();races.push(&self.released);races.push(&self.settled);Promise::race(&races)}
 pub fn release(&self,reason:JsValue)->Result<(),JsValue>{self.release.call1(&JsValue::UNDEFINED,&JsValue::from_bool(reason==JsValue::from_str("open")))?;Ok(())}
}
