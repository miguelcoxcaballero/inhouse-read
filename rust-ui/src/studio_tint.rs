//! The colour temperature of the lamp in the catalogue's studio, easing from the tint it shows to the
//! one asked for: the former `createTintTransition` of `lamp-kelvin.js` and the studio's "is this the
//! tint already applied" test, operation for operation (`tint_moment`, `tint_ease` and `tint_mix` of
//! the core). The state is the host's eighteen numbers: the temperature, `from`, `to`, `value` (three
//! each), `started`, `duration`, the tint last applied, 1 while nothing is applied yet, 1 once made, and 1
//! while a frame has something to do (the host does not call for a frame at rest).
use wasm_bindgen::prelude::*;
use crate::host::{jmax,jmin};
const FROM:usize=1;const TO:usize=4;pub(crate) const VALUE:usize=7;const STARTED:usize=10;const DURATION:usize=11;
pub(crate) const SHOWN:usize=12;pub(crate) const FRESH:usize=15;const MADE:usize=16;pub(crate) const BUSY:usize=17;

/// `normalizeLampKelvin` and `lampTint` over `[default, kelvin, r, g, b, ...]`.
fn wanted(tints:&[f64],kelvin:f64)->(f64,[f64;3]){
 let default=tints.first().copied().unwrap_or(2700.0);
 let (mut chosen,mut fallback)=(None,[1.0;3]);
 for row in tints.get(1..).unwrap_or(&[]).chunks_exact(4){
  if row[0]==kelvin{chosen=Some([row[1],row[2],row[3]]);}
  if row[0]==default{fallback=[row[1],row[2],row[3]];}
 }
 match chosen{Some(rgb)=>(kelvin,rgb),None=>(default,fallback)}
}
/// A new temperature eases (`ms`) from the tint shown now, or is taken at once; false when it is the one in
/// use. The first call makes the transition, at the default temperature.
#[wasm_bindgen]
pub fn studio_tint_set(state:&mut [f64],tints:&[f64],ms:f64,kelvin:f64,now:f64,animate:bool)->bool{
 if state.len()<=BUSY{return false}
 if state[MADE]==0.0{
  let (kelvin,rgb)=wanted(tints,f64::NAN);
  state[0]=kelvin;for at in [FROM,TO,VALUE]{state[at..at+3].copy_from_slice(&rgb);}
  state[STARTED]=0.0;state[DURATION]=0.0;state[FRESH]=1.0;state[MADE]=1.0;state[BUSY]=1.0;
 }
 let (target,rgb)=wanted(tints,kelvin);
 if target==state[0]{return false}
 state[0]=target;state.copy_within(VALUE..VALUE+3,FROM);state[TO..TO+3].copy_from_slice(&rgb);
 state[STARTED]=now;state[DURATION]=if animate{ms}else{0.0};
 if !animate{state[VALUE..VALUE+3].copy_from_slice(&rgb);}
 state[BUSY]=1.0;true
}
/// One frame. 1: still easing; 2: the tint is not the one applied (two tints are the same when they print
/// the same, as the texts the studio compared did).
#[wasm_bindgen]
pub fn studio_tint_step(state:&mut [f64],now:f64)->u32{
 if state.len()<=BUSY{return 0}
 let mut easing=false;
 if (0..3).any(|c|state[VALUE+c]!=state[TO+c]){
  let duration=state[DURATION];
  let moment=if duration!=0.0&&!duration.is_nan(){jmin(1.0,jmax(0.0,(now-state[STARTED])/duration))}else{1.0};
  let amount=if moment>=1.0{1.0}else if moment<0.5{2.0*moment*moment}else{let k=-2.0*moment+2.0;1.0-k*k/2.0};
  for c in 0..3{let (a,b)=(state[FROM+c],state[TO+c]);state[VALUE+c]=a+(b-a)*amount;}
  easing=moment<1.0;
 }
 let same=state[FRESH]==0.0&&(0..3).all(|c|{let (a,b)=(state[SHOWN+c],state[VALUE+c]);a==b||(a.is_nan()&&b.is_nan())});
 let code=u32::from(easing)|u32::from(!same)<<1;state[BUSY]=f64::from(u32::from(code!=0));code
}
