//! Cabinet scale, material ownership and host geometry lifecycle. The numeric
//! core still creates the same merged meshes; Three owns its copied buffers.
use wasm_bindgen::prelude::*;
use js_sys::{Array,Object};
use crate::host::*;
use crate::cloud_host::{copy_data_entries,data_entry};
type R<T>=Result<T,JsValue>;
const REFERENCE_SCALE:f64=0.65;
fn factor(value:&JsValue)->f64{match value.as_f64(){Some(value)if value.is_finite()&&value>0.0=>value/REFERENCE_SCALE,_=>1.0}}
fn number(value:&JsValue)->JsValue{value.as_f64().unwrap_or(f64::NAN).into()}
fn divide(value:&JsValue,factor:f64)->R<JsValue>{
 if value.is_bigint(){return Err(js_sys::TypeError::new("Cannot mix BigInt and other types, use explicit conversions").into());}
 Ok((method(&global(),"Number",&[value])?.as_f64().unwrap_or(f64::NAN)/factor).into())
}
fn optional(value:&JsValue,key:&str)->R<JsValue>{if absent(value){Ok(JsValue::UNDEFINED)}else{read(value,key)}}
fn rows(value:&JsValue,scale:f64)->R<Array>{
 let result=Array::new();if !Array::is_array(value){return Ok(result);}
 for row in value.unchecked_ref::<Array>().iter(){
  if scale==1.0{result.push(&row);continue;}
  let entries=Array::new();copy_data_entries(&entries,&row)?;
  data_entry(&entries,&"bottom".into(),&divide(&optional(&row,"bottom")?,scale)?);result.push(Object::from_entries(entries.as_ref())?.as_ref());
 }Ok(result)
}
fn bottoms(rows:&Array)->R<Array>{let result=Array::new();for row in rows.iter(){result.push(&number(&optional(&row,"bottom")?));}Ok(result)}
fn fallback(first:&JsValue,second:&JsValue,third:&JsValue)->JsValue{if truthy(first){first.clone()}else if truthy(second){second.clone()}else{third.clone()}}
#[wasm_bindgen]
pub fn shelf_furniture_create(host:&JsValue,options:&JsValue)->R<JsValue>{
 let scale=factor(&read(options,"scale")?);
 let mut width=read(options,"width")?;let mut height=read(options,"height")?;let mut depth=read(options,"depth")?;
 if scale!=1.0{width=divide(&width,scale)?;height=divide(&height,scale)?;depth=divide(&depth,scale)?;}
 let rows=rows(&read(options,"rows")?,scale)?;
 let wood=read(options,"wood")?;let back=read(options,"backWood")?;let dark=read(options,"darkWood")?;
 if !truthy(&wood)&&!truthy(&back)&&!truthy(&dark){return Err(js_sys::TypeError::new("createShelfFurniture requires a shared wood material").into());}
 let materials=[fallback(&wood,&dark,&back),fallback(&back,&wood,&dark),fallback(&dark,&wood,&back)];
 let group=method(host,"group",&[])?;set(&group,"name",&"Walnut cabinet".into())?;let data=read(&group,"userData")?;set(&data,"furniture",&JsValue::TRUE)?;
 let unique=Array::new();let ids=Array::new();
 for material in materials{let mut index=None;for(n,existing)in unique.iter().enumerate(){if existing==material{index=Some(n);break;}}
  let index=index.unwrap_or_else(||{unique.push(&material);unique.length() as usize-1});ids.push(&(index as f64).into());}
 let built=method(host,"buildCabinet",&[&number(&width),&number(&height),&number(&depth),bottoms(&rows)?.as_ref(),ids.as_ref()])?;
 let owned=Array::new();let groups:Array=read(&built,"groups")?.unchecked_into();
 for part in groups.iter(){
  let geometry=read(&part,"geometry")?;owned.push(&geometry);
  let material=num(&read(&part,"material")?) as u32;let mesh=method(host,"mesh",&[&geometry,&unique.get(material)])?;
  set(&mesh,"name",&read(&part,"name")?)?;set(&mesh,"castShadow",&JsValue::TRUE)?;set(&mesh,"receiveShadow",&JsValue::TRUE)?;method(&group,"add",&[&mesh])?;
 }
 set(&data,"parts",&read(&built,"parts")?)?;set(&data,"boardHeight",&15.into())?;set(&data,"textureScale",&160.into())?;
 let state:Object=Object::new();set(state.as_ref(),"disposed",&JsValue::FALSE)?;set(state.as_ref(),"geometries",owned.as_ref())?;
 set(&data,"disposeGeometry",&method(host,"disposeCallback",&[state.as_ref()])?)?;
 if scale!=1.0{method(&read(&group,"scale")?,"setScalar",&[&scale.into()])?;set(&data,"scale",&scale.into())?;}
 Ok(group)
}
#[wasm_bindgen]
pub fn shelf_furniture_dispose(state:&JsValue)->R<()>{
 if truthy(&read(state,"disposed")?){return Ok(());}set(state,"disposed",&JsValue::TRUE)?;
 let geometries:Array=read(state,"geometries")?.unchecked_into();for geometry in geometries.iter(){method(&geometry,"dispose",&[])?;}Ok(())
}
#[wasm_bindgen]
pub fn shelf_furniture_occlusion(host:&JsValue,scale:&JsValue,options:&JsValue)->R<JsValue>{
 let factor=factor(scale);let mut values=options.clone();
 if factor!=1.0{
  let entries=Array::new();copy_data_entries(&entries,options)?;
  for key in ["width","height","depth","floorY"]{data_entry(&entries,&key.into(),&divide(&read(options,key)?,factor)?);}
  data_entry(&entries,&"rows".into(),rows(&read(options,"rows")?,factor)?.as_ref());
  let supplied=read(options,"footprints")?;let source=if truthy(&supplied){supplied}else{Array::new().into()};
  if !read(&source,"map")?.is_function(){return Err(js_sys::TypeError::new("footprints.map is not a function").into());}
  let feet=Array::new();let count=num(&read(&source,"length")?) as u32;
  for index in 0..count{
   // Array.map skips holes. Keep their absence; the numeric binding filters
   // missing/nonfinite footprints before invoking its contact-shadow kernel.
   if !js_sys::Reflect::has(&source,&index.into())?{continue;}
   let foot=read(&source,&index.to_string())?;let result=Object::new();
   for key in ["x","z","radius"]{set(result.as_ref(),key,&divide(&read(&foot,key)?,factor)?)?;}feet.push(result.as_ref());
  }
  data_entry(&entries,&"footprints".into(),feet.as_ref());values=Object::from_entries(entries.as_ref())?.into();
 }
 let row_values=read(&values,"rows")?;let row_values=rows(&row_values,1.0)?;
 let feet=read(&values,"footprints")?;let feet=if feet.is_undefined(){Array::new().into()}else{feet};
 let light=read(&values,"floorLight")?;let light=if light.is_undefined(){JsValue::NULL}else{light};
 let geometry=method(host,"occlusion",&[&number(&read(&values,"width")?),&number(&read(&values,"height")?),&number(&read(&values,"depth")?),&number(&read(&values,"floorY")?),bottoms(&row_values)?.as_ref(),&feet,&light])?;
 if factor!=1.0{method(&geometry,"scale",&[&factor.into(),&factor.into(),&factor.into()])?;method(&geometry,"computeBoundingBox",&[])?;method(&geometry,"computeBoundingSphere",&[])?;}Ok(geometry)
}
