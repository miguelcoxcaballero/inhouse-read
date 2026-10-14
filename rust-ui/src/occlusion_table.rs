//! The contact-shadow painter's angle table: cosine and sine of the 20 light directions (four
//! corners of five steps) and of the 20 foot-ring points. The core's kernel has no trigonometry
//! (its own would differ from the browser's in the last bit), so the table comes from the host's
//! `Math` and is read once.
use wasm_bindgen::prelude::*;

/// `[cos, sin]` pairs: 20 light directions first, then 20 foot-ring points (80 numbers).
#[wasm_bindgen]
pub fn occlusion_angles()->Vec<f64>{
 let mut table=vec![0.0;80];
 for i in 0..20usize{
  let (corner,k)=((i/5) as f64,(i%5) as f64);
  let light=(corner*4.0+k)*std::f64::consts::PI/8.0;
  let foot=i as f64/20.0*std::f64::consts::PI*2.0;
  table[i*2]=js_sys::Math::cos(light);table[i*2+1]=js_sys::Math::sin(light);
  table[40+i*2]=js_sys::Math::cos(foot);table[40+i*2+1]=js_sys::Math::sin(foot);
 }
 table
}
