//! Every lamp's switch fade and colour-temperature tint, in the entry arena. The host writes two
//! numbers per lamp when they may have changed (on or off, the temperature it asks for), a switch
//! or a temperature change is one call, and the pose call eases every lamp: what the host must
//! write to a model or a button comes back as bits. The arithmetic is the former
//! `scene_lamp_power` and the tint transition of `lamp-kelvin.js` (`tint_moment`, `tint_ease`,
//! `tint_mix` of the core), operation for operation.
use wasm_bindgen::prelude::*;
use crate::host::{jmax,jmin};
use crate::scene_view::{cl,ease};
use super::{RustSceneEntryFrame,STATE};

/// In: on or off, the temperature asked for. The fade: exists, `value, from, target, started,
/// duration`, the power last handed over. The tint: exists, its temperature, `from`, `to`,
/// `value` (three each), `started, duration`, the tint last handed over. Out: 1 the power is not
/// the one handed over, 2 the power changed in this frame, 4 the tint is not the one handed
/// over, 8 the tint is still easing, 16 the fade is.
pub(super) const ON:usize=91;const WANTED:usize=92;const FADE:usize=93;const POWER:usize=94;const POWER_HELD:usize=99;
const TINT:usize=100;const KELVIN:usize=101;const FROM:usize=102;const TO:usize=105;const VALUE:usize=108;
const STARTED:usize=111;const DURATION:usize=112;const TINT_HELD:usize=113;const OUT:usize=116;

/// `normalizeLampKelvin` and `lampTint`: the table is `[default, kelvin, r, g, b, ...]`.
fn wanted(tints:&[f64],kelvin:f64)->(f64,[f64;3]){
 let default=tints.first().copied().unwrap_or(2700.0);
 let (mut chosen,mut fallback)=(None,[1.0;3]);
 for row in tints.get(1..).unwrap_or(&[]).chunks_exact(4){
  if row[0]==kelvin{chosen=Some([row[1],row[2],row[3]]);}
  if row[0]==default{fallback=[row[1],row[2],row[3]];}
 }
 match chosen{Some(rgb)=>(kelvin,rgb),None=>(default,fallback)}
}
fn moving(row:&[f64])->bool{(0..3).any(|c|row[VALUE+c]!=row[TO+c])}
/// A tint's `set`: a new temperature eases from the shown tint, or is taken at once.
fn retint(row:&mut [f64],kelvin:f64,rgb:[f64;3],now:f64,animate:bool,ms:f64){
 if kelvin==row[KELVIN]{return;}
 row[KELVIN]=kelvin;row.copy_within(VALUE..VALUE+3,FROM);row[TO..TO+3].copy_from_slice(&rgb);
 row[STARTED]=now;row[DURATION]=if animate{ms}else{0.0};
 if !animate{row[VALUE..VALUE+3].copy_from_slice(&rgb);}
}
fn create_tint(row:&mut [f64],kelvin:f64,rgb:[f64;3]){
 row[TINT]=1.0;row[KELVIN]=kelvin;row[STARTED]=0.0;row[DURATION]=0.0;
 for at in [FROM,TO,VALUE]{row[at..at+3].copy_from_slice(&rgb);}
 row[TINT_HELD]=f64::NAN;
}

/// One frame of a lamp's row.
pub(super) fn step(row:&mut [f64],tints:&[f64],now:f64,reduced:bool){
 let target=if row[ON]!=0.0{1.0}else{0.0};
 if row[FADE]==0.0{
  row[FADE]=1.0;row[POWER]=target;row[POWER+1]=target;row[POWER+2]=target;row[POWER+3]=now;row[POWER+4]=0.0;row[POWER_HELD]=f64::NAN;
 }
 let (mut value,mut from,mut goal,mut started,mut duration)=(row[POWER],row[POWER+1],row[POWER+2],row[POWER+3],row[POWER+4]);
 if goal!=target{from=value;goal=target;started=now;duration=220.0;}
 let previous=value;
 let t=if reduced||duration==0.0||duration.is_nan(){1.0}else{cl((now-started)/duration,0.0,1.0)};
 value=from+(goal-from)*ease(t);
 row[POWER..POWER+5].copy_from_slice(&[value,from,goal,started,duration]);
 let mut out=u32::from(value.to_bits()!=row[POWER_HELD].to_bits())|u32::from(previous!=value)<<1|u32::from(t<1.0&&from!=goal)<<4;
 row[POWER_HELD]=value;
 let (kelvin,rgb)=wanted(tints,row[WANTED]);
 if row[TINT]==0.0{create_tint(row,kelvin,rgb);}
 if reduced{retint(row,kelvin,rgb,now,false,0.0);}
 if moving(row){
  let duration=row[DURATION];
  let moment=if duration!=0.0&&!duration.is_nan(){jmin(1.0,jmax(0.0,(now-row[STARTED])/duration))}else{1.0};
  let amount=if moment>=1.0{1.0}else if moment<0.5{2.0*moment*moment}else{let k=-2.0*moment+2.0;1.0-k*k/2.0};
  for c in 0..3{let (a,b)=(row[FROM+c],row[TO+c]);row[VALUE+c]=a+(b-a)*amount;}
  if moment<1.0{out|=8;}
 }
 if (0..3).any(|c|row[VALUE+c]!=row[TINT_HELD+c]){out|=4;row.copy_within(VALUE..VALUE+3,TINT_HELD);}
 row[OUT]=f64::from(out);
}

#[wasm_bindgen]
impl RustSceneEntryFrame{
 /// The temperatures a lamp can take and their tints, `[default, kelvin, r, g, b, ...]`, and how
 /// long a change eases (the host's table: its powers are the host's).
 #[wasm_bindgen(js_name=lampTints)]
 pub fn lamp_tints(&mut self,tints:&[f64],ms:f64){self.tints=tints.to_vec();self.tint_ms=ms;}
 /// A lamp's switch: its power eases from the one it shows (its fade, else `shown`: its
 /// light's, else its last state) to on or off, over 220 ms when `animate`, starting now.
 #[wasm_bindgen(js_name=lampSwitch)]
 pub fn lamp_switch(&mut self,index:usize,shown:f64,on:bool,animate:bool)->Result<(),JsValue>{
  let now=crate::host::clock()?;
  let Some(row)=self.state.chunks_exact_mut(STATE).nth(index) else{return Ok(());};
  let previous=if row[FADE]!=0.0{row[POWER]}else{shown};
  let target=f64::from(on);
  row[ON]=target;row[FADE]=1.0;
  row[POWER..POWER+5].copy_from_slice(&[previous,previous,target,now,if animate{220.0}else{0.0}]);
  Ok(())
 }
 /// A lamp's colour temperature: its tint (made on first use) eases there from now, or jumps.
 #[wasm_bindgen(js_name=lampKelvin)]
 pub fn lamp_kelvin(&mut self,index:usize,kelvin:f64,animate:bool)->Result<(),JsValue>{
  let now=crate::host::clock()?;
  let (wanted,rgb)=wanted(&self.tints,kelvin);
  let ms=self.tint_ms;
  let Some(row)=self.state.chunks_exact_mut(STATE).nth(index) else{return Ok(());};
  row[WANTED]=kelvin;
  if row[TINT]==0.0{create_tint(row,wanted,rgb);}
  retint(row,wanted,rgb,now,animate,ms);
  Ok(())
 }
 /// Whether a lamp still fades or changes tint at `now`. `strict` is the modal's question (a
 /// power that is not at its target counts); otherwise only a timed fade under way does.
 #[wasm_bindgen(js_name=lampsBusy)]
 pub fn lamps_busy(&self,now:f64,strict:bool)->bool{
  self.state.chunks_exact(STATE).any(|row|{
   if row[TINT]!=0.0&&moving(row){return true;}
   if row[FADE]==0.0{return false;}
   let (value,from,goal,started,duration)=(row[POWER],row[POWER+1],row[POWER+2],row[POWER+3],row[POWER+4]);
   let timed=from!=goal&&now<started+duration;
   if strict{value!=goal||timed}else{duration!=0.0&&!duration.is_nan()&&timed}
  })
 }
}
