//! The rectangles a plant's foliage does not take taps in: every other entry (not a plant) whose
//! model the room shows and whose button is neither away nor being dragged, in entry order. The
//! frontal view excludes each button's hit target and the turned view its projected rectangle
//! (an entry without a button has no hit target). The scene formerly gathered them entry by
//! entry in JavaScript and copied them into the foliage arena; here both arenas meet in one call.
//! The host marks a shown model in the hit input's bits (64) while it reads the hit surfaces.
use wasm_bindgen::prelude::*;
use super::{RustSceneEntryFrame,STATE,OUTPUT,HIT_INPUT,HIT_OUTPUT};
use super::super::foliage::RustFoliageFrame;

#[wasm_bindgen]
impl RustSceneEntryFrame{
 pub fn exclusions(&self,frame:&mut RustFoliageFrame,turned:bool){
  let areas=frame.areas();
  areas.clear();
  for (((row,out),hit),target) in self.state.chunks_exact(STATE).zip(self.output.chunks_exact(OUTPUT))
   .zip(self.hit_input.chunks_exact(HIT_INPUT)).zip(self.hit_output.chunks_exact(HIT_OUTPUT)){
   let (class,held)=(row[2] as u32,hit[0] as u32);
   if row[0]==1.0||held&64==0||class&3!=0{continue;}
   if turned{areas.extend_from_slice(&out[58..62]);}else if held&1!=0{areas.extend_from_slice(&target[1..5]);}
  }
  frame.commit();
 }
}
