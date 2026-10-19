//! Plant dimension lookups, touch targets and legacy rooftop coordination.
//! Physical sizes and shelf packing remain in their existing numeric cores.
//! JS records retain identity; host callbacks may reenter with no Rust borrow.
use wasm_bindgen::prelude::*;
use js_sys::{Array,Object,Reflect,Symbol};
use crate::host::*;
use crate::cloud_host::{copy_data_entries,data_entry};
type R<T>=Result<T,JsValue>;
fn set(target:&JsValue,key:&str,value:&JsValue)->R<()>{
 if Reflect::set(target,&key.into(),value)?{Ok(())}else{Err(js_sys::TypeError::new(&format!("Cannot assign to read only property '{key}'")).into())}
}
fn each(value:&JsValue,mut body:impl FnMut(JsValue)->R<()>)->R<()>{
 let function=Reflect::get(value,Symbol::iterator().as_ref())?;let iterator=method(&function,"call",&[value])?;let next=read(&iterator,"next")?;
 loop{let step=method(&next,"call",&[&iterator])?;if truthy(&read(&step,"done")?){return Ok(());}let value=read(&step,"value")?;
  if let Err(error)=body(value){let _=method_opt(&iterator,"return",&[]);return Err(error);}
 }
}
fn primitive(value:&JsValue,hint:&str)->R<JsValue>{
 if !value.is_object()&&!value.is_function(){return Ok(value.clone());}
 let exotic=Reflect::get(value,Symbol::to_primitive().as_ref())?;
 if !absent(&exotic){let result=method(&exotic,"call",&[value,&hint.into()])?;if !result.is_object()&&!result.is_function(){return Ok(result);}return Err(js_sys::TypeError::new("Cannot convert object to primitive value").into());}
 for key in if hint=="string"{["toString","valueOf"]}else{["valueOf","toString"]}{let function=read(value,key)?;if function.is_function(){let result=method(&function,"call",&[value])?;if !result.is_object()&&!result.is_function(){return Ok(result);}}}
 Err(js_sys::TypeError::new("Cannot convert object to primitive value").into())
}
fn numeric(value:&JsValue)->R<f64>{
 if let Some(number)=value.as_f64(){return Ok(number);}
 let value=primitive(value,"number")?;if value.is_bigint(){return Err(js_sys::TypeError::new("Cannot mix BigInt and other types").into());}
 Ok(method(&global(),"Number",&[&value])?.as_f64().unwrap_or(f64::NAN))
}
fn string(value:&JsValue)->R<JsValue>{if value.is_symbol(){return Err(js_sys::TypeError::new("Cannot convert a Symbol value to a string").into());}method(&global(),"String",&[value])}
fn add(a:&JsValue,b:&JsValue)->R<JsValue>{
 if let (Some(a),Some(b))=(a.as_f64(),b.as_f64()){return Ok((a+b).into());}
 let a=primitive(a,"default")?;let b=primitive(b,"default")?;
 if a.is_string()||b.is_string(){return method(&string(&a)?,"concat",&[&string(&b)?]);}
 Ok((numeric(&a)?+numeric(&b)?).into())
}
fn compare(a:&JsValue,b:&JsValue,greater:bool)->R<bool>{
 if let (Some(a),Some(b))=(a.as_f64(),b.as_f64()){return Ok(if greater{a>b}else{a<b});}
 let a=primitive(a,"number")?;let b=primitive(b,"number")?;
 if a.is_symbol()||b.is_symbol(){return Err(js_sys::TypeError::new("Cannot convert a Symbol value to a number").into());}
 Ok(if greater{a.gt(&b)}else{a.lt(&b)})
}
fn clone_record(value:&JsValue)->R<JsValue>{let entries=Array::new();copy_data_entries(&entries,value)?;Ok(Object::from_entries(entries.as_ref())?.into())}
fn has(table:&JsValue,key:&JsValue)->bool{key.is_string()&&Object::has_own(table.unchecked_ref(),key)}
fn keyed(table:&JsValue,key:&JsValue)->R<JsValue>{Reflect::get(table,key)}
#[wasm_bindgen]
pub fn plant_standard_class(tables:&JsValue,id:&JsValue)->R<JsValue>{let classes=read(tables,"standardClasses")?;if has(&classes,id){clone_record(&keyed(&classes,id)?)}else{Ok(JsValue::NULL)}}
#[wasm_bindgen]
pub fn plant_dimensions_lookup(tables:&JsValue,id:&JsValue,pot:&JsValue)->R<JsValue>{
 let dimensions=read(tables,"dimensions")?;if !has(&dimensions,id){return Ok(JsValue::NULL);}
 let key=if has(&read(tables,"potSizes")?,pot){pot.clone()}else{"".into()};clone_record(&keyed(&keyed(&dimensions,id)?,&key)?)
}
#[wasm_bindgen]
pub fn plant_size_label(tables:&JsValue,id:&JsValue,pot:&JsValue)->R<JsValue>{
 let labels=read(tables,"sizeLabels")?;if !has(&labels,id){return Ok("".into());}
 let key=if has(&read(tables,"potSizes")?,pot){pot.clone()}else{"".into()};keyed(&keyed(&labels,id)?,&key)
}
#[wasm_bindgen]
pub fn plant_scene_dimensions(tables:&JsValue,id:&JsValue,pot:&JsValue,scale:&JsValue)->R<JsValue>{
 let size=plant_dimensions_lookup(tables,id,pot)?;if !truthy(&size){return Ok(JsValue::NULL);}
 let result=Object::new();for key in ["width","height","depth"]{set(result.as_ref(),key,&(numeric(&read(&size,key)?)?*numeric(scale)?).into())?;}Ok(result.into())
}
#[wasm_bindgen]
pub fn plant_minimum_tap_width(viewport:&JsValue)->R<u32>{
 let value=primitive(viewport,"number")?;if value.is_symbol(){return Err(js_sys::TypeError::new("Cannot convert a Symbol value to a number").into());}Ok(if value.ge(&600.into()){18}else{16})
}
#[wasm_bindgen]
pub fn plant_pad_tap(rect:&JsValue,minimum:&JsValue,out:&JsValue,square:bool)->R<JsValue>{
 let width=read(rect,"width")?;let extra_x=jmax(0.0,numeric(minimum)?-numeric(&width)?);
 let extra_y=if square{let height=read(rect,"height")?;jmax(0.0,numeric(minimum)?-numeric(&height)?)}else{0.0};
 set(out,"left",&(numeric(&read(rect,"left")?)?-extra_x/2.0).into())?;
 let top=read(rect,"top")?;set(out,"top",&if square{(numeric(&top)?-extra_y/2.0).into()}else{top})?;
 set(out,"width",&add(&read(rect,"width")?,&extra_x.into())?)?;
 let height=read(rect,"height")?;set(out,"height",&if square{add(&height,&extra_y.into())?}else{height})?;Ok(out.clone())
}
#[wasm_bindgen]
pub fn plant_nearest_tap(targets:&JsValue,x:&JsValue,y:&JsValue)->R<JsValue>{
 let mut best=JsValue::NULL;let mut distance=f64::INFINITY;
 each(targets,|target|{
  if compare(x,&read(&target,"left")?,false)?||compare(x,&add(&read(&target,"left")?,&read(&target,"width")?)?,true)?||compare(y,&read(&target,"top")?,false)?||compare(y,&add(&read(&target,"top")?,&read(&target,"height")?)?,true)?{return Ok(());}
  let left=read(&target,"left")?;let dx=numeric(x)?-numeric(&left)?;let dx=dx-numeric(&read(&target,"width")?)?/2.0;
  let top=read(&target,"top")?;let dy=numeric(y)?-numeric(&top)?;let dy=(dy-numeric(&read(&target,"height")?)?/2.0)*0.25;
  let next=js_sys::Math::pow(dx,2.0)+js_sys::Math::pow(dy,2.0);if next<distance{distance=next;best=target;}
  Ok(())
 })?;Ok(best)
}
#[wasm_bindgen]
pub fn plant_rooftop_layout(host:&JsValue,layout:&JsValue)->R<JsValue>{
 let first=read(layout,"unitWidth")?;let unit_width=if truthy(&first){first}else{read(layout,"width")?};
 let modeled=text(&read(layout,"shelfType")?,"baggebo")||text(&read(layout,"shelfType")?,"walnut");
 let gap=if modeled{24.0*numeric(&unit_width)?/600.0}else{0.0};let roofs=Array::new();
 let entries=read(layout,"entries")?;let entries:Array=entries.dyn_into().map_err(|_|js_sys::TypeError::new("layout.entries.filter is not a function"))?;
 // Array.filter snapshots its length and skips holes before dataset callbacks.
 for index in 0..entries.length(){if !Reflect::has(entries.as_ref(),&index.into())?{continue;}let entry=Reflect::get(entries.as_ref(),&index.into())?;if truthy(&read(&entry,"rooftop")?){roofs.push(&entry);}}
 each(&read(layout,"entries")?,|entry|{
  if text(&read(&entry,"kind")?,"plant")&&truthy(&read(&entry,"node")?){let node=read(&entry,"node")?;let dataset=read(&node,"dataset")?;let placement=if truthy(&read(&entry,"rooftop")?){"rooftop"}else{"bay"};set(&dataset,"plantPlacement",&placement.into())?;}Ok(())
 })?;
 if roofs.length()==0{return Ok(layout.clone());}
 let objects=Array::new();
 for(index,entry)in roofs.iter().enumerate(){
  let unit=if modeled{(numeric(&read(&entry,"shelf")?)?/3.0).floor()}else{0.0};
  let values=Array::new();copy_data_entries(&values,&entry)?;
  data_entry(&values,&"key".into(),&format!("roof:{index}").into());data_entry(&values,&"shelf".into(),&unit.into());
  let position=read(&entry,"x")?;let offset=unit*numeric(&add(&unit_width,&gap.into())?)?;
  let x=(numeric(&position)?-offset-16.0)/(numeric(&unit_width)?-32.0);
  data_entry(&values,&"x".into(),&x.into());objects.push(Object::from_entries(values.as_ref())?.as_ref());
 }
 let options=Object::new();for(key,value)in[("shelfWidth",unit_width.clone()),("padding",16.into()),("gap",3.into()),("minShelves",1.into())]{set(options.as_ref(),key,&value)?;}
 let rows=method(host,"layout",&[objects.as_ref(),options.as_ref()])?;
 let count=read(layout,"unitCount")?;let count=if truthy(&count){numeric(&count)?}else{1.0};let unit_count=jmax(count,numeric(&read(&rows,"length")?)?);
 each(&rows,|row|{
  each(&read(&row,"items")?,|item|{
   let index=method(&global(),"Number",&[&method(&read(&item,"key")?,"slice",&[&5.into()])?])?;let entry=Reflect::get(roofs.as_ref(),&index)?;
   let center=add(&read(&item,"left")?,&(numeric(&read(&item,"width")?)?/2.0).into())?;
   let row_index=read(&row,"index")?;let stride=add(&unit_width,&gap.into())?;let offset=numeric(&row_index)?*numeric(&stride)?;
   set(&entry,"x",&add(&center,&offset.into())?)?;set(&entry,"roofUnit",&read(&row,"index")?)?;Ok(())
  })
 })?;
 if modeled{
  loop{let current=read(layout,"rows")?;let index=numeric(&read(&current,"length")?)?;if !(index<unit_count*3.0){break;}
   let template=Reflect::get(&read(layout,"rows")?,&(index%3.0).into())?;let unit=(index/3.0).floor();let left=unit*numeric(&add(&unit_width,&gap.into())?)?;
   let values=Array::new();copy_data_entries(&values,&template)?;data_entry(&values,&"unit".into(),&unit.into());data_entry(&values,&"left".into(),&left.into());data_entry(&values,&"right".into(),&add(&left.into(),&unit_width)?);
   method(&read(layout,"rows")?,"push",&[Object::from_entries(values.as_ref())?.as_ref()])?;
  }
  set(layout,"unitCount",&unit_count.into())?;set(layout,"width",&(numeric(&unit_width)?*unit_count+gap*(unit_count-1.0)).into())?;
 }else{set(layout,"width",&(numeric(&unit_width)?*unit_count).into())?;}
 Ok(layout.clone())
}
