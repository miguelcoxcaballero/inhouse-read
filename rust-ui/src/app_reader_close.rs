//! Returning the current page to its physical shelf origin. Browser callbacks
//! are GC-owned adapters; this module owns ordering, cancellation and cleanup.
use wasm_bindgen::prelude::*;
use js_sys::{Array,Object,Promise};
use crate::host::{read,set,method,method_opt,truthy,absent};
use crate::cloud_host as c;
type R<T> = Result<T,JsValue>;
fn object(fields:&[(&str,JsValue)])->R<JsValue>{let entries=Array::new();for(k,v)in fields{c::data_entry(&entries,&(*k).into(),v);}Ok(Object::from_entries(entries.as_ref())?.into())}
fn optional(value:&JsValue,key:&str)->R<JsValue>{if absent(value){Ok(JsValue::UNDEFINED)}else{read(value,key)}}
fn classes(target:&JsValue,operation:&str,names:&[&str])->R<()>{let args:Vec<JsValue>=names.iter().map(|v|JsValue::from_str(v)).collect();let refs:Vec<_>=args.iter().collect();method(&read(target,"classList")?,operation,&refs)?;Ok(())}
fn ignore(host:&JsValue,task:&JsValue)->R<JsValue>{method(task,"catch",&[&read(host,"ignoreCloseError")?])}
fn warn(host:&JsValue,label:&str,error:&JsValue)->R<()>{method(&read(host,"console")?,"warn",&[&label.into(),error])?;Ok(())}
fn body(host:&JsValue)->R<JsValue>{read(&read(host,"document")?,"body")}
fn remove_still(flight:&JsValue)->R<()>{method_opt(&read(flight,"stillPage")?,"remove",&[])?;Ok(())}
#[wasm_bindgen]
pub fn app_remove_return_page(flight:JsValue)->R<()>{remove_still(&flight)}
#[wasm_bindgen]
pub fn app_return_page_handoff(host:JsValue,flight:JsValue)->R<()>{
 if truthy(&read(&flight,"handedOff")?){return Ok(());}
 set(&flight,"handedOff",&JsValue::TRUE)?;
 classes(&body(&host)?,"add",&["is-reader-page-leaving"])?;
 let still=read(&flight,"stillPage")?;
 if truthy(&still){
  let frames=Array::new();frames.push(&object(&[("opacity",1.0.into())])?);frames.push(&object(&[("opacity",0.0.into())])?);
  let reduced=read(&method(&host,"matchMedia",&[&"(prefers-reduced-motion: reduce)".into()])?,"matches")?;
  let fade=method(&still,"animate",&[frames.as_ref(),&object(&[("duration",if truthy(&reduced){1.0.into()}else{220.0.into()}),("fill","both".into())])?])?;
  set(&flight,"stillFade",&fade)?;
  let callback=method(&host,"closeStillRemoval",&[&flight])?;
  ignore(&host,&method(&read(&fade,"finished")?,"then",&[&callback])?)?;
 }
 Ok(())
}
#[wasm_bindgen]
pub fn app_flush_closed_progress(host:JsValue,id:JsValue)->R<JsValue>{method(&read(&host,"cloudSync")?,"flushProgress",&[&id])}
#[wasm_bindgen]
pub fn app_warn_closed_progress(host:JsValue,error:JsValue)->R<JsValue>{
 let message=format!("Progreso pendiente: {}",c::string(&read(&error,"message")?));method(&host,"setDriveSyncStatus",&[&message.into()])
}
fn flush_progress(host:&JsValue,id:&JsValue,pending:&JsValue)->R<()>{
 // Keep the original Promise reactions, including rejected pending writes.
 // GC-owned adapters forward directly to native exports without extra awaits.
 let callback=method(host,"closeProgressFlush",&[id])?;
 let task=method(Promise::resolve(pending).as_ref(),"then",&[&callback])?;
 method(&task,"catch",&[&read(host,"warnClosedProgress")?])?;Ok(())
}
async fn close_body(host:&JsValue,flight:&JsValue,id:&JsValue)->R<()>{
 let experience=read(host,"readingExperience")?;let reader=read(host,"reader")?;let state=read(host,"state")?;let els=read(host,"els")?;
 if read(&experience,"closeVoice")?.is_function(){method(&experience,"closeVoice",&[])?;}else{method(&read(&experience,"voice")?,"stop",&[])?;}
 method(&read(&experience,"panel")?,"close",&[])?;
 let task=method(&reader,"getPageSnapshot",&[&object(&[("reuseSettledLayout",JsValue::TRUE)])?])?;
 let snapshot=match c::settle(Ok(task)).await{Ok(value)=>value,Err(error)=>{warn(host,"No se pudo preparar la página de cierre:",&error)?;JsValue::NULL}};
 let writes=read(host,"progressWrites")?;let pending=method(&writes,"get",&[id])?;
 c::settle(Ok(if absent(&pending){JsValue::UNDEFINED}else{ignore(host,&pending)?})).await?;
 let position=method(host,"persistablePosition",&[&optional(&snapshot,"location")?])?;
 let guard=optional(host,"positionGuard")?;
 if truthy(&position)&&(absent(&guard)||truthy(&method(&guard,"changed",&[id,&position])?)){
  let target=if read(&writes,"updateProgress")?.is_function(){writes.clone()}else{read(host,"library")?};
  c::settle(method(&target,"updateProgress",&[id,&read(&position,"fraction")?,&read(&position,"locator")?])).await?;
  if truthy(&method(host,"hasDriveSession",&[])?){method(&read(host,"cloudSync")?,"scheduleProgress",&[id])?;}
 }
 let book=c::settle(method(&read(host,"library")?,"get",&[id])).await?;
 if truthy(&optional(&snapshot,"source")?)&&truthy(&optional(&read(&snapshot,"displayBounds")?,"width")?){
  let document=read(host,"document")?;let still=method(&document,"createElement",&[&"div".into()])?;
  set(&flight,"stillPage",&still)?;set(&still,"className",&"ihr-reader-return-page".into())?;
  method(&still,"setAttribute",&[&"aria-hidden".into(),&"true".into()])?;
  let screen_style=method(host,"getComputedStyle",&[&read(&els,"readerScreen")?])?;let style=read(&still,"style")?;
  for key in ["backgroundColor","backgroundImage"]{set(&style,key,&read(&screen_style,key)?)?;}
  let image=method(host,"readerReturnCanvas",&[&read(&snapshot,"source")?,&object(&[("reuseDetached",JsValue::TRUE)])?])?;
  let bounds=read(&snapshot,"displayBounds")?;let vals:Vec<_>=["left","top","width","height"].iter().map(|k|read(&bounds,k).map(|v|c::string(&v))).collect::<R<_>>()?;
  set(&read(&image,"style")?,"cssText",&format!("position:absolute;left:{}px;top:{}px;width:{}px;height:{}px",vals[0],vals[1],vals[2],vals[3]).into())?;
  method(&still,"append",&[&image])?;method(&read(&document,"body")?,"append",&[&still])?;
 }
 method(host,"supersedePreparation",&[&"reader-closed".into()])?;
 set(&state,"requestedPreparationId",&JsValue::NULL)?;set(&state,"activePreparedBookId",&JsValue::NULL)?;
 method(&read(host,"preparedBooks")?,"clear",&[])?;method(&experience,"reset",&[])?;
 let pending=method(&writes,"get",&[id])?;method(&reader,"close",&[])?;set(&state,"currentBookId",&JsValue::NULL)?;
 if truthy(id)&&truthy(&method(host,"hasDriveSession",&[])?){flush_progress(host,id,&pending)?;}
 let geometry=truthy(&method(host,"isBookLengthReady",&[&book])?);
 if geometry{method_opt(&read(&state,"shelf")?,"setReturningBook",&[id])?;}
 method(host,"showScreen",&[&"home".into()])?;set(&read(&els,"readerToolbar")?,"hidden",&JsValue::TRUE)?;
 let shelf=read(&state,"shelf")?;let origin=if absent(&shelf){JsValue::UNDEFINED}else{method(&shelf,"hasReaderOrigin",&[id])?};
 if !truthy(&origin)||!geometry{c::settle(method(host,"refreshShelf",&[&object(&[("immediate",JsValue::TRUE)])?])).await?;}
 let returned=if geometry{
  let settings=object(&[("pageSnapshot",snapshot),("book",book),("onPageReady",method(host,"closeHandoff",&[flight])?)])?;
  let shelf=read(&state,"shelf")?;c::settle(Ok(if absent(&shelf){JsValue::UNDEFINED}else{method(&shelf,"returnToShelf",&[id,&settings])?})).await?
 }else{JsValue::FALSE};
 if !truthy(&returned){
  app_return_page_handoff(host.clone(),flight.clone())?;
  let fade=read(flight,"stillFade")?;
  c::settle(Ok(if absent(&fade){JsValue::UNDEFINED}else{ignore(host,&read(&fade,"finished")?)?})).await?;
 }
 Ok(())
}
#[wasm_bindgen]
pub fn app_close_reader(host:JsValue)->Promise{
 c::start(async move{
  let state=read(&host,"state")?;
  if truthy(&read(&state,"closingReader")?)||!truthy(&read(&state,"currentBookId")?){return Ok(JsValue::UNDEFINED);}
  set(&state,"closingReader",&JsValue::TRUE)?;classes(&body(&host)?,"add",&["is-closing-reader"])?;
  let id=read(&state,"currentBookId")?;
  let cover=method(&read(&host,"coverUpgrades")?,"get",&[&id])?;
  if truthy(&optional(&cover,"firstCover")?){set(&cover,"retainedOnClose",&JsValue::TRUE)?;}
  else if !absent(&cover){method(&read(&cover,"controller")?,"abort",&[])?;}
  let flight=object(&[("stillPage",JsValue::NULL),("stillFade",JsValue::NULL),("handedOff",JsValue::FALSE)])?;
  let result=close_body(&host,&flight,&id).await;
  let caught=if let Err(error)=result{(||->R<()>{
   warn(&host,"No se pudo devolver el libro a la estantería:",&error)?;
   method(&read(&host,"reader")?,"close",&[])?;set(&state,"currentBookId",&JsValue::NULL)?;
   method(&read(&host,"readingExperience")?,"reset",&[])?;method(&host,"showScreen",&[&"home".into()])?;
   set(&read(&read(&host,"els")?,"readerToolbar")?,"hidden",&JsValue::TRUE)?;Ok(())
  })()}else{Ok(())};
  method_opt(&read(&state,"shelf")?,"setReturningBook",&[&JsValue::NULL])?;
  method_opt(&read(&flight,"stillFade")?,"cancel",&[])?;remove_still(&flight)?;
  classes(&body(&host)?,"remove",&["is-closing-reader","is-reader-page-leaving"])?;set(&state,"closingReader",&JsValue::FALSE)?;
  if truthy(&read(&state,"cloudRoomChanged")?){let task=method(&host,"refreshShelf",&[])?;method(&task,"catch",&[&read(&host,"warnPendingShelf")?])?;}
  caught?;Ok(JsValue::UNDEFINED)
 })
}
