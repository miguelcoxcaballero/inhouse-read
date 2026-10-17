//! Cozy shelf foley, synthesised from physical building blocks: a contact pulse
//! (its length is the softness of the touch) driving damped resonators (the
//! modes of wood, metal, glass, ceramic…), filtered noise for brushing and
//! rustling, and a tiny room around every sound. Pure and deterministic: the
//! same (kind, material, variant, level) always gives the same samples, so the
//! host can cache them and nothing runs while the shelf is quiet.
//!
//! Kinds (material in brackets):
//!  0 pick up a book           1 open a cover            2 generic switch
//!  3 impact (0 paper 1 wood 2 metal 3 glass 4 ceramic 5 linen)
//!  4 slide a book (shelf: 0 wood 1 metal)   5 set a book down (surface as 3)
//!  6 lamp on  7 lamp off      8 lamp move   9 lamp set down  10 lamp falls
//!      (0 MITTLED, 1 TÄRNABY, 2 tripod)
//! 11 plant move  12 plant set down  13 plant falls  (pot: 0 glazed, 1 terracotta, 2 zinc)
//! 14 leaves brushed  15 into the bin  16 book back on its shelf
use std::f64::consts::{PI,TAU};
pub const KINDS:u32=17;
pub const RATE:f64=24000.0;
struct Rng(u32);
impl Rng{
 fn next(&mut self)->f64{self.0^=self.0<<13;self.0^=self.0>>17;self.0^=self.0<<5;self.0 as f64/2147483648.0-1.0}
 fn unit(&mut self)->f64{(self.next()+1.0)*0.5}
}
struct Buf{d:Vec<f64>}
impl Buf{
 fn new(seconds:f64)->Self{Self{d:vec![0.0;(seconds*RATE) as usize]}}
 fn add(&mut self,at:f64,src:&[f64],gain:f64){
  let start=(at*RATE).max(0.0) as usize;
  for (i,v) in src.iter().enumerate(){if let Some(o)=self.d.get_mut(start+i){*o+=v*gain;}}
 }
}
fn lp1(x:&[f64],hz:f64)->Vec<f64>{let a=1.0-(-TAU*hz/RATE).exp();let mut y=0.0;x.iter().map(|v|{y+=a*(v-y);y}).collect()}
/// Two cascaded one-pole filters: 12 dB per octave, soft enough to stay warm.
fn lp(x:&[f64],hz:f64)->Vec<f64>{lp1(&lp1(x,hz),hz)}
fn hp(x:&[f64],hz:f64)->Vec<f64>{let l=lp(x,hz);x.iter().zip(l).map(|(v,l)|v-l).collect()}
fn band(x:&[f64],lo:f64,hi:f64)->Vec<f64>{hp(&lp(x,hi),lo)}
fn noise(r:&mut Rng,seconds:f64)->Vec<f64>{(0..(seconds*RATE) as usize).map(|_|r.next()).collect()}
fn envelope(x:&mut [f64],attack:f64,decay:f64){
 for (i,v) in x.iter_mut().enumerate(){let t=i as f64/RATE;*v*=(t/attack.max(1e-4)).min(1.0)*(-t/decay).exp();}
}
/// Half-sine contact pulse: `contact` seconds long, the softness of the touch.
fn pulse(contact:f64)->Vec<f64>{let n=((contact*RATE) as usize).max(2);(0..n).map(|i|(PI*i as f64/n as f64).sin()).collect()}
/// Damped resonators (hz, seconds to fall 60 dB, gain) excited by `exc`.
fn modal(exc:&[f64],modes:&[(f64,f64,f64)],seconds:f64)->Vec<f64>{
 let len=(seconds*RATE) as usize;let mut out=vec![0.0;len];
 for &(hz,decay,gain) in modes{
  if hz>=RATE*0.48{continue;}
  let w=TAU*hz/RATE;let rr=(-6.9078/(RATE*decay)).exp();let (a,b)=(2.0*rr*w.cos(),rr*rr);let g=gain*w.sin();
  let (mut y1,mut y2)=(0.0,0.0);
  for i in 0..len{let x=exc.get(i).copied().unwrap_or(0.0);let y=a*y1-b*y2+g*x;y2=y1;y1=y;out[i]+=y;}
 }
 out
}
/// Many tiny filtered clicks: leaves, paper, cloth.
fn rustle(r:&mut Rng,seconds:f64,per_second:f64,lo:f64,hi:f64,level:f64,shape:fn(f64)->f64)->Vec<f64>{
 let mut out=vec![0.0;(seconds*RATE) as usize];let grains=(seconds*per_second) as usize;
 for _ in 0..grains{
  let at=r.unit();let t=at*seconds;let amp=shape(at)*level*(0.25+0.75*r.unit().powi(2));
  if amp<=1e-4{continue;}
  let len=((0.0012+0.006*r.unit())*RATE) as usize;
  let g=band(&noise(r,len as f64/RATE),lo*(0.8+0.4*r.unit()),hi*(0.8+0.4*r.unit()));
  let start=(t*RATE) as usize;
  for (i,v) in g.iter().enumerate(){let q=i as f64/len as f64;if let Some(o)=out.get_mut(start+i){*o+=v*amp*(PI*q).sin().powi(2)*14.0;}}
 }
 out
}
fn bell(x:f64)->f64{(PI*x).sin().powi(2)}
fn rise(x:f64)->f64{x*x}
fn fall(x:f64)->f64{(1.0-x).powi(2)}
/// A little room: three soft reflections and a short tail, mixed in quietly.
fn room(b:&mut Buf,mix:f64){
 let src=b.d.clone();let taps=[(0.0071,0.55),(0.0133,0.38),(0.0217,0.28),(0.0349,0.18),(0.0521,0.10)];
 for (delay,g) in taps{
  let n=(delay*RATE) as usize;let soft=lp(&src,3200.0);
  for i in n..b.d.len(){b.d[i]+=soft[i-n]*g*mix;}
 }
}
/// `weight` is the intended loudness (0.34 is a normal knock): the sound is scaled to that RMS, so a ringing
/// bell and a dull thud sit at the same comfortable level, then limited and softly clipped.
fn finish(mut b:Buf,weight:f64,fade:f64)->Vec<f32>{
 // Block DC and sub-bass drift (a pulse into a low resonator leaves some), soften the top.
 let slow=lp1(&b.d,18.0);for (v,s) in b.d.iter_mut().zip(slow){*v-=s;}
 b.d=lp1(&b.d,7000.0);
 // Keep only the audible part: every sound ends in silence, nothing is padded.
 let top0=b.d.iter().fold(1e-9,|m:f64,v|m.max(v.abs()));
 let end=b.d.iter().rposition(|v|v.abs()>top0*0.003).map_or(1,|i|i+1);
 let fade_n=((fade.min(0.08)*RATE) as usize).min(end/2).max(1);
 let len=(end+fade_n/2).min(b.d.len());b.d.truncate(len);let n=len;
 for i in 0..n{
  let mut g=((i as f64)/(0.0015*RATE)).min(1.0);
  if i+fade_n>n{g*=(n-i) as f64/fade_n as f64;}
  b.d[i]*=g;
 }
 let top=b.d.iter().fold(1e-9,|m:f64,v|m.max(v.abs()));
 let active=b.d.iter().filter(|v|v.abs()>top*0.02).count().max(1);
 let rms=(b.d.iter().map(|v|v*v).sum::<f64>()/active as f64).sqrt().max(1e-9);
 let k=(weight*0.07/0.34/rms).min(0.62/top);
 let mut out:Vec<f32>=b.d.iter().map(|v|{let x=v*k;(x/(1.0+0.35*x.abs())*1.2) as f32}).collect();
 if let Some(l)=out.last_mut(){*l=0.0;}out
}
/// Mode tables: (ratio to the fundamental, decay seconds, gain).
fn partials(material:u32)->(f64,&'static [(f64,f64,f64)],f64){
 // (fundamental Hz, modes, contact seconds at level 1)
 match material{
  1=>(250.0,&[(1.0,0.075,1.0),(2.04,0.042,0.46),(3.9,0.024,0.16),(6.3,0.013,0.05)],0.0042),
  2=>(520.0,&[(1.0,0.26,0.60),(2.76,0.17,0.30),(5.40,0.09,0.11),(8.93,0.04,0.03)],0.0016),
  3=>(1180.0,&[(1.0,0.22,0.50),(2.32,0.15,0.22),(4.25,0.09,0.08),(6.63,0.04,0.02)],0.0014),
  4=>(470.0,&[(1.0,0.12,0.80),(2.33,0.07,0.30),(3.86,0.04,0.11),(5.9,0.02,0.04)],0.0022),
  5=>(185.0,&[(1.0,0.042,1.0),(1.9,0.024,0.30),(3.1,0.014,0.08)],0.0080),
  _=>(215.0,&[(1.0,0.045,1.0),(2.1,0.028,0.26),(3.4,0.016,0.08)],0.0058),
 }
}
/// One contact on `material`. `force` 0.3..1.2 makes it harder and brighter.
fn strike(r:&mut Rng,material:u32,size:f64,force:f64,jitter:f64)->Vec<f64>{
 let (f0,modes,contact)=partials(material);
 let tc=contact/(0.6+0.55*force.sqrt());
 let ms:Vec<(f64,f64,f64)>=modes.iter().map(|&(ratio,d,g)|(f0*size*ratio*jitter,d*(0.85+0.3*r.unit()),g)).collect();
 let mut exc=pulse(tc);
 let n=exc.len();let nz=noise(r,tc);for i in 0..n{exc[i]+=0.25*nz[i]*(1.0-i as f64/n as f64);}
 let tail=modes.iter().fold(0.0_f64,|m,&(_,d,_)|m.max(d))*5.0+0.03;
 let mut out=modal(&exc,&ms,tail);
 // The felt part of a knock: a short low thump that gives the object weight.
 let mut thump=lp(&noise(r,0.05),if material==5||material==0{520.0}else{900.0});envelope(&mut thump,0.001,0.011);
 for (i,v) in thump.iter().enumerate(){if let Some(o)=out.get_mut(i){*o+=v*0.55*force;}}
 // And the tick of the contact itself: brighter for harder materials and harder blows.
 let mut tick=lp(&noise(r,0.012),if material==5||material==0{900.0}else{2600.0}*force.max(0.5));envelope(&mut tick,0.0004,0.0035);
 for (i,v) in tick.iter().enumerate(){if let Some(o)=out.get_mut(i){*o+=v*0.5*force;}}
 let k=0.35+0.65*force.clamp(0.0,1.2);for v in out.iter_mut(){*v*=k;}
 out
}
fn level_force(level:u32)->f64{match level{0=>0.42,2=>1.0,_=>0.7}}
fn sized(variant:u32,r:&mut Rng)->f64{let _=r;1.0+(variant as f64-1.0)*0.035}
/// Lamp fingerprints: (surface material of its base, body size, shade material).
fn lamp(id:u32)->(u32,f64,u32){match id{0=>(2,1.55,2),1=>(2,0.78,3),_=>(1,0.55,5)}}
fn pot(id:u32)->(u32,f64){match id{1=>(4,0.62),2=>(2,0.46),_=>(4,0.82)}}
pub fn render(kind:u32,material:u32,variant:u32,level:u32)->Vec<f32>{
 let mut r=Rng(0x91e1_0da5_u32.wrapping_add(variant.wrapping_mul(0x9e37_79b9)).wrapping_add(kind*7919+material*104729).max(1));
 let v=variant%3;let size=sized(v,&mut r);let force=level_force(level);
 match kind{
  0=>{ // soft lift: cloth rubbing a spine and one paper tick
   let mut b=Buf::new(0.36);
   b.add(0.0,&rustle(&mut r,0.22,170.0,900.0,3200.0,0.22,bell),1.0);
   b.add(0.0,&lp(&noise(&mut r,0.2),380.0).iter().enumerate().map(|(i,x)|x*bell(i as f64/(0.2*RATE))*0.7).collect::<Vec<_>>(),1.0);
   b.add(0.075,&strike(&mut r,0,0.9,0.25,size),0.5);room(&mut b,0.16);finish(b,0.34,0.06)}
  1=>{ // cover opening: a creak of cloth, a stretch of binding, pages fanning
   let mut b=Buf::new(0.7);
   b.add(0.0,&rustle(&mut r,0.34,150.0,700.0,2600.0,0.20,bell),1.0);
   let mut creak=modal(&pulse(0.03),&[(210.0*size,0.16,0.5),(331.0*size,0.10,0.25)],0.32);envelope(&mut creak,0.05,0.2);b.add(0.04,&creak,0.35);
   b.add(0.27,&rustle(&mut r,0.34,320.0,1800.0,5200.0,0.16,fall),1.0);
   b.add(0.3,&strike(&mut r,0,0.8,0.18,size),0.4);room(&mut b,0.18);finish(b,0.34,0.12)}
  2=>{ // generic switch
   let mut b=Buf::new(0.2);b.add(0.0,&strike(&mut r,2,1.1*size,0.55,1.0),0.7);b.add(0.032,&strike(&mut r,2,1.45*size,0.4,1.0),0.5);room(&mut b,0.14);finish(b,0.36,0.04)}
  3=>{let m=material.min(5);let mut b=Buf::new(0.9);b.add(0.0,&strike(&mut r,m,size,force,1.0),1.0);room(&mut b,0.14);
   finish(b,0.30+0.28*force,0.1)}
  4=>{ // a book dragged along a shelf: a soft scuff with stick-slip
   let m=if material==1{2}else{1};let (f0,_,_)=partials(m);let dur=0.34;let mut b=Buf::new(dur);
   let n=noise(&mut r,dur);let body=band(&n,f0*0.9,f0*5.0);
   let wobble=lp(&noise(&mut r,dur),26.0);
   let sc:Vec<f64>=body.iter().zip(&wobble).enumerate().map(|(i,(x,w))|{let t=i as f64/(dur*RATE);x*bell(t).sqrt()*(0.55+2.4*w.abs())}).collect();
   b.add(0.0,&sc,0.9);b.add(0.0,&lp(&n,300.0).iter().enumerate().map(|(i,x)|x*bell(i as f64/(dur*RATE))*0.7).collect::<Vec<_>>(),1.0);
   room(&mut b,0.12);finish(b,0.26,0.08)}
  5=>{ // a book set down: cover slap then the board answers
   let m=material.min(5);let mut b=Buf::new(0.8);
   b.add(0.0,&strike(&mut r,5,0.95,force*0.8,1.0),0.9);b.add(0.004,&strike(&mut r,m,size,force,1.0),0.9);
   b.add(0.0,&rustle(&mut r,0.14,260.0,900.0,3000.0,0.12,fall),0.8);room(&mut b,0.15);finish(b,0.34+0.2*force,0.09)}
  6|7=>{ // lamp switch: each fixture has its own mechanism
   let on=kind==6;let mut b=Buf::new(0.55);
   match material{
    0=>{ // MITTLED: a small plastic rocker
     b.add(0.0,&strike(&mut r,2,1.9*size,0.5,1.0),0.5);b.add(0.0,&strike(&mut r,0,1.5,0.6,1.0),0.5);
     b.add(if on{0.045}else{0.038},&strike(&mut r,2,2.4*size,0.35,1.0),0.35)}
    1=>{ // TÄRNABY: a metal dial that clicks round
     for (i,s) in [1.0,1.15,1.32].iter().enumerate(){b.add(0.0+0.018*i as f64,&strike(&mut r,2,0.9*s*size,0.45-0.1*i as f64,1.0),0.55);}
     b.add(0.07,&strike(&mut r,3,0.8,0.25,1.0),0.25)}
    _=>{ // tripod: a pull-chain, bead tinkle then the switch
     let chain=rustle(&mut r,0.16,520.0,2200.0,6500.0,0.17,bell);b.add(0.0,&chain,0.9);
     b.add(0.12,&strike(&mut r,2,1.15*size,0.55,1.0),0.55);b.add(0.138,&strike(&mut r,1,0.9,0.3,1.0),0.45)}
   }
   // A quiet warm breath of light: a note blooming when it lights, fading when it goes out.
   let base=if on{330.0}else{262.0};let glow=modal(&pulse(0.012),&[(base,0.22,0.5),(base*1.5,0.16,0.18)],0.4);
   let swell:Vec<f64>=glow.iter().enumerate().map(|(i,x)|{let t=i as f64/RATE;x*if on{(t/0.03).min(1.0)}else{(-t/0.07).exp()}}).collect();
   b.add(0.045,&swell,0.14);room(&mut b,0.18);finish(b,0.34,0.14)}
  8=>{ // a lamp dragged: its base on the shelf and its own rattle
   let (base,sz,shade)=lamp(material);let dur=0.46;let mut b=Buf::new(dur);
   let (f0,_,_)=partials(base);let n=noise(&mut r,dur);let wob=lp(&noise(&mut r,dur),20.0);
   let drag:Vec<f64>=band(&n,f0*0.7,f0*4.0).iter().zip(&wob).enumerate().map(|(i,(x,w))|{let t=i as f64/(dur*RATE);x*bell(t).sqrt()*(0.5+2.2*w.abs())}).collect();
   b.add(0.0,&drag,0.9);
   let (sf,_,_)=partials(shade);let ring=rustle(&mut r,dur,if material==2{70.0}else{110.0},sf*1.0,sf*2.6+900.0,0.11,bell);b.add(0.0,&ring,1.0);
   if material==1{b.add(0.12,&strike(&mut r,3,0.75*size,0.14,1.0),0.35);}
   let _=sz;room(&mut b,0.13);finish(b,0.28,0.1)}
  9=>{ // a lamp set down: its foot lands, its parts settle
   let (base,sz,shade)=lamp(material);let mut b=Buf::new(1.0);
   b.add(0.0,&strike(&mut r,base,sz*size,force*0.85,1.0),1.0);
   b.add(0.022,&strike(&mut r,shade,sz*1.1,force*0.4,1.0),0.45);
   if material==1{b.add(0.07,&strike(&mut r,3,0.7,force*0.3,1.0),0.4);}
   if material==2{b.add(0.03,&rustle(&mut r,0.25,140.0,700.0,2400.0,0.13,fall),0.7);}
   room(&mut b,0.15);finish(b,0.34+0.2*force,0.14)}
  10=>{ // a lamp falls over: it tips, bounces and rattles to rest
   let (base,sz,shade)=lamp(material);let mut b=Buf::new(1.5);let mut at=0.0;let mut gap=0.17;let mut f=1.0;
   b.add(0.0,&rustle(&mut r,0.18,200.0,500.0,2200.0,0.10,rise),0.8);at+=0.12;
   for i in 0..5{
    b.add(at,&strike(&mut r,if i%2==0{base}else{shade},sz*(1.0+0.07*i as f64),f*0.95,1.0),0.9*f.max(0.35));
    b.add(at+0.01,&strike(&mut r,shade,sz*1.15,f*0.5,1.0),0.4*f);
    at+=gap;gap*=0.62;f*=0.58;
   }
   b.add(at,&rustle(&mut r,0.45,95.0,sz.min(1.0)*900.0+900.0,4600.0,0.10,fall),0.8);
   room(&mut b,0.17);finish(b,0.52,0.25)}
  11=>{ // a pot pushed: ceramic on wood, soil shifting, leaves brushing
   let (pm,sz)=pot(material);let dur=0.5;let mut b=Buf::new(dur);
   let (f0,_,_)=partials(pm);let n=noise(&mut r,dur);let wob=lp(&noise(&mut r,dur),18.0);
   let scrape:Vec<f64>=band(&n,f0*0.8,f0*3.8).iter().zip(&wob).enumerate().map(|(i,(x,w))|{let t=i as f64/(dur*RATE);x*bell(t).sqrt()*(0.5+2.3*w.abs())}).collect();
   b.add(0.0,&scrape,0.8);b.add(0.0,&rustle(&mut r,dur,95.0,1100.0,4200.0,0.13,bell),1.0);
   b.add(0.05,&lp(&noise(&mut r,0.3),260.0).iter().enumerate().map(|(i,x)|x*bell(i as f64/(0.3*RATE))*0.5).collect::<Vec<_>>(),1.0);
   let _=sz;room(&mut b,0.13);finish(b,0.28,0.1)}
  12=>{ // a pot set down: ceramic clunk, a breath of soil, leaves settling
   let (pm,sz)=pot(material);let mut b=Buf::new(0.9);
   b.add(0.0,&strike(&mut r,pm,sz*size,force*0.85,1.0),1.0);
   b.add(0.01,&lp(&noise(&mut r,0.16),700.0).iter().enumerate().map(|(i,x)|x*fall(i as f64/(0.16*RATE))*0.4).collect::<Vec<_>>(),1.0);
   b.add(0.03,&rustle(&mut r,0.4,150.0,1200.0,4200.0,0.16,fall),1.0);room(&mut b,0.14);finish(b,0.34+0.2*force,0.15)}
  13=>{ // a pot falls: heavy tumble, then leaves and soil spill
   let (pm,sz)=pot(material);let mut b=Buf::new(1.3);let mut at=0.0;let mut gap=0.2;let mut f=1.0;
   for i in 0..4{
    b.add(at,&strike(&mut r,pm,sz*(1.0+0.05*i as f64),f,1.0),0.95*f.max(0.4));
    b.add(at+0.006,&lp(&noise(&mut r,0.14),600.0).iter().enumerate().map(|(i,x)|x*fall(i as f64/(0.14*RATE))*0.35).collect::<Vec<_>>(),f);
    at+=gap;gap*=0.6;f*=0.55;
   }
   b.add(0.0,&rustle(&mut r,0.9,200.0,1000.0,4000.0,0.15,fall),1.0);room(&mut b,0.16);finish(b,0.5,0.22)}
  14=>{ // leaves brushed
   let mut b=Buf::new(0.5);b.add(0.0,&rustle(&mut r,0.42,260.0,1300.0,4600.0,0.2,bell),1.0);b.add(0.02,&rustle(&mut r,0.3,90.0,500.0,1800.0,0.1,bell),0.8);room(&mut b,0.1);finish(b,0.26,0.1)}
  15=>{ // something dropped into the bin: paper crumple and a hollow thud
   let mut b=Buf::new(0.9);b.add(0.0,&rustle(&mut r,0.3,420.0,1200.0,4800.0,0.2,bell),1.0);
   let mut hollow=modal(&pulse(0.006),&[(190.0*size,0.14,0.9),(311.0*size,0.09,0.4),(520.0,0.05,0.2)],0.5);envelope(&mut hollow,0.002,0.2);
   b.add(0.18,&hollow,0.8);b.add(0.36,&rustle(&mut r,0.3,200.0,900.0,3600.0,0.09,fall),0.8);room(&mut b,0.2);finish(b,0.34,0.16)}
  16=>{ // a book back on its shelf: a firm, friendly tap and the cover settling
   let m=material.min(5);let mut b=Buf::new(0.7);b.add(0.0,&strike(&mut r,m,size,0.8,1.0),1.0);b.add(0.0,&strike(&mut r,5,0.9,0.6,1.0),0.8);
   b.add(0.07,&strike(&mut r,0,1.0,0.25,1.0),0.4);room(&mut b,0.15);finish(b,0.34,0.1)}
  _=>Vec::new(),
 }
}
