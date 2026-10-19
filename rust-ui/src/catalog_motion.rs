//! Catalogue flight policy. Web Animations and timer callbacks remain browser
//! objects; the GC-owned flight record avoids retaining callbacks across Rust.
use wasm_bindgen::{prelude::*,JsCast};
use js_sys::{Array,Reflect};
use crate::host::{read,set,method,num,truthy,call,call_opt};
use crate::cloud_host::object;
type R<T> = Result<T,JsValue>;
fn s(value:&str)->JsValue{JsValue::from_str(value)}
fn array(values:&[JsValue])->JsValue{let out=Array::new();for value in values{out.push(value);}out.into()}
fn invoke(host:&JsValue,name:&str,args:&[&JsValue])->R<JsValue>{call(&read(host,name)?,name,args)}
fn style(node:&JsValue)->R<JsValue>{read(node,"style")}
fn transform(value:JsValue)->JsValue{object(&[("transform",value)])}
fn page_frame(transform:JsValue,opacity:f64,offset:f64)->JsValue{object(&[("transform",transform),("opacity",opacity.into()),("offset",offset.into())])}

#[wasm_bindgen]
pub fn catalog_motion_frames(host:JsValue,from:JsValue)->R<JsValue>{
 let global=read(&host,"global")?;let dialog=read(&host,"dialog")?;
 let media=read(&global,"matchMedia")?;
 let reduced=media.is_function()&&truthy(&read(&call(&media,"matchMedia",&[&s("(prefers-reduced-motion: reduce)")])?,"matches")?);
 if reduced||!read(&dialog,"animate")?.is_function()||from.dyn_ref::<web_sys::Element>().is_none()||!truthy(&read(&from,"isConnected")?)||truthy(&read(&from,"hidden")?){return Ok(JsValue::NULL);}
 let target=read(&host,"motionTarget")?;
 let stage=if target.is_function(){call(&target,"motionTarget",&[])?}else{JsValue::NULL};
 if stage.dyn_ref::<web_sys::Element>().is_none()||!read(&stage,"animate")?.is_function(){return Ok(JsValue::NULL);}
 let booklet=invoke(&host,"bookletRect",&[&from])?;
 if num(&read(&booklet,"bottom")?)<=0.0||num(&read(&booklet,"right")?)<=0.0||num(&read(&booklet,"top")?)>=num(&read(&global,"innerHeight")?)||num(&read(&booklet,"left")?)>=num(&read(&global,"innerWidth")?){return Ok(JsValue::NULL);}
 let frames=invoke(&host,"catalogCameraFrames",&[&booklet,&method(&dialog,"getBoundingClientRect",&[])?,&method(&stage,"getBoundingClientRect",&[]) ?])?;
 if !truthy(&frames){return Ok(frames);}
 // The geometry producer returns a fresh frame record; no consumer retains it.
 set(&frames,"room",&stage)?;Ok(frames)
}

#[wasm_bindgen]
pub fn catalog_after_paint(host:JsValue,work:JsValue)->R<JsValue>{
 let global=read(&host,"global")?;
 if read(&global,"requestAnimationFrame")?.is_function(){
  let callback=invoke(&host,"paintCallback",&[&work])?;
  method(&global,"requestAnimationFrame",&[&callback])
 }else{call(&work,"work",&[])}
}

#[wasm_bindgen]
pub fn catalog_paint_task(global:JsValue,work:JsValue)->R<JsValue>{method(&global,"setTimeout",&[&work,&0.into()])}

#[wasm_bindgen]
pub fn catalog_motion_end(host:JsValue)->R<JsValue>{call_opt(&read(&host,"onMotion")?,"onMotion",&[&s("end")])}

#[wasm_bindgen]
pub fn catalog_begin_flight(host:JsValue,phase:JsValue,frames:JsValue,done:JsValue,ended:JsValue)->R<JsValue>{
 let inward=phase==s("opening");let stage=read(&frames,"room")?;
 let stage_style=style(&stage)?;let dialog=read(&host,"dialog")?;let paper=read(&host,"paper")?;
 let previous=object(&[("origin",read(&stage_style,"transformOrigin")?),("willChange",read(&stage_style,"willChange")?)]);
 set(&stage_style,"transformOrigin",&s("0 0"))?;set(&stage_style,"willChange",&s("transform"))?;
 set(&style(&dialog)?,"transformOrigin",&s("0 0"))?;
 set(&read(&dialog,"dataset")?,"catalogCamera",&phase)?;set(&paper,"inert",&(!inward).into())?;
 call_opt(&read(&host,"onMotion")?,"onMotion",&[&s("start")])?;
 let duration=read(&host,"duration")?;
 let timing=object(&[("duration",duration.clone()),("easing",read(&host,"easing")?),("fill",s("both"))]);
 let identity=read(&host,"identity")?;let frame_stage=read(&frames,"stage")?;let frame_page=read(&frames,"page")?;
 let room_frames=if inward{array(&[transform(identity.clone()),transform(frame_stage)])}else{array(&[transform(frame_stage),transform(identity.clone())])};
 let room=method(&stage,"animate",&[&room_frames,&timing])?;
 let page_frames=if inward{array(&[page_frame(frame_page,0.0,0.0),object(&[("opacity",1.into()),("offset",0.32.into())]),page_frame(identity,1.0,1.0)])}
 else{array(&[page_frame(identity,1.0,0.0),object(&[("opacity",1.into()),("offset",0.68.into())]),page_frame(frame_page,0.0,1.0)])};
 let page=method(&dialog,"animate",&[&page_frames,&timing])?;
 let state=object(&[("inward",inward.into()),("stage",stage),("previous",previous),("room",room.clone()),("page",page),("done",done),("ended",ended),("landed",false.into()),("safety",0.into())]);
 let callbacks=invoke(&host,"makeFlightCallbacks",&[&state])?;
 set(&state,"guard",&read(&callbacks,"guard")?)?;
 method(&read(&room,"finished")?,"then",&[&read(&callbacks,"complete")?,&read(&host,"ignore")?])?;
 let safety=method(&read(&host,"global")?,"setTimeout",&[&read(&callbacks,"guard")?,&(num(&duration)+400.0).into()])?;
 set(&state,"safety",&safety)?;
 Ok(object(&[("phase",phase),("land",read(&callbacks,"land")?)]))
}

#[wasm_bindgen]
pub fn catalog_land_flight(host:JsValue,state:JsValue,options:JsValue)->R<JsValue>{
 let quiet=if options.is_undefined(){JsValue::FALSE}else{read(&options,"quiet")?};
 if truthy(&read(&state,"landed")?){return Ok(JsValue::UNDEFINED);}
 set(&state,"landed",&JsValue::TRUE)?;
 method(&read(&host,"global")?,"clearTimeout",&[&read(&state,"safety")?])?;
 let dialog=read(&host,"dialog")?;let dataset=read(&dialog,"dataset")?;
 if truthy(&read(&state,"inward")?){set(&dataset,"catalogCamera",&s("in"))?;}else{Reflect::delete_property(dataset.unchecked_ref(),&s("catalogCamera"))?;}
 method(&read(&state,"room")?,"cancel",&[])?;method(&read(&state,"page")?,"cancel",&[])?;
 let stage_style=style(&read(&state,"stage")?)?;let previous=read(&state,"previous")?;
 set(&stage_style,"transformOrigin",&read(&previous,"origin")?)?;set(&stage_style,"willChange",&read(&previous,"willChange")?)?;
 set(&style(&dialog)?,"transformOrigin",&s(""))?;set(&read(&host,"paper")?,"inert",&JsValue::FALSE)?;
 invoke(&state,"ended",&[])?;
 let result=if truthy(&quiet){Ok(JsValue::UNDEFINED)}else{invoke(&state,"done",&[])};
 // As with JS finally, scheduling errors replace a failing done callback.
 let finish=read(&host,"finishMotion")?;catalog_after_paint(host,finish)?;result.map(|_|JsValue::UNDEFINED)
}

#[wasm_bindgen]
pub fn catalog_guard_flight(host:JsValue,state:JsValue)->R<JsValue>{
 if read(&read(&state,"room")?,"playState")?==s("running")&&read(&read(&host,"document")?,"visibilityState")?!=s("hidden"){
  let safety=method(&read(&host,"global")?,"setTimeout",&[&read(&state,"guard")?,&250.into()])?;
  set(&state,"safety",&safety)?;Ok(JsValue::UNDEFINED)
 }else{catalog_land_flight(host,state,JsValue::UNDEFINED)}
}
