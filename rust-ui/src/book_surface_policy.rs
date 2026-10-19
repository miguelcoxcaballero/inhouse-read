//! Stable ribbon dye/material choices and shared paper colors. Three remains
//! the color-space conversion host; Rust owns selection, blending and identity.
use wasm_bindgen::{prelude::*,JsCast};
use js_sys::{Float64Array,Function,Object,WeakMap};
use crate::host::*;
type R<T> = Result<T,JsValue>;
fn object(fields:&[(&str,JsValue)])->R<JsValue>{let value:JsValue=Object::new().into();for(k,v)in fields{set(&value,k,v)?;}Ok(value)}
const DYES:[u32;8]=[0x7c1c26,0x7c1c26,0x7c1c26,0x1d4030,0x22305a,0x4c2244,0x823a1f,0xa8322b];
fn distance(a:u32,b:u32)->f64{
 let r=(f64::from(a>>16)-f64::from(b>>16))/255.0;
 let g=(f64::from((a>>8)&255)-f64::from((b>>8)&255))/255.0;
 let blue=(f64::from(a&255)-f64::from(b&255))/255.0;
 (2.0*r.powi(2)+4.0*g.powi(2)+3.0*blue.powi(2)).sqrt()
}
#[wasm_bindgen]
pub fn book_ribbon_silk(seed:JsValue,cloth:JsValue,finished:bool,host:JsValue)->R<String>{
 if finished{return Ok("#c29a4c".into());}
 let cloth=if absent(&cloth){"#555".into()}else{cloth};
 let hex=num(&method(&host,"hex",&[&cloth])?) as u32;
 let clear:Vec<u32>=DYES.into_iter().filter(|&dye|distance(dye,hex)>0.55).collect();
 let chosen=if clear.is_empty(){let mut best=DYES[0];for dye in DYES{if distance(dye,hex)>distance(best,hex){best=dye;}}best}
 else{let at=(crate::spine_surface::spine_lattice(num(&seed)%65521.0,9.0,23.0)*clear.len() as f64).floor() as usize;clear[at]};
 Ok(format!("#{chosen:06x}"))
}
#[wasm_bindgen]
pub fn book_ribbon_tint(material:JsValue,silk:JsValue,shelf:bool,highlight:JsValue)->R<()>{
 let color=method(&read(&material,"color")?,"set",&[&silk])?;
 method(&color,"multiplyScalar",&[&if shelf{0.88}else{1.0}.into()])?;
 let sheen=method(&read(&material,"sheenColor")?,"set",&[&silk])?;
 let sheen=method(&sheen,"multiplyScalar",&[&2.2.into()])?;
 method(&sheen,"lerp",&[&highlight,&0.1.into()])?;Ok(())
}
#[wasm_bindgen]
pub fn book_ribbon_material(finished:bool,shelf:bool)->R<JsValue>{
 object(&[("roughness",if shelf{0.42}else{0.46}.into()),("metalness",if finished{0.16}else{0.0}.into()),
  ("sheen",if shelf{0.0}else{0.7}.into()),("sheenRoughness",0.38.into()),
  ("anisotropy",if shelf{0.0}else{0.55}.into()),("specularIntensity",0.5.into()),("alphaTest",0.5.into())])
}
#[wasm_bindgen]
pub fn book_weave_strength(height:f64,pixel_ratio:JsValue)->f64{
 let pixels=height*jmin(2.0,pixel_ratio.as_f64().unwrap_or(1.0))/224.0;
 jmax(0.2,jmin(0.45,(pixels-1.4)/2.2))
}
#[wasm_bindgen]
pub fn book_grain_strength(grain:&str,weave:f64,finish:&str)->f64{
 let strength=if grain=="cloth"{0.55*weave}else{0.16};
 let tooth=match finish{"matte"=>1.0,"satin"=>0.5,"glossy"=>0.16,_=>f64::NAN};strength*tooth
}
thread_local!{static PAPER_COLORS:WeakMap=WeakMap::new();}
#[wasm_bindgen]
pub fn book_paper_color(key:JsValue,source:JsValue,tone_key:JsValue,host:JsValue)->R<JsValue>{
 let key:Object=key.unchecked_into();
 if PAPER_COLORS.with(|cache|cache.has(&key)){return Ok(PAPER_COLORS.with(|cache|cache.get(&key)));}
 let rgb=method(&host,"read",&[&source,&tone_key])?;
 let color=if truthy(&rgb){method(&host,"color",&[&(num(&get_at(&rgb,0))/255.0).into(),
  &(num(&get_at(&rgb,1))/255.0).into(),&(num(&get_at(&rgb,2))/255.0).into()])?}else{JsValue::NULL};
 PAPER_COLORS.with(|cache|cache.set(&key,&color));Ok(color)
}
#[wasm_bindgen]
pub fn book_paper_mix(target:JsValue,stock:JsValue,theme:JsValue,mix:JsValue,host:JsValue)->R<JsValue>{
 let k=jmax(0.0,jmin(1.0,num(&mix)));
 if !truthy(&stock)&&!truthy(&theme){return Ok(JsValue::NULL);}
 if !truthy(&stock){return method(&target,"copy",&[&theme]);}
 if !truthy(&theme){return method(&target,"copy",&[&stock]);}
 if !(k>0.0){return method(&target,"copy",&[&stock]);}
 if !(k<1.0){return method(&target,"copy",&[&theme]);}
 // Read Three's color-space conversions in one bulk binding; the shared host
 // scratch is copied before interpolation or a reentrant target setter.
 let colors:Float64Array=method(&host,"read",&[&stock,&theme])?.dyn_into()?;
 let colors=colors.to_vec();
 if colors.len()!=6{return Err(js_sys::TypeError::new("Expected two RGB colors").into());}
 let r=colors[0]+(colors[3]-colors[0])*k;
 let g=colors[1]+(colors[4]-colors[1])*k;
 let b=colors[2]+(colors[5]-colors[2])*k;
 let write:Function=read(&host,"write")?.dyn_into()?;
 write.call4(&host,&target,&r.into(),&g.into(),&b.into())
}
