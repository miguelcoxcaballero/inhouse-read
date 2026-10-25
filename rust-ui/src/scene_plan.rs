//! The scene's plans: how the furniture and the room are laid out, how a record's size follows its
//! style, which clip keeps the foliage's hit target off the books, which frame is painted at what
//! size, why an image cannot be reused and what the diagnostics count. Three objects, the DOM and
//! every canvas stay in JavaScript; the values here follow the original arithmetic exactly.
use wasm_bindgen::prelude::*;
use crate::host::{jmax,jmin,js_round,number_string};
use crate::jsmath::{Box3,Mat4};
use crate::scene_view::{cl,or,RustScene};
#[path="scene_foliage.rs"] mod foliage;
#[path="scene_motion.rs"] mod motion;
#[path="scene_projection.rs"] mod projection;

fn put(out:&mut [f64],values:&[f64]){for (slot,value) in out.iter_mut().zip(values){*slot=*value;}}
fn is_integer(value:f64)->bool{value.is_finite()&&value.floor()==value}

/// Retained diagnostic input: moving objects does not change their counts or
/// texture resolutions. Compare exact bits before rebuilding strings or totals.
#[wasm_bindgen]
pub struct RustSceneCounts {
 input:Vec<f64>, previous:Vec<u64>, output:Box<[f64;8]>, text:String, dirty:bool,
}
#[wasm_bindgen]
impl RustSceneCounts {
 #[wasm_bindgen(constructor)]
 pub fn new()->Self{Self{input:Vec::new(),previous:Vec::new(),output:Box::new([0.0;8]),text:String::new(),dirty:true}}
 pub fn resize(&mut self,count:usize){self.input.resize(count*5,0.0);self.previous.resize(count*5,0);self.dirty=true;}
 pub fn memory(&self)->JsValue{wasm_bindgen::memory()}
 pub fn input_ptr(&self)->usize{self.input.as_ptr() as usize}
 pub fn output_ptr(&self)->usize{self.output.as_ptr() as usize}
 pub fn sample(&mut self)->bool{
  if !self.dirty&&self.input.iter().zip(&self.previous).all(|(value,bits)|value.to_bits()==*bits){return false;}
  self.text=scene_counts(&self.input,&mut self.output[..]);
  for (bits,value) in self.previous.iter_mut().zip(&self.input){*bits=value.to_bits();}
  self.dirty=false;true
 }
 pub fn resolutions(&self)->String{self.text.clone()}
}

/// `Math.imul(casters, 31) + id | 0` over the ids of the models that cast shadows, starting from
/// whether the bin is visible: changes whenever a shadow caster appears, goes or is replaced.
#[wasm_bindgen]
pub fn scene_casters(trash_visible:bool,ids:&[f64])->i32{
 let mut casters:i32=if trash_visible{1}else{0};
 for id in ids{
  let product=casters.wrapping_mul(31);
  // The sum is made in doubles; `| 0` keeps its low 32 bits.
  let sum=f64::from(product)+id;
  casters=if sum.is_finite(){(sum.trunc().rem_euclid(4294967296.0)) as u32 as i32}else{0};
 }
 casters
}

/// The daylight left over by the lamps that are on: a lit room is dimmer by this much.
#[wasm_bindgen]
pub fn scene_daylight(lamp_power:f64,baggebo:bool)->f64{1.0-lamp_power*if baggebo{0.18}else{0.3}}

/// The diagnostics' counts from one number group per entry (kind, shown, quality pending, overview,
/// resolution): `[plants, high plants, lamps, overview, detailed, high books, pending, books]`, then the
/// books' resolutions as JSON.
#[wasm_bindgen]
pub fn scene_counts(entries:&[f64],out:&mut [f64])->String{
 let (mut plants,mut high_plants,mut lamps,mut overview,mut detailed,mut high_books,mut pending,mut books)=(0.0,0.0,0.0,0.0,0.0,0.0,0.0,0u32);
 let mut resolutions:Vec<String>=Vec::new();
 for entry in entries.chunks_exact(5){
  if entry[2]!=0.0{pending+=1.0;}
  if entry[1]==0.0{continue;}
  let resolution=or(entry[4],0.0);
  if entry[0]==1.0{plants+=1.0;if resolution!=0.0{high_plants+=1.0;}}
  else if entry[0]==2.0{lamps+=1.0;}
  else{
   if entry[3]!=0.0{overview+=1.0;}else{detailed+=1.0;}
   if resolution!=0.0{high_books+=1.0;}
   // JSON.stringify writes a number as String(number) except for NaN and Infinity, which it writes as null.
   resolutions.push(if resolution.is_finite(){number_string(resolution)}else{"null".to_string()});
   books+=1;
  }
 }
 put(out,&[plants,high_plants,lamps,overview,detailed,high_books,pending,f64::from(books)]);
 format!("[{}]",resolutions.join(","))
}

/// Why a retained inspection image cannot be shown now, from the reasons that matter in the order
/// they are checked; empty when it can. Bits: no 2D context, no image, content dirty, shadow dirty, the
/// scene moving, the shadow still settling, a transition running, the drop guide shown.
#[wasm_bindgen]
pub fn scene_cache_miss(bits:u32)->String{
 for (bit,reason) in [(1u32,"no-context"),(2,"no-snapshot"),(4,"content-dirty"),(8,"shadow-dirty"),(16,"scene-moving"),(32,"shadow-settling"),(64,"transition"),(128,"drop-guide")]{
  if bits&bit!=0{return reason.to_string();}
 }
 String::new()
}

/// A record whose book or style changed: its new size and place. `io` in: `[y, height, width, thickness,
/// old style's height ratio, new style's height ratio, cover ratio, style width, has dimensions,
/// has row, row top, row bottom, usable depth, scale]`; out: the new `[y, height, width, thickness]` at 14.
/// A record given its dimensions keeps them (the host applies them); one without is fitted to its shelf.
#[wasm_bindgen]
pub fn scene_record_dimensions(io:&mut [f64]){
 if io.len()<18{return;}
 let (y,height,width,thickness)=(io[0],io[1],io[2],io[3]);
 let baseline=y+height/2.0;
 let previous_ratio=width/height;
 let base_height=height/or(io[4],1.0);
 let mut new_height=base_height*or(io[5],or(io[4],1.0));
 let ratio=io[6];
 let mut new_width=new_height*if ratio>0.0&&ratio.is_finite(){cl(ratio,0.25,2.5)}else{previous_ratio};
 let new_thickness=or(io[7],thickness);
 let mut new_y=baseline-new_height/2.0;
 if io[8]==0.0{
  let fit=jmin(jmin(1.0,io[12]*io[13]/new_width),if io[9]!=0.0{(io[11]-io[10]-4.0*io[13])/new_height}else{1.0});
  new_height*=fit;new_width*=fit;new_y=baseline-new_height/2.0;
 }
 put(&mut io[14..18],&[new_y,new_height,new_width,new_thickness]);
}

/// The foliage's clip, or nothing when none of its inputs moved. Both lists are
/// `[reference left, right, top, bottom, width, height, rectangle left, top, width, height]` followed by the
/// books' rectangles `left, right, top, bottom`: the clip is a pure function of them. Inside the books'
/// rectangles the native book surface already resolves true mesh occlusion, so the clip keeps those
/// taps native even if foliage is behind a cover.
#[wasm_bindgen]
pub fn scene_foliage_clip(previous:&[f64],current:&[f64])->String{
 if current.len()<10{return String::new();}
 let unchanged=previous.len()==current.len()&&previous.iter().zip(current.iter()).all(|(a,b)|a==b);
 if unchanged{return String::new();}
 foliage_clip(&current[..6],&current[6..10],&current[10..])
}

fn foliage_clip(reference:&[f64],rect:&[f64],exclusions:&[f64])->String{
 let stable=|value:f64|js_round(value*1000.0)/1000.0;
 let to_reference=|bounds:&[f64]|->[f64;4]{[
  stable(reference[0]+(bounds[0]-rect[0])*reference[4]/rect[2]),
  stable(reference[0]+(bounds[1]-rect[0])*reference[4]/rect[2]),
  stable(reference[2]+(bounds[2]-rect[1])*reference[5]/rect[3]),
  stable(reference[2]+(bounds[3]-rect[1])*reference[5]/rect[3])]};
 let path=|b:[f64;4]|{let (l,r,t,bo)=(number_string(b[0]),number_string(b[1]),number_string(b[2]),number_string(b[3]));format!("M{l},{t}H{r}V{bo}H{l}Z")};
 let mapped:Vec<f64>=exclusions.chunks_exact(4).flat_map(to_reference).collect();
 let mut clip=path([reference[0],reference[1],reference[2],reference[3]]);
 for strip in crate::scene_view::scene_disjoint_rects(&mapped,&[reference[0],reference[1],reference[2],reference[3]]).chunks_exact(4){
  clip.push_str(&path([strip[0],strip[1],strip[2],strip[3]]));
 }
 clip
}

#[wasm_bindgen]
impl RustScene{
 /// The key's shadow is fitted to the cabinet (and bin) in world space: `out = [min x, y, z, max x, y, z]`.
 #[wasm_bindgen(js_name=shadowBounds)]
 pub fn shadow_bounds(&self,trash:&[f64],transform:&[f64],out:&mut [f64]){
  let mut b=self.full;
  if trash.len()>=9{
   let mut bin=Box3{min:[trash[0],trash[1],trash[2]],max:[trash[3],trash[4],trash[5]]};
   for axis in 0..3{bin.min[axis]+=trash[6+axis];bin.max[axis]+=trash[6+axis];}
   b.union(&bin);
  }
  if transform.len()>=16{let mut e=[0.0;16];e.copy_from_slice(&transform[..16]);b.apply(&Mat4(e));}
  put(out,&[b.min[0],b.min[1],b.min[2],b.max[0],b.max[1],b.max[2]]);
 }

 /// The size of the frame painted at this ratio and what keeps it on whole device pixels. In: the
 /// retained image is shown, the ratio, the canvas's `left, top` (NaN without a canvas). Out: the overscan
 /// margin, the frame's width and height, and bits: the pixel grid fits (aligned canvas and margin), the
 /// frame is whole device pixels, the canvas's corner is finite.
 #[wasm_bindgen(js_name=capturePlan)]
 pub fn capture_plan(&self,cache_inspection:bool,ratio:f64,canvas_left:f64,canvas_top:f64,out:&mut [f64]){
  // About a finger's width beyond every edge lets an already zoomed view pan for many frames before
  // rebasing. A multiple of four lands the clipped overscan on whole device pixels at every usual ratio.
  let margin=if cache_inspection{(jmin(128.0,self.viewport_height/4.0)/4.0).floor()*4.0}else{0.0};
  let (width,height)=(self.scene_width+margin*2.0,self.viewport_height+margin*2.0);
  let has_canvas=!canvas_left.is_nan()||!canvas_top.is_nan();
  let aligned=has_canvas&&is_integer(canvas_left*ratio)&&is_integer(canvas_top*ratio)
   &&(margin==0.0||(is_integer(self.scene_width*ratio)&&is_integer(self.viewport_height*ratio)&&is_integer(margin*ratio)));
  let whole=is_integer(width*ratio)&&is_integer(height*ratio);
  let finite=canvas_left.is_finite()&&canvas_top.is_finite();
  put(out,&[margin,width,height,f64::from((aligned as u32)|((whole as u32)<<1)|((finite as u32)<<2))]);
 }

 /// The furniture's layout: `[unit scale, gap, floor width, floor depth, floor x, floor y, floor z, room span,
 /// wall y, wall z]` for the cabinet width, the floor's height and the unit width, then each unit's centre.
 #[wasm_bindgen(js_name=roomPlan)]
 pub fn room_plan(&self,unit_width:f64,spec_width:f64,baggebo_width:f64,units:f64,floor_y:f64,out:&mut [f64]){
  let scale=unit_width/spec_width;let gap=24.0*scale;
  let span=jmax(jmax(self.width,self.height),self.scene_width)*24.0;
  put(out,&[scale,gap,self.width+210.0,self.depth+210.0,55.0,floor_y-1.0,-self.depth/2.0+45.0,span,-self.height/2.0,
   -self.depth-28.0*unit_width/baggebo_width]);
  for index in 0..(units.ceil() as usize).min(out.len().saturating_sub(10)){
   if 10+index<out.len(){out[10+index]=-self.width/2.0+unit_width/2.0+(index as f64)*(unit_width+gap);}
  }
 }

 /// Where the bin stands: clear of the room's wall with its whole body and the lid's sweep, in front of the
 /// cabinet's right side. In: its radius, the sweep's nearest `z` and lowest `y`, the wall's `z`.
 #[wasm_bindgen(js_name=trashStand)]
 pub fn trash_stand(&self,radius:f64,sweep_min_z:f64,sweep_min_y:f64,wall_z:f64,floor_y:f64,gap:f64,out:&mut [f64]){
  put(out,&[self.width/2.0+gap+radius,floor_y-sweep_min_y,jmax(-self.depth,wall_z-sweep_min_z+gap)]);
 }
}
