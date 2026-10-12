//! Real expanded-metal apertures and pressed facets; no alpha-mask substitute.
use std::collections::HashMap;
pub struct Sheet{position:Vec<f32>,uv:Vec<f32>,normal:Vec<f32>}
fn key(value:f64)->i64{let v=value*1000.0;let base=v.floor();(base+if v-base>=0.5{1.0}else{0.0}) as i64}
fn add(segments:&mut Vec<[f64;4]>,indices:&mut HashMap<[(i64,i64);2],usize>,s:[f64;4]){
 let a=(key(s[0]),key(s[1]));let b=(key(s[2]),key(s[3]));let k=if a<b{[a,b]}else{[b,a]};
 if let Some(&index)=indices.get(&k){segments[index]=s;}else{indices.insert(k,segments.len());segments.push(s);}
}
fn point(u:f64,v:f64,n:f64,p:&[f64])->[f64;3]{[u.max(p[0]).min(p[1]),v.max(p[2]).min(p[3]),n]}
fn triangle(sheet:&mut Sheet,points:[[f64;3];3],kind:u32,z:f64){
 for [u,v,n] in points{let pos=if kind==0{[u,n,-v]}else{[v,-u,z+n]};sheet.position.extend(pos.map(|x|x as f32));sheet.uv.extend([(u/8.0) as f32,(v/8.0) as f32]);}
}
/// # Safety
/// Nine f64: uMin,uMax,vMin,vMax,pitch,periodY,strandWidth,thickness,z.
/// Kind 0 horizontal sheet, 1 rear brace. Returned handle must be freed once.
#[no_mangle]
pub unsafe extern "C" fn metal_sheet_prepare(parameters:*const f64,kind:u32)->*mut Sheet{
 let p=std::slice::from_raw_parts(parameters,9);
 if kind>1||p.iter().any(|x|!x.is_finite()||x.abs()>10000.0)||p[0]>=p[1]||p[2]>=p[3]||p[4]<=0.0||p[5]<=0.0||p[6]<=0.0||p[7]<=0.0{return std::ptr::null_mut();}
 let px=p[4]*2.0;let py=p[5];let hh=py/2.0;let outer=p[4]*0.6;let shoulder=p[4]*0.4;
 let rows=((p[2]/py).floor()-1.0,(p[3]/py).ceil()+1.0);let columns=((p[0]/px).floor()-1.0,(p[1]/px).ceil()+1.0);
 if rows.0.abs()>1e7||rows.1.abs()>1e7||columns.0.abs()>1e7||columns.1.abs()>1e7||(rows.1-rows.0+1.0)*(columns.1-columns.0+1.0)>5000.0{return std::ptr::null_mut();}
 let corners=[[-outer,0.0],[-shoulder,-hh],[shoulder,-hh],[outer,0.0],[shoulder,hh],[-shoulder,hh]];
 let mut segments=Vec::new();let mut indices=HashMap::new();
 for row in rows.0 as i32..=rows.1 as i32{for col in columns.0 as i32..=columns.1 as i32{for [ou,ov] in [[0.0,0.0],[p[4],hh]]{
  let u=col as f64*px+ou;let v=row as f64*py+ov;
  for edge in 0..6{let a=corners[edge];let b=corners[(edge+1)%6];add(&mut segments,&mut indices,[u+a[0],v+a[1],u+b[0],v+b[1]]);}
 }}}
 for s in [[p[0],p[2],p[1],p[2]],[p[1],p[2],p[1],p[3]],[p[1],p[3],p[0],p[3]],[p[0],p[3],p[0],p[2]]]{add(&mut segments,&mut indices,s);}
 drop(indices);let mut sheet=Sheet{position:Vec::new(),uv:Vec::new(),normal:Vec::new()};
 for [au,av,bu,bv] in segments{
  let du=bu-au;let dv=bv-av;let mut from=0.0f64;let mut to=1.0f64;let mut clipped=false;
  for [direction,distance] in [[-du,au-p[0]],[du,p[1]-au],[-dv,av-p[2]],[dv,p[3]-av]]{
   if direction.abs()<1e-9{if distance<0.0{clipped=true;break;}continue;}
   let ratio=distance/direction;if direction<0.0{from=from.max(ratio);}else{to=to.min(ratio);}if from>=to{clipped=true;break;}
  }
  if clipped{continue;}
  let max=du.abs().max(dv.abs());let a=du/max;let b=dv/max;let length=max*(a*a+b*b).sqrt();
  let nu= -dv/length*p[6]/2.0;let nv=du/length*p[6]/2.0;
  let u0=au+du*from;let v0=av+dv*from;let u1=au+du*to;let v1=av+dv*to;
  let mut la=point(u0+nu,v0+nv,-p[7],p);let ra=point(u0,v0,0.0,p);let xa=point(u0-nu,v0-nv,-p[7],p);
  let mut lb=point(u1+nu,v1+nv,-p[7],p);let rb=point(u1,v1,0.0,p);let xb=point(u1-nu,v1-nv,-p[7],p);
  if dv.abs()<1e-7{la[2]=0.0;lb[2]=0.0;triangle(&mut sheet,[la,xa,xb],kind,p[8]);triangle(&mut sheet,[la,xb,lb],kind,p[8]);}
  else{triangle(&mut sheet,[la,ra,rb],kind,p[8]);triangle(&mut sheet,[la,rb,lb],kind,p[8]);triangle(&mut sheet,[ra,xa,xb],kind,p[8]);triangle(&mut sheet,[ra,xb,rb],kind,p[8]);}
  if sheet.position.len()>1_500_000{return std::ptr::null_mut();}
 }
 // Match Three: cross products are rounded to f32 before normalization.
 // Each unindexed face has three identical normals, including signed zero.
 sheet.normal=vec![0.0;sheet.position.len()];
 for (index,t) in sheet.position.chunks_exact(9).enumerate(){
  let cb=[t[6] as f64-t[3] as f64,t[7] as f64-t[4] as f64,t[8] as f64-t[5] as f64];
  let ab=[t[0] as f64-t[3] as f64,t[1] as f64-t[4] as f64,t[2] as f64-t[5] as f64];
  let n=[(cb[1]*ab[2]-cb[2]*ab[1]) as f32,(cb[2]*ab[0]-cb[0]*ab[2]) as f32,(cb[0]*ab[1]-cb[1]*ab[0]) as f32].map(|v|v as f64);
  let length=(n[0]*n[0]+n[1]*n[1]+n[2]*n[2]).sqrt();let inverse=1.0/if length==0.0{1.0}else{length};
  let n=n.map(|v|(v*inverse) as f32);for vertex in 0..3{sheet.normal[index*9+vertex*3..index*9+vertex*3+3].copy_from_slice(&n);}
 }
 Box::into_raw(Box::new(sheet))
}
#[no_mangle]
pub unsafe extern "C" fn metal_sheet_count(handle:*const Sheet)->usize{if handle.is_null(){0}else{(*handle).position.len()/3}}
#[no_mangle]
pub unsafe extern "C" fn metal_sheet_data(handle:*const Sheet,kind:u32)->*const f32{if handle.is_null(){return std::ptr::null();}match kind{0=>(*handle).position.as_ptr(),1=>(*handle).uv.as_ptr(),2=>(*handle).normal.as_ptr(),_=>std::ptr::null()}}
#[no_mangle]
pub unsafe extern "C" fn metal_sheet_free(handle:*mut Sheet){if !handle.is_null(){drop(Box::from_raw(handle));}}
