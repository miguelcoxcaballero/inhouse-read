//! Language selection and voice-menu coordination without copying voice records.
use wasm_bindgen::{prelude::*,JsCast};
use js_sys::{Array,Function,JsString,Object};
use crate::reader_actions::{get,set,call,one,two,invoke};
fn absent(v:&JsValue)->bool{v.is_null()||v.is_undefined()}
fn base(f:&Function,v:&JsValue)->Result<JsValue,JsValue>{f.call1(&JsValue::UNDEFINED,v)}
#[wasm_bindgen]
pub fn reader_book_language(host:JsValue,device:Function)->Result<JsValue,JsValue>{
 let language=get(&host,"reader").and_then(|reader|get(&reader,"language")).unwrap_or(JsValue::UNDEFINED);
 if language.is_truthy(){Ok(language)}else{let fallback=device.call0(&JsValue::UNDEFINED)?;Ok(if fallback.is_truthy(){fallback}else{"".into()})}
}
#[wasm_bindgen]
pub fn reader_choose_language(host:JsValue,value:JsValue,lang_base:Function)->Result<(),JsValue>{
 let catalog=get(&host,"voiceCatalog")?;
 let voices=if absent(&catalog){JsValue::UNDEFINED}else{get(&catalog,"voices")?};
 let voices:Array=if voices.is_truthy(){voices.unchecked_into()}else{Array::new()};
 let target=if value.is_truthy(){value.clone()}else{base(&lang_base,&call(&host,"bookLanguage")?)?};
 let mut keep=false;
 for voice in voices.iter(){
  if get(&voice,"id")?==get(&get(&host,"preferences")?,"voice")?&&get(&voice,"installed")?.is_truthy()&&get(&voice,"base")?==target{keep=true;break;}
 }
 if !keep&&get(&get(&host,"preferences")?,"voice")?.is_truthy(){
  let options=Object::new();set(&options,"restart",&JsValue::FALSE)?;
  invoke(&host,"setPreference",&Array::of3(&"voice".into(),&"".into(),&options))?;
 }
 two(&host,"setPreference",&"voiceLang".into(),&value)?;call(&host,"populateVoices")?;Ok(())
}
#[wasm_bindgen]
pub fn reader_voice_base(host:JsValue,voices:Array,lang_base:Function,declared:Function)->Result<JsValue,JsValue>{
 let book=base(&lang_base,&call(&host,"bookLanguage")?)?;
 let preferences=get(&host,"preferences")?;let id=get(&preferences,"voice")?;let language=get(&preferences,"voiceLang")?;
 if language.is_truthy(){return Ok(language);}
 let mut chosen=JsValue::UNDEFINED;
 if id.is_truthy(){for voice in voices.iter(){if get(&voice,"id")?==id&&get(&voice,"installed")?.is_truthy(){chosen=voice;break;}}}
 let declared=declared.call1(&JsValue::UNDEFINED,&get(&host,"reader")?)?;
 if chosen.is_truthy(){
  let chosen_base=get(&chosen,"base")?;
  if !(get(&chosen,"neural")?.is_truthy()&&declared.is_truthy()&&chosen_base!=base(&lang_base,&declared)?){return Ok(chosen_base);}
 }
 Ok(book)
}
#[wasm_bindgen]
pub fn reader_populate_voices(host:JsValue,list:Function,device:Function,lang_base:Function,languages:Function,options:Function)->Result<(),JsValue>{
 let voices=list.call0(&JsValue::UNDEFINED)?;
 let book=call(&host,"bookLanguage")?;let device=device.call0(&JsValue::UNDEFINED)?;
 let requested=one(&host,"voiceBase",&voices)?;let book_base=base(&lang_base,&book)?;
 let mut selected_base=JsValue::from_str("");
 for voice in voices.unchecked_ref::<Array>().iter(){if get(&voice,"base")?==requested{selected_base=requested.clone();break;}}
 set(&host,"voiceBaseShown",&selected_base)?;
 let locale=Object::new();set(&locale,"bookLang",&book)?;set(&locale,"deviceLang",&device)?;
 let language_rows=languages.call2(&JsValue::UNDEFINED,&voices,&locale)?;
 let preferred=get(&get(&host,"preferences")?,"voiceLang")?;
 let picked=if preferred.is_truthy(){preferred}else if selected_base.is_truthy()&&selected_base!=book_base{selected_base.clone()}else{"".into()};
 two(&get(&host,"languageMenu")?,"setOptions",&language_rows,&picked)?;
 let label=if picked==JsValue::from_str(""){JsString::from("Automática · ").concat(&get(&language_rows.unchecked_ref::<Array>().get(0),"hint")?.unchecked_into()).into()}else{JsValue::from_str("")};
 one(&get(&host,"languageMenu")?,"setValueText",&label)?;
 let rows=options.call3(&JsValue::UNDEFINED,&voices,&selected_base,&locale)?;
 let preferred=get(&get(&host,"preferences")?,"voice")?;
 let mut saved=JsValue::from_str("");
 for option in rows.unchecked_ref::<Array>().iter(){if get(&option,"value")?==preferred{saved=preferred.clone();break;}}
 two(&get(&host,"voiceMenu")?,"setOptions",&rows,&saved)?;
 let label=if saved==JsValue::from_str(""){
  if rows.unchecked_ref::<Array>().length()>1{JsString::from("Automática · ").concat(&get(&rows.unchecked_ref::<Array>().get(0),"hint")?.unchecked_into()).into()}else{"Sin voces instaladas".into()}
 }else{JsValue::from_str("")};
 one(&get(&host,"voiceMenu")?,"setValueText",&label)?;
 let catalog=Object::new();set(&catalog,"voices",&voices)?;set(&catalog,"bookLang",&book)?;set(&host,"voiceCatalog",&catalog)?;
 let picker=get(&host,"neuralPicker")?;if !absent(&picker){call(&picker,"render")?;}Ok(())
}
