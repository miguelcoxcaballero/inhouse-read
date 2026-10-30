//! The stable waviness profile of a board's reflection: three wave phases and an amplitude from the
//! book's identity (FNV-1a over the UTF-16 units of the seed, then a xorshift32 stream), in the
//! original operation order. The three.js uniforms that carry it stay in JavaScript.
use wasm_bindgen::prelude::*;
use js_sys::JsString;
use crate::host::absent;

#[wasm_bindgen]
extern "C"{#[wasm_bindgen(js_name=String)]fn string_of(value:&JsValue)->JsString;}

/// FNV-1a over the UTF-16 units of `String(seed ?? '')`, from `state`. A string without U+FFFD crosses once
/// (as UTF-8) and is hashed here; one that has it, or a lone surrogate the crossing would have replaced by it,
/// is read unit by unit, so both hash the units the engine holds.
pub(crate) fn utf16_fnv(seed:&JsValue,mut state:u32)->u32{
 let text=if absent(seed){JsString::from("")}else if seed.is_string(){seed.clone().unchecked_into()}else{string_of(seed)};
 if let Some(utf8)=text.as_string(){
  if !utf8.contains('\u{FFFD}'){for unit in utf8.encode_utf16(){state=(state^u32::from(unit)).wrapping_mul(16777619);}return state;}
 }
 for i in 0..text.length(){state=(state^(text.char_code_at(i) as u32)).wrapping_mul(16777619);}
 state
}
fn profile_of(seed:&JsValue)->[f64;4]{
 let mut state=utf16_fnv(seed,2166136261u32);
 let mut random=||->f64{state^=state<<13;state^=state>>17;state^=state<<5;f64::from(state)/4294967296.0};
 let tau=std::f64::consts::PI;
 let (x,y,z)=(random()*tau*2.0,random()*tau*2.0,random()*tau*2.0);
 [x,y,z,0.88+random()*0.24]
}
/// `[phaseX, phaseY, phaseZ, amplitude]` for `String(seed ?? '')`.
#[wasm_bindgen]
pub fn reflection_profile(seed:&JsValue)->Vec<f64>{profile_of(seed).to_vec()}

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

// ---- the layer on a material ---------------------------------------------------------------------------
// `applyBookReflectionSurface` (src/js/book-reflection-surface.js) creates the uniforms from reflection_setup's
// numbers in one crossing; its controls and shader hook are this module's functions bound to one plain state
// object `r` (the uniforms, the profile's amplitude and the slope), so nothing here holds a handle.
use wasm_bindgen::JsCast;
use js_sys::{Array,Function,Object,Reflect};
type R<T>=Result<T,JsValue>;
fn k(name:&'static str)->&'static str{wasm_bindgen::intern(name)}
fn read(v:&JsValue,name:&'static str)->R<JsValue>{crate::host::read(v,k(name))}
fn put(v:&JsValue,name:&'static str,x:&JsValue)->R<()>{crate::host::set(v,k(name),x)}
fn call(v:&JsValue,name:&'static str,args:&[&JsValue])->R<JsValue>{crate::host::method(v,k(name),args)}
fn bind(function:&JsValue,args:&[&JsValue])->R<JsValue>{
 let list=Array::new();list.push(&JsValue::NULL);for a in args{list.push(a);}
 Reflect::apply(read(function,"bind")?.unchecked_ref(),function,&list)
}
fn make(three:&JsValue,class:&'static str,args:&[f64])->R<JsValue>{
 Reflect::construct(read(three,class)?.unchecked_ref(),&args.iter().map(|&x|JsValue::from_f64(x)).collect::<Array>())
}
fn uniform(r:&JsValue,name:&'static str)->R<JsValue>{read(&read(r,"uniforms")?,name)}
/// The starting numbers of a layer, in one call (src/js/book-reflection-surface.js creates its uniforms and
/// controls from them): the seed's phases x, y, z and amplitude, the slope, the environment share and the UV
/// scale x, y, each as the matching setter computes it.
#[wasm_bindgen]
pub fn reflection_setup(out:&mut [f64],seed:&JsValue,strength:&JsValue,environment:&JsValue,uv_scale:&JsValue)->R<()>{
 if out.len()<8{return Err(js_sys::RangeError::new("reflection_setup needs 8 numbers").into());}
 out[..4].copy_from_slice(&profile_of(seed));
 out[4]=reflection_slope(strength);
 out[5]=reflection_environment(environment);
 let scale=reflection_uv_scale(uv_scale)?;
 out[6]=scale[0];out[7]=scale[1];
 Ok(())
}
#[wasm_bindgen]
pub fn book_reflection_set_environment(r:&JsValue,value:&JsValue)->R<()>{
 put(&uniform(r,"bookEnvironmentReflection")?,"value",&JsValue::from_f64(reflection_environment(value)))
}
#[wasm_bindgen]
pub fn book_reflection_set_strength(r:&JsValue,value:&JsValue)->R<()>{
 let slope=reflection_slope(value);put(r,"slope",&JsValue::from_f64(slope))?;
 put(&uniform(r,"bookReflectionStrength")?,"value",&JsValue::from_f64(slope*crate::host::num(&read(r,"amplitude")?)))
}
#[wasm_bindgen]
pub fn book_reflection_set_seed(r:&JsValue,value:&JsValue)->R<()>{
 let profile=profile_of(value);
 let phase=make(&read(r,"three")?,"Vector3",&profile[..3])?;
 put(r,"amplitude",&JsValue::from_f64(profile[3]))?;
 call(&read(&uniform(r,"bookReflectionPhase")?,"value")?,"copy",&[&phase])?;
 put(&uniform(r,"bookReflectionStrength")?,"value",&JsValue::from_f64(crate::host::num(&read(r,"slope")?)*profile[3]))
}
#[wasm_bindgen]
pub fn book_reflection_set_uv_scale(r:&JsValue,value:&JsValue)->R<()>{
 let scale=reflection_uv_scale(value)?;
 call(&read(&uniform(r,"bookReflectionUvScale")?,"value")?,"set",&[&JsValue::from_f64(scale[0]),&JsValue::from_f64(scale[1])])?;Ok(())
}
/// The material's `onBeforeCompile`: the earlier hook first, then the layer's uniforms and its patched sources,
/// remembered per distinct sources (and chunks) so a shelf of books compiles each variant with one patch.
#[wasm_bindgen]
pub fn book_reflection_compile(host:&JsValue,r:&JsValue,material:&JsValue,before:&JsValue,shader:&JsValue,renderer:&JsValue)->R<()>{
 let before=before.dyn_ref::<Function>().ok_or_else(||JsValue::from(js_sys::TypeError::new("beforeCompile.call is not a function")))?;
 Reflect::apply(before,material,&[shader.clone(),renderer.clone()].iter().collect::<Array>())?;
 Object::assign(read(shader,"uniforms")?.unchecked_ref(),read(r,"uniforms")?.unchecked_ref());
 let (vertex,fragment)=(read(shader,"vertexShader")?,read(shader,"fragmentShader")?);
 let patch=bind(&read(&read(host,"rust")?,"book_reflection_shaders")?,&[&vertex,&fragment,&read(host,"physicalChunk")?,&read(host,"mapsChunk")?])?;
 let sources:JsValue=[vertex,fragment].iter().collect::<Array>().into();
 let patched=crate::host::call(&read(host,"rememberedPatch")?,"rememberedPatch",&[&read(host,"patches")?,&sources,&patch])?;
 put(shader,"vertexShader",&crate::host::get_at(&patched,0))?;put(shader,"fragmentShader",&crate::host::get_at(&patched,1))?;
 Ok(())
}
