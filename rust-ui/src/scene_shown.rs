//! The diagnostics that follow from the view's fit and from the bin, written to the canvas' and to
//! the bin's data by the call that computes them, and only when one differs from the text this
//! wrote last: a frame in which nothing they show moved compares their numbers and writes, formats
//! and looks up nothing. Nothing else writes these keys, except the four the finger-following
//! image also writes (`zoom`, `inspectionZoom`, `inspectionMoving`, `inspectionPan`): those stay
//! with the host, which is handed their texts; this only creates them, in their place among the
//! others, the first time.
use wasm_bindgen::prelude::*;
use js_sys::{Array,Object,Reflect};
use crate::scene_frame::trash_strings;
use crate::scene_view::RustScene;

const VIEW:[&str;16]=["shelfView","viewProgress","yaw","pitch","zoom","inspectionZoom","inspectionMoving","inspectionPan",
 "cabinetWidth","trashReserve","shelfType","shelfUnits","shelfDimensions","sceneFitHeight","floorVisible","fullCabinetInFrame"];
/// Where each of `VIEW` is taken from: one of the fit's fourteen texts, or (14, 15) the shelf's name and dimensions.
const VIEW_TEXT:[usize;16]=[0,1,2,3,4,5,6,7,8,9,14,10,15,11,12,13];
const BIN:[&str;17]=["trash3d","trashVisible","trashViewHidden","trashHover","hover","trashLocalPosition","trashLocalScale",
 "trashLocalRotation","trashFootY","cabinetFloorY","trashCameraInFrame","trashFootWorld","floorContactWorld","trashRadius","trashHeight",
 "trashDropProgress","dropProgress"];
/// What a view without a bin removes from the canvas, in the order the scene removed it.
const UNSHOWN:[usize;12]=[0,3,1,2,5,6,7,8,9,10,11,12];

#[derive(Default)]
pub(crate) struct Shown{
 canvas:Option<Object>,bin:Option<Object>,view_keys:Vec<JsValue>,bin_keys:Vec<JsValue>,
 /// The view: the numbers its texts were last formatted from, the texts as last written, the
 /// shelf's name and dimensions, and whether those two were given again.
 view_key:Vec<u64>,view:[Option<String>;16],labels:[String;2],labels_fresh:bool,
 /// The bin: the numbers and the texts last formatted from them, the four booleans last shown
 /// (16: any), each text as last written to the canvas and to the bin's node, whether a node or a
 /// removal asks for them again, whether the canvas holds any, and the drop's progress there.
 trash_key:Vec<u64>,trash_texts:[String;9],trash_flags:u32,on_canvas:[Option<String>;15],on_bin:[Option<String>;15],
 trash_fresh:bool,canvas_trash:bool,drop:[JsValue;3],
}
fn write(target:&Option<Object>,key:&JsValue,slot:&mut Option<String>,value:&str){
 if slot.as_deref()==Some(value){return;}
 *slot=Some(value.to_string());
 if let Some(target)=target{let _=Reflect::set(target,key,&JsValue::from_str(value));}
}
fn word(value:bool)->&'static str{if value{"true"}else{"false"}}

#[wasm_bindgen]
impl RustScene{
 /// The canvas' data attributes.
 pub fn shows(&mut self,canvas:Object){
  self.shown=Shown{canvas:Some(canvas),view_keys:VIEW.iter().map(|key|JsValue::from_str(key)).collect(),
   bin_keys:BIN.iter().map(|key|JsValue::from_str(key)).collect(),..Default::default()};
 }
 /// The bin's node changed (or left): its data attributes, none of them written yet.
 #[wasm_bindgen(js_name=binShows)]
 pub fn bin_shows(&mut self,bin:Option<Object>){
  self.shown.bin=bin;self.shown.on_bin=Default::default();self.shown.trash_fresh=true;
  self.shown.drop[1]=JsValue::UNDEFINED;self.shown.drop[2]=JsValue::UNDEFINED;
 }
 /// The shelf's name and its dimensions' text, shown among the view's diagnostics.
 pub fn labels(&mut self,shelf_type:String,dimensions:String){self.shown.labels=[shelf_type,dimensions];self.shown.labels_fresh=true;}
 /// `transform` for a frame: the same numbers into `out`, and its diagnostics on the canvas when
 /// a number they are formatted from moved. Then the host's four, `[zoom, inspectionZoom,
 /// inspectionMoving, inspectionPan]`, are returned (`undefined` otherwise: it keeps the ones it holds).
 #[wasm_bindgen(js_name=transformShown)]
 pub fn transform_shown(&mut self,trash:&[f64],rooftop:f64,floor_visible:bool,unit_count:f64,out:&mut [f64])->Option<Array>{
  let numbers=self.transform_numbers(trash,rooftop,floor_visible,unit_count,out);
  let same=self.shown.view_key.len()==numbers.len()&&self.shown.view_key.iter().zip(&numbers).all(|(held,value)|*held==value.to_bits());
  if same&&!self.shown.labels_fresh{return None;}
  let shown=&mut self.shown;
  if same{
   // Only the shelf's name or dimensions were given again.
   shown.labels_fresh=false;
   for (index,label) in [(10,0),(12,1)]{write(&shown.canvas,&shown.view_keys[index],&mut shown.view[index],&shown.labels[label]);}
   return None;
  }
  let texts=self.transform_strings(&numbers);
  let shown=&mut self.shown;
  shown.view_key.clear();shown.view_key.extend(numbers.iter().map(|value|value.to_bits()));shown.labels_fresh=false;
  for index in 0..16{
   let from=VIEW_TEXT[index];
   let text=if from<14{&texts[from]}else{&shown.labels[from-14]};
   // The host's four are only created here; it compares and writes them from then on.
   if (4..8).contains(&index){if shown.view[index].is_some(){continue;}write(&shown.canvas,&shown.view_keys[index],&mut shown.view[index],text);continue;}
   write(&shown.canvas,&shown.view_keys[index],&mut shown.view[index],text);
  }
  Some(Array::of4(&JsValue::from_str(&texts[4]),&JsValue::from_str(&texts[5]),&JsValue::from_str(&texts[6]),&JsValue::from_str(&texts[7])))
 }
 /// The bin's diagnostics, on its node and on the canvas, from `trashTexts`' packed row, whether
 /// its button shows and whether the camera frames it; what the view and the pointer say is known here.
 #[wasm_bindgen(js_name=trashShown)]
 pub fn trash_shown(&mut self,numbers:&[f64],visible:bool,in_frame:bool){
  if numbers.len()<17{return;}
  let (hidden,hover)=(self.trash_view_hidden(),self.trash_hover);
  let flags=16|u32::from(visible)|u32::from(hidden)<<1|u32::from(hover)<<2|u32::from(in_frame)<<3;
  let shown=&mut self.shown;
  let same=shown.trash_key.len()==numbers.len()&&shown.trash_key.iter().zip(numbers).all(|(held,value)|*held==value.to_bits());
  if same&&flags==shown.trash_flags&&!shown.trash_fresh{return;}
  if !same{
   shown.trash_key.clear();shown.trash_key.extend(numbers.iter().map(|value|value.to_bits()));
   shown.trash_texts=trash_strings(&numbers[0..3],numbers[3],&numbers[4..7],numbers[7],numbers[8],&numbers[9..12],&numbers[12..15],numbers[15],numbers[16]);
  }
  shown.trash_flags=flags;shown.trash_fresh=false;shown.canvas_trash=true;
  for (index,value) in [(0,true),(1,visible),(2,hidden),(3,hover),(4,hover)]{write(&shown.bin,&shown.bin_keys[index],&mut shown.on_bin[index],word(value));}
  for (index,value) in [(0,true),(3,hover),(1,visible),(2,hidden)]{write(&shown.canvas,&shown.bin_keys[index],&mut shown.on_canvas[index],word(value));}
  for index in 5..15{
   let text=match index{10=>word(in_frame),5..=9=>&shown.trash_texts[index-5],_=>&shown.trash_texts[index-6]};
   write(&shown.bin,&shown.bin_keys[index],&mut shown.on_bin[index],text);
   write(&shown.canvas,&shown.bin_keys[index],&mut shown.on_canvas[index],text);
  }
 }
 /// A scene without a bin shows none of its diagnostics on the canvas (its radius and height stay).
 #[wasm_bindgen(js_name=trashUnshown)]
 pub fn trash_unshown(&mut self){
  let shown=&mut self.shown;
  if !shown.canvas_trash{return;}
  shown.canvas_trash=false;shown.trash_fresh=true;
  for index in UNSHOWN{
   if shown.on_canvas[index].take().is_some(){if let Some(canvas)=&shown.canvas{let _=Reflect::delete_property(canvas,&shown.bin_keys[index]);}}
  }
 }
 /// A flight into the bin: its progress (the host's `toFixed(4)` text) on the canvas and, twice, on the bin's node.
 #[wasm_bindgen(js_name=dropShown)]
 pub fn drop_shown(&mut self,progress:&JsValue){
  let shown=&mut self.shown;
  for (slot,target,key) in [(1,&shown.bin,15),(2,&shown.bin,16),(0,&shown.canvas,15)]{
   if shown.drop[slot]==*progress{continue;}
   shown.drop[slot]=progress.clone();
   if let Some(target)=target{let _=Reflect::set(target,&shown.bin_keys[key],progress);}
  }
 }
 /// `setDrop`, and the guide's shelf, place and mount on the canvas when it changed.
 #[wasm_bindgen(js_name=showDrop)]
 pub fn show_drop(&mut self,present:bool,shelf:f64,x:f64,undershelf:bool,rows:u32)->Result<bool,JsValue>{
  if !self.set_drop(present,shelf,x,undershelf,rows){return Ok(false);}
  let Some(canvas)=&self.shown.canvas else{return Ok(true)};
  let empty=JsValue::from_str("");
  let texts=match self.drop_state()[..]{
   [shelf,x,under]=>[JsValue::from_f64(shelf),js_sys::Number::from(x).to_fixed(4)?.into(),if under!=0.0{JsValue::from_str("undershelf")}else{empty}],
   _=>[empty.clone(),empty.clone(),empty]};
  for (key,text) in ["dropShelf","dropX","dropMount"].iter().zip(&texts){Reflect::set(canvas,&JsValue::from_str(key),text)?;}
  Ok(true)
 }
 /// A cancelled flight took its progress from both: the next one writes it again.
 #[wasm_bindgen(js_name=dropUnshown)]
 pub fn drop_unshown(&mut self){self.shown.drop=Default::default();}
}
