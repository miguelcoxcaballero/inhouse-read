//! Pot surface coordinates, fluting, interior shade and seam normals.
//! External LatheGeometry and browser transcendental coefficients stay in host.
use crate::plant_leaf::indexed_normals;

fn cross(profile: &[f64], start: usize, end: usize, y: f64) -> (f64,f64) {
    for j in start..end {
        let a=&profile[j*4..]; let b=&profile[(j+1)*4..];
        if a[1]!=b[1] && (a[1]-y)*(b[1]-y)<=0.0 {
            let t=(y-a[1])/(b[1]-a[1]);
            return (a[2]+(b[2]-a[2])*t,a[0]+(b[0]-a[0])*t);
        }
    }
    (profile[end*4+2],profile[end*4])
}

/// # Safety
/// Profile has n quadruples (radius, y, arc length, flute fade), ribs has
/// (segments+1)*n pairs (radial distance, cosine). Mesh buffers have standard
/// LatheGeometry lengths. All pointers belong to separate aligned arena spans.
#[no_mangle]
pub unsafe extern "C" fn plant_pot_surface(kind:u32,n:usize,segments:usize,radius:f64,soil:f64,
    profile:*const f64,ribs:*const f64,positions:*mut f32,normals:*mut f32,
    uv:*mut f32,colors:*mut f32,indices:*const u16,result:*mut f64)->u32 {
    if kind>2 || n<3 || n>64 || segments<3 || segments>128
        || !radius.is_finite() || radius<=0.0 || radius>1e6 || !soil.is_finite() || !(0.0..1.0).contains(&soil) {return 0;}
    let count=(segments+1)*n;
    let profile=std::slice::from_raw_parts(profile,n*4);
    let ribs=std::slice::from_raw_parts(ribs,count*2);
    let indices=std::slice::from_raw_parts(indices,segments*(n-1)*6);
    if profile.iter().any(|x|!x.is_finite()) || ribs.iter().any(|x|!x.is_finite())
        || indices.iter().any(|x|*x as usize>=count) {return 0;}
    let positions=std::slice::from_raw_parts_mut(positions,count*3);
    let normals=std::slice::from_raw_parts_mut(normals,count*3);
    let uv=std::slice::from_raw_parts_mut(uv,count*2);
    let colors=std::slice::from_raw_parts_mut(colors,count*3);
    let mut top=0;
    for j in 1..n {if profile[j*4+1]>profile[top*4+1] {top=j;}}
    let foot=cross(profile,0,top,0.04);let soil_cross=cross(profile,top,n-1,soil);
    let anchors=[(0.0,0.0),(foot.0,0.07),(profile[top*4+2],0.6),(soil_cross.0,0.74),(profile[(n-1)*4+2],1.0)];
    let mut rows=[0.0;64];let mut tones=[1.0;64];let lip=profile[top*4+1];
    for j in 0..n {
        let r=profile[j*4];let y=profile[j*4+1];let value=profile[j*4+2];
        for k in 1..5 {
            if value<=anchors[k].0 || k==4 {
                let (s0,v0)=anchors[k-1];let (s1,v1)=anchors[k];
                rows[j]=v0+(v1-v0)*if s1>s0 {((value-s0)/(s1-s0)).clamp(0.0,1.0)} else {0.0};break;
            }
        }
        if j>top {
            let t=((lip-y)/(lip-soil)).clamp(0.0,1.0);
            tones[j]=if y<soil-0.01 {0.42} else {1.0-0.45*(t*t*(3.0-2.0*t))};
        } else if kind==1 && j>0 && j<top {
            tones[j]+=((r-(profile[(j-1)*4]+profile[(j+1)*4])/2.0)*5.0).clamp(-0.09,0.02);
        }
    }
    for i in 0..=segments {for j in 0..n {
        let index=i*n+j;let mut tone=tones[j];uv[index*2+1]=rows[j] as f32;
        if kind==2 && j<top {
            let px=ribs[index*2];let rib=ribs[index*2+1];let fade=profile[j*4+3];
            let offset=rib*radius*0.018*fade;
            if px!=0.0 {
                positions[index*3]=(f64::from(positions[index*3])/px*(px+offset)) as f32;
                positions[index*3+2]=(f64::from(positions[index*3+2])/px*(px+offset)) as f32;
            }
            tone*=1.0+rib.min(0.0)*0.07*fade;
        }
        colors[index*3..index*3+3].fill(tone as f32);
    }}
    if kind==2 {
        indexed_normals(positions,normals,indices);
        for j in 0..n {
            let first=j*3;let last=(segments*n+j)*3;
            let x=f64::from(normals[first])+f64::from(normals[last]);
            let y=f64::from(normals[first+1])+f64::from(normals[last+1]);
            let z=f64::from(normals[first+2])+f64::from(normals[last+2]);
            let length=(x*x+y*y+z*z).sqrt();let inverse=1.0/if length==0.0 {1.0} else {length};
            for (k,v) in [x,y,z].iter().enumerate() {normals[first+k]=(v*inverse) as f32;normals[last+k]=(v*inverse) as f32;}
        }
    }
    *result=soil_cross.1*radius;
    1
}
