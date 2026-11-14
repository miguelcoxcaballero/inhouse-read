//! Every entry's pose in one call per frame: the shared-room motion sample (local snapshot,
//! remote preview, checkpoint bridge), the pose matrix, its place in the room and what its
//! projection says; then, in a second call once the host has its models, every semantic
//! button's hit target and the style writes it needs. The host writes each entry's inputs into
//! this arena once and reads the results from it; three objects and the DOM stay in JavaScript.
//! The arithmetic is three's `Matrix4#compose` and `#multiplyMatrices` (jsmath) and the scene's
//! own projection and hit, in the order the former per-entry calls ran, so every number is the same.
use wasm_bindgen::prelude::*;
use crate::jsmath::Mat4;
use crate::room_motion::{RustRoomMotion,RustRoomTransition};
use crate::scene_view::RustScene;
use crate::book_gravity::{RustBookGravity,RustGravityFrame};
use super::motion::RustSceneMotionFrame;
use super::projection::RustSceneProjectionFrame;

/// Per entry, the state the scene keeps between frames and the frame's pose. The host writes a
/// column only when its source changes (a class, a drag variable, a size, a layout, an event):
/// - 0-28 the step's inputs and retained state, in `RustScene#stepEntry`'s order: kind,
///   under-shelf, flags, drag offsets, lift `[value, from, target, started]`, landing `[active,
///   from, started, duration]`, preview (8), reorder offset, `x, y, width, height, depth, inset`;
/// - 29-36 the pose it chose (`x, y, z`, Euler `x, y, z`, scale) and its motion bits;
/// - 37-39 the solver's presentation: book Euler order is `ZYX`, moving, projection flags;
/// - 40-48 the solver's geometry (thickness or width, kind, shelf, pixels per metre, the bay's
///   left, right, bottom, ceiling and the grip height);
/// - 49 what the host holds (1 drop, 2 insertion, 4 model, 8 overview, 16 drop complete,
///   32 insertion overlay); 50-55 the slot box;
/// - 56 the pose's Euler order (0 `XYZ`, 1 `ZYX`), which a frame without rigid bodies keeps;
/// - 57-60 the pose's quaternion (`Quaternion#setFromEuler`, recomputed when the Euler moved);
/// - 61-68 the pose last handed to the host; 69 the lean; 70 out: 1 the pose differs from the
///   one the host holds, 2 its matrix differs, 4 its projected rectangle differs; 71 in: the
///   host holds nothing of this row yet;
/// - 72 the previous frame's motion flags; 73 in: the host holds no hit target of this row yet;
/// - 74 the number of the shared key the entry's local pose was sampled under (0: it has none
///   yet) and 76-84 that pose, as the room publishes it: `[shelf, x, y, z, quaternion, scale]`.
const STATE:usize=85;
const HOST:usize=49;const BOX:usize=50;const ORDER:usize=56;const QUATERNION:usize=57;
const HELD:usize=61;const LEAN:usize=69;const CHANGED:usize=70;const FRESH:usize=71;const LIVE:usize=72;const HIT_FRESH:usize=73;const LOCAL_KEY:usize=74;const LOCAL:usize=76;

/// Per entry in: pose position, quaternion `[x, y, z, w]` and scale; the projection's kind,
/// flags, drop, insertion, model, overview, drop complete and overlay; the slot box.
const INPUT:usize=22;
/// Per entry out: the motion flags; the motion sample's 25 numbers (only the slots its flags
/// name); the final pose matrix; that matrix in the room; the projection's rectangle (7),
/// visible, quality applies, overview, resolution and model visible.
const OUTPUT:usize=70;
/// Per entry hit in: bits (1 has a button, 2 under-shelf, 4 disabled or inert, 8 reset its
/// written styles, 16 fresh cover, 32 use the placed matrix), the button's flags, the hit
/// surface's box and its world matrix.
const HIT_INPUT:usize=24;
/// Per entry hit out: the style dirty bits (and `HIT_MOVED` when one of the sixteen numbers
/// after it differs from the ones the host holds), the hit rectangle (7), the tap rectangle (4),
/// the z-index, the cover's left and top, whether it shows and whether it takes pointer events.
const HIT_OUTPUT:usize=17;const HIT_MOVED:u32=8192;

#[wasm_bindgen]
pub struct RustSceneEntryFrame{state:Vec<f64>,input:Vec<f64>,output:Vec<f64>,hit_input:Vec<f64>,hit_output:Vec<f64>,room:Box<[f64;16]>,
 /// The shared room's local motion: each key's pose at rest (nine numbers, valid when its stamp
 /// is the current generation), the keys a gesture has moved and the rows last published.
 rest:Vec<f64>,rest_stamp:Vec<u32>,rest_generation:u32,affected:Vec<bool>,published:Vec<f64>}
#[wasm_bindgen]
impl RustSceneEntryFrame{
 #[wasm_bindgen(constructor)]
 pub fn new()->Self{Self{state:Vec::new(),input:Vec::new(),output:Vec::new(),hit_input:Vec::new(),hit_output:Vec::new(),room:Box::new([0.0;16]),
  rest:Vec::new(),rest_stamp:Vec::new(),rest_generation:0,affected:Vec::new(),published:Vec::new()}}
 pub fn resize(&mut self,count:usize){
  self.state.resize(count*STATE,0.0);
  self.input.resize(count*INPUT,0.0);self.output.resize(count*OUTPUT,0.0);
  self.hit_input.resize(count*HIT_INPUT,0.0);self.hit_output.resize(count*HIT_OUTPUT,0.0);
 }
 pub fn memory(&self)->JsValue{wasm_bindgen::memory()}
 pub fn state_ptr(&self)->usize{self.state.as_ptr() as usize}
 pub fn input_ptr(&self)->usize{self.input.as_ptr() as usize}
 pub fn output_ptr(&self)->usize{self.output.as_ptr() as usize}
 pub fn hit_input_ptr(&self)->usize{self.hit_input.as_ptr() as usize}
 pub fn hit_output_ptr(&self)->usize{self.hit_output.as_ptr() as usize}
 /// The room's world matrix (`furniture.matrixWorld.elements`).
 pub fn room_ptr(&self)->usize{self.room.as_ptr() as usize}
 /// One frame for every entry, in order. `motion_frame` holds the entries' shared keys and bays
 /// (its `prepare` ran this frame) and `scene` the frame's projection state (`beginEntries`).
 pub fn step(&mut self,motion_frame:&mut RustSceneMotionFrame,scene:&RustScene,motion:&RustRoomMotion,transition:&mut RustRoomTransition,now:f64,arranging:bool){
  let room=Mat4(*self.room);
  for (index,(input,output)) in self.input.chunks_exact(INPUT).zip(self.output.chunks_exact_mut(OUTPUT)).enumerate(){
   place_entry(index,input,output,&room,motion_frame,scene,motion,transition,now,arranging);
  }
 }
 /// A frame without rigid bodies, whole: every row's lift, landing and preview ease and its
 /// pose follows (`RustScene#stepEntry`, in place), then `place`. Returns what `place` does.
 pub fn poses(&mut self,motion_frame:&mut RustSceneMotionFrame,scene:&RustScene,motion:&RustRoomMotion,transition:&mut RustRoomTransition,now:f64,arranging:bool)->f64{
  for row in self.state.chunks_exact_mut(STATE){scene.step_entry(&mut row[..40]);}
  self.place(false,motion_frame,scene,motion,transition,now,arranging)
 }
 /// A frame of the rigid bodies: the solver steps every row (`RustGravityFrame`, whose keys the
 /// host registered for these entries) and the final shelf poses are composed. `place` follows,
 /// at once (`settled`) or after the host has acknowledged a room the solver restored.
 pub fn settle(&mut self,gravity_frame:&mut RustGravityFrame,gravity:&mut RustBookGravity,scene:&RustScene,now:f64,reduced:bool){
  gravity_frame.advance_rows(gravity,scene,now,reduced,&mut self.state,STATE,LEAN);
 }
 #[allow(clippy::too_many_arguments)]
 pub fn settled(&mut self,gravity_frame:&mut RustGravityFrame,gravity:&mut RustBookGravity,motion_frame:&mut RustSceneMotionFrame,scene:&RustScene,motion:&RustRoomMotion,transition:&mut RustRoomTransition,now:f64,reduced:bool,arranging:bool)->f64{
  self.settle(gravity_frame,gravity,scene,now,reduced);
  self.place(true,motion_frame,scene,motion,transition,now,arranging)
 }
 /// Every row's pose becomes the entry's input (its quaternion is three's
 /// `Quaternion#setFromEuler`, with the host's `Math.sin` and `Math.cos`, taken again only when
 /// the Euler angles or their order moved) and `step` runs. `physics` says the rigid bodies
 /// chose the poses: a book then takes the order the solver names and its projection flags.
 /// Returns `moving | shelf moving << 1 | previewing << 2 | previewed entries << 3`, the
 /// booleans the host formerly gathered entry by entry.
 #[allow(clippy::too_many_arguments)]
 pub fn place(&mut self,physics:bool,motion_frame:&mut RustSceneMotionFrame,scene:&RustScene,motion:&RustRoomMotion,transition:&mut RustRoomTransition,now:f64,arranging:bool)->f64{
  let room=Mat4(*self.room);
  let (mut moving,mut shelf_moving,mut previewing,mut previewed)=(false,false,false,0u32);
  let rows=self.state.chunks_exact_mut(STATE).zip(self.input.chunks_exact_mut(INPUT)).zip(self.output.chunks_exact_mut(OUTPUT));
  for (index,((row,input),output)) in rows.enumerate(){
   let decorative=row[0]==1.0||row[0]==2.0;
   let away=(row[2] as u32)&1!=0;
   let (bits,active)=(row[36] as u32,row[20]!=0.0);
   moving|=active||bits&8!=0;previewing|=active;
   if bits&4!=0{previewed+=1;}
   shelf_moving|=!away&&(active||bits&25!=0);
   if physics&&row[38]!=0.0&&!row[38].is_nan(){moving=true;shelf_moving=true;}
   if physics&&!decorative{row[ORDER]=if row[37]!=0.0&&!row[37].is_nan(){1.0}else{0.0};}
   let fresh=row[FRESH]!=0.0;
   let pose=[row[29],row[30],row[31],row[32],row[33],row[34],row[35],row[ORDER]];
   let same=|from:usize,to:usize|pose[from..to].iter().zip(&row[HELD+from..HELD+to]).all(|(a,b)|a.to_bits()==b.to_bits());
   let turned=fresh||!same(3,6)||!same(7,8);
   // A remote preview or a checkpoint bridge replaced the host's pose in the previous frame.
   let pose_changed=turned||(row[LIVE] as u32)&6!=0||!same(0,3)||!same(6,7);
   if turned{
    let (c1,c2,c3)=(js_sys::Math::cos(pose[3]/2.0),js_sys::Math::cos(pose[4]/2.0),js_sys::Math::cos(pose[5]/2.0));
    let (s1,s2,s3)=(js_sys::Math::sin(pose[3]/2.0),js_sys::Math::sin(pose[4]/2.0),js_sys::Math::sin(pose[5]/2.0));
    let q=if pose[7]!=0.0{[s1*c2*c3-c1*s2*s3,c1*s2*c3+s1*c2*s3,c1*c2*s3-s1*s2*c3,c1*c2*c3+s1*s2*s3]}
     else{[s1*c2*c3+c1*s2*s3,c1*s2*c3-s1*c2*s3,c1*c2*s3+s1*s2*c3,c1*c2*c3-s1*s2*s3]};
    row[QUATERNION..QUATERNION+4].copy_from_slice(&q);
   }
   row[HELD..HELD+8].copy_from_slice(&pose);
   input[..3].copy_from_slice(&pose[..3]);input[3..7].copy_from_slice(&row[QUATERNION..QUATERNION+4]);input[7]=pose[6];
   input[8]=row[0];input[9]=if physics{row[39]}else{row[2]};
   let host=row[HOST] as u32;
   input[10]=f64::from(host&1!=0);input[11]=f64::from(host&2!=0);input[12]=f64::from(host&4!=0);
   input[13]=f64::from(host&8!=0);input[14]=f64::from(host&16!=0);input[15]=f64::from(host&32!=0);
   input[16..22].copy_from_slice(&row[BOX..BOX+6]);
   let mut held=[0u64;16];
   for (bits,value) in held.iter_mut().zip(&output[26..42]){*bits=value.to_bits();}
   let mut rect=[0u64;7];
   for (bits,value) in rect.iter_mut().zip(&output[58..65]){*bits=value.to_bits();}
   let flags=place_entry(index,input,output,&room,motion_frame,scene,motion,transition,now,arranging);
   let matrix_changed=fresh||held.iter().zip(&output[26..42]).any(|(bits,value)|*bits!=value.to_bits());
   let rect_changed=fresh||rect.iter().zip(&output[58..65]).any(|(bits,value)|*bits!=value.to_bits());
   row[CHANGED]=f64::from(u32::from(pose_changed)|u32::from(matrix_changed)<<1|u32::from(rect_changed)<<2);
   row[FRESH]=0.0;row[LIVE]=f64::from(flags);
   // The entry's local pose in the shared room, kept until it is sampled again.
   if flags&1!=0{row[LOCAL..LOCAL+9].copy_from_slice(&output[1..10]);row[LOCAL_KEY]=f64::from(motion_frame.id(index));}
  }
  f64::from(u32::from(moving)|u32::from(shelf_moving)<<1|u32::from(previewing)<<2|previewed<<3)
 }
 /// Every button's hit target, after `step` and once the host has updated the models' hit
 /// surfaces: the former per-entry `RustSceneProjectionFrame#hit`, with its retained style
 /// history, for each entry whose record says it has a button, in order. The rectangle is
 /// the one `step` projected.
 pub fn hits(&mut self,projection:&mut RustSceneProjectionFrame,scene:&RustScene){
  let entries=self.hit_input.chunks_exact(HIT_INPUT).zip(self.hit_output.chunks_exact_mut(HIT_OUTPUT))
   .zip(self.input.chunks_exact(INPUT).zip(self.output.chunks_exact(OUTPUT))).zip(self.state.chunks_exact_mut(STATE));
  for (index,(((hit,out),(input,output)),row)) in entries.enumerate(){
   let bits=hit[0] as u32;
   if bits&1==0{continue;}
   let mut io=[0.0;49];
   io[0]=input[8];io[1]=f64::from(bits&2!=0);io[2]=hit[1];io[3]=f64::from(bits&4!=0);
   io[4..11].copy_from_slice(&output[58..65]);io[11..17].copy_from_slice(&hit[2..8]);
   io[17..33].copy_from_slice(if bits&32!=0{&output[42..58]}else{&hit[8..24]});
   let dirty=projection.hit_io(scene,index,bits&8!=0,bits&16!=0,&mut io);
   // The host copies the numbers into its objects only when they moved (or it holds none yet).
   let moved=row[HIT_FRESH]!=0.0||bits&8!=0||out[1..17].iter().zip(&io[33..49]).any(|(a,b)|a.to_bits()!=b.to_bits());
   row[HIT_FRESH]=0.0;
   out[0]=f64::from(dirty|if moved{HIT_MOVED}else{0});out[1..17].copy_from_slice(&io[33..49]);
  }
 }
}

/// The shared room's local motion, formerly a pose array per entry per frame, a map of the
/// poses at rest rebuilt in every quiet frame and a set of moved keys in the host.
#[wasm_bindgen]
impl RustSceneEntryFrame{
 /// Every entry's local pose becomes its key's pose at rest: the keys are the ones registered
 /// now (an entry without one shares number 0), a later entry replaces an earlier one with the
 /// same key, and nothing is kept of the previous rest.
 pub fn motion_rest(&mut self,motion_frame:&RustSceneMotionFrame){
  self.rest_generation+=1;
  for (index,row) in self.state.chunks_exact(STATE).enumerate(){
   if row[LOCAL_KEY]==0.0{continue;}
   let id=motion_frame.id(index) as usize;
   if self.rest_stamp.len()<=id{self.rest_stamp.resize(id+1,0);self.rest.resize((id+1)*9,0.0);}
   self.rest[id*9..id*9+9].copy_from_slice(&row[LOCAL..LOCAL+9]);self.rest_stamp[id]=self.rest_generation;
  }
 }
 /// A gesture begins: no key has moved yet.
 pub fn motion_begin(&mut self){self.affected.clear();}
 /// A gesture's frame: an entry whose key has no pose at rest, that is lifted or dragged, or
 /// whose local pose is more than a millionth from its key's pose at rest joins the moved keys
 /// (under the key its pose was sampled with), and every entry of a moved key is listed, in
 /// order, as `[key number, shelf, x, y, z, quaternion, scale]` at `published_ptr`. Returns
 /// how many.
 pub fn motion_publish(&mut self,motion_frame:&RustSceneMotionFrame)->usize{
  self.published.clear();
  for (index,row) in self.state.chunks_exact(STATE).enumerate(){
   if row[LOCAL_KEY]==0.0{continue;}
   let (key,id)=(row[LOCAL_KEY] as usize,motion_frame.id(index) as usize);
   let local=&row[LOCAL..LOCAL+9];
   let rested=self.rest_generation!=0&&self.rest_stamp.get(id)==Some(&self.rest_generation);
   if !rested||(row[2] as u32)&6!=0||local.iter().zip(&self.rest[id*9..id*9+9]).any(|(value,rest)|(value-rest).abs()>0.000001){
    if self.affected.len()<=key{self.affected.resize(key+1,false);}
    self.affected[key]=true;
   }
   if self.affected.get(key)==Some(&true){self.published.push(row[LOCAL_KEY]);self.published.extend_from_slice(local);}
  }
  self.published.len()/10
 }
 pub fn published_ptr(&self)->usize{self.published.as_ptr() as usize}
 /// One placement preview (every drag move) over the arena's own preview columns (13-20),
 /// formerly copied out to a batch of eighteen numbers per entry and back. `placed` lists only
 /// the entries the arrangement places, in ascending row order, ten numbers each: the row, then
 /// `scene_preview_target`'s inputs (`row left, row top, row bottom, centre, x, y, height,
 /// under-shelf`). A placed entry heads for its target and every other one back to rest; each
 /// offset then advances as `scene_preview_offset`. Returns whether any offset changed.
 pub fn preview(&mut self,placed:&[f64],now:f64,reduced:bool)->bool{
  let (mut changed,mut next)=(false,placed.chunks_exact(10).peekable());
  for (index,row) in self.state.chunks_exact_mut(STATE).enumerate(){
   let mut goal=[0.0;2];
   if let Some(p)=next.next_if(|p|p[0]==index as f64){crate::scene_entries::scene_preview_target(p[1],p[2],p[3],p[4],p[5],p[6],p[7],p[8]!=0.0,&mut goal);}
   let mut offset=[0.0;13];
   offset[..7].copy_from_slice(&row[13..20]);offset[7]=if row[20]!=0.0{1.0}else{0.0};
   offset[8]=goal[0];offset[9]=goal[1];offset[10]=now;offset[11]=if reduced{1.0}else{0.0};
   crate::scene_entries::scene_preview_offset(&mut offset);
   row[13..20].copy_from_slice(&offset[..7]);row[20]=if offset[7]!=0.0{1.0}else{0.0};
   changed|=offset[12]!=0.0;
  }
  changed
 }
}

/// One entry of `step`: the motion sample, the pose matrix, its place in the room and the projection.
#[allow(clippy::too_many_arguments)]
fn place_entry(index:usize,input:&[f64],output:&mut [f64],room:&Mat4,motion_frame:&mut RustSceneMotionFrame,scene:&RustScene,motion:&RustRoomMotion,transition:&mut RustRoomTransition,now:f64,arranging:bool)->u32{
 let mut pose=[0.0;8];pose.copy_from_slice(&input[..8]);
 let mut live=[0.0;25];
 let flags=motion_frame.sample_pose(index,pose,motion,transition,now,arranging,&mut live);
 // The host applies the remote preview, then the checkpoint bridge: the last one stands.
 if flags&2!=0{pose.copy_from_slice(&live[9..17]);}
 if flags&4!=0{pose.copy_from_slice(&live[17..25]);}
 let matrix=Mat4::compose([pose[0],pose[1],pose[2]],[pose[3],pose[4],pose[5],pose[6]],[pose[7],pose[7],pose[7]]);
 let placed=Mat4::multiply(room,&matrix);
 let mut io=[0.0;44];
 io[..14].copy_from_slice(&input[8..22]);io[14..30].copy_from_slice(&placed.0);
 scene.project_entry(&mut io);
 output[0]=f64::from(flags);output[1..26].copy_from_slice(&live);
 output[26..42].copy_from_slice(&matrix.0);output[42..58].copy_from_slice(&placed.0);
 output[58..70].copy_from_slice(&io[30..42]);
 flags
}
