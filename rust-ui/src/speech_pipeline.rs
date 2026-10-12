//! Keep raw text, cleanup offsets and sentence/chunk boundaries in one heap.
//! The browser receives normalized text once and only the final small plan.
use wasm_bindgen::prelude::*;
use js_sys::{Function,Uint16Array,Uint32Array};
#[wasm_bindgen]
pub fn speech_pipeline(raw:&[u16],footnotes:bool,skip_headers:bool,headers:Option<Vec<f64>>,pages:&[f64],from:f64,opening:bool,raw_lower:Function,letters:Function,expose:Function,properties:Function,lower:Function,clause:Function)->Result<JsValue,JsValue>{
 let n=raw.len();if n>1_000_000{return Ok(JsValue::UNDEFINED)}
 let Some(mask)=crate::speech_mask::removal_mask(raw,footnotes,skip_headers,headers,raw_lower,letters)?else{return Ok(JsValue::UNDEFINED)};
 let mut text=vec![0u16;n*2];let mut map=vec![0u32;n*2];let mut breaks=vec![0u32;n];let mut counts=[0u32;2];
 let status=unsafe{crate::speech_normalize::speech_normalize(raw.as_ptr(),mask.as_ptr(),n,text.as_mut_ptr(),map.as_mut_ptr(),breaks.as_mut_ptr(),counts.as_mut_ptr())};
 if status!=1{return Ok(JsValue::UNDEFINED)}
 let size=counts[0]as usize;let boundary_count=counts[1]as usize;
 // This synchronous callback copies UTF-16 to a JS string; it must neither
 // retain the borrowed view nor reenter WASM. No JS map array is constructed.
 let view=unsafe{Uint16Array::view(&text[..size])};
 expose.call1(&JsValue::UNDEFINED,&view)?;
 Ok(crate::speech_plan::speech_plan_records(&text[..size],&map[..size],&breaks[..boundary_count],pages,from,opening,properties,lower,clause)?.map(|output|Uint32Array::from(output.as_slice()).into()).unwrap_or(JsValue::UNDEFINED))
}
