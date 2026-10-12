//! Build the narration and page-mark plan in one typed operation. Sentence
//! detection and clause chunking share the already-normalized UTF-16 buffer.
use wasm_bindgen::prelude::*;
use js_sys::{Function,Uint32Array};
use crate::speech_normalize::whitespace;
fn lower_bound(map:&[u32],offset:f64,from:usize)->usize{
 let(mut a,mut b)=(from,map.len());while a<b{let mid=(a+b)/2;if (map[mid]as f64)<offset{a=mid+1}else{b=mid}}a
}
#[wasm_bindgen]
pub fn speech_plan(text:&[u16],map:&[u32],breaks:&[u32],pages:&[f64],from:f64,opening:bool,properties:Function,lower:Function,clause:Function)->Result<JsValue,JsValue>{
 if text.len()>1_000_000||map.len()!=text.len()||map.last()==Some(&u32::MAX)||breaks.iter().any(|at|*at as usize>text.len())||map.windows(2).any(|w|w[0]>w[1]){return Ok(JsValue::UNDEFINED)}
 Ok(speech_plan_records(text,map,breaks,pages,from,opening,properties,lower,clause)?.map(|output|Uint32Array::from(output.as_slice()).into()).unwrap_or(JsValue::UNDEFINED))
}
pub(crate) fn speech_plan_records(text:&[u16],map:&[u32],breaks:&[u32],pages:&[f64],from:f64,opening:bool,properties:Function,lower:Function,clause:Function)->Result<Option<Vec<u32>>,JsValue>{
 let low=lower_bound(map,from,0);let source=&text[low..];
 let boundaries:Vec<u32>=breaks.iter().filter(|at|**at as usize>=low).map(|at|*at-low as u32).collect();
 let ends=crate::sentence_ends::sentence_ends_native(source,&boundaries,properties,lower,low)?;
 let capacity=ends.len()+source.len().div_ceil(50);let mut fragments=vec![0u32;capacity*4+1];
 let status=unsafe{crate::speech_fragments_core::speech_fragments(source.as_ptr(),source.len(),ends.as_ptr(),ends.len(),fragments.as_mut_ptr(),capacity)};
 if status!=1{return Ok(None)}
 let mut cuts=Vec::new();for offset in pages.iter().filter(|value|value.is_finite()){
  let mut at=lower_bound(map,*offset,low);while at<text.len()&&whitespace(text[at]){at+=1}cuts.push(at-low);
 }cuts.sort_unstable();cuts.dedup();
 let mut output=Vec::new();let mut sentence=0u32;let mut prior=None;
 for part in fragments[1..1+fragments[0]as usize*4].chunks_exact(4){
  let (whole_start,whole_end,start,end)=(part[0]as usize,part[1]as usize,part[2]as usize,part[3]as usize);
  if prior!=Some(whole_start){sentence+=1;prior=Some(whole_start)}
  let first=if opening&&output.is_empty()&&end-start>100{clause.call2(&JsValue::UNDEFINED,&((low+start)as u32).into(),&((low+end)as u32).into())?.as_f64().filter(|v|v.is_finite()&&v.fract()==0.0&&*v>(low+start)as f64&&*v<(low+end)as f64).map(|v|v as usize-low)}else{None};
  let bounds=[start,first.unwrap_or(end),end];
  for pair in bounds.windows(2){
   let(mut a,mut b)=(pair[0],pair[1]);while a<b&&whitespace(source[a]){a+=1}while b>a&&whitespace(source[b-1]){b-=1}if b<=a{continue}
   let mark_start=cuts.partition_point(|at|*at<=a);let mark_end=cuts.partition_point(|at|*at<b);
   output.extend_from_slice(&[(low+a)as u32,(low+b)as u32,map[low+a],map[low+b-1]+1,map[low+whole_start],map[low+whole_end-1]+1,sentence,(mark_end-mark_start)as u32]);
   for at in &cuts[mark_start..mark_end]{output.extend_from_slice(&[(*at-a)as u32,map[low+*at]])}
  }
 }
 Ok(Some(output))
}
