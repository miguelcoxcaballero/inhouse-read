//! Original lamp pigments and material maps, produced in bounded row batches.
use crate::plant_preview::byte;
use std::f64::consts::PI;
/// # Safety
/// Output is width*count*8 bytes: RGBA pigment followed by RGBA material map.
/// Kinds: 0 wood, 1 linen, 2 black coating. No retained allocation or state.
#[no_mangle]
pub unsafe extern "C" fn lamp_surface_rows(width:usize,height:usize,row:usize,count:usize,kind:u32,output:*mut u8)->u32{
 if width==0||height==0||width>2048||height>2048||row>=height||count==0||count>16||count>height-row||kind>2{return 0;}
 let size=width*count*4;let (pigment,data)=std::slice::from_raw_parts_mut(output,size*2).split_at_mut(size);
 let coords:Vec<_>=(0..width).map(|x|x as f64/width as f64).collect();
 let thread:Vec<_>=if kind==1{coords.iter().map(|&u|(u*PI*160.0).cos()).collect()}else{Vec::new()};
 for offset in 0..count{
  let y=row+offset;let v=y as f64/height as f64;
  let wood_warp=if kind==0{(v*47.0).sin()*0.004}else{0.0};
  let thread_y=if kind==1{(v*PI*160.0).cos()}else{0.0};let slub_y=if kind==1{(v*19.0).sin()}else{0.0};
  for x in 0..width{
   let u=coords[x];let at=(offset*width+x)*4;
   let noise=((x as f64*12.9898+y as f64*78.233).sin()*43758.5453)%1.0;
   let (colour,relief,roughness)=if kind==0{
    let warp=(v*13.0+u*7.0).sin()*0.013+wood_warp;let fibre=((u+warp)*PI*72.0).sin();
    let grain=((u+warp)*PI*17.0).sin()*0.045+fibre*0.025+noise*0.012;let pore=(fibre-0.87).max(0.0)*0.13;
    ([0.73+grain-pore,0.55+grain*0.84-pore,0.34+grain*0.62-pore],0.5+fibre*0.17,0.63+noise*0.045)
   }else if kind==1{
    let thread_x=thread[x];let weave=thread_x*thread_y*0.025+(thread_x+thread_y)*0.012;let slub=(u*105.0+slub_y).sin()*0.01;
    ([0.92+weave+slub,0.862+weave+slub,0.745+weave+slub],0.5+(thread_x+thread_y)*0.18+noise*0.025,0.9+noise*0.025)
   }else{
    let grain=noise*0.012;([0.087+grain,0.091+grain,0.09+grain],0.5+noise*0.035,0.42+noise*0.055)
   };
   for channel in 0..3{pigment[at+channel]=byte(colour[channel]);}
   pigment[at+3]=255;data[at]=byte(relief);data[at+1]=byte(roughness);data[at+2]=0;data[at+3]=255;
  }
 }
 1
}

/// Absolute emission updates in the decor host's existing 16-f64 scratch arena.
/// Each material occupies intensity/R/G/B. At most four; current lamps use <=3.
/// # Safety
/// `values` contains four writable f64 per material; no allocation or callback.
#[no_mangle]
pub unsafe extern "C" fn lamp_emission_power(values: *mut f64, count: usize, power: f64) -> f64 {
    if count > 4 { return f64::NAN; }
    let value = if !power.is_finite() || power <= 0.0 { 0.0 } else if power >= 1.0 { 1.0 } else { power };
    let data = std::slice::from_raw_parts_mut(values, count * 4);
    for at in (0..data.len()).step_by(4) { data[at] *= value; }
    value
}
/// # Safety
/// As `lamp_emission_power`. RGB multiplications use the original f64 order.
#[no_mangle]
pub unsafe extern "C" fn lamp_emission_tint(values: *mut f64, count: usize, r: f64, g: f64, b: f64) -> u32 {
    if count > 4 { return 0; }
    let data = std::slice::from_raw_parts_mut(values, count * 4);
    for at in (0..data.len()).step_by(4) { data[at + 1] *= r; data[at + 2] *= g; data[at + 3] *= b; }
    1
}
