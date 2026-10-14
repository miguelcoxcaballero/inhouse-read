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
 #[wasm_bindgen(js_name=setTimeout)]fn js_set_timeout(handler:&Function,delay:f64)->JsValue;
 #[wasm_bindgen(js_name=clearTimeout)]fn js_clear_timeout(id:&JsValue);
 #[wasm_bindgen(js_namespace=JSON,js_name=stringify,catch)]fn js_stringify(value:&JsValue)->Result<JsValue,JsValue>;
}

pub fn get(value:&JsValue,key:&str)->JsValue{Reflect::get(value,&key.into()).unwrap_or(JsValue::UNDEFINED)}
/// `value[key]`, with the exception a getter or a Proxy would throw.
pub fn read(value:&JsValue,key:&str)->Result<JsValue,JsValue>{Reflect::get(value,&key.into())}
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
/// One timer: the closure lives exactly as long as the timer can still fire.
pub struct Timer{id:JsValue,_callback:Closure<dyn FnMut()>}
impl Timer{
 pub fn start(delay:f64,callback:impl FnMut()+'static)->Timer{
  let callback=Closure::wrap(Box::new(callback) as Box<dyn FnMut()>);
  let id=js_set_timeout(callback.as_ref().unchecked_ref(),delay);Timer{id,_callback:callback}
 }
 pub fn clear(&self){js_clear_timeout(&self.id);}
}
/// `new globalThis[name](...args)`.
pub fn construct(name:&str,args:&[&JsValue])->Result<JsValue,JsValue>{
 let constructor=function(&read(&global(),name)?,name)?;let list=Array::new();for argument in args{list.push(argument);}
 Reflect::construct(&constructor,&list)
}
/// `Object.assign(target, source)` for the one-level spreads of the original code.
pub fn assign(target:&JsValue,source:&JsValue)->Result<(),JsValue>{
 let object=target.dyn_ref::<Object>().ok_or_else(||error("assign needs an object"))?;Object::assign(object,source.unchecked_ref::<Object>());Ok(())
}
