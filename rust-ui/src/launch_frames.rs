//! Saving the settled shelf as the next launch's first paint (the `save` step of
//! `rememberLaunchFrames` in src/js/shelf-launch-cache.js). The host keeps the per-frame observer and
//! its timer, the IndexedDB store, the key's hash and the launch state shared with the boot preview;
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
