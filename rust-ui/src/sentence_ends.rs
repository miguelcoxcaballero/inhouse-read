//! Sentence decisions use original UTF-16 offsets. Browser Unicode properties
//! and locale casing remain at the boundary; punctuation scans stay native.
use wasm_bindgen::prelude::*;
use js_sys::{Array,Function};
use std::{collections::{HashMap,HashSet},sync::LazyLock};
static ABBREVIATIONS:LazyLock<HashSet<&'static str>>=LazyLock::new(||"sr sra sres sras srta srs dr dra drs lic ing arq prof profa pág págs pag pags núm num vol vols ed eds av avda pza gral cnel sto sta ud uds vd vds ee mr mrs ms mx messrs mt jr vs cf fig figs pp approx m mm mme mmes mlle mlles st ste env chap bd hr nr str bzw ggf sig sigg dott avv".split(' ').collect());
static BEFORE_NUMBER:LazyLock<HashSet<&'static str>>=LazyLock::new(||"jan feb mar apr jun jul aug sep sept oct nov dec ene abr ago dic no nº n.º p".split(' ').collect());
fn space(c:u16)->bool{matches!(c,9..=13|32|160|0x1680|0x2000..=0x200a|0x2028|0x2029|0x202f|0x205f|0x3000|0xfeff)}
fn terminator(c:u16)->bool{matches!(c,46|33|63|0x3002|0xff01|0xff1f|0x2026|0x61f|0x964|0x965)}
fn closer(c:u16)->bool{matches!(c,34|39|0x201d|0x2019|0xbb|0x203a|41|93|125|0x300d|0x300f)}
fn opener(c:u16)->bool{matches!(c,0x2014|0x2013|45|34|39|0x201c|0x2018|0xab|0x2039|40|91)}
fn dash(c:u16)->bool{matches!(c,0x2014|0x2013|45)}
fn list_number(text:&[u16])->bool{
 let mut a=0;let mut b=text.len();while a<b&&space(text[a]){a+=1}while b>a&&space(text[b-1]){b-=1}
 if a<b&&matches!(text[a],40|91){a+=1}
 let start=a;while a<b&&!matches!(text[a],46|41|93){a+=1}
 let token=&text[start..a];if token.is_empty(){return false}
 let valid=(token.len()<=3&&token.iter().all(|c|(48..=57).contains(c)))
  ||(token.len()==1&&matches!(token[0],65..=90|97..=122))
  ||(token.len()<=6&&token.iter().all(|c|matches!(c,73|86|88|76|67|68|77|105|118|120|108|99|100|109)));
 valid&&text[a..b].iter().all(|c|matches!(c,46|41|93))
}
struct Candidate{end:usize,start:usize,run_end:usize,hard:bool}
struct Scan<'a>{text:&'a[u16],base:usize,properties:Function,lower:Function,cache:HashMap<u32,u8>}
impl Scan<'_>{
 fn flags(&mut self,code:u32)->Result<u8,JsValue>{
  if code<128{return Ok(match code{48..=57=>3,65..=90=>9,97..=122=>5,_=>0})}
  if let Some(value)=self.cache.get(&code){return Ok(*value)}
  let flags=self.properties.call1(&JsValue::UNDEFINED,&code.into())?.as_f64().unwrap_or(0.0)as u8;self.cache.insert(code,flags);Ok(flags)
 }
 fn word_start(&mut self,from:usize,end:usize)->Result<usize,JsValue>{
  let mut at=end;
  while at>from{
   let mut start=at-1;let mut code=self.text[start]as u32;
   if (0xdc00..=0xdfff).contains(&code)&&start>from&&(0xd800..=0xdbff).contains(&self.text[start-1]){start-=1;code=0x10000+((self.text[start]as u32-0xd800)<<10)+(code-0xdc00)}
   if self.flags(code)?&1==0{break}at=start;
  }Ok(at)
 }
 fn ends(&mut self,from:usize,c:&Candidate)->Result<bool,JsValue>{
  let text=self.text;let end=c.end;if end>=text.len(){return Ok(true)}
  let mut n=end;while n<text.len()&&space(text[n]){n+=1}if n>=text.len(){return Ok(true)}
  let run=&text[c.start..c.run_end];let last=run[run.len()-1];
  if n==end{return Ok(matches!(last,0x3002|0xff01|0xff1f)||run.iter().any(|v|matches!(v,33|63))||!(self.flags(text[n]as u32)?&1!=0||text[n]==45))}
  let mut lead=n;while lead<text.len()&&opener(text[lead]){lead+=1}
  let next=if lead<text.len(){self.flags(text[lead]as u32)?}else{0};
  let word_start=self.word_start(from,c.start)?;let length=c.start-word_start;
  let lower=self.lower.call2(&JsValue::UNDEFINED,&((self.base+word_start)as u32).into(),&((self.base+c.start)as u32).into())?.as_string().unwrap_or_default();
  let abbreviation=ABBREVIATIONS.contains(lower.as_str());let period=run==[46];
  if next&4!=0{
   if end>c.run_end||dash(text[n])||run.windows(2).any(|v|v==[46,46])||run.contains(&0x2026){return Ok(false)}
   if period&&(length<=2||abbreviation||lower=="etc"){return Ok(false)}
  }
  if !period{return Ok(true)}
  if abbreviation&&(length>1||lower=="m"){return Ok(false)}
  if BEFORE_NUMBER.contains(lower.as_str())&&next&2!=0{return Ok(false)}
  if length==1&&self.flags(text[word_start]as u32)?&8!=0&&next&8!=0{return Ok(false)}
  if list_number(&text[from..end]){return Ok(false)}
  Ok(true)
 }
}
#[wasm_bindgen]
pub fn speech_sentence_ends(text:&[u16],breaks:JsValue,properties:Function,lower:Function)->Result<JsValue,JsValue>{
 if !Array::is_array(&breaks){return Ok(JsValue::UNDEFINED)}
 let mut typed=Vec::new();
 for value in Array::from(&breaks).iter(){let Some(end)=value.as_f64()else{return Ok(JsValue::UNDEFINED)};if !end.is_finite()||end<0.0||end.fract()!=0.0||end>text.len()as f64{return Ok(JsValue::UNDEFINED)}typed.push(end as u32);}
 let result=sentence_ends_native(text,&typed,properties,lower,0)?;
 let values=Array::new();for end in result{values.push(&end.into());}Ok(values.into())
}
/// Sentences of an already normalized text with the fragments each is spoken in (at most 180 code units, cut at a clause
/// mark near the middle): `[sentence start, sentence end, fragment start, fragment end]` per fragment.
#[wasm_bindgen]
pub fn speech_sentences(text:&[u16],breaks:JsValue,properties:Function,lower:Function)->Result<JsValue,JsValue>{
 if !Array::is_array(&breaks){return Ok(JsValue::UNDEFINED)}
 let mut typed=Vec::new();
 for value in Array::from(&breaks).iter(){let Some(end)=value.as_f64()else{return Ok(JsValue::UNDEFINED)};if !end.is_finite()||end<0.0||end.fract()!=0.0||end>text.len()as f64{return Ok(JsValue::UNDEFINED)}typed.push(end as u32);}
 let ends=sentence_ends_native(text,&typed,properties,lower,0)?;
 let capacity=ends.len()+text.len().div_ceil(50);let mut fragments=vec![0u32;capacity*4+1];
 let status=unsafe{crate::speech_fragments_core::speech_fragments(text.as_ptr(),text.len(),ends.as_ptr(),ends.len(),fragments.as_mut_ptr(),capacity)};
 if status!=1{return Ok(JsValue::UNDEFINED)}
 Ok(js_sys::Uint32Array::from(&fragments[1..1+fragments[0]as usize*4]).into())
}
pub(crate) fn sentence_ends_native(text:&[u16],breaks:&[u32],properties:Function,lower:Function,base:usize)->Result<Vec<u32>,JsValue>{
 let mut candidates:Vec<Candidate>=breaks.iter().map(|end|Candidate{end:*end as usize,start:0,run_end:0,hard:true}).collect();
 let mut at=0;while at<text.len(){
  if !terminator(text[at]){at+=1;continue}
  let start=at;while at<text.len()&&terminator(text[at]){at+=1}let run_end=at;let mut end=at;
  loop{if end<text.len()&&closer(text[end]){end+=1}else if end+1<text.len()&&text[end]==32&&matches!(text[end+1],0xbb|0x203a){end+=2}else{break}}
  candidates.push(Candidate{end,start,run_end,hard:false});
 }
 candidates.sort_by_key(|v|v.end);
 let mut scan=Scan{text,base,properties,lower,cache:HashMap::new()};let mut from=0;let mut ends=Vec::new();
 for candidate in candidates{if candidate.end<=from{continue}if candidate.hard||scan.ends(from,&candidate)?{ends.push(candidate.end as u32);from=candidate.end}}
 if from<text.len(){ends.push(text.len()as u32);}Ok(ends)
}
