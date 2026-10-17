//! Short, deterministic foley. No running oscillator, audio thread or network
//! asset survives a sound. The host caches these PCM variants and sleeps its
//! AudioContext between interactions.
struct Mode{a:f64,b:f64,y:f64,z:f64,gain:f64}
impl Mode{
 fn new(hz:f64,decay:f64,gain:f64,rate:f64)->Self{
  let angle=std::f64::consts::TAU*hz/rate;let r=(-1.0/(rate*decay)).exp();
  Self{a:2.0*r*angle.cos(),b:r*r,y:0.0,z:-angle.sin()/r,gain}
 }
 fn tick(&mut self)->f64{let next=self.a*self.y-self.b*self.z;self.z=self.y;self.y=next;next*self.gain}
}
fn noise(seed:&mut u32)->f64{*seed^=*seed<<13;*seed^=*seed>>17;*seed^=*seed<<5;*seed as f64/2147483648.0-1.0}
fn pulse(t:f64,start:f64,duration:f64)->f64{let q=(t-start)/duration;if !(0.0..1.0).contains(&q){0.0}else{q*(1.0-q).powi(3)*9.48}}
/// 0 cloth/paper pickup, 1 opening, 2 switch, 3 material-dependent book impact.
/// Material: 0 paper, 1 wood, 2 metal, 3 glass, 4 ceramic, 5 linen.
pub fn synth(out:&mut[f32],kind:u32,material:u32,variant:u32,rate:f64){
 out.fill(0.0);if !(16000.0..=96000.0).contains(&rate)||out.len()>96000{return;}
 let mut seed=0x91e1_0da5_u32.wrapping_add(variant.wrapping_mul(0x9e37_79b9)).max(1);
 let jitter=1.0+noise(&mut seed)*0.018;
 let surface:&[(f64,f64,f64)]=match material{
  1=>&[(172.0,0.065,0.16),(348.0,0.038,0.075),(706.0,0.022,0.025)],
  2=>&[(532.0,0.09,0.055),(1278.0,0.065,0.027),(2243.0,0.038,0.014),(3267.0,0.025,0.006)],
  3=>&[(823.0,0.11,0.045),(1667.0,0.075,0.024),(2903.0,0.045,0.012),(4091.0,0.03,0.004)],
  4=>&[(383.0,0.08,0.07),(917.0,0.06,0.036),(1793.0,0.035,0.014)],
  5=>&[(131.0,0.035,0.12),(237.0,0.025,0.04)],
  _=>&[(123.0,0.055,0.13),(249.0,0.035,0.035)]};
 let mut modes:Vec<Mode>=if kind==3{surface.iter().map(|&(f,d,g)|Mode::new(f*jitter,d,g,rate)).collect()}
  else if kind==2{vec![Mode::new(187.0*jitter,0.018,0.10,rate),Mode::new(1040.0*jitter,0.012,0.018,rate)]}
  else{vec![Mode::new(142.0*jitter,0.045,0.033,rate),Mode::new(267.0*jitter,0.024,0.012,rate)]};
 if kind==3{modes.push(Mode::new(137.0*jitter,0.065,0.16,rate));}
 let (mut low,mut body)=(0.0,0.0);
 let a=1.0-(-std::f64::consts::TAU*if material==5{1400.0}else{4200.0}/rate).exp();
 let b=1.0-(-std::f64::consts::TAU*250.0/rate).exp();
 let duration=out.len() as f64/rate;
 for (i,sample) in out.iter_mut().enumerate(){
  let t=i as f64/rate;low+=a*(noise(&mut seed)-low);body+=b*(low-body);let brush=low-body;
  let (paper,bass)=match kind{
   0=>(0.16*pulse(t,0.0,0.12)+0.04*pulse(t,0.035,0.10),1.0),
   1=>(0.12*pulse(t,0.005,0.30)+0.075*pulse(t,0.13,0.28)+0.035*pulse(t,0.29,0.15),0.65),
   2=>(0.14*pulse(t,0.0,0.018)+0.065*pulse(t,0.026,0.016),1.0),
   _=>(0.11*pulse(t,0.0,0.045),1.0)};
  let attack=(t/0.003).min(1.0);let fade=((duration-t)/0.025).clamp(0.0,1.0);
  let value=(paper*brush+bass*modes.iter_mut().map(Mode::tick).sum::<f64>())*attack*fade;
  *sample=(value/(1.0+value.abs()*0.7)) as f32;
 }
}

#[wasm_bindgen::prelude::wasm_bindgen]
pub fn cozy_sound(kind:u32,material:u32,variant:u32)->Vec<f32>{
 if kind>3||material>5{return Vec::new();}
 let length=match kind{0=>4320,1=>12000,2=>3840,_=>10800};
 let mut out=vec![0.0;length];synth(&mut out,kind,material,variant%3,24000.0);
 if let Some(last)=out.last_mut(){*last=0.0;}out
}
