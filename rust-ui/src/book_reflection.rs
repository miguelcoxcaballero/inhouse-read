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

fn finite_number(value: &JsValue) -> Option<f64> { let number = crate::host::num(value); number.is_finite().then_some(number) }

/// How much of the environment a cover reflects: `Number(value)` within `[0, 1]`, 1 when not finite.
#[wasm_bindgen]
pub fn reflection_environment(value: &JsValue) -> f64 { finite_number(value).map_or(1.0, |n| crate::host::jmax(0.0, crate::host::jmin(1.0, n))) }

/// The dimensionless slope of the waviness: `Number(value)` within `[0, .05]`, 0 when not finite (`.018` cover,
/// `.014` binding, `.010` cap; 0 is the uniform-only A/B).
#[wasm_bindgen]
pub fn reflection_slope(value: &JsValue) -> f64 { finite_number(value).map_or(0.0, |n| crate::host::jmin(0.05, crate::host::jmax(0.0, n))) }

/// The UV scale of one wave field per surface: `Number(value?.[0] ?? value?.x)` and the same for y, each 1
/// unless finite and positive (unnormalised cap UVs).
#[wasm_bindgen]
pub fn reflection_uv_scale(value: &JsValue) -> Result<Vec<f64>, JsValue> {
    let axis = |index: &str, name: &str| -> Result<f64, JsValue> {
        let read = |key: &str| -> Result<JsValue, JsValue> { if absent(value) { Ok(JsValue::UNDEFINED) } else { crate::host::read(value, key) } };
        let first = read(index)?;
        let chosen = if absent(&first) { read(name)? } else { first };
        let number = crate::host::num(&chosen);
        Ok(if number.is_finite() && number > 0.0 { number } else { 1.0 })
    };
    let x = axis("0", "x")?;
    let y = axis("1", "y")?;
    Ok(vec![x, y])
}
