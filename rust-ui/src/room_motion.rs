//! Ephemeral room previews, like Notes' live strokes: ordered gesture frames,
//! bounded leases and interpolation. These poses never enter the saved layout.
use std::collections::BTreeMap;
use wasm_bindgen::prelude::*;
use js_sys::{Array,Reflect};
fn get(v:&JsValue,k:&str)->JsValue{Reflect::get(v,&k.into()).unwrap_or(JsValue::UNDEFINED)}
fn text(v:&JsValue,k:&str)->String{get(v,k).as_string().unwrap_or_default()}
fn n(v:&JsValue,k:&str)->f64{get(v,k).as_f64().unwrap_or(f64::NAN)}
pub(crate) fn valid(frame:&JsValue)->bool{
 let phase=text(frame,"phase");let gesture=text(frame,"gesture");let seq=n(frame,"sequence");
 if !["frame","end","cancel"].contains(&phase.as_str())||gesture.is_empty()||gesture.len()>128||!seq.is_finite()||seq<0.0||seq.fract()!=0.0||seq>9007199254740991.0||!["walnut","baggebo"].contains(&text(frame,"shelfType").as_str()){return false;}
 let poses=get(frame,"poses");if !Array::is_array(&poses){return false;}let poses=Array::from(&poses);if poses.length()>512{return false;}
 let mut keys=BTreeMap::new();
 poses.iter().all(|row|{
  if !Array::is_array(&row){return false;}let a=Array::from(&row);let Some(key)=a.get(0).as_string()else{return false;};
  if a.length()!=10||key.len()>256||!(["book:drive:","plant:","lamp:"].iter().any(|p|key.starts_with(p)))||keys.insert(key,()).is_some(){return false;}
  let values:Option<Vec<f64>>=(1..10).map(|i|a.get(i).as_f64().filter(|n|n.is_finite())).collect();let Some(v)=values else{return false;};
  v[0]>=0.0&&v[0]<=10000.0&&v[0].fract()==0.0&&v[1..4].iter().all(|v|v.abs()<100.0)&&v[4..8].iter().map(|v|v*v).sum::<f64>()>0.99&&v[4..8].iter().map(|v|v*v).sum::<f64>()<1.01&&v[8]>0.0&&v[8]<=4.0
 })
}
#[derive(Clone)]struct Pose{bay:f64,from:[f64;8],to:[f64;8],at:f64}
struct Actor{gesture:String,sequence:f64,ended:bool,expires:f64,poses:BTreeMap<String,Pose>}
#[wasm_bindgen]pub struct RustRoomMotion{actors:BTreeMap<String,Actor>,changed:bool}
fn sample(p:&Pose,now:f64)->[f64;8]{
 let t=((now-p.at)/65.0).clamp(0.0,1.0);let mut out=p.to;
 for i in 0..3{out[i]=p.from[i]+(p.to[i]-p.from[i])*t;}
 // Normalized shortest-arc quaternion interpolation; no Euler wrap at pi.
 let sign=if (3..7).map(|i|p.from[i]*p.to[i]).sum::<f64>()<0.0{-1.0}else{1.0};
 let mut len=0.0;for i in 3..7{out[i]=p.from[i]*(1.0-t)+sign*p.to[i]*t;len+=out[i]*out[i];}
 if len>0.0{for i in 3..7{out[i]/=len.sqrt();}}
 out[7]=p.from[7]+(p.to[7]-p.from[7])*t;out
}
#[wasm_bindgen]impl RustRoomMotion{
 #[wasm_bindgen(constructor)]pub fn new()->Self{Self{actors:BTreeMap::new(),changed:false}}
 pub fn receive(&mut self,packet:JsValue,now:f64)->bool{
  if !now.is_finite()||!valid(&packet){return false;}let source=text(&packet,"from");if source.is_empty()||source.len()>128{return false;}
  self.actors.retain(|_,a|a.expires>=now);
  if self.actors.len()>=8&&!self.actors.contains_key(&source){return false;}
  let gesture=text(&packet,"gesture");let sequence=n(&packet,"sequence");let phase=text(&packet,"phase");
  let old=self.actors.get(&source);
  if old.is_some_and(|a|a.sequence>=sequence||a.gesture==gesture&&a.ended){return false;}
  let mut poses=BTreeMap::new();
  if phase!="cancel"{for row in Array::from(&get(&packet,"poses")).iter(){
   let row=Array::from(&row);let key=row.get(0).as_string().unwrap();let bay=row.get(1).as_f64().unwrap();
   let to=std::array::from_fn(|i|row.get(i as u32+2).as_f64().unwrap());
   let from=old.and_then(|a|a.poses.get(&key)).filter(|p|p.bay==bay).map(|p|sample(p,now)).unwrap_or(to);
   poses.insert(key,Pose{bay,from,to,at:now});
  }}
  self.changed=old.is_none_or(|a|a.poses.len()!=poses.len()||poses.iter().any(|(key,p)|a.poses.get(key).is_none_or(|old|old.bay!=p.bay||old.to.iter().zip(p.to).any(|(a,b)|(a-b).abs()>1e-8))));
  self.actors.insert(source,Actor{gesture,sequence,ended:phase!="frame",expires:now+if phase=="frame"{3500.0}else{5000.0},poses});true
 }
 pub fn pose(&self,key:String,now:f64,out:&mut[f64])->bool{
  if out.len()<9{return false;}
  // Deterministic actor priority if two remote users manipulate the same book.
  for actor in self.actors.values().rev(){if actor.expires<now{continue;}if let Some(p)=actor.poses.get(&key){out[0]=p.bay;out[1..9].copy_from_slice(&sample(p,now));return true;}}false
 }
 #[wasm_bindgen(getter)]pub fn changed(&self)->bool{self.changed}
 pub fn moving(&self,now:f64)->bool{self.actors.values().any(|a|a.expires>=now&&a.poses.values().any(|p|now-p.at<65.0&&p.from.iter().zip(p.to).any(|(a,b)|(a-b).abs()>1e-8)))}
 pub fn gesturing(&self,now:f64)->bool{self.actors.values().any(|a|!a.ended&&a.expires>=now&&!a.poses.is_empty())}
 pub fn active(&self,now:f64)->bool{self.actors.values().any(|a|a.expires>=now&&!a.poses.is_empty())}
 pub fn clear(&mut self,source:String){if source.is_empty(){for actor in self.actors.values_mut(){actor.poses.clear();actor.ended=true;}}else if let Some(actor)=self.actors.get_mut(&source){actor.poses.clear();}}
}
