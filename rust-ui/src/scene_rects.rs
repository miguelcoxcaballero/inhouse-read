//! Each button's hit and tap rectangles, asked from the arena that holds them, formerly copied
//! into two objects per entry in every frame that moved them (bookshelf-scene.js `hitRect` and
//! `tapRect`, 1.7.339) and walked entry by entry for a tap that missed every mesh and for a
//! reorder's release, and a button's state as the DOM gives it, formerly parsed in up to four
//! calls and kept on the entry until its frame. Column 75 says whether `hits` has ever taken the row's target; a layout
//! moves the row and its target together. (Plain comments on the exports: a doc comment is
//! copied into the generated bindings.)
use wasm_bindgen::prelude::*;
use super::{RustSceneEntryFrame,STATE,HIT_OUTPUT,HOSTED};

pub(super) const TAKEN:usize=75;

#[wasm_bindgen]
impl RustSceneEntryFrame{
 // A button's state as the DOM gives it, when one of the five differs from the last read: its
 // flags (`scene_class_flags`) and drag offsets (`scene_drag_offset`) enter its row and its
 // joined text (`scene_state_text`) is returned. An empty drag variable is `parseFloat('') || 0`,
 // and a plain decimal number of pixels is parsed here (`plain_pixels`).
 #[wasm_bindgen(js_name=domState)]
 pub fn dom_state(&mut self,row:usize,classes:&str,drag_x:&str,drag_y:&str,disabled:bool,pointer_events:&str)->String{
  let bits=crate::scene_entries::scene_class_flags(classes);
  let offset=|text:&str|if text.is_empty(){0.0}else{plain_pixels(text).unwrap_or_else(||crate::scene_entries::scene_drag_offset(text))};
  if let Some(state)=self.state.chunks_exact_mut(STATE).nth(row){state[2]=f64::from(bits);state[3]=offset(drag_x);state[4]=offset(drag_y);}
  crate::scene_entries::scene_state_text(bits,drag_x,drag_y,disabled,pointer_events)
 }
 // The entry whose padded tap rectangle holds the point, nearest centre first (`scene_nearest_tap`
 // over rectangles moved by the stage's corner), or -1: among the entries that are not plants,
 // whose target was taken, whose model the room shows and that are neither away, dragged nor on
 // their way to the bin. `skip` is an entry the host refused (its button is gone or its live class
 // says away) and that is left out until a call with a negative one.
 #[wasm_bindgen(js_name=tapNear)]
 pub fn tap_near(&mut self,x:f64,y:f64,left:f64,top:f64,skip:i32)->i32{
  if skip<0{self.refused.clear();}else{self.refused.push(skip as usize);}
  let (mut best,mut nearest)=(-1i32,f64::INFINITY);
  for (index,(row,hit)) in self.state.chunks_exact(STATE).zip(self.hit_output.chunks_exact(HIT_OUTPUT)).enumerate(){
   let held=row[HOSTED] as u32;
   if row[TAKEN]==0.0||row[0]==1.0||held&2==0||held&32!=0||(row[2] as u32)&3!=0||self.refused.contains(&index){continue;}
   let r=[hit[8]+left,hit[9]+top,hit[10],hit[11]];
   if x<r[0]||x>r[0]+r[2]||y<r[1]||y>r[1]+r[3]{continue;}
   let distance=js_sys::Math::pow(x-r[0]-r[2]/2.0,2.0)+js_sys::Math::pow((y-r[1]-r[3]/2.0)*0.25,2.0);
   if distance<nearest{nearest=distance;best=index as i32;}
  }
  best
 }
 // A reorder's release begins: `olds` holds, per entry, where its button was (`left, top`), 1 when
 // it was anywhere (+2: it is the dragged one, +4: the entry has a projected rectangle), and that
 // rectangle's corner. An entry eases from there to its tap rectangle (a plant: its hit
 // rectangle; one whose target was never taken: its projected rectangle) when the two are more
 // than a pixel apart; the dragged one, when it eases and is lifted, lands from its lift.
 #[wasm_bindgen(js_name=reorderFrom)]
 pub fn reorder_from(&mut self,olds:&[f64],left:f64,top:f64,started:f64){
  self.reorder.clear();
  let mut dragged=None;
  for (index,((row,hit),old)) in self.state.chunks_exact(STATE).zip(self.hit_output.chunks_exact(HIT_OUTPUT)).zip(olds.chunks_exact(5)).enumerate(){
   let known=old[2] as u32;
   let target=if row[TAKEN]!=0.0{if row[0]==1.0{[hit[1],hit[3]]}else{[hit[8],hit[9]]}}else if known&4!=0{[old[3],old[4]]}else{continue};
   if known&1==0{continue;}
   let (x,y)=(old[0]-(target[0]+left),old[1]-(target[1]+top));
   if x.abs()+y.abs()>1.0{
    self.reorder.extend_from_slice(&[index as f64,x,y]);
    if known&2!=0&&dragged.is_none(){dragged=Some(index);}
   }
  }
  if let Some(row)=dragged.and_then(|index|self.state.chunks_exact_mut(STATE).nth(index)){
   if row[5]>0.0{row[9]=1.0;row[10]=row[5];row[11]=started;row[12]=520.0;}
  }
 }
}

/// `parseFloat(text) || 0` of a plain decimal number of pixels (`-12.5px`: an optional minus,
/// figures, optionally a point and figures, then `px`), which a drag writes on every move: both
/// parsers round such a number to the nearest double. Anything else is the host's to parse.
fn plain_pixels(text:&str)->Option<f64>{
 let number=text.strip_suffix("px")?;
 let unsigned=number.strip_prefix('-').unwrap_or(number);
 let (whole,fraction)=unsigned.split_once('.').unwrap_or((unsigned,"0"));
 if whole.is_empty()||fraction.is_empty()||!whole.bytes().chain(fraction.bytes()).all(|byte|byte.is_ascii_digit()){return None;}
 let value:f64=number.parse().ok()?;
 Some(if value==0.0{0.0}else{value})
}
