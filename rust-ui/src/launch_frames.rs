//! Saving the settled shelf as the next launch's first paint (the `save` step of
//! `rememberLaunchFrames` in src/js/shelf-launch-cache.js), and its observer, timer and page listeners. The
//! host keeps the IndexedDB store, the key's hash and the launch state shared with the boot preview;
//! this decides whether the canvas is settled enough and runs the save, re-checking after every wait.
use wasm_bindgen::prelude::*;
use js_sys::{Array,Function,Object,Promise,Reflect};
use crate::host::{absent,get,global,method,num,read,text,truthy};
use crate::cloud_host::{settle,start};
type R<T=()>=Result<T,JsValue>;

fn document()->R<JsValue>{read(&global(),"document")}
fn data(node:&JsValue,key:&str)->R<JsValue>{read(&read(node,"dataset")?,key)}

/// A canvas that shows a settled, unzoomed, unscrolled room nobody is using.
fn usable(host:&JsValue,node:&JsValue)->R<bool>{
 if truthy(&read(host,"stopped")?)||truthy(&read(&document()?,"hidden")?)||!truthy(&method(host,"isIdle",&[])?){return Ok(false)}
 if absent(node)||!truthy(&read(node,"isConnected")?){return Ok(false)}
 if !(num(&data(node,"renderCount")?)>0.0)||!text(&data(node,"animating")?,"false")||num(&data(node,"bookQualityPending")?)!=0.0{return Ok(false)}
 if !(num(&read(node,"width")?)*num(&read(node,"height")?)<=4.0*1024.0*1024.0){return Ok(false)}
 let zoom=data(node,"inspectionZoom")?;
 if (if truthy(&zoom){num(&zoom)}else{1.0})!=1.0{return Ok(false)}
 let pan=data(node,"inspectionPan")?;
 if truthy(&pan){
  let values=js_sys::JSON::parse(&crate::host::text_of(&pan))?;
  if !Array::is_array(&values){return Err(js_sys::TypeError::new("inspectionPan.every is not a function").into())}
  if !Array::from(&values).iter().all(|value|value.as_f64()==Some(0.0)){return Ok(false)}
 }
 let scroller=method(node,"closest",&[&".ihr-bookshelf__scroll".into()])?;
 if !absent(&scroller)&&truthy(&read(&scroller,"scrollTop")?){return Ok(false)}
 if truthy(&method(&read(host,"root")?,"querySelector",&[&".ihr-library-loading".into()])?){return Ok(false)}
 Ok(!truthy(&method(&document()?,"querySelector",&[&".ihr-flyout".into()])?))
}
fn current(host:&JsValue,revision:f64)->R<bool>{Ok(num(&read(host,"generation")?)==revision)}

/// Saves the room shown by `root`'s canvas when it is still the one of `revision` after each wait. Cache
/// eviction, tainted images and quota never block the app: any failure leaves the previous frame.
#[wasm_bindgen]
pub fn shelf_save_launch_frame(host:JsValue,revision:f64)->Promise{start(async move{
 let _ignored:R=async{
  let node=method(&read(&host,"root")?,"querySelector",&[&"canvas.ihr-bookshelf-scene".into()])?;
  if !usable(&host,&node)?||!current(&host,revision)?{return Ok(())}
  let count=data(&node,"renderCount")?;
  let records=settle(method(&host,"books",&[])).await?;
  let state=method(&host,"launchState",&[&records])?;
  let key=settle(method(&host,"launchKey",&[&state])).await?;
  if !usable(&host,&node)?||!current(&host,revision)?||data(&node,"renderCount")?!=count{return Ok(())}
  let rect=method(&node,"getBoundingClientRect",&[])?;
  // The canvas snapshot API materializes the already resolved native GPU frame. PNG preserves every
  // pixel; it does not re-render scene geometry.
  let snapshot=node.clone();
  let image=settle(Ok(Promise::new(&mut|resolve:Function,reject:Function|{
   if let Err(error)=method(&snapshot,"toBlob",&[&resolve,&"image/png".into()]){let _=reject.call1(&JsValue::UNDEFINED,&error);}
  }).into())).await?;
  if !usable(&host,&node)?||!current(&host,revision)?||data(&node,"renderCount")?!=count{return Ok(())}
  let latest=settle(method(&host,"books",&[])).await?;
  if read(&method(&host,"launchState",&[&latest])?,"text")?!=read(&state,"text")?{return Ok(())}
  let frame=Object::new();
  for (name,value) in [("key",key.clone()),("image",image),("x",read(&rect,"x")?),("y",read(&rect,"y")?),("width",read(&rect,"width")?),("height",read(&rect,"height")?)]{
   Reflect::set(&frame,&name.into(),&value)?;
  }
  let window=global();
  if truthy(&method(&host,"validLaunchFrame",&[&frame,&key,&get(&window,"innerWidth"),&get(&window,"innerHeight")])?){
   settle(method(&host,"writeLaunchFrame",&[&frame])).await?;
  }
  Ok(())
 }.await;
 Ok(JsValue::UNDEFINED)
})}

// ---- rememberLaunchFrames' observer, timer and page listeners (formerly src/js/shelf-launch-cache.js) ----

fn bound(exports:&JsValue,name:&str,args:&[&JsValue])->R<JsValue>{
 let list=Array::new();list.push(&JsValue::UNDEFINED);for argument in args{list.push(argument);}
 let function:Function=read(exports,name)?.dyn_into()?;
 Reflect::apply(&read(&function,"bind")?.dyn_into()?,&function,&list)
}
fn put(host:&JsValue,key:&str,value:&JsValue)->R{Reflect::set(host,&key.into(),value)?;Ok(())}

/// Every change to the root (a new frame included) restarts a one-second timer, after which an idle slice
/// (`idle(callback)`) saves that revision; a page that leaves for good stops, a page put in the back/forward
/// cache only drops its pending save and starts again when shown. `host` is the save's host (`root`,
/// `generation`, `stopped`, `isIdle`, `books` and the store and launch-state functions); the observer's and
/// listeners' callbacks are this module's exports bound to it (`exports`), so nothing here holds a closure.
/// Answers `stop`.
#[wasm_bindgen]
pub fn shelf_remember_launch_frames(host:JsValue,idle:JsValue,exports:JsValue)->R<JsValue>{
 put(&host,"timer",&JsValue::from_f64(0.0))?;
 put(&host,"idle",&idle)?;
 put(&host,"exports",&exports)?;
 let schedule=bound(&exports,"shelf_launch_schedule",&[&host])?;
 let observer=crate::host::construct("MutationObserver",&[&schedule])?;
 put(&host,"observer",&observer)?;
 let options=Object::new();
 for (key,value) in [("childList",JsValue::TRUE),("subtree",JsValue::TRUE),("attributes",JsValue::TRUE),
  ("attributeFilter",Array::of1(&"data-render-count".into()).into())]{Reflect::set(&options,&key.into(),&value)?;}
 method(&observer,"observe",&[&read(&host,"root")?,&options])?;
 let stop=bound(&exports,"shelf_launch_stop",&[&host])?;
 method(&global(),"addEventListener",&[&"pagehide".into(),&bound(&exports,"shelf_launch_page_hide",&[&host])?])?;
 method(&global(),"addEventListener",&[&"pageshow".into(),&bound(&exports,"shelf_launch_page_show",&[&host])?])?;
 shelf_launch_schedule(&host)?;
 Ok(stop)
}
/// A new revision: the pending save is dropped and this one waits a second, then an idle slice.
#[wasm_bindgen]
pub fn shelf_launch_schedule(host:&JsValue)->R{
 let revision=num(&read(host,"generation")?)+1.0;
 put(host,"generation",&JsValue::from_f64(revision))?;
 crate::host::clear_timeout(&read(host,"timer")?)?;
 let fire=bound(&read(host,"exports")?,"shelf_launch_timer",&[host,&JsValue::from_f64(revision)])?;
 put(host,"timer",&crate::host::set_timeout(&fire,1000.0)?)
}
#[wasm_bindgen]
pub fn shelf_launch_timer(host:&JsValue,revision:f64)->R{
 let save=bound(&read(host,"exports")?,"shelf_launch_save",&[host,&JsValue::from_f64(revision)])?;
 crate::host::call(&read(host,"idle")?,"idle",&[&save])?;Ok(())
}
#[wasm_bindgen]
pub fn shelf_launch_save(host:JsValue,revision:f64){let _=shelf_save_launch_frame(host,revision);}
#[wasm_bindgen]
pub fn shelf_launch_stop(host:&JsValue)->R{
 put(host,"stopped",&JsValue::TRUE)?;
 put(host,"generation",&JsValue::from_f64(num(&read(host,"generation")?)+1.0))?;
 crate::host::clear_timeout(&read(host,"timer")?)?;
 method(&read(host,"observer")?,"disconnect",&[])?;Ok(())
}
#[wasm_bindgen]
pub fn shelf_launch_page_hide(host:&JsValue,event:&JsValue)->R{
 if !truthy(&read(event,"persisted")?){return shelf_launch_stop(host)}
 put(host,"generation",&JsValue::from_f64(num(&read(host,"generation")?)+1.0))?;
 crate::host::clear_timeout(&read(host,"timer")?)
}
#[wasm_bindgen]
pub fn shelf_launch_page_show(host:&JsValue,event:&JsValue)->R{if truthy(&read(event,"persisted")?){shelf_launch_schedule(host)}else{Ok(())}}
