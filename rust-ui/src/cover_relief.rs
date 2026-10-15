//! The colour choices of the cover relief that are not pixel work: the Spanish name of a colour, the
//! stable coating profile of a printed colour, the material coefficients of a set of coatings and the
//! description of a proposal. Same arithmetic and operation order as the original; `Math.cbrt`,
//! `Math.pow` (the sRGB curve), `Math.hypot`, `Math.atan2` and `Math.round` come from the host.
use wasm_bindgen::prelude::*;
use js_sys::{Array,Math,Object,Reflect};
use crate::host::*;

const WHITE_SPACE:&[u16]=&[9,10,11,12,13,32,0xa0,0x1680,0x2000,0x2001,0x2002,0x2003,0x2004,0x2005,0x2006,0x2007,0x2008,0x2009,0x200a,0x2028,0x2029,0x202f,0x205f,0x3000,0xfeff];
fn digit(unit:u16)->Option<u32>{char::from_u32(u32::from(unit)).and_then(|c|c.to_digit(16))}

/// `parseInt(text, 16)` over UTF-16 units: white space, a sign, an optional `0x`, then the longest run of digits.
fn parse_int16(text:&[u16])->f64{
 let mut at=0;
 while at<text.len()&&WHITE_SPACE.contains(&text[at]){at+=1;}
 let mut negative=false;
 if at<text.len()&&(text[at]==u16::from(b'-')||text[at]==u16::from(b'+')){negative=text[at]==u16::from(b'-');at+=1;}
 if at+1<text.len()&&text[at]==u16::from(b'0')&&(text[at+1]==u16::from(b'x')||text[at+1]==u16::from(b'X')){at+=2;}
 let start=at;let mut value=0.0;
 while at<text.len(){let Some(next)=digit(text[at])else{break};value=value*16.0+f64::from(next);at+=1;}
 if at==start{return f64::NAN;}
 if negative{-value}else{value}
}
/// `hex.slice(from, to)` for in-range indices over UTF-16 units.
fn slice(units:&[u16],from:usize,to:usize)->&[u16]{&units[from.min(units.len())..to.min(units.len())]}
fn rgb_of(hex:&str)->[f64;3]{let units:Vec<u16>=hex.encode_utf16().collect();[1,3,5].map(|at|parse_int16(slice(&units,at,at+2)))}

/// `LINEAR_RGB[channel]`: the sRGB curve of a byte; anything that is not a byte index reads `undefined`, which is NaN in the sums.
fn linear(channel:f64)->f64{
 if !(0.0..=255.0).contains(&channel)||channel.fract()!=0.0{return f64::NAN;}
 let s=channel/255.0;
 if s<=0.04045{s/12.92}else{Math::pow((s+0.055)/1.055,2.4)}
}
/// The sRGB-to-linear table of the original, 256 values from the host's own `**`: the core's jobs take it
/// once, so their colour distances round exactly as the engine's did.
#[wasm_bindgen]
pub fn relief_linear_table()->Vec<f64>{(0..256).map(|byte|linear(f64::from(byte))).collect()}

fn oklab(rgb:[f64;3])->[f64;3]{
 let (r,g,b)=(linear(rgb[0]),linear(rgb[1]),linear(rgb[2]));
 let l=Math::cbrt(0.4122214708*r+0.5363325363*g+0.0514459929*b);
 let m=Math::cbrt(0.2119034982*r+0.6806995451*g+0.1073969566*b);
 let s=Math::cbrt(0.0883024619*r+0.2817188376*g+0.6299787005*b);
 [100.0*(0.2104542553*l+0.7936177850*m-0.0040720468*s),
  100.0*(1.9779984951*l-2.4285922050*m+0.4505937099*s),
  100.0*(0.0259040371*l+0.7827717662*m-0.8086757660*s)]
}

fn color_name(hex:&str)->String{
 let [l,a,b]=oklab(rgb_of(hex));
 let chroma=Math::hypot(a,b);
 let hue=(Math::atan2(b,a)*180.0/std::f64::consts::PI+360.0)%360.0;
 if chroma<3.0{return(if l<20.0{"Negro"}else if l>95.0{"Blanco"}else if l>78.0{"Gris claro"}else if l<45.0{"Gris oscuro"}else{"Gris"}).into();}
 if l>85.0&&chroma<12.0&&hue>=65.0&&hue<125.0{return String::from("Crema");}
 if hue>=45.0&&hue<105.0&&l<65.0{return String::from("Marrón");}
 let name=if hue<45.0||hue>=355.0{"Rojo"}else if hue<90.0{"Naranja"}else if hue<125.0{"Amarillo"}
  else if hue<165.0{"Verde"}else if hue<220.0{"Turquesa"}else if hue<285.0{"Azul"}else if hue<330.0{"Violeta"}else{"Rosa"};
 format!("{name}{}",if l<42.0{" oscuro"}else if l>80.0{" claro"}else{""})
}

/// The Spanish name of a printed colour (`#rrggbb`).
#[wasm_bindgen]
pub fn relief_color_name(hex:&str)->String{color_name(hex)}

fn put(target:&Object,key:&str,value:f64)->Result<(),JsValue>{Reflect::set(target,&JsValue::from_str(key),&JsValue::from_f64(value))?;Ok(())}
fn clamp01(value:f64)->f64{jmin(1.0,jmax(0.0,value))}

/// Each detected colour has its own stable printing/varnish depth and finish. Slot ranks can change after a
/// cover is reanalysed: the printed HEX is the identity and its stable mix yields a bounded coating profile.
fn profile(color:&str)->(f64,f64,f64){
 let units:Vec<u16>=color.encode_utf16().collect();
 let number=parse_int16(slice(&units,1,units.len()));
 // ToInt32: NaN and infinities are 0, everything else wraps modulo 2^32.
 let mut seed:i32=if number.is_finite(){(number.trunc()%4294967296.0)as i64 as i32}else{0};
 for _ in 0..2{seed=(seed^((seed as u32)>>16)as i32).wrapping_mul(0x45d9f3b);}
 let fraction=f64::from((seed^((seed as u32)>>16)as i32)as u32)/4294967295.0;
 (0.16+fraction*0.14,0.012+fraction*0.018,0.01+fraction*0.018)
}
fn color_of(choice:&JsValue)->Result<String,JsValue>{
 let color=read(choice,"color")?;
 color.as_string().ok_or_else(||js_sys::TypeError::new("choice.color.slice is not a function").into())
}

/// `{ heightMM, roughness, clearcoatRoughness }` of a choice: bounded physical coating values.
#[wasm_bindgen]
pub fn color_relief_profile(choice:&JsValue)->Result<JsValue,JsValue>{
 let (height,roughness,coat)=profile(&color_of(choice)?);
 let out=Object::new();put(&out,"heightMM",height)?;put(&out,"roughness",roughness)?;put(&out,"clearcoatRoughness",coat)?;
 Ok(out.into())
}

/// The roughness coefficients of the packed material map for the given finish and, when the maps carry
/// coloured layers, each layer's own ratios: `{ base, foilRoughness, glossRoughness, glossCoatRoughness, profiles }`.
#[wasm_bindgen]
pub fn relief_material_options(layers:&JsValue,clearcoat:&JsValue,roughness:&JsValue,clearcoat_roughness:&JsValue)->Result<JsValue,JsValue>{
 let (clearcoat,roughness,coat)=(num(clearcoat),num(roughness),num(clearcoat_roughness));
 let out=Object::new();
 put(&out,"base",clamp01(clearcoat))?;
 put(&out,"foilRoughness",jmin(1.0,jmax(0.2,0.3/jmax(0.05,roughness))))?;
 put(&out,"glossRoughness",clamp01(0.05/jmax(0.01,roughness)))?;
 put(&out,"glossCoatRoughness",clamp01(0.05/jmax(0.01,coat)))?;
 if !absent(layers){
  let profiles=Array::new();
  let length=num(&read(layers,"length")?);
  let mut index=0.0;
  while index<length{
   let layer=get_at(layers,index as u32);
   let (_,rough,layer_coat)=profile(&color_of(&layer)?);
   let entry=Object::new();
   put(&entry,"roughness",clamp01(rough/jmax(0.01,roughness)))?;
   put(&entry,"clearcoatRoughness",clamp01(layer_coat/jmax(0.01,coat)))?;
   profiles.push(&entry);index+=1.0;
  }
  Reflect::set(&out,&JsValue::from_str("profiles"),&profiles)?;
 }
 Ok(out.into())
}

/// `{ label, description }` of a detected colour: its name and how much of the cover it prints.
#[wasm_bindgen]
pub fn relief_describe(candidate:&JsValue)->Result<JsValue,JsValue>{
 let label=color_name(&color_of(candidate)?);
 let coverage=num(&read(&read(candidate,"facts")?,"coverage")?);
 let percent=jmax(1.0,Math::round(coverage*100.0));
 let percent=js_sys::Number::from(percent).to_string(10)?.as_string().unwrap_or_default();
 let out=Object::new();
 Reflect::set(&out,&JsValue::from_str("label"),&JsValue::from_str(&label))?;
 Reflect::set(&out,&JsValue::from_str("description"),&JsValue::from_str(&format!("Zonas de este color ({percent}% de la portada), con relieve y brillo")))?;
 Ok(out.into())
}
