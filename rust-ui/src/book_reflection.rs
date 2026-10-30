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

// ---- installing the layer on a material ----------------------------------------------------------------
// `applyBookReflectionSurface(material, { seed = '', strength = .018, uvScale = [1, 1], environmentReflection = 1 } = {})`
// (src/js/book-reflection-surface.js). Its controls and shader hook are this module's functions bound to one
// plain state object `r` (the uniforms, the profile's amplitude and the slope), so nothing here holds a handle.
use wasm_bindgen::JsCast;
use js_sys::{Array,Function,Object,Reflect};
type R<T>=Result<T,JsValue>;
fn k(name:&'static str)->&'static str{wasm_bindgen::intern(name)}
fn get(v:&JsValue,name:&'static str)->JsValue{crate::host::get(v,k(name))}
fn read(v:&JsValue,name:&'static str)->R<JsValue>{crate::host::read(v,k(name))}
fn put(v:&JsValue,name:&'static str,x:&JsValue)->R<()>{crate::host::set(v,k(name),x)}
fn call(v:&JsValue,name:&'static str,args:&[&JsValue])->R<JsValue>{crate::host::method(v,k(name),args)}
fn object(fields:&[(&'static str,JsValue)])->R<JsValue>{let o:JsValue=Object::new().into();for(key,value)in fields{put(&o,key,value)?;}Ok(o)}
fn bind(function:&JsValue,args:&[&JsValue])->R<JsValue>{
 let list=Array::new();list.push(&JsValue::NULL);for a in args{list.push(a);}
 Reflect::apply(read(function,"bind")?.unchecked_ref(),function,&list)
}
fn own(host:&JsValue,name:&'static str,args:&[&JsValue])->R<JsValue>{bind(&read(&read(host,"rust")?,name)?,args)}
fn make(three:&JsValue,class:&'static str,args:&[f64])->R<JsValue>{
 Reflect::construct(read(three,class)?.unchecked_ref(),&args.iter().map(|&x|JsValue::from_f64(x)).collect::<Array>())
}
fn uniform(r:&JsValue,name:&'static str)->R<JsValue>{read(&read(r,"uniforms")?,name)}
/// Add stable, specular-only board waviness to one outer physical material (see the host's documentation).
#[wasm_bindgen]
pub fn book_reflection_apply(host:&JsValue,material:&JsValue,options:&JsValue)->R<JsValue>{
 let pick=|key:&'static str,fallback:JsValue|->R<JsValue>{
  let value=if options.is_undefined(){JsValue::UNDEFINED}else{crate::host::read(options,k(key))?};
  Ok(if value.is_undefined(){fallback}else{value})
 };
 let seed=pick("seed",JsValue::from_str(""))?;let strength=pick("strength",JsValue::from_f64(0.018))?;
 let uv_scale=pick("uvScale",[JsValue::from_f64(1.0),JsValue::from_f64(1.0)].iter().collect::<Array>().into())?;
 let environment=pick("environmentReflection",JsValue::from_f64(1.0))?;
 if absent(material)||!crate::host::truthy(&get(material,"isMeshStandardMaterial")){return Ok(material.clone());}
 let installed=read(host,"installed")?;
 let existing=call(&installed,"get",&[material])?;
 if crate::host::truthy(&existing){
  call(&existing,"setSeed",&[&seed])?;call(&existing,"setStrength",&[&strength])?;
  call(&existing,"setUvScale",&[&uv_scale])?;call(&existing,"setEnvironmentReflection",&[&environment])?;
  return Ok(material.clone());
 }
 let three=read(host,"three")?;
 let profile=reflection_profile(&seed);
 let uniforms=object(&[("bookReflectionPhase",object(&[("value",make(&three,"Vector3",&profile[..3])?)])?),
  ("bookReflectionStrength",object(&[("value",JsValue::from_f64(0.0))])?),
  ("bookReflectionUvScale",object(&[("value",make(&three,"Vector2",&[1.0,1.0])?)])?),
  ("bookEnvironmentReflection",object(&[("value",JsValue::from_f64(1.0))])?)])?;
 let r=object(&[("uniforms",uniforms.clone()),("amplitude",JsValue::from_f64(profile[3])),("slope",JsValue::from_f64(0.0)),("three",three)])?;
 let controls=object(&[("uniforms",uniforms),("setEnvironmentReflection",own(host,"book_reflection_set_environment",&[&r])?),
  ("setStrength",own(host,"book_reflection_set_strength",&[&r])?),("setSeed",own(host,"book_reflection_set_seed",&[&r])?),
  ("setUvScale",own(host,"book_reflection_set_uv_scale",&[&r])?)])?;
 call(&controls,"setStrength",&[&strength])?;
 call(&controls,"setEnvironmentReflection",&[&environment])?;
 call(&controls,"setUvScale",&[&uv_scale])?;
 call(&installed,"set",&[material,&controls])?;
 put(&read(material,"userData")?,"bookReflectionSurface",&controls)?;
 // Capture the prior key before replacing onBeforeCompile: Three's default
 // cache key is the hook's source. Book phases/strength are only uniforms,
 // so hundreds of books still share a shader program for a material variant.
 let before=read(material,"onBeforeCompile")?;
 let previous_key=call(material,"customProgramCacheKey",&[])?;
 put(material,"onBeforeCompile",&own(host,"book_reflection_compile",&[host,&r,material,&before])?)?;
 let key=JsValue::from(format!("{}|book-reflection-surface-v2",crate::host::text_of(&previous_key)));
 put(material,"customProgramCacheKey",&bind(&read(host,"constant")?,&[&key])?)?;
 put(material,"needsUpdate",&JsValue::TRUE)?;
 Ok(material.clone())
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
 let profile=reflection_profile(value);
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
