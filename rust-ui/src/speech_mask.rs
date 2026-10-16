//! Removal ranges are computed before speech normalization, in original UTF-16
//! coordinates. Confirmed headers never authorize discarding body paragraphs.
//! Header lines are compared by their lower-cased UTF-16 units (the browser lower-cases;
//! a lone surrogate is a distinct key of its own, as it was in JavaScript).
use wasm_bindgen::prelude::*;
use js_sys::{Function,Uint16Array};
use std::collections::HashMap;
fn space(c:u16)->bool{matches!(c,9..=13|32|160|0x1680|0x2000..=0x200a|0x2028|0x2029|0x202f|0x205f|0x3000|0xfeff)}
fn separator(c:u16)->bool{matches!(c,10|13|0x2028|0x2029)}
fn digit(c:u16)->bool{(48..=57).contains(&c)}
fn trim(text:&[u16],mut start:usize,mut end:usize)->(usize,usize){while start<end&&space(text[start]){start+=1}while end>start&&space(text[end-1]){end-=1}(start,end)}
fn cp_at(text:&[u16],at:usize)->u32{let code=text[at]as u32;if (0xd800..=0xdbff).contains(&code)&&at+1<text.len()&&(0xdc00..=0xdfff).contains(&text[at+1]){0x10000+((code-0xd800)<<10)+(text[at+1]as u32-0xdc00)}else{code}}
fn cp_before(text:&[u16],at:usize)->u32{let start=if at>1&&(0xdc00..=0xdfff).contains(&text[at-1])&&(0xd800..=0xdbff).contains(&text[at-2]){at-2}else{at-1};cp_at(text,start)}
fn footnote_end(text:&[u16],start:usize)->Option<usize>{
 let mut at=start+1;
 if text[start]==91{
  if at<text.len()&&matches!(text[at],42|0x2020|0x2021){at+=1}else{let first=at;while at<text.len()&&at-first<3&&digit(text[at]){at+=1}if at==first{return None}}
  return if text.get(at)==Some(&93){Some(at+1)}else{None}
 }
 if text[start]!=40{return None}
 while at<text.len()&&space(text[at]){at+=1}
 if at+4>text.len()||!matches!(text[at],78|110)||!matches!(text[at+1],79|111)||!matches!(text[at+2],84|116)||!matches!(text[at+3],65|97|69|101){return None}at+=4;
 let before_space=at;while at<text.len()&&space(text[at]){at+=1}if at==before_space{return None}
 let first=at;while at<text.len()&&digit(text[at]){at+=1}if at==first{return None}
 while at<text.len()&&space(text[at]){at+=1}if text.get(at)==Some(&41){Some(at+1)}else{None}
}
fn confirmed_range(text:&[u16],start:f64,end:f64)->Result<Option<(usize,usize)>,JsValue>{
 if !start.is_finite()||!end.is_finite()||start.fract()!=0.0||end.fract()!=0.0||start<0.0||end>text.len()as f64||end<=start{return Ok(None)}
 let (start,end)=(start as usize,end as usize);let (a,b)=trim(text,start,end);
 if a==b||b-a>=90||text[start..end].iter().any(|c|separator(*c)){return Ok(None)}
 let mut before=start;while before>0&&!separator(text[before-1]){before-=1}
 let mut after=end;while after<text.len()&&!separator(text[after]){after+=1}
 if text[before..start].iter().all(|c|space(*c))&&text[end..after].iter().all(|c|space(*c)){Ok(Some((start,end)))}else{Ok(None)}
}
fn letter_flags(code:u32,properties:&Function,cache:&mut HashMap<u32,u8>)->Result<u8,JsValue>{
 if code<128{return Ok(match code{65..=90=>1,97..=122=>3,_=>0})}
 if let Some(value)=cache.get(&code){return Ok(*value)}
 let flags=properties.call1(&JsValue::UNDEFINED,&code.into())?.as_f64().unwrap_or(0.0)as u8;cache.insert(code,flags);Ok(flags)
}
pub(crate) fn removal_mask(text:&[u16],footnotes:bool,skip_headers:bool,header_ranges:Option<Vec<f64>>,lower:Function,properties:Function)->Result<Option<Vec<u8>>,JsValue>{
 let mut removed=vec![0u8;text.len()];
 if !footnotes{for start in 0..text.len(){
  if let Some(end)=footnote_end(text,start){removed[start..end].fill(1)}
  if text[start]==42&&(start==0||space(text[start-1])||matches!(text[start-1],46|44|59|58)){
   let mut end=start+1;while end<text.len()&&end-start<=3&&digit(text[end]){end+=1;}
   if end>start+1&&(end==text.len()||space(text[end])||matches!(text[end],46|44|59|58|42)){
    if text.get(end)==Some(&42){end+=1;}removed[start..end].fill(1);
   }
  }
 }}
 if skip_headers{
  if let Some(ranges)=header_ranges{
   for range in ranges.chunks_exact(2){if let Some((a,b))=confirmed_range(text,range[0],range[1])?{removed[a..b].fill(1)}}
  }else{
   let mut lines=Vec::new();let mut groups=HashMap::<Vec<u16>,Vec<usize>>::new();let mut lowered=HashMap::<&[u16],Vec<u16>>::new();let mut at=0;
   while at<text.len(){
    if matches!(text[at],10|0x2029){at+=1;continue}
    let start=at;while at<text.len()&&!matches!(text[at],10|0x2029){at+=1}let end=at;let index=lines.len();lines.push((start,end));
    let (a,b)=trim(text,start,end);if a==b{continue}
    let source=&text[a..b];
    let key=if let Some(key)=lowered.get(source){key.clone()}else{
     let value=lower.call2(&JsValue::UNDEFINED,&(a as u32).into(),&(b as u32).into())?;
     let Some(units)=value.dyn_ref::<Uint16Array>()else{return Ok(None)};
     let key=units.to_vec();lowered.insert(source,key.clone());key};
    if !key.is_empty()&&key.len()<90{groups.entry(key).or_default().push(index)}
   }
   for places in groups.values(){for (i,index)in places.iter().enumerate(){if (i>0&&index-places[i-1]<=40)||(i+1<places.len()&&places[i+1]-index<=40){let(a,b)=lines[*index];removed[a..b].fill(1)}}}
  }
 }
 let mut cache=HashMap::new();
 for at in 1..text.len().saturating_sub(2){
  if matches!(text[at],45|0x2010)&&text[at+1]==10&&letter_flags(cp_before(text,at),&properties,&mut cache)?&1!=0&&letter_flags(cp_at(text,at+2),&properties,&mut cache)?&2!=0{removed[at..at+2].fill(1)}
 }
 Ok(Some(removed))
}
