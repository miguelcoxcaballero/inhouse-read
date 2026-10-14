//! One native canvas remains owned until its real output changes hands. Foreign renderers finish
//! their paint AND export before the visible owner restores its frame; no second WebGL context is
//! created here. A lease is a plain object (`canvas` plus methods) so its holders can compare it by
//! identity and annotate it, as before.
use std::{cell::{Cell,RefCell},collections::HashMap,rc::{Rc,Weak}};
use wasm_bindgen::{prelude::*,JsCast};
use js_sys::{Array,Object,Reflect,WeakMap,WeakSet};
use crate::host::*;

thread_local!{
 // renderer -> the lease that owns its canvas; lease -> the id of its state; renderers being restored.
 static OWNERS:WeakMap=WeakMap::new();
 static IDS:WeakMap=WeakMap::new();
 static RESTORING:WeakSet=WeakSet::new();
 static STATES:RefCell<HashMap<u32,Weak<State>>>=RefCell::new(HashMap::new());
 static NEXT:Cell<u32>=const{Cell::new(0)};
}
/// WeakMap/WeakSet keys must be objects: lookups of anything else find nothing, stores throw.
fn key(value:&JsValue)->Option<Object>{if value.is_object()||value.is_function(){Some(value.clone().unchecked_into::<Object>())}else{None}}
fn map_get(map:&WeakMap,at:&JsValue)->JsValue{key(at).map(|object|map.get(&object)).unwrap_or(JsValue::UNDEFINED)}
fn map_set(map:&WeakMap,at:&JsValue,value:&JsValue)->Result<(),JsValue>{
 let object=key(at).ok_or_else(||js_sys::TypeError::new("Invalid value used as weak map key"))?;map.set(&object,value);Ok(())
}
fn map_delete(map:&WeakMap,at:&JsValue){if let Some(object)=key(at){map.delete(&object);}}
fn owner_of(renderer:&JsValue)->JsValue{OWNERS.with(|owners|map_get(owners,renderer))}

struct State{
 renderer:JsValue,canvas:JsValue,context:JsValue,capture:JsValue,repaint:JsValue,position:JsValue,cleanup:JsValue,
 disposed:Cell<bool>,revision:Cell<f64>,materialized:Cell<f64>,capturing:Cell<bool>,
}

/// Run `position(node)`; anything but `false` keeps the new placement, otherwise (or when it
/// throws) the node's style, class, aria-hidden state and DOM position are put back.
fn position_atomically(node:&JsValue,position:&JsValue)->Result<bool,JsValue>{
 let parent=read(node,"parentNode")?;let sibling=read(node,"nextSibling")?;
 let style=read(&read(node,"style")?,"cssText")?;let name=read(node,"className")?;
 let hidden=method(node,"getAttribute",&[&JsValue::from_str("aria-hidden")])?;
 if let Ok(placed)=call(position,"position",&[node]){if !is_false(&placed){return Ok(true);}}
 set(&read(node,"style")?,"cssText",&style)?;set(node,"className",&name)?;
 if absent(&hidden){method(node,"removeAttribute",&[&JsValue::from_str("aria-hidden")])?;}else{method(node,"setAttribute",&[&JsValue::from_str("aria-hidden"),&hidden])?;}
 if truthy(&parent){
  let sibling_parent=if absent(&sibling){JsValue::UNDEFINED}else{read(&sibling,"parentNode")?};
  let before=if !absent(&sibling)&&sibling_parent==parent{sibling}else{JsValue::NULL};
  method(&parent,"insertBefore",&[node,&before])?;
 }else{method(node,"remove",&[])?;}
 Ok(false)
}
fn is_false(value:&JsValue)->bool{*value==JsValue::FALSE}
fn opacity(canvas:&JsValue,value:&str)->Result<(),JsValue>{set(&read(canvas,"style")?,"opacity",&JsValue::from_str(value))}

/// The renderer's current native presenter, or `null`.
#[wasm_bindgen]
pub fn current_native_renderer_presentation(renderer:JsValue)->JsValue{let owner=owner_of(&renderer);if truthy(&owner){owner}else{JsValue::NULL}}

/// Synchronous render+copy transaction; restoration happens after the copy.
#[wasm_bindgen]
pub fn with_renderer_presentation(renderer:JsValue,consumer:JsValue,draw_task:JsValue)->Result<JsValue,JsValue>{
 let owner=owner_of(&renderer);
 let outcome=(||->Result<JsValue,JsValue>{
  let result=call(&draw_task,"drawTask",&[])?;
  if truthy(&result)&&read(&result,"then")?.is_function(){return Err(js_sys::TypeError::new("Renderer paint tasks must be synchronous").into());}
  Ok(result)
 })();
 // A complete insertion may have transferred to the room inside this task. Restoring that outgoing
 // book would overwrite the new room's actual pixels.
 if truthy(&owner)&&owner!=consumer&&owner_of(&renderer)==owner&&!key(&renderer).is_some_and(|object|RESTORING.with(|set|set.has(&object))){
  if let Some(object)=key(&renderer){RESTORING.with(|set|set.add(&object));}
  let restored=method(&owner,"repaint",&[]);
  if let Some(object)=key(&renderer){RESTORING.with(|set|set.delete(&object));}
  restored?;
 }
 outcome
}

/// capture(context) materializes the exact retained displayed frame into the supplied raw output
/// context. repaint() restores that same GPU frame without advancing a clock or acquiring another
/// lease. position(node) attaches and styles the renderer's existing canvas, returning false if it
/// cannot present. Returns `null` when the pieces are missing.
#[wasm_bindgen]
pub fn create_native_renderer_presentation(renderer:JsValue,options:JsValue)->Result<JsValue,JsValue>{
 let canvas=read(&options,"canvas")?;let context=read(&options,"context")?;let capture=read(&options,"capture")?;
 let repaint=read(&options,"repaint")?;let position=read(&options,"position")?;let cleanup=read(&options,"cleanup")?;
 if !truthy(&get(&renderer,"domElement"))||!truthy(&canvas)||!truthy(&context)||!capture.is_function()||!repaint.is_function()||!position.is_function(){return Ok(JsValue::NULL);}
 let state=Rc::new(State{renderer:renderer.clone(),canvas:canvas.clone(),context,capture,repaint,position,cleanup,
  disposed:Cell::new(false),revision:Cell::new(1.0),materialized:Cell::new(0.0),capturing:Cell::new(false)});
 let lease=Object::new();let lease_value:JsValue=lease.clone().into();
 set(&lease_value,"canvas",&canvas)?;
 let id=NEXT.with(|next|{next.set(next.get()+1);next.get()});
 STATES.with(|states|states.borrow_mut().insert(id,Rc::downgrade(&state)));
 IDS.with(|ids|map_set(ids,&lease_value,&JsValue::from_f64(f64::from(id))))?;
 // A method cannot name its receiver, and holding the lease strongly would pin it forever (lease ->
 // method -> state -> lease), so methods keep a WeakRef. The state is freed with the last method,
 // when the host collects a lease that was dropped without being disposed.
 let weak_lease=Reflect::construct(&get(&global(),"WeakRef").dyn_into::<js_sys::Function>()?,&Array::of1(&lease_value))?;
 let define=|name:&str,body:Box<dyn Fn(&Rc<State>,&JsValue,&[JsValue])->Result<JsValue,JsValue>>|->Result<(),JsValue>{
  let state=state.clone();let weak_lease=weak_lease.clone();
  let closure=Closure::wrap(Box::new(move|first:JsValue|{
   let lease=method(&weak_lease,"deref",&[])?;
   body(&state,&lease,&[first])
  })as Box<dyn FnMut(JsValue)->Result<JsValue,JsValue>>);
  set(&lease_value,name,closure.as_ref())?;
  closure.forget();Ok(())
 };
 define("isOwner",Box::new(|state,lease,_|Ok(JsValue::from_bool(!state.disposed.get()&&owner_of(&state.renderer)==*lease))))?;
 define("markDirty",Box::new(|state,_,_|{if !state.disposed.get(){state.revision.set(state.revision.get()+1.0);}Ok(JsValue::UNDEFINED)}))?;
 define("present",Box::new(|state,lease,_|{
  if state.disposed.get(){return Ok(JsValue::FALSE);}
  let owner=owner_of(&state.renderer);
  if truthy(&owner)&&owner!=*lease{return Ok(JsValue::FALSE);}
  if !position_atomically(&read(&state.renderer,"domElement")?,&state.position)?{return Ok(JsValue::FALSE);}
  OWNERS.with(|owners|map_set(owners,&state.renderer,lease))?;opacity(&state.canvas,"0")?;Ok(JsValue::TRUE)
 }))?;
 define("repaint",Box::new(|state,_,_|{if state.disposed.get(){Ok(JsValue::UNDEFINED)}else{call(&state.repaint,"repaint",&[])}}))?;
 define("capture",Box::new(|state,lease,_|{
  if state.disposed.get()||state.capturing.get()||state.materialized.get()==state.revision.get(){return Ok(JsValue::UNDEFINED);}
  let revision=state.revision.get();
  state.capturing.set(true);
  let outcome=(||->Result<(),JsValue>{
   let task={let state=state.clone();Closure::once_into_js(move||call(&state.capture,"capture",&[&state.context]))};
   with_renderer_presentation(state.renderer.clone(),lease.clone(),task)?;
   state.materialized.set(revision);Ok(())
  })();
  state.capturing.set(false);outcome?;Ok(JsValue::UNDEFINED)
 }))?;
 define("transferTo",Box::new(|state,lease,args|{
  let next=&args[0];
  let target=IDS.with(|ids|map_get(ids,next)).as_f64().and_then(|id|STATES.with(|states|states.borrow().get(&(id as u32)).and_then(Weak::upgrade)));
  if !truthy(&method(lease,"isOwner",&[])?){return Ok(JsValue::FALSE);}
  let Some(target)=target else{return Ok(JsValue::FALSE)};
  if target.disposed.get()||target.renderer!=state.renderer{return Ok(JsValue::FALSE);}
  if !position_atomically(&read(&state.renderer,"domElement")?,&target.position)?{return Ok(JsValue::FALSE);}
  OWNERS.with(|owners|map_set(owners,&state.renderer,next))?;opacity(&target.canvas,"0")?;Ok(JsValue::TRUE)
 }))?;
 define("release",Box::new(|state,lease,args|{
  let snapshot=if args[0].is_undefined()||absent(&args[0]){true}else{let value=get(&args[0],"snapshot");value.is_undefined()||truthy(&value)};
  if state.disposed.get(){return Ok(JsValue::UNDEFINED);}
  if snapshot{method(lease,"capture",&[])?;}
  if owner_of(&state.renderer)==*lease{method(&read(&state.renderer,"domElement")?,"remove",&[])?;OWNERS.with(|owners|map_delete(owners,&state.renderer));}
  // A pending or transferred lease never exposes an older 2D snapshot. Only an explicit
  // successful snapshot release presents those pixels.
  if snapshot{opacity(&state.canvas,"")?;}
  Ok(JsValue::UNDEFINED)
 }))?;
 define("dispose",Box::new(|state,lease,args|{
  let snapshot=if absent(&args[0]){false}else{truthy(&get(&args[0],"snapshot"))};
  if state.disposed.get(){return Ok(JsValue::UNDEFINED);}
  let options=Object::new();set(&options,"snapshot",&JsValue::from_bool(snapshot))?;
  method(lease,"release",&[&options])?;
  state.disposed.set(true);
  call_opt(&state.cleanup,"cleanup",&[])?;Ok(JsValue::UNDEFINED)
 }))?;
 Ok(lease_value)
}
