//! The page a lifted book will open on, prepared ahead of the tap: one page at a time, kept with the
//! conditions it was made under and handed out only while every one of them still holds.
//!
//! The cache is a plain record the application's state holds (`state.preparedPage`: generation, entry,
//! lastBookId, lastDiscard), made the first time a flow asks for it. The page owns it, pixels included;
//! nothing of it lives in this module, so there is nothing to adopt, free or leak. `begin` hands out a
//! ticket before the work starts; any invalidation made while the work runs makes `store` refuse the
//! result, so a slow snapshot can never outlive the event that made it wrong.
use wasm_bindgen::prelude::*;
use js_sys::{Object,Reflect,JSON};
use crate::host::{read,set};
type R<T>=Result<T,JsValue>;
#[wasm_bindgen]
extern "C"{
 #[wasm_bindgen(js_name=Object,catch)] fn boxed(value:&JsValue)->Result<JsValue,JsValue>;
 #[wasm_bindgen(js_name=Number,catch)] fn number(value:&JsValue)->Result<f64,JsValue>;
}
// A new generation that holds no page, in one visit to the record (a resize invalidates on every event):
// whatever was held is discarded for `why`, and the new generation comes back.
#[wasm_bindgen(inline_js="export function ihr_page_drop(p,w){const g=p.generation;p.generation=(typeof g==='number'?g:0)+1;if(p.entry)p.lastDiscard=w;p.entry=null;return p.generation}")]
extern "C"{
 #[wasm_bindgen(catch)] fn ihr_page_drop(pages:&JsValue,why:&JsValue)->Result<f64,JsValue>;
}
#[inline(never)]
fn prop(value:&JsValue,key:&str)->R<JsValue>{if value.is_null()||value.is_undefined(){Ok(JsValue::UNDEFINED)}else{Reflect::get(&boxed(value)?,&key.into())}}
fn nullish(value:JsValue)->JsValue{if value.is_null()||value.is_undefined(){JsValue::NULL}else{value}}
#[inline(never)]
fn json_same(a:JsValue,b:JsValue)->R<bool>{Ok(JSON::stringify(&nullish(a))?==JSON::stringify(&nullish(b))?)}
#[inline(never)]
fn numeric(value:&JsValue)->R<f64>{let n=number(value)?;Ok(if n==0.0||n.is_nan(){0.0}else{n})}
fn finite(value:JsValue)->Option<f64>{value.as_f64().filter(|n|n.is_finite())}
fn reason(value:&str)->JsValue{value.into()}
const EDGES:[&str;4]=["left","top","width","height"];
/// The four edges of a box when every one is a finite number.
#[inline(never)]
fn edges(of:&JsValue)->R<Option<[f64;4]>>{
 let mut found=[0.0;4];
 for (at,edge) in EDGES.iter().enumerate(){match finite(prop(of,edge)?){Some(value)=>found[at]=if value==0.0{0.0}else{value},None=>return Ok(None)}}
 Ok(Some(found))
}
/// The first condition that differs between the key a page was prepared under and the key of the moment it
/// is wanted, or null. Preparation is strict about position; only the consumption of a completed page lets
/// its whole viewport translate (`translation`).
#[inline(never)]
pub fn mismatch(a:&JsValue,b:&JsValue,translation:bool)->R<JsValue>{
 if !a.is_truthy()||!b.is_truthy(){return Ok(reason("missing"))}
 for (key,why) in [("bookId","book"),("epoch","engine")]{if prop(a,key)?!=prop(b,key)?{return Ok(reason(why))}}
 if !json_same(prop(a,"locator")?,prop(b,"locator")?)?{return Ok(reason("saved-position"))}
 if !((numeric(&prop(a,"fraction")?)?-numeric(&prop(b,"fraction")?)?).abs()<=1e-9){return Ok(reason("saved-position"))}
 if !json_same(prop(a,"location")?,prop(b,"location")?)?{return Ok(reason("reader-position"))}
 let (Some(held),Some(wanted))=(edges(&prop(a,"viewport")?)?,edges(&prop(b,"viewport")?)?)else{return Ok(reason("viewport"))};
 for edge in if translation{2}else{0}..4{if !((held[edge]-wanted[edge]).abs()<=0.5){return Ok(reason("viewport"))}}
 for (key,why) in [("pixelRatio","pixel-ratio"),("preferences","preferences"),("theme","theme"),("filter","filter")]{if prop(a,key)?!=prop(b,key)?{return Ok(reason(why))}}
 Ok(JsValue::NULL)
}
#[inline(never)]
fn record(fields:&[(&str,JsValue)])->R<JsValue>{let made=Object::new();for (key,value) in fields{Reflect::set(&made,&(*key).into(),value)?;}Ok(made.into())}
/// An empty cache.
#[inline(never)]
pub fn fresh()->R<JsValue>{record(&[("generation",0.0.into()),("entry",JsValue::NULL),("lastBookId",JsValue::NULL),("lastDiscard",JsValue::NULL)])}
/// The application's cache (`host.state.preparedPage`).
#[inline(never)]
pub fn of(host:&JsValue)->R<JsValue>{
 let state=read(host,"state")?;let pages=read(&state,"preparedPage")?;
 if !pages.is_null()&&!pages.is_undefined(){return Ok(pages)}
 let pages=fresh()?;set(&state,"preparedPage",&pages)?;Ok(pages)
}
fn generation(pages:&JsValue)->R<f64>{Ok(read(pages,"generation")?.as_f64().unwrap_or(0.0))}
#[inline(never)]
pub fn begin(pages:&JsValue,book:&JsValue)->R<JsValue>{
 let now=ihr_page_drop(pages,&reason("new-work"))?;set(pages,"lastBookId",book)?;
 record(&[("bookId",book.clone()),("generation",now.into())])
}
#[inline(never)]
pub fn is_current(pages:&JsValue,ticket:&JsValue)->R<bool>{Ok(ticket.is_truthy()&&prop(ticket,"generation")?==JsValue::from_f64(generation(pages)?))}
#[inline(never)]
pub fn store(pages:&JsValue,ticket:&JsValue,key:&JsValue,snapshot:&JsValue)->R<bool>{
 if !is_current(pages,ticket)?||!snapshot.is_truthy()||prop(ticket,"bookId")?!=prop(key,"bookId")?{return Ok(false)}
 set(pages,"entry",&record(&[("key",key.clone()),("snapshot",snapshot.clone())])?)?;Ok(true)
}
/// Consume a matching page, rebasing a rigid translation; otherwise drop it.
#[inline(never)]
pub fn take(pages:&JsValue,key:&JsValue)->R<JsValue>{
 let held=read(pages,"entry")?;set(pages,"entry",&JsValue::NULL)?;if !held.is_truthy(){return Ok(JsValue::NULL)}
 let held_key=prop(&held,"key")?;let why=mismatch(&held_key,key,true)?;
 if why.is_truthy(){set(pages,"lastDiscard",&why)?;return Ok(JsValue::NULL)}
 let snapshot=prop(&held,"snapshot")?;let bounds=prop(&snapshot,"displayBounds")?;
 let (to,from)=(prop(key,"viewport")?,prop(&held_key,"viewport")?);
 let (dx,dy)=(numeric(&prop(&to,"left")?)?-numeric(&prop(&from,"left")?)?,numeric(&prop(&to,"top")?)?-numeric(&prop(&from,"top")?)?);
 let landing=match if bounds.is_truthy(){edges(&bounds)?}else{None}{
  Some([left,top,width,height]) if width>0.0&&height>0.0&&(left+dx).is_finite()&&(top+dy).is_finite()=>(left+dx,top+dy),
  _=>{set(pages,"lastDiscard",&reason("viewport"))?;return Ok(JsValue::NULL)}
 };
 // A rigid translation changes where the page lands, not its laid-out pixels: the warmed snapshot keeps
 // its identity (and its GPU textures); only its destination is rebased, as `{...bounds, left, top}`.
 if dx!=0.0||dy!=0.0{
  let next=Object::assign(&Object::new(),&Object::from(boxed(&bounds)?));
  Reflect::set(&next,&"left".into(),&landing.0.into())?;Reflect::set(&next,&"top".into(),&landing.1.into())?;
  if !Reflect::set(&snapshot,&"displayBounds".into(),&next)?{return Err(js_sys::TypeError::new("Cannot assign to read only property 'displayBounds' of object").into())}
 }
 Ok(snapshot)
}
#[inline(never)]
pub fn has(pages:&JsValue,book:&JsValue)->R<bool>{Ok(prop(&prop(&read(pages,"entry")?,"key")?,"bookId")?==*book)}
#[inline(never)]
pub fn peek(pages:&JsValue)->R<JsValue>{Ok(nullish(prop(&read(pages,"entry")?,"snapshot")?))}
/// Everything: the engine changed, the window resized, the reader closed...
#[inline(never)]
pub fn invalidate(pages:&JsValue,why:&JsValue)->R<()>{ihr_page_drop(pages,why).map(|_|())}
/// Only when `book` owns the page (or the work in flight): deletion, a book's own change.
#[inline(never)]
pub fn invalidate_book(pages:&JsValue,book:&JsValue,why:&JsValue)->R<()>{
 if has(pages,book)?||read(pages,"lastBookId")?==*book{invalidate(pages,why)?}Ok(())
}
/// One operation of the cache or of the stage gate on a record somebody else holds: what the differential
/// tests against the frozen JavaScript drive. The application's flows call the functions above.
#[wasm_bindgen]
pub fn prepared_page(op:&str,target:JsValue,a:JsValue,b:JsValue,c:JsValue)->R<JsValue>{
 Ok(match op{
  "new"=>fresh()?,
  "begin"=>begin(&target,&a)?,
  "isCurrent"=>is_current(&target,&a)?.into(),
  "store"=>store(&target,&a,&b,&c)?.into(),
  "take"=>take(&target,&a)?,
  "has"=>has(&target,&a)?.into(),
  "peek"=>peek(&target)?,
  "invalidate"=>{invalidate(&target,&a)?;JsValue::UNDEFINED}
  "invalidateBook"=>{invalidate_book(&target,&a,&b)?;JsValue::UNDEFINED}
  "mismatch"=>mismatch(&target,&a,b.is_truthy())?,
  "gate"=>crate::stage_gate::open(target,a)?,
  "wait"=>crate::stage_gate::wait(&target)?.into(),
  "release"=>{crate::stage_gate::release(&target,&a)?;JsValue::UNDEFINED}
  _=>return Err(js_sys::TypeError::new("Unknown prepared-page operation").into()),
 })
}
