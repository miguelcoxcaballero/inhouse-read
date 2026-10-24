//! Object-aware reader choices. The numeric rules and CSS renderer are shared
//! with app-core rather than maintained as another implementation.
use wasm_bindgen::prelude::*;
use js_sys::{Array, Object, Reflect};
use crate::host::*;
#[path = "../../rust-core/src/reader_preference_rules.rs"]
mod rules;
type R<T> = Result<T, JsValue>;
fn optional(value:&JsValue,key:&str)->R<JsValue>{if absent(value){Ok(JsValue::UNDEFINED)}else{read(value,key)}}
fn number(value:&JsValue)->R<f64>{Ok(match value.as_f64(){Some(n)=>n,None=>method(&global(),"Number",&[value])?.as_f64().unwrap_or(f64::NAN)})}
fn string(value:&JsValue)->R<JsValue>{method(&global(),"String",&[value])}
fn has(table:&JsValue,key:&JsValue)->R<bool>{Ok(truthy(&method(&read(&global(),"Object")?,"hasOwn",&[table,key])?))}
fn some(value:&JsValue,mut predicate:impl FnMut(JsValue)->R<bool>)->R<bool>{
 let length=number(&read(value,"length")?)? as u32;
 for n in 0..length{let key=JsValue::from_f64(n as f64);if Reflect::has(value,&key)?&&predicate(Reflect::get(value,&key)?)?{return Ok(true);}}
 Ok(false)
}
fn selected(input:&JsValue,name:&str,valid:&str,default:&str)->R<JsValue>{Ok(if read(input,name)?==JsValue::from_str(valid){valid.into()}else{default.into()})}
fn numeric_value(input:&JsValue,numbers:&JsValue,key:&str,index:usize)->R<JsValue>{
 let ready=optional(numbers,&index.to_string())?;if !absent(&ready){return Ok(ready);}
 let value=read(input,key)?;
 let value=if absent(&value)||read(input,key)?==JsValue::from_str(""){f64::NAN}else{number(&read(input,key)?)?};
 let mut values=[f64::NAN;8];values[index]=value;rules::normalize_values(&mut values);Ok(values[index].into())
}
#[wasm_bindgen]
pub fn reading_preferences_rate(value:&JsValue)->R<f64>{
 let rate=number(value)?;
 Ok(if !rate.is_finite()||*value==JsValue::from_str("")||absent(value){1.0}else{rules::nearest_rate(rate)})
}
#[wasm_bindgen]
pub fn reading_preferences_rate_label(value:&JsValue)->R<JsValue>{method(&method(&string(value)?,"replace",&[&".".into(),&",".into()])?,"concat",&[&"×".into()])}
#[wasm_bindgen]
pub fn reading_preferences_normalize(input:&JsValue,kit:&JsValue)->R<JsValue>{
 let input=if !truthy(input)||!input.is_object()||input.is_function(){Object::new().into()}else{input.clone()};
 let voice=read(&input,"voice")?;let voice=string(&if truthy(&voice){voice}else{"".into()})?;
 let voice_lang=method(kit,"langBase",&[&read(&input,"voiceLang")?])?;
 // The app-core arena remains a browser-memory adapter, including its caught
 // allocation/coercion failures. Fallback values use these same shared rules.
 let numbers=method(kit,"numbers",&[&input])?;
 let out=Object::new();let out=out.as_ref();
 for(name,table,default)in [("theme","themes","paper"),("font","fonts","book")]{
  let valid=has(&read(kit,table)?,&read(&input,name)?)?;
  set(out,name,&if valid{read(&input,name)?}else{default.into()})?;
 }
 for(name,index)in [("fontSize",0),("lineHeight",1),("margin",2)]{set(out,name,&numeric_value(&input,&numbers,name,index)?)?;}
 for(name,valid,default)in [("align","justify","start"),("flow","scrolled","paginated"),("pdfMode","text","original")]{set(out,name,&selected(&input,name,valid,default)?)?;}
 set(out,"zoom",&numeric_value(&input,&numbers,"zoom",3)?)?;
 let rate=optional(&numbers,"4")?;set(out,"rate",&if absent(&rate){reading_preferences_rate(&read(&input,"rate")?)?.into()}else{rate})?;
 let valid_voice=truthy(&method(kit,"isVoice",&[&voice])?)&&some(&read(kit,"voices")?,|entry|Ok(read(&entry,"id")?==voice))?;
 set(out,"voice",&if valid_voice{voice}else{"".into()})?;
 let valid_language=truthy(&voice_lang)&&some(&read(kit,"voices")?,|entry|Ok(method(kit,"langBase",&[&read(&entry,"lang")?])?==voice_lang))?;
 set(out,"voiceLang",&if valid_language{voice_lang}else{"".into()})?;
 set(out,"brightness",&numeric_value(&input,&numbers,"brightness",5)?)?;
 let weight=optional(&numbers,"6")?;
 let weight=if absent(&weight){let candidate=number(&read(&input,"fontWeight")?)?;if [400.0,500.0,600.0].contains(&candidate){number(&read(&input,"fontWeight")?)?}else{400.0}.into()}else{weight};
 set(out,"fontWeight",&weight)?;
 for name in ["footnotes","multilingual","skipHeaders"]{set(out,name,&truthy(&read(&input,name)?).into())?;}
 Ok(out.clone())
}
fn index(value:&JsValue,options:&[&str])->Option<usize>{options.iter().position(|name|*value==JsValue::from_str(name))}
fn dynamic_css(p:&JsValue,kit:&JsValue)->R<JsValue>{
 let theme=Reflect::get(&read(kit,"themes")?,&read(p,"theme")?)?;
 let parts=Array::new();let add=|value:JsValue|{parts.push(&value);};
 add("html { -webkit-text-size-adjust:100%; text-size-adjust:100%; color-scheme:".into());add(read(&theme,"scheme")?);
 add("; --theme-bg-color:".into());add(read(&theme,"background")?);add("; background:".into());add(read(&theme,"background")?);
 add(" !important; }\n    body { background:".into());add(read(&theme,"background")?);add(" !important; color:".into());add(read(&theme,"color")?);
 add(" !important; }\n    body, p, li, blockquote, div { font-family:".into());add(Reflect::get(&read(kit,"fonts")?,&read(p,"font")?)?);
 add(" !important; font-size:".into());add(read(p,"fontSize")?);add("px !important; font-weight:".into());add(read(p,"fontWeight")?);
 add(" !important; line-height:".into());add(read(p,"lineHeight")?);add(" !important; text-align:".into());add(read(p,"align")?);
 add(" !important; }\n    p, li, span, a, h1, h2, h3, h4, h5, h6, blockquote, div, section, article, main, table, td, th, em, strong, small, pre, code { color:inherit !important; }\n    ".into());
 if read(p,"theme")?==JsValue::from_str("amoled"){add("body :is(p, li, blockquote, div, section, article, main, table, td, th, h1, h2, h3, h4, h5, h6, span, a, em, strong, small, pre, code) { background-color:transparent !important; }".into());}
 add("\n    a { text-decoration:underline; } img, svg { max-width:100%; height:auto; }".into());
 // String.concat, unlike Array.join, spells null/undefined like templates do
 // and rejects Symbol. It also preserves lone UTF-16 surrogate code units.
 let concat=read(&JsValue::from_str(""),"concat")?;method(&concat,"apply",&[&"".into(),parts.as_ref()])
}
#[wasm_bindgen]
pub fn reading_preferences_css(preferences:&JsValue,kit:&JsValue,cache:&JsValue)->R<JsValue>{
 let p=reading_preferences_normalize(preferences,kit)?;
 let theme=index(&read(&p,"theme")?,&["paper","sepia","night","amoled","sage"]);
 let font=index(&read(&p,"font")?,&["book","classic","sans","mono"]);
 let (Some(theme),Some(font))=(theme,font)else{
  // Non-string keys accepted by Object.hasOwn preserve the legacy palette
  // lookup and template conversion without a second JavaScript CSS engine.
  return dynamic_css(&p,kit);
 };
 let mut values=[0.0;8];for(name,n)in [("fontSize",0),("lineHeight",1),("margin",2),("zoom",3),("rate",4),("brightness",5),("fontWeight",6)]{values[n]=number(&read(&p,name)?)?;}
 let justified=read(&p,"align")?==JsValue::from_str("justify");
 let key=Array::new();for value in [JsValue::from_f64(theme as f64),(font as f64).into(),values[0].into(),values[6].into(),values[1].into(),justified.into()]{key.push(&value);}
 let key=method(key.as_ref(),"join",&[&"|".into()])?;
 if truthy(&method(cache,"has",&[&key])?){return method(cache,"get",&[&key]);}
 let css=JsValue::from_str(&rules::css(&values,theme,font,justified));
 if number(&read(cache,"size")?)?>=64.0{let keys=method(cache,"keys",&[])?;let oldest=read(&method(&keys,"next",&[])?,"value")?;method(cache,"delete",&[&oldest])?;}
 method(cache,"set",&[&key,&css])?;Ok(css)
}
