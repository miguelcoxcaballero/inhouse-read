//! Inspection quality replacement and repaint batching. The browser only creates
//! Three objects, settles promises and schedules the delay Rust returns. Geometry,
//! maps, materials and final texture resolution are unchanged.
use wasm_bindgen::prelude::*;
use js_sys::{Array,Object};
use crate::host::{get,set,truthy,method,method_opt,num};
use crate::scene_view::RustScene;
type R<T=()> = Result<T,JsValue>;
fn st(s:&str)->JsValue{JsValue::from_str(s)}
fn flag(o:&JsValue,key:&str)->bool{truthy(&get(o,key))}
fn invoke(env:&JsValue,name:&str,args:&[&JsValue])->R<JsValue>{method(env,name,args)}
fn matches(model:&JsValue,entry:&JsValue)->bool{
 let data=get(model,"userData");let resolution=get(&data,"inspectionResolution");
 JsValue::from_bool(flag(&data,"overview"))==get(entry,"overview") &&
 (if truthy(&resolution){resolution}else{0.into()})==get(entry,"inspectionResolution")
}
fn blocked(entry:&JsValue)->R<bool>{
 if flag(entry,"trashDrop")||flag(entry,"insertion"){return Ok(true);}
 let node=get(entry,"node");if node.is_null()||node.is_undefined(){return Ok(false);}
 let classes=get(&node,"classList");
 Ok(truthy(&method(&classes,"contains",&[&st("is-away")])?)||truthy(&method(&classes,"contains",&[&st("is-dragging")])?))
}
#[wasm_bindgen]
pub fn scene_quality_matches(model:&JsValue,entry:&JsValue)->bool{matches(model,entry)}

/// Preparing an invisible candidate changes no pixels of the retained room.
/// Only its completed transaction, or a later update of the visible model,
/// asks for a paint. Keep immediate invalidation for the legacy cadence.
#[wasm_bindgen]
pub fn scene_quality_invalidate(entry:&JsValue,model:&JsValue,env:&JsValue)->R{
 if flag(env,"batchQuality")&&flag(entry,"qualityReplacement")&&get(entry,"replacement")==*model{
  if flag(entry,"replacementReady"){invoke(env,"notify",&[])?;}
 }else{invoke(env,"invalidateCurrent",&[entry])?;}
 Ok(())
}

#[wasm_bindgen]
pub fn scene_prepare_quality(entry:JsValue,env:JsValue)->R{
 let model=get(&entry,"model");let data=get(&model,"userData");
 if get(&entry,"kind")==st("plant")&&flag(&data,"prepareSurfaceQuality"){
  if flag(&entry,"replacement")||get(&get(&entry,"plantQuality"),"resolution")==get(&entry,"inspectionResolution"){return Ok(());}
  let prior=get(&get(&entry,"plantQuality"),"plan");method_opt(&prior,"dispose",&[])?;
  let plan=method(&data,"prepareSurfaceQuality",&[&get(&entry,"inspectionResolution")])?;
  let pending:JsValue=Object::new().into();
  for(key,value)in[("model",model.clone()),("plan",plan.clone()),("resolution",get(&entry,"inspectionResolution")),("ready",JsValue::FALSE)]{set(&pending,key,&value)?;}
  set(&entry,"plantQuality",&pending)?;
  invoke(&env,"watch",&[&get(&plan,"ready"),&entry,&pending,&model,&JsValue::TRUE])?;return Ok(());
 }
 if flag(&entry,"qualityReplacement")&&flag(&entry,"replacement")&&!matches(&get(&entry,"replacement"),&entry){invoke(&env,"cancelReplacement",&[&entry])?;}
 if flag(&entry,"replacement"){return Ok(());}
 let replacement=invoke(&env,"makeModel",&[&entry])?;
 set(&entry,"replacement",&replacement)?;set(&entry,"qualityReplacement",&JsValue::TRUE)?;
 invoke(&env,"watch",&[&get(&get(&replacement,"userData"),"ready"),&entry,&replacement,&model,&JsValue::FALSE])?;Ok(())
}

/// The host's promise continuation forwards values only; all validity and
/// replacement decisions live here. No persistent WASM closure owns a node.
#[wasm_bindgen]
pub fn scene_quality_complete(entry:&JsValue,env:&JsValue,pending:&JsValue,previous:&JsValue,plant:bool,loaded:&JsValue,rejected:bool)->R{
 if plant{
  let plan=get(pending,"plan");
  if rejected{method(&plan,"dispose",&[])?;if get(entry,"plantQuality")==*pending{set(entry,"plantQuality",&JsValue::NULL)?;}return Ok(());}
  if flag(env,"disposed")||get(entry,"plantQuality")!=*pending||get(entry,"model")!=*previous{method(&plan,"dispose",&[])?;return Ok(());}
  if !truthy(loaded){method(&plan,"dispose",&[])?;set(entry,"plantQuality",&JsValue::NULL)?;return Ok(());}
  set(pending,"ready",&JsValue::TRUE)?;
 }else{
  if rejected{if get(entry,"replacement")==*pending{invoke(env,"cancelReplacement",&[entry])?;}return Ok(());}
  if flag(env,"disposed")||get(entry,"replacement")!=*pending||get(entry,"model")!=*previous{invoke(env,"releaseCandidate",&[pending])?;return Ok(());}
  if *loaded==JsValue::FALSE&&truthy(previous)&&flag(entry,"coverUrl"){invoke(env,"cancelReplacement",&[entry])?;return Ok(());}
  set(entry,"replacementReady",&JsValue::TRUE)?;
 }
 invoke(env,"notify",&[])?;Ok(())
}
#[wasm_bindgen]
pub fn scene_apply_quality(entry:&JsValue,env:&JsValue)->R{
 let pending=get(entry,"plantQuality");
 if truthy(&pending){
  let plan=get(&pending,"plan");
  if get(entry,"model")!=get(&pending,"model")||get(&pending,"resolution")!=get(entry,"inspectionResolution"){
   method(&plan,"dispose",&[])?;set(entry,"plantQuality",&JsValue::NULL)?;
  }else if flag(&pending,"ready")&&!blocked(entry)?{
   method(&plan,"apply",&[])?;method(&plan,"dispose",&[])?;set(entry,"plantQuality",&JsValue::NULL)?;
  }
  return Ok(());
 }
 if flag(entry,"qualityReplacement")&&flag(entry,"replacement")&&!matches(&get(entry,"replacement"),entry){invoke(env,"cancelReplacement",&[entry])?;return Ok(());}
 if !flag(entry,"qualityReplacement")||!flag(entry,"replacementReady")||blocked(entry)?{return Ok(());}
 let previous=get(entry,"model");let replacement=get(entry,"replacement");
 set(entry,"model",&replacement)?;set(entry,"replacement",&JsValue::NULL)?;
 set(entry,"qualityReplacement",&JsValue::FALSE)?;set(entry,"replacementReady",&JsValue::FALSE)?;
 method(&get(env,"furniture"),"add",&[&replacement])?;
 invoke(env,"programsChanged",&[])?;
 method_opt(&previous,"removeFromParent",&[])?;method_opt(&get(&previous,"userData"),"dispose",&[])?;Ok(())
}

/// Coalesce staggered decodes into one full-quality paint, with a 48 ms bound
/// from the first arrival. Fingers never wait for this timer. A slow/failing
/// decoder cannot hold the other ready models indefinitely.
#[wasm_bindgen]
pub fn scene_quality_delay(entries:&Array,state:&JsValue,moving:bool,now:f64)->R<f64>{
 let loading=entries.iter().any(|entry|flag(&entry,"qualityReplacement")&&!flag(&entry,"replacementReady")||{
  let pending=get(&entry,"plantQuality");truthy(&pending)&&!flag(&pending,"ready")
 });
 if moving||!loading{set(state,"deadline",&0.into())?;return Ok(0.0);}
 let mut deadline=num(&get(state,"deadline"));
 if deadline==0.0||!deadline.is_finite(){deadline=now+48.0;set(state,"deadline",&deadline.into())?;}
 Ok((deadline-now).max(0.0))
}

/// Keep the accurate last finger frame while a zoom's book/plant maps finish.
/// The bounded fallback commits available work even if one decoder is slow.
#[wasm_bindgen]
pub fn scene_quality_hold(entries:&Array,state:&JsValue,scene:&RustScene,eligible:bool,now:f64)->R<f64>{
 if !eligible||!scene.can_inspect()||scene.moving()||scene.reordering(){set(state,"paintDeadline",&0.into())?;return Ok(0.0);}
 let loading=entries.iter().any(|entry|flag(&entry,"qualityReplacement")&&!flag(&entry,"replacementReady")||{
  let pending=get(&entry,"plantQuality");truthy(&pending)&&!flag(&pending,"ready")
 });
 if !loading{set(state,"paintDeadline",&0.into())?;return Ok(0.0);}
 let mut deadline=num(&get(state,"paintDeadline"));
 if deadline==0.0||!deadline.is_finite(){deadline=now+240.0;set(state,"paintDeadline",&deadline.into())?;}
 Ok((deadline-now).max(0.0))
}

/// Commit the projected quality target in one crossing per entry. The model
/// remains visible until its exact replacement has finished preparation.
#[wasm_bindgen]
pub fn scene_update_quality(entry:&JsValue,env:&JsValue,overview:bool,resolution:f64)->R{
 set(entry,"overview",&overview.into())?;set(entry,"inspectionResolution",&resolution.into())?;
 if flag(entry,"model")&&!matches(&get(entry,"model"),entry){scene_prepare_quality(entry.clone(),env.clone())?;}
 scene_apply_quality(entry,env)
}
