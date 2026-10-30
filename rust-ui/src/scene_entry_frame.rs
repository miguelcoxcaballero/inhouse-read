//! Every entry's pose in one call per frame: the shared-room motion sample (local snapshot,
//! remote preview, checkpoint bridge), the pose matrix, its place in the room and what its
//! projection says; then, in a second call once the host has its models, every semantic
//! button's hit target and the style writes it needs. The host writes each entry's inputs into
//! this arena once and reads the results from it; three objects and the DOM stay in JavaScript.
//! The arithmetic is three's `Matrix4#compose` and `#multiplyMatrices` (jsmath) and the scene's
//! own projection and hit, in the order the former per-entry calls ran, so every number is the same.
use wasm_bindgen::prelude::*;
use crate::jsmath::Mat4;
use crate::room_motion::{RustRoomMotion,RustRoomTransition};
use crate::scene_view::RustScene;
use super::motion::RustSceneMotionFrame;
use super::projection::RustSceneProjectionFrame;

/// Per entry in: pose position, quaternion `[x, y, z, w]` and scale; the projection's kind,
/// flags, drop, insertion, model, overview, drop complete and overlay; the slot box.
const INPUT:usize=22;
/// Per entry out: the motion flags; the motion sample's 25 numbers (only the slots its flags
/// name); the final pose matrix; that matrix in the room; the projection's rectangle (7),
/// visible, quality applies, overview, resolution and model visible.
const OUTPUT:usize=70;
/// Per entry hit in: bits (1 has a button, 2 under-shelf, 4 disabled or inert, 8 reset its
/// written styles, 16 fresh cover, 32 use the placed matrix), the button's flags, the hit
/// surface's box and its world matrix.
const HIT_INPUT:usize=24;
/// Per entry hit out: the style dirty bits, the hit rectangle (7), the tap rectangle (4), the
/// z-index, the cover's left and top, whether it shows and whether it takes pointer events.
const HIT_OUTPUT:usize=17;

#[wasm_bindgen]
pub struct RustSceneEntryFrame{input:Vec<f64>,output:Vec<f64>,hit_input:Vec<f64>,hit_output:Vec<f64>,room:Box<[f64;16]>}
#[wasm_bindgen]
impl RustSceneEntryFrame{
 #[wasm_bindgen(constructor)]
 pub fn new()->Self{Self{input:Vec::new(),output:Vec::new(),hit_input:Vec::new(),hit_output:Vec::new(),room:Box::new([0.0;16])}}
 pub fn resize(&mut self,count:usize){
  self.input.resize(count*INPUT,0.0);self.output.resize(count*OUTPUT,0.0);
  self.hit_input.resize(count*HIT_INPUT,0.0);self.hit_output.resize(count*HIT_OUTPUT,0.0);
 }
 pub fn memory(&self)->JsValue{wasm_bindgen::memory()}
 pub fn input_ptr(&self)->usize{self.input.as_ptr() as usize}
 pub fn output_ptr(&self)->usize{self.output.as_ptr() as usize}
 pub fn hit_input_ptr(&self)->usize{self.hit_input.as_ptr() as usize}
 pub fn hit_output_ptr(&self)->usize{self.hit_output.as_ptr() as usize}
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
 /// Every button's hit target, after `step` and once the host has updated the models' hit
 /// surfaces: the former per-entry `RustSceneProjectionFrame#hit`, with its retained style
 /// history, for each entry whose record says it has a button, in order. The rectangle is
 /// the one `step` projected.
 pub fn hits(&mut self,projection:&mut RustSceneProjectionFrame,scene:&RustScene){
  let entries=self.hit_input.chunks_exact(HIT_INPUT).zip(self.hit_output.chunks_exact_mut(HIT_OUTPUT))
   .zip(self.input.chunks_exact(INPUT).zip(self.output.chunks_exact(OUTPUT)));
  for (index,((hit,out),(input,output))) in entries.enumerate(){
   let bits=hit[0] as u32;
   if bits&1==0{continue;}
   let mut io=[0.0;49];
   io[0]=input[8];io[1]=f64::from(bits&2!=0);io[2]=hit[1];io[3]=f64::from(bits&4!=0);
   io[4..11].copy_from_slice(&output[58..65]);io[11..17].copy_from_slice(&hit[2..8]);
   io[17..33].copy_from_slice(if bits&32!=0{&output[42..58]}else{&hit[8..24]});
   let dirty=projection.hit_io(scene,index,bits&8!=0,bits&16!=0,&mut io);
   out[0]=f64::from(dirty);out[1..17].copy_from_slice(&io[33..49]);
  }
 }
}
