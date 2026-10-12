//! Project bounding-box corners with the exact operation order of Vector3.
//! Pixel rounding and framebuffer policy stay with the existing renderer.
use wasm_bindgen::prelude::*;
use js_sys::Float64Array;
fn apply(point:[f64;3],matrix:&[f64])->[f64;3]{
 let[x,y,z]=point;
 let w=1.0/(matrix[3]*x+matrix[7]*y+matrix[11]*z+matrix[15]);
 [(matrix[0]*x+matrix[4]*y+matrix[8]*z+matrix[12])*w,
  (matrix[1]*x+matrix[5]*y+matrix[9]*z+matrix[13])*w,
  (matrix[2]*x+matrix[6]*y+matrix[10]*z+matrix[14])*w]
}
fn min(a:f64,b:f64)->f64{
 if a.is_nan()||b.is_nan(){f64::NAN}else if a==0.0&&b==0.0{if a.is_sign_negative()||b.is_sign_negative(){-0.0}else{0.0}}else if a<b{a}else{b}
}
fn max(a:f64,b:f64)->f64{
 if a.is_nan()||b.is_nan(){f64::NAN}else if a==0.0&&b==0.0{if !a.is_sign_negative()||!b.is_sign_negative(){0.0}else{-0.0}}else if a>b{a}else{b}
}
#[wasm_bindgen]
pub fn book_projection_bounds(records:&[f64],inverse:&[f64],projection:&[f64],width:f64,height:f64)->JsValue{
 if records.len()%22!=0||records.len()>1024*22||inverse.len()!=16||projection.len()!=16{return JsValue::UNDEFINED}
 let mut bounds=[f64::INFINITY,f64::INFINITY,f64::NEG_INFINITY,f64::NEG_INFINITY];
 for record in records.chunks_exact(22){
  for xi in 0..2{for yi in 0..2{for zi in 0..2{
   let point=[record[xi*3],record[yi*3+1],record[zi*3+2]];
   let world=apply(point,&record[6..]);let local=apply(world,inverse);let screen=apply(local,projection);
   let x=(screen[0]+1.0)*width/2.0;let y=(1.0-screen[1])*height/2.0;
   bounds[0]=min(bounds[0],x);bounds[1]=min(bounds[1],y);bounds[2]=max(bounds[2],x);bounds[3]=max(bounds[3],y);
  }}}
 }
 Float64Array::from(bounds.as_slice()).into()
}
