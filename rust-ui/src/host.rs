//! Browser primitives for pointer state machines: property access, optional calls,
//! the global timers/frames/clock (looked up at call time, as the bare names were)
//! and JavaScript's own Math rounding (exp, hypot) which stays in the host.
use std::cell::{Cell,RefCell};
use wasm_bindgen::{prelude::*,JsCast};
use js_sys::{Array,Function,Object,Reflect};

#[wasm_bindgen]
extern "C"{#[wasm_bindgen(js_name=Number)]fn to_number(value:&JsValue)->f64;}

/// Primitives have properties too (`"x".length`); Reflect.get wants an object.
fn boxed(value:&JsValue)->JsValue{if value.is_object()||value.is_function(){value.clone()}else{Object::from(value.clone()).into()}}
pub fn get(value:&JsValue,key:&str)->JsValue{if absent(value){return JsValue::UNDEFINED;}Reflect::get(&boxed(value),&JsValue::from_str(key)).unwrap_or(JsValue::UNDEFINED)}
/// `value[key]`, throwing like the engine for null/undefined or a failing getter.
pub fn read(value:&JsValue,key:&str)->Result<JsValue,JsValue>{
 if absent(value){return Err(js_sys::TypeError::new(&format!("Cannot read properties of {} (reading '{key}')",if value.is_null(){"null"}else{"undefined"})).into());}
 Reflect::get(&boxed(value),&JsValue::from_str(key))
}
pub fn get_at(value:&JsValue,index:u32)->JsValue{if absent(value){return JsValue::UNDEFINED;}Reflect::get(&boxed(value),&JsValue::from_f64(f64::from(index))).unwrap_or(JsValue::UNDEFINED)}
pub fn set(value:&JsValue,key:&str,next:&JsValue)->Result<(),JsValue>{Reflect::set(value,&JsValue::from_str(key),next)?;Ok(())}
pub fn absent(value:&JsValue)->bool{value.is_null()||value.is_undefined()}
pub fn truthy(value:&JsValue)->bool{value.is_truthy()}
/// `Number(value)` without allocating for the ordinary case.
pub fn num(value:&JsValue)->f64{match value.as_f64(){Some(number)=>number,None=>to_number(value)}}
pub fn text(value:&JsValue,expected:&str)->bool{value.as_string().is_some_and(|text|text==expected)}
fn not_a_function(name:&str)->JsValue{js_sys::TypeError::new(&format!("{name} is not a function")).into()}
/// `value(...args)` with `this` undefined.
pub fn call(value:&JsValue,name:&str,args:&[&JsValue])->Result<JsValue,JsValue>{
 let function=value.dyn_ref::<Function>().ok_or_else(||not_a_function(name))?;
 apply(function,&JsValue::UNDEFINED,args)
}
fn apply(function:&Function,this:&JsValue,args:&[&JsValue])->Result<JsValue,JsValue>{
 match args{
  []=>function.call0(this),[a]=>function.call1(this,a),[a,b]=>function.call2(this,a,b),
  _=>{let list=Array::new();for argument in args{list.push(argument);}function.apply(this,&list)}
 }
}
/// `value?.(...args)`: nothing happens for null or undefined, anything else must be callable.
pub fn call_opt(value:&JsValue,name:&str,args:&[&JsValue])->Result<JsValue,JsValue>{if absent(value){Ok(JsValue::UNDEFINED)}else{call(value,name,args)}}
/// `target.name(...args)`, failing like a missing method.
pub fn method(target:&JsValue,name:&str,args:&[&JsValue])->Result<JsValue,JsValue>{
 let function=read(target,name)?;
 let function=function.dyn_ref::<Function>().ok_or_else(||not_a_function(name))?;
 apply(function,target,args)
}
/// `target?.name?.(...args)`: absent target or method yield `None`.
pub fn method_opt(target:&JsValue,name:&str,args:&[&JsValue])->Result<Option<JsValue>,JsValue>{
 if absent(target){return Ok(None);}
 let function=read(target,name)?;
 if absent(&function){return Ok(None);}
 let function=function.dyn_ref::<Function>().ok_or_else(||not_a_function(name))?;
 apply(function,target,args).map(Some)
}
pub fn global()->JsValue{js_sys::global().into()}
fn global_function(name:&str)->Result<Function,JsValue>{get(&global(),name).dyn_into().map_err(|_|not_a_function(name))}
pub fn set_timeout(callback:&JsValue,delay:f64)->Result<JsValue,JsValue>{global_function("setTimeout")?.call2(&global(),callback,&JsValue::from_f64(delay))}
pub fn clear_timeout(id:&JsValue)->Result<(),JsValue>{global_function("clearTimeout")?.call1(&global(),id)?;Ok(())}
pub fn request_frame(callback:&JsValue)->Result<JsValue,JsValue>{global_function("requestAnimationFrame")?.call1(&global(),callback)}
pub fn cancel_frame(id:&JsValue)->Result<(),JsValue>{global_function("cancelAnimationFrame")?.call1(&global(),id)?;Ok(())}
pub fn clock()->Result<f64,JsValue>{Ok(num(&method(&get(&global(),"performance"),"now",&[])?))}
pub fn finite(value:&JsValue)->bool{value.as_f64().is_some_and(f64::is_finite)}

/// `Math.max` / `Math.min` for two numbers: NaN propagates and +0 beats -0.
pub fn jmax(a:f64,b:f64)->f64{if a.is_nan()||b.is_nan(){f64::NAN}else if a==0.0&&b==0.0{if a.is_sign_negative(){b}else{a}}else if a>b{a}else{b}}
pub fn jmin(a:f64,b:f64)->f64{if a.is_nan()||b.is_nan(){f64::NAN}else if a==0.0&&b==0.0{if a.is_sign_negative(){a}else{b}}else if a<b{a}else{b}}
/// `Math.sign`: NaN and both zeros are returned unchanged.
pub fn jsign(a:f64)->f64{if a.is_nan()||a==0.0{a}else if a>0.0{1.0}else{-1.0}}
/// `Math.max(lo, Math.min(hi, value))`, the clamp every gesture used.
pub fn clamp(value:f64,lo:f64,hi:f64)->f64{jmax(lo,jmin(hi,value))}
pub fn exp(value:f64)->f64{js_sys::Math::exp(value)}
pub fn hypot(a:f64,b:f64)->f64{js_sys::Math::hypot(a,b)}
/// `value.toFixed(2)` exactly as the engine prints it.
pub fn fixed2(value:f64)->Result<String,JsValue>{Ok(js_sys::Number::from(value).to_fixed(2)?.as_string().unwrap_or_default())}
/// `String(value).trim()`, with JavaScript's own definition of white space.
pub fn trimmed(text:&str)->String{js_sys::JsString::from(text).trim().as_string().unwrap_or_default()}

/// One registered event listener, removed with the same arguments when dropped.
pub struct Listener{target:JsValue,kind:&'static str,callback:Closure<dyn FnMut(JsValue)>,capture:bool}
impl Drop for Listener{fn drop(&mut self){
 let Some(remove)=get(&self.target,"removeEventListener").dyn_into::<Function>().ok()else{return};
 let _=if self.capture{remove.call3(&self.target,&self.kind.into(),self.callback.as_ref(),&JsValue::TRUE)}else{remove.call2(&self.target,&self.kind.into(),self.callback.as_ref())};
}}
/// `target.addEventListener(kind, callback, {passive})` or `(…, true)` for capture.
/// A handler that fails throws out of the listener like an uncaught page error.
pub fn listen(target:&JsValue,kind:&'static str,passive:Option<bool>,capture:bool,mut handler:impl FnMut(JsValue)->Result<(),JsValue>+'static)->Result<Listener,JsValue>{
 let callback=Closure::wrap(Box::new(move|event:JsValue|{if let Err(error)=handler(event){wasm_bindgen::throw_val(error)}})as Box<dyn FnMut(JsValue)>);
 let options:JsValue=match(passive,capture){
  (_,true)=>JsValue::TRUE,
  (Some(passive),false)=>{let options=Object::new();Reflect::set(&options,&"passive".into(),&passive.into())?;options.into()}
  (None,false)=>JsValue::UNDEFINED,
 };
 let add=get(target,"addEventListener");
 let add=add.dyn_ref::<Function>().ok_or_else(||not_a_function("addEventListener"))?;
 if options.is_undefined(){add.call2(target,&kind.into(),callback.as_ref())?}else{add.call3(target,&kind.into(),callback.as_ref(),&options)?};
 Ok(Listener{target:target.clone(),kind,callback,capture})
}

thread_local!{
 static CALLBACKS:RefCell<Vec<(u64,Closure<dyn FnMut(JsValue)>)>>=const{RefCell::new(Vec::new())};
 static KEYS:Cell<u64>=const{Cell::new(0)};
}
/// One-shot callbacks (timers, frames) are owned here until they run or are cancelled, so a
/// controller that goes away with a timer still pending leaves a harmless closure the host
/// can still call (it finds its owner gone) rather than a dropped one that would throw.
/// wasm-bindgen defers a drop that happens inside the closure itself, so a callback may
/// release its own entry.
pub fn next_key()->u64{KEYS.with(|keys|{keys.set(keys.get()+1);keys.get()})}
pub fn adopt(key:u64,closure:Closure<dyn FnMut(JsValue)>)->JsValue{let function=closure.as_ref().clone();CALLBACKS.with(|live|live.borrow_mut().push((key,closure)));function}
pub fn release(key:u64){let found=CALLBACKS.with(|live|{let mut live=live.borrow_mut();live.iter().position(|(known,_)|*known==key).map(|index|live.remove(index).1)});drop(found);}
/// How many callbacks are still waiting for the host (diagnostics).
pub fn pending_callbacks()->usize{CALLBACKS.with(|live|live.borrow().len())}
