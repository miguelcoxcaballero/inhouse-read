//! Spoken numeric forms are prepared only for synthesis. Queue/cache identity, reader text,
//! highlighting and returned page-boundary offsets remain in their original UTF-16 coordinates.
//! Converters are third-party Rust (num2words2-core, MIT/Apache-2.0), loaded lazily per language.
use std::sync::OnceLock;
use wasm_bindgen::{prelude::*,JsCast};
use js_sys::{Array,JsString,Object,Reflect};
use num2words2_core::{self as n2w,base::Lang};
use num_bigint::BigInt;

fn cardinal(value:&BigInt,tag:&str)->Option<String>{
 let key=tag.replace('-',"_").to_ascii_lowercase();
 let base=key.split('_').next().unwrap_or("");
 let key=if key=="pt_br"{"pt_br"}else if base=="no"{"nb"}else{base};
 match key{
  "en" => { static VALUE:OnceLock<n2w::LangEn>=OnceLock::new(); VALUE.get_or_init(n2w::LangEn::new).to_cardinal(value).ok() },
  "es" => { static VALUE:OnceLock<n2w::LangEs>=OnceLock::new(); VALUE.get_or_init(n2w::LangEs::new).to_cardinal(value).ok() },
  "fr" => { static VALUE:OnceLock<n2w::LangFr>=OnceLock::new(); VALUE.get_or_init(n2w::LangFr::new).to_cardinal(value).ok() },
  "de" => { static VALUE:OnceLock<n2w::LangDe>=OnceLock::new(); VALUE.get_or_init(n2w::LangDe::new).to_cardinal(value).ok() },
  "it" => { static VALUE:OnceLock<n2w::LangIt>=OnceLock::new(); VALUE.get_or_init(n2w::LangIt::new).to_cardinal(value).ok() },
  "pt" => { static VALUE:OnceLock<n2w::LangPt>=OnceLock::new(); VALUE.get_or_init(n2w::LangPt::new).to_cardinal(value).ok() },
  "pt_br" => { static VALUE:OnceLock<n2w::LangPtBr>=OnceLock::new(); VALUE.get_or_init(n2w::LangPtBr::new).to_cardinal(value).ok() },
  "ca" => { static VALUE:OnceLock<n2w::LangCa>=OnceLock::new(); VALUE.get_or_init(n2w::LangCa::new).to_cardinal(value).ok() },
  "nl" => { static VALUE:OnceLock<n2w::LangNl>=OnceLock::new(); VALUE.get_or_init(n2w::LangNl::new).to_cardinal(value).ok() },
  "pl" => { static VALUE:OnceLock<n2w::LangPl>=OnceLock::new(); VALUE.get_or_init(n2w::LangPl::new).to_cardinal(value).ok() },
  "ru" => { static VALUE:OnceLock<n2w::LangRu>=OnceLock::new(); VALUE.get_or_init(n2w::LangRu::new).to_cardinal(value).ok() },
  "uk" => { static VALUE:OnceLock<n2w::LangUk>=OnceLock::new(); VALUE.get_or_init(n2w::LangUk::new).to_cardinal(value).ok() },
  "tr" => { static VALUE:OnceLock<n2w::LangTr>=OnceLock::new(); VALUE.get_or_init(n2w::LangTr::new).to_cardinal(value).ok() },
  "sv" => { static VALUE:OnceLock<n2w::LangSv>=OnceLock::new(); VALUE.get_or_init(n2w::LangSv::new).to_cardinal(value).ok() },
  "da" => { static VALUE:OnceLock<n2w::LangDa>=OnceLock::new(); VALUE.get_or_init(n2w::LangDa::new).to_cardinal(value).ok() },
  "nb" => { static VALUE:OnceLock<n2w::LangNb>=OnceLock::new(); VALUE.get_or_init(n2w::LangNb::new).to_cardinal(value).ok() },
  "fi" => { static VALUE:OnceLock<n2w::LangFi>=OnceLock::new(); VALUE.get_or_init(n2w::LangFi::new).to_cardinal(value).ok() },
  "cs" => { static VALUE:OnceLock<n2w::LangCs>=OnceLock::new(); VALUE.get_or_init(n2w::LangCs::new).to_cardinal(value).ok() },
  "el" => { static VALUE:OnceLock<n2w::LangEl>=OnceLock::new(); VALUE.get_or_init(n2w::LangEl::new).to_cardinal(value).ok() },
  "hu" => { static VALUE:OnceLock<n2w::LangHu>=OnceLock::new(); VALUE.get_or_init(n2w::LangHu::new).to_cardinal(value).ok() },
  "ro" => { static VALUE:OnceLock<n2w::LangRo>=OnceLock::new(); VALUE.get_or_init(n2w::LangRo::new).to_cardinal(value).ok() },
  "ar" => { static VALUE:OnceLock<n2w::LangAr>=OnceLock::new(); VALUE.get_or_init(n2w::LangAr::new).to_cardinal(value).ok() },
  "zh" => { static VALUE:OnceLock<n2w::LangZh>=OnceLock::new(); VALUE.get_or_init(n2w::LangZh::new).to_cardinal(value).ok() },
  "vi" => { static VALUE:OnceLock<n2w::LangVi>=OnceLock::new(); VALUE.get_or_init(n2w::LangVi::new).to_cardinal(value).ok() },
  "bg" => { static VALUE:OnceLock<n2w::LangBg>=OnceLock::new(); VALUE.get_or_init(n2w::LangBg::new).to_cardinal(value).ok() },
  "sr" => { static VALUE:OnceLock<n2w::LangSr>=OnceLock::new(); VALUE.get_or_init(n2w::LangSr::new).to_cardinal(value).ok() },
  "hi" => { static VALUE:OnceLock<n2w::LangHi>=OnceLock::new(); VALUE.get_or_init(n2w::LangHi::new).to_cardinal(value).ok() },
  "he" => { static VALUE:OnceLock<n2w::LangHe>=OnceLock::new(); VALUE.get_or_init(n2w::LangHe::new).to_cardinal(value).ok() },
  "ko" => { static VALUE:OnceLock<n2w::LangKo>=OnceLock::new(); VALUE.get_or_init(n2w::LangKo::new).to_cardinal(value).ok() },
  "ja" => { static VALUE:OnceLock<n2w::LangJa>=OnceLock::new(); VALUE.get_or_init(n2w::LangJa::new).to_cardinal(value).ok() },
  "et" => { static VALUE:OnceLock<n2w::LangEt>=OnceLock::new(); VALUE.get_or_init(n2w::LangEt::new).to_cardinal(value).ok() },
  "hr" => { static VALUE:OnceLock<n2w::LangHr>=OnceLock::new(); VALUE.get_or_init(n2w::LangHr::new).to_cardinal(value).ok() },
  "id" => { static VALUE:OnceLock<n2w::LangId>=OnceLock::new(); VALUE.get_or_init(n2w::LangId::new).to_cardinal(value).ok() },
  "lt" => { static VALUE:OnceLock<n2w::LangLt>=OnceLock::new(); VALUE.get_or_init(n2w::LangLt::new).to_cardinal(value).ok() },
  "lv" => { static VALUE:OnceLock<n2w::LangLv>=OnceLock::new(); VALUE.get_or_init(n2w::LangLv::new).to_cardinal(value).ok() },
  "sk" => { static VALUE:OnceLock<n2w::LangSk>=OnceLock::new(); VALUE.get_or_init(n2w::LangSk::new).to_cardinal(value).ok() },
  "sl" => { static VALUE:OnceLock<n2w::LangSl>=OnceLock::new(); VALUE.get_or_init(n2w::LangSl::new).to_cardinal(value).ok() },
  _=>None
 }
}
// A four-digit token is ambiguous: use grammatical/date evidence rather than its
// magnitude alone. A following count/unit wins over a temporal preposition.
fn year_context(input:&[u16],start:usize,end:usize,raw:&str)->bool{
 if raw.len()!=4 || raw.starts_with('0'){return false;}
 let before=String::from_utf16_lossy(&input[..start]).to_lowercase();
 let after=String::from_utf16_lossy(&input[end..]).to_lowercase();
 let words=|s:&str|s.split(|c:char|!c.is_alphabetic()).filter(|w|!w.is_empty()).map(str::to_owned).collect::<Vec<_>>();
 let previous=words(&before);let next=words(&after);
 let last=previous.last().map(String::as_str).unwrap_or("");
 let first=next.first().map(String::as_str).unwrap_or("");
 let units=["books","pages","people","items","copies","dollars","pounds","euros","meters","metres","kilometers","kilometres","miles","kg","grams","watts","hours","days","years","libros","páginas","personas","ejemplares"];
 if units.contains(&first) || before.trim_end().ends_with(['$','€','£']) || after.trim_start().starts_with(['$','€','£','%']) {return false;}
 let explicit=["year","in","since","during","until","before","after","by","circa","born","died","copyright","año","años","en","desde","hasta","vers","année","jahr","im","seit"];
 let months=["january","february","march","april","may","june","july","august","september","october","november","december"];
 if explicit.contains(&last) || months.contains(&last) || previous.iter().rev().take(2).any(|w|months.contains(&w.as_str())) {return true;}
 if ["ad","bc","ce","bce"].contains(&first){return true;}
 // A date range inherits the context of its first year, without treating a
 // subtraction or an arbitrary numeric interval as a date on its own.
 let trimmed=before.trim_end();
 if trimmed.ends_with(['–','—','-']){
  let prefix=trimmed.trim_end_matches(['–','—','-']).trim_end();
  let digits=prefix.chars().rev().take_while(|c|c.is_ascii_digit()).count();
  if digits==4{
   let head=words(&prefix[..prefix.len()-4]);
   if head.last().is_some_and(|w|explicit.contains(&w.as_str())){return true;}
  }
 }
 let sentence_start=before.trim().is_empty() || before.trim_end().ends_with(['.','!','?','\n','\u{2029}']);
 sentence_start && ["was","saw","marked","brought","began","ended","is"].contains(&first)
}
fn contextual_number(value:&BigInt,tag:&str,is_year:bool)->Option<String>{
 if is_year && tag.split(['-','_']).next().is_some_and(|s|s.eq_ignore_ascii_case("en")){
  static EN:OnceLock<n2w::LangEn>=OnceLock::new();
  return EN.get_or_init(n2w::LangEn::new).to_year(value).ok();
 }
 cardinal(value,tag)
}
fn digit(c:u16)->bool{matches!(c,48..=57|0x660..=0x669|0x6f0..=0x6f9|0x966..=0x96f|0xff10..=0xff19)}
fn ascii(c:u16)->char{char::from_u32(match c{0x660..=0x669=>u32::from(c-0x660)+48,0x6f0..=0x6f9=>u32::from(c-0x6f0)+48,0x966..=0x96f=>u32::from(c-0x966)+48,0xff10..=0xff19=>u32::from(c-0xff10)+48,_=>u32::from(c)}).unwrap_or('0')}
fn identifier(c:u16)->bool{
 // These scripts do not require spaces around a number: 2026年 must be
 // converted, while ISBN978 and x12 remain identifiers.
 if matches!(c,0x3040..=0x30ff|0x3400..=0x9fff|0xac00..=0xd7af|0x0e00..=0x0e7f){return false;}
 c==95||char::from_u32(u32::from(c)).is_some_and(|c|c.is_alphanumeric())||matches!(c,0xd800..=0xdfff)
}

/// Boundary map has input.len()+1 entries: boundaries inside a rewritten token scale
/// proportionally through its spoken form; its final boundary maps past all its words.
fn expand(input:&[u16],tag:&str)->(Vec<u16>,Vec<usize>){
 let mut boundaries=vec![0;input.len()+1];let mut out=Vec::with_capacity(input.len());

 let mut at=0;
 while at<input.len(){
  boundaries[at]=out.len();
  if !digit(input[at])||(at>0&&identifier(input[at-1])){out.push(input[at]);at+=1;continue;}
  let start=at;while at<input.len()&&digit(input[at]){at+=1;}
  // Do not rewrite embedded IDs, versions, decimals or grouping piecemeal.
  // Those stay with the language's phonemizer; standalone integers (including
  // years, dates and ranges) always arrive as explicit words.
  let adjacent=at<input.len()&&identifier(input[at]) ||
   at+1<input.len()&&matches!(input[at],44|46)&&digit(input[at+1]) ||
   start>=2&&matches!(input[start-1],44|46)&&digit(input[start-2]);
  let raw:String=input[start..at].iter().map(|c|ascii(*c)).collect();
  let spoken=if adjacent||raw.len()>18{None}else if raw.len()>1&&raw.starts_with('0'){
   raw.chars().map(|c|cardinal(&BigInt::from(c.to_digit(10).unwrap_or(0)),tag)).collect::<Option<Vec<_>>>().map(|parts|parts.join(" "))
  }else{raw.parse::<BigInt>().ok().and_then(|value|contextual_number(&value,tag,year_context(input,start,at,&raw)))};
  let begin=out.len();
  let rewritten=spoken.is_some();
  if let Some(text)=spoken{out.extend(text.encode_utf16());}else{out.extend_from_slice(&input[start..at]);}
  for index in start..at{boundaries[index]=if rewritten{begin+(index-start)*(out.len()-begin)/(at-start)}else{begin+index-start};}
  boundaries[at]=out.len();
 }
 boundaries[input.len()]=out.len();(out,boundaries)
}
fn set(value:&JsValue,key:&str,item:&JsValue)->Result<(),JsValue>{Reflect::set(value,&key.into(),item)?;Ok(())}
fn units(value:&JsValue)->Vec<u16>{value.unchecked_ref::<JsString>().iter().collect()}

/// Prepare only the wire request. A plain entry retains original text/marks for
/// caching, lookahead adoption and navigation. Returned mark IDs are translated
/// back before a chunk reaches the audio player.
pub(crate) fn prepare(text:&JsValue,tag:&JsValue,marks:&JsValue)->Result<(JsValue,JsValue,JsValue),JsValue>{
 let input=units(text);
 if !input.iter().any(|c|digit(*c)){return Ok((text.clone(),marks.clone(),JsValue::UNDEFINED));}
 let (spoken,boundaries)=expand(&input,&tag.as_string().unwrap_or_default());
 if spoken==input{return Ok((text.clone(),marks.clone(),JsValue::UNDEFINED));}
 let mapped=Array::new();let pairs=Array::new();
 if Array::is_array(marks){let source=marks.unchecked_ref::<Array>();for raw in source.iter(){
  let offset=raw.as_f64().unwrap_or(f64::NAN);
  if offset.is_finite()&&offset>=0.0&&offset.fract()==0.0&&(offset as usize)<=input.len(){
   let target:JsValue=(boundaries[offset as usize] as f64).into();if !mapped.includes(&target,0){mapped.push(&target);}pairs.push(&Array::of2(&target,&raw));
  }else{mapped.push(&raw);}
 }}
 Ok((JsString::from_char_code(&spoken).into(),mapped.into(),pairs.into()))
}

pub(crate) fn restore_marks(marks:&JsValue,pairs:&JsValue)->Result<JsValue,JsValue>{
 if !Array::is_array(marks)||!Array::is_array(pairs){return Ok(marks.clone());}
 let output=Array::new();
 for mark in marks.unchecked_ref::<Array>().iter(){
  let offset=Reflect::get(&mark,&"offset".into())?;
  let mut found=false;
  for pair in pairs.unchecked_ref::<Array>().iter(){let pair=pair.unchecked_ref::<Array>();if pair.get(0)==offset{
   let copy:Object=Object::assign(&Object::new(),mark.unchecked_ref::<Object>());set(&copy,"offset",&pair.get(1))?;output.push(&copy);found=true;
  }}
  if !found{output.push(&mark);}
 }
 Ok(output.into())
}

#[wasm_bindgen]
pub fn speech_spoken_numbers(text:&[u16],language:&str)->JsValue{JsString::from_char_code(&expand(text,language).0).into()}
#[wasm_bindgen]
pub fn speech_synthesis_text(text:JsValue,language:JsValue,marks:JsValue)->Result<JsValue,JsValue>{
 let(text,marks,pairs)=prepare(&text,&language,&marks)?;
 let value:JsValue=Object::new().into();set(&value,"text",&text)?;set(&value,"marks",&marks)?;set(&value,"offsetPairs",&pairs)?;Ok(value)
}
