//! Physical paint coordinates and continuous rounded-post wall normals.
use std::collections::HashMap;
fn key(x:f32,z:f32)->(u32,u32){(if x==0.0{0}else{x.to_bits()},if z==0.0{0}else{z.to_bits()})}
/// # Safety
/// Position and normal contain count*3 f32 each. Output holds count*2 f32
/// for UV mode (0), or count*3 f32 for rounded-post normals (1).
#[no_mangle]
pub unsafe extern "C" fn mesh_finish(position:*const f32,normal:*const f32,count:usize,kind:u32,output:*mut f32)->u32{
 if count==0||count>200_000||kind>1{return 0;}
 let p=std::slice::from_raw_parts(position,count*3);let n=std::slice::from_raw_parts(normal,count*3);
 if p.iter().chain(n.iter()).any(|v|!v.is_finite()){return 0;}
 let out=std::slice::from_raw_parts_mut(output,count*if kind==0{2}else{3});
 if kind==0{
  for vertex in 0..count{let at=vertex*3;let x=n[at].abs();let y=n[at+1].abs();let z=n[at+2].abs();let (u,v)=if x>=y&&x>=z{(p[at+2],p[at+1])}else if y>=z{(p[at],p[at+2])}else{(p[at],p[at+1])};out[vertex*2]=(u as f64/8.0) as f32;out[vertex*2+1]=(v as f64/8.0) as f32;}
 }else{
  let mut sums:HashMap<(u32,u32),[f64;2]>=HashMap::new();
  for vertex in 0..count{let at=vertex*3;if n[at+1].abs()>0.5{continue;}let sum=sums.entry(key(p[at],p[at+2])).or_insert([0.0;2]);sum[0]+=n[at] as f64;sum[1]+=n[at+2] as f64;}
  out.copy_from_slice(n);
  for vertex in 0..count{let at=vertex*3;if n[at+1].abs()>0.5{continue;}let [x,z]=sums[&key(p[at],p[at+2])];let length=(x*x+z*z).sqrt();let inverse=1.0/if length==0.0{1.0}else{length};out[at]=(x*inverse) as f32;out[at+1]=0.0;out[at+2]=(z*inverse) as f32;}
 }
 count as u32
}
