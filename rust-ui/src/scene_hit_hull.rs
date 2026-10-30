//! The projected silhouette keeps a lamp's empty bounding-box corners from
//! intercepting a neighbouring cover. No mesh, texture or lighting is changed.
use wasm_bindgen::{prelude::*,JsCast};
use js_sys::{Array,Float32Array};
use crate::{host::{get,truthy,num},jsmath::Mat4};
type Point=[f64;2];
fn cross(a:Point,b:Point,c:Point)->f64{(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0])}
fn hull(mut points:Vec<Point>)->Vec<Point>{
 // Points equal under this order have identical bits, so an unstable sort gives the same hull.
 points.sort_unstable_by(|a,b|a[0].total_cmp(&b[0]).then(a[1].total_cmp(&b[1])));
 points.dedup();if points.len()<3{return points;}
 let mut lower:Vec<Point>=Vec::new();
 for &p in &points{while lower.len()>1&&cross(lower[lower.len()-2],lower[lower.len()-1],p)<=0.0{lower.pop();}lower.push(p);}
 let mut upper:Vec<Point>=Vec::new();
 for &p in points.iter().rev(){while upper.len()>1&&cross(upper[upper.len()-2],upper[upper.len()-1],p)<=0.0{upper.pop();}upper.push(p);}
 lower.pop();upper.pop();lower.extend(upper);lower
}
/// One visible mesh as the silhouette reads it: its vertex array and world matrix.
struct Mesh{data:Float32Array,version:f64,matrix:[f64;16]}
/// The visible meshes in traversal order. A hidden node hides its whole subtree; a mesh
/// without a Float32 position array or a 16-number world matrix contributes no points.
fn gather(node:&JsValue,out:&mut Vec<Mesh>){
 if get(node,"visible")==JsValue::FALSE{return;}
 if truthy(&get(node,"isMesh")){
  let position=get(&get(&get(node,"geometry"),"attributes"),"position");let data=get(&position,"array");
  let elements=get(&get(node,"matrixWorld"),"elements");
  if data.is_instance_of::<Float32Array>()&&Array::is_array(&elements){
   let e=Array::from(&elements);if e.length()==16{
    let mut m=[0.0;16];for (i,x) in m.iter_mut().enumerate(){*x=num(&e.get(i as u32));}
    out.push(Mesh{data:data.unchecked_into(),version:num(&get(&position,"version")),matrix:m});
   }
  }
 }
 let children=get(node,"children");if Array::is_array(&children){for child in Array::from(&children).iter(){gather(&child,out);}}
}
fn outline(meshes:&[Mesh],left:f64,top:f64)->String{
 if !left.is_finite()||!top.is_finite(){return String::new();}
 let mut points=Vec::new();
 for mesh in meshes{
  let values=mesh.data.to_vec();
  for p in values.chunks_exact(3){let q=Mat4(mesh.matrix).apply([p[0] as f64,p[1] as f64,p[2] as f64]);
   if q[0].is_finite()&&q[1].is_finite(){points.push([q[0],-q[1]]);}
  }
 }
 let outline=hull(points);if outline.len()<3{return String::new();}
 // Two pixels retain comfortable antialiased edges without covering a whole
 // neighbouring book. Ceiling pucks keep their existing enlarged square.
 // The eight offsets are the same numbers for every point: computed once.
 let ring:[Point;8]=std::array::from_fn(|i|{let a=i as f64*std::f64::consts::PI/4.0;[2.0*a.cos(),2.0*a.sin()]});
 let expanded:Vec<Point>=outline.iter().flat_map(|p|ring.iter().map(move|o|[p[0]+o[0],p[1]+o[1]])).collect();
 let outline=hull(expanded);
 let coords=outline.iter().map(|p|format!("{:.2}px {:.2}px",p[0]-left,p[1]-top)).collect::<Vec<_>>().join(",");
 format!("polygon({coords})")
}
#[wasm_bindgen]
pub fn scene_lamp_hit_hull(model:&JsValue,left:f64,top:f64)->String{
 if !left.is_finite()||!top.is_finite(){return String::new();}
 let mut meshes=Vec::new();gather(model,&mut meshes);outline(&meshes,left,top)
}

/// A lamp's silhouette across frames. It is a pure function of the visible meshes' vertex
/// arrays and world matrices and of the tap box's corner, so it is rebuilt only when one of
/// those changed (bit for bit, every array by identity and three's attribute version);
/// otherwise the projection, the hulls and the text of the previous frame stand. A held
/// array is released with the next rebuild or with `free`.
#[wasm_bindgen]
pub struct RustLampHull{inputs:Vec<u64>,arrays:Vec<Float32Array>,text:String,built:bool}
#[wasm_bindgen]
impl RustLampHull{
 #[wasm_bindgen(constructor)]
 pub fn new()->Self{Self{inputs:Vec::new(),arrays:Vec::new(),text:String::new(),built:false}}
 /// The text `scene_lamp_hit_hull(model, left, top)` returns now, or `undefined` when it is
 /// the text this hull returned last time and `fresh` (the caller lost it) is false.
 pub fn outline(&mut self,model:&JsValue,left:f64,top:f64,fresh:bool)->JsValue{
  let mut meshes=Vec::new();gather(model,&mut meshes);
  let mut inputs=Vec::with_capacity(2+meshes.len()*18);
  inputs.push(left.to_bits());inputs.push(top.to_bits());
  for mesh in &meshes{inputs.push(mesh.version.to_bits());inputs.push(f64::from(mesh.data.length()).to_bits());inputs.extend(mesh.matrix.iter().map(|v|v.to_bits()));}
  let same=self.built&&inputs==self.inputs&&self.arrays.len()==meshes.len()
   &&self.arrays.iter().zip(&meshes).all(|(held,mesh)|AsRef::<JsValue>::as_ref(held)==AsRef::<JsValue>::as_ref(&mesh.data));
  if !same{
   self.text=outline(&meshes,left,top);
   self.inputs=inputs;self.arrays=meshes.into_iter().map(|mesh|mesh.data).collect();self.built=true;
  }else if !fresh{return JsValue::UNDEFINED;}
  JsValue::from_str(&self.text)
 }
}
