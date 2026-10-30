//! Every entry's pose in one call per frame: the shared-room motion sample (local snapshot,
//! remote preview, checkpoint bridge), the pose matrix, its place in the room and what its
//! projection says. The host writes each entry's pose and projection inputs into this arena
//! once and reads the results from it; three objects and the DOM stay in JavaScript. The
//! arithmetic is three's `Matrix4#compose` and `#multiplyMatrices` (jsmath) and the scene's own
//! projection, in the order the former per-entry calls ran, so every number is the same.
use wasm_bindgen::prelude::*;
use crate::jsmath::Mat4;
use crate::room_motion::{RustRoomMotion,RustRoomTransition};
use crate::scene_view::RustScene;
use super::motion::RustSceneMotionFrame;

/// Per entry in: pose position, quaternion `[x, y, z, w]` and scale; the projection's kind,
/// flags, drop, insertion, model, overview, drop complete and overlay; the slot box.
const INPUT:usize=22;
/// Per entry out: the motion flags; the motion sample's 25 numbers (only the slots its flags
/// name); the final pose matrix; that matrix in the room; the projection's rectangle (7),
/// visible, quality applies, overview, resolution and model visible.
const OUTPUT:usize=70;

#[wasm_bindgen]
pub struct RustSceneEntryFrame{input:Vec<f64>,output:Vec<f64>,room:Box<[f64;16]>}
#[wasm_bindgen]
impl RustSceneEntryFrame{
 #[wasm_bindgen(constructor)]
 pub fn new()->Self{Self{input:Vec::new(),output:Vec::new(),room:Box::new([0.0;16])}}
 pub fn resize(&mut self,count:usize){self.input.resize(count*INPUT,0.0);self.output.resize(count*OUTPUT,0.0);}
 pub fn memory(&self)->JsValue{wasm_bindgen::memory()}
 pub fn input_ptr(&self)->usize{self.input.as_ptr() as usize}
 pub fn output_ptr(&self)->usize{self.output.as_ptr() as usize}
 /// The room's world matrix (`furniture.matrixWorld.elements`).
 pub fn room_ptr(&self)->usize{self.room.as_ptr() as usize}
 /// One frame for every entry, in order. `motion_frame` holds the entries' shared keys and bays
 /// (its `prepare` ran this frame) and `scene` the frame's projection state (`beginEntries`).
 pub fn step(&mut self,motion_frame:&mut RustSceneMotionFrame,scene:&RustScene,motion:&RustRoomMotion,transition:&mut RustRoomTransition,now:f64,arranging:bool){
  let room=Mat4(*self.room);
  for (index,(input,output)) in self.input.chunks_exact(INPUT).zip(self.output.chunks_exact_mut(OUTPUT)).enumerate(){
   let mut pose=[0.0;8];pose.copy_from_slice(&input[..8]);
   let mut live=[0.0;25];
   let flags=motion_frame.sample_pose(index,pose,motion,transition,now,arranging,&mut live);
   // The host applies the remote preview, then the checkpoint bridge: the last one stands.
   if flags&2!=0{pose.copy_from_slice(&live[9..17]);}
   if flags&4!=0{pose.copy_from_slice(&live[17..25]);}
   let matrix=Mat4::compose([pose[0],pose[1],pose[2]],[pose[3],pose[4],pose[5],pose[6]],[pose[7],pose[7],pose[7]]);
   let placed=Mat4::multiply(&room,&matrix);
   let mut io=[0.0;44];
   io[..14].copy_from_slice(&input[8..22]);io[14..30].copy_from_slice(&placed.0);
   scene.project_entry(&mut io);
   output[0]=f64::from(flags);output[1..26].copy_from_slice(&live);
   output[26..42].copy_from_slice(&matrix.0);output[42..58].copy_from_slice(&placed.0);
   output[58..70].copy_from_slice(&io[30..42]);
  }
 }
}
