//! Selection-owned reader opening. Callback objects belong to JavaScript's GC;
//! ownership checks, fallback routes and the page handover live in Rust.
use wasm_bindgen::prelude::*;
use js_sys::{Array,Object,Promise,Reflect};
use crate::host::{read,set,method,method_opt,truthy,absent,call};
use crate::cloud_host as c;
type R<T>=Result<T,JsValue>;
fn object(fields:&[(&str,JsValue)])->R<JsValue>{let entries=Array::new();for(k,v)in fields{c::data_entry(&entries,&(*k).into(),v);}Ok(Object::from_entries(entries.as_ref())?.into())}
fn classes(target:&JsValue,operation:&str,names:&[&str])->R<()>{let vals:Vec<JsValue>=names.iter().map(|v|(*v).into()).collect();let refs:Vec<_>=vals.iter().collect();method(&read(target,"classList")?,operation,&refs)?;Ok(())}
fn body(host:&JsValue)->R<JsValue>{read(&read(host,"document")?,"body")}
fn state(host:&JsValue)->R<JsValue>{read(host,"state")}
fn screen(host:&JsValue)->R<JsValue>{read(&read(host,"els")?,"readerScreen")}
fn active(ctx:&JsValue)->R<bool>{Ok(!truthy(&read(ctx,"isActive")?)||truthy(&method(ctx,"isActive",&[])?))}
fn owns(host:&JsValue,flight:&JsValue)->R<bool>{Ok(read(&state(host)?,"activeOpeningContext")?==read(flight,"ctx")?)}
fn warn(host:&JsValue,label:&str,error:&JsValue)->R<()>{method(&read(host,"console")?,"warn",&[&label.into(),error])?;Ok(())}
fn mark(host:&JsValue,flight:&JsValue)->R<()>{
 set(&state(host)?,"activeOpeningContext",&read(flight,"ctx")?)?;let screen=screen(host)?;
 classes(&screen,"add",&["is-opening-from-book"])?;classes(&screen,"remove",&["is-reader-page-ready"])?;
 set(&read(&screen,"dataset")?,"openingBook",&read(&read(flight,"book")?,"id")?)?;
 classes(&body(host)?,"add",&["is-opening-reader"])?;classes(&body(host)?,"remove",&["is-reader-page-arriving"])
}
fn clear(host:&JsValue,flight:&JsValue)->R<()>{
 if !owns(host,flight)?{return Ok(());}
 set(&state(host)?,"activeOpeningContext",&JsValue::NULL)?;let screen=screen(host)?;
 classes(&screen,"remove",&["is-opening-from-book","is-reader-page-ready"])?;
 Reflect::delete_property(&Object::from(read(&screen,"dataset")?),&"openingBook".into())?;
 classes(&body(host)?,"remove",&["is-opening-reader","is-reader-page-arriving"])
}
#[wasm_bindgen]
pub fn app_opening_is_active(flight:JsValue)->R<JsValue>{let ctx=read(&flight,"ctx")?;if !truthy(&read(&ctx,"isActive")?){Ok(JsValue::TRUE)}else{method(&ctx,"isActive",&[])}}
#[wasm_bindgen]
pub fn app_cancel_reader_opening(host:JsValue,flight:JsValue)->R<()>{
 if !owns(&host,&flight)?{return Ok(());}
 let state=state(&host)?;
 if read(&state,"pendingLocalReopenId")?==read(&read(&flight,"book")?,"id")?{
  set(&state,"pendingLocalReopenId",&JsValue::NULL)?;set(&state,"pendingReaderTransition",&JsValue::NULL)?;
 }
 clear(&host,&flight)?;method(&host,"showScreen",&[&"home".into()])?;
 set(&read(&read(&host,"els")?,"readerToolbar")?,"hidden",&JsValue::TRUE)
}
#[wasm_bindgen]
pub fn app_close_reader_opening(host:JsValue,flight:JsValue,options:JsValue)->R<JsValue>{
 app_cancel_reader_opening(host,flight.clone())?;method(&read(&flight,"ctx")?,"close",&[&options])
}
#[wasm_bindgen]
pub fn app_reveal_reader_toolbar(host:JsValue)->R<()>{classes(&read(&read(&host,"els")?,"readerToolbar")?,"add",&["is-visible"])}
#[wasm_bindgen]
pub fn app_settle_reader_toolbar(host:JsValue)->R<()>{classes(&read(&read(&host,"els")?,"readerToolbar")?,"remove",&["is-rising","is-visible"])}
#[wasm_bindgen]
pub fn app_reader_ready(host:JsValue,flight:JsValue)->Promise{
 c::start(async move{
  let ctx=read(&flight,"ctx")?;if !active(&ctx)?{app_cancel_reader_opening(host,flight)?;return Ok(JsValue::UNDEFINED);}
  mark(&host,&flight)?;
  let result=async{
   let book=read(&flight,"book")?;let id=read(&book,"id")?;
   method(&host,"refreshSelectedBookNames",&[&read(&host,"readingExperience")?,&book])?;
   c::settle(method(&host,"revealPreparedReader",&[])).await?;
   method(&host,"markTiming",&[&"reveal-done".into()])?;
   let record=c::settle(method(&read(&host,"library")?,"get",&[&id])).await?;let record=if truthy(&record){record}else{book};
   if !active(&ctx)?||read(&state(&host)?,"currentBookId")?!=id{app_cancel_reader_opening(host.clone(),flight.clone())?;return Ok(JsValue::UNDEFINED);}
   let snapshot=c::settle(method(&host,"openingPageSnapshot",&[&id,&record])).await?;
   if !active(&ctx)?{app_cancel_reader_opening(host.clone(),flight.clone())?;return Ok(JsValue::UNDEFINED);}
   if !truthy(&snapshot){return Err(c::error("No se pudo preparar la página guardada del libro."));}
   let options=object(&[("pageSnapshot",snapshot),("animatePage",read(&host,"animateReaderPageFromBook")?)])?;
   let completed=c::settle(Ok(method_opt(&ctx,"finish",&[&options])?.unwrap_or(JsValue::UNDEFINED))).await?;
   if completed==JsValue::FALSE{app_cancel_reader_opening(host.clone(),flight.clone())?;return Ok(JsValue::UNDEFINED);}
   let toolbar=read(&read(&host,"els")?,"readerToolbar")?;set(&toolbar,"hidden",&JsValue::FALSE)?;
   classes(&toolbar,"add",&["is-rising"])?;read(&toolbar,"offsetWidth")?;
   method(&host,"requestAnimationFrame",&[&read(&host,"revealReaderToolbar")?])?;
   method(&host,"setTimeout",&[&read(&host,"settleReaderToolbar")?,&500.0.into()])?;
   Ok(JsValue::UNDEFINED)
  }.await;
  clear(&host,&flight)?;result
 })
}
#[wasm_bindgen]
pub fn app_cancel_opening_picker(host:JsValue,flight:JsValue)->R<()>{
 let state=state(&host)?;
 if read(&state,"pendingReaderTransition")?==read(&flight,"transition")?&&active(&read(&flight,"ctx")?)?
  &&read(&state,"pendingLocalReopenId")?==read(&read(&flight,"book")?,"id")?{
  set(&state,"pendingLocalReopenId",&JsValue::NULL)?;set(&state,"pendingReaderTransition",&JsValue::NULL)?;
  app_close_reader_opening(host,flight,object(&[("instant",JsValue::TRUE)])?)?;
 }Ok(())
}
#[wasm_bindgen]
pub fn app_schedule_picker_cancel(host:JsValue,flight:JsValue)->R<JsValue>{
 let callback=method(&host,"pickerCancellation",&[&flight])?;method(&host,"setTimeout",&[&callback,&400.0.into()])
}
fn or(value:JsValue,fallback:impl FnOnce()->R<JsValue>)->R<JsValue>{if truthy(&value){Ok(value)}else{fallback()}}
fn stored_file(book:&JsValue)->R<JsValue>{
 let content=read(book,"content")?;let parts=Array::new();parts.push(&content);
 let name=or(read(book,"name")?,||or(read(book,"title")?,||Ok("libro".into())))?;
 let mime=or(read(book,"mimeType")?,||or(read(&content,"type")?,||Ok("".into())))?;
 c::construct("File",&[parts.as_ref(),&name,&object(&[("type",mime)])?])
}
#[wasm_bindgen]
pub fn app_open_book_record(host:JsValue,book:JsValue,ctx:JsValue)->Promise{
 c::start(async move{
  let flight=object(&[("book",book.clone()),("ctx",ctx.clone())])?;
  mark(&host,&flight)?;let transition=method(&host,"openingCallbacks",&[&flight])?;set(&flight,"transition",&transition)?;
  let cancel=method(&host,"openingCancellation",&[&flight])?;method_opt(&ctx,"onCancel",&[&cancel])?;
  let id=read(&book,"id")?;let books=read(&host,"preparedBooks")?;let prepared=method(&books,"get",&[&id])?;
  if truthy(&prepared){
   method(&host,"releasePageGate",&[&"open".into(),&id])?;
   let result=async{
    let ready=c::settle(Ok(prepared)).await?;
    if !active(&ctx)?{return Ok(true);}
    let state=state(&host)?;
    if truthy(&ready)&&read(&state,"activePreparedBookId")?==id&&read(&state,"currentBookId")?==id{
     method(&books,"delete",&[&id])?;c::settle(method(&transition,"onReaderReady",&[])).await?;
     let record=c::settle(method(&read(&host,"library")?,"get",&[&id])).await?;
     if truthy(&record){method(&host,"extractCoverInBackground",&[&record])?;}return Ok(true);
    }Ok(false)
   }.await;
   match result{Ok(true)=>return Ok(JsValue::UNDEFINED),Ok(false)=>{},Err(error)=>{
    if !active(&ctx)?{return Ok(JsValue::UNDEFINED);}
    method(&books,"delete",&[&id])?;warn(&host,"La preparación anticipada falló; se abrirá el libro ahora:",&error)?;
   }}
  }
  if !active(&ctx)?{return Ok(JsValue::UNDEFINED);}
  if read(&book,"sourceType")?==JsValue::from_str("local")&&!truthy(&method(&host,"needsDriveDownload",&[&book])?){
   if truthy(&read(&book,"content")?){
    let result=async{
     let file=stored_file(&book)?;let options=object(&[("existingRecord",book.clone()),("forcedId",id.clone()),("transition",transition.clone()),("reuseStoredContent",JsValue::TRUE)])?;
     c::settle(method(&host,"openFile",&[&file,&options])).await?;Ok::<_,JsValue>(())
    }.await;
    match result{Ok(())=>return Ok(JsValue::UNDEFINED),Err(error)=>{
     if !active(&ctx)?{return Ok(JsValue::UNDEFINED);}
     warn(&host,"No se pudo abrir el libro desde la copia guardada, se intentará otra vía:",&error)?;
    }}
   }
   if truthy(&read(&book,"folderFileName")?)&&truthy(&method(&host,"isFolderApiSupported",&[])?){
    let result=async{
     let folder=c::settle(method(&host,"getSavedFolderHandle",&[])).await?;
     if truthy(&folder)&&truthy(&c::settle(method(&host,"ensureFolderPermission",&[&folder])).await?){
      let file=c::settle(method(&host,"readFileFromFolder",&[&folder,&read(&book,"folderFileName")?])).await?;
      if !active(&ctx)?{return Ok(true);}
      if truthy(&file){let options=object(&[("existingRecord",book.clone()),("forcedId",id.clone()),("transition",transition.clone())])?;c::settle(method(&host,"openFile",&[&file,&options])).await?;return Ok(true);}
     }Ok(false)
    }.await;
    match result{Ok(true)=>return Ok(JsValue::UNDEFINED),Ok(false)=>{},Err(error)=>{
     if !active(&ctx)?{return Ok(JsValue::UNDEFINED);}
     warn(&host,"No se pudo leer el libro de la carpeta guardada, se pedirá manualmente:",&error)?;
    }}
   }
   if !active(&ctx)?{return Ok(JsValue::UNDEFINED);}
   let state=state(&host)?;set(&state,"pendingLocalReopenId",&id)?;set(&state,"pendingReaderTransition",&transition)?;
   method(&read(&read(&host,"els")?,"filePicker")?,"click",&[])?;
   let listener=method(&host,"filePickerFocusListener",&[&flight])?;
   method(&read(&host,"window")?,"addEventListener",&[&"focus".into(),&listener,&object(&[("once",JsValue::TRUE)])?])?;
   return Ok(JsValue::UNDEFINED);
  }
  if truthy(&read(&book,"driveFileId")?){
   let result=async{
    let file=c::settle(method(&read(&host,"cloudSync")?,"downloadForOffline",&[&book])).await?;
    if !active(&ctx)?{return Ok(());}
    let saved=c::settle(method(&read(&host,"library")?,"get",&[&id])).await?;let saved=if truthy(&saved){saved}else{book.clone()};
    let options=object(&[("existingRecord",saved),("transition",transition),("reuseStoredContent",JsValue::TRUE)])?;
    c::settle(method(&host,"openFile",&[&file,&options])).await?;Ok::<_,JsValue>(())
   }.await;
   if let Err(error)=result{
    if !active(&ctx)?{return Ok(JsValue::UNDEFINED);}
    app_close_reader_opening(host.clone(),flight,object(&[("instant",JsValue::TRUE)])?)?;
    let message=format!("No se pudo descargar \"{}\" de Drive: {}",c::string(&read(&book,"title")?),c::string(&read(&error,"message")?));method(&host,"alert",&[&message.into()])?;
   }
  }
  Ok(JsValue::UNDEFINED)
 })
}
#[wasm_bindgen]
pub fn app_animate_reader_page(host:JsValue,options:JsValue)->Promise{
 c::start(async move{
  let screen=screen(&host)?;let active=read(&options,"isActive")?;
  if !truthy(&screen)||truthy(&read(&screen,"hidden")?)||(truthy(&active)&&!truthy(&call(&active,"isActive",&[])?)){return Ok(JsValue::UNDEFINED);}
  let snapshot=read(&options,"pageSnapshot")?;
  let page=if read(&snapshot,"sourceType")?==JsValue::from_str("pdf-canvas"){method(&screen,"querySelector",&[&".pdf-page-wrap:not([hidden]) .pdf-page-canvas".into()])?}else{JsValue::NULL};
  let measured=if absent(&page){JsValue::UNDEFINED}else{method(&page,"getBoundingClientRect",&[])?};
  let target=if !absent(&measured)&&truthy(&read(&measured,"width")?)&&truthy(&read(&measured,"height")?){measured}else{read(&snapshot,"displayBounds")?};
  if absent(&target)||!truthy(&read(&target,"width")?)||!truthy(&read(&target,"height")?){return Err(c::error("La página del lector todavía no está preparada."));}
  classes(&body(&host)?,"add",&["is-reader-page-arriving"])?;
  let mut bounds=Vec::new();for key in ["left","top","width","height"]{bounds.push((key,read(&target,key)?));}bounds.push(("duration",read(&options,"duration")?));
  c::settle(call(&read(&options,"animateBookToPage")?,"animateBookToPage",&[&object(&bounds)?])).await?;
  if truthy(&active)&&!truthy(&call(&active,"isActive",&[])?){return Ok(JsValue::UNDEFINED);}
  classes(&screen,"add",&["is-reader-page-ready"])?;c::settle(method(&host,"readerPageFrames",&[])).await?;Ok(JsValue::UNDEFINED)
 })
}
