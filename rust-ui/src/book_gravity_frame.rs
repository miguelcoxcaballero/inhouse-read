//! Retained frame input/output storage and UTF-16 identity registration.
//! JS writes its host object fields into this arena; the solver consumes those
//! same numbers without allocating/copying wasm-bindgen slice arguments.
use wasm_bindgen::{prelude::*,JsCast};
use js_sys::{Array,JsString};
use std::collections::BTreeSet;
use super::RustBookGravity;
use crate::scene_view::RustScene;

#[wasm_bindgen]
pub struct RustGravityFrame {
 keys:Array, names:Vec<Vec<u16>>, live:BTreeSet<Vec<u16>>,
 states:Vec<f64>, geometry:Vec<f64>, output:Vec<f64>, presentation:Vec<f64>,
}
#[wasm_bindgen]
impl RustGravityFrame {
 #[wasm_bindgen(constructor)]
 pub fn new()->Self{Self{keys:Array::new(),names:Vec::new(),live:BTreeSet::new(),states:Vec::new(),geometry:Vec::new(),output:Vec::new(),presentation:Vec::new()}}
 /// Registration is a layout event, never a per-animation-frame operation.
 pub fn register(&mut self,keys:&Array){
  self.keys=keys.slice(0,keys.length());
  self.names=self.keys.iter().map(|key|if key.is_string(){key.unchecked_ref::<JsString>().iter().collect()}else{Vec::new()}).collect();
  self.live=self.names.iter().cloned().collect();
  let count=self.names.len();
  self.states.resize(count*37,0.0);self.geometry.resize(count*9,0.0);self.output.resize(count*4,0.0);self.presentation.resize(count*3,0.0);
 }
 pub fn memory(&self)->JsValue{wasm_bindgen::memory()}
 pub fn states_ptr(&self)->usize{self.states.as_ptr() as usize}
 pub fn geometry_ptr(&self)->usize{self.geometry.as_ptr() as usize}
 pub fn output_ptr(&self)->usize{self.output.as_ptr() as usize}
 pub fn presentation_ptr(&self)->usize{self.presentation.as_ptr() as usize}
 pub fn advance(&mut self,gravity:&mut RustBookGravity,scene:&RustScene,now:f64,reduced:bool){
  gravity.step_registered(&self.keys,&self.names,Some(&self.live),&mut self.states,&self.geometry,scene,now,reduced,&mut self.output);
  compose_presentations(&mut self.states,&self.output,&mut self.presentation,scene.width);
 }
}

/// Final shelf pose after contacts. Keep the original f64 operation order and
/// leave quaternion construction to Three's own host Math implementation.
/// Metadata enters as [decoration has a collision stamp, _, _] and leaves as
/// [book Euler order is ZYX, physics is moving, projection state flags].
fn compose_presentations(states:&mut[f64],physics:&[f64],metadata:&mut[f64],width:f64){
 for ((state,output),meta) in states.chunks_exact_mut(37).zip(physics.chunks_exact(4)).zip(metadata.chunks_exact_mut(3)){
  let decorative=state[0]==1.0||state[0]==2.0;
  let under=state[1]!=0.0;
  let applies=!decorative||!under&&meta[0]!=0.0;
  if applies{
   state[29]=state[23]-width/2.0+output[1];
   state[30]=if decorative{-state[24]-if state[0]==2.0{state[26]/2.0}else{0.0}+output[2]}
    else{-state[24]+output[2]};
   if !decorative{state[34]+=output[0];}
  }
  meta[0]=if !decorative&&output[0]!=0.0{1.0}else{0.0};
  meta[1]=if applies&&output[3]!=0.0{1.0}else{0.0};
  // JS truthiness is intentional here: NaN is false for quality, while the
  // existing movement check uses !== 0 and therefore treats it as active.
  meta[2]=((state[2] as u32)|if output[3]!=0.0&&!output[3].is_nan(){16}else{0}|if output[0].abs()>0.001{32}else{0}) as f64;
 }
}
