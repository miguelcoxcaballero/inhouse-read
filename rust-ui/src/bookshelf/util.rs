//! Browser plumbing for the shelf screen: the few JavaScript behaviours the ported code leans on (property
//! access, element building with the original `el()` semantics, timers whose closures live exactly as long
//! as the timer, animations with the same safety net, the `async` start that runs synchronously up to its
//! first `await`). Every browser API stays the browser's own; nothing here decides anything.
#![allow(dead_code)]
use std::{cell::{Cell,RefCell},rc::Rc};
use wasm_bindgen::{prelude::*,JsCast};
use js_sys::{Array,Function,Object,Promise,Reflect};
use wasm_bindgen_futures::JsFuture;
pub use crate::host::{absent,adopt,boxed,call,clear_timeout,get,get_at,global,method,method_opt,next_key,num,read,release,set,text_of,truthy};
pub use crate::cloud_host::{assign,construct,delete as delete_key,entries,error,error_with_cause,has_own,json,nullish,start,string};

pub type R<T=()>=Result<T,JsValue>;

#[wasm_bindgen]
extern "C"{
 #[wasm_bindgen(js_name=setInterval)]fn js_set_interval(handler:&Function,delay:f64)->JsValue;
 #[wasm_bindgen(js_name=clearInterval)]fn js_clear_interval(id:&JsValue);
 #[wasm_bindgen(js_name=setTimeout)]fn js_set_timeout(handler:&Function,delay:f64)->JsValue;
 #[wasm_bindgen(js_name=requestAnimationFrame)]fn js_request_frame(handler:&Function)->JsValue;
 #[wasm_bindgen(js_name=cancelAnimationFrame)]fn js_cancel_frame(id:&JsValue);
 #[wasm_bindgen(js_name=requestIdleCallback)]fn js_request_idle(handler:&Function,options:&JsValue)->JsValue;
 #[wasm_bindgen(js_namespace=console,js_name=warn)]fn js_warn(a:&JsValue,b:&JsValue);
 #[wasm_bindgen(js_namespace=console,js_name=warn)]fn js_warn1(a:&JsValue);
 #[wasm_bindgen(js_namespace=console,js_name=error)]fn js_error(a:&JsValue,b:&JsValue);
}

// ---------------------------------------------------------------- values
pub fn s(text:&str)->JsValue{JsValue::from_str(text)}
pub fn f(number:f64)->JsValue{JsValue::from_f64(number)}
pub fn b(flag:bool)->JsValue{JsValue::from_bool(flag)}
pub fn undef()->JsValue{JsValue::UNDEFINED}
pub fn null()->JsValue{JsValue::NULL}
/// `String(number)` exactly as the engine prints it.
pub fn ns(number:f64)->String{crate::host::number_string(number)}
/// Plain object with the given own properties, in order.
pub fn obj(entries:&[(&str,&JsValue)])->JsValue{let object=Object::new();for(key,value)in entries{let _=Reflect::set(&object,&(*key).into(),value);}object.into()}
pub fn arr(items:&[&JsValue])->JsValue{let list=Array::new();for item in items{list.push(item);}list.into()}
pub fn put(target:&JsValue,key:&str,value:&JsValue){let _=Reflect::set(target,&key.into(),value);}
pub fn putf(target:&JsValue,key:&str,value:f64){put(target,key,&f(value));}
pub fn puts(target:&JsValue,key:&str,value:&str){put(target,key,&s(value));}
pub fn putb(target:&JsValue,key:&str,value:bool){put(target,key,&b(value));}
/// `value?.[key]` as text (`""` for anything that is not a string).
pub fn gs(value:&JsValue,key:&str)->String{get(value,key).as_string().unwrap_or_default()}
pub fn gb(value:&JsValue,key:&str)->bool{truthy(&get(value,key))}
pub fn gn(value:&JsValue,key:&str)->f64{num(&get(value,key))}
/// `String(value)` for any value, as template literals print it.
pub fn text(value:&JsValue)->String{string(value)}
/// `a ?? b`.
pub fn coalesce(a:JsValue,b:JsValue)->JsValue{if nullish(&a){b}else{a}}
/// `a || b`.
pub fn or(a:JsValue,b:JsValue)->JsValue{if truthy(&a){a}else{b}}
pub fn is_fn(value:&JsValue)->bool{value.is_function()}
/// `Number.isFinite(value)`.
pub fn is_finite(value:&JsValue)->bool{value.as_f64().is_some_and(f64::is_finite)}
/// `Math.round`.
pub fn round(value:f64)->f64{js_sys::Math::round(value)}
pub fn max(a:f64,b:f64)->f64{crate::host::jmax(a,b)}
pub fn min(a:f64,b:f64)->f64{crate::host::jmin(a,b)}
pub fn warn(message:&str,error:&JsValue){js_warn(&s(message),error);}
pub fn warn1(message:&str){js_warn1(&s(message));}
pub fn log_error(message:&str,error:&JsValue){js_error(&s(message),error);}
pub fn now()->f64{crate::host::clock().unwrap_or(0.0)}
pub fn stringify(value:&JsValue)->Option<String>{crate::cloud_host::stringify(value).ok().flatten()}
/// `new Map()`'s `get` for the shared state maps.
pub fn map_get(map:&JsValue,key:&JsValue)->JsValue{method(map,"get",&[key]).unwrap_or(JsValue::UNDEFINED)}
pub fn map_set(map:&JsValue,key:&JsValue,value:&JsValue){let _=method(map,"set",&[key,value]);}
pub fn map_has(map:&JsValue,key:&JsValue)->bool{method(map,"has",&[key]).map(|v|truthy(&v)).unwrap_or(false)}
pub fn map_delete(map:&JsValue,key:&JsValue)->bool{method(map,"delete",&[key]).map(|v|truthy(&v)).unwrap_or(false)}
pub fn map_size(map:&JsValue)->f64{num(&get(map,"size"))}
pub fn new_map()->R<JsValue>{construct("Map",&[])}
pub fn new_set()->R<JsValue>{construct("Set",&[])}
pub fn array_of(value:&JsValue)->Vec<JsValue>{if Array::is_array(value){Array::from(value).iter().collect()}else{Vec::new()}}

// ---------------------------------------------------------------- window / document
pub fn window()->JsValue{get(&global(),"window")}
pub fn document()->JsValue{get(&global(),"document")}
pub fn inner_width()->f64{num(&get(&window(),"innerWidth"))}
pub fn inner_height()->f64{num(&get(&window(),"innerHeight"))}
pub fn device_pixel_ratio()->f64{let ratio=get(&window(),"devicePixelRatio");if truthy(&ratio){num(&ratio)}else{1.0}}
pub fn visual_viewport()->JsValue{get(&window(),"visualViewport")}
/// `matchMedia('(prefers-reduced-motion: reduce)').matches`.
pub fn prefers_reduced_motion()->bool{
 let match_media=get(&global(),"matchMedia");
 if !match_media.is_function(){return false;}
 call(&match_media,"matchMedia",&[&s("(prefers-reduced-motion: reduce)")]).map(|query|gb(&query,"matches")).unwrap_or(false)
}
pub fn active_element()->JsValue{get(&document(),"activeElement")}
pub fn local_storage_get(key:&str)->R<JsValue>{let storage=read(&global(),"localStorage")?;method(&storage,"getItem",&[&s(key)])}
pub fn local_storage_set(key:&str,value:&str)->R{let storage=read(&global(),"localStorage")?;method(&storage,"setItem",&[&s(key),&s(value)])?;Ok(())}
pub fn local_storage_remove(key:&str)->R{let storage=read(&global(),"localStorage")?;method(&storage,"removeItem",&[&s(key)])?;Ok(())}

// ---------------------------------------------------------------- DOM
pub fn create(tag:&str)->R<JsValue>{method(&document(),"createElement",&[&s(tag)])}
pub fn create_svg(tag:&str)->R<JsValue>{method(&document(),"createElementNS",&[&s("http://www.w3.org/2000/svg"),&s(tag)])}
pub fn set_attr(node:&JsValue,key:&str,value:&str){let _=method(node,"setAttribute",&[&s(key),&s(value)]);}
pub fn get_attr(node:&JsValue,key:&str)->Option<String>{method(node,"getAttribute",&[&s(key)]).ok().and_then(|v|v.as_string())}
pub fn remove_attr(node:&JsValue,key:&str){let _=method(node,"removeAttribute",&[&s(key)]);}
pub fn has_attr(node:&JsValue,key:&str)->bool{method(node,"hasAttribute",&[&s(key)]).map(|v|truthy(&v)).unwrap_or(false)}
pub fn class_list(node:&JsValue)->JsValue{get(node,"classList")}
pub fn cls_add(node:&JsValue,names:&[&str]){let list=class_list(node);let args:Vec<JsValue>=names.iter().map(|n|s(n)).collect();let refs:Vec<&JsValue>=args.iter().collect();let _=method(&list,"add",&refs);}
pub fn cls_remove(node:&JsValue,names:&[&str]){let list=class_list(node);let args:Vec<JsValue>=names.iter().map(|n|s(n)).collect();let refs:Vec<&JsValue>=args.iter().collect();let _=method(&list,"remove",&refs);}
pub fn cls_toggle(node:&JsValue,name:&str,force:bool){let _=method(&class_list(node),"toggle",&[&s(name),&b(force)]);}
pub fn cls_has(node:&JsValue,name:&str)->bool{method(&class_list(node),"contains",&[&s(name)]).map(|v|truthy(&v)).unwrap_or(false)}
pub fn style(node:&JsValue)->JsValue{get(node,"style")}
pub fn style_set(node:&JsValue,property:&str,value:&str){let _=method(&style(node),"setProperty",&[&s(property),&s(value)]);}
pub fn style_remove(node:&JsValue,property:&str){let _=method(&style(node),"removeProperty",&[&s(property)]);}
pub fn style_get(node:&JsValue,property:&str)->String{method(&style(node),"getPropertyValue",&[&s(property)]).ok().and_then(|v|v.as_string()).unwrap_or_default()}
/// `node.style[property] = value`.
pub fn style_prop(node:&JsValue,property:&str,value:&str){put(&style(node),property,&s(value));}
pub fn set_text(node:&JsValue,text:&str){puts(node,"textContent",text);}
pub fn append(parent:&JsValue,child:&JsValue){let _=method(parent,"append",&[child]);}
pub fn append_all(parent:&JsValue,children:&[&JsValue]){let _=method(parent,"append",children);}
pub fn remove(node:&JsValue){let _=method(node,"remove",&[]);}
pub fn replace_with(node:&JsValue,other:&JsValue){let _=method(node,"replaceWith",&[other]);}
pub fn replace_children(node:&JsValue,children:&[JsValue]){let refs:Vec<&JsValue>=children.iter().collect();let _=method(node,"replaceChildren",&refs);}
pub fn qs(root:&JsValue,selector:&str)->JsValue{method(root,"querySelector",&[&s(selector)]).unwrap_or(JsValue::NULL)}
/// `[...root.querySelectorAll(selector)]`.
pub fn qsa(root:&JsValue,selector:&str)->Vec<JsValue>{
 match method(root,"querySelectorAll",&[&s(selector)]){Ok(list)=>Array::from(&list).iter().collect(),Err(_)=>Vec::new()}
}
pub fn closest(node:&JsValue,selector:&str)->JsValue{if absent(node){return JsValue::UNDEFINED;}method_opt(node,"closest",&[&s(selector)]).ok().flatten().unwrap_or(JsValue::UNDEFINED)}
pub fn matches(node:&JsValue,selector:&str)->bool{method_opt(node,"matches",&[&s(selector)]).ok().flatten().map(|v|truthy(&v)).unwrap_or(false)}
pub fn is_connected(node:&JsValue)->bool{gb(node,"isConnected")}
pub fn rect(node:&JsValue)->R<JsValue>{method(node,"getBoundingClientRect",&[])}
pub fn focus(node:&JsValue){
 if absent(node){return;}
 let options=obj(&[("preventScroll",&JsValue::TRUE)]);
 let _=method_opt(node,"focus",&[&options]);
}
pub fn focus_plain(node:&JsValue){let _=method_opt(node,"focus",&[]);}
pub fn dataset(node:&JsValue)->JsValue{get(node,"dataset")}
/// `String(node.dataset[key] ?? '')`-like access that keeps `undefined` apart from text.
pub fn data_get(node:&JsValue,key:&str)->JsValue{get(&dataset(node),key)}

/// `el(tag, props, children)` of the original, one call per prop in the order the original assigned them.
pub struct El(pub JsValue);
impl El{
 pub fn new(tag:&str)->El{El(create(tag).unwrap_or(JsValue::UNDEFINED))}
 /// `class` prop: `node.className = value`.
 pub fn class(self,value:&str)->El{puts(&self.0,"className",value);self}
 pub fn attr(self,key:&str,value:&str)->El{set_attr(&self.0,key,value);self}
 /// A `true` prop: the attribute is set empty.
 pub fn flag(self,key:&str)->El{set_attr(&self.0,key,"");self}
 pub fn text(self,value:&str)->El{set_text(&self.0,value);self}
 pub fn html(self,value:&str)->El{puts(&self.0,"innerHTML",value);self}
 pub fn style(self,value:&str)->El{set_attr(&self.0,"style",value);self}
 pub fn child(self,node:&JsValue)->El{if !absent(node){append(&self.0,node);}self}
 pub fn children(self,nodes:&[JsValue])->El{for node in nodes{if !absent(node){append(&self.0,node);}}self}
 pub fn done(self)->JsValue{self.0}
}
/// One registered event listener, removed with the same arguments when dropped. Handlers are `Fn` (they keep
/// their state in cells): a handler may be re-entered by an event it dispatches itself, as in the browser.
pub struct Listener{target:JsValue,kind:&'static str,callback:Closure<dyn Fn(JsValue)>,capture:bool}
impl Drop for Listener{fn drop(&mut self){
 if let Some(remove)=get(&self.target,"removeEventListener").dyn_ref::<Function>(){
  let _=if self.capture{remove.call3(&self.target,&s(self.kind),self.callback.as_ref(),&JsValue::TRUE)}else{remove.call2(&self.target,&s(self.kind),self.callback.as_ref())};
 }
}}
/// Listeners owned by one view, removed when it goes away.
pub type Keep=Rc<RefCell<Vec<Listener>>>;
pub fn keep()->Keep{Rc::new(RefCell::new(Vec::new()))}
/// Registers `handler` with the given options (`None`: none at all). An error of the handler is thrown out of
/// the listener like an uncaught page error.
pub fn listen(target:&JsValue,kind:&'static str,options:Option<&JsValue>,capture:bool,handler:impl Fn(JsValue)->R+'static)->R<Listener>{
 let callback=Closure::wrap(Box::new(move|event:JsValue|{if let Err(error)=handler(event){wasm_bindgen::throw_val(error)}})as Box<dyn Fn(JsValue)>);
 match options{
  Some(options)=>{method(target,"addEventListener",&[&s(kind),callback.as_ref(),options])?;}
  None=>{if capture{method(target,"addEventListener",&[&s(kind),callback.as_ref(),&JsValue::TRUE])?;}else{method(target,"addEventListener",&[&s(kind),callback.as_ref()])?;}}
 }
 Ok(Listener{target:target.clone(),kind,callback,capture})
}
/// `target.addEventListener(kind, handler)` (no options), owned by `keep`.
pub fn on(keep:&Keep,target:&JsValue,kind:&'static str,handler:impl Fn(JsValue)->R+'static)->R{
 let listener=listen(target,kind,None,false,handler)?;keep.borrow_mut().push(listener);Ok(())
}
/// `target.addEventListener(kind, handler, true)`.
pub fn on_capture(keep:&Keep,target:&JsValue,kind:&'static str,handler:impl Fn(JsValue)->R+'static)->R{
 let listener=listen(target,kind,None,true,handler)?;keep.borrow_mut().push(listener);Ok(())
}
/// `target.addEventListener(kind, handler, { passive })`.
pub fn on_passive(keep:&Keep,target:&JsValue,kind:&'static str,passive:bool,handler:impl Fn(JsValue)->R+'static)->R{
 let listener=listen(target,kind,Some(&obj(&[("passive",&b(passive))])),false,handler)?;keep.borrow_mut().push(listener);Ok(())
}
/// `target.addEventListener(kind, handler, { capture: true, passive: true })`.
pub fn on_capture_passive(target:&JsValue,kind:&'static str,handler:impl Fn(JsValue)->R+'static)->R<Listener>{
 listen(target,kind,Some(&obj(&[("capture",&JsValue::TRUE),("passive",&JsValue::TRUE)])),true,handler)
}
pub fn prevent_default(event:&JsValue){let _=method(event,"preventDefault",&[]);}
pub fn stop_propagation(event:&JsValue){let _=method(event,"stopPropagation",&[]);}
pub fn stop_immediate(event:&JsValue){let _=method(event,"stopImmediatePropagation",&[]);}

/// The icon builder of the original (`svgIcon`): an `svg` with one `path` per drawing command.
pub fn svg_icon(paths:&[&str],view_box:&str,class_name:&str)->R<JsValue>{
 let svg=create_svg("svg")?;
 set_attr(&svg,"viewBox",view_box);set_attr(&svg,"class",class_name);set_attr(&svg,"fill","none");
 set_attr(&svg,"aria-hidden","true");set_attr(&svg,"focusable","false");
 for d in paths{
  let path=create_svg("path")?;
  set_attr(&path,"d",d);set_attr(&path,"stroke-width","2");set_attr(&path,"stroke-linecap","round");set_attr(&path,"stroke-linejoin","round");
  append(&svg,&path);
 }
 Ok(svg)
}
pub fn icon(paths:&[&str])->R<JsValue>{svg_icon(paths,"0 0 24 24","ihr-icon")}

// ---------------------------------------------------------------- timers
/// A pending timer or frame: its id as the host returned it, plus the key owning its closure.
#[derive(Clone)]
pub struct Timer{pub id:JsValue,pub key:u64}
impl Timer{
 pub fn none()->Timer{Timer{id:JsValue::from_f64(0.0),key:0}}
 pub fn is_set(&self)->bool{truthy(&self.id)}
}
fn one_shot(callback:impl FnOnce()->R+'static)->(u64,JsValue){
 let key=next_key();let mut callback=Some(callback);
 let closure=Closure::wrap(Box::new(move|_:JsValue|{
  release(key);
  if let Some(callback)=callback.take(){if let Err(error)=callback(){wasm_bindgen::throw_val(error)}}
 })as Box<dyn FnMut(JsValue)>);
 (key,adopt(key,closure))
}
/// A function that runs `callback` the first time it is called and is released with that call.
pub fn once(callback:impl FnOnce()->R+'static)->JsValue{one_shot(callback).1}
/// `Math.hypot(a, b)`.
pub fn hypot(a:f64,b:f64)->f64{js_sys::Math::hypot(a,b)}
/// `setTimeout(callback, delay)`.
pub fn after(delay:f64,callback:impl FnOnce()->R+'static)->Timer{
 let (key,function)=one_shot(callback);
 Timer{id:js_set_timeout(function.unchecked_ref(),delay),key}
}
/// `clearTimeout(timer)`; releases the closure of a timer that never fired.
pub fn cancel(timer:&Timer){if timer.key!=0{release(timer.key);}let _=clear_timeout(&timer.id);}
/// `requestAnimationFrame(callback)`.
pub fn frame(callback:impl FnOnce()->R+'static)->Timer{
 let (key,function)=one_shot(callback);
 Timer{id:js_request_frame(function.unchecked_ref()),key}
}
pub fn cancel_frame(timer:&Timer){if timer.key!=0{release(timer.key);}js_cancel_frame(&timer.id);}
/// `requestIdleCallback(callback, { timeout })`, or a timer of `fallback` ms where it does not exist.
pub fn idle(timeout:f64,fallback:f64,callback:impl FnOnce()->R+'static)->Timer{
 let (key,function)=one_shot(callback);
 if get(&global(),"requestIdleCallback").is_function(){
  let id=js_request_idle(function.unchecked_ref(),&obj(&[("timeout",&f(timeout))]));Timer{id,key}
 }else{Timer{id:js_set_timeout(function.unchecked_ref(),fallback),key}}
}
/// `setInterval(callback, delay)`; the closure lives until `clear_interval`.
pub struct Interval{pub id:JsValue,callback:Closure<dyn Fn()>}
pub fn every(delay:f64,callback:impl Fn()->R+'static)->Interval{
 let callback=Closure::wrap(Box::new(move||{if let Err(error)=callback(){wasm_bindgen::throw_val(error)}})as Box<dyn Fn()>);
 let id=js_set_interval(callback.as_ref().unchecked_ref(),delay);
 Interval{id,callback}
}
pub fn clear_interval(interval:&Interval){js_clear_interval(&interval.id);}

// ---------------------------------------------------------------- promises
/// `await value` for any value (a thenable or not).
pub async fn settle(value:JsValue)->R<JsValue>{JsFuture::from(Promise::resolve(&value)).await}
pub fn promise_resolve(value:&JsValue)->JsValue{Promise::resolve(value).into()}
/// `promise.then(ok, err)` with owned one-shot reactions.
pub fn then(promise:&JsValue,ok:impl FnOnce(JsValue)->R+'static,err:impl FnOnce(JsValue)->R+'static)->R<JsValue>{
 let pair:Rc<RefCell<Option<(Closure<dyn FnMut(JsValue)>,Closure<dyn FnMut(JsValue)>)>>>=Rc::new(RefCell::new(None));
 let ok=RefCell::new(Some(ok));let err=RefCell::new(Some(err));
 let fulfilled={let pair=pair.clone();Closure::wrap(Box::new(move|value:JsValue|{
  let work=ok.borrow_mut().take();
  let result=match work{Some(work)=>work(value),None=>Ok(())};
  let released=pair.borrow_mut().take();drop(released);
  if let Err(error)=result{wasm_bindgen::throw_val(error)}
 })as Box<dyn FnMut(JsValue)>)};
 let rejected={let pair=pair.clone();Closure::wrap(Box::new(move|value:JsValue|{
  let work=err.borrow_mut().take();
  let result=match work{Some(work)=>work(value),None=>Ok(())};
  let released=pair.borrow_mut().take();drop(released);
  if let Err(error)=result{wasm_bindgen::throw_val(error)}
 })as Box<dyn FnMut(JsValue)>)};
 let derived=method(promise,"then",&[fulfilled.as_ref(),rejected.as_ref()])?;
 *pair.borrow_mut()=Some((fulfilled,rejected));
 Ok(derived)
}
/// `promise.finally(done)`, returning the derived promise.
pub fn finally(promise:&JsValue,done:impl FnOnce()->R+'static)->R<JsValue>{
 let slot:Rc<RefCell<Option<Closure<dyn FnMut()->JsValue>>>>=Rc::new(RefCell::new(None));
 let work=RefCell::new(Some(done));
 let closure={let slot=slot.clone();Closure::wrap(Box::new(move||->JsValue{
  let job=work.borrow_mut().take();
  let result=match job{Some(job)=>job(),None=>Ok(())};
  let released=slot.borrow_mut().take();drop(released);
  match result{Ok(())=>JsValue::UNDEFINED,Err(error)=>wasm_bindgen::throw_val(error)}
 })as Box<dyn FnMut()->JsValue>)};
 let derived=method(promise,"finally",&[closure.as_ref()])?;
 *slot.borrow_mut()=Some(closure);
 Ok(derived)
}
/// `promise.then(done, done)` for a reaction that does not care about the outcome.
pub fn then_any(promise:&JsValue,done:impl FnOnce()->R+'static)->R<JsValue>{
 let shared:Rc<RefCell<Option<Box<dyn FnOnce()->R>>>>=Rc::new(RefCell::new(Some(Box::new(done))));
 let (a,c)=(shared.clone(),shared);
 then(promise,move|_|{let work=a.borrow_mut().take();match work{Some(work)=>work(),None=>Ok(())}},move|_|{let work=c.borrow_mut().take();match work{Some(work)=>work(),None=>Ok(())}})
}
/// `new Promise(...)` whose resolver the caller keeps.
pub fn deferred()->(JsValue,Function,Function){
 let mut callbacks=None;let promise=Promise::new(&mut|resolve,reject|{callbacks=Some((resolve,reject));});
 let (resolve,reject)=callbacks.expect("Promise executors run synchronously");
 (promise.into(),resolve,reject)
}
/// A function value the host can call, backed by a closure that lives as long as the returned guard.
pub struct Fun{pub function:JsValue,_closure:Closure<dyn Fn(JsValue,JsValue)->JsValue>}
pub fn fun(body:impl Fn(JsValue,JsValue)->R<JsValue>+'static)->Fun{
 let closure=Closure::wrap(Box::new(move|a:JsValue,b:JsValue|match body(a,b){Ok(value)=>value,Err(error)=>wasm_bindgen::throw_val(error)})as Box<dyn Fn(JsValue,JsValue)->JsValue>);
 Fun{function:closure.as_ref().clone(),_closure:closure}
}
/// What a callback handed to the host answers once its owner is gone, as the original's stale checks did.
#[derive(Clone,Copy)]
pub enum Stale{Undefined,False,Promise,PromiseFalse}
type Handler=Rc<dyn Fn(JsValue,JsValue)->R<JsValue>>;
/// One dispatcher for the whole module: the functions handed to host code are plain JavaScript closures over an
/// id, so they cost no handle in this module and stay callable (answering `Stale`) after their owner is gone.
struct Dispatch{table:Rc<RefCell<std::collections::HashMap<u32,Handler>>>,next:Cell<u32>,factory:JsValue,_closure:Closure<dyn Fn(f64,f64,JsValue,JsValue)->JsValue>}
thread_local!{static DISPATCH:Dispatch=Dispatch::new();}
impl Dispatch{
 fn new()->Dispatch{
  let table:Rc<RefCell<std::collections::HashMap<u32,Handler>>>=Rc::new(RefCell::new(std::collections::HashMap::new()));
  let shared=table.clone();
  let closure=Closure::wrap(Box::new(move|id:f64,stale:f64,a:JsValue,b:JsValue|->JsValue{
   let handler=shared.borrow().get(&(id as u32)).cloned();
   match handler{
    Some(handler)=>match handler(a,b){Ok(value)=>value,Err(error)=>wasm_bindgen::throw_val(error)},
    None=>match stale as u32{0=>undef(),1=>JsValue::FALSE,2=>Promise::resolve(&undef()).into(),_=>Promise::resolve(&JsValue::FALSE).into()},
   }
  })as Box<dyn Fn(f64,f64,JsValue,JsValue)->JsValue>);
  let make=Function::new_with_args("dispatch","return function(id, stale){ return function(a, b){ return dispatch(id, stale, a, b); }; }");
  let factory=make.call1(&undef(),closure.as_ref()).unwrap_or(JsValue::UNDEFINED);
  Dispatch{table,next:Cell::new(0),factory,_closure:closure}
 }
}
/// The callbacks one owner handed out; they are withdrawn together when it goes.
#[derive(Default)]
pub struct Callbacks(RefCell<Vec<u32>>);
impl Callbacks{
 pub fn new()->Callbacks{Callbacks(RefCell::new(Vec::new()))}
 /// A function the host can call; `stale` is what it answers after this owner is dropped or `clear`ed.
 pub fn make(&self,stale:Stale,body:impl Fn(JsValue,JsValue)->R<JsValue>+'static)->JsValue{
  DISPATCH.with(|dispatch|{
   let id=dispatch.next.get().wrapping_add(1);dispatch.next.set(id);
   dispatch.table.borrow_mut().insert(id,Rc::new(body));
   self.0.borrow_mut().push(id);
   let kind=match stale{Stale::Undefined=>0.0,Stale::False=>1.0,Stale::Promise=>2.0,Stale::PromiseFalse=>3.0};
   call(&dispatch.factory,"factory",&[&f(id as f64),&f(kind)]).unwrap_or(JsValue::UNDEFINED)
  })
 }
 pub fn clear(&self){
  let ids=std::mem::take(&mut *self.0.borrow_mut());
  DISPATCH.with(|dispatch|{let mut table=dispatch.table.borrow_mut();for id in ids{table.remove(&id);}});
 }
}
impl Drop for Callbacks{fn drop(&mut self){self.clear();}}
/// The `Promise` of an `async` body: synchronous up to its first `await` (see `cloud_host::start`).
pub fn run(body:impl std::future::Future<Output=R<JsValue>>+'static)->JsValue{start(body).into()}
/// Like `run` for a floating `void asyncFunction()`: a rejection is an unhandled one, as in the original.
pub fn spawn(body:impl std::future::Future<Output=R<JsValue>>+'static){let _=start(body);}

// ---------------------------------------------------------------- animations
/// Web Animations with the original safety net: where `Element.animate` is missing (jsdom, old
/// engines) the final frame is applied and an already finished handle is returned.
pub fn animate(node:&JsValue,frames:&JsValue,timing:&JsValue)->R<JsValue>{
 if !get(node,"animate").is_function(){
  let list=Array::from(frames);
  let last=list.get(list.length().saturating_sub(1));
  let transform=get(&last,"transform");
  if truthy(&transform){style_prop(node,"transform",&text(&transform));}
  let opacity=get(&last,"opacity");
  if !nullish(&opacity){style_prop(node,"opacity",&text(&opacity));}
  return Ok(obj(&[("finished",&promise_resolve(&JsValue::UNDEFINED)),("cancel",&noop_function()),("isFallback",&JsValue::TRUE)]));
 }
 method(node,"animate",&[frames,timing])
}
pub fn noop_function()->JsValue{Function::new_no_args("").into()}
/// A `{transform}` frame etc. built as plain objects.
pub fn frame_of(entries:&[(&str,&JsValue)])->JsValue{obj(entries)}
/// `waitForMotion(motion, duration)`: resolves when the motion finishes, or releases a motion whose frames
/// stopped (a WebView can suspend RAF) by cancelling it; `false` then.
pub async fn wait_for_motion(motion:&JsValue,duration:f64)->R<bool>{
 let watchdog:Rc<RefCell<Option<Timer>>>=Rc::new(RefCell::new(None));
 let result=wait_inner(motion,duration,watchdog.clone()).await;
 let timer=watchdog.borrow_mut().take();
 if let Some(timer)=timer{cancel(&timer);}
 result
}
async fn wait_inner(motion:&JsValue,duration:f64,watchdog:Rc<RefCell<Option<Timer>>>)->R<bool>{
 // motion.finished?.then(value => value !== false, () => true) ?? Promise.resolve(true)
 let finished=get(motion,"finished");
 let first:JsValue=if nullish(&finished){promise_resolve(&JsValue::TRUE)}else{
  let mapped=then_map(&finished,|value|Ok(b(!matches!(value.as_bool(),Some(false)))),|_|Ok(JsValue::TRUE))?;mapped
 };
 let (second,resolve,_)=deferred();
 let motion_for_check=motion.clone();
 fn arm(watchdog:&Rc<RefCell<Option<Timer>>>,delay:f64,motion:JsValue,resolve:Function){
  let again=watchdog.clone();
  let timer=after(delay,move||{
   let last=get(&motion,"lastFrameTime");
   if is_finite(&last)&&now()-num(&last)<1500.0{arm(&again,1500.0,motion.clone(),resolve.clone());}
   else{let _=resolve.call1(&JsValue::UNDEFINED,&JsValue::FALSE);}
   Ok(())
  });
  *watchdog.borrow_mut()=Some(timer);
 }
 arm(&watchdog,duration+1500.0,motion_for_check,resolve);
 let race=Promise::race(&Array::of2(&first,&second));
 let completed=JsFuture::from(race).await?;
 let completed=truthy(&completed);
 if !completed{let _=method_opt(motion,"cancel",&[]);}
 Ok(completed)
}
/// `promise.then(map_ok, map_err)` returning the derived promise.
pub fn then_map(promise:&JsValue,ok:impl FnOnce(JsValue)->R<JsValue>+'static,err:impl FnOnce(JsValue)->R<JsValue>+'static)->R<JsValue>{
 let pair:Rc<RefCell<Option<(Closure<dyn FnMut(JsValue)->JsValue>,Closure<dyn FnMut(JsValue)->JsValue>)>>>=Rc::new(RefCell::new(None));
 let ok=RefCell::new(Some(ok));let err=RefCell::new(Some(err));
 let fulfilled={let pair=pair.clone();Closure::wrap(Box::new(move|value:JsValue|->JsValue{
  let work=ok.borrow_mut().take();
  let result=match work{Some(work)=>work(value),None=>Ok(JsValue::UNDEFINED)};
  let released=pair.borrow_mut().take();drop(released);
  match result{Ok(value)=>value,Err(error)=>wasm_bindgen::throw_val(error)}
 })as Box<dyn FnMut(JsValue)->JsValue>)};
 let rejected={let pair=pair.clone();Closure::wrap(Box::new(move|value:JsValue|->JsValue{
  let work=err.borrow_mut().take();
  let result=match work{Some(work)=>work(value),None=>Ok(JsValue::UNDEFINED)};
  let released=pair.borrow_mut().take();drop(released);
  match result{Ok(value)=>value,Err(error)=>wasm_bindgen::throw_val(error)}
 })as Box<dyn FnMut(JsValue)->JsValue>)};
 let derived=method(promise,"then",&[fulfilled.as_ref(),rejected.as_ref()])?;
 *pair.borrow_mut()=Some((fulfilled,rejected));
 Ok(derived)
}

/// A counter shared by one wasm instance, like the module-level `let` of the original.
pub struct Counter(Cell<u32>);
impl Counter{pub const fn new()->Counter{Counter(Cell::new(0))}pub fn next(&self)->u32{self.0.set(self.0.get()+1);self.0.get()}}
