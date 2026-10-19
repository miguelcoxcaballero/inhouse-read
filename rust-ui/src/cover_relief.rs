//! The colour choices of the cover relief that are not pixel work: the Spanish name of a colour, the
//! stable coating profile of a printed colour, the material coefficients of a set of coatings and the
//! description of a proposal. Same arithmetic and operation order as the original; `Math.cbrt`,
//! `Math.pow` (the sRGB curve), `Math.hypot`, `Math.atan2` and `Math.round` come from the host.
use wasm_bindgen::prelude::*;
use js_sys::{Array,Math,Object,Reflect};
use crate::host::*;
use crate::cover_relief_portable::{record,colour_id,cover_relief_layers};

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

// Portable cover choices and sizing/statistics policy. Browser operations stay
// in the host; these decisions are shared by persisted records and the editor.
#[wasm_bindgen]
extern "C"{
 // Math.max with one argument performs exactly ToNumber, preserving -0 and
 // throwing for Symbol/BigInt (unlike Number, which explicitly accepts BigInt).
 #[wasm_bindgen(catch,js_namespace=Math,js_name=max)]fn host_relief_numeric(value:&JsValue)->Result<f64,JsValue>;
}

fn relief_numeric(value:&JsValue)->Result<f64,JsValue>{value.as_f64().map_or_else(||host_relief_numeric(value),Ok)}

fn arithmetic_number(value:&JsValue)->Result<f64,JsValue>{
 if let Some(number)=value.as_f64(){return Ok(number);}
 let value=crate::library_store::to_numeric(value.clone())?;
 if value.is_bigint(){return Err(js_sys::TypeError::new("Cannot mix BigInt and other types, use explicit conversions").into());}
 Ok(num(&value))
}
fn subtract_for_sort(a:JsValue,b:JsValue)->Result<f64,JsValue>{
 if let(Some(a),Some(b))=(a.as_f64(),b.as_f64()){return Ok(a-b);}
 let a=crate::library_store::to_numeric(a)?;let b=crate::library_store::to_numeric(b)?;
 match(a.is_bigint(),b.is_bigint()){
  (false,false)=>Ok(num(&a)-num(&b)),
  (true,true)=>Err(js_sys::TypeError::new("Cannot convert a BigInt value to a number").into()),
  _=>Err(js_sys::TypeError::new("Cannot mix BigInt and other types, use explicit conversions").into())
 }
}

#[wasm_bindgen]
pub fn relief_sorted_layers(value:&JsValue)->Result<Array,JsValue>{
 let mut layers:Vec<_>=cover_relief_layers(value)?.iter().map(|layer|{
  let colour=get(&layer,"color").as_string().unwrap_or_default();(colour,layer)
 }).collect();
 // Portable colours contain only lowercase ASCII hex; this is the same
 // ordering as their localeCompare, without a browser callback per comparison.
 layers.sort_by(|a,b|a.0.cmp(&b.0));
 let result=Array::new();for(_,layer)in layers{result.push(&layer);}Ok(result)
}

#[wasm_bindgen]
pub fn relief_selected_layers(maps:&JsValue,value:&JsValue)->Result<Array,JsValue>{
 let layers=relief_sorted_layers(value)?;
 let fail=||JsValue::from(js_sys::TypeError::new("Las zonas de relieve han cambiado"));
 if !truthy(&read(maps,"owners")?){return Err(fail());}
 let known=read(maps,"layers")?;
 if read(&known,"length")?.as_f64()!=Some(f64::from(layers.length())){return Err(fail());}
 for (index,layer) in layers.iter().enumerate(){
  let original=read(&read(maps,"layers")?,&index.to_string())?;
  if read(&layer,"color")?!=read(&original,"color")?||read(&layer,"tolerance")?!=read(&original,"tolerance")?{return Err(fail());}
 }
 Ok(layers)
}

#[wasm_bindgen]
pub fn relief_fit_dimensions(width:&JsValue,height:&JsValue,long:&JsValue)->Result<JsValue,JsValue>{
 let w=relief_numeric(width)?;let h=relief_numeric(height)?;
 let scale=jmin(1.0,arithmetic_number(long)?/jmax(w,h));
 let w=jmax(1.0,Math::round(arithmetic_number(width)?*scale));
 let h=jmax(1.0,Math::round(arithmetic_number(height)?*scale));
 record(&[("width",w.into()),("height",h.into())])
}

#[wasm_bindgen]
pub fn relief_quantile(values:&JsValue,fraction:&JsValue)->Result<JsValue,JsValue>{
 if !truthy(&read(values,"length")?){return Ok(0.into());}
 let iter=js_sys::try_iter(&boxed(values))?.ok_or_else(||JsValue::from(js_sys::TypeError::new("values is not iterable")))?;
 let values:Vec<JsValue>=iter.collect::<Result<_,_>>()?;
 let numeric:Option<Vec<f64>>=values.iter().map(|value|value.as_f64().filter(|number|!number.is_nan())).collect();
 if let Some(mut numbers)=numeric{
  // Timings are ordinary numbers: sort the bounded list entirely in Rust.
  // Stable equality retains -0/+0 order just as Array.sort does.
  numbers.sort_by(|a,b|a.partial_cmp(b).unwrap());
  let length=numbers.len()as f64;
  let index=jmin(length-1.0,(length*arithmetic_number(fraction)?).floor());
  return Ok(if index.is_finite()&&index>=0.0&&index<length{numbers[index as usize].into()}else{JsValue::UNDEFINED});
 }
 let sorted=Array::new();for value in values{sorted.push(&value);}
 // Keep the engine's stable Array.sort rules for undefined and NaN comparator
 // results. The comparator policy is Rust; sorting remains the native builtin.
 let error=std::rc::Rc::new(std::cell::RefCell::new(None));let failed=error.clone();
 let compare=Closure::wrap(Box::new(move|a:JsValue,b:JsValue|->f64{
  if failed.borrow().is_some(){return 0.0;}
  match subtract_for_sort(a,b){
   Ok(value)=>value,Err(value)=>{*failed.borrow_mut()=Some(value);0.0}
  }
 })as Box<dyn FnMut(JsValue,JsValue)->f64>);
 method(&sorted,"sort",&[compare.as_ref()])?;
 if let Some(error)=error.borrow_mut().take(){return Err(error);}
 let length=f64::from(sorted.length());
 let index=jmin(length-1.0,(length*arithmetic_number(fraction)?).floor());
 Reflect::get(&sorted,&JsValue::from_f64(index))
}

#[wasm_bindgen]
pub fn relief_validate_raster(image:&JsValue)->Result<(),JsValue>{
 let invalid=||JsValue::from(js_sys::TypeError::new("Portada sin píxeles RGBA válidos"));
 if !truthy(image){return Err(invalid());}
 let safe=|v:JsValue|v.as_f64().is_some_and(|n|n.is_finite()&&n.fract()==0.0&&n.abs()<=9_007_199_254_740_991.0);
 if !safe(read(image,"width")?)||!safe(read(image,"height")?)
  ||relief_numeric(&read(image,"width")?)?<1.0||relief_numeric(&read(image,"height")?)?<1.0
  ||!truthy(&read(image,"data")?){return Err(invalid());}
 let length=read(&read(image,"data")?,"length")?;
 let count=relief_numeric(&read(image,"width")?)?*relief_numeric(&read(image,"height")?)?*4.0;
 if length.as_f64()!=Some(count){return Err(invalid());}Ok(())
}


/// Package numeric analysis into the existing portable proposal shape. Large
/// masks stay as the same owned JS buffers; Rust only builds the metadata.
#[wasm_bindgen]
pub fn relief_analysis_result(found:&JsValue)->Result<JsValue,JsValue>{
 let chosen=Array::new();let colours=Array::from(&read(found,"colours")?);
 let opaque=read(found,"opaque")?;
 for(index,colour)in colours.iter().enumerate(){
  let rgb=Array::from(&read(&colour,"rgb")?);
  let hex=format!("#{:02x}{:02x}{:02x}",num(&rgb.get(0))as u8,num(&rgb.get(1))as u8,num(&rgb.get(2))as u8);
  let tolerance=read(&colour,"tolerance")?;let pixels=read(&colour,"pixels")?;
  let recipe=record(&[("kind","color".into()),("color",hex.clone().into()),("tolerance",tolerance.clone())])?;
  let facts=record(&[("color",hex.clone().into()),("coverage",(num(&pixels)/jmax(1.0,num(&opaque))).into()),("pixels",pixels)])?;
  chosen.push(&record(&[("id",format!("color-{}",index+1).into()),("color",hex.into()),("tolerance",tolerance),
   ("strength",0.75.into()),("detected",true.into()),("confidence",1.into()),("recipe",recipe),
   ("mask",read(&colour,"mask")?),("facts",facts)])?);
 }
 let feats=record(&[("photo",false.into()),("busy",0.into()),("strokeFraction",0.into())])?;
 record(&[("chosen",chosen.clone().into()),("candidates",chosen.into()),("seed",read(found,"seed")?),
  ("feats",feats),("colorSpace","oklab-100".into()),("opaquePixels",opaque)])
}

#[wasm_bindgen]
pub fn relief_proposal(choice:&JsValue,thumbnail:&JsValue)->Result<JsValue,JsValue>{
 let described=relief_describe(choice)?;
 record(&[("id",read(choice,"id")?),("color",read(choice,"color")?),("tolerance",read(choice,"tolerance")?),
  ("label",read(&described,"label")?),("description",read(&described,"description")?),("strength",0.75.into()),
  ("thumbnail",thumbnail.clone()),("confidence",(Math::round(num(&read(choice,"confidence")?)*100.0)/100.0).into()),
  ("detected",read(choice,"detected")?)])
}

#[wasm_bindgen]
pub fn relief_analysis_report(found:&JsValue,work:&JsValue,stats:&JsValue)->Result<JsValue,JsValue>{
 let candidates=Array::new();
 for candidate in Array::from(&read(found,"candidates")?).iter(){
  candidates.push(&record(&[("id",read(&candidate,"id")?),
   ("confidence",(Math::round(num(&read(&candidate,"confidence")?)*100.0)/100.0).into()),("facts",read(&candidate,"facts")?)])?);
 }
 let feats=read(found,"feats")?;let durations=read(stats,"durations")?;
 record(&[("width",read(work,"width")?),("height",read(work,"height")?),("seed",read(found,"seed")?),
  ("colorSpace",read(found,"colorSpace")?),("photo",read(&feats,"photo")?),
  ("busy",(Math::round(num(&read(&feats,"busy")?)*1000.0)/1000.0).into()),
  ("strokeFraction",(Math::round(num(&read(&feats,"strokeFraction")?)*1000.0)/1000.0).into()),("candidates",candidates.into()),
  ("ms",Math::round(num(&read(stats,"ms")?)).into()),("slices",read(stats,"slices")?),
  ("longestSliceMs",(Math::round(num(&read(stats,"longestSliceMs")?)*10.0)/10.0).into()),
  ("medianSliceMs",(Math::round(num(&relief_quantile(&durations,&0.5.into())?)*10.0)/10.0).into()),
  ("p95SliceMs",(Math::round(num(&relief_quantile(&durations,&0.95.into())?)*10.0)/10.0).into())])
}

/// Native planning coefficients; JS retains only allocation and browser calls.
#[wasm_bindgen]
pub fn relief_map_mode(choice:&JsValue)->Result<u8,JsValue>{
 if truthy(&read(choice,"layers")?){return Ok(2);}
 Ok(if colour_id(&read(choice,"id")?){1}else{0})
}

#[wasm_bindgen]
pub fn relief_map_resolution(max_size:&JsValue)->Result<f64,JsValue>{Ok(jmin(512.0,jmax(64.0,relief_numeric(max_size)?)))}

#[wasm_bindgen]
pub fn relief_classification_layers(layers:&JsValue)->Result<Array,JsValue>{
 let out=Array::new();
 for layer in Array::from(layers).iter(){
  let colour=read(&layer,"color")?;let tolerance=read(&layer,"tolerance")?;
  let (height,_,_)=profile(&color_of(&layer)?);
  out.push(&record(&[("color",colour),("tolerance",tolerance),("heightMM",height.into())])?);
 }
 Ok(out)
}

#[wasm_bindgen]
pub fn relief_normal_unit(width:&JsValue,height:&JsValue,gain:&JsValue)->Result<f64,JsValue>{
 let width=relief_numeric(width)?;let height=relief_numeric(height)?;
 let unit=0.6/255.0/(2.0*(200.0/jmax(width,height)));
 Ok(unit*arithmetic_number(gain)?)
}

#[wasm_bindgen]
pub fn relief_shade_scale(slope:&JsValue)->Result<f64,JsValue>{Ok(arithmetic_number(slope)?*0.6/255.0*14.0)}

#[wasm_bindgen]
pub fn relief_thumbnail_size(width:&JsValue,height:&JsValue)->Result<JsValue,JsValue>{
 let scale=jmin(1.0,132.0/arithmetic_number(width)?);
 let width=jmax(1.0,Math::round(arithmetic_number(width)?*scale));
 let height=jmax(1.0,Math::round(arithmetic_number(height)?*scale));
 record(&[("width",width.into()),("height",height.into())])
}
