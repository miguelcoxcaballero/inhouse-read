//! Catalogue labels, rows and initial selections. The host supplies canonical
//! catalogue lookups and studio constructors; native code owns their composition.
use std::cell::{Cell,RefCell};
use wasm_bindgen::prelude::*;
use js_sys::Array;
use crate::host::{read,method,num,truthy,absent,call};
use crate::cloud_host::{object,string};
type R<T> = Result<T,JsValue>;
thread_local!{static OPTIONS:RefCell<Option<String>>=const{RefCell::new(None)};static SEQUENCE:Cell<f64>=const{Cell::new(0.0)};}
fn s(value:&str)->JsValue{JsValue::from_str(value)}
fn optional(value:&JsValue,key:&str)->R<JsValue>{if absent(value){Ok(JsValue::UNDEFINED)}else{read(value,key)}}
fn or_empty(value:JsValue)->JsValue{if truthy(&value){value}else{s("")}}
fn dimensions(value:&JsValue)->R<JsValue>{
 if !truthy(value){return Ok(s("A medida"));}
 let values=["width","depth","height"].map(|key|read(value,key).map(|v|string(&JsValue::from_f64(num(&v)/10.0))));
 let values=values.into_iter().collect::<R<Vec<_>>>()?;
 Ok(s(&format!("{} × {} × {} cm",values[0],values[1],values[2])))
}
fn is_space(ch:char)->bool{matches!(ch,'\u{0009}'..='\u{000d}'|' '| '\u{00a0}'|'\u{1680}'|'\u{2000}'..='\u{200a}'|'\u{2028}'|'\u{2029}'|'\u{202f}'|'\u{205f}'|'\u{3000}'|'\u{feff}')}
fn word(word:&str)->String{
 let seam=match word{"SANSEVIERIA"=>5,"CHAMAEDOREA"=>6,"NEPHROLEPIS"=>6,"ZAMIOCULCAS"=>5,"MUSKOTBLOMMA"=>6,_=>return word.to_owned()};
 format!("{}\u{ad}{}",&word[..seam],&word[seam..])
}
fn option_name(name:JsValue)->JsValue{
 let name=string(&name);let mut out=String::with_capacity(name.len()+2);let mut current=String::new();
 for ch in name.chars(){if is_space(ch){out.push_str(&word(&current));current.clear();out.push(ch);}else{current.push(ch);}}
 out.push_str(&word(&current));s(&out)
}
fn row(fields:&mut Vec<JsValue>,values:&[JsValue]){fields.extend_from_slice(values);}
fn packet(fields:&[JsValue])->String{let array=Array::new();for value in fields{array.push(value);}array.join("\0").into()}
fn shelf_icon(id:&JsValue)->JsValue{s(if *id==s("baggebo"){include_str!("art/shelf-baggebo.svg")}else{include_str!("art/shelf-walnut.svg")})}
fn mount(lamp:&JsValue)->R<JsValue>{Ok(s(if optional(lamp,"mount")?==s("undershelf"){"Bajo la balda"}else{"Sobre la balda"}))}
#[wasm_bindgen]
pub fn catalog_dialog(host:JsValue,document:web_sys::Document,requested_id:JsValue,logo:&str)->R<web_sys::Element>{
 let id=catalog_instance_id(requested_id);
 let logo=logo.replacen("<svg ","<svg aria-hidden=\"true\" focusable=\"false\" ",1);
 // Keep the entire drawing/label packet in native memory until DOM creation:
 // exporting it only to import it again would copy every SVG twice.
 crate::catalog_view::catalog_build(document,&string(&id),&logo,&catalog_options(host)?)
}
#[wasm_bindgen]
pub fn catalog_options(host:JsValue)->R<String>{
 if let Some(cached)=OPTIONS.with(|cache|cache.borrow().clone()){return Ok(cached);}
 let mut fields=Vec::new();let plants=Array::from(&read(&host,"PLANT_CATALOG")?);let first=plants.get(0);
 for plant in plants.iter(){
  let id=read(&plant,"id")?;let name=read(&plant,"name")?;
  let drawing=method(&host,"plantCatalogIllustration",&[&id,&read(&plant,"defaultPotId")?,&object(&[("compact",JsValue::TRUE)])])?;
  row(&mut fields,&[s("plant"),id,s(&format!("{}, {}",string(&name),string(&read(&plant,"subtitle")?))),drawing,option_name(name),s(""),s(""),s(""),s("")]);
 }
 for pot in Array::from(&read(&host,"POT_CATALOG")?).iter(){
  let id=read(&pot,"id")?;let name=read(&pot,"name")?;
  let drawing=method(&host,"plantCatalogIllustration",&[&optional(&first,"id")?,&id,&object(&[("potOnly",JsValue::TRUE),("compact",JsValue::TRUE)])])?;
  row(&mut fields,&[s("pot"),id,s(&format!("{}, {}",string(&name),string(&read(&pot,"subtitle")?))),drawing,option_name(name),s(""),s(""),s(""),s("")]);
 }
 for shelf in Array::from(&read(&host,"SHELF_TYPES")?).iter(){
  let id=read(&shelf,"id")?;let name=read(&shelf,"name")?;let subtitle=read(&shelf,"subtitle")?;
  row(&mut fields,&[s("shelf"),id.clone(),s(&format!("{}, {}",string(&name),string(&subtitle))),shelf_icon(&id),name,subtitle,dimensions(&read(&shelf,"dimensions")?)?,s(""),s("")]);
 }
 for lamp in Array::from(&read(&host,"LAMP_CATALOG")?).iter(){
  let id=read(&lamp,"id")?;let name=read(&lamp,"name")?;
  let subtitle=if read(&lamp,"mount")?==s("undershelf"){"foco bajo balda"}else{"lámpara de sobremesa"};
  row(&mut fields,&[s("lamp"),id.clone(),s(&format!("{}, {}",string(&name),subtitle)),method(&host,"lampCatalogIllustration",&[&id])?,name,read(&lamp,"subtitle")?,s(""),mount(&lamp)?,s("")]);
 }
 for kelvin in Array::from(&read(&host,"LAMP_KELVINS")?).iter(){
  row(&mut fields,&[s("kelvin"),s(&string(&kelvin)),s(""),s(""),s(&format!("{} K",string(&kelvin))),s(""),s(""),s(""),method(&host,"kelvinSwatch",&[&kelvin])?]);
 }
 let result=packet(&fields);OPTIONS.with(|cache|*cache.borrow_mut()=Some(result.clone()));Ok(result)
}
#[wasm_bindgen]
pub fn catalog_description(host:JsValue,plant_id:JsValue,pot_id:JsValue,color_id:JsValue,shelf_id:JsValue,lamp_id:JsValue)->R<JsValue>{
 let plant=method(&host,"getCatalogPlant",&[&plant_id])?;let pot=method(&host,"getCatalogPot",&[&pot_id])?;
 let shelf=method(&host,"getShelfType",&[&shelf_id])?;let lamp=method(&host,"getCatalogLamp",&[&lamp_id])?;
 let values=[or_empty(optional(&lamp,"name")?),or_empty(optional(&lamp,"subtitle")?),mount(&lamp)?,read(&shelf,"name")?,read(&shelf,"subtitle")?,dimensions(&read(&shelf,"dimensions")?)?,
  or_empty(optional(&plant,"name")?),or_empty(optional(&plant,"subtitle")?),or_empty(optional(&pot,"name")?),
  read(&method(&host,"getPotColor",&[&pot_id,&color_id])?,"name")?,method(&host,"plantSizeLabel",&[&plant_id,&pot_id])?,truthy(&plant).into(),truthy(&pot).into(),truthy(&lamp).into()];
 let out=Array::new();for value in values{out.push(&value);}Ok(out.into())
}
#[wasm_bindgen]
pub fn catalog_color_rows(host:JsValue,pot_id:JsValue)->R<String>{
 let mut fields=Vec::new();for color in Array::from(&method(&host,"getPotColors",&[&pot_id])?).iter(){
  let name=read(&color,"name")?;row(&mut fields,&[s("color"),read(&color,"id")?,s(&format!("Color {}",string(&name))),s(""),name,s(""),s(""),s(""),read(&color,"hex")?]);
 }Ok(packet(&fields))
}
#[wasm_bindgen]
pub fn catalog_color_id(host:JsValue,pot_id:JsValue,color_id:JsValue)->R<JsValue>{read(&method(&host,"getPotColor",&[&pot_id,&color_id])?,"id")}
#[wasm_bindgen]
pub fn catalog_initial(host:JsValue,shelf_type:JsValue)->R<JsValue>{
 let plant=Array::from(&read(&host,"PLANT_CATALOG")?).get(0);let pot=optional(&plant,"defaultPotId")?;
 let pot=if truthy(&pot){pot}else{optional(&Array::from(&read(&host,"POT_CATALOG")?).get(0),"id")?};
 let color=read(&method(&host,"getPotColor",&[&pot])?,"id")?;
 Ok(object(&[("plant",optional(&plant,"id")?),("pot",pot),("color",color),("lamp",optional(&Array::from(&read(&host,"LAMP_CATALOG")?).get(0),"id")?),
 ("kelvin",read(&host,"DEFAULT_LAMP_KELVIN")?),("shelfType",shelf_type)]))
}
#[wasm_bindgen]
pub fn catalog_instance_id(requested:JsValue)->JsValue{
 if truthy(&requested){return requested;}
 SEQUENCE.with(|sequence|{let next=sequence.get()+1.0;sequence.set(next);s(&format!("ihr-plant-catalog-{}",string(&JsValue::from_f64(next))))})
}
#[wasm_bindgen]
pub fn catalog_create_preview(host:JsValue,kind:JsValue)->R<JsValue>{
 let (method_name,node)=if kind==s("plants"){("createPlantCatalogPreview","drawing")}else if kind==s("shelves"){("createShelfCatalogPreview","shelfDrawing")}else{("createLampCatalogPreview","lampDrawing")};
 call(&read(&host,method_name)?,method_name,&[&read(&host,node)?])
}
