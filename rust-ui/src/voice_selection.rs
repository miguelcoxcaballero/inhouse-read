//! Select an installed natural voice and prepare bounded lookahead packets.
//! Catalog entries, marks and language values preserve their JavaScript identity.
use wasm_bindgen::{prelude::*,JsCast};
use js_sys::{Array,Function,Object,Reflect};
use crate::reader_actions::{get,set,one,two};
fn absent(value:&JsValue)->bool{value.is_null()||value.is_undefined()}
fn optional(value:&JsValue,key:&str)->Result<JsValue,JsValue>{if absent(value){Ok(JsValue::UNDEFINED)}else{get(value,key)}}
fn invoke(function:&Function,value:&JsValue)->Result<JsValue,JsValue>{function.call1(&JsValue::UNDEFINED,value)}
#[wasm_bindgen]
extern "C"{
 #[wasm_bindgen(catch,js_name=Number)]fn number(value:&JsValue)->Result<f64,JsValue>;
 #[wasm_bindgen(catch,js_name=String)]fn string(value:&JsValue)->Result<String,JsValue>;
}
fn terminal(value:&JsValue)->Result<bool,JsValue>{
 // ECMAScript \s (including BOM, excluding NEL), followed by the original
 // closing quotes/brackets and sentence punctuation. No regex allocation.
 if value.is_symbol(){return Err(js_sys::TypeError::new("Cannot convert a Symbol value to a string").into());}
 let text=string(value)?;
 let mut chars=text.chars().rev().skip_while(|c|matches!(*c,'\u{9}'..='\u{d}'|'\u{20}'|'\u{a0}'|'\u{1680}'|'\u{2000}'..='\u{200a}'|'\u{2028}'|'\u{2029}'|'\u{202f}'|'\u{205f}'|'\u{3000}'|'\u{feff}'));
 while let Some(c)=chars.next(){if matches!(c,'"'|'\''|'”'|'’'|'»'|'›'|')'|']'|'}'){continue;}return Ok(matches!(c,'.'|'!'|'?'|'。'|'！'|'？'|'…'));}Ok(false)
}
#[wasm_bindgen]
pub fn voice_for(host:JsValue,text:JsValue,catalog:Function,is_neural:Function,declared:Function,base:Function,resolve:Function,device:Function)->Result<JsValue,JsValue>{
 let language=if get(&get(&host,"options")?,"multilingual")?.is_truthy(){one(&host,"detectLanguage",&text)?}else{
  let override_=get(&host,"languageOverride")?;
  if override_.is_truthy(){override_}else{let reader=get(&get(&host,"reader")?,"language")?;if reader.is_truthy(){reader}else{let device=device.call0(&JsValue::UNDEFINED)?;if device.is_truthy(){device}else{"es-ES".into()}}}
 };
 let list:Array=catalog.call0(&JsValue::UNDEFINED)?.dyn_into()?;let voices=Array::new();
 for index in 0..list.length(){if !Reflect::has(&list,&index.into())?{continue;}let voice=list.get(index);
  if get(&voice,"installed")?.is_truthy()&&!one(&get(&host,"missing")?,"has",&get(&voice,"id")?)?.is_truthy(){voices.push(&voice);}
 }
 let mut id=if invoke(&is_neural,&get(&host,"voice")?)?.is_truthy(){get(&host,"voice")?}else{"".into()};
 let declared=invoke(&declared,&get(&host,"reader")?)?;
 if invoke(&is_neural,&id)?.is_truthy()&&!get(&get(&host,"options")?,"multilingual")?.is_truthy()&&declared.is_truthy()&&!get(&host,"languageOverride")?.is_truthy(){
  for voice in voices.iter(){if get(&voice,"id")?==id{if get(&voice,"base")?!=invoke(&base,&declared)?{id="".into();}break;}}
 }
 if id.is_truthy(){let mut present=false;for voice in voices.iter(){if get(&voice,"id")?==id{present=true;break;}}
  if !present{let result=Object::new();set(&result,"voice",&JsValue::NULL)?;set(&result,"voiceId",&id)?;set(&result,"language",&language)?;return Ok(result.into());}
 }
 let options=Object::new();set(&options,"voiceId",&id)?;set(&options,"language",&language)?;set(&options,"multilingual",&get(&get(&host,"options")?,"multilingual")?)?;set(&options,"deviceLang",&device.call0(&JsValue::UNDEFINED)?)?;
 resolve.call2(&JsValue::UNDEFINED,&voices,&options)
}
#[wasm_bindgen]
pub fn voice_audio_item(item:JsValue)->Result<JsValue,JsValue>{
 if !optional(&get(&item,"marks")?,"length")?.is_truthy(){return get(&item,"text");}
 let result=Object::new();set(&result,"text",&get(&item,"text")?)?;
 let marks:Array=get(&item,"marks")?.dyn_into()?;let offsets=Array::new_with_length(marks.length());
 for index in 0..marks.length(){if Reflect::has(&marks,&index.into())?{offsets.set(index,get(&marks.get(index),"offset")?);}}
 set(&result,"marks",&offsets)?;Ok(result.into())
}
#[wasm_bindgen]
pub fn voice_needs_join(host:JsValue,item:JsValue,index:JsValue)->Result<JsValue,JsValue>{
 let physical=optional(&get(&host,"source")?,"physicalPage")?;if !physical.is_truthy(){return Ok(physical);}
 if index!=JsValue::from_f64(number(&get(&get(&host,"items")?,"length")?)?-1.0){return Ok(JsValue::FALSE);}
 let text=optional(&item,"text")?;if !text.is_truthy(){return Ok(text);}
 Ok((!terminal(&get(&item,"text")?)?).into())
}
#[wasm_bindgen]
pub fn voice_upcoming(host:JsValue,voice:JsValue)->Result<JsValue,JsValue>{
 let upcoming=Array::new();let mut next=number(&get(&host,"index")?)?+1.0;
 while next<number(&get(&get(&host,"chunks")?,"length")?)?&&upcoming.length()<4{
  let item=Reflect::get(&get(&host,"items")?,&next.into())?;
  if two(&host,"needsPageJoin",&item,&next.into())?.is_truthy()&&!get(&Reflect::get(&get(&host,"items")?,&next.into())?,"joinChecked")?.is_truthy(){break;}
  if get(&get(&host,"options")?,"multilingual")?.is_truthy(){let selection=one(&host,"voiceFor",&Reflect::get(&get(&host,"chunks")?,&next.into())?)?;if optional(&get(&selection,"voice")?,"id")?!=get(&voice,"id")?{break;}}
  let item=Reflect::get(&get(&host,"items")?,&next.into())?;
  let item=if item.is_truthy(){item}else{let fallback=Object::new();set(&fallback,"text",&Reflect::get(&get(&host,"chunks")?,&next.into())?)?;fallback.into()};
  upcoming.push(&one(&host,"audioItem",&item)?);next+=1.0;
 }
 let defer=upcoming.length();let plan=optional(&get(&host,"aheadPage")?,"plan")?;
 if JsValue::from_f64(number(&get(&host,"index")?)?+1.0+upcoming.length() as f64)==get(&get(&host,"chunks")?,"length")?&&optional(&plan,"items")?.is_truthy(){
  let items:Array=two(&get(&plan,"items")?,"slice",&0.into(),&4.into())?.dyn_into()?;
  for item in items.iter(){let selection=one(&host,"voiceFor",&get(&item,"text")?)?;if optional(&get(&selection,"voice")?,"id")?!=get(&voice,"id")?{break;}upcoming.push(&one(&host,"audioItem",&item)?);}
 }
 let result=Object::new();set(&result,"upcoming",&upcoming)?;set(&result,"deferAfter",&defer.into())?;Ok(result.into())
}
