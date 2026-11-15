//! Progress writes follow committed anchors, never intermediate paginator state.
use wasm_bindgen::prelude::*;
use crate::host::{read,set,method,truthy,absent,num,js_round,number_string};
use crate::reader_position::reader_persistable_relocation;
type R<T>=Result<T,JsValue>;
#[wasm_bindgen]
pub fn app_reader_relocate(host:JsValue,relocation:JsValue)->R<()>{
 let fraction=read(&relocation,"fraction")?;let fraction=if absent(&fraction){0.0}else{num(&fraction)};
 let fill=read(&read(&host,"els")?,"readerProgressFill")?;
 set(&read(&fill,"style")?,"width",&format!("{}%",number_string(js_round(fraction*100.0))).into())?;
 method(&read(&host,"readingExperience")?,"relocate",&[])?;
 let state=read(&host,"state")?;
 if !truthy(&read(&state,"currentBookId")?)||truthy(&read(&state,"restoringProgress")?)||truthy(&read(&state,"closingReader")?){return Ok(());}
 let format=read(&read(&host,"reader")?,"format")?;let engine=if absent(&format){JsValue::UNDEFINED}else{read(&format,"engine")?};
 let position=reader_persistable_relocation(relocation,engine)?;
 if !truthy(&position){return Ok(());}
 let id=read(&state,"currentBookId")?;
 let task=method(&read(&host,"progressWrites")?,"updateProgress",&[&id,&read(&position,"fraction")?,&read(&position,"locator")?])?;
 method(&task,"catch",&[&read(&host,"warnReaderProgress")?])?;Ok(())
}
