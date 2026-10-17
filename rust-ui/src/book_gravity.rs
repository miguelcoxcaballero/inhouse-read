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
struct Book{name:JsString,restored:bool,handle:RigidBodyHandle,collider:ColliderHandle,solid:Option<SharedShape>,decor_landing:bool,base:[f64;4],size:[f64;3],held:bool,anchor:Vector,goal:Vector,kind:u32,grip_angle:f32,grip_time:f32,pointer:[f64;2],fast_until:f64,fast_grip:bool,contacting:bool,clearance:f32,bay:[f32;4],grip:f32,motion:f32,direction:f32,release:f32,release_time:f32,quiet:Option<(Vector,f32,f32)>}
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
pub struct RustBookGravity{world:PhysicsWorld,plane:RigidBodyHandle,books:BTreeMap<Vec<u16>,Book>,walls:Vec<RigidBodyHandle>,layout:Vec<f64>,last:Option<f64>,carry:f64,initialized:bool,saved:BTreeMap<Vec<u16>,RestPose>,saved_layout:Vec<f64>,snapshot_dirty:bool,snapshot_allowed:bool,solids:BTreeMap<Vec<u16>,Solid>,shape_cache:Vec<Solid>}
impl RustBookGravity{
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
 fn wake(&mut self){for (_,body) in self.world.bodies.iter_mut(){if body.is_dynamic(){body.wake_up(true);}}for b in self.books.values_mut(){b.quiet=None;}}
 fn wake_rows(&mut self,rows:&BTreeSet<i64>){
  // Fixed shelves separate contact islands. Picking one book must not wake
  // hundreds of settled bodies on unrelated boards/cabinets.
  for b in self.books.values_mut(){if self.world.bodies[b.handle].is_dynamic()&&rows.contains(&(b.base[2] as i64)){
   self.world.bodies[b.handle].wake_up(true);b.quiet=None;
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
  for h in self.walls.drain(..){self.world.remove_body(h);}
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
   for (index,(x,y,hx,hy)) in [((left+right)/2.0,bottom-floor_height/2.0,(right-left)/2.0,floor_height/2.0),
    ((left+right)/2.0,top+board/2.0,(right-left)/2.0,board/2.0),
    (left+side/2.0,(bottom+top)/2.0,side/2.0+0.0010,(top-bottom)/2.0),
    (right-side/2.0,(bottom+top)/2.0,side/2.0+0.0010,(top-bottom)/2.0)].into_iter().enumerate(){
    if index==1&&ceiling_owned{continue;}
    let (h,_)=self.world.insert(RigidBodyBuilder::fixed().translation(Vector::new(x as f32,y as f32,-0.15)),
     ColliderBuilder::cuboid(hx as f32,hy as f32,0.6).friction(if index==0{1.2}else{0.65}).friction_combine_rule(if index==0{CoefficientCombineRule::Max}else{CoefficientCombineRule::Average}).collision_groups(InteractionGroups::new(Group::GROUP_2,Group::ALL,InteractionTestMode::And)));self.walls.push(h);
   }
  }
  self.layout=signature;self.wake();
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
  Self{world,plane,books:BTreeMap::new(),walls:Vec::new(),layout:Vec::new(),last:None,carry:0.0,initialized:false,saved:BTreeMap::new(),saved_layout:Vec::new(),snapshot_dirty:false,snapshot_allowed:true,solids:BTreeMap::new(),shape_cache:Vec::new()}
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
 pub fn pause(&mut self){self.last=None;self.carry=0.0;}
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
  self.snapshot_allowed=!states.chunks_exact(37).any(|s|s[2] as u32&(1|HELD)!=0);
  let was_active=self.books.values().any(|b|self.world.bodies[b.handle].is_dynamic()&&!self.world.bodies[b.handle].is_sleeping());
  self.cabinet(geometry,scene.baggebo);
  let frame_dt=self.last.map_or(1.0/60.0,|t|((now-t)/1000.0).clamp(1.0/240.0,0.1));
  let wall=if scene.baggebo{crate::cabinet::BAGGEBO.post_size/1000.0}else{12.0/0.65/1000.0};
  let names:Vec<Vec<u16>>=keys.iter().map(|k|if k.is_string(){k.unchecked_ref::<JsString>().iter().collect()}else{Vec::new()}).collect();
  let live:BTreeSet<&Vec<u16>>=names.iter().collect();
  let removed:Vec<Vec<u16>>=self.books.keys().filter(|k|!live.contains(k)).cloned().collect();
  self.solids.retain(|key,_|live.contains(key));
  let membership_changed=!removed.is_empty();let mut disturbed=BTreeSet::new();
  if membership_changed{for key in removed{let b=self.books.remove(&key).unwrap();disturbed.insert(b.base[2] as i64);self.world.remove_body(b.handle);}}
  let any_held=states.chunks_exact(37).any(|s|s[2] as u32&HELD!=0)||self.books.values().any(|b|b.held);
  let mut changed=membership_changed;
  for (i,key) in names.iter().enumerate(){
   let s=&states[i*37..i*37+37];let g=&geometry[i*9..i*9+9];
   let p=g[3];let kind=g[1] as u32;let flags=s[2] as u32;let held=flags&HELD!=0;let away=flags&1!=0;
   if !g[..8].iter().all(|v|v.is_finite())||p<=0.0||!s[23..27].iter().all(|v|v.is_finite())||!g[0].is_finite()||g[0]<=0.0||s[26]<=0.0{if let Some(b)=self.books.remove(key){disturbed.insert(b.base[2] as i64);self.world.remove_body(b.handle);changed=true;}continue;}
   if kind==3||away{if let Some(b)=self.books.remove(key){disturbed.insert(b.base[2] as i64);self.world.remove_body(b.handle);changed=true;}continue;}
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
    let x=remembered.as_ref().map_or_else(||base[0]+angle.signum()*thickness/2.0*(angle.cos()-1.0)-h/2.0*angle.sin(),|s|s.x as f64);
    let y=remembered.as_ref().map_or_else(||if kind==2{target.y as f64}else{base[1]+h/2.0*(angle.cos()-1.0)+thickness/2.0*angle.sin().abs()},|s|s.y as f64);
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
    self.books.insert(key.clone(),Book{name,restored,handle,collider,solid,decor_landing:false,base,size,held:false,anchor:Vector::ZERO,goal:target,kind,grip_angle:angle as f32,grip_time:0.0,pointer:[s[3],s[4]],fast_until:0.0,fast_grip:false,contacting:false,clearance:0.0,bay,grip:0.0,motion:0.0,direction:0.0,release:0.0,release_time:0.0,quiet:None});changed=true;
   }
   let b=self.books.get_mut(key).unwrap();let body=&mut self.world.bodies[b.handle];
   if kind!=0{
    if b.solid.is_some(){
     // The chosen X/Z and upright orientation stay fixed, but a pot may
     // rest on a fallen cover. A fixed pot at board level trapped that
     // cover against the floor and kept its whole contact island awake.
     let active_type=if held{RigidBodyType::Fixed}else{RigidBodyType::Dynamic};
     if body.body_type()!=active_type{body.set_body_type(active_type,true);changed=true;}
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
      delta.y=if !b.held&&!b.decor_landing&&b.base!=base{(base[1]-b.base[1]) as f32}else{0.0};
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
     b.grip=if g[8].is_finite(){g[8].clamp(-0.48,0.48) as f32}else{0.0};b.motion=0.0;b.direction=0.0;b.release=0.0;b.release_time=0.0;
     b.pointer=[s[3],s[4]];b.fast_until=now;b.fast_grip=false;b.contacting=false;body.wake_up(true);changed=true;
    }
    let dx=(s[3]-b.pointer[0])/p;
    let speed=(dx.hypot((s[4]-b.pointer[1])/p)/frame_dt) as f32;
    // Recent horizontal travel dominates; a paused finger retains its last
    // direction, while a deliberate reversal replaces the old gesture.
    if dx.abs()>0.00001{
     let blend=(1.0-(-frame_dt/0.07).exp()) as f32;
     b.motion+=(dx as f32/frame_dt as f32-b.motion)*blend;
     if b.motion.abs()>0.0005{b.direction=b.motion.signum();}
    }else{b.motion*=(-frame_dt as f32/0.07).exp();}
    // A normal phone drag must keep its finite physical grip. Only a
    // genuinely rapid sweep temporarily bypasses neighbours.
    if speed>0.8{b.fast_until=now+160.0;b.fast_grip=true;b.contacting=false;}
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
    b.release=-b.direction;
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
   contacts.push((key.clone(),eligible&&clear));
  }}
  for (key,contacting) in contacts{let b=self.books.get_mut(&key).unwrap();b.contacting=contacting;
   self.world.colliders[b.collider].set_collision_groups(InteractionGroups::new(Group::GROUP_1,if contacting{Group::ALL & !Group::GROUP_2}else{Group::empty()},InteractionTestMode::And));
  }
  let restored_scene=!self.initialized&&!self.saved.is_empty()&&self.saved_layout==self.layout&&self.saved.len()==self.books.len()&&self.snapshot_allowed&&self.books.values().all(|b|b.restored&&!b.held);
  if restored_scene{
   for b in self.books.values(){if self.world.bodies[b.handle].is_dynamic(){self.world.bodies[b.handle].sleep();}}
   self.initialized=true;self.carry=0.0;
  }else if !disturbed.is_empty(){self.wake_rows(&disturbed);}
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
    let mut goal=b.goal;goal.y+=b.clearance*pickup;
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
    body.reset_torques(false);body.add_torque(Vector::new(0.0,0.0,(1600.0*error-80.0*body.angvel().z).clamp(-80.0,80.0)*inertia),false);
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
   self.world.step_with_events(&GentleSideContacts,&());
   // Quiet kinetic energy and exact cabinet bounds, independent of a thin
   // book's mass or the contact solver's tolerance. No bounce or fling.
   for b in self.books.values_mut(){if self.world.bodies[b.handle].is_dynamic(){
    let upward_contact=self.world.contact_pairs_with(b.collider).any(|pair|pair.manifolds().iter().any(|m|!m.data.solver_contacts.is_empty()&&if pair.collider1==b.collider{-m.data.normal.y}else{m.data.normal.y}>0.25));
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
  for (i,key) in names.iter().enumerate(){let Some(b)=self.books.get(key)else{continue;};if b.kind!=0&&b.solid.is_none(){continue;}
   let body=&self.world.bodies[b.handle];let p=b.base[3];let position=body.translation();
   let a=body.rotation().to_scaled_axis().z as f64;
   out[i*4..i*4+4].copy_from_slice(&[a,position.x as f64*p-states[i*37+23],position.y as f64*p+states[i*37+24]+if b.kind==2{states[i*37+26]/2.0}else{0.0},if body.is_dynamic()&&!body.is_sleeping()||(!warming&&before[key]!=(position,*body.rotation())){1.0}else{0.0}]);
  }
 }
}
