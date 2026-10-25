//! Keep raw text, cleanup offsets and sentence/chunk boundaries in one heap.
//! The browser receives normalized text once and only the final small plan.
use wasm_bindgen::prelude::*;
use js_sys::{Function,Uint16Array,Uint32Array};
struct Normalized {text:Vec<u16>,map:Vec<u32>,breaks:Vec<u32>}
fn normalize(raw:&[u16],footnotes:bool,skip_headers:bool,headers:Option<Vec<f64>>,raw_lower:Function,letters:Function,expose:Function)->Result<Option<Normalized>,JsValue>{
 let n=raw.len();
 let Some(mask)=crate::speech_mask::removal_mask(raw,footnotes,skip_headers,headers,raw_lower,letters)?else{return Ok(None)};
 let mut text=vec![0u16;n*2];let mut map=vec![0u32;n*2];let mut breaks=vec![0u32;n];let mut counts=[0u32;2];
 let status=unsafe{crate::speech_normalize::speech_normalize(raw.as_ptr(),mask.as_ptr(),n,text.as_mut_ptr(),map.as_mut_ptr(),breaks.as_mut_ptr(),counts.as_mut_ptr())};
 if status!=1{return Ok(None)}
 text.truncate(counts[0]as usize);map.truncate(counts[0]as usize);breaks.truncate(counts[1]as usize);
 // The host copies this borrowed UTF-16 view synchronously; it must neither
 // retain the view nor reenter WASM while handling it.
 let view=unsafe{Uint16Array::view(&text)};
 expose.call1(&JsValue::UNDEFINED,&view)?;
 Ok(Some(Normalized{text,map,breaks}))
}
#[wasm_bindgen]
pub fn speech_pipeline(raw:&[u16],footnotes:bool,skip_headers:bool,headers:Option<Vec<f64>>,pages:&[f64],from:f64,opening:bool,raw_lower:Function,letters:Function,expose:Function,properties:Function,lower:Function,clause:Function)->Result<JsValue,JsValue>{
 pipeline(raw,footnotes,skip_headers,headers,pages,from,opening,raw_lower,letters,expose,properties,lower,clause,false)
}
#[wasm_bindgen]
pub fn speech_pipeline_native(raw:&[u16],footnotes:bool,skip_headers:bool,headers:Option<Vec<f64>>,pages:&[f64],from:f64,opening:bool,raw_lower:Function,letters:Function,expose:Function,properties:Function,lower:Function,cjk:Function)->Result<JsValue,JsValue>{
 pipeline(raw,footnotes,skip_headers,headers,pages,from,opening,raw_lower,letters,expose,properties,lower,cjk,true)
}
fn pipeline(raw:&[u16],footnotes:bool,skip_headers:bool,headers:Option<Vec<f64>>,pages:&[f64],from:f64,opening:bool,raw_lower:Function,letters:Function,expose:Function,properties:Function,lower:Function,clause:Function,native_clause:bool)->Result<JsValue,JsValue>{
 Ok(pipeline_records(raw,footnotes,skip_headers,headers,pages,from,opening,raw_lower,letters,expose,properties,lower,clause,native_clause)?.map(|output|Uint32Array::from(output.as_slice()).into()).unwrap_or(JsValue::UNDEFINED))
}
fn pipeline_records(raw:&[u16],footnotes:bool,skip_headers:bool,headers:Option<Vec<f64>>,pages:&[f64],from:f64,opening:bool,raw_lower:Function,letters:Function,expose:Function,properties:Function,lower:Function,clause:Function,native_clause:bool)->Result<Option<Vec<u32>>,JsValue>{
 let Some(data)=normalize(raw,footnotes,skip_headers,headers,raw_lower,letters,expose)?else{return Ok(None)};
 crate::speech_plan::speech_plan_records(&data.text,&data.map,&data.breaks,pages,from,opening,properties,lower,clause,native_clause)
}

/// Select in the retained native plan, avoiding construction of a complete
/// JavaScript fragment/sentence graph solely to find one starting position.
#[wasm_bindgen]
pub fn speech_first_complete(raw:&[u16],prefix:u32,from:f64,footnotes:bool,raw_lower:Function,letters:Function,expose:Function,properties:Function,lower:Function)->Result<JsValue,JsValue>{
 let minimum=f64::from(prefix)+if from.is_nan()||from==0.0{0.0}else{from.max(0.0)};
 let Some(data)=normalize(raw,footnotes,false,None,raw_lower,letters,expose)?else{return Ok(JsValue::NULL)};
 let ends=crate::sentence_ends::sentence_ends_native(&data.text,&data.breaks,properties,lower,0)?;
 let mut previous=0;
 for end in ends{
  let (mut start,mut stop)=(previous,end as usize);previous=stop;
  while start<stop&&crate::speech_normalize::whitespace(data.text[start]){start+=1;}
  while stop>start&&crate::speech_normalize::whitespace(data.text[stop-1]){stop-=1;}
  if start<stop&&f64::from(data.map[start])>=minimum{return Ok((f64::from(data.map[start])-f64::from(prefix)).into());}
 }
 Ok(JsValue::UNDEFINED)
}
/// The normalized text (handed to `expose` once, as UTF-16), its map back to the raw text and its hard breaks:
/// `[map length, map..., breaks...]`. The same cleanup as the plan above, for callers that need the text itself.
#[wasm_bindgen]
pub fn speech_normalized(raw:&[u16],footnotes:bool,skip_headers:bool,headers:Option<Vec<f64>>,raw_lower:Function,letters:Function,expose:Function)->Result<JsValue,JsValue>{
 let Some(data)=normalize(raw,footnotes,skip_headers,headers,raw_lower,letters,expose)?else{return Ok(JsValue::UNDEFINED)};
 let mut packed=Vec::with_capacity(1+data.map.len()+data.breaks.len());packed.push(data.map.len()as u32);packed.extend_from_slice(&data.map);packed.extend_from_slice(&data.breaks);
 Ok(Uint32Array::from(packed.as_slice()).into())
}
