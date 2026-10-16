//! Spine style: the CSS variables of a style, the appearance of a cover applied on top of a book's own
//! customisation and the typeface table. Same operation order and the same conversions (`Number`, template
//! literals, object spread) as the original; the cloth/finish helpers stay the host's (`env`).
use wasm_bindgen::prelude::*;
use js_sys::Object;
use super::util::*;
use super::ctx::Ctx;

pub struct Font{pub family:&'static str,pub label:&'static str,pub weight:f64,pub fallback:&'static str}
pub const SPINE_FONTS:[Font;6]=[
 Font{family:"Playfair Display",label:"Playfair Display",weight:700.0,fallback:"Georgia, serif"},
 Font{family:"Lora",label:"Lora",weight:700.0,fallback:"Georgia, serif"},
 Font{family:"Cormorant Garamond",label:"Cormorant Garamond",weight:700.0,fallback:"Georgia, serif"},
 Font{family:"DM Sans",label:"DM Sans",weight:600.0,fallback:"Arial, sans-serif"},
 Font{family:"Montserrat",label:"Montserrat",weight:700.0,fallback:"Arial, sans-serif"},
 Font{family:"Oswald",label:"Oswald",weight:600.0,fallback:"Arial Narrow, sans-serif"},
];

/// `Math.max(lo, Math.min(hi, Number(value) || fallback))`, the clamp of the font-size variables.
fn clamped_or(value:&JsValue,lo:f64,hi:f64,fallback:f64)->f64{
 let number=num(value);let number=if number.is_nan()||number==0.0{fallback}else{number};
 max(lo,min(hi,number))
}
/// `/^#[0-9a-f]{6}$/i.test(text)`.
pub fn is_hex6(text:&str)->bool{
 let bytes=text.as_bytes();
 bytes.len()==7&&bytes[0]==b'#'&&bytes[1..].iter().all(|byte|byte.is_ascii_hexdigit())
}

/// The inline custom properties of a spine style (`spineStyleVars`).
pub fn spine_style_vars(style:&JsValue)->String{
 let family=or(get(style,"fontFamily"),s("Playfair Display"));
 let fallback=or(get(style,"fontFallback"),s("Georgia, serif"));
 let weight=or(get(style,"fontWeight"),f(700.0));
 format!("--ihr-spine-base:{};--ihr-spine-shade:{};--ihr-spine-ink:{};--ihr-spine-font:\"{}\", {};--ihr-spine-font-weight:{};--ihr-spine-font-size:{}px;--ihr-spine-author-font-size:{}px;",
  text(&get(style,"color")),text(&get(style,"shade")),text(&get(style,"ink")),text(&family),text(&fallback),text(&weight),
  ns(clamped_or(&get(style,"spineFontSize"),8.0,48.0,10.0)),ns(clamped_or(&get(style,"spineAuthorFontSize"),6.0,36.0,12.0)))
}
/// `node.style.setProperty(name, value)` with the value handed over untouched (the DOM converts it).
fn set_var(node:&JsValue,name:&str,value:&JsValue){let _=method(&style(node),"setProperty",&[&s(name),value]);}
/// `updateBookStyleVars(node, style)`.
pub fn update_book_style_vars(node:&JsValue,style_value:&JsValue){
 if !truthy(node)||!truthy(style_value){return;}
 let family=or(get(style_value,"fontFamily"),s("Playfair Display"));
 let fallback=or(get(style_value,"fontFallback"),s("Georgia, serif"));
 set_var(node,"--ihr-spine-base",&get(style_value,"color"));
 set_var(node,"--ihr-spine-shade",&get(style_value,"shade"));
 set_var(node,"--ihr-spine-ink",&get(style_value,"ink"));
 set_var(node,"--ihr-spine-font",&s(&format!("\"{}\", {}",text(&family),text(&fallback))));
 set_var(node,"--ihr-spine-font-weight",&s(&text(&or(get(style_value,"fontWeight"),f(700.0)))));
 set_var(node,"--ihr-spine-font-size",&s(&format!("{}px",ns(clamped_or(&get(style_value,"spineFontSize"),8.0,48.0,10.0)))));
 set_var(node,"--ihr-spine-author-font-size",&s(&format!("{}px",ns(clamped_or(&get(style_value,"spineAuthorFontSize"),6.0,36.0,12.0)))));
}

/// `{ ...a, ...b }` into a new plain object.
pub fn spread(sources:&[&JsValue])->JsValue{
 let target=Object::new();
 for source in sources{if !nullish(source){Object::assign(&target,&Object::from((*source).clone()));}}
 target.into()
}
/// `applyCoverAppearance(item, appearance)`: the style of a shelf item from its base style, the cover
/// appearance and the book's own customisation. Returns `Boolean(appearance)`.
pub fn apply_cover_appearance(ctx:&Ctx,item:&JsValue,appearance:&JsValue)->R<bool>{
 let base=or(get(item,"baseStyle"),get(item,"style"));
 let mut current=if truthy(appearance){ctx.env("withCoverAppearance",&[&base,appearance])?}else{spread(&[&base])};
 put(item,"style",&current);
 let book=get(item,"book");
 let override_color=get(&book,"spineColorOverride");
 if truthy(&override_color){
  current=spread(&[&current,&ctx.env("spineColorStyle",&[&override_color])?]);put(item,"style",&current);
 }
 let metal=ctx.env_value("METAL_COLORS");
 let finish=text(&ctx.env("spineFinish",&[&get(&book,"spineFinish")])?);
 if finish!="matte"{
  current=spread(&[&current,&ctx.env("spineColorStyle",&[&get(&metal,&finish)])?]);put(item,"style",&current);
 }else{
  let ink=get(&ctx.env("spineColorStyle",&[&get(&get(item,"style"),"color")])?,"ink");
  put(&get(item,"style"),"ink",&ink);
 }
 let text_finish=text(&ctx.env("spineFinish",&[&get(&book,"spineTextFinish")])?);
 if text_finish!="matte"{put(&get(item,"style"),"ink",&get(&metal,&text_finish));}
 else{
  let color=or(get(&book,"spineTextColor"),s(""));
  if is_hex6(&text(&color)){put(&get(item,"style"),"ink",&get(&book,"spineTextColor"));}
 }
 let family=get(&book,"spineFontFamily");
 if truthy(&family){
  let wanted=text(&family);
  if let Some(font)=SPINE_FONTS.iter().find(|font|font.family==wanted){
   let patch=obj(&[("fontFamily",&s(font.family)),("fontCanvasFamily",&s(font.family)),("fontFallback",&s(font.fallback)),("fontWeight",&f(font.weight))]);
   let next=spread(&[&get(item,"style"),&patch]);put(item,"style",&next);
  }
 }
 let size=num(&get(&book,"spineFontSize"));
 if size.is_finite(){
  let next=spread(&[&get(item,"style"),&obj(&[("spineFontSize",&f(max(8.0,min(48.0,size))))])]);put(item,"style",&next);
 }
 let author_size=num(&get(&book,"spineAuthorFontSize"));
 if author_size.is_finite(){
  let next=spread(&[&get(item,"style"),&obj(&[("spineAuthorFontSize",&f(max(6.0,min(36.0,author_size))))])]);put(item,"style",&next);
 }
 Ok(truthy(appearance))
}

#[wasm_bindgen]
pub fn shelf_apply_cover_appearance(ctx:&super::ctx::RustShelfCtx,item:&JsValue,appearance:&JsValue)->Result<bool,JsValue>{apply_cover_appearance(&ctx.ctx,item,appearance)}
#[wasm_bindgen]
pub fn shelf_spine_style_vars(style:&JsValue)->String{spine_style_vars(style)}
#[wasm_bindgen]
pub fn shelf_update_book_style_vars(node:&JsValue,style:&JsValue){update_book_style_vars(node,style)}
