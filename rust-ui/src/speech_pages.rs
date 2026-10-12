//! Incremental glyph-based page cuts. The host yields between 64-span batches.
use wasm_bindgen::{prelude::*,JsCast};
use js_sys::{Array,Function,JsString};
use crate::prop;
#[wasm_bindgen]
extern "C" { #[wasm_bindgen(js_name=Number)] fn number(value:&JsValue)->f64; }
fn numeric(value:&JsValue,key:&str)->f64{number(&prop(value,key))}
fn whitespace(code:u16)->bool{matches!(code,9..=13|32|160|5760|8192..=8202|8232|8233|8239|8287|12288|65279)}
#[wasm_bindgen]
pub struct RustSpeechPages{
 map:JsValue,spans:Array,current:Function,range:Option<Function>,text:JsString,
 size:f64,total:f64,rtl:bool,vertical:bool,index:u32,previous:Option<f64>,cuts:Vec<u32>,done:bool,
}
impl RustSpeechPages{
 fn pages(&self,start:u32,end:u32)->Result<Vec<f64>,JsValue>{
  let range=self.range.as_ref().ok_or_else(||JsValue::from_str("Missing text range provider"))?.call2(&self.map,&start.into(),&end.into())?;
  if range.is_null()||range.is_undefined(){return Ok(Vec::new());}
  let rects=prop(&range,"getClientRects").dyn_into::<Function>()?.call0(&range)?;let mut pages=Vec::new();
  if rects.is_null()||rects.is_undefined(){return Ok(pages);}
  for rect in Array::from(&rects).iter(){if !(numeric(&rect,"width")>0.0&&numeric(&rect,"height")>0.0){continue;}
   let position=if self.rtl{self.total-numeric(&rect,"right")}else if self.vertical{numeric(&rect,"top")}else{numeric(&rect,"left")};pages.push((position/self.size).floor());
  }Ok(pages)
 }
 fn glyph_page(&self,mut offset:u32,end:u32,pages:&[f64])->Result<f64,JsValue>{
  while offset<end&&whitespace(self.text.char_code_at(offset) as u16){offset+=1;}
  if offset>=end{return Ok(*pages.last().unwrap());}
  let paired=(0xd800..=0xdbff).contains(&(self.text.char_code_at(offset) as u16))&&(0xdc00..=0xdfff).contains(&(self.text.char_code_at(offset+1) as u16));
  let length=if paired{2}else{1};Ok(self.pages(offset,end.min(offset+length))?.first().copied().unwrap_or(pages[0]))
 }
}
#[wasm_bindgen]
impl RustSpeechPages{
 #[wasm_bindgen(constructor)]
 pub fn new(map:JsValue,renderer:JsValue,current:Function)->Result<Self,JsValue>{
  let spans=prop(&map,"spans").unchecked_into::<Array>();let size=numeric(&renderer,"size");
  let mut scan=Self{map,spans,current,range:None,text:JsString::from(""),size,total:0.0,rtl:false,vertical:false,index:0,previous:None,cuts:Vec::new(),done:true};
  if prop(&renderer,"scrolled").is_truthy()||!size.is_finite()||size<=0.0{return Ok(scan);}
  let doc=prop(&prop(&scan.spans.get(0),"node"),"ownerDocument");let body=prop(&doc,"body");if !body.is_truthy(){return Ok(scan);}
  let window=prop(&doc,"defaultView");let style=prop(&window,"getComputedStyle").dyn_into::<Function>()?.call1(&window,&body)?;
  scan.rtl=prop(&body,"dir")==JsValue::from_str("rtl")||prop(&style,"direction")==JsValue::from_str("rtl")||prop(&prop(&doc,"documentElement"),"dir")==JsValue::from_str("rtl");
  scan.vertical=prop(&style,"writingMode").as_string().is_some_and(|mode|mode.starts_with("vertical-"));scan.total=numeric(&renderer,"pages")*size;
  if scan.rtl&&!scan.total.is_finite(){return Ok(scan);}
  scan.range=Some(prop(&scan.map,"rangeFor").dyn_into::<Function>()?);scan.text=prop(&scan.map,"text").unchecked_into::<JsString>();scan.done=false;Ok(scan)
 }
 /// Runs at most 64 spans, matching the previous task-yield boundary exactly.
 pub fn step(&mut self)->Result<bool,JsValue>{
  if self.done{return Ok(true);}let end=self.spans.length().min(self.index.saturating_add(64));
  while self.index<end{
   if !self.current.call0(&JsValue::UNDEFINED)?.is_truthy(){self.cuts.clear();self.done=true;return Ok(true);}
   let span=self.spans.get(self.index);let start=numeric(&span,"start") as u32;let finish=numeric(&span,"end") as u32;let mut pages=self.pages(start,finish)?;
   self.index+=1;if pages.is_empty(){continue;}pages.sort_by(|a,b|a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));pages.dedup_by(|a,b|a==b||(a.is_nan()&&b.is_nan()));
   if self.previous.is_some_and(|previous|pages[0]!=previous){self.cuts.push(start);}
   for page in pages.iter().skip(1){let mut low=start;let mut high=finish;while low<high{let mid=low.wrapping_add(high)>>1;if self.glyph_page(mid,finish,&pages)?<*page{low=mid+1;}else{high=mid;}}
    if low>start&&(0xdc00..=0xdfff).contains(&(self.text.char_code_at(low) as u16)){low-=1;}
    if low>start&&low<finish{self.cuts.push(low);}
   }self.previous=pages.last().copied();
  }self.done=self.index>=self.spans.length();Ok(self.done)
 }
 pub fn result(&self)->Array{let mut cuts=self.cuts.clone();cuts.sort_unstable();cuts.dedup();cuts.into_iter().map(JsValue::from).collect()}
}
