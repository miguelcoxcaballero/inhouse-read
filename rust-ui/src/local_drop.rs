//! Pointer placement in the physical room reserves a gap for the selected
//! object. It never repacks a crowded row or spills neighbours to other bays.
use wasm_bindgen::prelude::*;
#[wasm_bindgen]
pub fn shelf_local_drop(items:&[f64],selected:usize,row:f64,x:f64,width:f64,padding:f64,gap:f64)->Vec<f64>{
 if items.len()%4!=0||selected>=items.len()/4||items.iter().any(|v|!v.is_finite())||[row,x,width,padding,gap].iter().any(|v|!v.is_finite())||row<0.0||row.fract()!=0.0||padding<0.0||gap<0.0{return vec![];}
 let own=&items[selected*4..selected*4+4];let half=own[2]/2.0;let available=width-2.0*padding;
 if own[2]<=0.0||available<own[2]{return vec![];}
 let low=padding+half;let high=width-padding-half;let desired=(padding+x.clamp(0.0,1.0)*available).clamp(low,high);
 let others:Vec<_>=items.chunks_exact(4).enumerate().filter(|(i,item)|*i!=selected&&item[0]==row&&item[3]==own[3]).map(|(_,item)|item).collect();
 let mut candidates=vec![desired,low,high];
 for other in &others{candidates.extend([other[1]-gap-half,other[1]+other[2]+gap+half]);}
 candidates.sort_by(|a,b|(a-desired).abs().total_cmp(&(b-desired).abs()).then(a.total_cmp(b)));
 for center in candidates{
  if center<low||center>high{continue;}
  if others.iter().all(|other|center+half+gap<=other[1]+1e-6||center-half>=other[1]+other[2]+gap-1e-6){return vec![row,(center-padding)/available];}
 }
 vec![]
}
