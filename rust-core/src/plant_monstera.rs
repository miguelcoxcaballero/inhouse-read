//! Both sides and boundary walls of the perforated Monstera leaf.
use std::collections::BTreeMap;
use crate::plant_leaf::indexed_normals;

/// # Safety
/// Source: vertices*3 f32, sines: vertices f64, triangles: count u16.
/// Outputs: vertices*6 f32 position/normal/color, vertices*4 f32 UV,
/// count*8 u16 indices. Separate aligned spans; return is written index count.
#[no_mangle]
pub unsafe extern "C" fn plant_monstera_mesh(vertices:usize,count:usize,length:f64,width:f64,curve:f64,tint:f64,twist:f64,hue:f64,
    source:*const f32,sines:*const f64,triangles:*const u16,positions:*mut f32,normals:*mut f32,colors:*mut f32,uv:*mut f32,indices:*mut u16)->usize {
    if vertices<3 || vertices>32767 || count<3 || count>65535 || count%3!=0 || length<=0.0 || width<=0.0
        || [length,width,curve,tint,twist,hue].iter().any(|v|!v.is_finite()||v.abs()>1e6) {return 0;}
    let source=std::slice::from_raw_parts(source,vertices*3);
    let sines=std::slice::from_raw_parts(sines,vertices);
    let triangles=std::slice::from_raw_parts(triangles,count);
    if source.iter().any(|v|!v.is_finite()) || sines.iter().any(|v|!v.is_finite()||v.abs()>1.0)
        || triangles.iter().any(|v|*v as usize>=vertices) {return 0;}
    let positions=std::slice::from_raw_parts_mut(positions,vertices*6);
    let normals=std::slice::from_raw_parts_mut(normals,vertices*6);
    let colors=std::slice::from_raw_parts_mut(colors,vertices*6);
    let uv=std::slice::from_raw_parts_mut(uv,vertices*4);
    let indices=std::slice::from_raw_parts_mut(indices,count*8);
    for side in 0..2 {for i in 0..vertices {
        let x=f64::from(source[i*3]);let y=f64::from(source[i*3+1]);let at=side*vertices+i;let side=side as f64;
        let sign=if x>0.0 {1.0}else if x<0.0 {-1.0}else{x};
        positions[at*3]=(x*width*(1.0+twist*sign)) as f32;
        positions[at*3+1]=((y-0.12)*length) as f32;
        positions[at*3+2]=(sines[i]*length*curve+x*x*width*0.15+x*width*twist*y-side*width*0.009) as f32;
        uv[at*2]=(0.5+x) as f32;uv[at*2+1]=y as f32;
        colors[at*3]=(0.85+tint+side*0.04+hue*0.8) as f32;
        colors[at*3+1]=(0.93+tint+side*0.025+hue*0.15) as f32;
        colors[at*3+2]=(0.81+tint+side*0.055-hue*0.5) as f32;
    }}
    let mut edges=BTreeMap::<u32,usize>::new();let mut ordered=Vec::<(u16,u16,bool)>::with_capacity(count);
    let mut next=0;let offset=vertices as u16;
    for triangle in triangles.chunks_exact(3) {
        let a=triangle[0];let b=triangle[1];let c=triangle[2];
        indices[next..next+6].copy_from_slice(&[a,b,c,a+offset,c+offset,b+offset]);next+=6;
        for (a,b) in [(a,b),(b,c),(c,a)] {
            let key=((a.min(b) as u32)<<16)|a.max(b) as u32;
            if let Some(at)=edges.remove(&key) {ordered[at].2=false;} else {edges.insert(key,ordered.len());ordered.push((a,b,true));}
        }
    }
    for (a,b,active) in ordered {if active {
        indices[next..next+6].copy_from_slice(&[a,a+offset,b+offset,a,b+offset,b]);next+=6;
    }}
    indexed_normals(positions,normals,&indices[..next]);next
}
