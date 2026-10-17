//! Title/author decisions in Rust; browser string primitives preserve UTF-16,
//! Unicode normalization, casing and regexp semantics without lossy Rust text.
use wasm_bindgen::{prelude::*,JsCast};
use js_sys::{Array,JsString,RegExp,Reflect,Set};
use crate::host::{read,absent,truthy,method};
type R<T> = Result<T,JsValue>;
#[wasm_bindgen]
extern "C" {
 #[wasm_bindgen(js_name=String,catch)]fn string(value:&JsValue)->Result<JsString,JsValue>;
 #[wasm_bindgen(extends=RegExp)]type Pattern;
 #[wasm_bindgen(method,js_name=test,catch)]fn test(this:&Pattern,value:&JsValue)->Result<bool,JsValue>;
}
struct Rules{extension:RegExp,control:RegExp,white:RegExp,empty_object:RegExp,path:RegExp,underscores:RegExp,punctuation:RegExp,comma:RegExp,truncation:RegExp,words:RegExp,spaces:RegExp,all_spaces:RegExp,alnum:RegExp,stop:RegExp,internal_caps:RegExp}
impl Rules{fn new()->Self{Self{
 extension:RegExp::new(r"\.(?:pdf|epub|mobi|azw|azw3|fb2|cbz)$","i"),
 control:RegExp::new(r"[\u0000-\u001f]","g"),white:RegExp::new(r"\s+","g"),empty_object:RegExp::new(r"^\[object\s+object\]$","i"),
 path:RegExp::new(r"[\\/\u0000-\u001f]","g"),underscores:RegExp::new(r"[_\s]+","g"),punctuation:RegExp::new(r"\s+([,.;:!?])","g"),comma:RegExp::new(r"([,;])(?=\S)","g"),
 truncation:RegExp::new(r"(?:\.{2,}|…+)\s*$",""),words:RegExp::new(r"\s+",""),spaces:RegExp::new(r"(\s+)",""),all_spaces:RegExp::new(r"^\s+$",""),alnum:RegExp::new(r"[\p{L}\p{N}]","gu"),stop:RegExp::new(r"[:.!?]$",""),internal_caps:RegExp::new(r"[a-z].*[A-Z]",""),
}}}
thread_local!{static RULES:Rules=Rules::new();}
fn text(value:JsValue)->JsString{value.unchecked_into()}
fn empty()->JsString{JsString::from("")}
fn limit(value:&JsString,n:u32)->JsString{value.slice(0,n.min(value.length()))}
fn test(re:&RegExp,value:&JsString)->R<bool>{re.unchecked_ref::<Pattern>().test(value.as_ref())}
fn optional(value:&JsValue,key:&str)->R<JsValue>{if absent(value){Ok(JsValue::UNDEFINED)}else{read(value,key)}}
fn fallback(value:&JsValue,a:&str,b:&str)->R<JsValue>{let first=read(value,a)?;if absent(&first){read(value,b)}else{Ok(first)}}
fn small(word:&JsString)->bool{matches!(word.as_string().as_deref(),Some("a"|"an"|"and"|"as"|"at"|"but"|"by"|"for"|"from"|"in"|"into"|"nor"|"of"|"on"|"onto"|"or"|"over"|"per"|"the"|"to"|"up"|"via"|"with"|"yet"|"that"|"this"|"these"|"those"|"which"|"who"|"de"|"del"|"la"|"las"|"el"|"los"|"un"|"una"|"unos"|"unas"|"y"|"e"|"o"|"u"|"en"|"por"|"para"|"con"|"sin"|"sobre"|"entre"|"al"|"lo"))}
fn acronym(word:&JsString)->bool{matches!(word.as_string().as_deref(),Some("AI"|"API"|"CBZ"|"DNA"|"EPUB"|"FBI"|"HTML"|"MOBI"|"NASA"|"PDF"|"UK"|"UN"|"USA"|"USB"|"US"))}
fn title_case(value:&JsString,r:&Rules)->R<JsString>{
 let parts=value.split_by_pattern(&r.spaces);let output=Array::new();let mut word_index=0;let mut capitalize_next=true;
 for part in parts.iter(){
  let part=text(part);if test(&r.all_spaces,&part)?{output.push(part.as_ref());continue;}
  let chars=Array::from(part.match_all(&r.alnum).as_ref());
  if chars.length()==0{output.push(part.as_ref());continue;}
  let first=read(&chars.get(0),"index")?.as_f64().unwrap_or(0.0) as u32;
  let last=chars.get(chars.length()-1);let end=read(&last,"index")?.as_f64().unwrap_or(0.0) as u32+text(Array::from(&last).get(0)).length();
  let leading=part.slice(0,first);let core=part.slice(first,end);let trailing=part.slice(end,part.length());let lower=core.to_lower_case();
  let first_char=core.char_at(0);let keep_lower=word_index>0&&!capitalize_next&&small(&lower)&&first_char==first_char.to_lower_case();
  let formatted=if acronym(&core.to_upper_case())&&core==core.to_upper_case(){core}
   else if keep_lower{lower}else if core.length()==0||test(&r.internal_caps,&core)?{core}
   else{core.char_at(0).to_upper_case().concat(core.slice(1,core.length()).to_lower_case().as_ref())};
  word_index+=1;capitalize_next=test(&r.stop,&trailing)?;
  output.push(leading.concat(formatted.as_ref()).concat(trailing.as_ref()).as_ref());
 }
 Ok(output.join(""))
}
#[wasm_bindgen]
pub fn book_normalize_title(value:JsValue,fallback:JsValue)->R<JsValue>{RULES.with(|r|{
 let source=if absent(&value){JsValue::from_str("")}else{value};let mut title=string(&source)?.trim();
 if title.length()==0{title=string(&if absent(&fallback){JsValue::from_str("")}else{fallback})?.trim();}
 if title.length()==0{return Ok("Sin título".into());}
 title=title.normalize("NFKC").replace_by_pattern(&r.extension,"").replace_by_pattern(&r.path," ")
  .replace_by_pattern(&r.underscores," ").replace_by_pattern(&r.punctuation,"$1").replace_by_pattern(&r.comma,"$1 ").trim();
 let mut truncated=false;
 if let Some(found)=title.match_(&r.truncation){
  truncated=true;let index=read(found.as_ref(),"index")?.as_f64().unwrap_or(0.0) as u32;
  title=title.slice(0,index).trim();let words=title.split_by_pattern(&r.words);
  let last=text(words.get(words.length().saturating_sub(1)));
  if last.length()<=3&&words.length()>1{words.pop();}
  while words.length()>1&&small(&text(words.get(words.length()-1)).to_lower_case()){words.pop();}
  title=words.join(" ");
 }
 title=title.replace_by_pattern(&r.white," ").trim();if title.length()==0{return Ok("Sin título".into());}
 if title.length()>88{let colon=title.index_of(":",0);if (12..=62).contains(&colon){title=title.slice(0,colon as u32).trim();}}
 title=title_case(&title,r)?;
 if title.length()>88{
  let cutoff=title.last_index_of(" ",85);let cutoff=if cutoff>0{cutoff as u32}else{85};
  title=title.slice(0,cutoff).trim_end().concat(&"…".into());
 }else if truncated{title=title.concat(&"…".into());}
 Ok(title.into())
})}
// Iterative author traversal avoids overflowing the small WASM stack on deep
// metadata. An active-path cycle remains the original unsupported RangeError.
enum Phase{Array,Keys,First,Last}
struct Frame{value:JsValue,phase:Phase,index:u32,length:u32,names:Array,first:JsString}
fn array_child(frame:&mut Frame)->R<Option<JsValue>>{
 while frame.index<frame.length{let key=JsValue::from_f64(frame.index as f64);frame.index+=1;
  if Reflect::has(&frame.value,&key)?{return Ok(Some(Reflect::get(&frame.value,&key)?));}
 }Ok(None)
}
fn joined_names(names:Array)->JsString{let set=Set::new(&names.into());limit(&Array::from(set.as_ref()).join(", "),120)}
fn author(value:JsValue,r:&Rules)->R<JsString>{
 const KEYS:[&str;6]=["name","displayName","value","text","creator","author"];
 let mut stack:Vec<Frame>=Vec::new();let mut pending=Some(value);let mut result=empty();
 loop{
  if let Some(value)=pending.take(){
   if value.is_string()||value.as_f64().is_some(){
    let name=string(&value)?.normalize("NFKC").replace_by_pattern(&r.control," ").replace_by_pattern(&r.white," ").trim();
    result=if test(&r.empty_object,&name)?{empty()}else{limit(&name,120)};
   }else if !truthy(&value)||!value.is_object(){result=empty();}
   else{
    if stack.iter().any(|frame|frame.value==value){return Err(js_sys::RangeError::new("Maximum call stack size exceeded").into());}
    if Array::is_array(&value){
     let mut frame=Frame{length:read(&value,"length")?.as_f64().unwrap_or(0.0) as u32,value,phase:Phase::Array,index:0,names:Array::new(),first:empty()};
     if let Some(child)=array_child(&mut frame)?{stack.push(frame);pending=Some(child);continue;}result=empty();
    }else{
     let child=read(&value,KEYS[0])?;stack.push(Frame{value,phase:Phase::Keys,index:1,length:0,names:Array::new(),first:empty()});pending=Some(child);continue;
    }
   }
  }
  let Some(frame)=stack.last_mut()else{return Ok(result);};
  match frame.phase{
   Phase::Array=>{
    if result.length()>0{frame.names.push(result.as_ref());}
    if let Some(child)=array_child(frame)?{pending=Some(child);continue;}
    let frame=stack.pop().unwrap();result=joined_names(frame.names);
   },
   Phase::Keys=>{
    if result.length()>0{stack.pop();continue;}
    if frame.index<KEYS.len() as u32{let key=KEYS[frame.index as usize];frame.index+=1;pending=Some(read(&frame.value,key)?);}
    else{frame.phase=Phase::First;pending=Some(fallback(&frame.value,"givenName","firstName")?);}
   },
   Phase::First=>{frame.first=result.clone();frame.phase=Phase::Last;pending=Some(fallback(&frame.value,"familyName","lastName")?);},
   Phase::Last=>{
    let values=Array::new();if frame.first.length()>0{values.push(frame.first.as_ref());}if result.length()>0{values.push(result.as_ref());}
    result=limit(&values.join(" "),120);stack.pop();
   }
  }
 }
}
#[wasm_bindgen]
pub fn book_normalize_author(value:JsValue)->R<JsValue>{RULES.with(|r|author(value,r).map(Into::into))}
#[wasm_bindgen]
pub fn book_display_title(book:JsValue)->R<JsValue>{RULES.with(|r|{
 let written=if optional(&book,"spineTitleOverride")?.is_string(){
  // The second getter may return a different type. Keep dynamic method
  // receivers and catch their exceptions so every borrowed handle drops.
  let value=read(&book,"spineTitleOverride")?;
  method(&method(&value,"replace",&[r.white.as_ref(),&" ".into()])?,"trim",&[])?
 }else{empty().into()};
 if truthy(&written){return Ok(written);}
 let title=optional(&book,"title")?;Ok(string(&if absent(&title){JsValue::from_str("")}else{title})?.into())
})}
