//! The physical phases of opening a book into the reader and closing it back to the shelf, in ms
//! (moved from src/js/reader-book-timing.js; the frozen original is tests/unit/helpers/reference-reader-book-timing.js).
//! GPU and fallback transitions use the same schedule; with reduced motion every phase lasts 1 ms.
use wasm_bindgen::prelude::*;
use js_sys::Object;
use super::util::obj;
const OPENING:[(&str,f64);4]=[("cover",480.0),("bookmark",240.0),("zoom",520.0),("handoff",140.0)];
const CLOSING:[(&str,f64);4]=[("zoom",460.0),("bookmark",260.0),("cover",440.0),("flight",560.0)];
fn phases(table:&[(&str,f64);4],reduced:bool)->JsValue{
 let values=table.map(|(_,ms)|JsValue::from_f64(if reduced{1.0}else{ms}));
 let entries:Vec<(&str,&JsValue)>=table.iter().zip(values.iter()).map(|((key,_),value)|(*key,value)).collect();
 Object::freeze(&obj(&entries).into()).into()
}
pub(super) fn opening(reduced:bool)->JsValue{phases(&OPENING,reduced)}
pub(super) fn closing(reduced:bool)->JsValue{phases(&CLOSING,reduced)}
/// Both schedules, the shape the JavaScript table had, for the tests.
#[wasm_bindgen]
pub fn reader_book_timing(reduced:bool)->JsValue{
 Object::freeze(&obj(&[("opening",&opening(reduced)),("closing",&closing(reduced))]).into()).into()
}
