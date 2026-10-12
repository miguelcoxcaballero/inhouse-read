//! Terracotta and zinc pigment/physical channels, bounded by four rows.
use crate::plant_glaze::{hash, noise};
use crate::plant_preview::byte;
fn smooth(a: f64, b: f64, v: f64) -> f64 { let t = ((v-a)/(b-a)).clamp(0.0,1.0); t*t*(3.0-2.0*t) }
fn fbm(x: f64, y: f64, period: i32, seed: u32, octaves: u32) -> f64 {
    let (mut sum,mut amplitude,mut total)=(0.0,0.5,0.0);
    for octave in 0..octaves {
        let scale=1<<octave;
        sum+=amplitude*noise(x*scale as f64,y*scale as f64,period*scale,seed+octave*31);
        total+=amplitude;amplitude*=0.5;
    }
    sum/total
}
struct Cell { f1:f64, f2:f64, id:f64, dx:f64, dy:f64 }
fn cell(x:f64,y:f64,period:i32,seed:u32)->Cell {
    let xi=x.floor() as i32;let yi=y.floor() as i32;
    let mut c=Cell{f1:9.0,f2:9.0,id:0.0,dx:0.0,dy:0.0};
    for j in -1..=1 {for i in -1..=1 {
        let cy=yi+j;let h=hash(((xi+i)%period+period)%period,cy,seed);
        let dx=(xi+i)as f64+h-x;let dy=cy as f64+h*4099.0%1.0-y;let d=dx*dx+dy*dy;
        if d<c.f1 {c.f2=c.f1;c.f1=d;c.id=h*65537.0%1.0;c.dx=dx;c.dy=dy;}else if d<c.f2 {c.f2=d;}
    }}
    c.f1=c.f1.sqrt();c.f2=c.f2.sqrt();c
}
fn terracotta(u:f64,v:f64,x:i32,y:i32,color:&[f64],seed:u32,wheel:f64)->[f64;5] {
    let mottle=fbm(u*3.0,v*5.0,3,seed,2);let warp=fbm(u*5.0,v*9.0,5,seed+9,2);
    let fine=fbm(u*14.0+warp*1.6,v*26.0+warp*2.0,14,seed+1,2);let sand=hash(x,y,seed+2)-0.5;
    let pit=cell(u*26.0,v*52.0,26,seed+6);
    let pore=if pit.id>0.84 {smooth(0.26,0.08,pit.f1+(fine-0.5)*0.15)}else{0.0};
    let grog=if pit.id<0.03 {smooth(0.22,0.08,pit.f1)*if pit.id<0.012{-1.0}else{1.0}}else{0.0};
    let a=(v-0.6+0.06)/0.09;let b=(v-0.02)/0.06;
    let region=(-(a*a)).exp().max((-(b*b)).exp()*0.85);
    let bloom=if region>0.02 {smooth(0.5,0.8,fbm(u*7.0,v*10.0+warp,7,seed+3,3))*region*0.3}else{0.0};
    let throwing=(v*120.0+wheel).sin()*0.008;
    let inner=if v>0.6+0.012{0.8}else{1.0};
    let tone=(0.87+mottle*0.2+(fine-0.5)*0.1+sand*0.045+throwing-pore*0.06+grog*0.08)*inner;
    let warmth=[1.0+(mottle-0.5)*0.08,1.0,1.0-(mottle-0.5)*0.06];
    let salt=[227.0/255.0,220.0/255.0,207.0/255.0];let mut t=[0.0;5];
    for c in 0..3 {let clay=color[c]*tone*warmth[c];t[c]=clay+(salt[c]-clay)*bloom;}
    t[3]=0.5+(fine-0.5)*0.22+sand*0.1-pore*0.2+grog*0.1+throwing*2.0+bloom*0.1;
    t[4]=0.9+(fine-0.5)*0.08+pore*0.06+bloom*0.06;t
}
fn galvanized(u:f64,v:f64,color:&[f64],seed:u32)->[f64;5] {
    let c=cell(u*12.0,v*24.0,12,seed);let id=c.id;let border=smooth(0.0,0.05,c.f2-c.f1);
    let angle=id*std::f64::consts::PI*2.0;let ax=angle.cos();let ay=angle.sin();let tilt=c.dx*ax+c.dy*ay;
    let feather=((u*12.0*ax+v*24.0*ay)*11.0+id*40.0+noise(u*40.0,v*80.0,40,seed+1)*2.5).sin()*0.5+0.5;
    let bead=if v<0.07+0.015||(v-0.6).abs()<0.035{0.93}else{1.0};let inner=if v>0.6+0.035{0.9}else{1.0};
    let tone=(0.95+(id-0.5)*0.035+tilt*0.015+feather*0.012)*(0.98+border*0.02)*bead*inner;
    [color[0]*tone,color[1]*tone,color[2]*tone,0.5+tilt*0.035+feather*0.02-(1.0-border)*0.04,
     0.34+id*0.12+feather*0.04+(1.0-border)*0.04+(1.0-bead)*0.25]
}
/// # Safety
/// config contains RGB [0,1] and seed; output has width*count*8 bytes.
#[no_mangle]
pub unsafe extern "C" fn plant_pottery_rows(kind:u32,width:usize,height:usize,row:usize,count:usize,config:*const f64,output:*mut u8)->u32 {
    if kind>1||width==0||height==0||width>2048||height>2048||count==0||count>4||row>=height||count>height-row{return 0;}
    let c=std::slice::from_raw_parts(config,4);
    if c.iter().any(|v|!v.is_finite())||c[..3].iter().any(|v|*v<0.0||*v>1.0)||c[3]<0.0||c[3]>1_000_000.0||c[3].fract()!=0.0{return 0;}
    let seed=c[3]as u32;let size=width*count*4;let(pigment,data)=std::slice::from_raw_parts_mut(output,size*2).split_at_mut(size);
    for x in 0..width {
        let u=(x as f64+0.5)/width as f64;
        let wheel=if kind==0{noise(u*6.0,0.0,6,seed+5)*4.0}else{0.0};
        for offset in 0..count {
            let y=row+offset;let v=(y as f64+0.5)/height as f64;
            let t=if v>=0.74+0.03{[0.2,0.2,0.2,0.5,1.0]}else if kind==0{terracotta(u,v,x as i32,y as i32,c,seed,wheel)}else{galvanized(u,v,c,seed)};
            let at=(offset*width+x)*4;for k in 0..3{pigment[at+k]=byte(t[k]);}
            pigment[at+3]=255;data[at]=byte(t[3]);data[at+1]=byte(t[4]);data[at+2]=0;data[at+3]=255;
        }
    }
    1
}
