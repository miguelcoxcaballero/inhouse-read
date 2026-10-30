//! What the scene decides about each of its books, plants and lamps every frame: how far each is
//! lifted by a finger, how the preview and the landing ease, where it stands, which part of it
//! is on screen and at which quality it is drawn, where its button goes and how wide its tap
//! target is. Three objects, the DOM and every model stay in JavaScript; the host hands each step
//! its numbers in one typed array and reads the results from the same one. Every value follows
//! the original arithmetic exactly (f64 operation order, `Math.min`/`Math.max` semantics,
//! three's `Vector3#applyQuaternion`, the host's `Math.round`/`Math.pow`).
use wasm_bindgen::prelude::*;
use crate::host::{jmax,jmin,js_round,parse_float};
use crate::scene_view::{cl,corners_of,ease,or,RustScene};
use crate::jsmath::{Box3,Mat4};

const PLANT:f64=1.0;
const LAMP:f64=2.0;
const AWAY:u32=1;const DRAGGING:u32=2;const LIFTED:u32=4;const PRESSED:u32=8;

/// The state of a button's inputs as a bit set (away, dragging, lifted, pressed) from its class
/// text: `is-pressed` counts only without `is-press-pending`. Class names are separated by the
/// ASCII white space the HTML parser uses.
#[wasm_bindgen]
pub fn scene_class_flags(classes:&str)->u32{
 let mut bits=0;
 let (mut pressed,mut pending)=(false,false);
 for token in classes.split([' ','\t','\n','\u{c}','\r']){
  match token{"is-reader-origin"=>bits|=64,"is-away"=>bits|=AWAY,"is-dragging"=>bits|=DRAGGING,"is-lifted"=>bits|=LIFTED,"is-pressed"=>pressed=true,"is-press-pending"=>pending=true,_=>{}}
 }
 if pressed&&!pending{bits|=PRESSED;}
 bits
}

/// The joined state text the scene compares between frames: the four flags, both drag offsets, the
/// disabled state and the pointer-events value.
#[wasm_bindgen]
pub fn scene_state_text(bits:u32,drag_x:&str,drag_y:&str,disabled:bool,pointer_events:&str)->String{
 format!("{}|{}|{}|{}|{}|{}|{}|{}",bits&AWAY!=0,bits&DRAGGING!=0,bits&LIFTED!=0,bits&PRESSED!=0,drag_x,drag_y,disabled,pointer_events)
}

/// `parseFloat(text) || 0`, the offset a dragged button is moved by.
#[wasm_bindgen]
pub fn scene_drag_offset(text:&str)->f64{or(parse_float(&JsValue::from_str(text)),0.0)}

/// Whether two state texts differ in nothing but the pressure (the fourth field).
#[wasm_bindgen]
pub fn scene_pressure_only(previous:&str,current:&str)->bool{
 let (a,b):(Vec<&str>,Vec<&str>)=(previous.split('|').collect(),current.split('|').collect());
 a.len()==b.len()&&a.iter().zip(b.iter()).enumerate().all(|(index,(x,y))|index==3||x==y)
}

/// A slot's box and the stand-in the button falls back on while a model is culled:
/// `out = [slot min x, y, z, max x, y, z, fallback min x, y, z, max x, y, z]`.
/// Half the depth a plant occupies on its board is `(depth || width * 0.7) / 2`.
#[wasm_bindgen]
pub fn scene_entry_boxes(kind:f64,undershelf:bool,width:f64,height:f64,thickness:f64,depth:f64,out:&mut [f64]){
 if out.len()<12{return;}
 let plant_half=or(depth,width*0.7)/2.0;
 let slot=if kind==LAMP{
  let d=or(depth,width);
  [-width/2.0,if undershelf{-height}else{0.0},-d/2.0,width/2.0,if undershelf{0.0}else{height},d/2.0]
 }else{
  let plant=kind==PLANT;
  [-width/2.0-if plant{0.0}else{thickness*0.38},-height/2.0,-if plant{plant_half}else{thickness/2.0},
   width/2.0,height/2.0+if plant{0.0}else{20.0},if plant{plant_half}else{thickness/2.0}]
 };
 let fallback=if kind==PLANT{
  [-width*0.285,-height/2.0,-width*0.285,width*0.285,-height/2.0+height*0.32,width*0.285]
 }else{
  [-width/2.0-thickness*0.38,-height/2.0,-thickness/2.0,-width/2.0,height/2.0,thickness/2.0]
 };
 out[..6].copy_from_slice(&slot);out[6..12].copy_from_slice(&fallback);
}

/// One frame of a lamp's switch: `io = [on, value, from, target, started, duration, now, reduced]`
/// in, `[value, from, target, started, duration, still moving, value changed]` out.
#[wasm_bindgen]
pub fn scene_lamp_power(io:&mut [f64]){
 if io.len()<8{return;}
 let target=if io[0]!=0.0{1.0}else{0.0};
 let (mut value,mut from,mut goal,mut started,mut duration,now)=(io[1],io[2],io[3],io[4],io[5],io[6]);
 if goal!=target{from=value;goal=target;started=now;duration=220.0;}
 let previous=value;
 let t=if io[7]!=0.0||duration==0.0||duration.is_nan(){1.0}else{cl((now-started)/duration,0.0,1.0)};
 value=from+(goal-from)*ease(t);
 io[..7].copy_from_slice(&[value,from,goal,started,duration,if t<1.0&&from!=goal{1.0}else{0.0},if previous!=value{1.0}else{0.0}]);
}

/// A return's clock on the bounded step: `io = [elapsed, last frame, duration, now]` in,
/// `[elapsed, last frame, t, eased t]` out.
#[wasm_bindgen]
pub fn scene_insertion_step(io:&mut [f64]){
 if io.len()<4{return;}
 let elapsed=io[0]+jmin(50.0,jmax(0.0,io[3]-io[1]));
 let t=if io[2]>0.0{cl(elapsed/io[2],0.0,1.0)}else{1.0};
 let now=io[3];
 io[..4].copy_from_slice(&[elapsed,now,t,ease(t)]);
}

/// A preview offset: `io = [x, y, from x, from y, target x, target y, started, active, goal x, goal y, now, reduced]`.
/// The offset first advances; when the goal differs from the target by a hundredth of a pixel or more
/// it becomes the new target. The last slot of the result says whether anything changed.
#[wasm_bindgen]
pub fn scene_preview_offset(io:&mut [f64]){
 if io.len()<13{return;}
 let changed=advance_preview(io,io[10],io[11]!=0.0);
 if (io[8]-io[4]).abs()+(io[9]-io[5]).abs()<0.01{io[12]=if changed{1.0}else{0.0};return;}
 io[2]=io[0];io[3]=io[1];io[4]=io[8];io[5]=io[9];io[6]=io[10];io[7]=1.0;io[12]=1.0;
}

/// Where a previewed object moves to: `[x, y]` from its row, centre and own place.
/// `row = [left, ceiling or top, bottom]`, with `left` already `row.left || 0`.
#[wasm_bindgen]
pub fn scene_preview_target(row_left:f64,row_top:f64,row_bottom:f64,center:f64,x:f64,y:f64,height:f64,undershelf:bool,out:&mut [f64]){
 if out.len()<2{return;}
 out[0]=row_left+center-x;
 out[1]=y-if undershelf{row_top}else{row_bottom-height/2.0};
}

/// One placement preview for every entry, in order, in one call (the former host loop crossed twice per
/// entry). Per entry, 18 numbers: `placed, row left, row top, row bottom, centre, x, y, height,
/// under-shelf` (`scene_preview_target`'s inputs, read only when placed), then the offset's state
/// `x, y, from x, from y, target x, target y, started, active` and, out, whether it changed. A placed
/// entry heads for its row's target and every other one back to rest; each offset then advances as
/// `scene_preview_offset`. Returns whether any offset changed.
#[wasm_bindgen]
pub fn scene_preview_entries(io:&mut [f64],now:f64,reduced:bool)->bool{
 let mut changed=false;
 for entry in io.chunks_exact_mut(18){
  let mut goal=[0.0;2];
  if entry[0]!=0.0{scene_preview_target(entry[1],entry[2],entry[3],entry[4],entry[5],entry[6],entry[7],entry[8]!=0.0,&mut goal);}
  let mut offset=[0.0;13];
  offset[..8].copy_from_slice(&entry[9..17]);offset[8]=goal[0];offset[9]=goal[1];offset[10]=now;offset[11]=if reduced{1.0}else{0.0};
  scene_preview_offset(&mut offset);
  entry[9..17].copy_from_slice(&offset[..8]);entry[17]=offset[12];
  changed|=offset[12]!=0.0;
 }
 changed
}

/// The previews' easing; `state` is `[x, y, from x, from y, target x, target y, started, active]`.
fn advance_preview(state:&mut [f64],now:f64,reduced:bool)->bool{
 if state[7]==0.0{return false;}
 let t=if reduced{1.0}else{cl((now-state[6])/130.0,0.0,1.0)};
 let x=state[2]+(state[4]-state[2])*ease(t);
 let y=state[3]+(state[5]-state[3])*ease(t);
 let changed=x!=state[0]||y!=state[1];
 state[0]=x;state[1]=y;
 if t==1.0{state[7]=0.0;}
 changed
}

/// The index of the tap rectangle holding a point whose centre is nearest, or -1. Rectangles are
/// `left, top, width, height`; vertical distances count a quarter as much.
#[wasm_bindgen]
pub fn scene_nearest_tap(rects:&[f64],x:f64,y:f64)->i32{
 let (mut best,mut best_distance)=(-1i32,f64::INFINITY);
 for (index,r) in rects.chunks_exact(4).enumerate(){
  if x<r[0]||x>r[0]+r[2]||y<r[1]||y>r[1]+r[3]{continue;}
  let distance=js_sys::Math::pow(x-r[0]-r[2]/2.0,2.0)+js_sys::Math::pow((y-r[1]-r[3]/2.0)*0.25,2.0);
  if distance<best_distance{best_distance=distance;best=index as i32;}
 }
 best
}

fn floats(io:&mut [f64],at:usize,values:&[f64]){io[at..at+values.len()].copy_from_slice(values);}

#[wasm_bindgen]
impl RustScene{
 /// The frame's constants for every entry that follows: the clock, reduced motion, the room's zoom
 /// and inverse rotation `[x, y, z, w]`, the device pixel ratio and the window's width.
 #[wasm_bindgen(js_name=beginEntries)]
 pub fn begin_entries(&mut self,now:f64,reduced:bool,zoom:f64,inverse_rotation:&[f64],device_ratio:f64,inner_width:f64,scroll:f64,lamp_tap:f64){
  self.entry_now=now;self.entry_reduced=reduced;self.entry_zoom=zoom;
  if inverse_rotation.len()>=4{self.entry_q.copy_from_slice(&inverse_rotation[..4]);}
  self.entry_ratio=device_ratio;self.entry_window=inner_width;self.entry_scroll=scroll;self.entry_lamp_tap=lamp_tap;
 }

 /// One entry's lift, landing, preview and pose. In: kind, under-shelf, flags, drag offsets, lift
 /// `[value, from, target, started]`, landing `[active, from, started, duration]`, preview, the offset,
 /// then the entry's `x, y, width, height, depth, depth inset`. The state is updated in place; the pose
 /// (`x, y, z`, Euler `x, y, z`, scale) and the bits (preview changed, preview active, previewed,
 /// changing lift, lift changed) follow.
 #[wasm_bindgen(js_name=stepEntry)]
 pub fn step_entry(&self,io:&mut [f64]){
  if io.len()<37{return;}
  let (now,reduced)=(self.entry_now,self.entry_reduced);
  let kind=io[0];let under=io[1]!=0.0;let flags=io[2] as u32;
  let (dragging,pressed)=(flags&DRAGGING!=0,flags&PRESSED!=0);
  let lifted=dragging||flags&LIFTED!=0;
  let preview_changed=advance_preview(&mut io[13..21],now,reduced);
  let preview_active=io[20]!=0.0;
  let previewed=io[13].abs()+io[14].abs()>0.01;
  let target=if lifted{1.0}else if pressed{0.22}else{0.0};
  let previous=io[5];
  let changing;
  if io[9]!=0.0&&target==0.0{
   let t=if reduced{1.0}else{cl((now-io[11])/io[12],0.0,1.0)};
   io[5]=io[10]*(1.0-ease(cl((t-0.7)/0.3,0.0,1.0)));
   io[6]=io[5];io[7]=0.0;io[8]=now;
   changing=t<1.0&&io[10]>0.0;
   if t==1.0{io[9]=0.0;}
  }else{
   io[9]=0.0;
   if io[7]!=target{io[6]=io[5];io[7]=target;io[8]=now;}
   let lift_time=if reduced{1.0}else{cl((now-io[8])/160.0,0.0,1.0)};
   io[5]=io[6]+(io[7]-io[6])*ease(lift_time);
   changing=lift_time<1.0&&io[6]!=io[7];
  }
  let lift=io[5];
  let screen_x=(if dragging{or(io[3],0.0)}else{0.0})+io[21];
  let screen_y=(if dragging{or(io[4],0.0)}else{0.0})+io[22]-18.0*lift;
  let zoom=self.entry_zoom;
  let (vx,vy,vz)=(screen_x/zoom,-screen_y/zoom,30.0*lift/zoom);
  let [qx,qy,qz,qw]=self.entry_q;
  let (tx,ty,tz)=(2.0*(qy*vz-qz*vy),2.0*(qz*vx-qx*vz),2.0*(qx*vy-qy*vx));
  let (rx,ry,rz)=(vx+qw*tx+qy*tz-qz*ty,vy+qw*ty+qz*tx-qx*tz,vz+qw*tz+qx*ty-qy*tx);
  let (x,y,width,height,depth,inset)=(io[23],io[24],io[25],io[26],io[27],io[28]);
  let lamp=kind==LAMP;let plant=kind==PLANT;let decorative=lamp||plant;
  let z_base=if under{-self.depth/2.0}else if lamp{-or(depth,width)/2.0}else if plant{-(or(depth,width*0.7)/2.0)}else{-width/2.0};
  let lamp_lift=if lamp&&!under{height/2.0}else{0.0};
  let inset=if under{0.0}else{or(inset,0.0)};
  let pose=[x-self.width/2.0+rx+io[13],-y-lamp_lift+ry+io[14],z_base-inset+rz,
   if decorative{4.0*std::f64::consts::PI/180.0*lift}else{0.0},
   if decorative{-7.0*std::f64::consts::PI/180.0*lift}else{std::f64::consts::PI/2.0-7.0*std::f64::consts::PI/180.0*lift},
   if decorative{-3.0*std::f64::consts::PI/180.0*lift}else{0.0},1.0+0.04*lift];
  floats(io,29,&pose);
  io[36]=f64::from((preview_changed as u32)|((preview_active as u32)<<1)|((previewed as u32)<<2)|((changing as u32)<<3)|(((previous!=lift) as u32)<<4));
 }

 /// Advance every entry through one contiguous packet. The former host loop crossed the WASM
 /// boundary once per book even though all entries share the same frame clock and view state.
 /// Each record keeps the existing 40-number layout, so the calculations and output values are
 /// identical while the boundary cost is paid only once per frame.
 #[wasm_bindgen(js_name=stepEntries)]
 pub fn step_entries(&self,entries:&mut [f64]){
  for entry in entries.chunks_exact_mut(40){self.step_entry(entry);}
 }

 /// What the entry's projection says: its screen rectangle from the slot box and the matrix
 /// (`scene_corners`' layout), whether it is on screen, whether and how its quality is chosen, and
 /// whether its model shows. In: kind, flags, drop, insertion, model, overview, `drop complete`,
 /// `overlay`, then `[box, matrix]`. Out: the rectangle, visible, quality applies, overview,
 /// resolution, model visible.
 #[wasm_bindgen(js_name=projectEntry)]
 pub fn project_entry(&self,io:&mut [f64]){
  if io.len()<44{return;}
  let kind=io[0];let flags=io[1] as u32;
  let (away,dragging)=(flags&AWAY!=0,flags&DRAGGING!=0);
  let (lifted,pressed)=(dragging||flags&LIFTED!=0,flags&PRESSED!=0);
  let (drop,insertion,model,overview)=(io[2]!=0.0,io[3]!=0.0,io[4]!=0.0,io[5]!=0.0);
  let mut m=[0.0;16];m.copy_from_slice(&io[14..30]);
  let b=Box3{min:[io[8],io[9],io[10]],max:[io[11],io[12],io[13]]};
  let rect=corners_of(&b,&Mat4(m));
  let visible=drop||((!away||insertion)&&rect[3]>self.entry_scroll-220.0&&rect[2]<self.entry_scroll+self.viewport_height+220.0);
  let settled=visible&&!drop&&!insertion&&!away&&!self.moving()&&(flags&16==0||!model);
  let (mut overview_out,mut resolution)=(overview,0.0);
  let mut applies=false;
  if settled&&kind==PLANT{
   applies=true;
   resolution=if self.zoom>1.001&&self.progress==1.0{256.0}else{0.0};
  }else if settled&&kind!=LAMP{
   applies=true;
   // Choose overview quality only after the global view settles, rather than rebuilding
   // repeatedly while the book crosses a size threshold.
   // A fallen cover can be wider than it is tall. Its longest projected
   // dimension controls texture detail; unrotated/legacy callers keep height.
   let pixels=if flags&32!=0{jmax(rect[4],rect[5])}else{rect[5]};
   let stable=self.transition_none()&&(self.progress==0.0||self.progress==1.0);
   if lifted||pressed{overview_out=false;}
   else if !model&&self.isometric&&pixels<90.0{overview_out=true;}
   else if stable{overview_out=self.progress==1.0&&pixels<90.0;}
   let physical=pixels*jmin(or(self.entry_ratio,1.0),2.5);
   let inspecting=self.zoom>1.001&&self.progress==1.0&&physical>192.0;
   if inspecting{overview_out=false;}
   resolution=if inspecting{if physical>900.0{2048.0}else{1024.0}}else{0.0};
  }
  let model_visible=if drop{io[6]==0.0}else{!away||(insertion&&io[7]==0.0)};
  floats(io,30,&rect);
  floats(io,37,&[if visible{1.0}else{0.0},if applies{1.0}else{0.0},if overview_out{1.0}else{0.0},resolution,if model_visible{1.0}else{0.0}]);
 }

 /// The button's tap target: the hit surface's rectangle (the box under the matrix), widened to a
 /// finger for a book or a lamp, the button's depth order and the exposed cover's place. In: kind,
 /// under-shelf, `flags`, `disabled or inert`, the entry's rectangle (`scene_corners`' layout), then
 /// `[box, matrix]`. Out: the hit rectangle, the tap rectangle `left, top, width, height`, z-index,
 /// the cover's `left, top`, whether it shows and whether it takes pointer events.
 #[wasm_bindgen(js_name=hitEntry)]
 pub fn hit_entry(&self,io:&mut [f64]){
  if io.len()<49{return;}
  let kind=io[0];let flags=io[2] as u32;
  let rect:[f64;7]=[io[4],io[5],io[6],io[7],io[8],io[9],io[10]];
  let mut m=[0.0;16];m.copy_from_slice(&io[17..33]);
  let b=Box3{min:[io[11],io[12],io[13]],max:[io[14],io[15],io[16]]};
  let hit=corners_of(&b,&Mat4(m));
  let tap=if kind==PLANT{[hit[0],hit[2],hit[4],hit[5]]}
   else if kind==LAMP{
    let ex=jmax(0.0,self.entry_lamp_tap-hit[4]);let ey=jmax(0.0,self.entry_lamp_tap-hit[5]);
    [hit[0]-ex/2.0,hit[2]-ey/2.0,hit[4]+ex,hit[5]+ey]
   }else{
    let minimum=if self.entry_window>=600.0{18.0}else{16.0};
    let extra=jmax(0.0,minimum-hit[4]);
    [hit[0]-extra/2.0,hit[2],hit[4]+extra,hit[5]]
   };
  let z=100.0+js_round(rect[6]+self.height);
  let events=!(flags&DRAGGING!=0||flags&AWAY!=0||io[3]!=0.0);
  floats(io,33,&hit);
  floats(io,40,&tap);
  floats(io,44,&[z,rect[0]-tap[0],rect[2]-tap[1],if kind==LAMP||self.progress>0.04{1.0}else{0.0},if events{1.0}else{0.0}]);
 }
}
