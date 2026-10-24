//! Reader experience coordination after requireRustUI has completed. Browser
//! callbacks retain their original identities; book/session decisions live here.
use wasm_bindgen::prelude::*;
use wasm_bindgen_futures::{future_to_promise, JsFuture};
use js_sys::{Array, Object, Promise, Reflect, Symbol};
use crate::host::*;
use crate::cloud_host::{copy_data_entries, data_entry};
type R<T> = Result<T, JsValue>;
fn optional(value:&JsValue, key:&str)->R<JsValue>{if absent(value){Ok(JsValue::UNDEFINED)}else{read(value,key)}}
fn object(fields:&[(&str,JsValue)])->R<JsValue>{let out=Object::new();for(key,value)in fields{set(out.as_ref(),key,value)?;}Ok(out.into())}
fn merge(a:&JsValue,b:&JsValue,fields:&[(&str,JsValue)])->R<JsValue>{let entries=Array::new();copy_data_entries(&entries,a)?;copy_data_entries(&entries,b)?;for(key,value)in fields{data_entry(&entries,&(*key).into(),value);}Ok(Object::from_entries(entries.as_ref())?.into())}
fn primitive(value:&JsValue)->R<JsValue>{
 if !value.is_object()&&!value.is_function(){return Ok(value.clone());}
 let exotic=Reflect::get(value,Symbol::to_primitive().as_ref())?;
 if !absent(&exotic){let result=method(&exotic,"call",&[value,&"number".into()])?;if !result.is_object()&&!result.is_function(){return Ok(result);}return Err(js_sys::TypeError::new("Cannot convert object to primitive value").into());}
 for key in ["valueOf","toString"]{let function=read(value,key)?;if function.is_function(){let result=method(&function,"call",&[value])?;if !result.is_object()&&!result.is_function(){return Ok(result);}}}
 Err(js_sys::TypeError::new("Cannot convert object to primitive value").into())
}
fn numeric(value:&JsValue)->R<f64>{
 if let Some(number)=value.as_f64(){return Ok(number);}
 let value=primitive(value)?;if value.is_bigint(){return Err(js_sys::TypeError::new("Cannot mix BigInt and other types").into());}
 Ok(method(&global(),"Number",&[&value])?.as_f64().unwrap_or(f64::NAN))
}
fn greater(value:&JsValue,boundary:f64,inclusive:bool)->R<bool>{
 let value=primitive(value)?;
 if value.is_symbol(){return Err(js_sys::TypeError::new("Cannot convert a Symbol value to a number").into());}
 Ok(if inclusive{value.ge(&boundary.into())}else{value.gt(&boundary.into())})
}
fn concat(prefix:&str,values:&[&JsValue])->R<JsValue>{method(&prefix.into(),"concat",values)}
fn resolved(value:&JsValue)->R<JsValue>{method(&read(&global(),"Promise")?,"resolve",&[value])}
fn promise(value:JsValue)->R<Promise>{Ok(resolved(&value)?.unchecked_into())}
fn preferences(normalize:&JsValue)->R<JsValue>{
 let saved=(||{let raw=method(&read(&global(),"localStorage")?,"getItem",&[&"inhouse-read-reading-preferences".into()])?;
  let raw=if truthy(&raw){raw}else{"{}".into()};let value=method(&read(&global(),"JSON")?,"parse",&[&raw])?;call(normalize,"normalizeReadingPreferences",&[&value])})();
 saved.or_else(|_|call(normalize,"normalizeReadingPreferences",&[]))
}
#[wasm_bindgen]
pub fn reader_experience_init(host:&JsValue,normalize:&JsValue)->R<()>{
 for name in ["history","bookmarks","quotes"]{set(host,name,Array::new().as_ref())?;}
 set(host,"location",&object(&[("fraction",0.into()),("locator",JsValue::NULL)])?)?;
 set(host,"preferences",&preferences(normalize)?)
}
#[wasm_bindgen]
pub fn reader_experience_selection_init(host:&JsValue)->R<()>{set(host,"selectedQuoteSelection",&JsValue::NULL)?;set(host,"quoteColor",&"yellow".into())}
#[wasm_bindgen]
pub fn reader_experience_remember_selection(host:&JsValue,selection:&JsValue)->R<()>{
 if truthy(&optional(selection,"text")?){set(host,"selectedQuoteSelection",selection)?;}Ok(())
}
#[wasm_bindgen]
pub fn reader_experience_selection_changed(host:&JsValue)->R<()>{
 let screen=read(host,"screen")?;let doc=read(&global(),"document")?;
 if !truthy(&method(&screen,"contains",&[&read(&doc,"activeElement")?])?){
  let selection=method(&read(&global(),"window")?,"getSelection",&[])?;
  let parent=optional(&optional(&selection,"anchorNode")?,"parentElement")?;
  if !truthy(&method(&screen,"contains",&[&parent])?){return Ok(());}
 }
 let reader=read(host,"reader")?;let selected=method(&reader,"getSelection",&[])?;
 let selected=if selected.is_string(){object(&[("text",selected),("locator",read(&read(&reader,"location")?,"locator")?)])?}else{selected};
 reader_experience_remember_selection(host,&selected)
}
#[wasm_bindgen]
pub fn reader_experience_reset_appearance(host:&JsValue,normalize:&JsValue)->R<()>{
 let mut fields=Vec::new();for name in ["rate","voice","voiceLang"]{fields.push((name,read(&read(host,"preferences")?,name)?));}
 let value=call(normalize,"normalizeReadingPreferences",&[&object(&fields)?])?;set(host,"preferences",&value)?;method(host,"applyPreferences",&[])?;Ok(())
}
#[wasm_bindgen]
pub fn reader_experience_open(host:&JsValue,record:&JsValue,kit:&JsValue)->R<JsValue>{
 set(host,"lengthMetadata",record)?;let pending=method(&read(host,"lifecycle")?,"open",&[record])?;
 let epoch=read(&read(host,"reader")?,"epoch")?;
 if !truthy(&read(record,"wordCountComplete")?)&&truthy(&read(&read(host,"reader")?,"getLengthMetadata")?){
  let count=method(&read(host,"reader")?,"getLengthMetadata",&[])?;method(kit,"metadata",&[host,&count,record,&epoch])?;
 }
 Ok(pending)
}
#[wasm_bindgen]
pub fn reader_experience_metadata(host:&JsValue,record:&JsValue,epoch:&JsValue,metadata:&JsValue)->R<JsValue>{
 if read(host,"book")?!=*record||read(&read(host,"reader")?,"epoch")?!=*epoch||!truthy(metadata){return Ok(JsValue::UNDEFINED);}
 set(host,"lengthMetadata",&merge(record,metadata,&[])?)?;method(host,"relocate",&[])?;
 method(host,"onLengthMetadata",&[record,metadata])
}
#[wasm_bindgen]
pub fn reader_experience_relocate(host:&JsValue,clone:&JsValue)->R<()>{
 let reader=read(host,"reader")?;let cloned=call(clone,"clonePlace",&[&read(&reader,"location")?])?;
 let section=read(&read(&read(host,"reader")?,"location")?,"section")?;let section=if truthy(&section){section}else{"".into()};
 let page=read(&read(&read(host,"reader")?,"location")?,"page")?;let page=if truthy(&page){page}else{"".into()};
 let location=merge(&cloned,&JsValue::UNDEFINED,&[("section",section),("page",page)])?;set(host,"location",&location)?;
 let label=method(host,"label",&[&location])?;let compact=read(&method(host,"readingMetrics",&[])?,"compact")?;
 let location=read(host,"location")?;let fraction=numeric(&read(&location,"fraction")?)?*100.0;
 let locator=read(&location,"locator")?;let pdf=optional(&locator,"kind")?==JsValue::from_str("pdf-page");
 method(&read(host,"view")?,"relocate",&[&label,&compact,&fraction.into(),&pdf.into(),&optional(&locator,"value")?])?;
 method(host,"updateBookmarkButton",&[])?;method(host,"updateReadingMetrics",&[])?;Ok(())
}
#[wasm_bindgen]
pub fn reader_experience_metrics(host:&JsValue)->R<JsValue>{
 let s=read(&read(host,"reader")?,"s")?;let location=read(&read(host,"reader")?,"location")?;
 let entries=Array::new();copy_data_entries(&entries,&read(host,"lengthMetadata")?)?;
 data_entry(&entries,&"pageCount".into(),&read(&read(host,"reader")?,"pageCount")?);
 let metadata=Object::from_entries(entries.as_ref())?;let rate=numeric(&read(&read(host,"preferences")?,"rate")?)?;
 let state=optional(&read(host,"voice")?,"state")?;let active=["playing","paused","loading"].iter().any(|value|state==JsValue::from_str(value));
 crate::reader_metrics::reader_reading_metrics(&s,&location,metadata.as_ref(),rate,active)
}
#[wasm_bindgen]
pub fn reader_experience_update_metrics(host:&JsValue)->R<()>{let metrics=method(host,"readingMetrics",&[])?;method(&read(host,"view")?,"updateReadingMetrics",&[&read(&metrics,"time")?,&read(&metrics,"pagesDescription")?])?;Ok(())}
#[wasm_bindgen]
pub fn reader_experience_label(host:&JsValue,place:&JsValue)->R<JsValue>{
 let locator=read(place,"locator")?;
 if optional(&locator,"kind")?==JsValue::from_str("pdf-page"){
  let page=concat("Página ",&[&read(&read(place,"locator")?,"value")?])?;let count=read(&read(host,"reader")?,"pageCount")?;
  let tail=if truthy(&count){concat(" de ",&[&read(&read(host,"reader")?,"pageCount")?])?}else{"".into()};
  return method(&page,"concat",&[&tail]);
 }
 if truthy(&read(place,"section")?){
  let section=concat("",&[&read(place,"section")?])?;let page=read(place,"page")?;
  let tail=if truthy(&page){concat(" · Página ",&[&read(place,"page")?])?}else{"".into()};
  return concat("",&[&section,&tail]);
 }
 concat("",&[&js_round(numeric(&read(place,"fraction")?)?*100.0).into(),&" % del libro".into()])
}
#[wasm_bindgen]
pub fn reader_experience_show_tab(host:&JsValue,name:&JsValue)->R<()>{if *name!=JsValue::from_str("search"){method(host,"endSearch",&[])?;}method(&read(host,"view")?,"showTab",&[name])?;Ok(())}
#[wasm_bindgen]
pub fn reader_experience_place_tab(host:&JsValue,name:&JsValue)->R<()>{set(host,"placeTab",name)?;method(&read(host,"view")?,"showPlaceTab",&[name])?;Ok(())}
#[wasm_bindgen]
pub fn reader_experience_mini_player(host:&JsValue,state:&JsValue,message:&JsValue,kit:&JsValue)->R<()>{
 let shown=if truthy(state){state.clone()}else{"".into()};let title=method(kit,"title",&[&read(host,"book")?])?;
 let rate=method(kit,"rate",&[&read(&read(host,"preferences")?,"rate")?])?;let has_book=truthy(&read(host,"book")?);
 let icon=method(kit,"icon",&[&if *state==JsValue::from_str("playing"){JsValue::from_str("pause")}else{"play".into()}])?;
 method(&read(host,"view")?,"updateMiniPlayer",&[&shown,message,&title,&rate,&has_book.into(),&icon])?;method(host,"updateReadingMetrics",&[])?;Ok(())
}
#[wasm_bindgen]
pub fn reader_experience_bookmark(host:&JsValue,marked:&JsValue)->R<()>{
 let marked=call(marked,"isBookmarked",&[&read(host,"bookmarks")?,&read(host,"location")?])?;
 method(&read(host,"view")?,"updateBookmarkButton",&[&marked])?;Ok(())
}
#[wasm_bindgen]
pub fn reader_experience_current(host:&JsValue,book:&JsValue,generation:&JsValue)->R<bool>{Ok(read(host,"book")?==*book&&read(&read(host,"navigation")?,"generation")?==*generation)}
#[wasm_bindgen]
pub fn reader_experience_queue(host:&JsValue,action:&JsValue,kit:&JsValue)->R<JsValue>{
 if !truthy(&read(host,"book")?){return resolved(&JsValue::UNDEFINED);}
 let book=read(host,"book")?;let generation=read(&read(host,"navigation")?,"generation")?;
 let check=method(kit,"current",&[host,&book,&generation])?;method(&read(host,"navigation")?,"enqueue",&[action,&check])
}
#[wasm_bindgen]
pub fn reader_experience_return(host:&JsValue,index:&JsValue,kit:&JsValue)->R<JsValue>{
 let place=Reflect::get(&read(host,"history")?,index)?;if !truthy(&place){return resolved(&JsValue::UNDEFINED);}
 let action=method(kit,"returnAction",&[host,&place])?;method(host,"queueNavigation",&[&action])
}
#[wasm_bindgen]
pub fn reader_experience_page_step(host:&JsValue,direction:&JsValue)->R<JsValue>{let next=greater(direction,0.0,false)?;method(&read(host,"reader")?,if next{"next"}else{"prev"},&[])}
#[wasm_bindgen]
pub fn reader_experience_size(bytes:&JsValue)->R<JsValue>{
 if greater(bytes,1048576.0,true)?{let size=js_sys::Number::from(numeric(bytes)?/1048576.0).to_fixed(1)?;return method(size.as_ref(),"concat",&[&" MB".into()]);}
 concat("",&[&jmax(1.0,js_round(numeric(bytes)?/1024.0)).into(),&" KB".into()])
}
#[wasm_bindgen]
pub fn reader_experience_place_label(host:&JsValue,place:&JsValue)->R<JsValue>{let label=read(place,"label")?;if truthy(&label){Ok(label)}else{method(host,"label",&[place])}}
#[wasm_bindgen]
pub fn reader_experience_select_place(host:&JsValue,name:&JsValue,index:&JsValue,place:&JsValue)->R<JsValue>{if *name==JsValue::from_str("history"){method(host,"returnToReading",&[index])}else{method(host,"jump",&[place])}}
#[wasm_bindgen]
pub fn reader_experience_remove_place(host:JsValue,name:JsValue,places:JsValue,index:JsValue)->R<JsValue>{
 let removed=method(&places,"splice",&[&index,&1.into()])?;let removed=read(&removed,"0")?;
 if name==JsValue::from_str("quotes"){method(&read(&host,"reader")?,"removeQuoteAnnotation",&[&removed])?;}
 let pending=promise(method(&host,"savePlaces",&[])?)?;
 Ok(future_to_promise(async move{JsFuture::from(pending).await?;method(&host,"renderPlaces",&[])?;Ok(JsValue::UNDEFINED)}).into())
}
#[wasm_bindgen]
pub fn reader_experience_places(host:&JsValue,kit:&JsValue)->R<()>{
 method(host,"updateBookmarkButton",&[])?;method(host,"updateReturnButton",&[])?;
 let mut groups=Vec::new();for name in ["history","bookmarks","quotes"]{groups.push((JsValue::from_str(name),read(host,name)?));}
 for(name,places)in groups{
  let labels=method(kit,"labels",&[host,&places])?;let select=method(kit,"select",&[host,&name])?;let remove=method(kit,"remove",&[host,&name,&places])?;let icon=method(kit,"icon",&[&"close".into()])?;
  method(&read(host,"lists")?,"renderPlaces",&[&name,&places,&labels,&select,&remove,&icon])?;
 }
 Ok(())
}
#[wasm_bindgen]
pub fn reader_experience_toc(host:&JsValue,kit:&JsValue)->R<()>{
 let toc=read(&read(host,"reader")?,"toc")?;let jump=method(kit,"toc",&[host])?;
 let available=method(&read(host,"lists")?,"renderToc",&[&toc,&jump])?;
 method(host,"showPlaceTab",&[&if truthy(&available){JsValue::from_str("toc")}else{"bookmarks".into()}])?;Ok(())
}
#[wasm_bindgen]
pub fn reader_experience_return_button(host:&JsValue)->R<()>{
 let audio=optional(&read(host,"voice")?,"browsing")?;let history=read(host,"history")?;let has_history=truthy(&read(&history,"length")?);
 let label=if truthy(&read(&history,"length")?){reader_experience_place_label(host,&read(&history,"0")?)?}else{"".into()};
 method(&read(host,"view")?,"updateReturnButton",&[&truthy(&audio).into(),&has_history.into(),&label])?;Ok(())
}

#[wasm_bindgen]
pub fn reader_experience_rotate(host:JsValue)->R<JsValue>{
 let start=(||->R<Option<Promise>>{
  let orientation=read(&read(&global(),"screen")?,"orientation")?;
  if !truthy(&optional(&orientation,"lock")?){method(&host,"error",&[&"No se puede girar.".into()])?;return Ok(None);}
  let orientation=read(&read(&global(),"screen")?,"orientation")?;
  let portrait=method(&read(&read(&read(&global(),"screen")?,"orientation")?,"type")?,"startsWith",&[&"portrait".into()])?;
  Ok(Some(promise(method(&orientation,"lock",&[&if truthy(&portrait){"landscape".into()}else{"portrait".into()}])?)?))
 })();
 match start{
  Ok(Some(pending))=>Ok(future_to_promise(async move{
   let result=match JsFuture::from(pending).await{Ok(_)=>method(&host,"error",&[&"".into()]),Err(error)=>Err(error)};
   if result.is_err(){method(&host,"error",&[&"Gira el dispositivo.".into()])?;}Ok(JsValue::UNDEFINED)
  }).into()),
  Ok(None)=>resolved(&JsValue::UNDEFINED),
  Err(_)=>{method(&host,"error",&[&"Gira el dispositivo.".into()])?;resolved(&JsValue::UNDEFINED)}
 }
}
fn share_failure(host:&JsValue,error:&JsValue)->R<()>{if read(error,"name")?!=JsValue::from_str("AbortError"){method(host,"error",&[&"No se pudo compartir.".into()])?;}Ok(())}
#[wasm_bindgen]
pub fn reader_experience_share(host:JsValue,kit:&JsValue)->R<JsValue>{
 let content=optional(&read(&host,"book")?,"content")?;
 if !truthy(&content){method(&host,"error",&[&"Archivo original no disponible.".into()])?;return resolved(&JsValue::UNDEFINED);}
 // Creating the File was outside the original try/catch too: preserve its
 // rejection and do not turn a missing browser constructor into a success.
 let parts=Array::new();parts.push(&content);
 let file_name=read(&read(&host,"book")?,"fileName")?;
 let file_name=if truthy(&file_name){file_name}else{
  let title=concat("",&[&read(&read(&host,"book")?,"title")?])?;
  let format=read(&read(&host,"book")?,"format")?;let format=if truthy(&format){format}else{"pdf".into()};
  let format=method(&method(&global(),"String",&[&format])?,"toLowerCase",&[])?;
  method(&title,"concat",&[&".".into(),&format])?
 };
 let mime=read(&read(&host,"book")?,"mimeType")?;
 let mime=if truthy(&mime){mime}else{let mime=read(&content,"type")?;if truthy(&mime){mime}else{"application/octet-stream".into()}};
 let file=construct("File",&[parts.as_ref(),&file_name,&object(&[("type",mime)])?])?;
 let start=(||->R<Option<Promise>>{
  let files=Array::new();files.push(&file);
  let navigator=read(&global(),"navigator")?;
  let possible=method_opt(&navigator,"canShare",&[&object(&[("files",files.clone().into())])?])?.unwrap_or(JsValue::UNDEFINED);
  if truthy(&possible)&&truthy(&read(&read(&global(),"navigator")?,"share")?){
   let title=method(kit,"title",&[&read(&host,"book")?])?;
   let files=Array::new();files.push(&file);
   return Ok(Some(promise(method(&read(&global(),"navigator")?,"share",&[&object(&[("title",title),("files",files.into())])?])?)?));
  }
  let url=method(&read(&global(),"URL")?,"createObjectURL",&[&file])?;
  let link=method(&read(&global(),"document")?,"createElement",&[&"a".into()])?;
  set(&link,"href",&url)?;set(&link,"download",&read(&file,"name")?)?;method(&link,"click",&[])?;
  set_timeout(&method(kit,"revoker",&[&url])?,30000.0)?;
  method(&read(&host,"panel")?,"close",&[])?;Ok(None)
 })();
 match start{
  Ok(Some(pending))=>Ok(future_to_promise(async move{
   let result=match JsFuture::from(pending).await{Ok(_)=>(||method(&read(&host,"panel")?,"close",&[]))(),Err(error)=>Err(error)};
   if let Err(error)=result{share_failure(&host,&error)?;}Ok(JsValue::UNDEFINED)
  }).into()),
  Ok(None)=>resolved(&JsValue::UNDEFINED),
  Err(error)=>{share_failure(&host,&error)?;resolved(&JsValue::UNDEFINED)}
 }
}
