//! Indexed five-lobed ivy blade, including its cupped surface and normals.
use crate::plant_leaf::indexed_normals;
const OUTLINE:[(f64,f64);14]=[(0.0,0.05),(-0.14,-0.01),(-0.30,0.10),(-0.50,0.30),(-0.37,0.43),(-0.45,0.63),(-0.19,0.66),(0.0,1.0),(0.19,0.66),(0.45,0.63),(0.37,0.43),(0.50,0.30),(0.30,0.10),(0.14,-0.01)];

/// # Safety
/// Sines holds the centre coefficient then 14 outline coefficients. Outputs:
/// position/normal/color 87f32, UV58f32 and126u16 indices, disjoint spans.
#[no_mangle]
pub unsafe extern "C" fn plant_ivy_mesh(length:f64,width:f64,curve:f64,tint:f64,asymmetry:f64,hue:f64,
    sines:*const f64,positions:*mut f32,normals:*mut f32,colors:*mut f32,uv:*mut f32,indices:*mut u16)->u32 {
    if [length,width,curve,tint,asymmetry,hue].iter().any(|v|!v.is_finite()||v.abs()>1e6)||length<=0.0||width<=0.0{return 0;}
    let sines=std::slice::from_raw_parts(sines,15);
    if sines.iter().any(|v|!v.is_finite()||v.abs()>1.0){return 0;}
    let positions=std::slice::from_raw_parts_mut(positions,87);
    let normals=std::slice::from_raw_parts_mut(normals,87);
    let colors=std::slice::from_raw_parts_mut(colors,87);
    let uv=std::slice::from_raw_parts_mut(uv,58);
    let indices=std::slice::from_raw_parts_mut(indices,126);
    let center_y=length*0.44;let center_z=length*curve*0.75;
    for i in 0..29 {
        let (x,y,f,sine)=if i==0 {(0.0,0.44,0.0,sines[0])}else{let at=(i-1)%14;let (x,y)=OUTLINE[at];(x,y,if i<=14 {0.5}else{1.0},sines[at+1])};
        let sign=if x>0.0 {1.0}else if x<0.0 {-1.0}else{x};
        let px=x*width*f*(1.0+asymmetry*sign);let py=center_y+(y*length-center_y)*f;
        positions[i*3]=px as f32;positions[i*3+1]=py as f32;
        positions[i*3+2]=(center_z+x.abs()*width*0.055*f+sine*length*curve*0.2*f) as f32;
        uv[i*2]=(0.5+px/width) as f32;uv[i*2+1]=(py/length).max(0.0) as f32;
        colors[i*3]=(0.86+tint+hue*0.8) as f32;colors[i*3+1]=(0.92+tint+hue*0.15) as f32;colors[i*3+2]=(0.83+tint-hue*0.5) as f32;
    }
    for j in 0..14u16 {let next=(j+1)%14;let a=1+j;let b=1+next;let c=a+14;let d=b+14;let at=j as usize*9;indices[at..at+9].copy_from_slice(&[0,b,a,a,b,d,a,d,c]);}
    indexed_normals(positions,normals,indices);126
}
