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
 for key in ["base","commit"]{let value=get(frame,key);if !value.is_undefined()&&!value.is_null()&&!value.as_string().is_some_and(|s|!s.is_empty()&&s.len()<=128){return false;}}
 if !text(frame,"commit").is_empty()&&(phase!="end"||text(frame,"base").is_empty()){return false;}
 let lineage=get(frame,"lineage");
 if !lineage.is_null()&&!lineage.is_undefined(){
  if !Array::is_array(&lineage){return false;}let lineage=Array::from(&lineage);
  if lineage.length()>32||!lineage.iter().all(|v|v.as_string().is_some_and(|s|!s.is_empty()&&s.len()<=128))
   ||lineage.length()>0&&lineage.get(lineage.length()-1).as_string().as_deref()!=Some(text(frame,"base").as_str()){return false;}
 }
 let poses=get(frame,"poses");if !Array::is_array(&poses){return false;}let poses=Array::from(&poses);if poses.length()>512{return false;}
 let mut keys=BTreeMap::new();
 poses.iter().all(|row|{
  if !Array::is_array(&row){return false;}let a=Array::from(&row);let Some(key)=a.get(0).as_string()else{return false;};
  if a.length()!=10||key.len()>256||!(["book:drive:","plant:","lamp:"].iter().any(|p|key.starts_with(p)))||keys.insert(key,()).is_some(){return false;}
  let values:Option<Vec<f64>>=(1..10).map(|i|a.get(i).as_f64().filter(|n|n.is_finite())).collect();let Some(v)=values else{return false;};
  v[0]>=0.0&&v[0]<=10000.0&&v[0].fract()==0.0&&v[1..4].iter().all(|v|v.abs()<100.0)&&v[4..8].iter().map(|v|v*v).sum::<f64>()>0.99&&v[4..8].iter().map(|v|v*v).sum::<f64>()<1.01&&v[8]>0.0&&v[8]<=4.0
 })
}
#[derive(Clone)]struct Pose{bay:f64,from:[f64;8],to:[f64;8],at:f64,duration:f64}
struct Actor{gesture:String,sequence:f64,base:String,commit:String,ancestors:Vec<String>,ended:bool,expires:f64,poses:BTreeMap<String,Pose>}
#[wasm_bindgen]pub struct RustRoomMotion{actors:BTreeMap<String,Actor>,seen:BTreeMap<String,f64>,revision:String,changed:bool}
fn sample(p:&Pose,now:f64)->[f64;8]{
 let t=((now-p.at)/p.duration).clamp(0.0,1.0);let mut out=p.to;
 for i in 0..3{out[i]=p.from[i]+(p.to[i]-p.from[i])*t;}
 // Normalized shortest-arc quaternion interpolation; no Euler wrap at pi.
 let sign=if (3..7).map(|i|p.from[i]*p.to[i]).sum::<f64>()<0.0{-1.0}else{1.0};
 let mut len=0.0;for i in 3..7{out[i]=p.from[i]*(1.0-t)+sign*p.to[i]*t;len+=out[i]*out[i];}
 if len>0.0{for i in 3..7{out[i]/=len.sqrt();}}
 out[7]=p.from[7]+(p.to[7]-p.from[7])*t;out
}
#[wasm_bindgen]impl RustRoomMotion{
 #[wasm_bindgen(constructor)]pub fn new()->Self{Self{actors:BTreeMap::new(),seen:BTreeMap::new(),revision:String::new(),changed:false}}
 pub fn receive(&mut self,packet:JsValue,now:f64)->bool{
  if !now.is_finite()||!valid(&packet){return false;}let source=text(&packet,"from");if source.is_empty()||source.len()>128{return false;}
  let sequence=n(&packet,"sequence");
  if self.seen.get(&source).is_some_and(|last|*last>=sequence){return false;}
  let base=text(&packet,"base");let commit=text(&packet,"commit");
  let gesture=text(&packet,"gesture");let old=self.actors.get(&source);
  // Reliable checkpoints and interactive frames travel independently. A peer
  // may already be on its next gesture while the previous commit is in flight.
  // Accept only a proven continuation, never an arbitrary unknown base.
  let lineage:Vec<String>=if Array::is_array(&get(&packet,"lineage")){Array::from(&get(&packet,"lineage")).iter().filter_map(|v|v.as_string()).collect()}else{Vec::new()};
  let descended=lineage.contains(&self.revision);
  let extends=old.is_some_and(|a|a.ended&&!a.commit.is_empty()&&a.commit==base&&a.gesture!=gesture);
  let continuing=old.is_some_and(|a|a.gesture==gesture&&a.base==base&&a.ancestors.contains(&self.revision));
  if !base.is_empty()&&!self.revision.is_empty()&&base!=self.revision&&!extends&&!continuing&&!descended{return false;}
  if !commit.is_empty()&&commit==self.revision{
   if self.seen.len()>=128&&!self.seen.contains_key(&source){if let Some(key)=self.seen.keys().next().cloned(){self.seen.remove(&key);}}
   self.changed=self.actors.remove(&source).is_some();self.seen.insert(source,sequence);return true;
  }
  self.actors.retain(|_,a|a.expires>=now&&!a.poses.is_empty());
  if self.actors.len()>=8&&!self.actors.contains_key(&source){return false;}
  let gesture=text(&packet,"gesture");let sequence=n(&packet,"sequence");let phase=text(&packet,"phase");
  let old=self.actors.get(&source);
  if old.is_some_and(|a|a.sequence>=sequence||a.gesture==gesture&&a.ended){return false;}
  let mut ancestors=if extends||continuing||old.is_some_and(|a|a.gesture==gesture){old.map(|a|a.ancestors.clone()).unwrap_or_default()}else{Vec::new()};
  if extends{if let Some(a)=old{ancestors.push(a.base.clone());}}
  for revision in lineage{if !ancestors.contains(&revision){ancestors.push(revision);}}
  if ancestors.len()>128{ancestors.drain(..ancestors.len()-128);}
  // Retain settled neighbours from preceding gestures until their checkpoint
  // is installed. Replacing the affected set alone exposes the old solver pose.
  let mut poses=if phase!="cancel"&&(extends||old.is_some_and(|a|a.gesture==gesture&&!a.ancestors.is_empty())){old.map(|a|a.poses.clone()).unwrap_or_default()}else{BTreeMap::new()};
  if phase!="cancel"{for row in Array::from(&get(&packet,"poses")).iter(){
   let row=Array::from(&row);let key=row.get(0).as_string().unwrap();let bay=row.get(1).as_f64().unwrap();
   let to=std::array::from_fn(|i|row.get(i as u32+2).as_f64().unwrap());
   let from=old.and_then(|a|a.poses.get(&key)).filter(|p|p.bay==bay).map(|p|sample(p,now)).unwrap_or(to);
   poses.insert(key,Pose{bay,from,to,at:now,duration:65.0});
  }}
  if poses.len()>512{return false;}
  self.changed=old.is_none_or(|a|a.poses.len()!=poses.len()||poses.iter().any(|(key,p)|a.poses.get(key).is_none_or(|old|old.bay!=p.bay||old.to.iter().zip(p.to).any(|(a,b)|(a-b).abs()>1e-8))));
  if self.seen.len()>=128&&!self.seen.contains_key(&source){if let Some(key)=self.seen.keys().next().cloned(){self.seen.remove(&key);}}
  self.seen.insert(source.clone(),sequence);
  self.actors.insert(source,Actor{gesture,sequence,base,commit:commit.clone(),ancestors,ended:phase!="frame",expires:if phase=="end"&&!commit.is_empty(){f64::INFINITY}else{now+if phase=="frame"{3500.0}else{5000.0}},poses});true
 }
 pub fn pose(&self,key:&str,now:f64,out:&mut[f64])->bool{
  if out.len()<9{return false;}
  // Deterministic actor priority if two remote users manipulate the same book.
  for actor in self.actors.values().rev(){if actor.expires<now{continue;}if let Some(p)=actor.poses.get(key){out[0]=p.bay;out[1..9].copy_from_slice(&sample(p,now));return true;}}false
 }
 #[wasm_bindgen(getter)]pub fn changed(&self)->bool{self.changed}
 pub fn moving(&self,now:f64)->bool{self.actors.values().any(|a|a.expires>=now&&a.poses.values().any(|p|now-p.at<65.0&&p.from.iter().zip(p.to).any(|(a,b)|(a-b).abs()>1e-8)))}
 pub fn gesturing(&self,now:f64)->bool{self.actors.values().any(|a|!a.ended&&a.expires>=now&&!a.poses.is_empty())}
 pub fn active(&self,now:f64)->bool{self.actors.values().any(|a|a.expires>=now&&!a.poses.is_empty())}
 /// Only an installed physical checkpoint advances the room, not receipt of
 /// a packet or a lamp/reading update. End frames hold until this handoff.
 pub fn acknowledge(&mut self,revision:String){
  if revision.is_empty()||revision==self.revision{return;}
  // An intermediate checkpoint retires its own preview, not a descendant
  // gesture already painted on top. An unrelated winning branch still fences
  // all previews derived from the losing room.
  self.actors.retain(|_,a|a.commit!=revision&&(a.base==revision||a.ancestors.contains(&revision)));
  self.revision=revision;self.changed=true;
 }
 pub fn clear(&mut self,source:String){if source.is_empty(){for actor in self.actors.values_mut(){actor.poses.clear();actor.ended=true;}}else if let Some(actor)=self.actors.get_mut(&source){if actor.expires.is_finite(){actor.poses.clear();}}}
}

/// Short visual handoff from the painted room to a committed remote room.
/// Coordinates are cabinet-relative metres, independent of viewport pixels.
/// The authoritative solver rests at the received pose throughout; animation
/// never re-enters physics, storage or the outgoing gesture stream.
#[wasm_bindgen]pub struct RustRoomTransition{poses:BTreeMap<String,Pose>,started:f64}
#[wasm_bindgen]impl RustRoomTransition{
 #[wasm_bindgen(constructor)]pub fn new()->Self{Self{poses:BTreeMap::new(),started:f64::NEG_INFINITY}}
 pub fn begin(&mut self,rows:JsValue,now:f64){
  self.poses.clear();self.started=now;if !now.is_finite()||!Array::is_array(&rows){return;}
  for row in Array::from(&rows).iter().take(10000){
   if !Array::is_array(&row){continue;}let a=Array::from(&row);let Some(key)=a.get(0).as_string()else{continue;};
   if a.length()!=9||key.len()>256{continue;}
   let Some(v)=a.iter().skip(1).map(|v|v.as_f64().filter(|n|n.is_finite())).collect::<Option<Vec<_>>>()else{continue;};
   let from:[f64;8]=v.try_into().unwrap();
   self.poses.insert(key,Pose{bay:0.0,from,to:from,at:now,duration:240.0});
  }
 }
 pub fn pose(&mut self,key:&str,target:&[f64],now:f64,out:&mut[f64])->bool{
  if !self.moving(now)||target.len()!=8||out.len()<8||!target.iter().all(|v|v.is_finite()){return false;}
  let Some(p)=self.poses.get_mut(key)else{return false;};p.to.copy_from_slice(target);
  out[..8].copy_from_slice(&sample(p,now));true
 }
 pub fn moving(&self,now:f64)->bool{!self.poses.is_empty()&&now.is_finite()&&now-self.started<240.0&&now>=self.started}
 pub fn clear(&mut self){self.poses.clear();}
}
