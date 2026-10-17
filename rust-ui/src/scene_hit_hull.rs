//! The projected silhouette keeps a lamp's empty bounding-box corners from
//! intercepting a neighbouring cover. No mesh, texture or lighting is changed.
use wasm_bindgen::{prelude::*,JsCast};
use js_sys::{Array,Float32Array};
use crate::{host::{get,truthy,num},jsmath::Mat4};
type Point=[f64;2];
fn cross(a:Point,b:Point,c:Point)->f64{(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0])}
fn hull(mut points:Vec<Point>)->Vec<Point>{
 points.sort_by(|a,b|a[0].total_cmp(&b[0]).then(a[1].total_cmp(&b[1])));
 points.dedup();if points.len()<3{return points;}
 let mut lower:Vec<Point>=Vec::new();
 for &p in &points{while lower.len()>1&&cross(lower[lower.len()-2],lower[lower.len()-1],p)<=0.0{lower.pop();}lower.push(p);}
 let mut upper:Vec<Point>=Vec::new();
 for &p in points.iter().rev(){while upper.len()>1&&cross(upper[upper.len()-2],upper[upper.len()-1],p)<=0.0{upper.pop();}upper.push(p);}
 lower.pop();upper.pop();lower.extend(upper);lower
}
fn collect(node:&JsValue,out:&mut Vec<Point>){
 if get(node,"visible")==JsValue::FALSE{return;}
 if truthy(&get(node,"isMesh")){
  let position=get(&get(&get(node,"geometry"),"attributes"),"position");let data=get(&position,"array");
  let elements=get(&get(node,"matrixWorld"),"elements");
  if data.is_instance_of::<Float32Array>()&&Array::is_array(&elements){
   let e=Array::from(&elements);if e.length()==16{
    let mut m=[0.0;16];for (i,x) in m.iter_mut().enumerate(){*x=num(&e.get(i as u32));}
    let values=data.unchecked_into::<Float32Array>().to_vec();
    for p in values.chunks_exact(3){let q=Mat4(m).apply([p[0] as f64,p[1] as f64,p[2] as f64]);
     if q[0].is_finite()&&q[1].is_finite(){out.push([q[0],-q[1]]);}
    }
   }
  }
 }
 let children=get(node,"children");if Array::is_array(&children){for child in Array::from(&children).iter(){collect(&child,out);}}
}
#[wasm_bindgen]
pub fn scene_lamp_hit_hull(model:&JsValue,left:f64,top:f64)->String{
 if !left.is_finite()||!top.is_finite(){return String::new();}
 let mut points=Vec::new();collect(model,&mut points);let outline=hull(points);if outline.len()<3{return String::new();}
 // Two pixels retain comfortable antialiased edges without covering a whole
 // neighbouring book. Ceiling pucks keep their existing enlarged square.
 let expanded:Vec<Point>=outline.iter().flat_map(|p|(0..8).map(move|i|{let a=i as f64*std::f64::consts::PI/4.0;[p[0]+2.0*a.cos(),p[1]+2.0*a.sin()]})).collect();
 let outline=hull(expanded);
 let coords=outline.iter().map(|p|format!("{:.2}px {:.2}px",p[0]-left,p[1]-top)).collect::<Vec<_>>().join(",");
 format!("polygon({coords})")
}
