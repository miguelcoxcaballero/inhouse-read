//! The stable waviness profile of a board's reflection: three wave phases and an amplitude from the
//! book's identity (FNV-1a over the UTF-16 units of the seed, then a xorshift32 stream), in the
//! original operation order. The three.js uniforms that carry it stay in JavaScript.
use wasm_bindgen::prelude::*;
use js_sys::JsString;
use crate::host::absent;

#[wasm_bindgen]
extern "C"{#[wasm_bindgen(js_name=String)]fn string_of(value:&JsValue)->JsString;}

/// `[phaseX, phaseY, phaseZ, amplitude]` for `String(seed ?? '')`.
#[wasm_bindgen]
pub fn reflection_profile(seed:&JsValue)->Vec<f64>{
 let text=if absent(seed){JsString::from("")}else{string_of(seed)};
 let mut state=2166136261u32;
 for i in 0..text.length(){state=(state^(text.char_code_at(i) as u32)).wrapping_mul(16777619);}
 let mut random=||->f64{state^=state<<13;state^=state>>17;state^=state<<5;f64::from(state)/4294967296.0};
 let tau=std::f64::consts::PI;
 let (x,y,z)=(random()*tau*2.0,random()*tau*2.0,random()*tau*2.0);
 vec![x,y,z,0.88+random()*0.24]
}
