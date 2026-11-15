//! The rectangles a plant's foliage does not take taps in: every other entry (not a plant) whose
//! model the room shows and whose button is neither away nor being dragged, in entry order. The
//! frontal view excludes each button's hit target and the turned view its projected rectangle
//! (an entry without a button has no hit target). The scene formerly gathered them entry by
//! entry in JavaScript and copied them into the foliage arena; here both arenas meet in one call.
//! The host marks a shown model in the hit input's bits (64) while it reads the hit surfaces.
use wasm_bindgen::prelude::*;
use super::{RustSceneEntryFrame,STATE,OUTPUT,HIT_INPUT,HIT_OUTPUT};
use super::super::foliage::{RustFoliageFrame,RustFoliageState};

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
 // A plant's pose for its foliage: its model's matrix (the sixteen numbers the host wrote after
 // the seven of `shown`) and the room's turn, as the host reads them from three, and the row's
 // projected rectangle, which is the arena's. Whether the leaves have to be projected again
 // (`update_pose`). The scene formerly copied all twenty-six numbers into the state's own view
 // through an adapter (foliage-frame.js `pose`, 1.8.1).
 #[wasm_bindgen(js_name=foliagePose)]
 pub fn foliage_pose(&self,state:&mut RustFoliageState,row:usize,x:f64,y:f64,z:f64,w:f64,replaced:bool)->bool{
  let Some(out)=self.output.chunks_exact(OUTPUT).nth(row) else{return false};
  let input=state.input();
  input[..16].copy_from_slice(&self.shown[7..23]);
  input[16..20].copy_from_slice(&[x,y,z,w]);
  input[20..26].copy_from_slice(&out[58..64]);
  state.update_pose(replaced)
 }
}
