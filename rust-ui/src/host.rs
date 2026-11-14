#![allow(dead_code)]
//! Browser primitives for pointer state machines: property access, optional calls,
//! the global timers/frames/clock (looked up at call time, as the bare names were)
//! and JavaScript's own Math rounding (exp, hypot) which stays in the host.
//!
//! A property read, write or method call by a literal name leaves the module ONCE. The name is
//! handed to the host the first time it is used and afterwards travels as a small number: the
//! host keeps the strings (so they hold no handle of this module), and the test for null or
//! undefined, the read, the "is it a function" test and the call all happen on the other side
//! in that one visit. A name that is not a literal of this program takes the old road.
use std::cell::{Cell,RefCell};
use wasm_bindgen::{prelude::*,JsCast};
use js_sys::{Array,Function,Object,Reflect};

#[wasm_bindgen]
extern "C"{
 #[wasm_bindgen(js_name=Number)]fn to_number(value:&JsValue)->f64;
 /// `Object(value)`: the wrapper object of a primitive.
 #[wasm_bindgen(js_name=Object)]fn box_primitive(value:&JsValue)->JsValue;
 /// `String(value)`.
 #[wasm_bindgen(js_name=String)]fn string_of(value:&JsValue)->JsValue;
 #[wasm_bindgen(js_name=parseFloat)]fn parse_float_of(value:&JsValue)->f64;
}

// The host's half. `K` holds each name once, as the engine's own property key (taken back out of
// an object so it is a shared, already hashed string). Every function is one visit.
#[wasm_bindgen(inline_js=r#"
const K=[];let R;
const no=k=>new TypeError(K[k]+' is not a function');
export function ihr_key(s){const o={};o[s]=0;return K.push(Object.keys(o)[0])-1}
export function ihr_get(v,k){try{return v===null||v===undefined?undefined:v[K[k]]}catch{return undefined}}
export function ihr_read(v,k){return v[K[k]]}
export function ihr_at(v,i){try{return v===null||v===undefined?undefined:v[i]}catch{return undefined}}
export function ihr_set(v,k,n){Reflect.set(v,K[k],n)}
export function ihr_m0(t,k){const f=t[K[k]];if(typeof f!=='function')throw no(k);return f.call(t)}
export function ihr_m1(t,k,a){const f=t[K[k]];if(typeof f!=='function')throw no(k);return f.call(t,a)}
export function ihr_m2(t,k,a,b){const f=t[K[k]];if(typeof f!=='function')throw no(k);return f.call(t,a,b)}
export function ihr_m3(t,k,a,b,c){const f=t[K[k]];if(typeof f!=='function')throw no(k);return f.call(t,a,b,c)}
export function ihr_mn(t,k,l){const f=t[K[k]];if(typeof f!=='function')throw no(k);return f.apply(t,l)}
export function ihr_o0(t,k){if(t===null||t===undefined)return 0;const f=t[K[k]];if(f===null||f===undefined)return 0;if(typeof f!=='function')throw no(k);R=f.call(t);return 1}
export function ihr_o1(t,k,a){if(t===null||t===undefined)return 0;const f=t[K[k]];if(f===null||f===undefined)return 0;if(typeof f!=='function')throw no(k);R=f.call(t,a);return 1}
export function ihr_o2(t,k,a,b){if(t===null||t===undefined)return 0;const f=t[K[k]];if(f===null||f===undefined)return 0;if(typeof f!=='function')throw no(k);R=f.call(t,a,b);return 1}
export function ihr_on(t,k,l){if(t===null||t===undefined)return 0;const f=t[K[k]];if(f===null||f===undefined)return 0;if(typeof f!=='function')throw no(k);R=f.apply(t,l);return 1}
export function ihr_take(){const r=R;R=undefined;return r}
export function ihr_c0(f,k){if(typeof f!=='function')throw no(k);return f.call(undefined)}
export function ihr_c1(f,k,a){if(typeof f!=='function')throw no(k);return f.call(undefined,a)}
export function ihr_c2(f,k,a,b){if(typeof f!=='function')throw no(k);return f.call(undefined,a,b)}
export function ihr_c3(f,k,a,b,c){if(typeof f!=='function')throw no(k);return f.call(undefined,a,b,c)}
export function ihr_cn(f,k,l){if(typeof f!=='function')throw no(k);return f.apply(undefined,l)}
export function ihr_flag(v,k){try{return v===null||v===undefined?false:!!v[K[k]]}catch{return false}}
export function ihr_number(v,k){let x;try{x=v===null||v===undefined?undefined:v[K[k]]}catch{}return typeof x==='number'?x:Number(x)}
const G=k=>{let f;try{f=globalThis[K[k]]}catch{}if(typeof f!=='function')throw no(k);return f};
export function ihr_g1(k,a){return G(k).call(globalThis,a)}
export function ihr_g2(k,a,b){return G(k).call(globalThis,a,b)}
export function ihr_now(){const p=globalThis.performance,f=p.now;if(typeof f!=='function')throw new TypeError('now is not a function');return f.call(p)}
"#)]
extern "C"{
 fn ihr_key(text:&str)->u32;
 fn ihr_get(value:&JsValue,key:u32)->JsValue;
 #[wasm_bindgen(catch)]fn ihr_read(value:&JsValue,key:u32)->Result<JsValue,JsValue>;
 fn ihr_at(value:&JsValue,index:u32)->JsValue;
 #[wasm_bindgen(catch)]fn ihr_set(value:&JsValue,key:u32,next:&JsValue)->Result<(),JsValue>;
 #[wasm_bindgen(catch)]fn ihr_m0(target:&JsValue,key:u32)->Result<JsValue,JsValue>;
 #[wasm_bindgen(catch)]fn ihr_m1(target:&JsValue,key:u32,a:&JsValue)->Result<JsValue,JsValue>;
 #[wasm_bindgen(catch)]fn ihr_m2(target:&JsValue,key:u32,a:&JsValue,b:&JsValue)->Result<JsValue,JsValue>;
 #[wasm_bindgen(catch)]fn ihr_m3(target:&JsValue,key:u32,a:&JsValue,b:&JsValue,c:&JsValue)->Result<JsValue,JsValue>;
 #[wasm_bindgen(catch)]fn ihr_mn(target:&JsValue,key:u32,list:&Array)->Result<JsValue,JsValue>;
 #[wasm_bindgen(catch)]fn ihr_o0(target:&JsValue,key:u32)->Result<u32,JsValue>;
 #[wasm_bindgen(catch)]fn ihr_o1(target:&JsValue,key:u32,a:&JsValue)->Result<u32,JsValue>;
 #[wasm_bindgen(catch)]fn ihr_o2(target:&JsValue,key:u32,a:&JsValue,b:&JsValue)->Result<u32,JsValue>;
 #[wasm_bindgen(catch)]fn ihr_on(target:&JsValue,key:u32,list:&Array)->Result<u32,JsValue>;
 fn ihr_take()->JsValue;
 #[wasm_bindgen(catch)]fn ihr_c0(function:&JsValue,name:u32)->Result<JsValue,JsValue>;
 #[wasm_bindgen(catch)]fn ihr_c1(function:&JsValue,name:u32,a:&JsValue)->Result<JsValue,JsValue>;
 #[wasm_bindgen(catch)]fn ihr_c2(function:&JsValue,name:u32,a:&JsValue,b:&JsValue)->Result<JsValue,JsValue>;
 #[wasm_bindgen(catch)]fn ihr_c3(function:&JsValue,name:u32,a:&JsValue,b:&JsValue,c:&JsValue)->Result<JsValue,JsValue>;
 #[wasm_bindgen(catch)]fn ihr_cn(function:&JsValue,name:u32,list:&Array)->Result<JsValue,JsValue>;
 fn ihr_flag(value:&JsValue,key:u32)->bool;
 fn ihr_number(value:&JsValue,key:u32)->f64;
 #[wasm_bindgen(catch)]fn ihr_g1(name:u32,a:&JsValue)->Result<JsValue,JsValue>;
 #[wasm_bindgen(catch)]fn ihr_g2(name:u32,a:&JsValue,b:&JsValue)->Result<JsValue,JsValue>;
 #[wasm_bindgen(catch)]fn ihr_now()->Result<JsValue,JsValue>;
}

// Where this program's own constants live in its memory (set by the linker). A name inside that
// range never moves and never changes, so its address and length identify it for good.
extern "C"{static __global_base:u8;static __data_end:u8;}
const SLOTS:usize=8192;
/// (address, length, number + 1) per slot; all zero is an empty slot. Fixed, so no allocation.
struct Names{slots:[(u32,u32,u32);SLOTS],used:usize}
thread_local!{static NAMES:RefCell<Names>=const{RefCell::new(Names{slots:[(0,0,0);SLOTS],used:0})};}
/// The number the host knows a literal name by; `None` for a name built at run time (or once
/// the table is three quarters full), which is then sent as text.
#[inline]
fn key(name:&str)->Option<u32>{
 let at=name.as_ptr() as usize;
 if at<(&raw const __global_base) as usize||at>=(&raw const __data_end) as usize{return None;}
 let (at,len)=(at as u32,name.len() as u32);
 let mut slot=((at^len.rotate_left(20)).wrapping_mul(0x9E37_79B1)>>19) as usize;
 let known=NAMES.with(|names|{let names=names.borrow();loop{
  let (a,l,id)=names.slots[slot];
  if id==0{return if names.used>=SLOTS/4*3{Err(false)}else{Err(true)};}
  if a==at&&l==len{return Ok(id-1);}
  slot=(slot+1)&(SLOTS-1);
 }});
 match known{
  Ok(id)=>Some(id),
  Err(false)=>None,
  Err(true)=>{let id=ihr_key(name);NAMES.with(|names|{let mut names=names.borrow_mut();names.slots[slot]=(at,len,id+1);names.used+=1;});Some(id)}
 }
}
/// How many literal names the host has been told (diagnostics).
pub fn known_names()->usize{NAMES.with(|names|names.borrow().used)}

/// Primitives have properties too (`"x".length`); Reflect.get wants an object.
pub fn boxed(value:&JsValue)->JsValue{if value.is_object()||value.is_function(){value.clone()}else{box_primitive(value)}}
pub fn get(value:&JsValue,name:&str)->JsValue{
 if let Some(key)=key(name){return ihr_get(value,key);}
 if absent(value){return JsValue::UNDEFINED;}Reflect::get(&boxed(value),&JsValue::from_str(name)).unwrap_or(JsValue::UNDEFINED)
}
/// `value[key]`, throwing like the engine for null/undefined or a failing getter.
pub fn read(value:&JsValue,name:&str)->Result<JsValue,JsValue>{
 if let Some(key)=key(name){return ihr_read(value,key);}
 if absent(value){return Err(js_sys::TypeError::new(&format!("Cannot read properties of {} (reading '{name}')",if value.is_null(){"null"}else{"undefined"})).into());}
 Reflect::get(&boxed(value),&JsValue::from_str(name))
}
/// `!!value?.name` in one visit, with nothing to release (a failing getter reads as false, like `get`).
pub fn flag(value:&JsValue,name:&str)->bool{match key(name){Some(key)=>ihr_flag(value,key),None=>truthy(&get(value,name))}}
/// `Number(value?.name)` in one visit, with nothing to release.
pub fn number(value:&JsValue,name:&str)->f64{match key(name){Some(key)=>ihr_number(value,key),None=>num(&get(value,name))}}
pub fn get_at(value:&JsValue,index:u32)->JsValue{ihr_at(value,index)}
pub fn set(value:&JsValue,name:&str,next:&JsValue)->Result<(),JsValue>{
 if let Some(key)=key(name){return ihr_set(value,key,next);}
 Reflect::set(value,&JsValue::from_str(name),next)?;Ok(())
}
pub fn absent(value:&JsValue)->bool{value.is_null_or_undefined()}
pub fn truthy(value:&JsValue)->bool{value.is_truthy()}
/// `Number(value)` without allocating for the ordinary case.
pub fn num(value:&JsValue)->f64{match value.as_f64(){Some(number)=>number,None=>to_number(value)}}
pub fn text(value:&JsValue,expected:&str)->bool{value.as_string().is_some_and(|text|text==expected)}
fn not_a_function(name:&str)->JsValue{js_sys::TypeError::new(&format!("{name} is not a function")).into()}
fn list_of(args:&[&JsValue])->Array{let list=Array::new();for argument in args{list.push(argument);}list}
/// `value(...args)` with `this` undefined.
pub fn call(value:&JsValue,name:&str,args:&[&JsValue])->Result<JsValue,JsValue>{
 if let Some(key)=key(name){return match args{
  []=>ihr_c0(value,key),[a]=>ihr_c1(value,key,a),[a,b]=>ihr_c2(value,key,a,b),[a,b,c]=>ihr_c3(value,key,a,b,c),
  _=>ihr_cn(value,key,&list_of(args)),
 };}
 let function=value.dyn_ref::<Function>().ok_or_else(||not_a_function(name))?;
 apply(function,&JsValue::UNDEFINED,args)
}
fn apply(function:&Function,this:&JsValue,args:&[&JsValue])->Result<JsValue,JsValue>{
 match args{
  []=>function.call0(this),[a]=>function.call1(this,a),[a,b]=>function.call2(this,a,b),
  _=>function.apply(this,&list_of(args))
 }
}
/// `value?.(...args)`: nothing happens for null or undefined, anything else must be callable.
pub fn call_opt(value:&JsValue,name:&str,args:&[&JsValue])->Result<JsValue,JsValue>{if absent(value){Ok(JsValue::UNDEFINED)}else{call(value,name,args)}}
/// `target.name(...args)`, failing like a missing method.
pub fn method(target:&JsValue,name:&str,args:&[&JsValue])->Result<JsValue,JsValue>{
 if let Some(key)=key(name){return match args{
  []=>ihr_m0(target,key),[a]=>ihr_m1(target,key,a),[a,b]=>ihr_m2(target,key,a,b),[a,b,c]=>ihr_m3(target,key,a,b,c),
  _=>ihr_mn(target,key,&list_of(args)),
 };}
 let function=read(target,name)?;
 let function=function.dyn_ref::<Function>().ok_or_else(||not_a_function(name))?;
 apply(function,target,args)
}
/// `target?.name?.(...args)`: absent target or method yield `None`.
pub fn method_opt(target:&JsValue,name:&str,args:&[&JsValue])->Result<Option<JsValue>,JsValue>{
 if let Some(key)=key(name){
  let called=match args{[]=>ihr_o0(target,key),[a]=>ihr_o1(target,key,a),[a,b]=>ihr_o2(target,key,a,b),_=>ihr_on(target,key,&list_of(args))}?;
  return Ok(if called==0{None}else{Some(ihr_take())});
 }
 if absent(target){return Ok(None);}
 let function=read(target,name)?;
 if absent(&function){return Ok(None);}
 let function=function.dyn_ref::<Function>().ok_or_else(||not_a_function(name))?;
 apply(function,target,args).map(Some)
}
/// `host.later(name, take, ...head)`: a callback the PAGE makes and owns (so it lives exactly as long
/// as whoever was handed it, with nothing of this module to free). When it runs it looks `name` up in
/// this module and calls it with `head` and then the first `take` arguments it was called with.
pub fn later(host:&JsValue,name:&str,take:u32,head:&[&JsValue])->Result<JsValue,JsValue>{
 let (name,take)=(JsValue::from_str(name),JsValue::from_f64(f64::from(take)));
 let mut args:Vec<&JsValue>=Vec::with_capacity(head.len()+2);args.push(&name);args.push(&take);args.extend_from_slice(head);
 method(host,"later",&args)
}
pub fn global()->JsValue{js_sys::global().into()}
/// `new globalThis[name](...args)`.
pub fn construct(name:&str,args:&[&JsValue])->Result<JsValue,JsValue>{
 let constructor=get(&global(),name).dyn_into::<Function>().map_err(|_|not_a_function(name))?;
 let list=Array::new();for argument in args{list.push(argument);}
 Reflect::construct(&constructor,&list)
}
fn global_function(name:&str)->Result<Function,JsValue>{get(&global(),name).dyn_into().map_err(|_|not_a_function(name))}
/// `globalThis.name(a)` / `(a, b)`, the function looked up at each call.
fn global_call(name:&str,a:&JsValue,b:Option<&JsValue>)->Result<JsValue,JsValue>{
 match(key(name),b){
  (Some(key),None)=>ihr_g1(key,a),(Some(key),Some(b))=>ihr_g2(key,a,b),
  (None,None)=>global_function(name)?.call1(&global(),a),(None,Some(b))=>global_function(name)?.call2(&global(),a,b),
 }
}
pub fn set_timeout(callback:&JsValue,delay:f64)->Result<JsValue,JsValue>{global_call("setTimeout",callback,Some(&JsValue::from_f64(delay)))}
pub fn clear_timeout(id:&JsValue)->Result<(),JsValue>{global_call("clearTimeout",id,None)?;Ok(())}
pub fn request_frame(callback:&JsValue)->Result<JsValue,JsValue>{global_call("requestAnimationFrame",callback,None)}
pub fn cancel_frame(id:&JsValue)->Result<(),JsValue>{global_call("cancelAnimationFrame",id,None)?;Ok(())}
pub fn clock()->Result<f64,JsValue>{Ok(num(&ihr_now()?))}
pub fn finite(value:&JsValue)->bool{value.as_f64().is_some_and(f64::is_finite)}

/// `Math.max` / `Math.min` for two numbers: NaN propagates and +0 beats -0.
pub fn jmax(a:f64,b:f64)->f64{if a.is_nan()||b.is_nan(){f64::NAN}else if a==0.0&&b==0.0{if a.is_sign_negative(){b}else{a}}else if a>b{a}else{b}}
pub fn jmin(a:f64,b:f64)->f64{if a.is_nan()||b.is_nan(){f64::NAN}else if a==0.0&&b==0.0{if a.is_sign_negative(){a}else{b}}else if a<b{a}else{b}}
/// `Math.sign`: NaN and both zeros are returned unchanged.
pub fn jsign(a:f64)->f64{if a.is_nan()||a==0.0{a}else if a>0.0{1.0}else{-1.0}}
/// `Math.max(lo, Math.min(hi, value))`, the clamp every gesture used.
pub fn clamp(value:f64,lo:f64,hi:f64)->f64{jmax(lo,jmin(hi,value))}
/// `String(value)` as a value, with the engine's own conversion.
pub fn text_value(value:&JsValue)->JsValue{string_of(value)}
/// `String(value)` as Rust text.
pub fn text_of(value:&JsValue)->String{string_of(value).as_string().unwrap_or_default()}
/// `Number.parseFloat(value)`.
pub fn parse_float(value:&JsValue)->f64{parse_float_of(value)}
pub fn exp(value:f64)->f64{js_sys::Math::exp(value)}
/// `Math.round`: halves go up, as the engine rounds them.
pub fn js_round(value:f64)->f64{js_sys::Math::round(value)}
/// `String(value)` for a number, exactly as the engine prints it (`1e+21`, `NaN`, `-0` as `0`).
pub fn number_string(value:f64)->String{js_sys::Number::from(value).to_string(10).ok().and_then(|text|text.as_string()).unwrap_or_default()}
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
