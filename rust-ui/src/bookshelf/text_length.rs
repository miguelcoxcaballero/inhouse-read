//! Complete text volume. JS owns the short-lived counter data graph; Rust owns token boundaries,
//! bounded slicing, cancellation and the detached section traversal. Intl and DOM remain host APIs.
use wasm_bindgen::{prelude::*,JsCast};
use js_sys::{Array,Function,Reflect,Uint32Array};
use super::util::*;

use crate::length_metadata::{safe_integer,valid_count,length_complete_count};
const TOKEN:&str=r"[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]|[\p{L}\p{N}][\p{L}\p{N}\p{M}'’\-]*";
const SCRIPTS:[&str;8]=["Han","Hiragana","Katakana","Thai","Lao","Khmer","Myanmar","Hangul"];
const BLOCKS:[&str;35]=["address","article","aside","blockquote","dd","div","dl","dt","figcaption","figure","footer","form","h1","h2","h3","h4","h5","h6","header","hr","li","main","nav","ol","p","pre","section","table","tbody","td","tfoot","th","thead","tr","ul"];
fn optional(value:&JsValue,key:&str)->R<JsValue>{if nullish(value){Ok(undef())}else{read(value,key)}}
fn regex(pattern:&str,flags:&str)->R<JsValue>{construct("RegExp",&[&s(pattern),&s(flags)])}
fn length(value:&JsValue)->usize{gn(value,"length") as usize}
fn slice(value:&JsValue,from:usize,to:Option<usize>)->R<JsValue>{match to{Some(to)=>method(value,"slice",&[&f(from as f64),&f(to as f64)]),None=>method(value,"slice",&[&f(from as f64)])}}
fn default_option(options:&JsValue,name:&str,fallback:JsValue)->R<JsValue>{let value=read(options,name)?;Ok(if value.is_undefined(){fallback}else{value})}
fn active(state:&JsValue)->R<bool>{let callback=get(state,"isActive");if callback.is_undefined(){Ok(true)}else{Ok(truthy(&call(&callback,"isActive",&[])?))}}
async fn yield_task(state:&JsValue)->R{settle(call(&get(state,"yieldTask"),"yieldTask",&[])?).await?;Ok(())}
fn segmenter(language:&JsValue)->JsValue{
 let attempt=||->R<JsValue>{
  let intl=read(&global(),"Intl")?;let constructor=read(&intl,"Segmenter")?.dyn_into::<Function>().map_err(|_|js_sys::TypeError::new("Intl.Segmenter is not a constructor"))?;
  let args=Array::new();args.push(&if truthy(language){language.clone()}else{undef()});args.push(&obj(&[("granularity",&s("word"))]));Reflect::construct(&constructor,&args)
 };attempt().unwrap_or(undef())
}
fn counter(language:&JsValue,options:&JsValue,env:&JsValue)->R<JsValue>{
 let is_active=read(options,"isActive")?;let yield_task=default_option(options,"yieldTask",read(env,"pause")?)?;
 let max=default_option(options,"maxCharacters",f(16_000_000.0))?;
 let segmenter=segmenter(language);let patterns=Array::new();
 for script in SCRIPTS{patterns.push(&regex(&format!(r"\p{{Script={script}}}"),"u")?);}
 Ok(obj(&[("isActive",&is_active),("yieldTask",&yield_task),("maxCharacters",&max),("segmenter",&segmenter),
  ("patterns",&patterns.into()),("token",&regex(TOKEN,"gu")?),("space",&regex(r"\s\S*(?![\s\S])","u")?),("packSegments",&read(env,"packSegments")?),
  ("count",&f(0.0)),("characters",&f(0.0)),("buffer",&s("")),("cancelled",&JsValue::FALSE),("continuingToken",&null())]))
}
#[wasm_bindgen]
pub fn length_create_counter(language:JsValue,options:JsValue,env:JsValue)->Result<JsValue,JsValue>{counter(&language,&options,&env)}
fn add_words(state:&JsValue,words:f64){putf(state,"count",gn(state,"count")+words);}
// One typed response from Intl/RegExp, never one WASM/JS round trip per token.
// UTF-16 indices and lengths remain browser values; Rust owns every boundary/count decision.
fn packed_parts(state:&JsValue,parts:JsValue,segmented:bool,coordinates:bool,capacity:usize)->R<Vec<u32>>{
 let packed=call(&read(state,"packSegments")?,"packSegments",&[&parts,&b(segmented),&b(coordinates),&f(capacity as f64)])?;
 Ok(packed.dyn_into::<Uint32Array>().map_err(|_|js_sys::TypeError::new("Expected packed browser segments"))?.to_vec())
}
fn count_slice(state:&JsValue,text:&JsValue)->R{
 let segmenter=get(state,"segmenter");
 let words=if truthy(&segmenter){
  packed_parts(state,method(&segmenter,"segment",&[text])?,true,false,length(text))?.iter().filter(|flag|**flag!=0).count() as f64
 }else{let words=method(text,"match",&[&get(state,"token")])?;if nullish(&words){0.0}else{length(&words) as f64}};
 add_words(state,words);Ok(())
}
fn continuation_for(state:&JsValue,text:&JsValue)->R<JsValue>{
 let first=if length(text)==0{s("")}else{let point=num(&method(text,"codePointAt",&[&f(0.0)])?);slice(text,0,Some(if point>65535.0{2}else{1}))?};
 for (index,pattern) in array_of(&get(state,"patterns")).iter().enumerate(){
  if truthy(&method(pattern,"test",&[&first])?){return regex(&format!(r"^[\p{{Script={}}}\p{{M}}]+",SCRIPTS[index]),"u");}
 }
 let dictionary=SCRIPTS.map(|script|format!(r"\p{{Script={script}}}")).join("");regex(&format!(r"^(?:(?![{dictionary}])[\p{{L}}\p{{N}}\p{{M}}_'’])+"),"u")
}
fn consumed(text:&JsValue,pattern:&JsValue)->R<usize>{let matches=method(text,"match",&[pattern])?;Ok(length(&get_at(&matches,0)))}
fn flush_bounded(state:&JsValue)->R{
 let buffer=get(state,"buffer");let prefix=slice(&buffer,0,Some(16384))?;let size=length(&prefix);
 // Typical words need only a short tail; dictionary paragraphs fall back to
 // the complete bounded window. Match absolute end, including a final CRLF.
 let start=size.saturating_sub(64);let tail=slice(&prefix,start,None)?;
 let space=method(&tail,"match",&[&get(state,"space")])?;
 let boundary=if !nullish(&space){start+gn(&space,"index") as usize+1}else{
  let space=method(&prefix,"match",&[&get(state,"space")])?;
  if nullish(&space){0}else{gn(&space,"index") as usize+1}
 };
 if boundary>0{count_slice(state,&slice(&buffer,0,Some(boundary))?)?;put(state,"buffer",&slice(&get(state,"buffer"),boundary,None)?);return Ok(());}
 let segmenter=get(state,"segmenter");let parts=if truthy(&segmenter){method(&segmenter,"segment",&[&prefix])?}else{method(&prefix,"matchAll",&[&get(state,"token")])?};
 let mut to=0;let mut words=0.0;let mut final_part=None;
 for part in packed_parts(state,parts,truthy(&segmenter),true,size)?.chunks_exact(3){
  let index=part[0] as usize;let length=part[1] as usize;let word=part[2]!=0;
  let end=index+length;final_part=Some((index,length,word));
  if end>size.saturating_sub(512){break;}to=end;if word{words+=1.0;}
 }
 if to>0{add_words(state,words);put(state,"buffer",&slice(&get(state,"buffer"),to,None)?);return Ok(());}
 if final_part.is_none()||final_part==Some((0,size,false)){put(state,"buffer",&slice(&get(state,"buffer"),size,None)?);return Ok(());}
 if length(&get(state,"buffer"))>=32768&&final_part==Some((0,size,true)){
  add_words(state,1.0);let pattern=continuation_for(state,&prefix)?;put(state,"continuingToken",&pattern);
  let rest=slice(&get(state,"buffer"),size,None)?;put(state,"buffer",&rest);let n=consumed(&rest,&pattern)?;
  let rest=slice(&get(state,"buffer"),n,None)?;put(state,"buffer",&rest);if length(&rest)>0{put(state,"continuingToken",&null());}
 }Ok(())
}
async fn add_inner(state:JsValue,text:JsValue)->R<JsValue>{
 let text=string_value(&or(text,s("")));let size=length(&text);putf(&state,"characters",gn(&state,"characters")+size as f64);
 if !active(&state)?||gn(&state,"characters")>num(&get(&state,"maxCharacters"))||gb(&state,"cancelled"){putb(&state,"cancelled",true);return Ok(JsValue::FALSE);}
 for from in (0..size).step_by(16384){
  let mut chunk=slice(&text,from,Some(from+16384))?;let pattern=get(&state,"continuingToken");
  if truthy(&pattern){let n=consumed(&chunk,&pattern)?;chunk=slice(&chunk,n,None)?;if length(&chunk)>0{put(&state,"continuingToken",&null());}}
  put(&state,"buffer",&join_strings(&[get(&state,"buffer"),chunk]));
  if length(&get(&state,"buffer"))>=16384{
   flush_bounded(&state)?;yield_task(&state).await?;if !active(&state)?{putb(&state,"cancelled",true);return Ok(JsValue::FALSE);}
  }else if truthy(&get(&state,"continuingToken")){
   yield_task(&state).await?;if !active(&state)?{putb(&state,"cancelled",true);return Ok(JsValue::FALSE);}
  }
 }Ok(JsValue::TRUE)
}
#[wasm_bindgen]
pub fn length_counter_add(state:JsValue,text:JsValue)->JsValue{run(add_inner(state,text))}
#[wasm_bindgen]
pub fn length_counter_finish(state:JsValue)->Result<JsValue,JsValue>{
 if gb(&state,"cancelled")||!active(&state)?{return Ok(null());}count_slice(&state,&get(&state,"buffer"))?;put(&state,"buffer",&s(""));Ok(get(&state,"count"))
}
#[wasm_bindgen]
pub fn length_count_text(text:JsValue,options:JsValue,env:JsValue)->JsValue{run(async move{
 let language=read(&options,"language")?;let state=counter(&language,&options,&env)?;
 if truthy(&settle(length_counter_add(state.clone(),text)).await?){length_counter_finish(state)}else{Ok(null())}
})}

fn local_name(node:&JsValue)->R<JsValue>{let name=read(node,"localName")?;if nullish(&name){Ok(undef())}else{method(&name,"toLowerCase",&[])}}
fn block_name(name:&JsValue)->bool{BLOCKS.iter().any(|block|*name==s(block))}
#[wasm_bindgen]
pub fn length_accept_node(node:JsValue)->Result<f64,JsValue>{
 if get(&node,"nodeType")!=f(1.0){return Ok(1.0);}
 let name=local_name(&node)?;let excluded=["script","style","head","template"].iter().any(|tag|name==s(tag));
 Ok(if excluded||truthy(&method(&node,"hasAttribute",&[&s("hidden")])?)||method(&node,"getAttribute",&[&s("aria-hidden")])?==s("true"){2.0}else{1.0})
}
fn block_for(node:&JsValue,root:&JsValue)->R<JsValue>{
 let mut element=read(node,"parentElement")?;
 while truthy(&element)&&element!=*root{
  if block_name(&local_name(&element)?){return Ok(element);}element=read(&element,"parentElement")?;
 }Ok(root.clone())
}
fn image_section(section:&JsValue)->R<bool>{
 if !get(section,"createDocument").is_undefined(){return Ok(false);}
 let id=read(section,"id")?;if !id.is_string()||truthy(&method(&id,"includes",&[&s("\0")])?){return Ok(false);}
 if !truthy(&method(&regex(r"\.(?:jpe?g|png|gif|bmp|webp|svg|jxl|avif)$","i")?,"test",&[&id])?){return Ok(false);}
 if !read(section,"load")?.is_function()||!read(section,"unload")?.is_function(){return Ok(false);}
 let size=read(section,"size")?;Ok(valid_count(&size)&&num(&size)>0.0)
}
async fn add_count(state:&JsValue,text:JsValue)->R<bool>{Ok(truthy(&settle(length_counter_add(state.clone(),text)).await?))}
enum Scan{Complete,Images,Cancelled}
async fn scan_book(book:&JsValue,sections:&JsValue,state:&JsValue,env:&JsValue)->R<Scan>{
 if get(&get(book,"rendition"),"layout")==s("pre-paginated"){
  let mut image_only=true;
  for index in 0..length(sections){
   if !active(state)?{return Ok(Scan::Cancelled);}
   if !image_section(&get_at(sections,index as u32))?{image_only=false;break;}
   if (index+1)%128==0||index==length(sections)-1{yield_task(state).await?;if !active(state)?{return Ok(Scan::Cancelled);}}
  }
  if image_only{return Ok(Scan::Images);}
 }
 for section in js_sys::try_iter(sections)?.ok_or_else(||js_sys::TypeError::new("Sections are not iterable"))?{
  let section=section?;
  if !active(state)?||!read(&section,"createDocument")?.is_function(){return Ok(Scan::Cancelled);}
  let doc=settle(method(&section,"createDocument",&[])?).await?;
  if !active(state)?||!truthy(&get(&doc,"documentElement")){return Ok(Scan::Cancelled);}
  let mut root=read(&doc,"body")?;if !truthy(&root){root=method(&doc,"querySelector",&[&s("body")])?;}if !truthy(&root){root=read(&doc,"documentElement")?;}
  let filter=obj(&[("acceptNode",&read(env,"acceptNode")?)]);
  let walker=method(&doc,"createTreeWalker",&[&root,&f(5.0),&filter])?;
  let mut nodes=0;let mut last=root.clone();
  loop{
   let node=method(&walker,"nextNode",&[])?;if !truthy(&node){break;}
   nodes+=1;if nodes%128==0{yield_task(state).await?;if !active(state)?{return Ok(Scan::Cancelled);}}
   if read(&node,"nodeType")?==f(1.0){
    let name=local_name(&node)?;if (name==s("br")||block_name(&name))&&!add_count(state,s(" ")).await?{return Ok(Scan::Cancelled);}continue;
   }
   let block=block_for(&node,&root)?;
   if block!=last&&!add_count(state,s(" ")).await?{return Ok(Scan::Cancelled);}last=block;
   if !add_count(state,or(read(&node,"textContent")?,s(""))).await?{return Ok(Scan::Cancelled);}
  }
  if !add_count(state,s(" ")).await?{return Ok(Scan::Cancelled);}
  yield_task(state).await?;if !active(state)?{return Ok(Scan::Cancelled);}
 }Ok(Scan::Complete)
}
#[wasm_bindgen]
pub fn length_measure_book(book:JsValue,options:JsValue,env:JsValue)->JsValue{run(async move{
 // Destructuring options happens before the initial book guard in the original async function.
 let is_active=read(&options,"isActive")?;let task=default_option(&options,"yieldTask",read(&env,"pause")?)?;
 let max_chars=default_option(&options,"maxCharacters",f(16_000_000.0))?;let max_sections=default_option(&options,"maxSections",f(2048.0))?;
 let config=obj(&[("isActive",&is_active),("yieldTask",&task),("maxCharacters",&max_chars)]);
 let sections=get(&book,"sections");
 if !truthy(&get(&sections,"length"))||gn(&sections,"length")>num(&max_sections)||!active(&config)?{return Ok(null());}
 let metadata=get(&book,"metadata");let mut language=get(&metadata,"language");
 if Array::is_array(&language){language=get_at(&get(&metadata,"language"),0);}else{language=get(&metadata,"language");}
 let state=counter(&language,&config,&env)?;
 match scan_book(&book,&sections,&state,&env).await{
  Ok(Scan::Complete)=>Ok(length_complete_count(length_counter_finish(state)?)),
  Ok(Scan::Images)=>Ok(length_complete_count(f(0.0))),
  Ok(Scan::Cancelled)|Err(_)=>Ok(null())
 }
})}

async fn scan_pdf(pdf:&JsValue,state:&JsValue,env:&JsValue)->R<bool>{
 let mut page_number=1.0;
 while page_number<=num(&read(pdf,"numPages")?){
  if !active(state)?{return Ok(false);}
  let page=settle(method(pdf,"getPage",&[&f(page_number)])?).await?;
  if !active(state)?{return Ok(false);}
  let content=settle(method(&page,"getTextContent",&[])?) .await?;
  if !active(state)?{return Ok(false);}
  let viewport=method(&page,"getViewport",&[&obj(&[("scale",&f(1.0))])])?;
  let text=read(&call(&read(env,"extractPDFText")?,"extractPDFText",&[&content,&viewport])?,"text")?;
  if !add_count(state,text).await?||!add_count(state,s(" ")).await?{return Ok(false);}
  yield_task(state).await?;if !active(state)?{return Ok(false);}
  page_number+=1.0;
 }
 Ok(true)
}
#[wasm_bindgen]
pub fn length_measure_pdf(pdf:JsValue,options:JsValue,env:JsValue)->JsValue{run(async move{
 let is_active=read(&options,"isActive")?;
 let yield_task=default_option(&options,"yieldTask",read(&env,"pause")?)?;
 let max_characters=default_option(&options,"maxCharacters",f(16_000_000.0))?;
 let max_pages=default_option(&options,"maxPages",f(10_000.0))?;
 let language=read(&options,"language")?;
 if !safe_integer(&optional(&pdf,"numPages")?)||num(&read(&pdf,"numPages")?)<1.0||num(&read(&pdf,"numPages")?)>num(&max_pages)
  ||!is_active.is_undefined()&&!truthy(&call(&is_active,"isActive",&[])?){return Ok(null());}
 let counter_options=obj(&[("isActive",&is_active),("yieldTask",&yield_task),("maxCharacters",&max_characters)]);
 let state=counter(&language,&counter_options,&env)?;
 match scan_pdf(&pdf,&state,&env).await{Ok(true)=>Ok(length_complete_count(length_counter_finish(state)?)),_=>Ok(null())}
})}

/// Detached parser selection and cleanup. The host imports the actual engines
/// only when requested; Rust owns cancellation and always destroys each parser.
#[wasm_bindgen]
pub fn length_measure_file(file:JsValue,options:JsValue,env:JsValue)->JsValue{run(async move{
 let callback=or(read(&options,"isActive")?,undef());
 let config=obj(&[("isActive",&callback)]);
 if !truthy(&optional(&file,"size")?)||!active(&config)?{return Ok(null());}
 let format=settle(call(&read(&env,"detectFormat")?,"detectFormat",&[&file])?).await?;
 if !active(&config)?{return Ok(null());}
 let engine=read(&format,"engine")?;let engines=read(&env,"ENGINE")?;
 if engine==read(&engines,"PDF")?{
  let pdfjs=settle(call(&read(&env,"loadPDF")?,"loadPDF",&[])?).await?;
  let worker=settle(call(&read(&env,"loadWorker")?,"loadWorker",&[])?).await?;
  crate::host::set(&read(&pdfjs,"GlobalWorkerOptions")?,"workerSrc",&read(&worker,"default")?)?;
  if !active(&config)?{return Ok(null());}
  let bytes=settle(method(&file,"arrayBuffer",&[])?).await?;
  let data=construct("Uint8Array",&[&bytes])?;
  if !active(&config)?{return Ok(null());}
  let task=method(&pdfjs,"getDocument",&[&obj(&[("data",&data)])])?;
  let result=async{
   let pdf=settle(read(&task,"promise")?).await?;
   settle(length_measure_pdf(pdf,options,env)).await
  }.await;
  settle(method(&task,"destroy",&[])?).await?;return result;
 }
 if engine==read(&engines,"FOLIATE")?{
  let foliate=settle(call(&read(&env,"loadFoliate")?,"loadFoliate",&[])?).await?;
  if !active(&config)?{return Ok(null());}
  let book=settle(call(&read(&foliate,"makeBook")?,"makeBook",&[&file])?).await?;
  let result=settle(length_measure_book(book.clone(),options,env)).await;
  let _=method_opt(&book,"destroy",&[])?;return result;
 }
 Ok(null())
})}
