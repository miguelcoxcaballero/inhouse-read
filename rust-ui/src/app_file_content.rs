//! Reader file ingestion after the browser has loaded the native UI module.
//! The small cold-loader adapter can report a failed WASM download before Rust
//! exists. All metadata, cancellation, storage and reader sequencing live here.
use wasm_bindgen::prelude::*;
use js_sys::{Array,Object,Promise};
use crate::host::{read,set,method,method_opt,truthy,absent,call_opt};
use crate::cloud_host as c;
type R<T>=Result<T,JsValue>;
fn object(fields:&[(&str,JsValue)])->R<JsValue>{let entries=Array::new();for(k,v)in fields{c::data_entry(&entries,&(*k).into(),v);}Ok(Object::from_entries(entries.as_ref())?.into())}
fn opt(v:&JsValue,k:&str)->R<JsValue>{if absent(v){Ok(JsValue::UNDEFINED)}else{read(v,k)}}
fn or(v:JsValue,f:impl FnOnce()->R<JsValue>)->R<JsValue>{if truthy(&v){Ok(v)}else{f()}}
fn nullish(v:JsValue,f:impl FnOnce()->R<JsValue>)->R<JsValue>{if absent(&v){f()}else{Ok(v)}}
fn def(v:JsValue)->JsValue{if v.is_undefined(){JsValue::FALSE}else{v}}
fn classes(target:&JsValue,operation:&str,names:&[&str])->R<()>{let v:Vec<JsValue>=names.iter().map(|v|(*v).into()).collect();let refs:Vec<_>=v.iter().collect();method(&read(target,"classList")?,operation,&refs)?;Ok(())}
fn active(transition:&JsValue)->R<bool>{Ok(!truthy(&opt(transition,"isActive")?)||truthy(&method(transition,"isActive",&[])?))}
#[wasm_bindgen]
pub fn app_reader_user_navigation(host:JsValue)->R<JsValue>{method(&read(&read(&host,"readingExperience")?,"voice")?,"browse",&[])}
#[wasm_bindgen]
pub fn app_reader_follow_link(host:JsValue,href:JsValue)->R<JsValue>{
 let screen=read(&read(&host,"els")?,"readerScreen")?;
 if !truthy(&method(&read(&screen,"classList")?,"contains",&[&"reader-kids-mode".into()])?){method(&read(&host,"readingExperience")?,"jump",&[&JsValue::NULL,&href])}else{Ok(JsValue::UNDEFINED)}
}
#[wasm_bindgen]
pub fn app_reader_toggle_chrome(host:JsValue)->R<JsValue>{
 let body=read(&read(&host,"document")?,"body")?;let hidden=truthy(&method(&read(&body,"classList")?,"contains",&[&"is-reader-focus".into()])?);
 method(&host,"setReaderChromeHidden",&[&JsValue::from_bool(!hidden)])
}
#[wasm_bindgen]
pub fn app_open_file_content(host:JsValue,file:JsValue,options:JsValue)->Promise{
 c::start(async move{
  let options=if options.is_undefined(){Object::new().into()}else{options};
  let mut existing=read(&options,"existingRecord")?;let forced=read(&options,"forcedId")?;
  let folder=read(&options,"folderFileName")?;let transition=read(&options,"transition")?;
  let preparing=def(read(&options,"preparing")?);let restore=def(read(&options,"restoreRemoved")?);
  let import_ready=read(&options,"onImportReady")?;let reuse=def(read(&options,"reuseStoredContent")?);
  let state=read(&host,"state")?;let experience=read(&host,"readingExperience")?;let reader=read(&host,"reader")?;let els=read(&host,"els")?;
  if !truthy(&existing)&&truthy(&forced){existing=c::settle(method(&read(&host,"library")?,"get",&[&forced])).await?;}
  if !active(&transition)?{return Ok(JsValue::FALSE);}
  if !truthy(&preparing){
   method(&host,"supersedePreparation",&[&"reader-replaced".into()])?;set(&state,"requestedPreparationId",&JsValue::NULL)?;set(&state,"activePreparedBookId",&JsValue::NULL)?;
   method(&read(&host,"preparedBooks")?,"clear",&[])?;
   let pending=method(&read(&state,"readerPreparationQueue")?,"catch",&[&read(&host,"ignoreFileOpenError")?])?;c::settle(Ok(pending)).await?;
  }
  if !active(&transition)?{return Ok(JsValue::FALSE);}
  method(&experience,"reset",&[])?;classes(&read(&read(&host,"document")?,"body")?,"remove",&["is-reader-focus"])?;
  let focus=read(&els,"readerFocus")?;method(&focus,"setAttribute",&[&"aria-pressed".into(),&"false".into()])?;method(&focus,"setAttribute",&[&"aria-label".into(),&"Ocultar controles".into()])?;
  set(&state,"currentBookId",&JsValue::NULL)?;set(&read(&els,"readerToolbar")?,"hidden",&JsValue::TRUE)?;
  let screen=read(&els,"readerScreen")?;
  if truthy(&preparing){set(&screen,"hidden",&JsValue::FALSE)?;classes(&screen,"add",&["is-preparing"])?;}else{classes(&screen,"remove",&["is-preparing"])?;method(&host,"showScreen",&[&"reader".into()])?;}
  let viewport=read(&els,"readerViewport")?;set(&viewport,"innerHTML",&"".into())?;
  let opened=async{
   let locator=opt(&existing,"locator")?;
   let initial=if opt(&locator,"kind")?==JsValue::from_str("pdf-page"){read(&read(&existing,"locator")?,"value")?}else{JsValue::UNDEFINED};
   let callbacks=method(&host,"fileReaderCallbacks",&[])?;
   let options=object(&[("initialPage",initial),("initialLocator",opt(&existing,"locator")?),("initialFraction",opt(&existing,"progressFraction")?),
    ("preferences",read(&experience,"preferences")?),("onRelocate",read(&host,"onReaderRelocate")?),
    ("onUserNavigation",read(&callbacks,"onUserNavigation")?),("onFollowLink",read(&callbacks,"onFollowLink")?),("onToggleChrome",read(&callbacks,"onToggleChrome")?)])?;
   c::settle(method(&reader,"open",&[&viewport,&file,&options])).await
  }.await;
  let format=match opened{Ok(value)=>value,Err(error)=>{
   if !active(&transition)?{return Ok(JsValue::FALSE);}
   if truthy(&preparing){classes(&screen,"remove",&["is-preparing"])?;set(&screen,"hidden",&JsValue::TRUE)?;}
   else{method(&host,"showScreen",&[&"home".into()])?;if truthy(&transition){c::settle(Ok(method_opt(&transition,"onReaderError",&[])?.unwrap_or(JsValue::UNDEFINED))).await?;}}
   let name=c::string(&read(&file,"name")?);
   if truthy(&method(&host,"isUnsupportedFormatError",&[&error])?){let message=format!("Formato no admitido: \"{name}\". Usa PDF, EPUB, MOBI, AZW3, FB2 o CBZ.");method(&host,"alert",&[&message.into()])?;}
   else{let message=format!("No se pudo abrir \"{name}\": {}",c::string(&read(&error,"message")?));method(&host,"alert",&[&message.into()])?;method(&read(&host,"console")?,"error",&[&error])?;}
   return Ok(JsValue::FALSE);
  }};
  if !active(&transition)?{return Ok(JsValue::FALSE);}
  set(&read(&els,"readerFormatBadge")?,"textContent",&nullish(read(&format,"label")?,||Ok("".into()))?)?;
  let meta=read(&reader,"metadata")?;let source=nullish(opt(&existing,"sourceType")?,||Ok("local".into()))?;
  // Keep object-literal evaluation order as well as lazy || / ?? fallbacks.
  let mut fields=vec![("id",forced),("sourceType",source),
   ("driveFileId",opt(&existing,"driveFileId")?),("cloudAccountId",opt(&existing,"cloudAccountId")?)];
  fields.push(("mimeType",nullish(opt(&existing,"mimeType")?,||read(&file,"type"))?));
  fields.push(("name",read(&file,"name")?));fields.push(("size",read(&file,"size")?));
  fields.push(("contentRevision",if truthy(&reuse){opt(&existing,"contentRevision")?}else{JsValue::UNDEFINED}));
  fields.push(("pageCount",nullish(read(&reader,"pageCount")?,||opt(&existing,"pageCount"))?));
  fields.push(("sizeBytes",read(&file,"size")?));fields.push(("folderFileName",nullish(folder,||opt(&existing,"folderFileName"))?));
  let title=or(read(&meta,"title")?,||or(opt(&existing,"title")?,||read(&file,"name")))?;
  fields.push(("title",method(&host,"normalizeBookTitle",&[&title,&read(&file,"name")?])?));
  let author=or(method(&host,"normalizeBookAuthor",&[&opt(&existing,"author")?])?,||{
   let name=nullish(read(&meta,"author")?,||read(&meta,"creator"))?;method(&host,"normalizeBookAuthor",&[&name])
  })?;
  fields.push(("author",author));fields.push(("format",read(&format,"label")?));let base=object(&fields)?;
  let stored=c::settle(method(&host,"storeBookFile",&[&read(&host,"library")?,&file,&base,&object(&[("restoreRemoved",restore),("reuseStoredContent",reuse)])?])).await;
  let record=match stored{Ok(record)=>record,Err(error)=>{
   method(&reader,"close",&[])?;method(&experience,"reset",&[])?;classes(&screen,"remove",&["is-preparing"])?;method(&host,"showScreen",&[&"home".into()])?;
   c::settle(Ok(method_opt(&transition,"onReaderError",&[])?.unwrap_or(JsValue::UNDEFINED))).await?;return Err(error);
  }};
  if !truthy(&record){return Ok(JsValue::FALSE);}if !active(&transition)?{return Ok(JsValue::FALSE);}
  set(&state,"currentBookId",&read(&record,"id")?)?;method(&host,"scheduleLibraryBackup",&[])?;
  let count=method(&read(&host,"wordCountQueue")?,"ensure",&[&record])?;method(&count,"catch",&[&read(&host,"warnFileGeometry")?])?;
  set(&state,"restoringProgress",&JsValue::TRUE)?;
  let restored=async{
   c::settle(method(&experience,"open",&[&record])).await?;
   if !active(&transition)?{return Ok(false);}
   if truthy(&opt(&existing,"locator")?)||truthy(&opt(&existing,"progressFraction")?){c::settle(method(&reader,"goToLocator",&[&read(&existing,"locator")?,&read(&existing,"progressFraction")?])).await?;}
   Ok::<_,JsValue>(true)
  }.await;
  set(&state,"restoringProgress",&JsValue::FALSE)?;if !restored?{return Ok(JsValue::FALSE);}
  if !truthy(&preparing){method(&host,"refreshShelf",&[])?;method(&host,"extractCoverInBackground",&[&record])?;
   c::settle(Ok(method_opt(&transition,"onReaderReady",&[])?.unwrap_or(JsValue::UNDEFINED))).await?;
   call_opt(&import_ready,"onImportReady",&[])?;
  }
  if !truthy(&preparing)&&!truthy(&transition){set(&read(&els,"readerToolbar")?,"hidden",&JsValue::FALSE)?;}
  Ok(JsValue::TRUE)
 })
}
