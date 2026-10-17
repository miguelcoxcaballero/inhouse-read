//! Read actual closing velocity at contact points, including new contacts in
//! an existing pair (the second cover hitting a board while its toe pivots).
//! Never analyse audio while locked/muted, warming an old shelf or hidden.
use super::*;
#[derive(Clone,Copy)]
pub(super) struct Velocity{centre:Vector,linear:Vector,angular:Vector}
impl Velocity{fn at(&self,point:Vector)->Vector{self.linear+self.angular.cross(point-self.centre)}}
impl RustBookGravity{
 pub(super) fn prepare_sound_contacts(&mut self){
  self.audio_velocities.clear();
  for b in self.books.values(){if self.world.bodies[b.handle].is_dynamic(){
   let body=&self.world.bodies[b.handle];if !body.is_sleeping(){self.audio_velocities.insert(b.collider,Velocity{centre:body.translation(),linear:body.linvel(),angular:body.angvel()});}
  }}
 }
 pub(super) fn record_sound_contacts(&mut self,now:f64){
  let mut hits=Vec::new();
  let velocity=|collider,point|self.audio_velocities.get(&collider).map_or(Vector::ZERO,|v|v.at(point));
  for b in self.books.values(){
   if b.kind!=0||now<b.sound_until||!self.audio_velocities.contains_key(&b.collider){continue;}
   for pair in self.world.contact_pairs_with(b.collider){
    let other=if pair.collider1==b.collider{pair.collider2}else{pair.collider1};
    let other_book=self.books.values().find(|b|b.collider==other);
    // If only collider2 was moving, collider1 has no captured pre-impact
    // velocity and cannot emit this hit. Deduplicate only two active emitters.
    if other_book.is_some_and(|b|b.kind==0&&(now<b.sound_until||pair.collider1!=b.collider&&self.audio_velocities.contains_key(&other))){continue;}
    let mut best=0.055_f32;let mut material=0;
    for m in pair.manifolds(){for contact in &m.data.solver_contacts{
     let (p1,p2)=m.data.solver_contact_world_points(contact,&self.world.bodies);let point=(p1+p2)*0.5;
     let speed=(velocity(pair.collider1,point)-velocity(pair.collider2,point)).dot(m.data.normal);
     if speed<=best{continue;}best=speed;
     material=if let Some(o)=other_book{
      if o.kind==0{0}else{self.solids.get(&o.name.iter().collect::<Vec<u16>>()).and_then(|s|s.materials.get(if pair.collider1==b.collider{m.subshape2}else{m.subshape1} as usize).copied()).unwrap_or(if o.kind==1{4}else{2})}
     }else{self.world.colliders[other].user_data.saturating_sub(10).min(5) as u32};
    }}
    if best>0.055{
     let mass=(self.world.bodies[b.handle].mass()/0.35).sqrt().clamp(0.45,1.15);
     let strength=(((best-0.045)/0.30).clamp(0.0,1.0).sqrt()*mass).min(1.0);
     let body=&self.world.bodies[b.handle];let pan=((body.translation().x-(b.bay[0]+b.bay[1])/2.0)/((b.bay[1]-b.bay[0])/2.0).max(0.01)*0.65).clamp(-0.7,0.7);
     hits.push((b.collider,other,material,strength,pan));
    }
   }
  }
  hits.sort_by(|a,b|b.3.total_cmp(&a.3));
  for (a,b,material,strength,pan) in hits{
   if self.pending_sounds.len()>=9{break;}
   if self.books.values().any(|o|(o.collider==a||o.collider==b)&&o.kind==0&&now<o.sound_until){continue;}
   for book in self.books.values_mut(){if book.collider==a||book.collider==b{book.sound_until=now+120.0;}}
   self.pending_sounds.extend([material as f64,strength as f64,pan as f64]);
  }
 }
}
#[wasm_bindgen]
impl RustBookGravity{
 pub fn sound_enabled(&mut self,enabled:bool){self.sounds_enabled=enabled;if !enabled{self.pending_sounds.clear();self.audio_velocities.clear();}}
 pub fn take_sounds(&mut self)->Option<Vec<f64>>{if self.pending_sounds.is_empty(){None}else{let sounds=self.pending_sounds.clone();self.pending_sounds.clear();Some(sounds)}}
}
