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
 states:Vec<f64>, geometry:Vec<f64>, output:Vec<f64>,
}
#[wasm_bindgen]
impl RustGravityFrame {
 #[wasm_bindgen(constructor)]
 pub fn new()->Self{Self{keys:Array::new(),names:Vec::new(),live:BTreeSet::new(),states:Vec::new(),geometry:Vec::new(),output:Vec::new()}}
 /// Registration is a layout event, never a per-animation-frame operation.
 pub fn register(&mut self,keys:&Array){
  self.keys=keys.slice(0,keys.length());
  self.names=self.keys.iter().map(|key|if key.is_string(){key.unchecked_ref::<JsString>().iter().collect()}else{Vec::new()}).collect();
  self.live=self.names.iter().cloned().collect();
  let count=self.names.len();
  self.states.resize(count*37,0.0);self.geometry.resize(count*9,0.0);self.output.resize(count*4,0.0);
 }
 pub fn memory(&self)->JsValue{wasm_bindgen::memory()}
 pub fn states_ptr(&self)->usize{self.states.as_ptr() as usize}
 pub fn geometry_ptr(&self)->usize{self.geometry.as_ptr() as usize}
 pub fn output_ptr(&self)->usize{self.output.as_ptr() as usize}
 pub fn advance(&mut self,gravity:&mut RustBookGravity,scene:&RustScene,now:f64,reduced:bool){
  gravity.step_registered(&self.keys,&self.names,Some(&self.live),&mut self.states,&self.geometry,scene,now,reduced,&mut self.output);
 }
}
