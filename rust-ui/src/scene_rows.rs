//! The entry arena's rows across layouts, a reorder's release and the room's epoch, formerly kept by
//! the host (scene-entry-frame.js `bind`, bookshelf-scene.js `reorderItems` and `roomEpochNow`,
//! 1.7.338): a layout's entries take their rows in one call, the offsets a reorder leaves are
//! written by the pose call itself, which also says whether the room's matrix is, bit for bit, the
//! one of the previous frame. (Plain comments on the exports: a doc comment is copied into the
//! generated bindings.)
use wasm_bindgen::prelude::*;
use crate::scene_view::RustScene;
use super::{RustSceneEntryFrame,STATE,HIT_OUTPUT,FRESH,HIT_FRESH};

#[wasm_bindgen]
impl RustSceneEntryFrame{
 // A layout's entries take the arena's rows in their new order: `rows` is each entry's former
 // row, or a negative number for a new one, which starts from zeros. `reset` clears every
 // landing and preview, as a committed layout does. Each row is marked as not yet held by the
 // host. The other arenas keep their numbers where they were, as a resize does, but the hit
 // targets, which follow their rows. A reorder's
 // items follow their entries, and the ones of entries that left are dropped.
 pub fn rebind(&mut self,rows:&[i32],reset:bool){
  let held=std::mem::take(&mut self.state);
  self.state=vec![0.0;rows.len()*STATE];
  for (row,&from) in self.state.chunks_exact_mut(STATE).zip(rows){
   if let Some(old)=held.chunks_exact(STATE).nth(from as usize){row.copy_from_slice(old);}
   if reset{row[9..21].fill(0.0);}
   row[FRESH]=1.0;row[HIT_FRESH]=1.0;
  }
  // Each row's hit target follows it (`scene_rects.rs`); the other arenas keep their numbers.
  // (Most layouts keep every entry in its row: only a new one's target is cleared then.)
  if rows.iter().enumerate().all(|(index,&from)|from<0||from as usize==index){
   self.resize(rows.len());
   for (target,&from) in self.hit_output.chunks_exact_mut(HIT_OUTPUT).zip(rows){if from<0{target.fill(0.0);}}
  }else{
   let mut targets=Vec::with_capacity(rows.len()*HIT_OUTPUT);
   for &from in rows{
    targets.extend_from_slice(self.hit_output.chunks_exact(HIT_OUTPUT).nth(from as usize).unwrap_or(&[0.0;HIT_OUTPUT]));
   }
   self.hit_output=targets;
   self.resize(rows.len());
  }
  let mut kept=0;
  for at in (0..self.reorder.len()).step_by(3){
   if let Some(to)=rows.iter().position(|&from|f64::from(from)==self.reorder[at]){
    self.reorder[kept]=to as f64;self.reorder[kept+1]=self.reorder[at+1];self.reorder[kept+2]=self.reorder[at+2];kept+=3;
   }
  }
  self.reorder.truncate(kept);
 }
 // A reorder begins (with `RustScene#beginReorder`): `[row, x, y]` for each entry that eases
 // from its former place.
 pub fn reorder(&mut self,items:Vec<f64>){self.reorder=items;}
}
impl RustSceneEntryFrame{
 /// A frame of a reorder: what the frame's first step left of each item's offset
 /// (`RustScene#beginFrame`) enters its row; the items go when the reorder has ended.
 pub(super) fn ease_reorder(&mut self,scene:&RustScene){
  if self.reorder.is_empty(){return;}
  let left=scene.reorder_left();
  for item in self.reorder.chunks_exact(3){
   let at=item[0] as usize*STATE+21;
   if let Some(offset)=self.state.get_mut(at..at+2){offset[0]=item[1]*left;offset[1]=item[2]*left;}
  }
  if !scene.reordering(){self.reorder.clear();}
 }
 /// The room's epoch (after the census' nine numbers) advances whenever its world matrix is not,
 /// bit for bit, the one of the previous pose call; the number after it says whether it moved.
 pub(super) fn walk_room(&mut self){
  let mut same=true;
  for (held,now) in self.room_held.iter_mut().zip(self.room.iter()){
   if *held!=now.to_bits(){same=false;*held=now.to_bits();}
  }
  self.census[10]=f64::from(!same);
  if !same{self.census[9]+=1.0;}
 }
}
