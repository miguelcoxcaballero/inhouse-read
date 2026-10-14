//! The shelf wastebasket's numbers: the book's flight into its mouth, the powder-coat texture and
//! the leaned shading normals. Three objects (geometry, materials, the Vector3 handed back to the
//! scene) stay in JavaScript; every value computed here follows the original arithmetic exactly,
//! with the host's `Math.sin` and the same operation order.
use wasm_bindgen::prelude::*;
use crate::host::{jmax,jmin,num};

fn unit(value:f64)->f64{jmin(1.0,jmax(0.0,if value.is_nan()||value==0.0{0.0}else{value}))}
fn smooth(value:f64)->f64{value*value*(3.0-2.0*value)}

/// `[x, y, z, scale, turn, fall]`: the book travels above the open rim, then falls into the actual
/// hollow body. All positions use the cabinet's world axes and shared camera. `progress` is
/// coerced like the original's `Number(progress) || 0`.
#[wasm_bindgen]
#[allow(clippy::too_many_arguments)]
pub fn sample_trash_drop(start_x:f64,start_y:f64,start_z:f64,mouth_x:f64,mouth_y:f64,mouth_z:f64,progress:&JsValue,height:f64,scale:f64,end_scale:f64)->Vec<f64>{
 let t=unit(num(progress));let travel=unit(t/0.68);let amount=smooth(travel);
 let arc=jmin(100.0,jmax(28.0,(start_y-mouth_y).abs()*0.16+height*0.2));
 let fall=smooth(unit((t-0.68)/0.32));
 let swing=js_sys::Math::sin(travel*std::f64::consts::PI);
 let x=start_x+(mouth_x-start_x)*amount;
 let y=start_y+(mouth_y-start_y)*amount;
 let z=start_z+(mouth_z-start_z)*amount;
 // Make room for the cover before its broad face turns towards the camera, so a book dragged
 // into a narrow right gutter is not cut by the edge of the shared canvas while it rotates.
 vec![x,y+(swing*arc-fall*height*end_scale*1.75),z+swing*36.0,
  scale+(end_scale-scale)*smooth(unit(t/0.48)),smooth(unit(t/0.76)),fall]
}

/// Fine orange-peel texture of a powder coat, 64 x 64 RGBA: R relief, G roughness. A tiny
/// deterministic field, generated once per bin; no downloads or idle work.
#[wasm_bindgen]
pub fn powder_coat()->Vec<u8>{
 const SIZE:usize=64;
 let lattice=|x:i32,y:i32|->f64{
  let mut h=((x&15)+1).wrapping_mul(0x27d4eb2d)^((y&15)+1).wrapping_mul(0x165667b1);
  h=(h^((h as u32)>>15) as i32).wrapping_mul(0x85ebca6b_u32 as i32);
  f64::from((h^((h as u32)>>13) as i32) as u32)/4294967296.0
 };
 let mut bytes=vec![0u8;SIZE*SIZE*4];
 for y in 0..SIZE{for x in 0..SIZE{
  let (u,v)=(x as f64/4.0,y as f64/4.0);
  let (xi,yi)=(u.floor(),v.floor());
  let (fx,fy)=(smooth(u-xi),smooth(v-yi));
  let (xi,yi)=(xi as i32,yi as i32);
  let (a,b,c,d)=(lattice(xi,yi),lattice(xi+1,yi),lattice(xi,yi+1),lattice(xi+1,yi+1));
  let peel=a+(b-a)*fx+(c-a)*fy+(a-b-c+d)*fx*fy;
  let at=(y*SIZE+x)*4;
  // Both channels stay positive and within a byte, where Rust's round equals Math.round.
  bytes[at]=(255.0*(0.35+peel*0.3)).round() as u8;
  bytes[at+1]=(255.0*(0.82+peel*0.18)).round() as u8;
  bytes[at+3]=255;
 }}
 bytes
}

/// A true vertical wall mirrors only the dark floor under the shelf camera: leaning the shading
/// normals of vertices `from..=to` of every profile ring slightly upwards lets the window and key
/// light sweep a soft vertical sheen across it. Each normal is `normalize(n + (0, amount, 0))` as
/// three computes it (a multiplication by 1 / length), stored back as a float. Indices past the
/// array are skipped, as writes past a typed array are.
#[wasm_bindgen]
pub fn lean_normals(normals:&mut [f32],segments:u32,rows:u32,from:u32,to:u32,amount:f64){
 for i in 0..=u64::from(segments){for j in u64::from(from)..=u64::from(to){
  let at=(i*u64::from(rows)+j)*3;
  if at+2>=normals.len() as u64{continue;}
  let at=at as usize;
  let (x,y,z)=(f64::from(normals[at]),f64::from(normals[at+1])+amount,f64::from(normals[at+2]));
  let length=(x*x+y*y+z*z).sqrt();
  let inverse=1.0/if length!=0.0&&!length.is_nan(){length}else{1.0};
  normals[at]=(x*inverse) as f32;normals[at+1]=(y*inverse) as f32;normals[at+2]=(z*inverse) as f32;
 }}
}
