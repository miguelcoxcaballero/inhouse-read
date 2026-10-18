//! Convex pieces of the actual solid decoration. Leaves and the empty space
//! between tripod legs must never hold a book in mid-air. Shapes are cached
//! once per fitted model; the renderer and solver share profiles/dimensions.
use rapier3d::prelude::*;
use crate::{plant_parts,lamp_model,three_geo,three_curve,jsmath};
use std::f64::consts::PI;
#[derive(Clone)]
pub struct Description{pub kind:u32,pub pot:String,pub profile:String,pub values:[f64;4]}
impl Description{
 fn prefix(&self)->String{format!("{}:{}:{}:{}:",if self.kind==2{"solid-v2"}else{"solid-v1"},self.kind,self.pot,self.profile)}
 pub fn signature(&self)->String{format!("{}{:?}",self.prefix(),self.values.map(|v|((v*1e9).round()/1e9).to_bits()))}
 pub fn matches_signature(&self,saved:Option<&str>)->bool{
  let Some(raw)=saved.and_then(|s|s.strip_prefix(&self.prefix())).and_then(|s|s.strip_prefix('[')).and_then(|s|s.strip_suffix(']'))else{return false;};
  let Some(values)=raw.split(',').map(|s|s.trim().parse::<u64>().ok().map(f64::from_bits)).collect::<Option<Vec<_>>>()else{return false;};
  // Older plant snapshots measured CSS rectangles (rounded to 1/64 px).
  // Match the existing rest-pose dimension tolerance: sub-0.1 mm changes
  // must not wake a saved support merely because the viewport changed.
  // Lamp values contain model scale factors, so keep their tighter bound.
  let tolerance=if self.kind==1{0.0001}else{1e-8};
  values.len()==4&&values.iter().zip(self.values).all(|(a,b)|a.is_finite()&&(a-b).abs()<tolerance)
 }
 pub fn same(&self,other:&Self)->bool{self.kind==other.kind&&self.pot==other.pot&&self.profile==other.profile&&self.values.iter().zip(other.values).all(|(a,b)|(a-b).abs()<1e-9)}
}
#[derive(Clone)]
pub struct Solid{pub description:Description,pub shape:SharedShape,pub materials:Vec<u32>}
fn hull(points:Vec<Vector>,material:u32,parts:&mut Vec<(Pose,SharedShape)>,materials:&mut Vec<u32>){
 if let Some(shape)=SharedShape::convex_hull(&points){parts.push((Pose::IDENTITY,shape));materials.push(material);}
}
fn revolved(profile:&[[f64;2]],radius:f64,height:f64,y:f64,material:u32,parts:&mut Vec<(Pose,SharedShape)>,materials:&mut Vec<u32>){
 let top=profile.iter().enumerate().max_by(|(i,a),(j,b)|a[1].total_cmp(&b[1]).then_with(||j.cmp(i))).map_or(0,|(i,_)|i);
 for edge in profile[..=top].windows(2){
  if edge[1][1]-edge[0][1]<1e-8{continue;}
  let mut points=Vec::new();
  for [r,h] in edge{for i in 0..48{let a=i as f64/48.0*2.0*PI;points.push(Vector::new((r*radius*a.cos()) as f32,(y+h*height) as f32,(r*radius*a.sin()) as f32));}}
  hull(points,material,parts,materials);
 }
}
impl Solid{
 pub fn new(description:Description)->Option<Self>{
  let mut parts=Vec::new();let mut materials=Vec::new();let v=description.values;
  match description.kind{
   1=>{
    let mut profile=plant_parts::pot_profile(&description.profile);
    let max_y=profile.iter().map(|p|p[1]).fold(0.0,f64::max);
    let max_r=profile.iter().map(|p|p[0]).fold(0.0,f64::max)+if description.profile=="gradvis"{0.018}else{0.0};
    for p in &mut profile{p[1]/=max_y;}
    let material=if description.pot=="akerbar"{2}else{4};
    revolved(&profile,v[0]/max_r,v[1],-v[2]/2.0,material,&mut parts,&mut materials);
    if description.pot=="muskotblomma"{
     revolved(&[[0.0,0.0],[1.13,0.0],[1.17,0.025],[1.19,0.075],[1.18,0.14],[1.155,0.172]],v[0]/1.19,v[1],-v[2]/2.0,4,&mut parts,&mut materials);
    }
   },
   2=>{
    // Rounded, angled oak planks, using the exact rendered vertices. Each
    // leg is its own convex piece, preserving the empty gaps between them.
    let scale=v[3];
    let mut legs:Vec<Vec<Vector>>=Vec::new();
    for index in 0..3{
     let (foot,shoulder,angle)=lamp_model::tripod_leg_points(index);
     let mut geo=three_geo::rounded_box(13.0,jsmath::distance(foot,shoulder),9.0,2,1.1);
     let rotation=three_curve::quaternion_multiply(three_geo::quaternion_from_unit_vectors([0.0,1.0,0.0],jsmath::normalize(jsmath::sub(shoulder,foot))),three_curve::quaternion_from_axis_angle([0.0,1.0,0.0],-angle));
     geo.apply_quaternion(rotation);geo.translate((foot[0]+shoulder[0])/2.0,(foot[1]+shoulder[1])/2.0,(foot[2]+shoulder[2])/2.0);
     legs.push(geo.position.chunks_exact(3).map(|p|Vector::new(p[0],p[1].max(0.0),p[2])).collect());
    }
    // lamp_model zeroes the combined wooden base after rounding its feet.
    // Apply that same translation to the colliders, including the centre block.
    let low=legs.iter().flatten().map(|p|p.y).fold(f32::INFINITY,f32::min);
    for points in legs{hull(points.into_iter().map(|p|Vector::new(p.x*scale as f32,(p.y-low)*scale as f32,p.z*scale as f32)).collect(),1,&mut parts,&mut materials);}
    let block=SharedShape::cuboid((18.0*scale) as f32,(6.0*scale) as f32,(18.0*scale) as f32);
    parts.push((Pose::translation(0.0,((167.0-low as f64)*scale) as f32,0.0),block));materials.push(1);
    revolved(&[[90.0,175.0],[90.0,280.0]],scale,scale,0.0,5,&mut parts,&mut materials);
   },
   3=>{
    revolved(lamp_model::LANTERN_BASE,v[3],v[3],0.0,2,&mut parts,&mut materials);
    revolved(lamp_model::LANTERN_CHIMNEY,v[3],v[3],0.0,3,&mut parts,&mut materials);
   },
   _=>return None
  }
  if parts.is_empty(){None}else{Some(Self{description,shape:SharedShape::compound(parts),materials})}
 }
}
