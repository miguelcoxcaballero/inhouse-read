//! Plumbing shared by the cloud and library ports: dynamic property access, method calls,
//! errors with causes, Promise awaiting and the few JavaScript semantics (`Number`, `??`,
//! `JSON.stringify`) the ported code relies on. Every JavaScript API stays the browser's own.
use wasm_bindgen::{prelude::*,JsCast};
use js_sys::{Array,Function,Object,Promise,Reflect};
use wasm_bindgen_futures::JsFuture;

#[wasm_bindgen]
extern "C"{
 #[wasm_bindgen(js_name=Number)]fn js_number(value:&JsValue)->f64;
 #[wasm_bindgen(js_name=String)]fn js_string(value:&JsValue)->String;
 #[wasm_bindgen(js_name=Object)]fn js_object(value:&JsValue)->JsValue;
 #[wasm_bindgen(js_name=setTimeout)]fn js_set_timeout(handler:&Function,delay:f64)->JsValue;
 #[wasm_bindgen(js_name=clearTimeout)]fn js_clear_timeout(id:&JsValue);
 #[wasm_bindgen(js_namespace=JSON,js_name=stringify,catch)]fn js_stringify(value:&JsValue)->Result<JsValue,JsValue>;
 #[wasm_bindgen(js_namespace=JSON,js_name=parse,catch)]fn js_parse(value:&JsValue)->Result<JsValue,JsValue>;
}

/// `value[key]` for objects and, as in JavaScript, for primitives (`"text".length`).
pub fn read(value:&JsValue,key:&str)->Result<JsValue,JsValue>{
 if nullish(value){return Err(js_sys::TypeError::new(&format!("Cannot read properties of {} (reading '{key}')",if value.is_null(){"null"}else{"undefined"})).into());}
 if value.is_object()||value.is_function(){Reflect::get(value,&key.into())}else{Reflect::get(&js_object(value),&key.into())}
}
/// `value?.[key]`, `undefined` where the read would throw.
pub fn get(value:&JsValue,key:&str)->JsValue{read(value,key).unwrap_or(JsValue::UNDEFINED)}
pub fn set(target:&JsValue,key:&str,value:&JsValue){let _=Reflect::set(target,&key.into(),value);}
pub fn object(entries:&[(&str,JsValue)])->JsValue{let object=Object::new();for(key,value)in entries{let _=Reflect::set(&object,&(*key).into(),value);}object.into()}
pub fn global()->JsValue{js_sys::global().into()}
pub fn nullish(value:&JsValue)->bool{value.is_null()||value.is_undefined()}
/// `Number(value)`.
pub fn number(value:&JsValue)->f64{js_number(value)}
/// `Number(value) || 0`.
pub fn number_or_zero(value:&JsValue)->f64{let number=js_number(value);if number.is_nan(){0.0}else{number}}
/// `String(value)`.
pub fn string(value:&JsValue)->String{js_string(value)}
/// `JSON.stringify(value ?? null)`.
pub fn json(value:&JsValue)->Result<String,JsValue>{
 let value=if nullish(value){JsValue::NULL}else{value.clone()};
 Ok(js_stringify(&value)?.as_string().unwrap_or_default())
}
/// `JSON.stringify(value)`, `None` where the result is `undefined`.
pub fn stringify(value:&JsValue)->Result<Option<String>,JsValue>{Ok(js_stringify(value)?.as_string())}
pub fn error(message:&str)->JsValue{js_sys::Error::new(message).into()}
pub fn error_with_cause(message:&str,cause:JsValue)->JsValue{
 let options=Object::new();let _=Reflect::set(&options,&"cause".into(),&cause);js_sys::Error::new_with_options(message,&options).into()
}
pub fn error_with_code(message:&str,code:&str)->JsValue{let error=js_sys::Error::new(message);let _=Reflect::set(&error,&"code".into(),&code.into());error.into()}
/// The `message` of a thrown value, as `error.message` reads it.
pub fn message(error:&JsValue)->String{string(&get(error,"message"))}
pub fn function(value:&JsValue,name:&str)->Result<Function,JsValue>{value.dyn_ref::<Function>().cloned().ok_or_else(||error(&format!("Missing host function {name}")))}
/// `target[name](...args)`.
pub fn call(target:&JsValue,name:&str,args:&[&JsValue])->Result<JsValue,JsValue>{
 let method=function(&read(target,name)?,name)?;let list=Array::new();for argument in args{list.push(argument);}method.apply(target,&list)
}
/// `function(...args)` with `this` undefined.
pub fn invoke(function:&Function,args:&[&JsValue])->Result<JsValue,JsValue>{
 let list=Array::new();for argument in args{list.push(argument);}function.apply(&JsValue::UNDEFINED,&list)
}
/// `await value`, whether or not it is a thenable.
pub async fn settle(value:Result<JsValue,JsValue>)->Result<JsValue,JsValue>{JsFuture::from(Promise::resolve(&value?)).await}
/// `await target[name](...args)`.
pub async fn call_async(target:&JsValue,name:&str,args:&[&JsValue])->Result<JsValue,JsValue>{settle(call(target,name,args)).await}
/// A Promise resolving after the next macrotask-free turn (`await null`).
pub async fn tick()->Result<(),JsValue>{JsFuture::from(Promise::resolve(&JsValue::UNDEFINED)).await.map(|_|())}
pub fn to_promise(future:impl std::future::Future<Output=Result<JsValue,JsValue>>+'static)->Promise{wasm_bindgen_futures::future_to_promise(future)}
/// The Promise of an `async` function: like JavaScript, the body runs synchronously up to its
/// first `await` and carries on from the microtask queue after that.
pub fn start(future:impl std::future::Future<Output=Result<JsValue,JsValue>>+'static)->Promise{
 use std::{pin::Pin,task::{Context,Poll,Waker}};
 let mut callbacks=None;let promise=Promise::new(&mut|resolve,reject|{callbacks=Some((resolve,reject));});
 let (resolve,reject)=callbacks.expect("Promise executors run synchronously");
 let settle=move|result:Result<JsValue,JsValue>|{let _=match result{Ok(value)=>resolve.call1(&JsValue::UNDEFINED,&value),Err(error)=>reject.call1(&JsValue::UNDEFINED,&error)};};
 let mut future:Pin<Box<dyn std::future::Future<Output=Result<JsValue,JsValue>>>>=Box::pin(future);
 // A task spawned below is polled once more by the executor, which registers the real waker.
 match future.as_mut().poll(&mut Context::from_waker(Waker::noop())){
  Poll::Ready(result)=>settle(result),
  Poll::Pending=>wasm_bindgen_futures::spawn_local(async move{settle(future.await);})
 }
 promise
}
/// First truthy of the two, as `a || b`.
pub fn or(a:JsValue,b:JsValue)->JsValue{if a.is_truthy(){a}else{b}}
/// Timers whose closures live exactly as long as the timer can still fire; ids are numbers.
#[derive(Default)]
pub struct Timers{next:std::cell::Cell<u32>,running:std::cell::Cell<u32>,
 live:std::cell::RefCell<std::collections::HashMap<u32,(JsValue,Closure<dyn FnMut()>)>>,fired:std::cell::RefCell<Vec<Closure<dyn FnMut()>>>}
impl Timers{
 /// A closure that has fired is released later, never while its own code is on the stack.
 fn release_fired(&self){if self.running.get()==0{let spent=std::mem::take(&mut *self.fired.borrow_mut());drop(spent);}}
 pub fn start(self:&std::rc::Rc<Self>,delay:f64,callback:impl FnOnce()+'static)->u32{
  self.release_fired();
  let seq=self.next.get().wrapping_add(1);self.next.set(seq);
  let owner=self.clone();let mut callback=Some(callback);
  let closure=Closure::wrap(Box::new(move||{
   let taken=owner.live.borrow_mut().remove(&seq);
   if let Some((_,closure))=taken{owner.fired.borrow_mut().push(closure);}
   owner.running.set(owner.running.get()+1);
   if let Some(callback)=callback.take(){callback();}
   owner.running.set(owner.running.get()-1);
  })as Box<dyn FnMut()>);
  let id=js_set_timeout(closure.as_ref().unchecked_ref(),delay);
  self.live.borrow_mut().insert(seq,(id,closure));seq
 }
 pub fn clear(&self,seq:u32){
  self.release_fired();
  let taken=self.live.borrow_mut().remove(&seq);
  if let Some((id,_closure))=taken{js_clear_timeout(&id);}
 }
 pub fn clear_all(&self){
  self.release_fired();
  let all:Vec<_>=self.live.borrow_mut().drain().collect();
  for (_,(id,_closure)) in all{js_clear_timeout(&id);}
 }
}
/// `new globalThis[name](...args)`.
pub fn construct(name:&str,args:&[&JsValue])->Result<JsValue,JsValue>{
 let constructor=function(&read(&global(),name)?,name)?;let list=Array::new();for argument in args{list.push(argument);}
 Reflect::construct(&constructor,&list)
}
/// `Object.assign(target, source)` for the one-level spreads of the original code.
pub fn assign(target:&JsValue,source:&JsValue)->Result<(),JsValue>{
 if nullish(source){return Ok(());}
 let object=target.dyn_ref::<Object>().ok_or_else(||error("assign needs an object"))?;Object::assign(object,&Object::from(source.clone()));Ok(())
}
/// `JSON.parse(value)`, the value coerced to text as the original did.
pub fn parse(value:&JsValue)->Result<JsValue,JsValue>{js_parse(value)}
/// `Object.entries(value)`, with the keys as text.
pub fn entries(value:&JsValue)->Vec<(String,JsValue)>{
 let value=if value.is_object()||value.is_function(){value.clone()}else{js_object(value)};
 Object::entries(value.unchecked_ref::<Object>()).iter().map(|pair|{let pair=Array::from(&pair);(string(&pair.get(0)),pair.get(1))}).collect()
}
/// `delete target[key]`.
pub fn delete(target:&JsValue,key:&str){if let Some(object)=target.dyn_ref::<Object>(){let _=Reflect::delete_property(object,&key.into());}}
/// `Object.hasOwn(target, key)`.
pub fn has_own(target:&JsValue,key:&str)->bool{
 let value=if target.is_object()||target.is_function(){target.clone()}else{js_object(target)};
 Object::has_own(value.unchecked_ref::<Object>(),&key.into())
}

/// Append JavaScript CopyDataProperties as ordered entries. Object.fromEntries
/// then creates own data fields (including symbols and __proto__) without invoking setters.
pub fn data_entry(entries:&Array,key:&JsValue,value:&JsValue){
 let pair=Array::new();pair.push(key);pair.push(value);entries.push(&pair);
}
pub fn copy_data_entries(entries:&Array,source:&JsValue)->Result<(),JsValue>{
 if nullish(source){return Ok(());}
 let source=crate::host::boxed(source);
 for key in Reflect::own_keys(&source)?.iter(){
  let descriptor=Reflect::get_own_property_descriptor(source.unchecked_ref::<Object>(),&key)?;
  if !nullish(&descriptor)&&read(&descriptor,"enumerable")?.is_truthy(){
   data_entry(entries,&key,&Reflect::get(&source,&key)?);
  }
 }Ok(())
}
