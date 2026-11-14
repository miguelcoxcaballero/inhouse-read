//! What the host holds of every entry, taken once per frame: the host writes three numbers per
//! entry (columns 85-87 of the entry arena) and one call answers what the frame formerly asked
//! entry by entry in JavaScript: the diagnostics' counts (`scene_counts`, rebuilt only when a
//! number differs), the shadow casters' signature (`scene_casters`), whether a quality map is
//! still loading, whether a returning book is painted on the overlay or by the native layer,
//! whether anything flies, lands or previews, and whether a book is lifted or pressed. The
//! room's painted-away books (column 88) and the quality hold's deadline live here too.
use wasm_bindgen::prelude::*;
use crate::scene_view::RustScene;
use super::{RustSceneEntryFrame,STATE,HOSTED,PAINTED_AWAY};

/// Column 85's bits.
const MODEL:u32=1;const VISIBLE:u32=2;const PENDING:u32=4;const OVERVIEW:u32=8;const INSERTION:u32=16;
const DROP:u32=32;const OVERLAY:u32=64;const NATIVE:u32=128;const LOADING:u32=256;

#[wasm_bindgen]
impl RustSceneEntryFrame{
 /// Returns `counts changed | loading << 1 | overlay insertion << 2 | native insertion << 3 |
 /// busy << 4 | touched << 5`; the numbers are at `census_ptr`: the casters' signature, then
 /// `scene_counts`' eight.
 pub fn census(&mut self,trash_visible:bool)->u32{
  let count=self.state.len()/STATE;
  if self.counted.len()!=count*5{self.counted.clear();self.counted.resize(count*5,0.0);self.count_dirty=true;}
  let (mut summary,mut casters,mut changed)=(0u32,i32::from(trash_visible),self.count_dirty);
  for (row,counted) in self.state.chunks_exact(STATE).zip(self.counted.chunks_exact_mut(5)){
   let held=row[HOSTED] as u32;
   if held&LOADING!=0{summary|=2;}
   if held&OVERLAY!=0{summary|=4;}
   if held&NATIVE!=0{summary|=8;}
   if held&(INSERTION|DROP)!=0||row[9]!=0.0||row[20]!=0.0{summary|=16;}
   if (row[5]!=0.0&&!row[5].is_nan())||(row[2] as u32)&8!=0{summary|=32;}
   if held&VISIBLE!=0{casters=super::super::caster(casters,row[HOSTED+2]);}
   let next=[row[0],f64::from(held&VISIBLE!=0),f64::from(held&PENDING!=0),f64::from(held&OVERVIEW!=0),row[HOSTED+1]];
   for (slot,value) in counted.iter_mut().zip(next){if slot.to_bits()!=value.to_bits(){*slot=value;changed=true;}}
  }
  self.loading=summary&2!=0;
  self.census[0]=f64::from(casters);
  if changed{self.count_dirty=false;self.resolutions=super::super::scene_counts(&self.counted,&mut self.census[1..]);summary|=1;}
  summary
 }
 pub fn census_ptr(&self)->usize{self.census.as_ptr() as usize}
 /// The books' texture resolutions as the last census counted them (JSON).
 pub fn resolutions(&self)->String{self.resolutions.clone()}
 /// The room was painted: the books it was painted without (away, their model hidden, neither
 /// returning nor flying to the bin) are remembered until the next painted room.
 pub fn painted(&mut self){
  for row in self.state.chunks_exact_mut(STATE){
   let held=row[HOSTED] as u32;
   row[PAINTED_AWAY]=f64::from((row[2] as u32)&1!=0&&held&(MODEL|VISIBLE|INSERTION|DROP)==MODEL);
  }
 }
 /// `scene_quality_hold` over the last census.
 pub fn quality_hold(&mut self,scene:&RustScene,eligible:bool,now:f64)->f64{
  crate::scene_quality::hold(&mut self.paint_deadline,eligible,self.loading,scene,now)
 }
}
