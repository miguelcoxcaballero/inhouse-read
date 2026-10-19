//! Retained hit-test state: exclusions are packed once for the entire scene,
//! while each plant keeps its last projected pose and clip inputs in Rust.
use wasm_bindgen::prelude::*;
use super::foliage_clip;

#[wasm_bindgen]
pub struct RustFoliageFrame {
 input:Vec<f64>, previous:Vec<f64>, revision:u64,
}
#[wasm_bindgen]
impl RustFoliageFrame {
 #[wasm_bindgen(constructor)]
 pub fn new()->Self{Self{input:Vec::new(),previous:Vec::new(),revision:0}}
 pub fn resize(&mut self,count:usize){self.input.resize(count*4,0.0);}
 pub fn input_ptr(&self)->usize{self.input.as_ptr() as usize}
 pub fn memory(&self)->JsValue{wasm_bindgen::memory()}
 pub fn commit(&mut self){
  if self.input!=self.previous{
   self.previous.clone_from(&self.input);
   self.revision=self.revision.wrapping_add(1);
  }
 }
}

#[wasm_bindgen]
pub struct RustFoliageState {
 // Local matrix, furniture quaternion, projected left/right/top/bottom/width/height.
 input:Box<[f64;26]>, pose:[f64;20], reference:[f64;6], previous:[f64;10],
 exclusions:Vec<f64>, exclusions_have_nan:bool, projected:bool, clipped:bool, revision:u64,
}
#[wasm_bindgen]
impl RustFoliageState {
 #[wasm_bindgen(constructor)]
 pub fn new()->Self{Self{input:Box::new([0.0;26]),pose:[0.0;20],reference:[0.0;6],previous:[0.0;10],exclusions:Vec::new(),exclusions_have_nan:false,projected:false,clipped:false,revision:0}}
 pub fn input_ptr(&self)->usize{self.input.as_ptr() as usize}
 /// A zoom/pan alone changes the projected rectangle, not the leaf geometry.
 pub fn update_pose(&mut self,replaced:bool)->bool{
  if self.projected&&!replaced&&self.pose==self.input[..20]{return false;}
  self.pose.copy_from_slice(&self.input[..20]);
  self.reference.copy_from_slice(&self.input[20..26]);
  self.projected=true;true
 }
 /// Exactly the old clip result, including empty output on unchanged numbers.
 pub fn clip(&mut self,frame:&RustFoliageFrame)->String{
  if !self.projected{return String::new();}
  let rect=[self.input[20],self.input[22],self.input[24],self.input[25]];
  // An offscreen plant can miss several frames while an occluder moves and
  // returns. Revision alone must not invalidate its unchanged cached clip.
  let same_exclusions=self.revision==frame.revision&&!self.exclusions_have_nan||self.exclusions==frame.input;
  if self.clipped&&same_exclusions&&self.previous[..6]==self.reference&&self.previous[6..]==rect{
   self.revision=frame.revision;
   return String::new();
  }
  if self.revision!=frame.revision{
   self.exclusions.clone_from(&frame.input);
   self.exclusions_have_nan=self.exclusions.iter().any(|value|value.is_nan());
  }
  self.previous[..6].copy_from_slice(&self.reference);
  self.previous[6..].copy_from_slice(&rect);
  self.clipped=true;self.revision=frame.revision;
  foliage_clip(&self.reference,&rect,&frame.input)
 }
}
