//! Language scoring owns its dictionaries and score vectors in Rust.
//! Browser Unicode/locale rules are preserved at the text boundary.
use std::{cell::RefCell,collections::{HashMap,HashSet}};
use wasm_bindgen::{prelude::*,JsCast};
use js_sys::{Array,Function,JsString,RegExp};
use crate::language_data::{WORDS,HINTS,REGIONS,SCRIPTS};
const CORE:&[&str]=&["es","en","fr","de","it","pt","ca"];
struct Detector {
 words:HashMap<&'static str,Vec<usize>>,
 letters:RegExp, scripts:Vec<RegExp>, hints:Vec<(usize,f64)>, hint_chars:HashMap<char,Vec<usize>>, finnish:usize, separators:RegExp,
 ukrainian:RegExp,russian:RegExp,russian_hint:RegExp,serbian:RegExp,word_separators:RegExp,brazilian:RegExp,
}
fn count(sample:&JsString,pattern:&RegExp)->u32{sample.match_(pattern).map(|x|x.unchecked_into::<Array>().length()).unwrap_or(0)}
fn index(lang:&str)->usize{WORDS.iter().position(|(key,_)|*key==lang).unwrap()}
impl Detector {
 fn new()->Self{
  let core:HashSet<&str>=WORDS.iter().filter(|(lang,_)|CORE.contains(lang)).flat_map(|(_,text)|text.split(' ')).collect();
  let mut words:HashMap<&str,Vec<usize>>=HashMap::new();
  for (i,(lang,text)) in WORDS.iter().enumerate(){
   let unique:HashSet<&str>=text.split(' ').filter(|word|CORE.contains(lang)||!core.contains(word)).collect();
   for word in unique{words.entry(word).or_default().push(i);}
  }
  let mut hint_chars:HashMap<char,Vec<usize>>=HashMap::new();let mut finnish=0;
  for (i,(_,pattern,_)) in HINTS.iter().enumerate(){
   if *pattern=="ää|öö|yy|äy|öy|yö|äi|öi"{finnish=i;continue;}
   let chars=if *pattern=="l·l|·"{"·"}else{pattern.strip_prefix('[').and_then(|p|p.strip_suffix(']')).unwrap_or(pattern)};
   for c in chars.chars(){hint_chars.entry(c).or_default().push(i);}
  }
  Self{words,letters:RegExp::new(r"\p{L}","gu"),scripts:SCRIPTS.iter().map(|(_,pattern)|RegExp::new(pattern,"gu")).collect(),
   hints:HINTS.iter().map(|(lang,_,weight)|(index(lang),*weight)).collect(),hint_chars,finnish,
   separators:RegExp::new(r"[^\p{L}·']+","gu"),word_separators:RegExp::new(r"[^\p{L}]+","gu"),
   ukrainian:RegExp::new("[іїєґ]","g"),russian:RegExp::new("[ыэёъ]","g"),russian_hint:RegExp::new("[ыэё]","u"),serbian:RegExp::new("[ђјљњћџ]","u"),
   brazilian:RegExp::new(r"(?<!\p{L})(?:você|vocês|ônibus|celular|geladeira|café da manhã|a gente)(?!\p{L})","iu")}
 }
 fn script(&self,sample:&JsString,fallback:&JsValue,normalize:&Function)->Result<&'static str,JsValue>{
  let letters=count(sample,&self.letters);if letters==0{return Ok("");}
  let counts:Vec<u32>=self.scripts.iter().map(|pattern|count(sample,pattern)).collect();
  let mut winner=0;for i in 1..counts.len(){if counts[i]>counts[winner]{winner=i;}}
  let hits=counts[winner];if (hits<2&&!(hits==1&&letters==1))||(hits as f64)<letters as f64*0.4{return Ok("");}
  let lang=SCRIPTS[winner].0;
  if lang=="ja"||(lang=="zh"&&counts[6]>0){return Ok("ja");}
  if lang=="ru"&&count(sample,&self.ukrainian)>count(sample,&self.russian){return Ok("uk");}
  if lang=="ru"{
   if sample.match_(&self.serbian).is_some(){return Ok("sr");}
   let known=normalized(normalize,fallback)?;let home=known.split('-').next().unwrap_or("");
   if sample.match_(&self.russian_hint).is_none(){match home{"bg"=>return Ok("bg"),"sr"=>return Ok("sr"),"uk"=>return Ok("uk"),_=>{}}}
   let words:String=sample.replace_by_pattern(&self.word_separators,"\0").into();
   let hits=words.split('\0').filter(|word|matches!(*word,"беше"|"когато"|"някой"|"никой"|"съм"|"също"|"която"|"който"|"това"|"дъждът")).take(2).count();
   if hits>=2{return Ok("bg");}
  }Ok(lang)
 }
 fn detect(&self,sample:&JsString,fallback:JsValue,normalize:&Function)->Result<JsValue,JsValue>{
  let plain=sample.as_string().unwrap_or_default();
  let script=if plain.is_ascii(){""}else{self.script(sample,&fallback,normalize)?};
  if !script.is_empty(){let known=normalized(normalize,&fallback)?;return Ok(regional(script,&known).into());}
  let text:String=sample.replace_by_pattern(&self.separators,"\0").into();
  let mut scores=vec![0.0;WORDS.len()];let mut seen=vec![false;WORDS.len()];let mut order=Vec::new();
  let add=|lang:usize,amount:f64,scores:&mut Vec<f64>,seen:&mut Vec<bool>,order:&mut Vec<usize>|{if !seen[lang]{seen[lang]=true;order.push(lang);}scores[lang]+=amount;};
  for word in text.split('\0').filter(|word|!word.is_empty()){
   if let Some(langs)=self.words.get(word){for &lang in langs{add(lang,if langs.len()==1{1.0}else{0.5},&mut scores,&mut seen,&mut order);}}
  }
  // One native pass replaces 27 independent regex scans and their ABI crossings.
  // Finnish two-character alternatives must remain non-overlapping like /g.
  let mut hits=vec![0u32;self.hints.len()];let mut previous=None;
  for c in plain.chars(){
   if !c.is_ascii(){if let Some(indices)=self.hint_chars.get(&c){for &i in indices{hits[i]+=1;}}}
   if matches!((previous,c),(Some('ä'),'ä'|'y'|'i')|(Some('ö'),'ö'|'y'|'i')|(Some('y'),'y'|'ö')){hits[self.finnish]+=1;previous=None;}else{previous=Some(c);}
  }
  for (i,(lang,weight)) in self.hints.iter().enumerate(){if hits[i]>0{add(*lang,hits[i] as f64*weight,&mut scores,&mut seen,&mut order);}}
  let known=normalized(normalize,&fallback)?;let home=known.split('-').next().unwrap_or("");
  // Preserve the original object-table behavior for this malformed tag too.
  if home=="constructor"&&order.is_empty(){return Ok(regional(home,&known).into());}
  let home_index=WORDS.iter().position(|(lang,_)|*lang==home);
  if let Some(home)=home_index{add(home,0.0,&mut scores,&mut seen,&mut order);}
  let ranked_score=|i:usize|scores[i]+if Some(i)==home_index{2.0}else{0.0};
  order.sort_by(|a,b|ranked_score(*b).partial_cmp(&ranked_score(*a)).unwrap());
  let Some(&winner)=order.first()else{return Ok(fallback)};
  if scores[winner]<2.0||order.get(1).map(|i|ranked_score(*i)==ranked_score(winner)).unwrap_or(false){return Ok(fallback);}
  let lang=WORDS[winner].0;
  if lang==home&&known.contains('-'){return Ok(known.into());}
  if lang=="pt"{return Ok(if sample.match_(&self.brazilian).is_some(){"pt-BR"}else{"pt-PT"}.into());}
  Ok(regional(lang,"").into())
 }
}
fn normalized(normalize:&Function,value:&JsValue)->Result<String,JsValue>{Ok(normalize.call1(&JsValue::UNDEFINED,value)?.as_string().unwrap_or_default())}
fn regional(lang:&str,known:&str)->String{if known.split('-').next()==Some(lang)&&known.contains('-'){known.to_owned()}else{format!("{lang}-{}",REGIONS.iter().find(|(key,_)|*key==lang).map(|(_,value)|*value).unwrap_or("undefined"))}}
thread_local!{static DETECTOR:RefCell<Option<Detector>>=const{RefCell::new(None)};}
#[wasm_bindgen]extern "C"{#[wasm_bindgen(catch,js_name=String)]fn string(value:&JsValue)->Result<JsString,JsValue>;}
#[wasm_bindgen]
pub fn detect_voice_language(text:JsValue,fallback:JsValue,normalize:Function)->Result<JsValue,JsValue>{
 let sample=string(&if text.is_truthy(){text}else{"".into()})?.to_locale_lower_case(None);
 DETECTOR.with(|slot|{let mut slot=slot.borrow_mut();let detector=slot.get_or_insert_with(Detector::new);detector.detect(&sample,fallback,&normalize)})
}
