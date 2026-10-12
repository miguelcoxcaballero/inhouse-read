//! Join a sentence over a physical PDF page without changing UTF-16 offsets.
//! Source/fragment references are retained so Pause can restore the exact tail.
use std::cell::RefCell;
use wasm_bindgen::{prelude::*,JsCast};
use js_sys::{Array,Object,Reflect,RegExp,JsString,Function};
use crate::reader_actions::{get,set,one,two};
fn absent(value:&JsValue)->bool{value.is_null()||value.is_undefined()}
fn optional(value:&JsValue,key:&str)->Result<JsValue,JsValue>{if absent(value){Ok(JsValue::UNDEFINED)}else{get(value,key)}}
#[wasm_bindgen]
extern "C"{
 #[wasm_bindgen(catch,js_name=Number)]fn number(value:&JsValue)->Result<f64,JsValue>;
 #[wasm_bindgen(catch,js_name=Object)]fn boxed(value:&JsValue)->Result<Object,JsValue>;
}
thread_local!{static PATTERNS:RefCell<Option<(RegExp,RegExp)>>=const{RefCell::new(None)};}
fn patterns()->(RegExp,RegExp){PATTERNS.with(|slot|{let mut slot=slot.borrow_mut();slot.get_or_insert_with(||(RegExp::new("[-‐]$",""),RegExp::new("^\\p{Ll}","u"))).clone()})}
fn define(target:&Object,key:&JsValue,value:&JsValue)->Result<(),JsValue>{
 let descriptor=Object::new();set(&descriptor,"value",value)?;
 for key in ["enumerable","configurable","writable"]{set(&descriptor,key,&JsValue::TRUE)?;}
 if !Reflect::define_property(target,key,&descriptor)?{return Err(js_sys::TypeError::new("Cannot define fragment property").into());}Ok(())
}
fn spread(source:&JsValue)->Result<Object,JsValue>{
 let target=Object::new();if absent(source){return Ok(target);}let source=boxed(source)?;
 // Define own data properties, including symbols and __proto__, as {...source}
 // does; Object.assign would incorrectly invoke an inherited setter.
 for key in Reflect::own_keys(&source)?.iter(){let descriptor=Reflect::get_own_property_descriptor(&source,&key)?;
  if !descriptor.is_undefined()&&get(&descriptor,"enumerable")?.is_truthy(){define(&target,&key,&Reflect::get(&source,&key)?)?;}
 }Ok(target)
}
fn text(item:&JsValue)->Result<JsString,JsValue>{Ok(get(item,"text")?.unchecked_into())}
fn iterator(value:&JsValue)->Result<js_sys::IntoIter,JsValue>{js_sys::try_iter(value)?.ok_or_else(||js_sys::TypeError::new("Fragment list is not iterable").into())}
#[wasm_bindgen]
pub fn voice_join_sentence(host:JsValue,add:Function)->Result<(),JsValue>{
 let index=number(&get(&get(&host,"items")?,"length")?)?-1.0;
 let tail=Reflect::get_f64(&get(&host,"items")?,index)?;let plan=optional(&get(&host,"aheadPage")?,"plan")?;
 if !two(&host,"needsPageJoin",&tail,&index.into())?.is_truthy()||get(&tail,"joinChecked")?.is_truthy()||!optional(&optional(&plan,"items")?,"length")?.is_truthy()||!one(&host,"pagePlanValid",&plan)?.is_truthy(){return Ok(());}
 let first=Reflect::get_u32(&get(&plan,"items")?,0)?;let mut continuation=Vec::new();let mut length=text(&tail)?.length() as f64+1.0;
 for item in iterator(&get(&plan,"items")?)?{let item=item?;
  if get(&get(&item,"sentence")?,"start")?!=get(&get(&first,"sentence")?,"start")?||(!continuation.is_empty()&&length+text(&item)?.length() as f64>360.0){break;}
  continuation.push(item.clone());length+=text(&item)?.length() as f64+1.0;
 }
 let texts=Array::new();for item in &continuation{texts.push(&get(item,"text")?);}let suffix=texts.join(" ");let (hyphen,lower)=patterns();
 let remove=one(&hyphen,"test",&get(&tail,"text")?)?.is_truthy()&&one(&lower,"test",&suffix)?.is_truthy();
 let prefix=if remove{let tail=text(&tail)?;tail.slice(0,tail.length().saturating_sub(1))}else{text(&tail)?.concat(&" ".into())};
 let boundary=prefix.length();let marks=Array::new();let existing=get(&tail,"marks")?;let existing=if existing.is_truthy(){existing}else{Array::new().into()};
 for mark in iterator(&existing)?{marks.push(&mark?);}
 let entry=Object::new();define(&entry,&"offset".into(),&boundary.into())?;define(&entry,&"start".into(),&get(&first,"start")?)?;define(&entry,&"source".into(),&get(&plan,"source")?)?;define(&entry,&"sentence".into(),&get(&first,"sentence")?)?;marks.push(&entry);
 let mut offset=boundary as f64;
 for item in &continuation{let nested=get(item,"marks")?;let nested=if nested.is_truthy(){nested}else{Array::new().into()};
  for mark in iterator(&nested)?{let mark=mark?;let copy=spread(&mark)?;let at=get(&mark,"offset")?;
   let at=if let Some(value)=at.as_f64(){(offset+value).into()}else{add.call2(&JsValue::UNDEFINED,&offset.into(),&at)?};define(&copy,&"offset".into(),&at)?;
   define(&copy,&"source".into(),&get(&plan,"source")?)?;define(&copy,&"sentence".into(),&get(item,"sentence")?)?;marks.push(&copy);
  }offset+=text(item)?.length() as f64+1.0;
 }
 let joined=spread(&tail)?;define(&joined,&"text".into(),&prefix.concat(&suffix))?;define(&joined,&"marks".into(),&marks)?;define(&joined,&"joinChecked".into(),&JsValue::TRUE)?;define(&joined,&"unjoined".into(),&tail)?;
 Reflect::set(&get(&host,"items")?,&index.into(),&joined)?;
 Reflect::set(&get(&host,"chunks")?,&index.into(),&get(&Reflect::get_f64(&get(&host,"items")?,index)?,"text")?)?;
 let rest=one(&get(&plan,"items")?,"slice",&(continuation.len() as u32).into())?;set(&plan,"items",&rest)?;Ok(())
}
