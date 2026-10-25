//! The scene's pixel/physical-coordinate bridge. Transport and interpolation
//! remain in their existing room controllers; this arena owns only presentation.
use wasm_bindgen::prelude::*;
use js_sys::Array;
use crate::room_motion::{RustRoomMotion,RustRoomTransition};

#[wasm_bindgen]
pub struct RustSceneMotionFrame {
 keys:Vec<Option<String>>, shelves:Vec<f64>, rows:Vec<f64>,
 input:Box<[f64;10]>, output:Box<[f64;25]>,
}
#[wasm_bindgen]
impl RustSceneMotionFrame {
 #[wasm_bindgen(constructor)]
 pub fn new()->Self{Self{keys:Vec::new(),shelves:Vec::new(),rows:Vec::new(),input:Box::new([0.0;10]),output:Box::new([0.0;25])}}
 pub fn register(&mut self,keys:&Array,shelves:&[f64]){
  self.keys=keys.iter().map(|key|key.as_string().filter(|key|!key.is_empty())).collect();
  self.shelves.clear();self.shelves.extend_from_slice(shelves);
 }
 pub fn resize_rows(&mut self,count:usize){self.rows.resize(count*3,0.0);}
 pub fn memory(&self)->JsValue{wasm_bindgen::memory()}
 pub fn input_ptr(&self)->usize{self.input.as_ptr() as usize}
 pub fn output_ptr(&self)->usize{self.output.as_ptr() as usize}
 pub fn rows_ptr(&self)->usize{self.rows.as_ptr() as usize}
 /// Input: pixel position, quaternion, scale, cabinet width and pixels/metre.
 /// Output: nine local physical fields, eight remote pixel fields and eight
 /// checkpoint pixel fields. Flags preserve the host's original update order.
 pub fn sample(&mut self,index:usize,motion:&RustRoomMotion,transition:&mut RustRoomTransition,now:f64,arranging:bool)->u32{
  let Some(key)=self.keys.get(index).and_then(|key|key.as_ref())else{return 0;};
  let shelf=self.shelves.get(index).copied().unwrap_or(0.0);
  let (width,ppm)=(self.input[8],self.input[9]);
  let mut pose=[0.0;8];pose.copy_from_slice(&self.input[..8]);
  let mut flags=0;
  if let Some(bay)=self.row(shelf).or_else(||self.row(0.0)){
   self.output[0]=shelf;
   self.output[1]=(pose[0]+width/2.0-bay[0])/ppm;
   self.output[2]=(pose[1]+bay[1])/ppm;self.output[3]=pose[2]/ppm;
   self.output[4..9].copy_from_slice(&pose[3..8]);flags|=1;
   let mut remote=[0.0;9];
   if !arranging&&(now.is_nan()||motion.active(now))&&motion.pose(key.clone(),now,&mut remote){
    if let Some(bay)=self.row(remote[0]){
     pose[0]=bay[0]-width/2.0+remote[1]*ppm;
     pose[1]=-bay[1]+remote[2]*ppm;pose[2]=remote[3]*ppm;
     pose[3..8].copy_from_slice(&remote[4..9]);
     self.output[9..17].copy_from_slice(&pose);flags|=2;
    }
   }
  }
  let target=[(pose[0]+width/2.0)/ppm,pose[1]/ppm,pose[2]/ppm,pose[3],pose[4],pose[5],pose[6],pose[7]];
  let mut bridge=[0.0;8];
  if transition.moving(now)&&transition.pose(key.clone(),&target,now,&mut bridge){
   self.output[17]=bridge[0]*ppm-width/2.0;self.output[18]=bridge[1]*ppm;self.output[19]=bridge[2]*ppm;
   self.output[20..25].copy_from_slice(&bridge[3..8]);flags|=4;
  }
  flags
 }
}
impl RustSceneMotionFrame {
 fn row(&self,index:f64)->Option<[f64;2]>{
  if !index.is_finite()||index<0.0||index.fract()!=0.0{return None;}
  let at=(index as usize).checked_mul(3)?;
  let row=self.rows.get(at..at.checked_add(3)?)?;
  if row[0]==0.0{None}else{Some([row[1],row[2]])}
 }
}
