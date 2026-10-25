//! Immutable studio-shell colors. Positions are the host's existing Float32
//! sphere vertices; interpolation retains Three's f64 operation order.
use wasm_bindgen::prelude::*;
fn smoothstep(mut x:f64,min:f64,max:f64)->f64{
 if x<=min{return 0.0;}if x>=max{return 1.0;}
 x=(x-min)/(max-min);x*x*(3.0-2.0*x)
}
#[wasm_bindgen]
pub fn studio_shell_colors(positions:&[f32])->Result<Vec<f32>,JsValue>{
 if positions.len()%3!=0{return Err(js_sys::TypeError::new("Studio positions must contain complete vertices").into());}
 let floor=[0.068,0.05,0.037];let wall=[0.34,0.315,0.288];let ceiling=[0.5,0.485,0.46];
 let mut colors=vec![0.0;positions.len()];
 for (vertex,color) in positions.chunks_exact(3).zip(colors.chunks_exact_mut(3)){
  let y=f64::from(vertex[1])/10.0;
  let low=smoothstep(y,-0.32,-0.02);let high=smoothstep(y,0.3,0.85);
  for channel in 0..3{
   let base=floor[channel]+(wall[channel]-floor[channel])*low;
   color[channel]=(base+(ceiling[channel]-base)*high)as f32;
  }
 }
 Ok(colors)
}
