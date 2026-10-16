//! What the scene computes about its fixtures each frame: the wastebasket's lid and flight, the
//! catalogue booklet's place and tap box, and the frame the returning book is painted in. Three
//! objects and the DOM stay in JavaScript; the values here follow the original arithmetic exactly.
use wasm_bindgen::prelude::*;
use js_sys::Array;
use crate::host::{jmax,jmin,js_round,number_string};
use crate::jsmath::{Box3,Mat4};
use crate::scene_view::{cl,corners_of,ease,half,or,RustScene};

const TRASH_PADDING:f64=7.0;

fn smooth(t:f64)->f64{t*t*(3.0-2.0*t)}
fn mat(values:&[f64])->Option<Mat4>{
 if values.len()<16{return None;}
 let mut e=[0.0;16];e.copy_from_slice(&values[..16]);Some(Mat4(e))
}
fn boxed(values:&[f64])->Option<Box3>{
 if values.len()<6{return None;}
 Some(Box3{min:[values[0],values[1],values[2]],max:[values[3],values[4],values[5]]})
}
fn put(out:&mut [f64],values:&[f64]){for (slot,value) in out.iter_mut().zip(values){*slot=*value;}}
fn fixed(value:f64,digits:u8)->String{js_sys::Number::from(value).to_fixed(digits).ok().and_then(|text|text.as_string()).unwrap_or_default()}

/// One frame of a book's flight into the bin on the bounded clock: the clock after the frame, how
/// far the flight is (`t`), the lid's opening and its bounce. `out = [elapsed, last frame, t, openness, bounce]`.
#[wasm_bindgen]
pub fn scene_trash_drop(elapsed:f64,last_frame:f64,complete:bool,duration:f64,initial_openness:f64,now:f64,out:&mut [f64]){
 let (mut elapsed,mut last_frame)=(elapsed,last_frame);
 if !complete{elapsed+=jmin(50.0,jmax(0.0,now-last_frame));last_frame=now;}
 let t=if duration>0.0{cl(elapsed/duration,0.0,1.0)}else{1.0};
 let close=smooth(cl((t-0.78)/0.22,0.0,1.0));
 let openness=(initial_openness+(1.0-initial_openness)*ease(cl(t/0.2,0.0,1.0)))*(1.0-close);
 put(out,&[elapsed,last_frame,t,openness,cl((t-0.84)/0.16,0.0,1.0)]);
}

/// The scale the book reaches at the bin's mouth for a bin of this world scale and radius.
#[wasm_bindgen]
pub fn scene_trash_end_scale(world_scale:f64,radius:f64,width:f64,height:f64)->f64{
 let tilted=width*js_sys::Math::cos(0.46)+height*js_sys::Math::sin(0.46);
 jmin(0.19*world_scale,radius*1.45*world_scale/jmax(1.0,tilted))
}

/// A broad book dragged into a narrow right gutter bends inwards for its first frames instead of
/// being clipped for the whole flight: `out = [whether it bends, how far]`.
#[wasm_bindgen]
pub fn scene_trash_overflow(right:f64,scene_width:f64,t:f64,out:&mut [f64]){
 let overflow=jmax(0.0,right-scene_width+3.0);
 put(out,&[if overflow!=0.0&&!overflow.is_nan(){1.0}else{0.0},overflow*ease(cl(t/0.14,0.0,1.0))]);
}

/// The bin's diagnostics, as the scene writes them: its place, scale, rotation, foot, the floor and
/// the world places of both, radius and height.
#[wasm_bindgen]
pub fn scene_trash_texts(position:&[f64],scale:f64,rotation:&[f64],foot_y:f64,floor_y:f64,foot_world:&[f64],floor_world:&[f64],radius:f64,height:f64)->Array{
 let three=|v:&[f64]|format!("{},{},{}",fixed(v[0],6),fixed(v[1],6),fixed(v[2],6));
 let texts=Array::new();
 if position.len()<3||rotation.len()<3||foot_world.len()<3||floor_world.len()<3{return texts;}
 for text in [three(position),fixed(scale,6),format!("{},{},{}",number_string(rotation[0]),number_string(rotation[1]),number_string(rotation[2])),
  fixed(foot_y,6),fixed(floor_y,6),three(foot_world),three(floor_world),number_string(radius),number_string(height)]{
  texts.push(&JsValue::from_str(&text));
 }
 texts
}

#[wasm_bindgen]
impl RustScene{
 /// The bin is not shown in this view: only the diagonal view at its end shows it.
 #[wasm_bindgen(js_name=trashViewHidden)]
 pub fn trash_view_hidden(&self)->bool{!self.isometric||self.progress<0.86}
 #[wasm_bindgen(js_name=trashReset)]
 pub fn trash_reset(&mut self){self.trash_hover=false;self.trash_transition=None;self.trash_openness=0.0;}
 #[wasm_bindgen(getter,js_name=trashHover)]pub fn trash_hover_value(&self)->bool{self.trash_hover}
 #[wasm_bindgen(getter,js_name=trashOpenness)]pub fn trash_openness_value(&self)->f64{self.trash_openness}
 #[wasm_bindgen(getter,js_name=trashEasing)]pub fn trash_easing(&self)->bool{self.trash_transition.is_some()}
 /// `setTrashHover`: true when the lid starts to move.
 #[wasm_bindgen(js_name=trashSetHover)]
 pub fn trash_set_hover(&mut self,requested:bool,shown:bool,now:f64)->bool{
  let next=requested&&self.isometric&&shown;
  if next==self.trash_hover{return false;}
  self.trash_hover=next;
  self.trash_transition=Some((self.trash_openness,if next{1.0}else{0.0},now));
  true
 }
 /// A flight into the bin was cancelled: the lid closes from where it is (`Number(openness) || 0`).
 #[wasm_bindgen(js_name=trashCancelDrop)]
 pub fn trash_cancel_drop(&mut self,openness:f64,now:f64){
  self.trash_hover=false;
  self.trash_transition=Some((or(openness,0.0),0.0,now));
 }
 /// A flight into the bin ended: the lid is closed for good.
 #[wasm_bindgen(js_name=trashFinishDrop)]
 pub fn trash_finish_drop(&mut self){self.trash_openness=0.0;self.trash_hover=false;self.trash_transition=None;}
 /// One frame of the lid's ease (immediate under reduced motion). True while it still moves.
 #[wasm_bindgen(js_name=trashStep)]
 pub fn trash_step(&mut self,now:f64,reduced:bool)->bool{
  let Some((from,to,started))=self.trash_transition else{return false};
  let t=if reduced{1.0}else{cl((now-started)/170.0,0.0,1.0)};
  self.trash_openness=from+(to-from)*ease(t);
  if t==1.0{self.trash_transition=None;}
  t<1.0
 }
 /// Whether the bin is on screen and where its tap box goes, from the bin's projected box
 /// (`scene_corners`' layout) and the layout rectangles. `out = [visible, in frame, left, top, width, height]`.
 #[wasm_bindgen(js_name=trashFrame)]
 #[allow(clippy::too_many_arguments)]
 pub fn trash_frame(&self,rect:&[f64],scroll:f64,stage_left:f64,stage_top:f64,scroller:&[f64],inner_width:f64,inner_height:f64,visual_bottom:f64,out:&mut [f64]){
  if rect.len()<6||scroller.len()<4{for v in out.iter_mut(){*v=f64::NAN}return;}
  let (left,right,top,bottom,width,height)=(rect[0],rect[1],rect[2],rect[3],rect[4],rect[5]);
  let visible_bottom=jmin(jmin(scroller[3],or(inner_height,f64::INFINITY)),if visual_bottom.is_finite()&&visual_bottom>0.0{visual_bottom}else{f64::INFINITY});
  let hidden=self.trash_view_hidden();
  let (screen_top,screen_bottom)=(stage_top+top,stage_top+bottom);
  let (screen_left,screen_right)=(stage_left+left,stage_left+right);
  let in_frame=right>0.0&&left<self.scene_width&&bottom>scroll&&top<scroll+self.viewport_height;
  let visible=!hidden&&in_frame&&screen_bottom>jmax(0.0,scroller[1])&&screen_top<visible_bottom
   &&screen_right>jmax(0.0,scroller[0])&&screen_left<jmin(inner_width,scroller[2]);
  let hit_width=jmax(44.0,width+TRASH_PADDING*2.0);
  let hit_height=jmax(44.0,height+TRASH_PADDING*2.0);
  let hit_left=cl((left+right-hit_width)/2.0,0.0,jmax(0.0,self.scene_width-hit_width));
  let hit_top=cl((top+bottom-hit_height)/2.0,scroll,jmax(scroll,jmin(scroll+self.viewport_height,self.fit_height)-hit_height));
  put(out,&[if visible{1.0}else{0.0},if in_frame{1.0}else{0.0},hit_left,hit_top,hit_width,hit_height]);
 }

 /// Where the catalogue booklet stands: `[x, y, z, visible]`, from the first shelf's edges.
 #[wasm_bindgen(js_name=catalogPlace)]
 pub fn catalog_place(&self,first_top:f64,first_bottom:f64,out:&mut [f64]){
  let center=first_top+jmax(68.0,jmin(120.0,(first_bottom-first_top)*0.5));
  put(out,&[self.width/2.0+3.0,-center,-self.depth*0.52,if self.progress>0.36{1.0}else{0.0}]);
 }
 /// The booklet's tap box and the printed face inside it. `bounds_box` is the booklet's own box,
 /// `matrix` its world matrix, `cover` the printed cover's `[width, height, thickness]`, `stage` the
 /// stage's `[left, top]`, `scroller` its clip `[left, top, right, bottom]` and `inner` the window's
 /// `[width, height]`. `out = [visible, view hidden, width, height, left, top]`; the text is the
 /// face in the tap box's coordinates, as the page animation needs it.
 #[wasm_bindgen(js_name=catalogFrame)]
 #[allow(clippy::too_many_arguments)]
 pub fn catalog_frame(&self,bounds_box:&[f64],matrix:&[f64],cover:&[f64],scroll:f64,stage:&[f64],scroller:&[f64],inner:&[f64],out:&mut [f64])->String{
  let (Some(b),Some(m))=(boxed(bounds_box),mat(matrix))else{for v in out.iter_mut(){*v=f64::NAN}return String::new()};
  if cover.len()<3||stage.len()<2||scroller.len()<4||inner.len()<2{for v in out.iter_mut(){*v=f64::NAN}return String::new();}
  let bounds=corners_of(&b,&m);
  let hidden=!self.isometric||self.progress<0.86;
  let (screen_top,screen_bottom)=(stage[1]+bounds[2],stage[1]+bounds[3]);
  let (screen_left,screen_right)=(stage[0]+bounds[0],stage[0]+bounds[1]);
  // A stage below an empty-library message can be outside the actual screen even while its local
  // coordinates lie inside the virtual camera window.
  let visible=!hidden&&bounds[3]>scroll&&bounds[2]<scroll+self.viewport_height
   &&screen_bottom>jmax(0.0,scroller[1])&&screen_top<jmin(inner[1],scroller[3])
   &&screen_right>jmax(0.0,scroller[0])&&screen_left<jmin(inner[0],scroller[2]);
  let target_width=jmax(44.0,bounds[4]);
  let target_height=jmax(44.0,bounds[5]);
  let left=bounds[0]-(target_width-bounds[4])/2.0;
  let top=bounds[2]-(target_height-bounds[5])/2.0;
  put(out,&[if visible{1.0}else{0.0},if hidden{1.0}else{0.0},target_width,target_height,left,top]);
  // The printed cover inside the (clip and edge inclusive) hit box: the catalogue page flies out of
  // exactly this rectangle.
  let face_box=Box3{min:[-cover[0]/2.0,-cover[1]/2.0,cover[2]/2.0],max:[cover[0]/2.0,cover[1]/2.0,cover[2]/2.0]};
  let face=corners_of(&face_box,&m);
  [face[0]-left,face[2]-top,face[4],face[5]].iter().map(|value|number_string(half(*value))).collect::<Vec<_>>().join(" ")
 }

 /// The frame a returning book is painted in on the full-screen overlay, from the book's world box,
 /// the overlay camera's inverse world matrix and projection, and the window. `out = [found, x, y, width, height]`.
 #[wasm_bindgen(js_name=insertionFrame)]
 pub fn insertion_frame(&self,book:&[f64],view_inverse:&[f64],projection:&[f64],vw:f64,vh:f64,out:&mut [f64]){
  let (Some(b),Some(inverse),Some(project))=(boxed(book),mat(view_inverse),mat(projection))else{put(out,&[0.0,0.0,0.0,vw,vh]);return};
  let (mut left,mut top,mut right,mut bottom)=(f64::INFINITY,f64::INFINITY,f64::NEG_INFINITY,f64::NEG_INFINITY);
  for x in [b.min[0],b.max[0]]{for y in [b.min[1],b.max[1]]{for z in [b.min[2],b.max[2]]{
   let p=project.apply(inverse.apply([x,y,z]));
   let (px,py)=((p[0]+1.0)*vw/2.0,(1.0-p[1])*vh/2.0);
   left=jmin(left,px);top=jmin(top,py);right=jmax(right,px);bottom=jmax(bottom,py);
  }}}
  let (width,height)=(jmin(vw,256.0),jmin(vh,384.0));
  left=jmax(0.0,left);top=jmax(0.0,top);right=jmin(vw,right);bottom=jmin(vh,bottom);
  if [left,top,right,bottom].iter().all(|v|v.is_finite())&&right>=left&&bottom>=top
   &&(width==vw||right-left+48.0<=width)&&(height==vh||bottom-top+48.0<=height){
   put(out,&[1.0,if width==vw{0.0}else{js_round((left+right-width)/2.0)},if height==vh{0.0}else{js_round((top+bottom-height)/2.0)},width,height]);
  }else{put(out,&[0.0,0.0,0.0,vw,vh]);}
 }
}
