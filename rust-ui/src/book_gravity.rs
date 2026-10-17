//! Persistent cuboid rigid bodies. Rapier solves contacts, friction and support
//! between every book, rather than choosing a target angle. The shelf constrains
//! books to their depth plane: they can translate and fall sideways, not leave
//! the cabinet towards the camera. All dimensions in the solver are metres.
use std::collections::{BTreeMap,BTreeSet};
use wasm_bindgen::{prelude::*,JsCast};
use js_sys::{Array,JsString};
use rapier3d::prelude::*;
use crate::scene_view::RustScene;
const DT:f32=1.0/120.0;
// Scene input bits: dragging or lifted; a simple press (8) leaves the library asleep.
const HELD:u32=2|4;
struct Book{handle:RigidBodyHandle,collider:ColliderHandle,base:[f64;4],size:[f64;3],held:bool,anchor:Vector,goal:Vector,kind:u32,grip_angle:f32,grip_time:f32,pointer:[f64;2],fast_until:f64,contacting:bool,clearance:f32,bay:[f32;4]}
fn overlapping(a:&RigidBody,sa:[f64;3],b:&RigidBody,sb:[f64;3])->bool{
 let pa=a.translation();let pb=b.translation();
 if (pa.z-pb.z).abs()>(sa[2]+sb[2]) as f32/2.0{return false;}
 let aa=a.rotation().to_scaled_axis().z;let ab=b.rotation().to_scaled_axis().z;
 for theta in [aa,aa+std::f32::consts::FRAC_PI_2,ab,ab+std::f32::consts::FRAC_PI_2]{
  let axis=Vector::new(theta.cos(),theta.sin(),0.0);
  let radius=|size:[f64;3],angle:f32|size[0] as f32/2.0*(angle-theta).cos().abs()+size[1] as f32/2.0*(angle-theta).sin().abs();
  if (pa-pb).dot(axis).abs()>=radius(sa,aa)+radius(sb,ab)-0.0002{return false;}
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
pub struct RustBookGravity{world:PhysicsWorld,books:BTreeMap<Vec<u16>,Book>,walls:Vec<RigidBodyHandle>,layout:Vec<f64>,last:Option<f64>,carry:f64,initialized:bool}
impl RustBookGravity{
 fn wake(&mut self){for (_,body) in self.world.bodies.iter_mut(){if body.is_dynamic(){body.wake_up(true);}}}
 fn cabinet(&mut self,g:&[f64],metal:bool){
  let side=if metal{crate::cabinet::BAGGEBO.post_size/1000.0}else{12.0/0.65/1000.0};
  let board=if metal{crate::cabinet::BAGGEBO.shelf_rim_height/1000.0}else{15.0/0.65/1000.0};
  let layout:Vec<f64>=g.chunks_exact(9).flat_map(|r|[r[2],r[3],r[4],r[5],r[6],r[7]]).collect();
  // Ignore book membership and order when deciding whether cabinet colliders changed.
  let mut rows:BTreeMap<i64,[f64;6]>=BTreeMap::new();
  for r in layout.chunks_exact(6){rows.entry(r[0] as i64).or_insert(r.try_into().unwrap());}
  let mut signature:Vec<f64>=rows.values().flatten().copied().collect();signature.extend([side,board]);
  if signature==self.layout{return;}
  for h in self.walls.drain(..){self.world.remove_body(h);}
  for r in rows.values(){
   let p=r[1];if !r.iter().all(|v|v.is_finite())||p<=0.0{continue;}
   // The physical contact sits 0.6 mm inside the hard guard. Solver tolerance
   // then never fights the exact bounds or continually wakes a resting island.
   let (left,right,bottom,top)=(r[2]/p,r[3]/p,-r[4]/p+0.0010,-r[5]/p-0.0010);
   if right<=left||top<=bottom{continue;}
   for (x,y,hx,hy) in [((left+right)/2.0,bottom-board/2.0,(right-left)/2.0,board/2.0),
    ((left+right)/2.0,top+board/2.0,(right-left)/2.0,board/2.0),
    (left+side/2.0,(bottom+top)/2.0,side/2.0+0.0010,(top-bottom)/2.0),
    (right-side/2.0,(bottom+top)/2.0,side/2.0+0.0010,(top-bottom)/2.0)]{
    let (h,_)=self.world.insert(RigidBodyBuilder::fixed().translation(Vector::new(x as f32,y as f32,-0.15)),
     ColliderBuilder::cuboid(hx as f32,hy as f32,0.6).friction(0.65).collision_groups(InteractionGroups::new(Group::GROUP_2,Group::ALL,InteractionTestMode::And)));self.walls.push(h);
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
  Self{world,books:BTreeMap::new(),walls:Vec::new(),layout:Vec::new(),last:None,carry:0.0,initialized:false}
 }
 /// One batch across the WASM boundary. States use RustScene.stepEntry's 37
 /// numbers. Geometry: thickness, kind (book/plant/lamp/puck), row, pixels/metre,
 /// row left/right/bottom/ceiling, reserved. Output: angle, world dx/dy, active.
 pub fn step(&mut self,keys:&Array,states:&mut[f64],geometry:&[f64],scene:&RustScene,now:f64,reduced:bool,out:&mut[f64]){
  let count=keys.length() as usize;
  if states.len()!=count*37||geometry.len()!=count*9||out.len()!=count*4{return;}
  out.fill(0.0);
  for state in states.chunks_exact_mut(37){scene.step_entry(state);}
  let was_active=self.books.values().any(|b|b.kind==0&&!self.world.bodies[b.handle].is_sleeping());
  self.cabinet(geometry,scene.baggebo);
  let frame_dt=self.last.map_or(1.0/60.0,|t|((now-t)/1000.0).clamp(1.0/240.0,0.1));
  let wall=if scene.baggebo{crate::cabinet::BAGGEBO.post_size/1000.0}else{12.0/0.65/1000.0};
  let names:Vec<Vec<u16>>=keys.iter().map(|k|if k.is_string(){k.unchecked_ref::<JsString>().iter().collect()}else{Vec::new()}).collect();
  let live:BTreeSet<&Vec<u16>>=names.iter().collect();
  let removed:Vec<Vec<u16>>=self.books.keys().filter(|k|!live.contains(k)).cloned().collect();
  let membership_changed=!removed.is_empty();
  if membership_changed{for key in removed{let b=self.books.remove(&key).unwrap();self.world.remove_body(b.handle);}self.wake();}
  let any_held=states.chunks_exact(37).any(|s|s[2] as u32&HELD!=0)||self.books.values().any(|b|b.held);
  let mut changed=membership_changed;let mut disturbed=BTreeSet::new();
  for (i,key) in names.iter().enumerate(){
   let s=&states[i*37..i*37+37];let g=&geometry[i*9..i*9+9];
   let p=g[3];let kind=g[1] as u32;let flags=s[2] as u32;let held=flags&HELD!=0;let away=flags&1!=0;
   if !g[..8].iter().all(|v|v.is_finite())||p<=0.0||!s[23..27].iter().all(|v|v.is_finite())||!g[0].is_finite()||g[0]<=0.0||s[26]<=0.0{if let Some(b)=self.books.remove(key){self.world.remove_body(b.handle);changed=true;}continue;}
   if kind==3||away{if let Some(b)=self.books.remove(key){self.world.remove_body(b.handle);changed=true;}continue;}
   let base=[s[23]/p,-s[24]/p,g[2],p];
   let h=s[26]/p;let thickness=g[0]/p;let depth=if kind==0||!s[27].is_finite()||s[27]<=0.0{s[25]/p}else{s[27]/p};
   let size=[thickness,h,depth.max(0.005)];
   let bay=[(g[4]/p+wall+0.0004) as f32,(g[5]/p-wall-0.0004) as f32,(-g[6]/p+0.0004) as f32,(-g[7]/p-0.0004) as f32];
   // stepEntry's x is relative to the complete cabinet centre; convert back
   // using its resting x (not a camera projection) without exposing camera math.
   let target=Vector::new((base[0]+(s[29]-(s[23]-scene.width/2.0))/p) as f32,(s[30]/p) as f32,(s[31]/p) as f32);
   let replace=self.books.get(key).is_some_and(|b|b.kind!=kind||b.size.iter().zip(size).any(|(a,b)|(a-b).abs()>0.0001));
   if replace{let b=self.books.remove(key).unwrap();self.world.remove_body(b.handle);changed=true;}
   if !self.books.contains_key(key){
    let mut angle=0.0_f64;
    if kind==0&&!held{
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
    let y=if kind==2{target.y as f64}else{base[1]+h/2.0*(angle.cos()-1.0)+thickness/2.0*angle.sin().abs()};
    let body=if kind==0{RigidBodyBuilder::dynamic()}else{RigidBodyBuilder::fixed()}
     .translation(Vector::new(base[0] as f32,y as f32,(s[31]/p) as f32))
     .rotation(Vector::new(0.0,0.0,angle as f32))
     .locked_axes(LockedAxes::TRANSLATION_LOCKED_Z|LockedAxes::ROTATION_LOCKED_X|LockedAxes::ROTATION_LOCKED_Y)
     .linear_damping(2.2).angular_damping(3.8).ccd_enabled(true);
    let (handle,collider)=self.world.insert(body,ColliderBuilder::cuboid((thickness/2.0) as f32,(h/2.0) as f32,(size[2]/2.0) as f32).density(650.0).friction(0.65).restitution(0.0).collision_groups(InteractionGroups::new(Group::GROUP_1,Group::ALL,InteractionTestMode::And)));
    let b=&mut self.world.bodies[handle];if kind==0&&!held{constrain(b,size,bay);}b.activation_mut().time_until_sleep=0.4;b.activation_mut().angular_threshold=0.003;b.activation_mut().normalized_linear_threshold=0.005;
    self.books.insert(key.clone(),Book{handle,collider,base,size,held:false,anchor:Vector::ZERO,goal:target,kind,grip_angle:angle as f32,grip_time:0.0,pointer:[s[3],s[4]],fast_until:0.0,contacting:false,clearance:0.0,bay});changed=true;
   }
   let b=self.books.get_mut(key).unwrap();let body=&mut self.world.bodies[b.handle];
   if kind!=0{
    if b.base!=base{body.set_translation(Vector::new(base[0] as f32,if kind==2{target.y}else{base[1] as f32},target.z),true);changed=true;}
   }else if held{
    if !b.held{
     b.anchor=body.translation()-target;b.grip_angle=body.rotation().to_scaled_axis().z;b.grip_time=0.0;
     b.clearance=(bay[2]+h as f32/2.0+0.001-body.translation().y).max(0.0);
     b.pointer=[s[3],s[4]];b.fast_until=now+120.0;b.contacting=false;body.wake_up(true);changed=true;
    }
    let speed=((s[3]-b.pointer[0]).hypot(s[4]-b.pointer[1])/p/frame_dt) as f32;
    if speed>0.35{b.fast_until=now+160.0;b.contacting=false;}
    b.pointer=[s[3],s[4]];
    let goal=target+b.anchor;
    if (goal-b.goal).length_squared()>1.0e-12{
     body.wake_up(true);
     if b.contacting{disturbed.insert(b.base[2] as i64);disturbed.insert(g[2] as i64);}
    }b.goal=goal;
   }else if b.held{
    body.reset_forces(true);body.reset_torques(true);self.world.colliders[b.collider].set_collision_groups(InteractionGroups::new(Group::GROUP_1,Group::ALL,InteractionTestMode::And));
    // Do not impart an unbounded fling from a delayed pointer frame.
    let v=body.linvel().clamp_length_max(0.12);body.set_linvel(v,true);
    body.set_angvel(body.angvel().clamp_length_max(0.8),true);
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
   b.base=base;b.held=held;b.bay=bay;
  }
  let mut contacts=Vec::new();
  for (key,b) in &self.books{if b.held{
   let body=&self.world.bodies[b.handle];
   let eligible=now>=b.fast_until&&b.grip_time>=0.12&&body.rotation().to_scaled_axis().z.abs()<0.06;
   let clear=b.contacting||self.books.iter().all(|(other,o)|other==key||o.kind==3||!overlapping(body,b.size,&self.world.bodies[o.handle],o.size));
   contacts.push((key.clone(),eligible&&clear));
  }}
  for (key,contacting) in contacts{let b=self.books.get_mut(&key).unwrap();b.contacting=contacting;
   self.world.colliders[b.collider].set_collision_groups(InteractionGroups::new(Group::GROUP_1,if contacting{Group::ALL & !Group::GROUP_2}else{Group::empty()},InteractionTestMode::And));
  }
  if changed{self.wake();}else if !disturbed.is_empty(){for b in self.books.values(){if disturbed.contains(&(b.base[2] as i64)){self.world.bodies[b.handle].wake_up(true);}}}
  let has_books=self.books.values().any(|b|b.kind==0);
  let initial=has_books&&!self.initialized;if has_books{self.initialized=true;}
  // A saved library is already a resting scene at first paint. Solve its
  // supports without hundreds of expensive GPU snapshots. Limit CPU warmup,
  // then animate any remaining work normally for exceptionally large shelves.
  let warming=initial&&!self.books.values().any(|b|b.held);
  let mut elapsed=self.last.map_or(1.0/60.0,|t|((now-t)/1000.0).clamp(0.0,1.0));self.last=Some(now);
  if !was_active&&(changed||!disturbed.is_empty()){self.carry=0.0;elapsed=elapsed.min(1.0/60.0);}
  self.carry=(self.carry+elapsed).min(1.0);
  let active_count=self.books.values().filter(|b|b.kind==0&&!self.world.bodies[b.handle].is_sleeping()).count().max(1);
  let budget=(1200/active_count).clamp(6,120);
  let steps=if reduced||warming{1200}else{((self.carry/DT as f64).floor() as usize).min(budget)};
  if reduced||warming{self.carry=0.0;}else{self.carry-=steps as f64*DT as f64;}
  let warm_start=if warming{js_sys::Date::now()}else{0.0};
  let starts:BTreeMap<Vec<u16>,Vector>=self.books.iter().filter(|(_,b)|b.held).map(|(k,b)|(k.clone(),self.world.bodies[b.handle].translation())).collect();
  let before:BTreeMap<Vec<u16>,(Vector,Rotation)>=self.books.iter().map(|(k,b)|(k.clone(),(self.world.bodies[b.handle].translation(),*self.world.bodies[b.handle].rotation()))).collect();
  for n in 0..steps{
   let active=self.books.values().any(|b|b.kind==0&&!self.world.bodies[b.handle].is_sleeping());
   if !active{break;}
   for (key,b) in &mut self.books{if b.held{
    b.grip_time+=DT;
    let body=&mut self.world.bodies[b.handle];
    // A finite spring grip, not an infinitely strong teleporting collider.
    // The grip yields to crowded books; contacts remain dynamic.
    let pickup=crate::scene_view::ease((b.grip_time as f64/0.28).min(1.0)) as f32;
    let mut goal=b.goal;goal.y+=b.clearance*pickup;
    let target=starts[key].lerp(goal,(n+1) as f32/steps as f32);
    let acceleration=((target-body.translation())*1225.0-body.linvel()*70.0).clamp_length_max(if b.contacting{12.0}else{60.0})+Vector::new(0.0,5.5,0.0);
    body.reset_forces(false);body.add_force(acceleration*body.mass(),false);
    let error=b.grip_angle*(1.0-pickup)-body.rotation().to_scaled_axis().z;
    let inertia=body.mass()*(b.size[0]*b.size[0]+b.size[1]*b.size[1]) as f32/12.0;
    body.reset_torques(false);body.add_torque(Vector::new(0.0,0.0,(1600.0*error-80.0*body.angvel().z).clamp(-80.0,80.0)*inertia),false);
   }}
   self.world.step();
   // Quiet kinetic energy and exact cabinet bounds, independent of a thin
   // book's mass or the contact solver's tolerance. No bounce or fling.
   for b in self.books.values(){if b.kind==0{
    let body=&mut self.world.bodies[b.handle];
    if !b.held{
     body.set_linvel(body.linvel().clamp_length_max(0.4),false);
     body.set_angvel(body.angvel().clamp_length_max(1.8),false);
     constrain(body,b.size,b.bay);
    }
   }}
   if warming&&n%16==15&&js_sys::Date::now()-warm_start>80.0{break;}
  }
  for (i,key) in names.iter().enumerate(){let Some(b)=self.books.get(key)else{continue;};if b.kind!=0{continue;}
   let body=&self.world.bodies[b.handle];let p=b.base[3];let position=body.translation();
   let a=body.rotation().to_scaled_axis().z as f64;
   out[i*4..i*4+4].copy_from_slice(&[a,position.x as f64*p-states[i*37+23],position.y as f64*p+states[i*37+24],if !body.is_sleeping()||(!warming&&before[key]!=(position,*body.rotation())){1.0}else{0.0}]);
  }
 }
}
