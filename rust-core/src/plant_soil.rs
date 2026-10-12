//! Pigment, height and roughness for peat and decorative gravel.
use crate::plant_glaze::hash;
use crate::plant_pottery::{cell,fbm};
use crate::plant_preview::byte;
fn smooth(a:f64,b:f64,v:f64)->f64 {let t=((v-a)/(b-a)).clamp(0.0,1.0);t*t*(3.0-2.0*t)}
fn color(hex:u32)->[f64;3] {[(hex>>16&255)as f64/255.0,(hex>>8&255)as f64/255.0,(hex&255)as f64/255.0]}
fn paint(kind:u32,u:f64,v:f64,x:i32,y:i32)->[f64;5] {
    let grain=hash(x,y,7);
    if (u-0.5).hypot(v-0.5)>0.54 {return [0.8+grain*0.14,0.8+grain*0.14,0.8+grain*0.14,0.45+grain*0.2,0.82];}
    let damp=color(0x271c14);let mut out=[0.0;5];
    if kind==1 {
        let c=cell(u*26.0,v*26.0,0,3);let gap=1.0-smooth(0.02,0.1,c.f2-c.f1);let dome=1.0-(c.f1*1.5).min(1.0);
        let stone=color([0xa39c90,0xbdb099,0x7e6c5b,0xd8d4cb,0x8f8a82][(c.id*5.0).floor()as usize]);
        let tone=0.74+dome*0.32+(grain-0.5)*0.08;
        for k in 0..3 {out[k]=stone[k]*tone+(damp[k]-stone[k]*tone)*gap;}
        out[3]=0.25+dome*0.55-gap*0.2;out[4]=0.76+gap*0.18;return out;
    }
    let clump=fbm(u*9.0,v*9.0,0,11,3);let crumbs=fbm(u*34.0,v*34.0,0,12,2);let wet=smooth(0.4,0.72,fbm(u*3.0,v*3.0,0,13,2));
    let grit=cell(u*22.0,v*22.0,0,17);let speck=if grit.id>0.93{smooth(0.3,0.14,grit.f1+(crumbs-0.5)*0.12)}else{0.0};
    let chip=cell(u*11.0,v*11.0,0,19);let woody=if chip.id>0.86{smooth(0.36,0.24,chip.f1*(1.0+(clump-0.5)*0.8))*(1.0-speck)}else{0.0};
    let tone=0.66+clump*0.5+(crumbs-0.5)*0.55+(grain-0.5)*0.16-wet*0.18;
    let peat=color(0x3b2b1f);let bark=color(0x5e3d29);let perlite=color(0xd9d6cc);
    for k in 0..3 {let soil=peat[k]*tone;let wood=bark[k]*(0.75+crumbs*0.35);out[k]=soil+(wood-soil)*woody+(perlite[k]*(0.84+grain*0.12)-soil)*speck;}
    out[3]=0.3+clump*0.3+(crumbs-0.5)*0.4+(grain-0.5)*0.12+speck*0.3+woody*0.16;
    out[4]=0.97-wet*0.12-speck*0.1-woody*0.05;out
}
/// # Safety
/// output points to width * count * 8 writable bytes.
#[no_mangle]
pub unsafe extern "C" fn plant_soil_rows(kind:u32,width:usize,height:usize,row:usize,count:usize,output:*mut u8)->u32 {
    if kind>1||width==0||height==0||width>2048||height>2048||count==0||count>4||row>=height||count>height-row{return 0;}
    let size=width*count*4;let(pigment,data)=std::slice::from_raw_parts_mut(output,size*2).split_at_mut(size);
    for offset in 0..count {let y=row+offset;let v=(y as f64+0.5)/height as f64;for x in 0..width {
        let u=(x as f64+0.5)/width as f64;let t=paint(kind,u,v,x as i32,y as i32);let at=(offset*width+x)*4;
        for k in 0..3 {pigment[at+k]=byte(t[k]);}pigment[at+3]=255;data[at]=byte(t[3]);data[at+1]=byte(t[4]);data[at+2]=0;data[at+3]=255;
    }}1
}
