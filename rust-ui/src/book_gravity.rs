//! Persistent cuboid rigid bodies. Rapier solves contacts, friction and support
//! between every book, rather than choosing a target angle. The shelf constrains
//! books to their depth plane: they can translate and fall sideways, not leave
//! the cabinet towards the camera. All dimensions in the solver are metres.
use std::collections::{BTreeMap,BTreeSet};
use wasm_bindgen::{prelude::*,JsCast};
use js_sys::{Array,JsString};
use rapier3d::prelude::*;
use crate::scene_view::RustScene;
use crate::decor_contacts::{Description,Solid};
#[path="book_gravity_snapshot.rs"]mod snapshot;
use snapshot::RestPose;
#[path="book_gravity_audio.rs"]mod audio;
struct GentleSideContacts;
impl PhysicsHooks for GentleSideContacts{
 fn modify_solver_contacts(&self,context:&mut ContactModificationContext){
  let book=context.colliders[context.collider1].user_data==1||context.colliders[context.collider2].user_data==1;
  if book{if let Some(m)=context.rigid_mut(){
   // Side pressure is not a shelf: bookcloth must slide down instead of
   // gripping two neighbours in mid-air. Board/top friction stays intact.
   if m.normal.y.abs()<0.35{*m.friction=0.0;}
  }}
 }
}
const DT:f32=1.0/120.0;
// Scene input bits: dragging or lifted; a simple press (8) leaves the library asleep.
const HELD:u32=2|4;
// Only reading reserves a physical origin. Ordinary removal still frees supports.
const READER_ORIGIN:u32=64;
const RELEASE_WINDOW_MS:f64=180.0;
const RELEASE_TRAVEL:f32=0.0015;
const RELEASE_SPEED:f32=0.006;

fn release_direction(direction:f32,motion:f32,moved:f64,now:f64)->f32{
 if now-moved<=RELEASE_WINDOW_MS&&motion.abs()>=RELEASE_SPEED{-direction}else{0.0}
}
// Hardware event timestamps, independent of a delayed render or a queued GPU
// frame. Direct solver clients still use the frame-sampled fallback below.
struct ReleaseInput{pointer:f64,last:f64,moved:f64,motion:f32,stroke:f32,direction:f32,released:Option<f32>}
impl ReleaseInput{
 fn new(x:f64,at:f64)->Self{Self{pointer:x,last:at,moved:f64::NEG_INFINITY,motion:0.0,stroke:0.0,direction:0.0,released:None}}
 fn update(&mut self,x:f64,at:f64,scale:f64){
  let dt=((at-self.last)/1000.0).clamp(1.0/240.0,0.1);let dx=(x-self.pointer)/scale;
  if dx.abs()>0.00001{
   self.motion+=(dx as f32/dt as f32-self.motion)*(1.0-(-dt/0.07).exp()) as f32;
   self.stroke=if at-self.moved<=RELEASE_WINDOW_MS&&self.stroke.signum()==(dx as f32).signum(){self.stroke+dx as f32}else{dx as f32};
   self.moved=at;self.direction=if self.stroke.abs()>=RELEASE_TRAVEL{self.stroke.signum()}else{0.0};
  }else{self.motion*=(-dt as f32/0.07).exp();}
  self.pointer=x;self.last=at;
 }
}

struct Book{input:Option<ReleaseInput>,reader:bool,sound_until:f64,landing_sound:bool,landing_height:f32,name:JsString,restored:bool,handle:RigidBodyHandle,collider:ColliderHandle,solid:Option<SharedShape>,decor_landing:bool,base:[f64;4],size:[f64;3],held:bool,home:Option<(Pose,[f32;4])>,recovery:Option<Vector>,firm_grip:bool,anchor:Vector,goal:Vector,kind:u32,grip_angle:f32,grip_time:f32,pointer:[f64;2],fast_until:f64,fast_grip:bool,contacting:bool,clearance:f32,bay:[f32;4],grip:f32,motion:f32,motion_at:f64,stroke:f32,direction:f32,release:f32,release_time:f32,quiet:Option<(Vector,f32,f32)>}
fn overlapping(a:&RigidBody,sa:[f64;3],b:&RigidBody,sb:[f64;3],resting:bool)->bool{
 let pa=a.translation();let pb=b.translation();
 if (pa.z-pb.z).abs()>(sa[2]+sb[2]) as f32/2.0{return false;}
 // Resting soft contacts can overlap by a fraction of a millimetre.
 // Reattaching them is safe; deep overlap after a fast sweep stays isolated.
 // Scale the allowance down for exceptionally thin books.
 let tolerance=(if resting{0.001_f64}else{0.0002_f64}).min(sa[0].min(sb[0])*0.1) as f32;
 let aa=a.rotation().to_scaled_axis().z;let ab=b.rotation().to_scaled_axis().z;
 for theta in [aa,aa+std::f32::consts::FRAC_PI_2,ab,ab+std::f32::consts::FRAC_PI_2]{
  let axis=Vector::new(theta.cos(),theta.sin(),0.0);
  let radius=|size:[f64;3],angle:f32|size[0] as f32/2.0*(angle-theta).cos().abs()+size[1] as f32/2.0*(angle-theta).sin().abs();
  if (pa-pb).dot(axis).abs()>=radius(sa,aa)+radius(sb,ab)-tolerance{return false;}
 }true
}
fn constrain(body:&mut RigidBody,size:[f64;3],bay:[f32;4]){
 let a=body.rotation().to_scaled_axis().z;
 let x=size[0] as f32/2.0*a.cos().abs()+size[1] as f32/2.0*a.sin().abs();
 let y=size[1] as f32/2.0*a.cos().abs()+size[0] as f32/2.0*a.sin().abs();
 let p=body.translation();let mut next=p;let mut v=body.linvel();
 if bay[1]-bay[0]>=2.0*x{next.x=p.x.clamp(bay[0]+x,bay[1]-x);}
 next.y=p.y.max(bay[2]+y);if bay[3]-bay[2]>=2.0*y{next.y=next.y.min(bay[3]-y);}
 if next!=p{
  if (next.x>p.x&&v.x<0.0)||(next.x<p.x&&v.x>0.0){v.x=0.0;}
  if (next.y>p.y&&v.y<0.0)||(next.y<p.y&&v.y>0.0){v.y=0.0;}
  body.set_translation(next,false);body.set_linvel(v,false);
 }
}
#[wasm_bindgen]
pub struct RustBookGravity{world:PhysicsWorld,plane:RigidBodyHandle,books:BTreeMap<Vec<u16>,Book>,walls:BTreeMap<i64,(Vec<f64>,Vec<RigidBodyHandle>)>,layout:Vec<f64>,wall:f64,last:Option<f64>,carry:f64,initialized:bool,saved:BTreeMap<Vec<u16>,RestPose>,saved_layout:Vec<f64>,snapshot_dirty:bool,snapshot_allowed:bool,solids:BTreeMap<Vec<u16>,Solid>,shape_cache:Vec<Solid>,sounds_enabled:bool,audio_velocities:std::collections::HashMap<ColliderHandle,audio::Velocity>,pending_sounds:Vec<f64>}
impl RustBookGravity{
 // Search actual fitted solids at the release height. Full plant foliage,
 // empty tripod gaps and the wide foot of a narrow chimney reserve no air.
 fn clear_position(&self,key:&Vec<u16>,mut pose:Pose,bay:[f32;4],up:bool)->Option<Pose>{
  let b=&self.books[key];let shape=self.world.colliders[b.collider].shape();
  let initial=shape.compute_aabb(&pose);let ext=initial.extents();
  if ext.x>bay[1]-bay[0]||ext.y>bay[3]-bay[2]{return None;}
  pose.translation.x+=if initial.mins.x<bay[0]{bay[0]-initial.mins.x}else if initial.maxs.x>bay[1]{bay[1]-initial.maxs.x}else{0.0};
  pose.translation.y+=if initial.mins.y<bay[2]{bay[2]-initial.mins.y}else if initial.maxs.y>bay[3]{bay[3]-initial.maxs.y}else{0.0};
  let origin=pose.translation;let bounds=shape.compute_aabb(&pose);
  let others:Vec<_>=self.books.iter().filter(|(k,o)|*k!=key&&!o.held&&self.world.colliders[o.collider].is_enabled()).map(|(_,o)|{
   let shape=self.world.colliders[o.collider].shared_shape().clone();let pose=*self.world.bodies[o.handle].position();let bounds=shape.compute_aabb(&pose);(shape,pose,bounds)
  }).filter(|(_,_,a)|a.mins.z<=bounds.maxs.z&&a.maxs.z>=bounds.mins.z&&a.mins.y<=bay[3]&&a.maxs.y>=bay[2]&&a.mins.x<=bay[1]&&a.maxs.x>=bay[0]).collect();
  let clear=|position:Vector|{
   let mut pose=pose;pose.translation=position;let bounds=shape.compute_aabb(&pose);
   others.iter().all(|(other,p,a)|bounds.maxs.x<a.mins.x||bounds.mins.x>a.maxs.x||bounds.maxs.y<a.mins.y||bounds.mins.y>a.maxs.y||!rapier3d::parry::query::intersection_test(&pose,shape,p,other.as_ref()).map_or(true,|hit|hit.intersecting))
  };
  let fits=|position:Vector|{
   let delta=position-origin;
   let visible=if b.kind==1{position.y-b.size[1] as f32/2.0>=bay[2]-1e-6&&position.y+b.size[1] as f32/2.0<=bay[3]+1e-6}else if b.kind==2{position.y>=bay[2]-1e-6&&position.y+b.size[1] as f32<=bay[3]+1e-6}else{true};
   visible&&bounds.mins.x+delta.x>=bay[0]-1e-6&&bounds.maxs.x+delta.x<=bay[1]+1e-6&&bounds.mins.y+delta.y>=bay[2]-1e-6&&bounds.maxs.y+delta.y<=bay[3]+1e-6
  };
  if fits(origin)&&clear(origin){return Some(pose);}
  let mut heights=vec![origin.y];let margin=0.0006;
  if up{for (_,_,a) in &others{heights.push(origin.y+(a.maxs.y-bounds.mins.y+margin).max(0.0));}}
  let mut edges=vec![bay[0]-bounds.mins.x, bay[1]-bounds.maxs.x];
  for (other,p,a) in &others{
   edges.extend([a.mins.x-bounds.maxs.x-margin,a.maxs.x-bounds.mins.x+margin]);
   // A few separated legs need their own edges; dense revolved profiles are
   // refined with the narrow phase below, without a per-frame vertex scan.
   if let Some(compound)=other.as_compound(){if compound.shapes().len()<=5{for (part,shape) in compound.shapes(){let a=shape.compute_aabb(&(*p**part));edges.extend([a.mins.x-bounds.maxs.x-margin,a.maxs.x-bounds.mins.x+margin]);}}}
  }
  heights.sort_by(f32::total_cmp);heights.dedup_by(|a,b|(*a-*b).abs()<0.0001);
  edges.sort_by(|a,b|a.abs().total_cmp(&b.abs()));edges.dedup_by(|a,b|(*a-*b).abs()<0.0001);
  let mut best:Option<Vector>=None;
  for y in heights{
   let start=Vector::new(origin.x,y,origin.z);
   if !fits(start)||best.is_some_and(|v|(y-origin.y).powi(2)>=(v-origin).length_squared()){continue;}
   if clear(start){best=Some(start);continue;}
   for side in [-1.0_f32,1.0]{
    for &dx in edges.iter().filter(|dx|**dx*side>0.0){
     let mut free=start+Vector::new(dx,0.0,0.0);
     if !fits(free)||!clear(free){continue;}
     // Only the nearest clear edge on either side needs refinement. This
     // bounds narrow-phase work even in a crowded row during pointer input.
     let mut blocked=start;
     if !clear(blocked){for _ in 0..16{let middle=(free+blocked)/2.0;if clear(middle){free=middle;}else{blocked=middle;}}}
     let padded=free+Vector::new(side*0.00015,0.0,0.0);
     if fits(padded)&&clear(padded){free=padded;}
     if best.is_none_or(|v|(free-origin).length_squared()<(v-origin).length_squared()){best=Some(free);}
     break;
    }
   }
  }
  best.map(|position|{pose.translation=position;pose})
 }
 // A fast grip can cross a row without contacts. Re-enable only after the
 // selected item is clear; penetration correction must never shove a row.
 fn clear_release(&mut self,key:&Vec<u16>){
  let b=&self.books[key];let pose=*self.world.bodies[b.handle].position();
  let destination=self.clear_position(key,pose,b.bay,true).or_else(||b.home.filter(|(_,bay)|*bay==b.bay).and_then(|(pose,bay)|self.clear_position(key,pose,bay,true)));
  if let Some(position)=destination{if position!=pose{
   let b=self.books.get_mut(key).unwrap();let body=&mut self.world.bodies[b.handle];
   body.set_position(position,true);body.set_linvel(Vector::ZERO,true);body.set_angvel(Vector::ZERO,true);
   body.reset_forces(false);body.reset_torques(false);b.release=0.0;b.quiet=None;
  }}
 }
 fn intersects(&self,a:&Book,b:&Book,resting:bool)->bool{
  if !self.world.colliders[a.collider].is_enabled()||!self.world.colliders[b.collider].is_enabled(){return false;}
  if a.solid.is_none()&&b.solid.is_none(){return overlapping(&self.world.bodies[a.handle],a.size,&self.world.bodies[b.handle],b.size,resting);}
  let tolerance=(if resting{0.001_f64}else{0.0002_f64}).min(a.size[0].min(b.size[0])*0.1) as f32;
  let cuboid=|s:[f64;3]|rapier3d::parry::shape::Cuboid::new(Vector::new((s[0] as f32/2.0-tolerance/2.0).max(1e-6),(s[1] as f32/2.0-tolerance/2.0).max(1e-6),(s[2] as f32/2.0-tolerance/2.0).max(1e-6)));
  let ca=cuboid(a.size);let cb=cuboid(b.size);
  let sa:&dyn rapier3d::parry::shape::Shape=if let Some(s)=&a.solid{s.as_ref()}else{&ca};
  let sb:&dyn rapier3d::parry::shape::Shape=if let Some(s)=&b.solid{s.as_ref()}else{&cb};
  rapier3d::parry::query::intersection_test(&self.world.bodies[a.handle].position(),sa,&self.world.bodies[b.handle].position(),sb).is_ok_and(|hit|hit.intersecting)
 }
 fn wake_rows(&mut self,rows:&BTreeSet<i64>){
  // Fixed shelves separate contact islands. Picking one book must not wake
  // hundreds of settled bodies on unrelated boards/cabinets.
  for b in self.books.values_mut(){if self.world.bodies[b.handle].is_dynamic()&&rows.contains(&(b.base[2] as i64)){
   self.world.bodies[b.handle].wake_up(true);b.quiet=None;b.restored=false;
  }}
 }
 fn cabinet(&mut self,g:&[f64],metal:bool){
  let side=if metal{crate::cabinet::BAGGEBO.post_size/1000.0}else{12.0/0.65/1000.0};
  let board=if metal{crate::cabinet::BAGGEBO.shelf_rim_height/1000.0}else{15.0/0.65/1000.0};
  let layout:Vec<f64>=g.chunks_exact(9).flat_map(|r|[r[2],r[3],r[4],r[5],r[6],r[7]]).collect();
  // Ignore book membership and order when deciding whether cabinet colliders changed.
  let mut rows:BTreeMap<i64,[f64;6]>=BTreeMap::new();
  for r in layout.chunks_exact(6){rows.entry(r[0] as i64).or_insert(r.try_into().unwrap());}
  let mut signature:Vec<f64>=rows.values().flatten().copied().collect();signature.extend([side,board]);
  // Re-solve old metal poses that rested on the former overlapping ceiling,
  // preserving their remembered angles instead of reseeding a new layout.
  if metal{signature.push(1.0);}
  if signature==self.layout{return;}
  // Occupying/vacating a bay is not a replacement of the entire cabinet.
  // Retain the exact fixed bodies of every unchanged bay/contact island.
  let mut changed_rows=BTreeSet::new();
  let removed:Vec<_>=self.walls.keys().filter(|key|!rows.contains_key(key)).copied().collect();
  for key in removed{if let Some((_,handles))=self.walls.remove(&key){for h in handles{self.world.remove_body(h);}}changed_rows.insert(key);}
  for r in rows.values(){
   let p=r[1];if !r.iter().all(|v|v.is_finite())||p<=0.0{continue;}
   // The physical contact sits 0.6 mm inside the hard guard. Solver tolerance
   // then never fights the exact bounds or continually wakes a resting island.
   let (left,right,bottom,top)=(r[2]/p,r[3]/p,-r[4]/p+0.0010,-r[5]/p-0.0010);
   if right<=left||top<=bottom{continue;}
   // Adjacent bays share one board. A metal rim is deeper than the
   // centre sheet: extruding the lower bay's ceiling upwards by the rim
   // height raised the upper floor by 11.7 mm and trapped decoration.
   // Bound the shared slab by the actual floor/ceiling surfaces supplied
   // by the layout, then let its floor collider own that shared board.
   let mut floor_height=board;let mut ceiling_owned=false;
   for other in rows.values(){
    if other[1]!=p||other[2]!=r[2]||other[3]!=r[3]{continue;}
    let below=bottom-(-other[5]/p-0.0010);
    if below>0.0&&below<=board{floor_height=floor_height.min(below);}
    let above=(-other[4]/p+0.0010)-top;
    if above>0.0&&above<=board{ceiling_owned=true;}
   }
   floor_height=floor_height.max(0.0002);
   let mut plan=Vec::new();
   for (index,(x,y,hx,hy)) in [((left+right)/2.0,bottom-floor_height/2.0,(right-left)/2.0,floor_height/2.0),
    ((left+right)/2.0,top+board/2.0,(right-left)/2.0,board/2.0),
    (left+side/2.0,(bottom+top)/2.0,side/2.0+0.0010,(top-bottom)/2.0),
    (right-side/2.0,(bottom+top)/2.0,side/2.0+0.0010,(top-bottom)/2.0)].into_iter().enumerate(){
    if index==1&&ceiling_owned{continue;}
    plan.extend([index as f64,x,y,hx,hy]);
   }
   plan.push(if metal{1.0}else{0.0});let row=r[0] as i64;
   if self.walls.get(&row).is_some_and(|(previous,_)|*previous==plan){continue;}
   if let Some((_,handles))=self.walls.remove(&row){for h in handles{self.world.remove_body(h);}}
   let mut handles=Vec::new();
   for wall in plan[..plan.len()-1].chunks_exact(5){let (index,x,y,hx,hy)=(wall[0] as usize,wall[1],wall[2],wall[3],wall[4]);
    let (h,_)=self.world.insert(RigidBodyBuilder::fixed().translation(Vector::new(x as f32,y as f32,-0.15)),
     ColliderBuilder::cuboid(hx as f32,hy as f32,0.6).user_data(10+if metal{2}else{1}).friction(if index==0{1.2}else{0.65}).friction_combine_rule(if index==0{CoefficientCombineRule::Max}else{CoefficientCombineRule::Average}).collision_groups(InteractionGroups::new(Group::GROUP_2,Group::ALL,InteractionTestMode::And)));handles.push(h);
   }
   self.walls.insert(row,(plan,handles));changed_rows.insert(row);
  }
  self.layout=signature;self.snapshot_dirty=true;self.wake_rows(&changed_rows);
 }
}
#[wasm_bindgen]
impl RustBookGravity{
 #[wasm_bindgen(constructor)]pub fn new()->Self{
  let mut world=PhysicsWorld::new();world.gravity=Vector::new(0.0,-5.5,0.0);
  world.integration_parameters.dt=DT;
  world.integration_parameters.normalized_allowed_linear_error=0.00015;
  world.integration_parameters.num_solver_iterations=8;
  world.integration_parameters.friction_model=FrictionModel::Coulomb;
  world.integration_parameters.normalized_contact_recycle_distance=0.0005;
  world.integration_parameters.normalized_prediction_distance=0.0005;
  let plane=world.insert_body(RigidBodyBuilder::fixed());
  Self{world,plane,books:BTreeMap::new(),walls:BTreeMap::new(),layout:Vec::new(),wall:12.0/0.65/1000.0,last:None,carry:0.0,initialized:false,saved:BTreeMap::new(),saved_layout:Vec::new(),snapshot_dirty:false,snapshot_allowed:true,solids:BTreeMap::new(),shape_cache:Vec::new(),sounds_enabled:false,audio_velocities:std::collections::HashMap::new(),pending_sounds:Vec::new()}
 }
 /// Resolve a pointer drop against current rigid bodies without moving any
 /// neighbour. Geometry is [row, centre, left, right, bottom, ceiling, pixels/metre].
 pub fn drop_position(&self,key:&JsValue,g:&[f64])->Vec<f64>{
  if !key.is_string()||g.len()!=7||g.iter().any(|v|!v.is_finite())||g[0]<0.0||g[0].fract()!=0.0||g[6]<=0.0{return vec![];}
  let key:Vec<u16>=key.unchecked_ref::<JsString>().iter().collect();let Some(b)=self.books.get(&key)else{return vec![];};let p=g[6];
  let bay=[(g[2]/p+self.wall+0.0004) as f32,(g[3]/p-self.wall-0.0004) as f32,(-g[4]/p+0.0004) as f32,(-g[5]/p-0.0004) as f32];
  if bay[0]>=bay[1]||bay[2]>=bay[3]{return vec![];}
  // A deliberate physical push has already displaced its contacts safely.
  // Rejecting its nominal interval would undo that interaction on release.
  if b.kind==0&&b.held&&b.contacting&&b.base[2]==g[0]{return vec![self.world.bodies[b.handle].translation().x as f64*p];}
  let mut pose=*self.world.bodies[b.handle].position();pose.translation.x=(g[1]/p) as f32;
  // Undo the presentation lift for solid decorations. Books retain their
  // constrained depth plane; their current angle determines their floor toe.
  if b.kind!=0{pose.translation.z=b.home.map_or(-(b.size[2]/2.0) as f32,|(pose,_)|pose.translation.z);}
  let shape=self.world.colliders[b.collider].shape();let bounds=shape.compute_aabb(&pose);pose.translation.y+=bay[2]-bounds.mins.y;
  self.clear_position(&key,pose,bay,true).map_or_else(Vec::new,|pose|vec![pose.translation.x as f64*p])
 }
 /// Register the fitted solid before the first physics step. No meshes,
 /// leaves or per-frame hull construction cross into the contact solver.
 pub fn decoration(&mut self,key:&JsValue,kind:u32,pot:&str,profile:&str,values:&[f64]){
  if !key.is_string()||values.len()!=4||values.iter().any(|v|!v.is_finite())||!(1..=3).contains(&kind){return;}
  if kind==1&&(values[0]<=0.0||values[1]<=0.0||values[2]<=0.0)||kind!=1&&values[3]<=0.0{return;}
  let name:Vec<u16>=key.unchecked_ref::<JsString>().iter().collect();
  let description=Description{kind,pot:pot.into(),profile:profile.into(),values:values.try_into().unwrap()};
  if self.solids.get(&name).is_some_and(|s|s.description.same(&description)){return;}
  let solid=if let Some(s)=self.shape_cache.iter().find(|s|s.description.same(&description)){s.clone()}else{
   let Some(s)=Solid::new(description)else{return;};if self.shape_cache.len()>=64{self.shape_cache.remove(0);}self.shape_cache.push(s.clone());s
  };
  if let Some(b)=self.books.get_mut(&name){
   self.world.colliders[b.collider].set_shape(solid.shape.clone());b.solid=Some(solid.shape.clone());
   let row=b.base[2] as i64;self.wake_rows(&BTreeSet::from([row]));
  }
  self.solids.insert(name,solid);
 }
 /// A hidden document resumes its existing poses, without simulating the
 /// elapsed time in the background as one expensive catch-up frame.
 /// Pointer phases: begin, move, release, cancel. The decision is frozen at
 /// the input event, before clearing DOM offsets or waiting for a scene draw.
 pub fn record_pointer(&mut self,key:JsValue,x:f64,at:f64,phase:u32){
  if !x.is_finite()||!at.is_finite(){return;}
  if !key.is_string(){return;}
  let name:Vec<u16>=key.unchecked_ref::<JsString>().iter().collect();
  let Some(b)=self.books.get_mut(&name) else{return;};
  if b.kind!=0{return;}
  if phase==0{b.input=Some(ReleaseInput::new(x,at));return;}
  let Some(input)=&mut b.input else{return;};
  if input.released.is_some(){return;}
  input.update(x,at,b.base[3]);
  if phase==2{input.released=Some(release_direction(input.direction,input.motion,input.moved,at));}
  else if phase==3{input.released=Some(0.0);}
 }
 pub fn pause(&mut self){self.last=None;self.carry=0.0;self.pending_sounds.clear();self.audio_velocities.clear();for b in self.books.values_mut(){b.landing_sound=false;}}
 /// One batch across the WASM boundary. States use RustScene.stepEntry's 37
 /// numbers. Geometry: thickness, kind (book/plant/lamp/puck), row, pixels/metre,
 /// row left/right/bottom/ceiling, grip height as a fraction of book height. Output: angle, world dx/dy, active.
 pub fn step(&mut self,keys:&Array,states:&mut[f64],geometry:&[f64],scene:&RustScene,now:f64,reduced:bool,out:&mut[f64]){
  let count=keys.length() as usize;
  if states.len()!=count*37||geometry.len()!=count*9||out.len()!=count*4{return;}
  out.fill(0.0);
  for state in states.chunks_exact_mut(37){
   scene.step_entry(state);
   if state[0]==0.0&&state[2] as u32&1==0{
    // A book remains in its physical depth plane. Inverting a 3D screen
    // lift and then discarding its Z translated it sideways into neighbours
    // before the finger moved, so the penetration guard isolated the grip.
    // Invert the XY projection of that plane for the actual pointer. The
    // pickup itself lifts only vertically; it never enters an adjacent slot.
    let [qx,qy,qz,qw]=scene.entry_q;
    let a=1.0-2.0*(qy*qy+qz*qz);let b=2.0*(qx*qy+qz*qw);
    let c=2.0*(qx*qy-qz*qw);let d=1.0-2.0*(qx*qx+qz*qz);let det=a*d-b*c;
    if det.abs()>1e-6&&scene.entry_zoom>0.0{
     let dragging=state[2] as u32&2!=0;
     let x=(if dragging{state[3]}else{0.0})+state[21];
     let y=-((if dragging{state[4]}else{0.0})+state[22]);
     state[29]=state[23]-scene.width/2.0+(d*x-b*y)/(det*scene.entry_zoom)+state[13];
     state[30]=-state[24]+(a*y-c*x)/(det*scene.entry_zoom)+18.0*state[5]/scene.entry_zoom+state[14];
    }
    state[31]=-state[25]/2.0-if state[28].is_finite(){state[28]}else{0.0};
    state[33]=std::f64::consts::FRAC_PI_2;
    state[35]=1.0;
   }
  }
  self.snapshot_allowed=!states.chunks_exact(37).any(|s|{let flags=s[2] as u32;flags&HELD!=0||flags&1!=0&&flags&READER_ORIGIN==0});
  let was_active=self.books.values().any(|b|self.world.bodies[b.handle].is_dynamic()&&!self.world.bodies[b.handle].is_sleeping());
  self.cabinet(geometry,scene.baggebo);
  let frame_dt=self.last.map_or(1.0/60.0,|t|((now-t)/1000.0).clamp(1.0/240.0,0.1));
  let wall=if scene.baggebo{crate::cabinet::BAGGEBO.post_size/1000.0}else{12.0/0.65/1000.0};self.wall=wall;
  let names:Vec<Vec<u16>>=keys.iter().map(|k|if k.is_string(){k.unchecked_ref::<JsString>().iter().collect()}else{Vec::new()}).collect();
  let live:BTreeSet<&Vec<u16>>=names.iter().collect();
  let removed:Vec<Vec<u16>>=self.books.keys().filter(|k|!live.contains(k)).cloned().collect();
  self.solids.retain(|key,_|live.contains(key));
  let membership_changed=!removed.is_empty();let mut disturbed=BTreeSet::new();
  if membership_changed{for key in removed{let b=self.books.remove(&key).unwrap();disturbed.insert(b.base[2] as i64);self.world.remove_body(b.handle);}}
  let any_held=states.chunks_exact(37).any(|s|s[2] as u32&HELD!=0)||self.books.values().any(|b|b.held);
  let mut changed=membership_changed;let mut isolated_releases=Vec::new();let mut fresh_books=Vec::new();
  for (i,key) in names.iter().enumerate(){
   let s=&states[i*37..i*37+37];let g=&geometry[i*9..i*9+9];
   let p=g[3];let kind=g[1] as u32;let flags=s[2] as u32;let held=flags&HELD!=0;let away=flags&1!=0;let reader=flags&READER_ORIGIN!=0;
   if !g[..8].iter().all(|v|v.is_finite())||p<=0.0||!s[23..27].iter().all(|v|v.is_finite())||!g[0].is_finite()||g[0]<=0.0||s[26]<=0.0{if let Some(b)=self.books.remove(key){disturbed.insert(b.base[2] as i64);self.world.remove_body(b.handle);changed=true;}continue;}
   if kind==3||away&&!reader{if let Some(b)=self.books.remove(key){disturbed.insert(b.base[2] as i64);self.world.remove_body(b.handle);changed=true;}continue;}
   let base=[s[23]/p,-s[24]/p,g[2],p];
   let h=s[26]/p;let thickness=g[0]/p;let depth=if kind==0||!s[27].is_finite()||s[27]<=0.0{s[25]/p}else{s[27]/p};
   let size=[thickness,h,depth.max(0.005)];
   let bay=[(g[4]/p+wall+0.0004) as f32,(g[5]/p-wall-0.0004) as f32,(-g[6]/p+0.0004) as f32,(-g[7]/p-0.0004) as f32];
   // stepEntry's x is relative to the complete cabinet centre; convert back
   // using its resting x (not a camera projection) without exposing camera math.
   let mut target=Vector::new((base[0]+(s[29]-(s[23]-scene.width/2.0))/p) as f32,(s[30]/p) as f32,(s[31]/p) as f32);
   if kind!=0&&self.solids.contains_key(key)&&!held&&!self.books.get(key).is_some_and(|b|b.decor_landing)&&s[5]>0.0&&scene.entry_zoom>0.0{
    // Short press feedback is visual; it must not move a resting solid or
    // accumulate a depth offset when the press animation returns to zero.
    let [qx,qy,qz,qw]=scene.entry_q;let vy=18.0*s[5]/scene.entry_zoom;let vz=30.0*s[5]/scene.entry_zoom;
    let (tx,ty,tz)=(2.0*(qy*vz-qz*vy),-2.0*qx*vz,2.0*qx*vy);
    target-=Vector::new(((qw*tx+qy*tz-qz*ty)/p) as f32,((vy+qw*ty+qz*tx-qx*tz)/p) as f32,((vz+qw*tz+qx*ty-qy*tx)/p) as f32);
   }
   let replace=self.books.get(key).is_some_and(|b|b.kind!=kind||b.size.iter().zip(size).any(|(a,b)|(a-b).abs()>0.0001));
   if replace{let b=self.books.remove(key).unwrap();disturbed.insert(b.base[2] as i64);self.world.remove_body(b.handle);changed=true;}
   if !self.books.contains_key(key){
    disturbed.insert(g[2] as i64);
    let remembered=if !self.initialized&&!held{self.saved.get(key).filter(|s|s.matches(kind,base,size,bay)).cloned()}else{None};
    if kind==0&&remembered.is_none()&&!held{fresh_books.push(key.clone());}
    let mut angle=remembered.as_ref().map_or(0.0,|s|s.angle as f64);
    if kind==0&&!held&&remembered.is_none(){
     // Tiny, deterministic initial lean only where there is room. This puts
     // unsupported legacy books just beyond their tipping point; subsequent
     // angles are entirely the solver's result, including chains and stacks.
     let mut left=base[0]-bay[0] as f64-thickness/2.0;let mut right=bay[1] as f64-base[0]-thickness/2.0;
     for (j,other) in geometry.chunks_exact(9).enumerate(){if j==i||other[2]!=g[2]||other[1]==3.0{continue;}
      let os=&states[j*37..j*37+37];if os[2] as u32&1!=0{continue;}
      let gap=((os[23]-s[23]).abs()-(other[0]+g[0])/2.0)/p;
      if os[23]<s[23]{left=left.min(gap);}else{right=right.min(gap);}
     }
     let room=left.max(right);let tilt=(thickness/h).atan()+0.012;
     if room>h*tilt.sin()+0.001{angle=if right>=left{-tilt}else{tilt};}
    }
    // Start a legacy lean around its original bottom toe, not its
    // centre: rotating about the centre pushes the raised bottom corner
    // into its neighbour and can create an artificial wedged support.
    let x=remembered.as_ref().map_or_else(||base[0]+angle.signum()*thickness/2.0*(angle.cos()-1.0)-h/2.0*angle.sin(),|s|s.x as f64+if s.portable{base[0]-s.base[0]}else{0.0});
    let y=remembered.as_ref().map_or_else(||if kind==2{target.y as f64}else{base[1]+h/2.0*(angle.cos()-1.0)+thickness/2.0*angle.sin().abs()},|s|s.y as f64+if s.portable{base[1]-s.base[1]}else{0.0});
    let solid=self.solids.get(key).map(|s|s.shape.clone());
    let body=if kind==0||solid.is_some(){RigidBodyBuilder::dynamic()}else{RigidBodyBuilder::fixed()}
     .translation(Vector::new(x as f32,y as f32,(s[31]/p) as f32))
     .rotation(Vector::new(0.0,0.0,angle as f32))
     .locked_axes(if kind==0{LockedAxes::ROTATION_LOCKED_X|LockedAxes::ROTATION_LOCKED_Y}else{LockedAxes::ROTATION_LOCKED_X|LockedAxes::ROTATION_LOCKED_Y|LockedAxes::ROTATION_LOCKED_Z|LockedAxes::TRANSLATION_LOCKED_X|LockedAxes::TRANSLATION_LOCKED_Z})
     .linear_damping(2.2).angular_damping(3.8).ccd_enabled(true);
    let restored=remembered.as_ref().is_some_and(|r|r.solid==self.solids.get(key).map(|s|s.description.signature()));
    let shape=solid.clone().unwrap_or_else(||SharedShape::cuboid((thickness/2.0) as f32,(h/2.0) as f32,(size[2]/2.0) as f32));
    let (handle,collider)=self.world.insert(body,ColliderBuilder::new(shape).density(650.0).user_data(kind as u128+1).active_hooks(if kind==0{ActiveHooks::MODIFY_SOLVER_CONTACTS}else{ActiveHooks::empty()}).friction(0.65).restitution(0.0).collision_groups(InteractionGroups::new(Group::GROUP_1,Group::ALL,InteractionTestMode::And)));
    if kind==0{
     // A hard Z lock makes the two-axis friction mass matrix singular in
     // Rapier 3D: both tangential impulses become zero, including sideways
     // grip on a shelf. A planar joint enforces the same depth constraint
     // while leaving the contact solver's mass matrix invertible.
     self.world.insert_impulse_joint(self.plane,handle,GenericJointBuilder::new(JointAxesMask::LIN_Z).local_anchor1(Vector::new(0.0,0.0,(s[31]/p) as f32)));
    }
    let b=&mut self.world.bodies[handle];if kind==0&&!held{constrain(b,size,bay);}b.activation_mut().time_until_sleep=0.4;b.activation_mut().angular_threshold=0.003;b.activation_mut().normalized_linear_threshold=0.005;
    let name=keys.get(i as u32);let name=if name.is_string(){name.unchecked_into::<JsString>()}else{JsString::from("")};
    self.books.insert(key.clone(),Book{input:None,reader:false,sound_until:0.0,landing_sound:false,landing_height:0.0,name,restored,handle,collider,solid,decor_landing:false,base,size,held:false,home:None,recovery:None,firm_grip:false,anchor:Vector::ZERO,goal:target,kind,grip_angle:angle as f32,grip_time:0.0,pointer:[s[3],s[4]],fast_until:0.0,fast_grip:false,contacting:false,clearance:0.0,bay,grip:0.0,motion:0.0,motion_at:f64::NEG_INFINITY,stroke:0.0,direction:0.0,release:0.0,release_time:0.0,quiet:None});changed=true;
   }
   let b=self.books.get_mut(key).unwrap();let body=&mut self.world.bodies[b.handle];
   if reader&&kind==0{
    // Keep the original rigid pose and its support while the visual book is
    // in the reader. No new body, seed angle, placement or neighbour rollback.
    if !b.reader{
     body.set_body_type(RigidBodyType::Fixed,false);body.set_linvel(Vector::ZERO,false);body.set_angvel(Vector::ZERO,false);
     body.reset_forces(false);body.reset_torques(false);b.reader=true;b.held=false;b.release=0.0;b.recovery=None;
     self.world.colliders[b.collider].set_collision_groups(InteractionGroups::new(Group::GROUP_1,Group::ALL,InteractionTestMode::And));
     changed=true;
    }
    b.restored=true;b.base=base;b.bay=bay;continue;
   }
   if b.reader{
    body.set_body_type(RigidBodyType::Dynamic,false);body.sleep();
    b.reader=false;b.restored=true;b.held=false;b.release=0.0;b.quiet=None;changed=true;
   }
   if held{b.restored=false;if !b.held{b.home=Some((*body.position(),b.bay));b.recovery=None;b.firm_grip=false;}}else{b.recovery=None;}
   if !held&&(b.held&&(kind!=0||!b.contacting)||!b.held&&b.base!=base){isolated_releases.push(key.clone());}
   if kind!=0{
    if b.solid.is_some(){
     // The chosen X/Z and upright orientation stay fixed, but a pot may
     // rest on a fallen cover. A fixed pot at board level trapped that
     // cover against the floor and kept its whole contact island awake.
     let active_type=if held{RigidBodyType::Fixed}else{RigidBodyType::Dynamic};
     if body.body_type()!=active_type{body.set_body_type(active_type,true);changed=true;}
     if b.held&&!held{
      // Its first contact after the hand lets go is its landing sound, however gentle.
      b.landing_sound=self.sounds_enabled;
      // The finger may still hold the pot across the upper board when its
      // chosen slot is on the next bay. Enter that bay before contacts resume;
      // otherwise the ceiling can support it forever on the wrong side.
      let mut position=body.translation();
      if b.base!=base||b.pointer[0].abs()+b.pointer[1].abs()>0.01{position.x=base[0] as f32;}
      let foot=if kind==1{h as f32/2.0}else{0.0};
      let low=bay[2]+foot;let high=bay[3]-(h as f32-foot);
      position.y=if low<=high{position.y.clamp(low,high)}else{position.y.max(low)};
      // Lift depth belongs to the held presentation, never the saved solid.
      position.z=-(depth/2.0+if s[28].is_finite(){s[28]/p}else{0.0}) as f32;
      b.landing_height=position.y;
      body.set_translation(position,true);body.set_linvel(Vector::new(0.0,body.linvel().y.clamp(-0.12,0.0),0.0),true);body.set_angvel(Vector::ZERO,true);
     }
     if held{b.pointer=[s[3],s[4]];}
     let collider=&mut self.world.colliders[b.collider];
     if collider.is_enabled()==held{collider.set_enabled(!held);disturbed.insert(b.base[2] as i64);disturbed.insert(g[2] as i64);changed=true;}
     let mut delta=target-b.goal;
     // During a real grip, follow the lift/landing origin. On release,
     // gravity owns Y; never teleport the pot down through a book stack.
     // Press feedback keeps its old support and does not translate it.
     if !held{
      // Releasing clears the finger offset and starts the host's landing
      // ease. Preserve the actual lifted Y, just as for a released book;
      // following that reset would teleport a pot into the covers below.
      // Preview/FLIP offsets describe a proposed layout, never a force on
      // an unselected solid. Only a committed base change may relocate it.
      delta=if !b.held{Vector::new((base[0]-b.base[0]) as f32,if !b.decor_landing{(base[1]-b.base[1]) as f32}else{0.0},0.0)}else{Vector::ZERO};
     }
     if s[2] as u32&8!=0&&!held{delta=Vector::ZERO;}
     if delta.length_squared()>1e-12{
      body.set_translation(body.translation()+delta,true);disturbed.insert(b.base[2] as i64);disturbed.insert(g[2] as i64);changed=true;
     }
     b.goal=target;
     if held{b.decor_landing=true;}else if s[5]<0.01{b.decor_landing=false;}
    }else if b.base!=base{body.set_translation(Vector::new(base[0] as f32,if kind==2{target.y}else{base[1] as f32},target.z),true);changed=true;}
   }else if held{
    if !b.held{
     b.anchor=body.translation()-target;b.grip_angle=body.rotation().to_scaled_axis().z;b.grip_time=0.0;
     b.clearance=(bay[2]+h as f32/2.0+0.001-body.translation().y).max(0.0);
     b.grip=if g[8].is_finite(){g[8].clamp(-0.48,0.48) as f32}else{0.0};b.motion=0.0;b.motion_at=now;b.stroke=0.0;b.direction=0.0;b.release=0.0;b.release_time=0.0;
     b.pointer=[s[3],s[4]];b.fast_until=now;b.fast_grip=false;b.contacting=false;body.wake_up(true);changed=true;
    }
    let dx=(s[3]-b.pointer[0])/p;
    let speed=(dx.hypot((s[4]-b.pointer[1])/p)/frame_dt) as f32;
    // Only a recent, small deliberate stroke starts a fall. Stopping clears
    // earlier travel, and sub-millimetre tremor never chooses a release side.
    if dx.abs()>0.00001{
     let blend=(1.0-(-frame_dt/0.07).exp()) as f32;
     b.motion+=(dx as f32/frame_dt as f32-b.motion)*blend;
     let same_stroke=now-b.motion_at<=RELEASE_WINDOW_MS&&b.stroke.signum()==(dx as f32).signum();
     b.stroke=if same_stroke{b.stroke+dx as f32}else{dx as f32};b.motion_at=now;
     b.direction=if b.stroke.abs()>=RELEASE_TRAVEL{b.stroke.signum()}else{0.0};
    }else{
     b.motion*=(-frame_dt as f32/0.07).exp();
     if now-b.motion_at>RELEASE_WINDOW_MS{b.direction=0.0;b.stroke=0.0;}
    }
    // A normal phone drag must keep its finite physical grip. Only a
    // genuinely rapid sweep temporarily bypasses neighbours.
    if speed>0.8{b.fast_until=now+160.0;b.fast_grip=true;b.contacting=false;b.recovery=None;b.firm_grip=false;}
    // A quick vertical adjustment must not permanently classify the grip
    // as fast. Restore safe soft contacts only after new deliberate input;
    // simply stopping a rapid sweep must never push a resting neighbour.
    if speed>0.0005&&speed<=0.8&&now>=b.fast_until{b.fast_grip=false;}
    b.pointer=[s[3],s[4]];
    let goal=target+b.anchor;
    if (goal-b.goal).length_squared()>1.0e-12{
     body.wake_up(true);
     if b.contacting{disturbed.insert(b.base[2] as i64);disturbed.insert(g[2] as i64);}
    }b.goal=goal;
   }else if b.held{
    body.reset_forces(true);body.reset_torques(true);self.world.colliders[b.collider].set_collision_groups(InteractionGroups::new(Group::GROUP_1,Group::ALL,InteractionTestMode::And));
    // Do not impart an unbounded fling from a delayed pointer frame.
    // Translation follows the placement, not a skating/fling velocity.
    // A bounded torque starts the fall; Rapier still resolves every support.
    body.set_linvel(Vector::new(0.0,body.linvel().y.clamp(-0.12,0.0),0.0),true);
    body.set_angvel(Vector::ZERO,true);
    // Wall time also matters if a stationary grip needed no intervening frame.
    // Translation is still braked, so even an intentional tilt cannot skate.
    b.release=b.input.take().and_then(|input|input.released).unwrap_or_else(||release_direction(b.direction,b.motion,b.motion_at,now));
    b.release_time=0.0;
    // The lifted book travels in front of the boards. Re-enter the
    // selected bay at the actual release pose, correcting only a bottom
    // corner below its board; never jump back to its old nominal centre.
    let a=body.rotation().to_scaled_axis().z;
    let extent=h as f32/2.0*a.cos().abs()+thickness as f32/2.0*a.sin().abs();
    let position=body.translation();let floor=bay[2];
    let extent_x=thickness as f32/2.0*a.cos().abs()+h as f32/2.0*a.sin().abs();
    let left=bay[0]+extent_x;let right=bay[1]-extent_x;
    let x=if left<=right{position.x.clamp(left,right)}else{base[0] as f32};
    if position.y-extent<floor||position.x!=x{body.set_translation(Vector::new(x,position.y.max(floor+extent+0.0001),position.z),true);}
    changed=true;
   }else if !any_held&&(b.base[0]-base[0]).abs()>0.0001{
    body.set_translation(body.translation()+Vector::new((base[0]-b.base[0]) as f32,(base[1]-b.base[1]) as f32,0.0),true);changed=true;
   }
   if b.base!=base || b.held!=held{disturbed.insert(b.base[2] as i64);disturbed.insert(g[2] as i64);}
   b.base=base;b.held=held;b.bay=bay;
  }
  // Imported/legacy coordinates can put a fresh book through an actual pot.
  // Resolve that penetration before warmup: a solver impulse can otherwise
  // wedge the book permanently between the tapered pot and the cabinet post.
  // Saved poses and existing neighbours are never reseeded or repacked.
  for key in fresh_books{if self.books.iter().any(|(other,o)|*other!=key&&o.solid.is_some()&&self.intersects(&self.books[&key],o,false)){self.clear_release(&key);}}
  for key in isolated_releases{self.clear_release(&key);}
  // An accidental overlapping drop must resolve its penetration first,
  // without a powered tilt levering a whole neighbouring row over.
  let blocked:Vec<Vec<u16>>=self.books.iter().filter(|(key,b)|!b.held&&b.release!=0.0&&self.books.iter().any(|(other,o)|other!=*key&&self.intersects(b,o,false))).map(|(key,_)|key.clone()).collect();
  for key in blocked{self.books.get_mut(&key).unwrap().release=0.0;}
  let mut contacts=Vec::new();
  for (key,b) in &self.books{if b.kind==0&&b.held{
   let body=&self.world.bodies[b.handle];
   // Straightening a stationary pickup must not brace/push its neighbours.
   // Deliberate slow movement restores safe contacts before it crosses them.
   let deliberate=b.pointer[0].abs()+b.pointer[1].abs()>0.01;
   let upright=b.grip_time>=0.12&&body.rotation().to_scaled_axis().z.abs()<0.06;
   let eligible=now>=b.fast_until&&(b.contacting||deliberate||upright);
   let clear=b.contacting||self.books.iter().all(|(other,o)|other==key||o.kind==3||!self.intersects(b,o,deliberate&&!b.fast_grip));
   let recovery=if eligible&&!clear&&!b.fast_grip&&upright&&(b.motion.abs()>0.002||b.recovery.is_some()){
    // The nearest free side matters: a book grazing the OUTSIDE of a leg
    // must not retreat through the tripod merely because its finger moved right.
    b.recovery.filter(|point|(*point-body.translation()).length_squared()>0.0005_f32.powi(2)).or_else(||self.clear_position(key,*body.position(),b.bay,false).map(|pose|pose.translation))
   }else{None};
   contacts.push((key.clone(),eligible&&clear,recovery));
  }}
  for (key,contacting,recovery) in contacts{let b=self.books.get_mut(&key).unwrap();if contacting&&b.recovery.is_some(){b.firm_grip=true;}b.contacting=contacting;b.recovery=recovery;
   self.world.colliders[b.collider].set_collision_groups(InteractionGroups::new(Group::GROUP_1,if contacting{Group::ALL & !Group::GROUP_2}else{Group::empty()},InteractionTestMode::And));
  }
  let matching_scene=!self.initialized&&!self.saved.is_empty()&&(self.saved_layout==self.layout||self.saved.values().all(|s|s.portable)&&snapshot::portable_layout_matches(&self.saved_layout,&self.layout,scene.baggebo))&&self.saved.len()==self.books.len()&&self.snapshot_allowed;
  let repaired_rows:BTreeSet<_>=if matching_scene{self.books.values().filter(|b|!b.restored).map(|b|b.base[2] as i64).collect()}else{BTreeSet::new()};
  let restored_scene=matching_scene&&repaired_rows.is_empty();
  if restored_scene{
   for b in self.books.values(){if self.world.bodies[b.handle].is_dynamic(){self.world.bodies[b.handle].sleep();}}
   self.initialized=true;self.carry=0.0;
  }else if !disturbed.is_empty(){self.wake_rows(&disturbed);}
  if matching_scene&&!repaired_rows.is_empty(){
   // A revised solid only invalidates supports on its own board. Keep all
   // other restored contact islands exactly as they were, even during warmup.
   for b in self.books.values_mut(){if !repaired_rows.contains(&(b.base[2] as i64))&&self.world.bodies[b.handle].is_dynamic(){self.world.bodies[b.handle].sleep();b.restored=true;}}
  }
  if changed||was_active||!disturbed.is_empty(){self.snapshot_dirty=true;}
  let has_bodies=self.books.values().any(|b|self.world.bodies[b.handle].is_dynamic());
  let initial=has_bodies&&!self.initialized;if has_bodies{self.initialized=true;}
  // A saved library is already a resting scene at first paint. Solve its
  // supports without hundreds of expensive GPU snapshots. Limit CPU warmup,
  // then animate any remaining work normally for exceptionally large shelves.
  let warming=initial&&!self.books.values().any(|b|b.held);
  let mut elapsed=self.last.map_or(1.0/60.0,|t|((now-t)/1000.0).clamp(0.0,1.0));self.last=Some(now);
  if !was_active&&(changed||!disturbed.is_empty()){self.carry=0.0;elapsed=elapsed.min(1.0/60.0);}
  self.carry=(self.carry+elapsed).min(1.0);
  let active_count=self.books.values().filter(|b|self.world.bodies[b.handle].is_dynamic()&&!self.world.bodies[b.handle].is_sleeping()).count().max(1);
  let budget=(1200/active_count).clamp(6,120);
  let steps=if reduced||warming{1200}else{((self.carry/DT as f64).floor() as usize).min(budget)};
  if reduced||warming{self.carry=0.0;}else{self.carry-=steps as f64*DT as f64;}
  let warm_start=if warming{js_sys::Date::now()}else{0.0};
  let starts:BTreeMap<Vec<u16>,Vector>=self.books.iter().filter(|(_,b)|b.held).map(|(k,b)|(k.clone(),self.world.bodies[b.handle].translation())).collect();
  let before:BTreeMap<Vec<u16>,(Vector,Rotation)>=self.books.iter().map(|(k,b)|(k.clone(),(self.world.bodies[b.handle].translation(),*self.world.bodies[b.handle].rotation()))).collect();
  for n in 0..steps{
   let active=self.books.values().any(|b|self.world.bodies[b.handle].is_dynamic()&&!self.world.bodies[b.handle].is_sleeping());
   if !active{break;}
   for (key,b) in &mut self.books{if b.kind!=0{continue;}if b.held{
    b.grip_time+=DT;
    let body=&mut self.world.bodies[b.handle];
    // A finite spring grip, not an infinitely strong teleporting collider.
    // The grip yields to crowded books; contacts remain dynamic.
    let pickup=crate::scene_view::ease((b.grip_time as f64/0.28).min(1.0)) as f32;
    let mut goal=b.recovery.unwrap_or(b.goal);if b.recovery.is_none(){goal.y+=b.clearance*pickup;}
    let sway=(-b.grip*b.motion*0.8).clamp(-0.14,0.14)*pickup;
    let desired=b.grip_angle*(1.0-pickup)+sway;
    // Move the centre around the grasped leaf height, rather than rotating
    // about an unrelated centre. Top and bottom grips have opposite leverage.
    let grip=b.grip*b.size[1] as f32;
    let angle=body.rotation().to_scaled_axis().z;
    goal.x+=grip*angle.sin();goal.y+=grip*(1.0-angle.cos());
    let target=starts[key].lerp(goal,(n+1) as f32/steps as f32);
    let mut acceleration=((target-body.translation())*1225.0-body.linvel()*70.0).clamp_length_max(if b.contacting{12.0}else{60.0})+Vector::new(0.0,5.5,0.0);
    acceleration.z=0.0;
    body.reset_forces(false);body.add_force(acceleration*body.mass(),false);
    let error=desired-body.rotation().to_scaled_axis().z;
    let inertia=body.mass()*(b.size[0]*b.size[0]+b.size[1]*b.size[1]) as f32/12.0;
    // Recovered side contacts need the upright grip to resist the moment at
    // a fallen cover's edge. Otherwise the selected book bends over the cover
    // while its finite horizontal spring never reaches the neighbour.
    let (stiffness,damping,limit)=if b.firm_grip{(8000.0,180.0,600.0)}else{(1600.0,80.0,80.0)};
    body.reset_torques(false);body.add_torque(Vector::new(0.0,0.0,(stiffness*error-damping*body.angvel().z).clamp(-limit,limit)*inertia),false);
   }else if b.release!=0.0{
    let supported_by_book=self.world.contact_pairs_with(b.collider).any(|pair|{
     let other=if pair.collider1==b.collider{pair.collider2}else{pair.collider1};
     pair.has_any_active_contact()&&self.world.colliders[other].collision_groups().memberships.contains(Group::GROUP_1)
    });
    let body=&mut self.world.bodies[b.handle];
    let angle=body.rotation().to_scaled_axis().z;
    let tipping=(b.size[0]/b.size[1]).atan() as f32+0.045;
    b.release_time+=DT;
    if supported_by_book||angle*b.release>=tipping||b.release_time>0.9{
     b.release=0.0;body.reset_torques(false);
    }else{
     let error=b.release*(tipping+0.07).min(0.8)-angle;
     let inertia=body.mass()*(b.size[0]*b.size[0]+b.size[1]*b.size[1]) as f32/12.0;
     body.reset_torques(false);
     body.add_torque(Vector::new(0.0,0.0,(240.0*error-18.0*body.angvel().z).clamp(-60.0,60.0)*inertia*crate::scene_view::ease((b.release_time as f64/0.16).min(1.0)) as f32),true);
    }
   }}
   let sound_step=self.sounds_enabled&&!warming;
   if sound_step{self.prepare_sound_contacts();}
   let external:std::collections::HashSet<_>=self.books.values().filter(|b|!b.restored&&(b.held||self.world.bodies[b.handle].is_dynamic()&&!self.world.bodies[b.handle].is_sleeping())).map(|b|b.collider).collect();
   self.world.step_with_events(&GentleSideContacts,&());
   if sound_step{self.record_sound_contacts(now);}
   // A saved fixed support never wakes. Including it here would reset the
   // quiet clocks of every touching book on every substep forever.
   let contact_rows=self.books.values().filter(|b|b.restored&&self.world.bodies[b.handle].is_dynamic()&&self.world.contact_pairs_with(b.collider).any(|pair|pair.has_any_active_contact()&&external.contains(&if pair.collider1==b.collider{pair.collider2}else{pair.collider1}))).map(|b|b.base[2] as i64).collect();
   self.wake_rows(&contact_rows);
   // Quiet kinetic energy and exact cabinet bounds, independent of a thin
   // book's mass or the contact solver's tolerance. No bounce or fling.
   for (key,b) in self.books.iter_mut(){if self.world.bodies[b.handle].is_dynamic(){
    // Rebuilding cold contacts may wake an unchanged saved stack. Preserve its
    // validated pose until an explicit change or real external contact reaches
    // its board; both clear restored above, so gentle pushes still propagate.
    if b.restored{
     let body=&mut self.world.bodies[b.handle];let (position,rotation)=before[key];
     if body.translation()!=position{body.set_translation(position,false);}if *body.rotation()!=rotation{body.set_rotation(rotation,false);}if !body.is_sleeping(){body.sleep();}continue;
    }
    // Compound contacts may be clustered: read the manifolds used by the
    // solver, otherwise a supported book is repeatedly woken as airborne.
    let upward_contact=self.world.contact_pairs_with(b.collider).any(|pair|pair.solver_manifolds().iter().any(|m|!m.data.solver_contacts.is_empty()&&if pair.collider1==b.collider{-m.data.normal.y}else{m.data.normal.y}>0.25));
    let body=&mut self.world.bodies[b.handle];
    if !b.held{
     body.set_linvel(body.linvel().clamp_length_max(0.4),false);
     body.set_angvel(body.angvel().clamp_length_max(1.8),false);
     if b.kind==0{constrain(body,b.size,b.bay);}else if let Some(shape)=&b.solid{
      let foot=shape.compute_aabb(&body.position()).mins.y;
      if foot<b.bay[2]{body.set_translation(body.translation()+Vector::new(0.0,b.bay[2]-foot,0.0),false);}
     }
     let angle=body.rotation().to_scaled_axis().z;
     let foot=if let Some(shape)=&b.solid{shape.compute_aabb(&body.position()).mins.y}else{body.translation().y-b.size[1] as f32/2.0*angle.cos().abs()-b.size[0] as f32/2.0*angle.sin().abs()};
     let supported=upward_contact||foot<=b.bay[2]+0.0015;
     if !supported{body.wake_up(true);}
     if supported&&b.release==0.0&&!body.is_sleeping(){
      let position=body.translation();let angle=body.rotation().to_scaled_axis().z;
      let quiet=b.quiet.get_or_insert((position,angle,0.0));
      // Contact islands wedged against a post/pot can retain solver noise.
      // Sleep only after a supported pose stays within 0.25 mm / 0.11 deg
      // for 0.75 simulation seconds; drift/falling/pushing resets the window.
      // The depth joint can retain a tiny solver residual under a crowded
      // pot. Only x/y and roll are presented: keep the same strict visible
      // settling thresholds instead of repainting an invisible Z correction.
      let delta=position-quiet.0;
      if delta.x*delta.x+delta.y*delta.y>0.00025_f32.powi(2)||(angle-quiet.1).abs()>0.002{
       *quiet=(position,angle,0.0);
      }else{quiet.2+=DT;if quiet.2>=0.75{body.sleep();b.quiet=None;}}
     }else{b.quiet=None;}
    }else{b.quiet=None;}
   }}
   if warming&&n%16==15&&js_sys::Date::now()-warm_start>80.0{break;}
  }
  if self.sounds_enabled&&!warming{self.finish_landing_sounds(now);}
  for (i,key) in names.iter().enumerate(){let Some(b)=self.books.get(key)else{continue;};if b.kind!=0&&b.solid.is_none(){continue;}
   let body=&self.world.bodies[b.handle];let p=b.base[3];let position=body.translation();
   let a=body.rotation().to_scaled_axis().z as f64;
   out[i*4..i*4+4].copy_from_slice(&[a,position.x as f64*p-states[i*37+23],position.y as f64*p+states[i*37+24]+if b.kind==2{states[i*37+26]/2.0}else{0.0},if body.is_dynamic()&&!body.is_sleeping()||(!warming&&before[key]!=(position,*body.rotation())){1.0}else{0.0}]);
  }
 }
}
