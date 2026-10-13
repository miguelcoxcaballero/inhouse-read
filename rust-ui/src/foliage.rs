//! Front-facing foliage used by the native pointer surface. Coordinates keep
//! Three's f64 operation order; decimal formatting remains in the browser.
use wasm_bindgen::prelude::*;
const MAX_VERTICES:usize=100_000;
const MAX_INDICES:usize=450_000;
#[wasm_bindgen]
pub fn foliage_plan(points:&[f32],indices:&[u32],matrix:&[f64],indexed:bool)->Option<Vec<f64>>{
 if matrix.len()!=16||points.len()%3!=0||points.len()/3>MAX_VERTICES||indices.len()>MAX_INDICES{return None;}
 if points.iter().any(|value|!value.is_finite())||matrix.iter().any(|value|!value.is_finite()){return None;}
 let vertices=points.len()/3;let count=if indexed{indices.len()}else{vertices};
 if count%3!=0||indexed&&indices.iter().any(|value|*value as usize>=vertices){return None;}
 let mut plan=Vec::with_capacity(2+vertices*2+count);plan.extend_from_slice(&[vertices as f64,0.0]);
 for point in points.chunks_exact(3){
  let (x,y,z)=(point[0]as f64,point[1]as f64,point[2]as f64);
  let w=1.0/(matrix[3]*x+matrix[7]*y+matrix[11]*z+matrix[15]);
  let px=(matrix[0]*x+matrix[4]*y+matrix[8]*z+matrix[12])*w;
  let py=(matrix[1]*x+matrix[5]*y+matrix[9]*z+matrix[13])*w;
  if !px.is_finite()||!py.is_finite(){return None;}
  plan.extend_from_slice(&[px,py]);
 }
 let mut triangles=0;
 for index in (0..count).step_by(3){
  let a=if indexed{indices[index]as usize}else{index};let b=if indexed{indices[index+1]as usize}else{index+1};let c=if indexed{indices[index+2]as usize}else{index+2};
  let (ax,ay,bx,by,cx,cy)=(plan[2+a*2],plan[3+a*2],plan[2+b*2],plan[3+b*2],plan[2+c*2],plan[3+c*2]);
  let facing=(bx-ax)*(cy-ay)-(by-ay)*(cx-ax);if facing<=0.0001{continue;}
  if !facing.is_finite(){return None;}
  plan.extend_from_slice(&[a as f64,b as f64,c as f64]);triangles+=1;
 }
 plan[1]=triangles as f64;Some(plan)
}
