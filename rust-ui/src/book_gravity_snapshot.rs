//! Stable physical poses, independent of screen refresh rate. Browser storage
//! is only the host transport; validation and complete-scene restoration live
//! beside the solver. Schema revisions are not application build numbers.
use super::*;
use js_sys::JSON;
#[derive(Clone)]
pub(super) struct RestPose{pub kind:u32,pub base:[f64;4],pub size:[f64;3],pub bay:[f32;4],pub x:f32,pub y:f32,pub angle:f32,pub solid:Option<String>}
impl RestPose{
 pub fn matches(&self,kind:u32,base:[f64;4],size:[f64;3],bay:[f32;4])->bool{
  self.kind==kind&&self.base.iter().zip(base).all(|(a,b)|(a-b).abs()<1e-7)&&self.size.iter().zip(size).all(|(a,b)|(a-b).abs()<1e-7)&&self.bay.iter().zip(bay).all(|(a,b)|(a-b).abs()<1e-6)
 }
}
fn numbers(value:&JsValue,max:usize)->Option<Vec<f64>>{
 if !Array::is_array(value){return None;}let a=Array::from(value);if a.length() as usize>max{return None;}
 a.iter().map(|v|v.as_f64().filter(|n|n.is_finite())).collect()
}
fn array(values:impl IntoIterator<Item=f64>)->Array{let a=Array::new();for v in values{a.push(&JsValue::from_f64(v));}a}
#[wasm_bindgen]
impl RustBookGravity{
 /// Restore metadata before any body is created; malformed/obsolete data is
 /// ignored atomically. Original JS strings preserve all UTF-16 identities.
 pub fn restore(&mut self,json:&str)->bool{
  if self.initialized||!self.books.is_empty()||json.is_empty(){return false;}
  let Ok(root)=JSON::parse(json)else{return false;};if !Array::is_array(&root){return false;}
  let root=Array::from(&root);if root.length()!=3||root.get(0).as_f64()!=Some(1.0){return false;}
  let Some(layout)=numbers(&root.get(1),100000)else{return false;};
  if !Array::is_array(&root.get(2)){return false;}let rows=Array::from(&root.get(2));if rows.length()>10000{return false;}
  let mut poses=BTreeMap::new();
  for row in rows.iter(){
   if !Array::is_array(&row){return false;}let row=Array::from(&row);if row.length()!=8&&row.length()!=9{return false;}
   let name=row.get(0);if !name.is_string(){return false;}let name:Vec<u16>=name.unchecked_ref::<JsString>().iter().collect();
   let Some(kind)=row.get(1).as_f64().filter(|n|n.is_finite()&&*n>=0.0&&*n<=2.0&&n.fract()==0.0)else{return false;};
   let Some(base)=numbers(&row.get(2),4).and_then(|v|<[f64;4]>::try_from(v).ok())else{return false;};
   let Some(size)=numbers(&row.get(3),3).and_then(|v|<[f64;3]>::try_from(v).ok())else{return false;};
   let Some(bay)=numbers(&row.get(4),4).and_then(|v|<[f64;4]>::try_from(v).ok())else{return false;};
   let Some(x)=row.get(5).as_f64().filter(|v|v.is_finite()&&v.abs()<100000.0)else{return false;};
   let Some(y)=row.get(6).as_f64().filter(|v|v.is_finite()&&v.abs()<100000.0)else{return false;};
   let Some(angle)=row.get(7).as_f64().filter(|v|v.is_finite()&&v.abs()<=std::f64::consts::PI+1e-5)else{return false;};
   let solid=if row.length()==8||row.get(8).is_null(){None}else{let Some(value)=row.get(8).as_string().filter(|v|v.len()<4096)else{return false;};Some(value)};
   if size.iter().any(|v|*v<=0.0||*v>1000.0)||base[3]<=0.0||bay.iter().any(|v|v.abs()>100000.0){return false;}
   if poses.insert(name,RestPose{kind:kind as u32,base,size,bay:bay.map(|v|v as f32),x:x as f32,y:y as f32,angle:angle as f32,solid}).is_some(){return false;}
  }
  self.saved=poses;self.saved_layout=layout;true
 }
 /// At most one storage write after actual motion settles. A book in the
 /// hand or reader is never allowed to overwrite the last complete scene.
 pub fn snapshot(&mut self)->Option<String>{
  if !self.initialized||!self.snapshot_dirty||!self.snapshot_allowed||self.books.values().any(|b|b.held||self.world.bodies[b.handle].is_dynamic()&&!self.world.bodies[b.handle].is_sleeping()){return None;}
  let root=Array::new();root.push(&JsValue::from_f64(1.0));root.push(&array(self.layout.iter().copied()));
  let rows=Array::new();for b in self.books.values(){
   let body=&self.world.bodies[b.handle];let p=body.translation();let angle=body.rotation().to_scaled_axis().z;
   if !p.is_finite()||!angle.is_finite(){return None;}
   let row=Array::new();row.push(b.name.as_ref());row.push(&JsValue::from_f64(b.kind as f64));
   row.push(&array(b.base));row.push(&array(b.size));row.push(&array(b.bay.map(|v|v as f64)));
   row.push(&JsValue::from_f64(p.x as f64));row.push(&JsValue::from_f64(p.y as f64));row.push(&JsValue::from_f64(angle as f64));row.push(&self.solids.get(&b.name.iter().collect::<Vec<u16>>()).map_or(JsValue::NULL,|s|JsValue::from_str(&s.description.signature())));rows.push(&row);
  }
  root.push(&rows);let json=JSON::stringify(&root).ok()?.as_string()?;self.snapshot_dirty=false;
  for b in self.books.values_mut(){b.restored=true;}Some(json)
 }
}
