//! Shared complete-text metadata. Compiled into both modules so Drive never needs
//! to load the shelf to validate a count; all checks remain synchronous in IDB callbacks.
use wasm_bindgen::prelude::*;
use crate::host::{read,num,truthy,global,method};
use crate::cloud_host::{nullish,object};
type R<T> = Result<T,JsValue>;
const WORDS:f64=300.0;const DEFAULT_PAGES:f64=320.0;const VERSION:f64=2.0;
fn f(n:f64)->JsValue{JsValue::from_f64(n)}
fn s(text:&str)->JsValue{JsValue::from_str(text)}
fn null()->JsValue{JsValue::NULL}
fn undef()->JsValue{JsValue::UNDEFINED}
fn or(a:JsValue,b:JsValue)->JsValue{if truthy(&a){a}else{b}}
fn obj(fields:&[(&str,&JsValue)])->JsValue{object(&fields.iter().map(|(k,v)|(*k,(*v).clone())).collect::<Vec<_>>())}
fn put(target:&JsValue,key:&str,value:&JsValue){let _=crate::host::set(target,key,value);}
fn putb(target:&JsValue,key:&str,value:bool){put(target,key,&JsValue::from_bool(value));}
pub(crate) fn safe_integer(value:&JsValue)->bool{value.as_f64().is_some_and(|n|n.is_finite()&&n.abs()<=9007199254740991.0&&n.fract()==0.0)}
pub(crate) fn valid_count(value:&JsValue)->bool{value.as_f64().is_some_and(|n|n.is_finite()&&n>=0.0&&n<=9007199254740991.0&&n.fract()==0.0)}
#[wasm_bindgen]
pub fn length_has_complete_count(book:JsValue)->R<bool>{Ok(valid_count(&optional(&book,"wordCount")?)&&read(&book,"wordCountVersion")?==f(VERSION)&&read(&book,"wordCountComplete")?==JsValue::TRUE)}
fn optional(value:&JsValue,key:&str)->R<JsValue>{if nullish(value){Ok(undef())}else{read(value,key)}}
#[wasm_bindgen]
pub fn length_complete_count(words:JsValue)->JsValue{
 if !valid_count(&words){return null();}
 obj(&[("wordCount",&words),("wordCountVersion",&f(VERSION)),("wordCountComplete",&JsValue::TRUE),("estimatedPageCount",&f((num(&words)/WORDS).ceil())),("lengthSource",&s("text"))])
}
#[wasm_bindgen]
pub fn length_printed_pages(book:JsValue)->R<f64>{
 let words=if optional(&book,"wordCount")?.as_f64().is_some()&&num(&optional(&book,"wordCount")?).is_finite()&&num(&optional(&book,"wordCount")?)>=0.0{read(&book,"wordCount")?}else{null()};
 Ok(if nullish(&words){DEFAULT_PAGES}else{num(&words)/WORDS})
}
fn checksum(value:&JsValue)->JsValue{
 let Some(text)=value.as_string()else{return null()};
 if text.len()==32&&text.bytes().all(|byte|byte.is_ascii_hexdigit()){s(&text.to_ascii_lowercase())}else{null()}
}
fn book_bytes(book:&JsValue)->R<f64>{
 let size=optional(&optional(book,"content")?,"size")?;
 let value=if !nullish(&size){size}else{let size=optional(book,"size")?;if !nullish(&size){size}else{optional(book,"sizeBytes")?}};
 Ok(num(&value))
}
#[wasm_bindgen]
pub fn length_is_ready(book:JsValue)->R<bool>{
 Ok(length_has_complete_count(book.clone())?&&(!truthy(&read(&book,"content")?)||truthy(&read(&book,"contentRevision")?)&&read(&book,"wordCountContentRevision")?==read(&book,"contentRevision")?))
}
#[wasm_bindgen]
pub fn length_drive_metadata(book:JsValue)->R<JsValue>{
 let remote=checksum(&optional(&book,"driveContentChecksum")?);
 if !length_is_ready(book.clone())?||!truthy(&read(&book,"driveFileId")?)||!safe_integer(&f(book_bytes(&book)?))||book_bytes(&book)?<0.0{return Ok(null());}
 if truthy(&read(&book,"contentDriveChecksum")?)&&checksum(&read(&book,"contentDriveChecksum")?)!=remote{return Ok(null());}
 let md5=if truthy(&read(&book,"content")?)&&!truthy(&checksum(&read(&book,"contentDriveChecksum")?)){null()}else{remote};
 Ok(obj(&[("schemaVersion",&f(1.0)),("driveFileId",&read(&book,"driveFileId")?),("md5Checksum",&md5),("byteLength",&f(book_bytes(&book)?)),
  ("wordCount",&read(&book,"wordCount")?),("wordCountVersion",&read(&book,"wordCountVersion")?),("wordCountComplete",&JsValue::TRUE)]))
}
#[wasm_bindgen]
pub fn length_normalize_drive_metadata(value:JsValue)->R<JsValue>{
 if optional(&value,"schemaVersion")?!=f(1.0)||!read(&value,"driveFileId")?.is_string()||!truthy(&read(&value,"driveFileId")?)
  ||!nullish(&read(&value,"md5Checksum")?)&&!truthy(&checksum(&read(&value,"md5Checksum")?))
  ||!safe_integer(&read(&value,"byteLength")?)||num(&read(&value,"byteLength")?)<0.0||!length_has_complete_count(value.clone())?{return Ok(null());}
 Ok(obj(&[("schemaVersion",&f(1.0)),("driveFileId",&read(&value,"driveFileId")?),("md5Checksum",&checksum(&read(&value,"md5Checksum")?)),
  ("byteLength",&read(&value,"byteLength")?),("wordCount",&read(&value,"wordCount")?),("wordCountVersion",&read(&value,"wordCountVersion")?),("wordCountComplete",&JsValue::TRUE)]))
}
#[wasm_bindgen]
pub fn length_count_from_drive(book:JsValue,value:JsValue)->R<JsValue>{
 let count=length_normalize_drive_metadata(value)?;
 if !truthy(&count)||!truthy(&read(&count,"md5Checksum")?)||length_is_ready(book.clone())?||read(&count,"driveFileId")?!=read(&book,"driveFileId")?
  ||read(&count,"md5Checksum")?!=checksum(&read(&book,"driveContentChecksum")?)||num(&read(&count,"byteLength")?)!=book_bytes(&book)?
  ||truthy(&read(&book,"content")?)&&checksum(&read(&book,"contentDriveChecksum")?)!=read(&count,"md5Checksum")?{return Ok(null());}
 let result=length_complete_count(read(&count,"wordCount")?);put(&result,"wordCountContentRevision",&or(read(&book,"contentRevision")?,null()));putb(&result,"lengthDirty",false);Ok(result)
}


#[wasm_bindgen]
pub fn length_clear_count()->JsValue{
 obj(&[("wordCount",&null()),("wordCountVersion",&null()),("wordCountComplete",&JsValue::FALSE),("wordCountContentRevision",&null()),("lengthSource",&null()),("estimatedPageCount",&null())])
}
#[wasm_bindgen]
pub fn length_new_revision()->R<JsValue>{
 let crypto=read(&global(),"crypto")?;
 let make_uuid=if nullish(&crypto){undef()}else{read(&crypto,"randomUUID")?};
 let uuid=if nullish(&make_uuid){undef()}else{wasm_bindgen::JsCast::unchecked_ref::<js_sys::Function>(&make_uuid).call0(&crypto)?};
 if truthy(&uuid){return Ok(uuid);}
 let now=method(&read(&global(),"Date")?,"now",&[])?;
 let random=method(&read(&global(),"Math")?,"random",&[])?;
 let time=method(&now,"toString",&[&f(36.0)])?;
 let random=method(&random,"toString",&[&f(36.0)])?;
 let suffix=method(&random,"slice",&[&f(2.0)])?;
 let out=js_sys::Array::new();out.push(&time);out.push(&s("-"));out.push(&suffix);Ok(out.join("").into())
}
