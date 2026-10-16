//! The live shelf scene's view: where the camera frames the furniture, how a turn between the
//! frontal and the diagonal view advances, the inspection zoom and pan, the drop guide and the
//! boxes the projected buttons are fitted to. Three objects, the DOM and every canvas stay in
//! JavaScript; each value here follows the original arithmetic exactly (f64 operation order,
//! `Math.min`/`Math.max` semantics, the host's own `Math.cos`/`Math.sin`/`Math.hypot`/`Math.round`).
use wasm_bindgen::prelude::*;
use js_sys::Array;
use crate::host::{finite,jmax,jmin,js_round,num,number_string};
use crate::jsmath::{Box3,Mat4};

const DURATION:f64=700.0;
const TRASH_PADDING:f64=7.0;

/// The scene's `ease`: a quintic smoothstep.
pub fn ease(t:f64)->f64{t*t*t*(t*(t*6.0-15.0)+10.0)}
/// The scene's `clamp(n, lo, hi)`: `Math.min(hi, Math.max(lo, n))`.
pub fn cl(n:f64,lo:f64,hi:f64)->f64{jmin(hi,jmax(lo,n))}
/// `value || fallback` for a number.
pub fn or(value:f64,fallback:f64)->f64{if value!=0.0&&!value.is_nan(){value}else{fallback}}

fn matrix(values:&[f64])->Option<Mat4>{
 if values.len()<16{return None;}
 let mut e=[0.0;16];e.copy_from_slice(&values[..16]);Some(Mat4(e))
}
fn bounds(values:&[f64])->Option<Box3>{
 if values.len()<6{return None;}
 Some(Box3{min:[values[0],values[1],values[2]],max:[values[3],values[4],values[5]]})
}

/// `[left, right, top, bottom, width, height, closest]` of a box's eight corners under a matrix,
/// the way the scene projects every slot, hit surface and bin: the screen's y runs downwards.
pub fn corners_of(b:&Box3,m:&Mat4)->[f64;7]{
 let (mut left,mut right,mut top,mut bottom,mut closest)=(f64::INFINITY,f64::NEG_INFINITY,f64::INFINITY,f64::NEG_INFINITY,f64::NEG_INFINITY);
 for corner in 0..8u32{
  let p=[if corner&4!=0{b.max[0]}else{b.min[0]},if corner&2!=0{b.max[1]}else{b.min[1]},if corner&1!=0{b.max[2]}else{b.min[2]}];
  let v=m.apply(p);
  left=jmin(left,v[0]);right=jmax(right,v[0]);top=jmin(top,-v[1]);bottom=jmax(bottom,-v[1]);closest=jmax(closest,v[2]);
 }
 [left,right,top,bottom,right-left,bottom-top,closest]
}

/// `out = [left, right, top, bottom, width, height, closest]`; NaN throughout for malformed input.
#[wasm_bindgen]
pub fn scene_corners(bounds_box:&[f64],transform:&[f64],out:&mut [f64]){
 let (Some(b),Some(m))=(bounds(bounds_box),matrix(transform))else{for v in out.iter_mut(){*v=f64::NAN}return};
 let rect=corners_of(&b,&m);
 for (slot,value) in out.iter_mut().zip(rect){*slot=value;}
}

/// Disjoint strips for an even-odd clip: a true union of the excluded rectangles, which would
/// otherwise cancel each other where they overlap. `rects` and `outer` are
/// `[left, right, top, bottom]`; the strips come back in the same layout.
#[wasm_bindgen]
pub fn scene_disjoint_rects(rects:&[f64],outer:&[f64])->Vec<f64>{
 if outer.len()<4{return Vec::new();}
 let clipped:Vec<[f64;4]>=rects.chunks_exact(4).map(|r|[jmax(r[0],outer[0]),jmin(r[1],outer[1]),jmax(r[2],outer[2]),jmin(r[3],outer[3])])
  .filter(|r|r[1]>r[0]&&r[3]>r[2]).collect();
 // `new Set` keeps the first of equal values (+0 and -0 are one); `sort((a, b) => a - b)` is stable.
 let mut edges:Vec<f64>=Vec::new();
 for rect in &clipped{for edge in [rect[0],rect[1]]{if !edges.iter().any(|known|*known==edge||(known.is_nan()&&edge.is_nan())){edges.push(edge);}}}
 edges.sort_by(|a,b|{let d=a-b;if d<0.0{std::cmp::Ordering::Less}else if d>0.0{std::cmp::Ordering::Greater}else{std::cmp::Ordering::Equal}});
 let mut strips:Vec<f64>=Vec::new();
 for i in 0..edges.len().saturating_sub(1){
  let (left,right)=(edges[i],edges[i+1]);
  let mut intervals:Vec<&[f64;4]>=clipped.iter().filter(|r|r[0]<right&&r[1]>left).collect();
  intervals.sort_by(|a,b|{let d=a[2]-b[2];if d<0.0{std::cmp::Ordering::Less}else if d>0.0{std::cmp::Ordering::Greater}else{std::cmp::Ordering::Equal}});
  // The last strip pushed is the one still growing.
  let mut open:Option<usize>=None;
  for interval in intervals{
   match open{
    Some(at) if interval[2]<=strips[at*4+3]=>{strips[at*4+3]=jmax(strips[at*4+3],interval[3]);}
    _=>{strips.extend_from_slice(&[left,right,interval[2],interval[3]]);open=Some(strips.len()/4-1);}
   }
  }
 }
 strips
}

/// Where a ray from the camera lands on the shelf: `[shelf, x]`, then `1` for an under-shelf mount,
/// or nothing when the ray misses the mounting plane. Bottom-standing objects project onto the
/// front plane; under-shelf fixtures project at their mounting depth and snap to the nearest ceiling.
/// `rows` holds seven numbers per shelf: `top, bottom, left, right, ceiling, padding` and a mask of
/// which of `left`, `right`, `ceiling` and `padding` the shelf actually has (bits 0 to 3).
#[wasm_bindgen]
pub fn scene_drop_position(ray:&[f64],furniture:&[f64],rows:&[f64],width:f64,padding:f64,undershelf:bool,mounting_depth:f64)->Vec<f64>{
 let count=rows.len()/7;
 if ray.len()<6||count==0||!width.is_finite()||width<=padding*2.0{return Vec::new();}
 let Some(mut inverse)=matrix(furniture)else{return Vec::new()};
 inverse.invert();
 let origin=inverse.apply([ray[0],ray[1],ray[2]]);
 let direction=inverse.transform_direction([ray[3],ray[4],ray[5]]);
 // Ray#intersectPlane with the plane z = mounting depth (normal (0, 0, 1), constant mounting depth).
 let dot=|v:[f64;3]|v[0]*0.0+v[1]*0.0+v[2]*1.0;
 let denominator=dot(direction);
 let t=if denominator==0.0{if dot(origin)+mounting_depth==0.0{Some(0.0)}else{None}}
  else{let t=-(dot(origin)+mounting_depth)/denominator;if t>=0.0{Some(t)}else{None}};
 let Some(t)=t else{return Vec::new()};
 // Ray#at: the direction scaled, then the origin added.
 let point=[direction[0]*t+origin[0],direction[1]*t+origin[1],direction[2]*t+origin[2]];
 let y=-point[1];
 let row=|index:usize|{
  let at=index*7;let mask=rows[at+6] as u32;
  let (top,bottom)=(rows[at],rows[at+1]);
  (top,bottom,if mask&1!=0{rows[at+2]}else{0.0},if mask&2!=0{rows[at+3]}else{width},if mask&4!=0{rows[at+4]}else{top},if mask&8!=0{rows[at+5]}else{padding})
 };
 let (mut shelf,mut nearest)=(0usize,f64::INFINITY);
 for index in 0..count{
  let (top,bottom,left,right,ceiling,_)=row(index);
  let local_x=point[0]+width/2.0;
  let dx=if local_x<left{left-local_x}else if local_x>right{local_x-right}else{0.0};
  let dy=if undershelf{(y-ceiling).abs()}else if y<top{top-y}else if y>bottom{y-bottom}else{0.0};
  let distance=crate::host::hypot(dx,dy);
  if distance<nearest{nearest=distance;shelf=index;}
 }
 let (_,_,left,right,_,inset)=row(shelf);
 vec![shelf as f64,cl((point[0]+width/2.0-left-inset)/(right-left-inset*2.0),0.0,1.0),if undershelf{1.0}else{0.0}]
}

/// The drop guide's pose on a shelf: `[x, y, z, bar y, bar height, foot y]`, `rows` as above.
fn drop_marker(row:&[f64],width:f64,depth:f64,x:f64,undershelf:bool)->[f64;6]{
 let mask=row[6] as u32;
 let (top,bottom)=(row[0],row[1]);
 let ceiling=if mask&4!=0{row[4]}else{top};
 let height=if undershelf{cl((bottom-ceiling)*0.08,12.0,24.0)}else{cl((bottom-top)*0.82,60.0,180.0)};
 let (left,right,padding)=(if mask&1!=0{row[2]}else{0.0},if mask&2!=0{row[3]}else{width},if mask&8!=0{row[5]}else{16.0});
 [-width/2.0+left+padding+x*(right-left-padding*2.0),-(if undershelf{ceiling}else{bottom}),if undershelf{-depth/2.0}else{13.0},
  (if undershelf{-1.0}else{1.0})*height/2.0,height,if undershelf{-1.0}else{1.0}]
}

struct Transition{from:f64,to:f64,elapsed:f64,last_frame:f64,scroll_from:f64,scroll_to:f64}

/// The scene's view state: the turn between the frontal and the diagonal camera, the inspection
/// zoom and pan, the drop guide and the sizes everything is fitted to.
#[wasm_bindgen]
pub struct RustScene{
 pub(crate) width:f64,pub(crate) height:f64,pub(crate) scene_width:f64,pub(crate) depth:f64,baggebo:bool,full:Box3,
 pub(crate) progress:f64,pub(crate) isometric:bool,frontal_scroll:f64,transition:Option<Transition>,reorder_started:Option<f64>,
 pub(crate) fit_height:f64,edge_to_edge:bool,pub(crate) viewport_height:f64,
 pub(crate) zoom:f64,pan_x:f64,pan_y:f64,moving:bool,shadow_refit:bool,
 drop:Option<(f64,f64,bool)>,
 // The bin: whether the pointer is over it, how far its lid is open and the lid's current ease.
 // The frame's constants for the entries (see `beginEntries`).
 pub(crate) entry_now:f64,pub(crate) entry_reduced:bool,pub(crate) entry_zoom:f64,pub(crate) entry_q:[f64;4],
 pub(crate) entry_ratio:f64,pub(crate) entry_window:f64,pub(crate) entry_scroll:f64,pub(crate) entry_lamp_tap:f64,
 pub(crate) trash_hover:bool,pub(crate) trash_openness:f64,pub(crate) trash_transition:Option<(f64,f64,f64)>,
}

fn full_bounds(width:f64,height:f64,depth:f64,baggebo:bool)->Box3{
 if baggebo{Box3{min:[-width/2.0,-height,-depth],max:[width/2.0,0.0,0.0]}}
 else{Box3{min:[-width/2.0,-height,-depth-4.0],max:[width/2.0,2.0,12.0]}}
}

#[wasm_bindgen]
impl RustScene{
 /// `scene_width` is the already coerced `Math.max(1, Number(sceneWidth) || width)`.
 #[wasm_bindgen(constructor)]
 pub fn new(width:f64,height:f64,scene_width:f64,depth:f64,baggebo:bool,isometric:bool,scroll_top:f64)->RustScene{
  RustScene{width,height,scene_width,depth,baggebo,full:full_bounds(width,height,depth,baggebo),
   progress:if isometric{1.0}else{0.0},isometric,frontal_scroll:if isometric{0.0}else{scroll_top},transition:None,reorder_started:None,
   fit_height:1.0,edge_to_edge:false,viewport_height:1.0,zoom:1.0,pan_x:0.0,pan_y:0.0,moving:false,shadow_refit:false,drop:None,
   entry_now:0.0,entry_reduced:false,entry_zoom:1.0,entry_q:[0.0,0.0,0.0,1.0],entry_ratio:1.0,entry_window:0.0,entry_scroll:0.0,entry_lamp_tap:44.0,
   trash_hover:false,trash_openness:0.0,trash_transition:None}
 }
 /// A new semantic layout: the sizes and the furniture's bounds change, the view does not.
 pub fn configure(&mut self,width:f64,height:f64,scene_width:f64,depth:f64,baggebo:bool){
  self.width=width;self.height=height;self.scene_width=scene_width;self.depth=depth;self.baggebo=baggebo;
  self.full=full_bounds(width,height,depth,baggebo);
 }
 #[wasm_bindgen(getter)]pub fn progress(&self)->f64{self.progress}
 #[wasm_bindgen(getter)]pub fn isometric(&self)->bool{self.isometric}
 #[wasm_bindgen(getter)]pub fn zoom(&self)->f64{self.zoom}
 #[wasm_bindgen(getter,js_name=panX)]pub fn pan_x(&self)->f64{self.pan_x}
 #[wasm_bindgen(getter,js_name=panY)]pub fn pan_y(&self)->f64{self.pan_y}
 #[wasm_bindgen(getter)]pub fn moving(&self)->bool{self.moving}
 #[wasm_bindgen(getter,js_name=fitHeight)]pub fn fit_height_value(&self)->f64{self.fit_height}
 #[wasm_bindgen(getter,js_name=viewportHeight)]pub fn viewport_height_value(&self)->f64{self.viewport_height}
 #[wasm_bindgen(getter,js_name=sceneWidth)]pub fn scene_width_value(&self)->f64{self.scene_width}
 #[wasm_bindgen(getter,js_name=shadowRefit)]pub fn shadow_refit_value(&self)->bool{self.shadow_refit}
 #[wasm_bindgen(setter,js_name=shadowRefit)]pub fn set_shadow_refit(&mut self,value:bool){self.shadow_refit=value;}
 pub(crate) fn transition_none(&self)->bool{self.transition.is_none()}
 /// Whether a turn between the views is under way.
 #[wasm_bindgen(getter)]pub fn turning(&self)->bool{self.transition.is_some()}
 #[wasm_bindgen(getter)]pub fn reordering(&self)->bool{self.reorder_started.is_some()}
 /// The bar is settled at the isometric endpoint: the inspection gestures may start.
 #[wasm_bindgen(js_name=canInspect)]
 pub fn can_inspect(&self)->bool{self.isometric&&self.transition.is_none()&&self.progress==1.0}

 /// `setMode`'s state change. Returns the scroll position the view settles at.
 /// `animate` is false for a reduced-motion preference too: the move is then immediate.
 #[wasm_bindgen(js_name=setMode)]
 pub fn set_mode(&mut self,isometric:bool,animate:bool,now:f64,scroll_top:f64)->f64{
  let was=self.isometric;
  self.isometric=isometric;
  let target=if isometric{1.0}else{0.0};
  if !isometric{self.zoom=1.0;self.pan_x=0.0;self.pan_y=0.0;self.moving=false;}
  if isometric&&!was{self.frontal_scroll=scroll_top;}
  let scroll_to=if isometric{0.0}else{self.frontal_scroll};
  if !animate{self.progress=target;self.transition=None;}
  else{self.transition=Some(Transition{from:self.progress,to:target,elapsed:0.0,last_frame:now,scroll_from:scroll_top,scroll_to});}
  scroll_to
 }
 /// One frame of the turn, on the bounded clock the insertion and trash animations use.
 /// Returns the scroll position of this frame, or nothing when no turn is under way.
 #[wasm_bindgen(js_name=stepTurn)]
 pub fn step_turn(&mut self,now:f64)->Option<f64>{
  let t=self.transition.as_mut()?;
  t.elapsed+=jmin(50.0,jmax(0.0,now-t.last_frame));
  t.last_frame=now;
  let k=cl(t.elapsed/DURATION,0.0,1.0);
  self.progress=t.from+(t.to-t.from)*ease(k);
  let scroll=t.scroll_from+(t.scroll_to-t.scroll_from)*ease(k);
  if k==1.0{self.transition=None;}
  Some(scroll)
 }
 #[wasm_bindgen(js_name=beginReorder)]
 pub fn begin_reorder(&mut self,now:f64){self.reorder_started=Some(now);}
 /// One frame of a reorder release: how much of each item's former offset is left, or nothing.
 #[wasm_bindgen(js_name=stepReorder)]
 pub fn step_reorder(&mut self,now:f64)->Option<f64>{
  let started=self.reorder_started?;
  let t=cl((now-started)/520.0,0.0,1.0);
  if t==1.0{self.reorder_started=None;}
  Some(1.0-ease(t))
 }
 /// The reorder's start, for the landing animation that shares its clock.
 #[wasm_bindgen(getter,js_name=reorderStarted)]
 pub fn reorder_start(&self)->f64{self.reorder_started.unwrap_or(f64::NAN)}

 /// The height the fitted room may use: from the viewport's bottom down to the stage's resting top.
 #[wasm_bindgen(js_name=measureFit)]
 pub fn measure_fit(&mut self,inner_height:f64,clip_top:f64,clip_bottom:f64,resting_top:f64,bottom_padding:f64,edge_to_edge:bool)->f64{
  self.edge_to_edge=edge_to_edge;
  self.fit_height=jmax(1.0,(jmin(inner_height,clip_bottom)-jmax(clip_top,resting_top)-bottom_padding).floor()-if edge_to_edge{0.0}else{2.0});
  self.fit_height
 }
 #[wasm_bindgen(getter,js_name=edgeToEdge)]pub fn edge_to_edge_value(&self)->bool{self.edge_to_edge}

 /// The camera's framing of the furniture at the current progress and inspection. `trash` is
 /// `[min x, y, z, max x, y, z, position x, y, z]` of the bin or empty; `rooftop` the highest top of
 /// a plant or lamp standing on the roof (`-Infinity` for none). Writes
 /// `[yaw, pitch, zoom, x, y, reserve, stage height, in frame]` into `out` and returns the
 /// canvas diagnostics as text, in the order the scene writes them.
 pub fn transform(&mut self,trash:&[f64],rooftop:f64,floor_visible:bool,unit_count:f64,out:&mut [f64])->Array{
  let progress=self.progress;
  let yaw=-std::f64::consts::PI/6.0*progress;
  let pitch=14.0*std::f64::consts::PI/180.0*progress;
  let rotation=quaternion_xyz(pitch,yaw,0.0);
  let place=|scale:f64,position:[f64;3]|Mat4::compose(position,rotation,[scale,scale,scale]);
  let unscaled=corners_of(&self.full,&place(1.0,[0.0;3]));
  let padding=(if self.edge_to_edge{0.0}else{8.0})*progress;
  let mut framed_bounds=self.full;
  framed_bounds.max[1]=jmax(framed_bounds.max[1],rooftop);
  if trash.len()>=9{
   let mut bin=Box3{min:[trash[0],trash[1],trash[2]],max:[trash[3],trash[4],trash[5]]};
   for axis in 0..3{bin.min[axis]+=trash[6+axis];bin.max[axis]+=trash[6+axis];}
   framed_bounds.union(&bin);
  }
  let framed=corners_of(&framed_bounds,&place(1.0,[0.0;3]));
  let frame_left=unscaled[0]+(framed[0]-unscaled[0])*progress;
  let frame_right=unscaled[1]+(framed[1]-unscaled[1])*progress;
  let width_zoom=jmin((1.0-0.22*progress)*jmin(1.0,self.width/unscaled[4]),
   (self.scene_width-padding*2.0-TRASH_PADDING*2.0*progress)/(frame_right-frame_left));
  let height_zoom=jmin(1.0,(self.fit_height-padding*2.0)/jmax(1.0,framed[5]));
  let fit_zoom=jmax(0.0001,jmin(width_zoom,1.0+(height_zoom-1.0)*progress));
  let bounds=corners_of(&framed_bounds,&place(fit_zoom,[0.0;3]));
  let factor=1.0+(self.zoom-1.0)*progress;
  let zoom=fit_zoom*factor;
  let slack=if self.moving{80.0}else{0.0};
  self.pan_x=cl(self.pan_x,-(self.zoom-1.0)*self.scene_width/2.0-slack,(self.zoom-1.0)*self.scene_width/2.0+slack);
  self.pan_y=cl(self.pan_y,-(self.zoom-1.0)*self.fit_height/2.0-slack,(self.zoom-1.0)*self.fit_height/2.0+slack);
  let reserve=(frame_right-frame_left-unscaled[4])*fit_zoom;
  let base_x=self.scene_width/2.0-(frame_left+frame_right)*fit_zoom/2.0;
  let base_y=bounds[2]-padding;
  let x=base_x*factor+(1.0-factor)*self.scene_width/2.0+self.pan_x*progress;
  let y=base_y*factor-(1.0-factor)*self.fit_height/2.0-self.pan_y*progress;
  // Matrix arithmetic can produce fitHeight + 1e-12; do not round that into a new CSS pixel.
  let object_height=(bounds[5]+padding*2.0-1e-7).ceil();
  let stage_height=if self.edge_to_edge{object_height+jmax(0.0,self.fit_height-object_height)*progress}else{object_height};
  // The room's root hangs from the scene, whose own matrix is the identity.
  let world=corners_of(&framed_bounds,&Mat4::multiply(&Mat4::identity(),&place(zoom,[x,y,0.0])));
  let in_frame=world[0]>=-0.01&&world[1]<=self.scene_width+0.01&&world[2]>=-0.01&&world[3]<=self.fit_height+0.01;
  let values=[yaw,pitch,zoom,x,y,reserve,stage_height,if in_frame{1.0}else{0.0}];
  for (slot,value) in out.iter_mut().zip(values){*slot=value;}
  let fixed=|value:f64,digits:u8|js_sys::Number::from(value).to_fixed(digits).ok().and_then(|text|text.as_string()).unwrap_or_default();
  let json=js_sys::JSON::stringify(&Array::of2(&JsValue::from_f64(self.pan_x),&JsValue::from_f64(self.pan_y))).ok().and_then(|text|text.as_string()).unwrap_or_default();
  let texts=Array::new();
  for text in [
   if self.isometric{"isometric".to_string()}else{"spine".to_string()},
   // String(Number(progress.toFixed(4)))
   number_string(num(&JsValue::from_str(&fixed(progress,4)))),
   fixed(-30.0*progress,3),fixed(14.0*progress,3),fixed(zoom,4),fixed(self.zoom,4),
   self.moving.to_string(),json,number_string(self.width),fixed(reserve,3),
   number_string(unit_count),number_string(self.fit_height),floor_visible.to_string(),in_frame.to_string(),
  ]{texts.push(&JsValue::from_str(&text));}
  texts
 }

 /// How the canvas is sized: `[viewport height, ratio, base ratio, the height the pixel origin is searched for]`.
 #[wasm_bindgen(js_name=sizeViewport)]
 pub fn size_viewport(&mut self,client_height:f64,inner_height:f64,device_ratio:f64,out:&mut [f64]){
  let available=if self.edge_to_edge&&self.progress==1.0{self.fit_height}else{or(client_height,inner_height)};
  self.viewport_height=jmax(1.0,jmin(available,inner_height).ceil());
  let cap=if self.zoom>1.001&&self.isometric{2.5}else if self.width<600.0{1.5}else{2.0};
  let ratio=jmin(or(device_ratio,1.0),cap);
  let base=jmin(or(device_ratio,1.0),if self.width<600.0{1.5}else{2.0});
  let values=[self.viewport_height,ratio,base,jmin(or(client_height,inner_height),inner_height).ceil()];
  for (slot,value) in out.iter_mut().zip(values){*slot=value;}
 }
 /// The framebuffer in device pixels: `[width, height]`.
 #[wasm_bindgen(js_name=framePixels)]
 pub fn frame_pixels(&self,ratio:f64,out:&mut [f64]){
  let values=[(self.scene_width*ratio).ceil(),(self.viewport_height*ratio).ceil()];
  for (slot,value) in out.iter_mut().zip(values){*slot=value;}
 }
 /// The camera's scroll: how far the sticky canvas has moved down its stage.
 #[wasm_bindgen(js_name=scrollOf)]
 pub fn scroll_of(&self,canvas_top:f64,stage_top:f64)->f64{jmax(0.0,canvas_top-stage_top)}

 /// `setInspectionView`: the zoom and pan, clamped to what the view can show (a little more
 /// while a finger moves it). True when the view differs from the one before.
 #[wasm_bindgen(js_name=setInspection)]
 pub fn set_inspection(&mut self,zoom:&JsValue,pan_x:&JsValue,pan_y:&JsValue,moving:bool)->bool{
  let (z,x,y)=(self.zoom,self.pan_x,self.pan_y);
  self.zoom=cl(or(num(zoom),1.0),1.0,4.0);self.moving=moving;
  let slack=if moving{80.0}else{0.0};
  self.pan_x=cl(or(num(pan_x),0.0),-(self.zoom-1.0)*self.scene_width/2.0-slack,(self.zoom-1.0)*self.scene_width/2.0+slack);
  self.pan_y=cl(or(num(pan_y),0.0),-(self.zoom-1.0)*self.fit_height/2.0-slack,(self.zoom-1.0)*self.fit_height/2.0+slack);
  let changed=z!=self.zoom||x!=self.pan_x||y!=self.pan_y;
  self.shadow_refit=self.shadow_refit||changed;
  changed
 }
 /// `zoomTo`: the zoom about a point (the canvas centre when it is not a finite number).
 #[wasm_bindgen(js_name=zoomTo)]
 pub fn zoom_to(&mut self,value:&JsValue,client_x:&JsValue,client_y:&JsValue,rect_left:f64,rect_top:f64)->f64{
  let next=cl(or(num(value),1.0),1.0,4.0);
  let relative=next/self.zoom;
  let x=if finite(client_x){num(client_x)-rect_left}else{self.scene_width/2.0};
  let y=if finite(client_y){num(client_y)-rect_top}else{self.fit_height/2.0};
  self.pan_x=x-self.scene_width/2.0-(x-self.scene_width/2.0-self.pan_x)*relative;
  self.pan_y=y-self.fit_height/2.0-(y-self.fit_height/2.0-self.pan_y)*relative;
  self.zoom=next;
  if next==1.0{self.pan_x=0.0;self.pan_y=0.0;}
  self.shadow_refit=true;
  self.zoom
 }
 /// `panBy`: false when the view is not zoomed in the diagonal view.
 #[wasm_bindgen(js_name=panBy)]
 pub fn pan_by(&mut self,x:&JsValue,y:&JsValue)->bool{
  if !self.isometric||self.zoom<=1.0{return false;}
  self.pan_x+=or(num(x),0.0);self.pan_y+=or(num(y),0.0);self.shadow_refit=true;true
 }
 /// A pinch or pan gesture is about to take over the view with a stationary room.
 #[wasm_bindgen(js_name=beginGesture)]
 pub fn begin_gesture(&mut self){self.moving=true;}
 /// A pinch or pan gesture ends and the room repaints at full quality.
 #[wasm_bindgen(js_name=endGesture)]
 pub fn end_gesture(&mut self){self.moving=false;}
 /// `[zoom, pan x, pan y, width, height, centre x, centre y]` of the inspection view.
 #[wasm_bindgen(js_name=inspectionView)]
 pub fn inspection_view(&self,rect_left:f64,rect_top:f64,out:&mut [f64]){
  let values=[self.zoom,self.pan_x,self.pan_y,self.scene_width,self.fit_height,rect_left+self.scene_width/2.0,rect_top+self.fit_height/2.0];
  for (slot,value) in out.iter_mut().zip(values){*slot=value;}
 }
 /// Where a retained inspection image lands on the canvas: `[scale, left, top, covers]`.
 #[wasm_bindgen(js_name=snapshotPlacement)]
 pub fn snapshot_placement(&self,zoom:f64,pan_x:f64,pan_y:f64,margin:f64,width:f64,height:f64,out:&mut [f64]){
  let scale=self.zoom/zoom;
  let dx=self.scene_width/2.0+self.pan_x-scale*(self.scene_width/2.0+pan_x);
  let dy=self.fit_height/2.0+self.pan_y-scale*(self.fit_height/2.0+pan_y);
  let left=dx-margin*scale;let top=dy-margin*scale;
  let covers=left<=0.0&&top<=0.0&&left+width*scale>=self.scene_width&&top+height*scale>=self.viewport_height;
  let values=[scale,left,top,if covers{1.0}else{0.0}];
  for (slot,value) in out.iter_mut().zip(values){*slot=value;}
 }

 /// `setDropPosition`: the guide's shelf and place, or none. `shelf` is already `Number(position.shelf)`.
 /// True when the guide moved.
 #[wasm_bindgen(js_name=setDrop)]
 pub fn set_drop(&mut self,present:bool,shelf:f64,x:f64,undershelf:bool,rows:u32)->bool{
  let valid=present&&shelf.is_finite()&&shelf.floor()==shelf&&shelf>=0.0&&shelf<f64::from(rows)&&x.is_finite();
  let next=if valid{Some((shelf,cl(x,0.0,1.0),undershelf))}else{None};
  if next==self.drop{return false;}
  self.drop=next;true
 }
 /// The guide: its shelf, place and mount, or nothing.
 #[wasm_bindgen(js_name=dropState)]
 pub fn drop_state(&self)->Vec<f64>{match self.drop{Some((shelf,x,under))=>vec![shelf,x,if under{1.0}else{0.0}],None=>Vec::new()}}
 #[wasm_bindgen(getter,js_name=hasDrop)]pub fn has_drop(&self)->bool{self.drop.is_some()}
 /// The guide's shelf (NaN without a guide).
 #[wasm_bindgen(getter,js_name=dropShelf)]pub fn drop_shelf(&self)->f64{self.drop.map_or(f64::NAN,|(shelf,_,_)|shelf)}
 /// The guide's pose for the shelf's packed row (see `scene_drop_position`), empty when it has none.
 #[wasm_bindgen(js_name=dropMarker)]
 pub fn drop_marker_pose(&self,row:&[f64])->Vec<f64>{
  match self.drop{Some((_,x,under)) if row.len()>=7=>drop_marker(row,self.width,self.depth,x,under).to_vec(),_=>Vec::new()}
 }
}

/// `Quaternion#setFromEuler` for XYZ order, with the host's own `Math.cos` and `Math.sin`.
pub fn quaternion_xyz(x:f64,y:f64,z:f64)->[f64;4]{
 let (c1,c2,c3)=(js_sys::Math::cos(x/2.0),js_sys::Math::cos(y/2.0),js_sys::Math::cos(z/2.0));
 let (s1,s2,s3)=(js_sys::Math::sin(x/2.0),js_sys::Math::sin(y/2.0),js_sys::Math::sin(z/2.0));
 [s1*c2*c3+c1*s2*s3,c1*s2*c3-s1*c2*s3,c1*c2*s3+s1*s2*c3,c1*c2*c3-s1*s2*s3]
}

/// `Math.round(value * 2) / 2`.
pub fn half(value:f64)->f64{js_round(value*2.0)/2.0}
