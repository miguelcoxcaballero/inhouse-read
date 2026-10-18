//! Cozy shelf foley, synthesised (the fallback when no recorded clip exists).
//! Nothing here is a tone: every contact starts with a broadband transient (a
//! few ms of noise band-limited by hardness plus a short "tick"), excites a
//! dense, irregular, inharmonic cluster of modes whose high members die in a
//! few ms, and carries a damped noise body so it feels like mass touching a
//! surface. Rubbing is stick-slip friction (sharp micro-onsets gated by an
//! irregular pressure), leaves and paper are sharp-onset grains, falls are
//! irregular bounces over several materials. Pure and deterministic: the same
//! (kind, material, variant, level) always gives the same samples.
//!
//! Kinds (material in brackets; level 0 soft, 1 medium, 2 hard):
//!  0 pick up a book   1 open a cover   2 generic switch
//!  3 impact [0 paper 1 wood 2 metal 3 glass 4 ceramic 5 linen]
//!  4 slide a book along a shelf [0 wood 1 metal]   5 set a book down [surface as 3]
//!  6 lamp on  7 lamp off  8 lamp dragged  9 lamp set down  10 lamp falls
//!    [lamp: 0 MITTLED puck, 1 tripod, 2 TÄRNABY lantern]
//! 11 plant dragged  12 plant set down  13 plant falls
//!    [pot: 0 MUSKOT, 1 MUSKOTBLOMMA terracotta, 2 ÅKERBÄR zinc, 3 GRADVIS stoneware, 4 small MUSKOT]
//! 14 leaves brushed  15 into the bin  16 book back on its shelf [surface as 3]
//! 17 book pulled out of the row  18 book slid back into the row  19 cover closes
//! 20 pages flutter  21 bookmark ribbon  22 lamp jiggled [lamp]  23 light bloom [lamp]
//! 24 lamp knocks a book [lamp]  25 leaves settle  26 soil crumbles  27 pot clinks a pot [pot]
//! 28 bin lid  29 shelf board creaks  30 soft UI tap [0 tap, 1 back, 2 toggle]
//! 31 zoom in  32 zoom out  33 view turns isometric  34 view turns straight (soft airy whooshes)
use std::f64::consts::{PI,TAU};
pub const KINDS:u32=35;
pub const RATE:f64=48000.0;
/// Longest sound: 0.625 s, 120 KB as f32.
pub const MAX_SAMPLES:usize=30000;

struct Rng(std::cell::Cell<u32>);
impl Rng{
 fn new(seed:u32)->Self{let mut s=seed^0x9e37_79b9;s=(s^(s>>16)).wrapping_mul(0x7feb_352d);s=(s^(s>>15)).wrapping_mul(0x846c_a68b);s^=s>>16;Rng(std::cell::Cell::new(s.max(1)))}
 fn next(&self)->f64{let mut s=self.0.get();s^=s<<13;s^=s>>17;s^=s<<5;self.0.set(s);s as f64/2147483648.0-1.0}
 fn unit(&self)->f64{(self.next()+1.0)*0.5}
 fn around(&self,spread:f64)->f64{1.0+spread*self.next()}
}
/// RBJ biquad, transposed direct form II.
#[derive(Clone,Copy)]
struct Bq{b0:f64,b1:f64,b2:f64,a1:f64,a2:f64,z1:f64,z2:f64}
impl Bq{
 fn make(b0:f64,b1:f64,b2:f64,a0:f64,a1:f64,a2:f64)->Self{Self{b0:b0/a0,b1:b1/a0,b2:b2/a0,a1:a1/a0,a2:a2/a0,z1:0.0,z2:0.0}}
 fn sc(hz:f64,q:f64)->(f64,f64,f64){let w=TAU*hz.clamp(10.0,RATE*0.45)/RATE;let (s,c)=w.sin_cos();(s,c,s/(2.0*q))}
 fn lp(hz:f64,q:f64)->Self{let (_,c,a)=Self::sc(hz,q);Self::make((1.0-c)/2.0,1.0-c,(1.0-c)/2.0,1.0+a,-2.0*c,1.0-a)}
 fn hp(hz:f64,q:f64)->Self{let (_,c,a)=Self::sc(hz,q);Self::make((1.0+c)/2.0,-(1.0+c),(1.0+c)/2.0,1.0+a,-2.0*c,1.0-a)}
 fn bp(hz:f64,q:f64)->Self{let (_,c,a)=Self::sc(hz,q);Self::make(a,0.0,-a,1.0+a,-2.0*c,1.0-a)}
 fn peak(hz:f64,q:f64,db:f64)->Self{let (_,c,a)=Self::sc(hz,q);let g=10f64.powf(db/40.0);Self::make(1.0+a*g,-2.0*c,1.0-a*g,1.0+a/g,-2.0*c,1.0-a/g)}
 fn run(&mut self,x:f64)->f64{let y=self.b0*x+self.z1;self.z1=self.b1*x-self.a1*y+self.z2;self.z2=self.b2*x-self.a2*y;y}
 fn apply(mut self,x:&mut[f64]){for v in x{*v=self.run(*v);}}
}
fn len_of(seconds:f64)->usize{((seconds*RATE) as usize).clamp(1,MAX_SAMPLES)}
fn peak(x:&[f64])->f64{x.iter().fold(0.0,|m:f64,v|m.max(v.abs()))}
fn normalized(mut x:Vec<f64>)->Vec<f64>{let p=peak(&x);if p>1e-12{for v in &mut x{*v/=p;}}x}
/// An exponential decay by multiplication (no exp() per sample): `seconds` per e-fold.
struct Fade(f64,f64);
impl Fade{fn new(seconds:f64)->Self{Fade(1.0,(-1.0/(seconds.max(1e-5)*RATE)).exp())}fn next(&mut self)->f64{let v=self.0;self.0*=self.1;v}}
struct Mix(Vec<f64>);
impl Mix{
 fn new(seconds:f64)->Self{Mix(vec![0.0;len_of(seconds)])}
 fn add(&mut self,at:f64,src:&[f64],gain:f64){
  let start=(at.max(0.0)*RATE) as usize;
  for (o,v) in self.0.iter_mut().skip(start).zip(src){*o+=v*gain;}
 }
}

/// A material: lowest mode, inharmonic mode ratios, ring time (s to -60 dB) of the lowest mode,
/// how fast higher modes die (exponent), whether modes come in slightly beating pairs, transient
/// brightness and tick, noise body (centre Hz, decay s, gain) and an optional low thump.
struct Mat{f0:f64,ratios:&'static[f64],ring:f64,damp:f64,pairs:bool,bright:f64,tick:f64,body:(f64,f64,f64),thump:f64,modes:f64}
const PAPER:usize=0;const WOOD:usize=1;const METAL:usize=2;const GLASS:usize=3;const CERAMIC:usize=4;const LINEN:usize=5;
const TERRACOTTA:usize=6;const STONEWARE:usize=7;const ZINC:usize=8;const PLASTIC:usize=9;const ALUMINIUM:usize=10;const OAK:usize=11;const BRASS:usize=12;
const PLATE:&[f64]=&[1.0,1.37,1.81,2.29,2.74,3.33,3.91,4.48,5.17,5.96,6.83,7.71,8.69,9.8];
const SHELL:&[f64]=&[1.0,1.29,1.72,2.18,2.63,3.09,3.61,4.27,4.93,5.52,6.31,7.18];
const BAR:&[f64]=&[1.0,1.49,2.03,2.76,3.31,4.08,4.92,5.40,6.27,7.36,8.93,10.2];
fn mat(i:usize)->Mat{
 let m=|f0,ratios,ring,damp,pairs,bright,tick,body,thump,modes|Mat{f0,ratios,ring,damp,pairs,bright,tick,body,thump,modes};
 match i{
  PAPER=>m(290.0,PLATE,0.034,1.5,false,2600.0,900.0,(520.0,0.022,0.9),0.45,0.35),
  WOOD=>m(370.0,PLATE,0.055,1.4,false,3600.0,1400.0,(640.0,0.026,0.75),0.55,0.55),
  METAL=>m(560.0,BAR,0.26,1.15,true,4200.0,2600.0,(900.0,0.016,0.35),0.0,0.6),
  GLASS=>m(1240.0,SHELL,0.24,1.0,true,5200.0,3200.0,(700.0,0.012,0.3),0.0,0.55),
  CERAMIC=>m(760.0,SHELL,0.13,1.2,true,4000.0,2200.0,(560.0,0.02,0.55),0.0,0.55),
  LINEN=>m(240.0,PLATE,0.024,1.7,false,1800.0,700.0,(430.0,0.03,1.0),0.6,0.22),
  TERRACOTTA=>m(640.0,SHELL,0.05,1.4,false,3400.0,1700.0,(600.0,0.024,0.7),0.0,0.45),
  STONEWARE=>m(560.0,SHELL,0.1,1.25,true,3800.0,2000.0,(520.0,0.024,0.65),0.25,0.5),
  ZINC=>m(470.0,BAR,0.17,1.1,true,3800.0,2300.0,(820.0,0.018,0.45),0.0,0.55),
  PLASTIC=>m(980.0,PLATE,0.026,1.5,false,3600.0,2000.0,(1100.0,0.012,0.6),0.0,0.45),
  ALUMINIUM=>m(1050.0,SHELL,0.18,1.1,true,4300.0,2800.0,(950.0,0.012,0.4),0.0,0.5),
  OAK=>m(720.0,BAR,0.05,1.35,false,3600.0,1700.0,(760.0,0.018,0.6),0.25,0.55),
  _=>m(820.0,BAR,0.25,1.1,true,4300.0,2600.0,(980.0,0.014,0.35),0.0,0.55),
 }
}
/// Many damped resonators driven by `exc`, accumulated into `out`.
fn resonate(out:&mut[f64],exc:&[f64],hz:f64,t60:f64,gain:f64){
 if hz>=RATE*0.45||gain==0.0{return;}
 let w=TAU*hz/RATE;let r=(-6.9078/(RATE*t60.max(0.002))).exp();let (a1,a2,g)=(2.0*r*w.cos(),r*r,gain*w.sin());
 let n=((t60*1.25*RATE) as usize+exc.len()).min(out.len());let (mut y1,mut y2)=(0.0,0.0);
 for i in 0..n{let x=exc.get(i).copied().unwrap_or(0.0);let y=a1*y1-a2*y2+g*x;y2=y1;y1=y;out[i]+=y;}
}
/// One contact of `material` (scaled in pitch by `pitch`) struck with `force` 0.1..1.2.
fn strike(r:&Rng,material:usize,pitch:f64,force:f64)->Vec<f64>{
 let m=mat(material);let force=force.clamp(0.08,1.2);
 let len=len_of((m.ring*1.3).max(m.body.1*1.4*7.0)+0.05);let mut out=vec![0.0;len];
 // 1. Broadband transient: sharp (0.25 ms) rise, a few ms of noise, brighter when harder.
 let burst=len_of(0.0025+0.004*(1.0-force.min(1.0)));let mut tr=vec![0.0;burst];
 let mut lp=Bq::lp(m.bright*(0.55+0.45*force.min(1.0))*r.around(0.1),0.7);
 let mut d=Fade::new(0.0009+0.0016*(1.0-force.min(1.0)));
 for (i,v) in tr.iter_mut().enumerate(){let t=i as f64/RATE;*v=lp.run(r.next())*(t/0.00025).min(1.0)*d.next();}
 let tr=normalized(tr);
 // 2. A short "tick" at the material's tick band.
 let mut tick=vec![0.0;len_of(0.008)];let mut bp=Bq::bp(m.tick*r.around(0.12),2.2);
 let mut d=Fade::new(0.0014);for (i,v) in tick.iter_mut().enumerate(){let t=i as f64/RATE;*v=bp.run(r.next())*(t/0.0003).min(1.0)*d.next();}
 let tick=normalized(tick);
 // 3. Dense irregular inharmonic modes, excited by the noisy transient (random phases), high ones dying in ms.
 let mut modes=vec![0.0;len];
 for (k,&ratio) in m.ratios.iter().enumerate(){
  let hz=m.f0*pitch*ratio*r.around(0.025);let t60=(m.ring*ratio.powf(-m.damp)).max(0.003)*r.around(0.15);
  let g=(0.25+0.75*r.unit().powi(2))/(1.0+k as f64*0.35);
  resonate(&mut modes,&tr,hz,t60,g);
  if m.pairs{resonate(&mut modes,&tr,hz*(1.0+0.004+0.006*r.unit()),t60*0.9,g*(0.4+0.4*r.unit()));}
 }
 let modes=normalized(modes);
 // 4. Damped noise body (mass touching a surface) and, for wood and cloth, a low thump heard as 200-500 Hz.
 let (bhz,bdecay,bgain)=m.body;let mut body=vec![0.0;len_of(bdecay*1.4*7.0)];
 let mut b1=Bq::bp(bhz*pitch.sqrt()*r.around(0.1),0.9);let mut b2=Bq::bp(230.0*r.around(0.1),0.8);let mut th=vec![0.0;body.len()];
 let (mut d1,mut d2)=(Fade::new(bdecay),Fade::new(bdecay*1.4));
 for (i,(v,w)) in body.iter_mut().zip(th.iter_mut()).enumerate(){let t=i as f64/RATE;let e=(t/0.0006).min(1.0);let n=r.next();
  *v=b1.run(n*e*d1.next());*w=b2.run(n*e*d2.next());}
 let (body,th)=(normalized(body),normalized(th));
 let soft=1.0-force.min(1.0);
 for (i,o) in out.iter_mut().enumerate(){
  *o=modes[i]*m.modes+body.get(i).unwrap_or(&0.0)*bgain*(0.7+0.3*soft)+th.get(i).unwrap_or(&0.0)*m.thump
   +tr.get(i).unwrap_or(&0.0)*(0.25+0.35*force.min(1.0))+tick.get(i).unwrap_or(&0.0)*0.22*force.min(1.0);
 }
 let k=force/peak(&out).max(1e-9);let n=out.len();for (i,v) in out.iter_mut().enumerate(){*v*=k*((n-i) as f64/240.0).min(1.0);}out
}
/// Stick-slip friction: an irregular pressure gates noise, and every slip is a sharp micro-onset
/// coloured by the rubbed material. `slips` per second at full pressure.
fn scrape(r:&Rng,dur:f64,material:usize,pitch:f64,slips:f64,lo:f64,hi:f64)->Vec<f64>{
 let m=mat(material);let n=len_of(dur);let mut src=vec![0.0;n];
 let mut press=Bq::lp(7.0,0.6);for _ in 0..2400{press.run(r.next());}
 let mut slip=0.0;let mut gate=0.0;
 for (i,v) in src.iter_mut().enumerate(){
  let t=i as f64/RATE;let p=(press.run(r.next())*30.0).abs().min(1.6);
  let edge=(t/0.012).min(1.0)*((dur-t)/0.03).clamp(0.0,1.0);
  gate+=((p*edge)-gate)*0.004;
  if r.unit()<slips*gate/RATE{slip=0.5+r.unit();}
  slip*=0.9975;
  *v=r.next()*(0.18*gate+slip*gate.sqrt());
 }
 let mut lo_f=Bq::hp(lo,0.7);let mut hi_f=Bq::lp(hi,0.7);let mut out:Vec<f64>=src.iter().map(|x|hi_f.run(lo_f.run(*x))).collect();
 let mut tone=vec![0.0;n];
 for (k,&ratio) in m.ratios.iter().take(6).enumerate(){resonate(&mut tone,&src,m.f0*pitch*ratio*r.around(0.03),0.012/(1.0+k as f64*0.3),1.0/(1.0+k as f64));}
 let tone=normalized(tone);let base=peak(&out).max(1e-9);
 for (o,t) in out.iter_mut().zip(&tone){*o=*o/base+t*0.45;}
 normalized(out)
}
/// Leaves, paper, soil: sharp-onset grains, each a little filtered crackle.
fn rustle(r:&Rng,dur:f64,rate:f64,lo:f64,hi:f64,shape:fn(f64)->f64)->Vec<f64>{
 let n=len_of(dur);let mut out=vec![0.0;n];let count=(dur*rate) as usize;
 for _ in 0..count{
  let at=r.unit();let amp=shape(at)*(0.12+0.88*r.unit().powi(3));if amp<0.01{continue;}
  let decay=0.0008+0.004*r.unit();let hz=lo*(hi/lo).powf(r.unit());let mut f=Bq::bp(hz,1.4);
  let start=(at*dur*RATE) as usize;
  let mut d=Fade::new(decay);
  for (i,o) in out.iter_mut().skip(start).take(len_of(decay*6.0)).enumerate(){let t=i as f64/RATE;*o+=f.run(r.next())*amp*(t/0.0002).min(1.0)*d.next();}
 }
 Bq::lp(hi*1.15,0.7).apply(&mut out);normalized(out)
}
/// A creak: irregular slips exciting short wooden modes.
fn creak(r:&Rng,dur:f64,from:f64,to:f64,pitch:f64)->Vec<f64>{
 let n=len_of(dur);let mut exc=vec![0.0;n];let mut t=0.0;
 while t<dur{let x=t/dur;let i=(t*RATE) as usize;if i<n{exc[i]=(PI*x).sin()*(0.4+0.6*r.unit());}t+=r.around(0.3)/(from+(to-from)*x);}
 let m=mat(WOOD);let mut out=vec![0.0;n];
 for (k,&ratio) in m.ratios.iter().take(8).enumerate(){resonate(&mut out,&exc,330.0*pitch*ratio*r.around(0.04),0.02/(1.0+k as f64*0.4),1.0/(1.0+k as f64*0.5));}
 normalized(out)
}
/// Air pushed out of a closing book or lid: low-passed noise with a quick rise.
fn puff(r:&Rng,dur:f64,hz:f64)->Vec<f64>{
 let mut f=Bq::lp(hz,0.7);let mut h=Bq::hp(180.0,0.7);
 let mut d=Fade::new(dur*0.3);
 normalized((0..len_of(dur)).map(|i|{let t=i as f64/RATE;h.run(f.run(r.next()))*(t/0.004).min(1.0)*d.next()}).collect())
}
fn hump(x:f64)->f64{(PI*x).sin()}
fn early(x:f64)->f64{(1.0-x).powi(2)}
fn rise(x:f64)->f64{x}
/// A small, soft room: a few reflections and a short damped tail.
fn room(x:&mut[f64],wet:f64){
 let n=x.len();let mut send=x.to_vec();Bq::hp(240.0,0.7).apply(&mut send);Bq::lp(2600.0,0.7).apply(&mut send);
 let mut out=vec![0.0;n];
 for (ms,g) in [(3.7,0.4),(6.3,0.28),(9.1,0.2)]{let d=(ms*0.001*RATE) as usize;for i in d..n{out[i]+=send[i-d]*g;}}
 for ms in [11.3,13.9,16.7,19.1]{
  let d=(ms*0.001*RATE) as usize;let fb=10f64.powf(-3.0*ms*0.001/0.28);let mut line=vec![0.0;d];let (mut z,mut at)=(0.0,0);
  for i in 0..n{let y=line[at];z+=0.4*(y-z);line[at]=send[i]+z*fb;at+=1;if at==d{at=0;}out[i]+=y*0.22;}
 }
 for (ms,g) in [(4.3,0.6),(1.7,0.6)]{
  let d=(ms*0.001*RATE) as usize;let mut line=vec![0.0;d];let mut at=0;
  for v in out.iter_mut(){let delayed=line[at];let y=-g**v+delayed;line[at]=*v+g*y;at+=1;if at==d{at=0;}*v=y;}
 }
 for (o,w) in x.iter_mut().zip(out){*o+=w*wet;}
}
const TARGET:f64=0.09;
/// Shapes the top, trims the tail, fades both ends to exact zero and sets loudness: the short-term
/// RMS (40 ms) in the 250 Hz-4.5 kHz band a phone can play is `weight` x TARGET.
fn finish(mut x:Vec<f64>,weight:f64,top:f64)->Vec<f32>{
 Bq::hp(90.0,0.707).apply(&mut x);Bq::peak(380.0,0.8,1.5).apply(&mut x);Bq::lp(top,0.6).apply(&mut x);
 let p=peak(&x);if p<1e-9{return Vec::new();}
 let mut e=0.0;let mut last=0;for (i,v) in x.iter().enumerate(){e=v.abs().max(e*0.9985);if e>p*0.0025{last=i;}}
 let fade=len_of(0.035);let end=(last+fade).min(x.len());x.truncate(end);
 let tail=fade.min(end/3).max(1);for i in 0..tail{x[end-1-i]*=0.5-0.5*(PI*i as f64/tail as f64).cos();}
 for i in 0..12.min(end){x[i]*=0.5-0.5*(PI*i as f64/12.0).cos();}
 let mut band=x.clone();Bq::hp(250.0,0.7).apply(&mut band);Bq::lp(4500.0,0.7).apply(&mut band);
 let w=len_of(0.04);let mut acc=0.0;let mut loud:f64=0.0;
 for i in 0..band.len(){acc+=band[i]*band[i];if i>=w{acc-=band[i-w]*band[i-w];}loud=loud.max((acc.max(0.0)/w as f64).sqrt());}
 let k=(TARGET*weight/loud.max(1e-9)).min(0.82/peak(&x));
 let mut out:Vec<f32>=x.iter().map(|v|(v*k) as f32).collect();
 if let Some(v)=out.first_mut(){*v=0.0;}if let Some(v)=out.last_mut(){*v=0.0;}out
}
fn level_force(level:u32)->f64{match level{0=>0.4,2=>1.0,_=>0.7}}
fn level_weight(level:u32)->f64{match level{0=>0.72,2=>1.0,_=>0.86}}
/// Lamp parts: (base, body/shade, pitch). 0 MITTLED aluminium puck with an opal diffuser,
/// 1 tripod: oak legs and a linen drum shade, 2 TÄRNABY: black steel and brass round a glass chimney.
fn lamp(id:u32)->(usize,usize,f64){match id{0=>(ALUMINIUM,PLASTIC,1.0),1=>(OAK,LINEN,1.0),_=>(METAL,GLASS,0.9)}}
/// Pots: (material, pitch, has a saucer).
fn pot(id:u32)->(usize,f64,bool){match id{1=>(TERRACOTTA,0.95,true),2=>(ZINC,0.9,false),3=>(STONEWARE,0.85,false),4=>(CERAMIC,1.25,false),_=>(CERAMIC,1.0,false)}}
fn surface(material:u32)->usize{material.min(5) as usize}
pub fn render(kind:u32,material:u32,variant:u32,level:u32)->Vec<f32>{
 if kind>=KINDS{return Vec::new();}
 let v=variant%3;let level=level.min(2);
 let r=&Rng::new(kind.wrapping_mul(0x01f3_5a17)^material.wrapping_mul(0x2c1b_3c6d)^v.wrapping_mul(0x297a_2d39)^level.wrapping_mul(0x0b5a_d4ec));
 let size=1.0+(v as f64-1.0)*0.04;let force=level_force(level);let weight=level_weight(level);
 match kind{
  0=>{ // a book lifted: fingers on the cover, a short rub against its neighbours, a soft release
   let mut b=Mix::new(0.45);b.add(0.0,&strike(r,LINEN,1.1*size,0.35),0.5);
   b.add(0.015,&scrape(r,0.16,PAPER,size,90.0,500.0,2400.0),0.35);b.add(0.16,&strike(r,PAPER,1.15,0.25),0.3);
   room(&mut b.0,0.14);finish(b.0,0.7,4200.0)}
  1=>{ // a cover opens: the spine gives, pages fan, the cover lands on the table side
   let mut b=Mix::new(0.62);b.add(0.0,&creak(r,0.16,90.0,160.0,1.1*size),0.22);
   b.add(0.07,&rustle(r,0.26,150.0,900.0,3300.0,hump),0.4);b.add(0.28,&puff(r,0.07,700.0),0.18);
   b.add(0.3,&strike(r,LINEN,0.95*size,0.35),0.6);b.add(0.303,&strike(r,PAPER,0.9,0.3),0.35);
   room(&mut b.0,0.15);finish(b.0,0.8,4200.0)}
  2=>{ // a generic switch: press and release of a small plastic rocker
   let mut b=Mix::new(0.3);b.add(0.0,&strike(r,PLASTIC,size,0.7),0.8);b.add(0.05,&strike(r,PLASTIC,1.2*size,0.45),0.45);
   room(&mut b.0,0.12);finish(b.0,0.7,4500.0)}
  3=>{ // a book hits something: the surface answers, the book's own cover thuds underneath
   let m=surface(material);let mut b=Mix::new(0.5);b.add(0.0,&strike(r,m,size,force),1.0);
   if m!=PAPER&&m!=LINEN{b.add(0.0015,&strike(r,LINEN,0.95,force*0.6),0.4);}
   room(&mut b.0,0.13);finish(b.0,weight,if m==GLASS{6500.0}else{4500.0})}
  4=>{ // a book dragged along a board
   let m=if material==1{METAL}else{WOOD};let mut b=Mix::new(0.34);b.add(0.0,&scrape(r,0.32,m,size,110.0,280.0,if m==METAL{2800.0}else{2200.0}),1.0);
   room(&mut b.0,0.1);finish(b.0,0.55,3800.0)}
  5=>{ // a book set down: cover slap, the surface answers, a breath of air
   let m=surface(material);let mut b=Mix::new(0.5);b.add(0.0,&strike(r,LINEN,size,force*0.85),0.7);
   b.add(0.003,&strike(r,m,size,force*0.75),0.8);b.add(0.0,&puff(r,0.06,550.0),0.2);
   room(&mut b.0,0.14);finish(b.0,0.85*weight,if m==GLASS{6000.0}else{4300.0})}
  6|7=>{ // each lamp has its own switch; lighting adds a soft noise bloom and a faint glassy tick
   let on=kind==6;let mut b=Mix::new(0.42);
   match material{
    0=>{b.add(0.0,&strike(r,PLASTIC,1.25*size,0.7),0.7);b.add(0.002,&strike(r,ALUMINIUM,1.5,0.2),0.18);b.add(if on{0.07}else{0.06},&strike(r,PLASTIC,1.4*size,0.4),0.4);}
    1=>{let mut at=0.0;for i in 0..6{b.add(at,&strike(r,BRASS,2.2*r.around(0.08),0.15+0.1*r.unit()),0.25*(1.0-i as f64*0.1));at+=0.008+0.014*r.unit();}
     b.add(0.11,&strike(r,PLASTIC,0.9*size,0.65),0.65);b.add(0.112,&strike(r,OAK,1.0,0.25),0.25);}
    _=>{b.add(0.0,&strike(r,BRASS,1.5*size,0.35),0.4);b.add(0.028,&strike(r,BRASS,1.6*size,0.3),0.32);b.add(0.06,&strike(r,METAL,1.3*size,0.6),0.6);b.add(0.064,&strike(r,GLASS,1.2,0.12),0.18);}
   }
   if on{let at=if material==1{0.13}else{0.08};b.add(at,&bloom(r,0.18),0.09);b.add(at+0.01,&strike(r,GLASS,1.4,0.1),0.06);}
   room(&mut b.0,0.15);finish(b.0,0.72,4800.0)}
  8=>{ // a lamp dragged on the shelf
   let (base,part,p)=lamp(material);let mut b=Mix::new(0.38);
   match material{
    1=>{for (i,at) in [0.0,0.025,0.05].iter().enumerate(){b.add(*at,&scrape(r,0.26,OAK,p*r.around(0.06),120.0,300.0,2200.0),0.6-0.12*i as f64);}
     b.add(0.04,&rustle(r,0.25,60.0,500.0,1800.0,hump),0.18);}
    _=>{b.add(0.0,&scrape(r,0.34,base,p*size,110.0,300.0,2500.0),1.0);
     if material==2{for at in [0.07+0.05*r.unit(),0.2+0.06*r.unit()]{b.add(at,&strike(r,part,1.15,0.12),0.15);}}}
   }
   room(&mut b.0,0.11);finish(b.0,0.55,4000.0)}
  9=>{ // a lamp set down: its foot lands, the shelf answers, its parts settle
   let (base,part,p)=lamp(material);let mut b=Mix::new(0.55);
   match material{
    1=>{for (i,at) in [0.0,0.016+0.008*r.unit(),0.03+0.012*r.unit()].iter().enumerate(){b.add(*at,&strike(r,OAK,p*r.around(0.05),force*(1.0-0.2*i as f64)),0.7);}
     b.add(0.0,&strike(r,WOOD,1.0,force*0.6),0.45);b.add(0.045,&strike(r,LINEN,0.9,force*0.3),0.3);b.add(0.05,&rustle(r,0.18,70.0,500.0,1800.0,early),0.12);}
    _=>{b.add(0.0,&strike(r,base,p*size,force),0.9);b.add(0.002,&strike(r,WOOD,1.05,force*0.55),0.45);
     b.add(0.04+0.02*r.unit(),&strike(r,part,1.1,force*0.25),0.25);if material==2{b.add(0.075,&strike(r,BRASS,1.4,force*0.18),0.15);}}
   }
   room(&mut b.0,0.14);finish(b.0,0.85*weight,if material==2{5500.0}else{4500.0})}
  10=>{ // a lamp falls: it tips, hits, bounces irregularly over its parts and rattles to rest
   let (base,part,p)=lamp(material);let mut b=Mix::new(0.625);
   b.add(0.0,&scrape(r,0.07,if material==1{OAK}else{base},p,160.0,300.0,2200.0),0.25);
   let mut at=0.06+0.02*r.unit();let mut f=1.0;let mut gap=0.1+0.05*r.unit();
   for i in 0..5{
    let m=match (material,i%3){(1,0)=>LINEN,(1,_)=>OAK,(_,1)=>part,_=>base};
    b.add(at,&strike(r,m,p*r.around(0.06),f),f.max(0.3));
    b.add(at+0.003+0.01*r.unit(),&strike(r,WOOD,1.0,f*0.5),0.45*f);
    if material==1{b.add(at+0.012,&strike(r,OAK,1.2*r.around(0.08),f*0.5),0.4*f);}
    at+=gap;gap*=0.45+0.3*r.unit();f*=0.4+0.25*r.unit();
   }
   // the last wobble or roll: quick settling clicks
   let mut t=at;let mut g=0.03;let mut a=0.22;while t<0.56&&a>0.03{b.add(t,&strike(r,base,p*1.1,a),a);t+=g;g*=0.75;a*=0.82;}
   room(&mut b.0,0.16);finish(b.0,1.05,if material==2{5500.0}else{4500.0})}
  11=>{ // a pot pushed: its foot scrapes, the leaves shiver
   let (m,p,_)=pot(material);let mut b=Mix::new(0.38);b.add(0.0,&scrape(r,0.34,m,p*size,100.0,280.0,2300.0),0.9);
   b.add(0.02,&rustle(r,0.3,70.0,700.0,2800.0,hump),0.2);room(&mut b.0,0.11);finish(b.0,0.55,4000.0)}
  12=>{ // a pot set down: clunk, the shelf answers, soil and leaves settle
   let (m,p,saucer)=pot(material);let mut b=Mix::new(0.55);b.add(0.0,&strike(r,m,p*size,force),0.9);
   b.add(0.002,&strike(r,WOOD,0.95,force*0.6),0.5);if saucer{b.add(0.009+0.006*r.unit(),&strike(r,TERRACOTTA,1.35,force*0.5),0.4);}
   b.add(0.01,&rustle(r,0.12,200.0,300.0,1500.0,early),0.12);b.add(0.04,&rustle(r,0.25,80.0,700.0,2800.0,early),0.15);
   room(&mut b.0,0.14);finish(b.0,0.85*weight,4500.0)}
  13=>{ // a pot falls: heavy irregular bounces, soil spills, leaves thrash
   let (m,p,saucer)=pot(material);let mut b=Mix::new(0.625);
   b.add(0.0,&rustle(r,0.1,90.0,700.0,2600.0,rise),0.18);
   let mut at=0.07+0.02*r.unit();let mut f=1.0;let mut gap=0.11+0.04*r.unit();
   for i in 0..4{b.add(at,&strike(r,if saucer&&i==1{TERRACOTTA}else{m},p*r.around(0.05),f),f.max(0.35));b.add(at+0.003,&strike(r,WOOD,0.95,f*0.6),0.5*f);
    at+=gap;gap*=0.45+0.25*r.unit();f*=0.4+0.2*r.unit();}
   b.add(0.09,&rustle(r,0.45,320.0,300.0,1600.0,early),0.3);b.add(0.08,&rustle(r,0.35,90.0,700.0,2800.0,early),0.2);
   room(&mut b.0,0.15);finish(b.0,1.05,4500.0)}
  14=>{let mut b=Mix::new(0.45);b.add(0.0,&rustle(r,0.4,170.0,650.0,3000.0,hump),1.0);room(&mut b.0,0.1);finish(b.0,0.5,3800.0)}
  15=>{ // into the bin: paper crumple, then a hollow plastic thud
   let mut b=Mix::new(0.55);b.add(0.0,&rustle(r,0.18,320.0,800.0,3400.0,hump),0.5);
   b.add(0.15,&strike(r,PLASTIC,0.42*size,0.7),0.8);b.add(0.152,&strike(r,PAPER,0.9,0.5),0.4);
   room(&mut b.0,0.18);finish(b.0,0.8,4200.0)}
  16=>{ // a book back on its shelf: firm landing, then it leans on its neighbours
   let m=surface(material);let mut b=Mix::new(0.5);b.add(0.0,&strike(r,m,size,0.75),0.8);b.add(0.001,&strike(r,LINEN,1.0,0.5),0.5);
   b.add(0.04+0.015*r.unit(),&strike(r,PAPER,1.05,0.3),0.35);room(&mut b.0,0.14);finish(b.0,0.85,if m==GLASS{6000.0}else{4300.0})}
  17=>{ // pulled out of the row: a rub that speeds up, release, neighbours settle
   let mut b=Mix::new(0.55);b.add(0.0,&scrape(r,0.3,PAPER,size,140.0,450.0,2600.0),0.6);
   b.add(0.29,&puff(r,0.05,800.0),0.2);b.add(0.34,&strike(r,PAPER,0.95,0.25),0.3);b.add(0.39+0.03*r.unit(),&strike(r,PAPER,1.0,0.18),0.2);
   room(&mut b.0,0.13);finish(b.0,0.65,4000.0)}
  18=>{ // slid back into the row: a rub and a soft thock against the back
   let mut b=Mix::new(0.5);b.add(0.0,&scrape(r,0.27,PAPER,size,130.0,450.0,2600.0),0.55);
   b.add(0.26,&strike(r,WOOD,1.1,0.45),0.6);b.add(0.262,&strike(r,PAPER,1.0,0.35),0.4);room(&mut b.0,0.14);finish(b.0,0.7,4200.0)}
  19=>{ // a cover closes: air is pressed out, a papery clap
   let mut b=Mix::new(0.42);b.add(0.0,&rustle(r,0.06,200.0,900.0,3000.0,rise),0.2);b.add(0.02,&puff(r,0.07,600.0),0.25);
   b.add(0.03,&strike(r,PAPER,0.95*size,0.6),0.8);b.add(0.032,&strike(r,LINEN,1.0,0.5),0.5);room(&mut b.0,0.15);finish(b.0,0.8,4200.0)}
  20=>{ // pages flutter: a run of single page flips
   let mut b=Mix::new(0.6);let mut at=0.0;let mut gap=0.06;
   while at<0.5{b.add(at,&rustle(r,0.035,700.0,800.0,3400.0,early),0.4+0.4*r.unit());at+=gap*r.around(0.3);gap=(gap*0.9).max(0.035);}
   room(&mut b.0,0.12);finish(b.0,0.6,4000.0)}
  21=>{ // a satin bookmark ribbon drawn across the page
   let mut b=Mix::new(0.3);b.add(0.0,&scrape(r,0.22,LINEN,1.6,60.0,1200.0,3600.0),0.6);b.add(0.22,&strike(r,LINEN,1.4,0.15),0.2);
   room(&mut b.0,0.1);finish(b.0,0.38,4200.0)}
  22=>{ // a lamp jiggled: its moving parts answer
   let (_,part,p)=lamp(material);let mut b=Mix::new(0.32);
   match material{1=>b.add(0.0,&creak(r,0.18,80.0,130.0,1.4),0.5),
    _=>{let mut at=0.0;for _ in 0..3{b.add(at,&strike(r,if material==0{PLASTIC}else{BRASS},1.5*p*r.around(0.05),0.3),0.5);at+=0.03+0.03*r.unit();}}}
   b.add(0.09,&strike(r,part,1.1,0.12),0.15);room(&mut b.0,0.12);finish(b.0,0.5,4500.0)}
  23=>{let mut b=Mix::new(0.4);b.add(0.0,&bloom(r,0.25),0.5);b.add(0.02,&strike(r,GLASS,1.3+0.1*material as f64,0.12),0.25);room(&mut b.0,0.15);finish(b.0,0.35,5000.0)}
  24=>{ // a lamp knocks a book: the book's thud and the lamp's own part
   let (base,_,p)=lamp(material);let mut b=Mix::new(0.45);b.add(0.0,&strike(r,PAPER,size,force),0.8);
   b.add(0.001,&strike(r,base,p*1.05,force*0.6),0.55);room(&mut b.0,0.13);finish(b.0,weight*0.9,4500.0)}
  25=>{let mut b=Mix::new(0.4);b.add(0.0,&rustle(r,0.35,110.0,600.0,2600.0,early),1.0);room(&mut b.0,0.1);finish(b.0,0.42,3600.0)}
  26=>{let mut b=Mix::new(0.45);b.add(0.0,&rustle(r,0.4,380.0,280.0,1500.0,early),1.0);
   for _ in 0..3{let at=0.4*r.unit().powi(2);b.add(at,&strike(r,TERRACOTTA,2.2*r.around(0.1),0.12),0.18);}
   room(&mut b.0,0.1);finish(b.0,0.5,3600.0)}
  27=>{ // pot against pot: two bodies touch, then a lighter second touch
   let (m,p,_)=pot(material);let mut b=Mix::new(0.45);b.add(0.0,&strike(r,m,p*size,force*0.6),0.8);
   b.add(0.002,&strike(r,m,p*1.08,force*0.5),0.5);b.add(0.05+0.03*r.unit(),&strike(r,m,p,force*0.25),0.25);
   room(&mut b.0,0.13);finish(b.0,0.7*weight,5000.0)}
  28=>{ // the bin lid drops shut
   let mut b=Mix::new(0.42);b.add(0.0,&puff(r,0.06,500.0),0.2);b.add(0.05,&strike(r,PLASTIC,0.55*size,0.75),0.85);
   b.add(0.1+0.02*r.unit(),&strike(r,PLASTIC,0.6,0.25),0.25);room(&mut b.0,0.16);finish(b.0,0.75,4200.0)}
  29=>{let mut b=Mix::new(0.48);b.add(0.0,&creak(r,0.42,60.0,140.0,0.85*size),1.0);room(&mut b.0,0.16);finish(b.0,0.42,3600.0)}
  31..=34=>{ // soft airy whooshes: breath-like noise whose band drifts up (in, to isometric) or down (out, straight)
   let up=kind==31||kind==33;let dur=if kind>=33{0.5}else{0.3};let mut b=Mix::new(dur+0.12);
   b.add(0.0,&whoosh(r,dur*size,up),1.0);room(&mut b.0,0.18);finish(b.0,if kind>=33{0.45}else{0.38},4200.0)}
  _=>{ // 30 a soft tap under the finger
   let mut b=Mix::new(0.2);
   match material{1=>{b.add(0.0,&strike(r,WOOD,1.25,0.3),0.6);b.add(0.045,&strike(r,WOOD,1.1,0.22),0.4);}
    2=>{b.add(0.0,&strike(r,WOOD,1.25,0.25),0.45);b.add(0.045,&strike(r,WOOD,1.45,0.3),0.6);}
    _=>b.add(0.0,&strike(r,WOOD,1.4*size,0.3),0.7)}
   b.add(0.0,&strike(r,LINEN,1.2,0.3),0.35);room(&mut b.0,0.08);finish(b.0,0.38,4000.0)}
 }
}
/// Air moving past: noise through a gentle band that drifts by about an octave, swelling and fading smoothly.
fn whoosh(r:&Rng,dur:f64,up:bool)->Vec<f64>{
 let n=len_of(dur);let mut out=vec![0.0;n];let (from,to):(f64,f64)=if up{(500.0,1300.0)}else{(1300.0,500.0)};
 let mut f=Bq::bp(from,0.8);let mut l=Bq::lp(3000.0,0.7);
 for (i,o) in out.iter_mut().enumerate(){
  let x=i as f64/n as f64;if i%32==0{let z=(f.z1,f.z2);f=Bq::bp(from*(to/from).powf(x),0.8);f.z1=z.0;f.z2=z.1;}
  *o=l.run(f.run(r.next()))*(PI*x).sin().powf(1.6);
 }
 normalized(out)
}
/// Light coming on: warm low-passed noise swelling and fading, no tone.
fn bloom(r:&Rng,dur:f64)->Vec<f64>{
 let mut f=Bq::bp(900.0,0.5);let mut l=Bq::lp(2000.0,0.7);
 normalized((0..len_of(dur)).map(|i|{let x=i as f64/(dur*RATE);l.run(f.run(r.next()))*(x/0.2).min(1.0)*(1.0-x).powi(2)}).collect())
}

#[cfg(test)]
mod tests{
 use super::*;
 fn all()->Vec<(u32,u32,u32,Vec<f32>)>{
  let mut out=Vec::new();
  for k in 0..KINDS{let mats=match k{3|5|16=>6,4=>2,6..=10|22|23|24=>3,11|12|13|27=>5,30=>3,_=>1};
   for m in 0..mats{for l in 0..3{out.push((k,m,l,render(k,m,0,l)));}}}
  out
 }
 #[test]fn every_sound_is_clean_and_balanced(){
  for (k,m,l,x) in all(){
   assert!(!x.is_empty()&&x.len()<=MAX_SAMPLES,"{k}/{m}/{l} len {}",x.len());
   assert!(x.iter().all(|v|v.is_finite()),"{k}/{m}");
   assert_eq!((x[0],*x.last().unwrap()),(0.0,0.0));
   let p=x.iter().fold(0.0f32,|a,v|a.max(v.abs()));assert!(p>0.05&&p<=0.83,"{k}/{m}/{l} peak {p}");
   let mean=x.iter().map(|v|*v as f64).sum::<f64>()/x.len() as f64;assert!(mean.abs()<0.004,"{k}/{m} dc {mean}");
   let rms=(x.iter().map(|v|(*v as f64).powi(2)).sum::<f64>()/x.len() as f64).sqrt();assert!(rms>0.004&&rms<0.2,"{k}/{m}/{l} rms {rms}");
  }
 }
 #[test]fn deterministic_and_variants_differ(){
  for k in 0..KINDS{assert_eq!(render(k,1,2,1),render(k,1,2,1));assert_ne!(render(k,1,0,1),render(k,1,1,1),"{k}");}
  assert_eq!(render(3,1,3,1),render(3,1,0,1));assert!(render(KINDS,0,0,0).is_empty());
 }
}
