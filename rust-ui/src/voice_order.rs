//! Typed catalogue keys are computed once; browser collation still determines
//! Spanish display order. The output retains the original voice objects.
use wasm_bindgen::prelude::*;
use js_sys::{Array,Function};
use std::{cmp::Ordering,collections::HashMap};
use crate::reader_actions::get;

const PRIORITIES:[&str;7]=["es","en","fr","de","it","pt","ca"];
struct Voice { value:JsValue,base:String,rank:u8,near:u8,recommended:bool,high:bool,name:JsValue,id:JsValue,label:JsValue }
struct Context { book:String,device:String,region:String }
impl Context {
 fn new(book:JsValue,device:JsValue,normalize:&Function)->Result<Option<Self>,JsValue>{
  let Some(book)=normalize.call1(&JsValue::UNDEFINED,&book)?.as_string()else{return Ok(None)};
  let Some(device)=normalize.call1(&JsValue::UNDEFINED,&device)?.as_string()else{return Ok(None)};
  let mut parts=book.split('-');
  Ok(Some(Self{book:parts.next().unwrap_or("").into(),region:parts.next().unwrap_or("").into(),device:device.split('-').next().unwrap_or("").into()}))
 }
}
fn records(list:JsValue,context:&Context,label:&Function,labels_needed:bool)->Result<Option<Vec<Voice>>,JsValue>{
 if !Array::is_array(&list){return Ok(None)}
 let mut labels=HashMap::<String,JsValue>::new();let mut voices=Vec::new();
 for value in Array::from(&list).iter(){
  if value.is_null()||value.is_undefined(){continue}
  if !value.is_object(){return Ok(None)}
  if !get(&value,"neural")?.is_truthy(){continue}
  let Some(base)=get(&value,"base")?.as_string()else{return Ok(None)};
  let Some(region)=get(&value,"region")?.as_string()else{return Ok(None)};
  let Some(recommended)=get(&value,"recommended")?.as_bool()else{return Ok(None)};
  let name=get(&value,"name")?;let id=get(&value,"id")?;
  // Normalized catalogue records take the native path. Preserve the existing
  // permissive helper for foreign records instead of coercing their values.
  if !base.is_ascii()||!region.is_ascii()||!name.is_string()||!id.is_string(){return Ok(None)}
  let rank=if base==context.book{0}else if base==context.device{1}else{2+PRIORITIES.iter().position(|v|*v==base).unwrap_or(PRIORITIES.len())as u8};
  let near=if base==context.book&&!context.region.is_empty()&&region==context.region{0}else{1};
  let display=if labels_needed&&rank>2{if let Some(cached)=labels.get(&base){cached.clone()}else{let display=label.call1(&JsValue::UNDEFINED,&base.clone().into())?;labels.insert(base.clone(),display.clone());display}}else{JsValue::UNDEFINED};
  let high=get(&value,"tier")?==JsValue::from_str("high");
  voices.push(Voice{value,base,rank,near,recommended,high,name,id,label:display});
 }Ok(Some(voices))
}
fn collate(compare:&Function,a:&JsValue,b:&JsValue,spanish:bool)->Result<Ordering,JsValue>{
 let value=compare.call3(&JsValue::UNDEFINED,a,b,&spanish.into())?.as_f64().unwrap_or(0.0);
 Ok(if value<0.0{Ordering::Less}else if value>0.0{Ordering::Greater}else{Ordering::Equal})
}
fn compare(a:&Voice,b:&Voice,collator:&Function)->Result<Ordering,JsValue>{
 let rank=a.rank.cmp(&b.rank);if rank!=Ordering::Equal{return Ok(rank)}
 if a.rank>2{let order=collate(collator,&a.label,&b.label,true)?;if order!=Ordering::Equal{return Ok(order)}}
 let flags=a.near.cmp(&b.near).then(b.recommended.cmp(&a.recommended)).then(b.high.cmp(&a.high));
 if flags!=Ordering::Equal{return Ok(flags)}
 let name=collate(collator,&a.name,&b.name,true)?;if name!=Ordering::Equal{return Ok(name)}
 collate(collator,&a.id,&b.id,false)
}
#[wasm_bindgen]
pub fn voice_order(list:JsValue,book:JsValue,device:JsValue,normalize:Function,label:Function,collator:Function)->Result<JsValue,JsValue>{
 let Some(context)=Context::new(book,device,&normalize)?else{return Ok(JsValue::UNDEFINED)};
 let Some(mut voices)=records(list,&context,&label,true)?else{return Ok(JsValue::UNDEFINED)};
 let mut error=None;
 voices.sort_by(|a,b|{if error.is_some(){return Ordering::Equal}match compare(a,b,&collator){Ok(order)=>order,Err(value)=>{error=Some(value);Ordering::Equal}}});
 if let Some(error)=error{return Err(error)}
 let result=Array::new();for voice in voices{result.push(&voice.value);}Ok(result.into())
}
#[wasm_bindgen]
pub fn voice_recommended(list:JsValue,book:JsValue,device:JsValue,normalize:Function,label:Function,collator:Function)->Result<JsValue,JsValue>{
 let Some(context)=Context::new(book,device,&normalize)?else{return Ok(JsValue::UNDEFINED)};
 let Some(voices)=records(list,&context,&label,false)?else{return Ok(JsValue::UNDEFINED)};
 let mut best:Option<&Voice>=None;
 for voice in &voices{if voice.base!=context.book{continue}if let Some(current)=best{if compare(voice,current,&collator)?==Ordering::Less{best=Some(voice)}}else{best=Some(voice)}}
 Ok(best.map(|voice|voice.value.clone()).unwrap_or(JsValue::NULL))
}
