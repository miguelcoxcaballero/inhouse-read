//! One native canvas remains owned until its real output changes hands. Foreign renderers finish
//! their paint AND export before the visible owner restores its frame; no second WebGL context is
//! created here. A lease is a plain object (`canvas` plus methods) so its holders can compare it by
//! identity and annotate it, as before.
use std::cell::Cell;
use wasm_bindgen::{prelude::*,JsCast};
use js_sys::{Object,WeakMap,WeakSet};
use crate::host::*;

thread_local!{
 // renderer -> the lease that owns its canvas; renderers being restored.
 static OWNERS:WeakMap=WeakMap::new();
 static RESTORING:WeakSet=WeakSet::new();
}
/// WeakMap/WeakSet keys must be objects: lookups of anything else find nothing, stores throw.
fn key(value:&JsValue)->Option<Object>{if value.is_object()||value.is_function(){Some(value.clone().unchecked_into::<Object>())}else{None}}
fn map_get(map:&WeakMap,at:&JsValue)->JsValue{key(at).map(|object|map.get(&object)).unwrap_or(JsValue::UNDEFINED)}
fn map_set(map:&WeakMap,at:&JsValue,value:&JsValue)->Result<(),JsValue>{
 let object=key(at).ok_or_else(||js_sys::TypeError::new("Invalid value used as weak map key"))?;map.set(&object,value);Ok(())
}
fn map_delete(map:&WeakMap,at:&JsValue){if let Some(object)=key(at){map.delete(&object);}}
fn owner_of(renderer:&JsValue)->JsValue{OWNERS.with(|owners|map_get(owners,renderer))}

/// `{ snapshot = fallback } = {}` as a parameter list reads it: nothing means the fallback, `null`
/// cannot be destructured, anything else supplies `snapshot` unless that is undefined.
fn snapshot_option(options:&JsValue,fallback:bool)->Result<bool,JsValue>{
 if options.is_undefined(){return Ok(fallback);}
 if options.is_null(){return Err(js_sys::TypeError::new("Cannot destructure property 'snapshot' of 'object null' as it is null.").into());}
 let value=read(options,"snapshot")?;
 Ok(if value.is_undefined(){fallback}else{truthy(&value)})
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

/// The Rust half of one lease: its flags and its rules. The lease the holders see is a plain
/// object (see native-renderer-presentation.js) that keeps the renderer, canvas, context and
/// callbacks itself and hands them over with every call, together with its own identity, so it can
/// be annotated and compared as before. Nothing host-owned is retained here: callbacks that reach
/// their own holder cannot make a cycle through this module that the host's collector cannot see.
#[wasm_bindgen]
pub struct NativeLease{disposed:Cell<bool>,revision:Cell<f64>,materialized:Cell<f64>,capturing:Cell<bool>}

#[wasm_bindgen]
impl NativeLease{
 #[wasm_bindgen(constructor)]
 pub fn new()->NativeLease{NativeLease{disposed:Cell::new(false),revision:Cell::new(1.0),materialized:Cell::new(0.0),capturing:Cell::new(false)}}
 #[wasm_bindgen(js_name=isOwner)]
 pub fn is_owner(&self,lease:&JsValue,parts:&JsValue)->Result<bool,JsValue>{Ok(!self.disposed.get()&&owner_of(&read(parts,"renderer")?)==*lease)}
 #[wasm_bindgen(js_name=markDirty)]
 pub fn mark_dirty(&self){if !self.disposed.get(){self.revision.set(self.revision.get()+1.0);}}
 pub fn present(&self,lease:&JsValue,parts:&JsValue)->Result<bool,JsValue>{
  if self.disposed.get(){return Ok(false);}
  let renderer=read(parts,"renderer")?;
  let owner=owner_of(&renderer);
  if truthy(&owner)&&owner!=*lease{return Ok(false);}
  if !position_atomically(&read(&renderer,"domElement")?,&read(parts,"position")?)?{return Ok(false);}
  OWNERS.with(|owners|map_set(owners,&renderer,lease))?;opacity(&read(parts,"canvas")?,"0")?;Ok(true)
 }
 pub fn repaint(&self,parts:&JsValue)->Result<JsValue,JsValue>{if self.disposed.get(){Ok(JsValue::UNDEFINED)}else{call(&read(parts,"repaint")?,"repaint",&[])}}
 pub fn capture(&self,lease:&JsValue,parts:&JsValue)->Result<(),JsValue>{
  if self.disposed.get()||self.capturing.get()||self.materialized.get()==self.revision.get(){return Ok(());}
  let revision=self.revision.get();
  self.capturing.set(true);
  let outcome=(||->Result<(),JsValue>{
   let (capture,context)=(read(parts,"capture")?,read(parts,"context")?);
   let task=Closure::once_into_js(move||call(&capture,"capture",&[&context]));
   with_renderer_presentation(read(parts,"renderer")?,lease.clone(),task)?;
   self.materialized.set(revision);Ok(())
  })();
  self.capturing.set(false);outcome
 }
 #[wasm_bindgen(getter)]
 pub fn disposed(&self)->bool{self.disposed.get()}
 /// `target_live` says whether `next` is a lease that has not been disposed, `target_parts` are its parts.
 #[wasm_bindgen(js_name=transferTo)]
 pub fn transfer_to(&self,lease:&JsValue,parts:&JsValue,next:&JsValue,target_live:bool,target_parts:&JsValue)->Result<bool,JsValue>{
  let renderer=read(parts,"renderer")?;
  if !truthy(&method(lease,"isOwner",&[])?){return Ok(false);}
  if !target_live||read(target_parts,"renderer")?!=renderer{return Ok(false);}
  if !position_atomically(&read(&renderer,"domElement")?,&read(target_parts,"position")?)?{return Ok(false);}
  OWNERS.with(|owners|map_set(owners,&renderer,next))?;opacity(&read(target_parts,"canvas")?,"0")?;Ok(true)
 }
 pub fn release(&self,lease:&JsValue,parts:&JsValue,options:&JsValue)->Result<(),JsValue>{
  let snapshot=snapshot_option(options,true)?;
  if self.disposed.get(){return Ok(());}
  let renderer=read(parts,"renderer")?;
  if snapshot{method(lease,"capture",&[])?;}
  if owner_of(&renderer)==*lease{method(&read(&renderer,"domElement")?,"remove",&[])?;OWNERS.with(|owners|map_delete(owners,&renderer));}
  // A pending or transferred lease never exposes an older 2D snapshot. Only an explicit
  // successful snapshot release presents those pixels.
  if snapshot{opacity(&read(parts,"canvas")?,"")?;}
  Ok(())
 }
 pub fn dispose(&self,lease:&JsValue,parts:&JsValue,options:&JsValue)->Result<(),JsValue>{
  let snapshot=snapshot_option(options,false)?;
  if self.disposed.get(){return Ok(());}
  let options=Object::new();set(&options,"snapshot",&JsValue::from_bool(snapshot))?;
  method(lease,"release",&[&options])?;
  self.disposed.set(true);
  call_opt(&read(parts,"cleanup")?,"cleanup",&[])?;Ok(())
 }
}
