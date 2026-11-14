//! The shelf refresh cleans every stored book's title and author each time it runs (to patch the records
//! that need it), and cleaning one title is about a hundred string calls into the engine. The answers for
//! plain strings are remembered here for the life of the page: both cleanings are pure functions of a
//! string (the title's fallback is not used by the refresh), so a remembered answer is the answer.
//! Anything that is not a string (a number, an object with its own conversion) is cleaned every time.
use std::cell::Cell;
use std::thread::LocalKey;
use js_sys::Map;
use wasm_bindgen::prelude::*;
use crate::book_title::{book_normalize_author,book_normalize_title};
type R<T>=Result<T,JsValue>;
/// Entries kept per memo; a library with more distinct strings starts again.
const ROOM:u32=4096;
struct Memo{known:Map,count:Cell<u32>}
impl Memo{fn new()->Memo{Memo{known:Map::new(),count:Cell::new(0)}}}
thread_local!{
 static TITLES:Memo=Memo::new();
 static AUTHORS:Memo=Memo::new();
}
fn remembered(memo:&'static LocalKey<Memo>,value:JsValue,clean:impl FnOnce(JsValue)->R<JsValue>)->R<JsValue>{
 memo.with(|memo|{
  // Both cleanings answer with a string, so `undefined` only ever means "not seen"; only strings are put in.
  let known=memo.known.get(&value);if !known.is_undefined(){return Ok(known);}
  if !value.is_string(){return clean(value);}
  let made=clean(value.clone())?;
  if memo.count.get()>=ROOM{memo.known.clear();memo.count.set(0);}
  memo.known.set(&value,&made);memo.count.set(memo.count.get()+1);Ok(made)
 })
}
/// `normalizeBookTitle(value)`.
pub fn title(value:JsValue)->R<JsValue>{remembered(&TITLES,value,|value|book_normalize_title(value,JsValue::UNDEFINED))}
/// `normalizeBookAuthor(value)`.
pub fn author(value:JsValue)->R<JsValue>{remembered(&AUTHORS,value,book_normalize_author)}
