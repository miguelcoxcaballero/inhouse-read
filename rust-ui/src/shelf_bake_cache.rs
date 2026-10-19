//! Saved shelf paint policy. IndexedDB starts in the host before WASM finishes
//! loading; its raw result is adopted here on first use without delaying I/O.
//! Sessions isolate late reads and writes from a restarted or disabled cache.
use wasm_bindgen::prelude::*;
use js_sys::{Array,Map,Object,Promise};
use crate::host::*;
use crate::cloud_host::{copy_data_entries,data_entry};
type R<T> = Result<T,JsValue>;
fn obj(fields:&[(&str,JsValue)])->R<JsValue>{let result=Object::new();for(key,value)in fields{set(result.as_ref(),key,value)?;}Ok(result.into())}
fn at(value:&JsValue,index:u32)->R<JsValue>{read(value,&index.to_string())}
fn list(value:&JsValue)->R<Array>{Ok(method(&read(&global(),"Array")?,"from",&[value])?.unchecked_into())}
fn state(session:&JsValue)->R<JsValue>{
 let current=get(session,"policy");if !absent(&current){return Ok(current);}
 let build=read(session,"buildVersion")?;
 let version=if truthy(&build)&&truthy(&read(session,"factory")?){
  let build=method(&global(),"String",&[&build])?;
  let agent=method(&global(),"String",&[&read(session,"userAgent")?])?;
  method(&build,"concat",&[&"|".into(),&agent])?
 }else{JsValue::NULL};
 let result=obj(&[("version",version),("record",JsValue::NULL),("surfaces",Map::new().into()),("signature","".into()),("adopted",JsValue::FALSE),("timer",0.into()),("idle",JsValue::NULL),("epoch",0.into())])?;
 set(session,"policy",&result)?;Ok(result)
}
fn accept(value:&JsValue,version:&JsValue)->R<JsValue>{
 if absent(value)||read(value,"version")?!=*version{return Ok(JsValue::NULL);}
 let models=read(value,"models")?;if !Array::is_array(&models){return Ok(JsValue::NULL);}
 let surfaces=read(value,"surfaces")?;if !Array::is_array(&surfaces){return Ok(JsValue::NULL);}
 let accepted=Array::new();let painted=Array::new();
 for item in models.unchecked_into::<Array>().iter(){
  if Array::is_array(&item)&&at(&item,0)?.as_string().is_some()&&Array::is_array(&at(&item,2)?){accepted.push(&item);}
 }
 for item in surfaces.unchecked_into::<Array>().iter(){
  if Array::is_array(&item)&&at(&item,0)?.as_string().is_some()&&truthy(&at(&item,1)?){painted.push(&item);}
 }
 obj(&[("models",accepted.into()),("surfaces",painted.into())])
}
fn signature(value:&JsValue)->R<JsValue>{
 let mut models=Vec::new();
 for item in list(&read(value,"models")?)?.iter(){
  let key=at(&item,0)?;let keys=list(&at(&item,2)?)?;method(keys.as_ref(),"sort",&[])?;
  let pair=Array::new();pair.push(&key);pair.push(keys.as_ref());
  // Accepted model keys are strings. Sort by UTF-16 like JavaScript, including
  // supplementary Unicode characters; keep equal keys in their original order.
  let order=method(&global(),"String",&[&key])?;
  models.push((order,pair));
 }
 // Compare host strings directly: Rust UTF-8 strings cannot represent lone
 // surrogates, and round-tripping one would change persisted key order.
 models.sort_by(|a,b|if a.0==b.0{std::cmp::Ordering::Equal}else if a.0.lt(&b.0){std::cmp::Ordering::Less}else{std::cmp::Ordering::Greater});
 let ordered=Array::new();for(_,pair)in models{ordered.push(pair.as_ref());}
 let surfaces=Array::new();for item in list(&read(value,"surfaces")?)?.iter(){surfaces.push(&at(&item,0)?);}
 method(surfaces.as_ref(),"sort",&[])?;
 let all=Array::new();all.push(ordered.as_ref());all.push(surfaces.as_ref());
 method(&read(&global(),"JSON")?,"stringify",&[all.as_ref()])
}
fn adopt(session:&JsValue,policy:&JsValue)->R<()>{
 if truthy(&read(policy,"adopted")?)||!truthy(&read(session,"ready")?){return Ok(());}
 let record=accept(&read(session,"raw")?,&read(policy,"version")?)?;
 if truthy(&record){
  let surfaces=Map::new();for entry in list(&read(&record,"surfaces")?)?.iter(){surfaces.set(&at(&entry,0)?,&at(&entry,1)?);}
  let keys=signature(&record)?;set(policy,"surfaces",surfaces.as_ref())?;set(policy,"signature",&keys)?;
 }
 set(policy,"record",&record)?;set(policy,"adopted",&JsValue::TRUE)?;
 // The normalized record/map now own valid bytes; damaged discarded records
 // must not stay reachable through the browser's raw IndexedDB result.
 set(session,"raw",&JsValue::NULL)?;Ok(())
}
#[wasm_bindgen]
pub fn shelf_bake_enabled(session:&JsValue)->R<bool>{Ok(truthy(&read(&state(session)?,"version")?))}
#[wasm_bindgen]
pub fn shelf_bake_record(session:&JsValue)->R<JsValue>{let policy=state(session)?;adopt(session,&policy)?;read(&policy,"record")}
fn is_bytes(value:&JsValue)->R<bool>{
 let prototype=read(&read(&global(),"Object")?,"prototype")?;
 Ok(method(&read(&prototype,"toString")?,"call",&[value])?.as_string().as_deref()==Some("[object Uint8Array]"))
}
#[wasm_bindgen]
pub fn shelf_bake_surface(session:&JsValue,key:&JsValue,width:&JsValue,height:&JsValue)->R<JsValue>{
 let policy=state(session)?;adopt(session,&policy)?;let surfaces:Map=read(&policy,"surfaces")?.unchecked_into();
 let saved=surfaces.get(key);if !truthy(&saved){return Ok(JsValue::NULL);}surfaces.delete(key);
 let length=method(&global(),"Number",&[width])?.as_f64().unwrap_or(f64::NAN)*method(&global(),"Number",&[height])?.as_f64().unwrap_or(f64::NAN)*4.0;
 if read(&saved,"width")?!=*width||read(&saved,"height")?!=*height{return Ok(JsValue::NULL);}
 let pigment=read(&saved,"pigment")?;if !is_bytes(&pigment)?{return Ok(JsValue::NULL);}
 let data=read(&saved,"data")?;if !is_bytes(&data)?{return Ok(JsValue::NULL);}
 if read(&pigment,"length")?!=JsValue::from_f64(length)||read(&data,"length")?!=JsValue::from_f64(length){return Ok(JsValue::NULL);}Ok(saved)
}
#[wasm_bindgen]
pub fn shelf_bake_save(host:&JsValue,session:&JsValue,value:&JsValue)->R<JsValue>{
 let policy=state(session)?;let version=read(&policy,"version")?;
 if !truthy(&version)||!truthy(&read(session,"active")?){return Ok(Promise::resolve(&JsValue::FALSE).into());}
 let entries=Array::new();copy_data_entries(&entries,value)?;data_entry(&entries,&"version".into(),&version);
 method(host,"write",&[session,Object::from_entries(entries.as_ref())?.as_ref()])
}
fn valid(session:&JsValue,policy:&JsValue,epoch:f64)->R<bool>{Ok(truthy(&read(session,"active")?)&&read(policy,"epoch")?==JsValue::from_f64(epoch))}
#[wasm_bindgen]
pub fn shelf_bake_cancel(host:&JsValue,session:&JsValue)->R<()>{
 let policy=get(session,"policy");if absent(&policy){return Ok(());}
 clear_timeout(&read(&policy,"timer")?)?;
 let idle=read(&policy,"idle")?;if !absent(&idle){method(host,"cancelIdle",&[&idle])?;}
 set(&policy,"epoch",&(num(&read(&policy,"epoch")?)+1.0).into())?;set(&policy,"timer",&0.into())?;set(&policy,"idle",&JsValue::NULL)?;
 if !truthy(&read(session,"active")?){
  set(session,"raw",&JsValue::NULL)?;set(&policy,"record",&JsValue::NULL)?;
  read(&policy,"surfaces")?.unchecked_into::<Map>().clear();set(&policy,"signature",&"".into())?;
 }
 Ok(())
}
#[wasm_bindgen]
pub fn shelf_bake_schedule(host:&JsValue,session:&JsValue)->R<()>{
 let policy=state(session)?;if !truthy(&read(&policy,"version")?)||!truthy(&read(session,"active")?){return Ok(());}
 shelf_bake_cancel(host,session)?;let epoch=read(&policy,"epoch")?;
 let timer=method(host,"later",&[session,&epoch,&2000.into()])?;set(&policy,"timer",&timer)
}
#[wasm_bindgen]
pub fn shelf_bake_wait(host:&JsValue,session:&JsValue,epoch:f64)->R<()>{
 let policy=state(session)?;if !valid(session,&policy,epoch)?{return Ok(());}
 set(&policy,"timer",&0.into())?;let pending=Array::new();
 // Snapshot the source set before invoking callbacks, as [...sources].map did.
 for source in list(&read(session,"sources")?)?.iter(){pending.push(&method(&source,"settled",&[])?);}
 method(host,"afterSettled",&[session,&epoch.into(),Promise::all(&pending).as_ref()])?;Ok(())
}
#[wasm_bindgen]
pub fn shelf_bake_idle(host:&JsValue,session:&JsValue,epoch:f64)->R<()>{
 let policy=state(session)?;if !valid(session,&policy,epoch)?{return Ok(());}
 let idle=method(host,"idle",&[session,&epoch.into(),&1000.into(),&50.into()])?;set(&policy,"idle",&idle)
}
#[wasm_bindgen]
pub fn shelf_bake_collect(host:&JsValue,session:&JsValue,epoch:f64)->R<()>{
 let policy=state(session)?;if !valid(session,&policy,epoch)?{return Ok(());}
 set(&policy,"idle",&JsValue::NULL)?;adopt(session,&policy)?;
 let models=Array::new();let surfaces=Array::new();
 // Collection follows live Set iteration, including sources added by collect().
 for source in js_sys::try_iter(&read(session,"sources")?)?.unwrap(){
  let part=method(&source?,"collect",&[])?;
  for(name,target)in[("models",&models),("surfaces",&surfaces)]{
   let items=read(&part,name)?;if !absent(&items){for item in list(&items)?.iter(){target.push(&item);}}
  }
 }
 if !valid(session,&policy,epoch)?{return Ok(());}
 let next=obj(&[("models",models.into()),("surfaces",surfaces.into())])?;let keys=signature(&next)?;
 if keys==read(&policy,"signature")?{return Ok(());}set(&policy,"signature",&keys)?;
 shelf_bake_save(host,session,&next)?;Ok(())
}
