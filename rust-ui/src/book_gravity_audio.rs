//! Read actual closing velocity at contact points, including new contacts in
//! an existing pair (the second cover hitting a board while its toe pivots).
//! Never analyse audio while locked/muted, warming an old shelf or hidden.
use super::*;
#[derive(Clone,Copy)]
pub(super) struct Velocity{centre:Vector,linear:Vector,angular:Vector}
impl Velocity{fn at(&self,point:Vector)->Vector{self.linear+self.angular.cross(point-self.centre)}}
// A solver cluster merges contacts from several compound pieces and keeps
// only the first piece's subshape IDs. Match its actual point back to the raw
// manifolds before selecting glass/metal or wood/fabric for a mixed lamp.
fn original_subshape(pair:&ContactPair,m:&ContactManifold,contact:&SolverContact,first:bool)->Option<usize>{
 let point=m.points.get((contact.contact_id[0]&0x7fff_ffff) as usize)?;
 let p1=m.subshape_pos1().map_or(point.local_p1,|pose|*pose*point.local_p1);
 let p2=m.subshape_pos2().map_or(point.local_p2,|pose|*pose*point.local_p2);
 let mut best=f32::INFINITY;let mut selected=None;
 for source in pair.manifolds(){for point in &source.points{
  let q1=source.subshape_pos1().map_or(point.local_p1,|pose|*pose*point.local_p1);
  let q2=source.subshape_pos2().map_or(point.local_p2,|pose|*pose*point.local_p2);
  let distance=(p1-q1).length_squared()+(p2-q2).length_squared();
  if distance<best{best=distance;selected=Some(if first{source.subshape1}else{source.subshape2} as usize);}
 }}selected
}
impl RustBookGravity{
 pub(super) fn prepare_sound_contacts(&mut self){
  self.audio_velocities.clear();
  for b in self.books.values(){if self.world.bodies[b.handle].is_dynamic(){
   let body=&self.world.bodies[b.handle];if !body.is_sleeping(){self.audio_velocities.insert(b.collider,Velocity{centre:body.translation(),linear:body.linvel(),angular:body.angvel()});}
  }}
 }
 /// The material of `collider`'s solid at this contact: one material, or the touched piece of a mixed one.
 fn solid_material(&self,name:&[u16],pair:&ContactPair,m:&ContactManifold,contact:&SolverContact,first:bool)->Option<u32>{
  let s=self.solids.get(name)?;let material=*s.materials.first()?;
  if s.materials.iter().all(|value|*value==material){Some(material)}else{original_subshape(pair,m,contact,first).and_then(|index|s.materials.get(index).copied())}
 }
 /// A lamp (true) or pot, and which one, as the lamp and plant sounds number them.
 fn decor_identity(&self,name:&[u16])->(bool,u32){
  match self.solids.get(name).map(|s|(s.description.kind,s.description.pot.as_str())){Some((1,pot))=>(false,crate::cozy_audio::pot_index(pot)),Some((2,_))=>(true,1),_=>(true,2)}
 }
 /// Books (impacts by the touched material), and lamps and pots, which land, fall, knock a book or clink
 /// against each other with their own sounds. Each sound is [material, strength, pan, kind] (SOUND_STRIDE).
 pub(super) fn record_sound_contacts(&mut self,now:f64){
  let mut hits=Vec::new();
  let velocity=|collider,point|self.audio_velocities.get(&collider).map_or(Vector::ZERO,|v|v.at(point));
  for (key,b) in &self.books{
   if b.kind>2||now<b.sound_until||!self.audio_velocities.contains_key(&b.collider){continue;}
   let decor=b.kind!=0;let (lamp,identity)=if decor{self.decor_identity(key)}else{(false,0)};
   for pair in self.world.contact_pairs_with(b.collider){
    let other=if pair.collider1==b.collider{pair.collider2}else{pair.collider1};
    let other_entry=self.books.iter().find(|(_,o)|o.collider==other);let other_book=other_entry.map(|(_,o)|o);
    // If only collider2 was moving, collider1 has no captured pre-impact
    // velocity and cannot emit this hit. Deduplicate only two active emitters.
    // A moving book reports its own contact with a lamp or pot, with the touched piece's material.
    let moving=self.audio_velocities.contains_key(&other);
    if if decor{other_book.is_some_and(|o|now<o.sound_until||o.kind==0&&moving||o.kind!=0&&pair.collider1!=b.collider&&moving)}
     else{other_book.is_some_and(|o|o.kind==0&&(now<o.sound_until||pair.collider1!=b.collider&&moving))}{continue;}
    // A landing after the hand lets go always sounds, even when it is gentle.
    let floor=if decor&&b.landing_sound{-1.0}else{0.055_f32};
    let mut best=floor;let mut material=0;let mut own=0;
    for m in pair.solver_manifolds(){for contact in &m.data.solver_contacts{
     let (p1,p2)=m.data.solver_contact_world_points(contact,&self.world.bodies);let point=(p1+p2)*0.5;
     let speed=(velocity(pair.collider1,point)-velocity(pair.collider2,point)).dot(m.data.normal);
     if speed<=best{continue;}best=speed;
     material=if let Some((name,o))=other_entry{
      if o.kind==0{0}else{self.solid_material(name,pair,m,contact,pair.collider1!=b.collider).unwrap_or(if o.kind==1{4}else{2})}
     }else{self.world.colliders[other].user_data.saturating_sub(10).min(5) as u32};
     if decor{own=self.solid_material(key,pair,m,contact,pair.collider1==b.collider).unwrap_or(if lamp{2}else{4});}
    }}
    if best<=floor{continue;}
    let mass=(self.world.bodies[b.handle].mass()/0.35).sqrt().clamp(0.45,1.15);
    let mut strength=(((best-0.045)/0.30).clamp(0.0,1.0).sqrt()*mass).min(1.0);
    let mut kind=3;
    if decor{
     // Lamps and pots only move up and down: a board under them is a landing, a fall from high is a tumble.
     let fall=best>FALL_SPEED;
     (kind,material)=match other_book{
      None=>(if fall{if lamp{10}else{13}}else if lamp{9}else{12},identity),
      Some(o) if o.kind==0=>if lamp{(24,identity)}else{(3,own)},
      Some(_)=>if lamp{(3,material)}else{(27,identity)},
     };
     if fall{strength=1.0;}else{strength=strength.max(0.3);}
    }
    let body=&self.world.bodies[b.handle];let pan=((body.translation().x-(b.bay[0]+b.bay[1])/2.0)/((b.bay[1]-b.bay[0])/2.0).max(0.01)*0.65).clamp(-0.7,0.7);
    hits.push((b.collider,other,material,strength,pan,kind));
   }
  }
  hits.sort_by(|a,b|b.3.total_cmp(&a.3));
  for (a,b,material,strength,pan,kind) in hits{
   if self.pending_sounds.len()>=3*SOUND_STRIDE{break;}
   if self.books.values().any(|o|(o.collider==a||o.collider==b)&&o.kind<=2&&now<o.sound_until){continue;}
   // A tumble already holds its bounces: the falling object stays quiet while it plays.
   let quiet=if kind==10||kind==13{700.0}else{120.0};
   for book in self.books.values_mut(){
    if book.collider==a{book.sound_until=now+quiet;book.landing_sound=false;}else if book.collider==b{book.sound_until=now+120.0;}
   }
   self.pending_sounds.extend([material as f64,strength as f64,pan as f64,kind as f64]);
  }
 }
}
/// A lamp or pot meeting a board faster than this (m/s) has fallen rather than been set down.
const FALL_SPEED:f32=0.4;
/// Numbers per pending sound: material, strength 0..1, pan -0.7..0.7, kind (cozy_synth).
pub(super) const SOUND_STRIDE:usize=4;
#[wasm_bindgen]
impl RustBookGravity{
 pub fn sound_enabled(&mut self,enabled:bool){self.sounds_enabled=enabled;if !enabled{self.pending_sounds.clear();self.audio_velocities.clear();for b in self.books.values_mut(){b.landing_sound=false;}}}
 /// Numbers per sound in `take_sounds`: [material, strength, pan, kind]. Earlier hosts read only the first three.
 pub fn sound_stride(&self)->u32{SOUND_STRIDE as u32}
 pub fn take_sounds(&mut self)->Option<Vec<f64>>{if self.pending_sounds.is_empty(){None}else{let sounds=self.pending_sounds.clone();self.pending_sounds.clear();Some(sounds)}}
}
