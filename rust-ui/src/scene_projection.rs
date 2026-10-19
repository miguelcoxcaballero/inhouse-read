//! Retained numeric projection buffers and semantic-hit style invalidation.
//! The host owns DOM/Three objects; native state retains numbers only.
use wasm_bindgen::prelude::*;
use crate::scene_view::RustScene;

#[derive(Clone)]
struct Styles{fixed:bool,cover_fixed:bool,base:[f64;5],cover:[f64;6]}
impl Default for Styles{fn default()->Self{Self{fixed:false,cover_fixed:false,base:[f64::NAN;5],cover:[f64::NAN;6]}}}

#[wasm_bindgen]
pub struct RustSceneProjectionFrame{
 projection:Box<[f64;44]>,hit:Box<[f64;49]>,styles:Vec<Styles>,
}
#[wasm_bindgen]
impl RustSceneProjectionFrame{
 #[wasm_bindgen(constructor)]
 pub fn new()->Self{Self{projection:Box::new([0.0;44]),hit:Box::new([0.0;49]),styles:Vec::new()}}
 pub fn reset_entries(&mut self,count:usize){self.styles.clear();self.styles.resize(count,Styles::default());}
 pub fn memory(&self)->JsValue{wasm_bindgen::memory()}
 pub fn projection_ptr(&self)->usize{self.projection.as_ptr() as usize}
 pub fn hit_ptr(&self)->usize{self.hit.as_ptr() as usize}
 pub fn project(&mut self,scene:&RustScene){scene.project_entry(&mut self.projection[..]);}
 /// Dirty bits: initial node, left/top/width/height/z, initial cover,
 /// cover left/top/width/height/display/events. NaN remains dirty on each call;
 /// signed zero compares equal, exactly as the former JS strict comparisons.
 pub fn hit(&mut self,scene:&RustScene,index:usize,reset:bool,fresh_cover:bool)->u32{
  scene.hit_entry(&mut self.hit[..]);
  let Some(state)=self.styles.get_mut(index)else{return 0;};
  if reset{*state=Styles::default();}
  let mut dirty=if state.fixed{0}else{1};state.fixed=true;
  for i in 0..5{let value=self.hit[40+i];if value!=state.base[i]{dirty|=1<<(i+1);state.base[i]=value;}}
  if self.hit[0]!=1.0{
   if fresh_cover{state.cover_fixed=false;state.cover.fill(f64::NAN);}
   if !state.cover_fixed{dirty|=1<<6;state.cover_fixed=true;}
   let cover=[self.hit[45],self.hit[46],self.hit[8],self.hit[9],self.hit[47],self.hit[48]];
   for (i,value) in cover.into_iter().enumerate(){if value!=state.cover[i]{dirty|=1<<(i+7);state.cover[i]=value;}}
  }
  dirty
 }
}
