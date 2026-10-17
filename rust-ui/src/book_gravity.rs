//! Bounded, contact-aware settling. Only a moved/released book acquires a lean;
//! neighbours remain supports. No perpetual physics loop or model rebuilds.
use std::collections::{BTreeMap,BTreeSet};
use wasm_bindgen::{prelude::*,JsCast};
use js_sys::{Array,JsString};
#[derive(Default)]
struct State{angle:f64,from:f64,target:f64,started:f64,dragging:bool,x:f64,shelf:f64}
#[wasm_bindgen]
pub struct RustBookGravity{states:BTreeMap<Vec<u16>,State>,last_input:Vec<f64>,last_keys:Vec<Vec<u16>>,last_output:Vec<f64>,active:bool}
fn contact(gap:f64,height:f64,support:f64)->f64{
 if gap<=0.01||height<=0.0||support<=0.0{return 0.0;}
 let reach=|a:f64|height.min(support/a.cos())*a.sin();
 let mut hi=65.0_f64.to_radians();if reach(hi)<gap{return 0.0;}
 let mut lo=0.0;for _ in 0..32{let mid=(lo+hi)/2.0;if reach(mid)<gap{lo=mid;}else{hi=mid;}}
 lo
}
#[wasm_bindgen]
impl RustBookGravity{
 #[wasm_bindgen(constructor)]pub fn new()->Self{Self{states:BTreeMap::new(),last_input:Vec::new(),last_keys:Vec::new(),last_output:Vec::new(),active:false}}
 /// Per entry: shelf, centre x, thickness/occupied width, height, kind, flags.
 /// Out: world Z rotation, bottom-pivot displacement x/y, animation active.
 pub fn step(&mut self,keys:&Array,input:&[f64],now:f64,reduced:bool,out:&mut[f64]){
  let count=keys.length() as usize;if input.len()!=count*6||out.len()!=count*4{return;}
  out.fill(0.0);
  let names:Vec<Vec<u16>>=keys.iter().map(|k|if k.is_string(){k.unchecked_ref::<JsString>().iter().collect()}else{Vec::new()}).collect();
  if !self.active && input==self.last_input && names==self.last_keys{out.copy_from_slice(&self.last_output);return;}
  let live:BTreeSet<&Vec<u16>>=names.iter().collect();
  self.states.retain(|key,_|live.contains(key));
  let mut order:Vec<usize>=(0..count).filter(|i|input[i*6+4]!=3.0&&input[i*6..i*6+4].iter().all(|v|v.is_finite()&&*v>=0.0)).collect();
  order.sort_by(|a,b|input[a*6].total_cmp(&input[b*6]).then(input[a*6+1].total_cmp(&input[b*6+1])));
  for (position,&i) in order.iter().enumerate(){
   let e=&input[i*6..i*6+6];if e[4]!=0.0{continue;}
   let flags=e[5] as u32;let held=flags&7!=0;
   let previous=self.states.get(&names[i]);
   let moved=previous.is_some_and(|s|s.dragging||s.x!=e[1]||s.shelf!=e[0]);
   let mut target=previous.map_or(0.0,|s|s.target);
   if held{target=0.0;}else if moved{
    let mut best=f64::INFINITY;target=0.0;
    for (candidate,sign) in [(position.checked_sub(1),1.0),(if position+1<order.len(){Some(position+1)}else{None},-1.0)]{
     let Some(p)=candidate else{continue;};let n=order[p];let other=&input[n*6..n*6+6];
     if other[0]!=e[0]||other[4]!=0.0||other[5] as u32&15!=0{continue;}
     if self.states.get(&names[n]).is_some_and(|s|s.angle.abs()>0.001){continue;}
     let gap=((other[1]-e[1]).abs()-(e[2]+other[2])/2.0).max(0.0);
     if gap<best{let angle=contact(gap,e[3],other[3]);if gap<=0.01||angle>0.0{best=gap;target=sign*angle;}}
    }
   }
   let state=self.states.entry(names[i].clone()).or_default();
   if state.target!=target{state.from=state.angle;state.target=target;state.started=now;}
   let seconds=((now-state.started)/1000.0).max(0.0);
   let active=!reduced&&seconds<1.2&&(state.target-state.from).abs()>0.00001;
   let t=if active{1.0-(-10.0*seconds).exp()*(1.0+10.0*seconds)}else{1.0};
   let old_angle=state.angle;
   state.angle=state.from+(state.target-state.from)*t;
   // Grabbing a book straightens it immediately: the drag owns its pose.
   if held{state.angle=0.0;state.from=0.0;state.target=0.0;}
   state.dragging=held;state.x=e[1];state.shelf=e[0];
   let a=state.angle;let sign=a.signum();let cos=a.cos();let sin=a.sin();
   out[i*4..i*4+4].copy_from_slice(&[a,sign*e[2]/2.0*(cos-1.0)-sin*e[3]/2.0,
    sin.abs()*e[2]/2.0+e[3]/2.0*(cos-1.0),if (active||old_angle!=state.angle)&&!held{1.0}else{0.0}]);
  }
  self.last_input.clear();self.last_input.extend_from_slice(input);self.last_keys=names;
  self.last_output.clear();self.last_output.extend_from_slice(out);
  self.active=out.chunks_exact(4).any(|entry|entry[3]!=0.0);
 }
}
