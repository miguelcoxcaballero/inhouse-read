//! Natural voice menu grouping, ordering and duplicate labels.
use std::{cmp::Ordering,collections::HashMap};
use wasm_bindgen::prelude::*;
use js_sys::{Array,Function,JsString,Object,Reflect};
use crate::{prop,js_string};
const PRIORITY:[&str;7]=["es","en","fr","de","it","pt","ca"];
fn set(object:&Object,key:&str,value:&JsValue)->Result<(),JsValue>{Reflect::set(object,&key.into(),value)?;Ok(())}
fn text(value:&JsValue,key:&str)->String{js_string(&prop(value,key))}
fn rank(base:&str,book:&str,device:&str)->usize{if base==book{0}else if base==device{1}else{PRIORITY.iter().position(|entry|*entry==base).map(|i|i+2).unwrap_or(100)}}
fn compare(a:&str,b:&str,locales:&Array,options:&Object)->Ordering{JsString::from(a).locale_compare(b,locales,options).cmp(&0)}
fn option(value:&JsValue,label:&JsValue,hint:&str)->Result<Object,JsValue>{let row=Object::new();set(&row,"value",value)?;set(&row,"label",label)?;set(&row,"hint",&hint.into())?;Ok(row)}
fn spanish()->Array{Array::of1(&"es".into())}
fn language_rows(bases:Array,book:&str,device:&str,label:&Function)->Result<Vec<(JsValue,String,String)>,JsValue>{
 let mut labels=HashMap::new();let mut rows=Vec::new();
 for base in bases.iter(){let key=js_string(&base);let name=if let Some(name)=labels.get(&key){String::clone(name)}else{let name=js_string(&label.call1(&JsValue::UNDEFINED,&base)?);labels.insert(key.clone(),name.clone());name};rows.push((base,key,name));}
 let locales=spanish();let options=Object::new();rows.sort_by(|a,b|rank(&a.1,book,device).cmp(&rank(&b.1,book,device)).then_with(||compare(&a.2,&b.2,&locales,&options)));Ok(rows)
}
#[wasm_bindgen]
pub fn order_languages(bases:Array,book:&str,device:&str,label:Function)->Result<Array,JsValue>{Ok(language_rows(bases,book,device,&label)?.into_iter().map(|r|r.0).collect())}
#[wasm_bindgen]
pub fn language_options(voices:Array,book:&str,device:&str,book_label:&str,label:Function)->Result<Array,JsValue>{
 let mut counts:HashMap<String,(u32,u32)>=HashMap::new();let bases=Array::new();
 for voice in voices.iter(){let base=prop(&voice,"base");if !prop(&voice,"neural").is_truthy()||!base.is_truthy(){continue;}let key=js_string(&base);if !counts.contains_key(&key){bases.push(&base);}let entry=counts.entry(key).or_default();if prop(&voice,"installed").is_truthy(){entry.0+=1;}else{entry.1+=1;}}
 let output=Array::new();output.push(&option(&"".into(),&"Automática".into(),if counts.contains_key(book){book_label}else{"Elige un idioma"})?.into());
 for (base,key,name) in language_rows(bases,book,device,&label)?{let (ready,download)=counts[&key];if ready==0&&download==0{continue;}let hint=match ready{0=>"Por descargar".to_owned(),1=>"1 voz".to_owned(),n=>format!("{n} voces")};output.push(&option(&base,&name.into(),&hint)?.into());}
 Ok(output)
}
struct Voice{value:JsValue,id:String,title:JsValue,title_key:String,score:i32}
#[wasm_bindgen]
pub fn voice_options(voices:Array,base:&str,region:&str,device_region:&str,region_name:Function)->Result<Array,JsValue>{
 let mut ranked=Vec::new();
 for voice in voices.iter(){if !prop(&voice,"neural").is_truthy()||!prop(&voice,"installed").is_truthy()||prop(&voice,"base").as_string().as_deref()!=Some(base){continue;}
  let near=text(&voice,"region");let bonus=if !region.is_empty()&&near==region{150}else if region.is_empty()&&!device_region.is_empty()&&near==device_region{25}else{0};
  let score=900+if text(&voice,"tier")=="high"{10}else{0}+if prop(&voice,"recommended").is_truthy(){5}else{0}+bonus;
  let title=prop(&voice,"name");ranked.push(Voice{id:text(&voice,"id"),title_key:js_string(&title),title,value:voice,score});
 }
 let locales=Array::new();let options=Object::new();ranked.sort_by(|a,b|b.score.cmp(&a.score).then_with(||compare(&a.id,&b.id,&locales,&options)));
 let mut totals:HashMap<String,u32>=HashMap::new();for voice in &ranked{*totals.entry(voice.title_key.clone()).or_default()+=1;}
 let mut seen:HashMap<String,u32>=HashMap::new();let output=Array::new();let mut first=JsValue::from_str("Sin voces");let mut regions=HashMap::new();
 for voice in ranked{let count=seen.entry(voice.title_key.clone()).or_default();*count+=1;let label=if totals[&voice.title_key]>1{JsValue::from_str(&format!("{} {}",voice.title_key,count))}else{voice.title};
  if output.length()==0{first=label.clone();}let lang=prop(&voice.value,"lang");let key=js_string(&lang);let where_=if let Some(value)=regions.get(&key){String::clone(value)}else{let value=js_string(&region_name.call1(&JsValue::UNDEFINED,&lang)?);regions.insert(key,value.clone());value};
  let mut hint=if where_.is_empty(){"Natural".to_owned()}else{format!("{where_} · Natural")};if prop(&voice.value,"network").is_truthy(){hint.push_str(" · Requiere internet");}
  let row=option(&prop(&voice.value,"id"),&label,&hint)?;set(&row,"voice",&voice.value)?;output.push(&row);
 }
 let automatic=option(&"".into(),&"Automática".into(),&js_string(&first))?;output.unshift(&automatic);Ok(output)
}
