//! Small drawings and DOM pieces the shelf screen shares: the icon table, the roof mark, the cover face of
//! the DOM fallback book and the two layers of a fallback page.
use wasm_bindgen::prelude::*;
use super::{util::*,ctx::Ctx};

pub const ROOF_PATH:&str="M4 24 L20 8 L36 24";
pub const DRIVE:[&str;3]=["M9 3h6l7 12-3 5H5l-3-5L9 3Z","m9 3 7 12H2","m15 3-7 12 3 5"];
pub const READ:[&str;2]=["M3 5.5c3-1 6-.5 9 1.5 3-2 6-2.5 9-1.5v14c-3-1-6-.5-9 1.5-3-2-6-2.5-9-1.5v-14Z","M12 7v14"];
pub const DOWNLOAD:[&str;3]=["M12 3v12","m7 10 5 5 5-5","M4 16v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4"];
pub const CHECK:[&str;1]=["m5 12 4 4L19 6"];
/// Three linked nodes: the usual "share" mark.
pub const SHARE:[&str;5]=["M15 5a3 3 0 1 0 6 0a3 3 0 1 0-6 0","M3 12a3 3 0 1 0 6 0a3 3 0 1 0-6 0","M15 19a3 3 0 1 0 6 0a3 3 0 1 0-6 0","m8.6 13.5 6.8 4","m15.4 6.5-6.8 4"];
pub const CLOSE:[&str;2]=["m6 6 12 12","M18 6 6 18"];
pub const BRUSH:[&str;2]=["m9.06 11.9 8.07-8.06a2.85 2.85 0 1 1 4.03 4.03l-8.06 8.08","M7.07 14.94c-1.66 0-3 1.35-3 3.02 0 1.33-2.5 1.52-2 2.02 1.08 1.1 2.49 2.02 4 2.02 2.2 0 4-1.8 4-4.04a3.01 3.01 0 0 0-3-3.02Z"];
pub const EASE:&str="cubic-bezier(0.4, 0, 0.2, 1)";

/// `roofMark(className)`: the roof drawn on the placeholder cover and the empty shelf.
pub fn roof_mark(class_name:&str)->R<JsValue>{svg_icon(&[ROOF_PATH],"0 0 40 28",class_name)}

/// `buildCoverFace(book, coverUrl, style)`: the cover of the DOM fallback book, or its cloth placeholder.
pub fn build_cover_face(ctx:&Ctx,book:&JsValue,cover_url:&JsValue,style:&JsValue)->R<JsValue>{
 let face=El::new("div").class("ihr-flyout__face ihr-flyout__face--cover")
  .style(&format!("--ihr-spine-base:{};--ihr-spine-shade:{};--ihr-spine-ink:{}",text(&get(style,"color")),text(&get(style,"shade")),text(&get(style,"ink")))).done();
 if truthy(cover_url){
  let image=El::new("img").class("ihr-flyout__img").attr("src",&text(cover_url)).attr("alt","").attr("decoding","async").done();
  append(&face,&image);
 }else{
  // Placeholder: a cloth cover with the roof engraved, not a broken icon.
  let author=ctx.env("normalizeBookAuthor",&[&get(book,"author")])?;
  let title=ctx.env("displayBookTitle",&[book])?;
  let mut holder=El::new("div").class("ihr-cover-placeholder");
  holder=holder.child(&roof_mark("ihr-roof ihr-cover-placeholder__roof")?);
  holder=holder.child(&El::new("span").class("ihr-cover-placeholder__title").text(&text(&title)).done());
  if truthy(&author){holder=holder.child(&El::new("span").class("ihr-cover-placeholder__author").text(&text(&ctx.env("normalizeBookAuthor",&[&get(book,"author")])?)).done());}
  let format=coalesce(get(book,"format"),ctx.text_of("noCover"));
  holder=holder.child(&El::new("span").class("ihr-cover-placeholder__format").text(&text(&format)).done());
  append(&face,&holder.done());
 }
 append(&face,&El::new("span").class("ihr-flyout__gloss").attr("aria-hidden","true").done());
 Ok(face)
}

#[wasm_bindgen]
pub fn shelf_build_cover_face(ctx:&super::ctx::RustShelfCtx,book:&JsValue,cover_url:&JsValue,style:&JsValue)->R<JsValue>{build_cover_face(&ctx.ctx,book,cover_url,style)}
#[wasm_bindgen]
pub fn shelf_fallback_page_layers(canvas:&JsValue,snapshot:&JsValue,opacity:f64)->JsValue{
 let list=js_sys::Array::new();for layer in fallback_page_layers(canvas,snapshot,opacity){list.push(&layer);}list.into()
}

/// Non-WebGL pages: the white-paper variant sits under the reader's own canvas, which fades over it
/// (opacity 0 = white paper, 1 = the reading theme).
pub fn fallback_page_layers(canvas:&JsValue,snapshot:&JsValue,opacity:f64)->Vec<JsValue>{
 let stock=get(&get(snapshot,"paper"),"source");
 if !truthy(&stock){return vec![canvas.clone()];}
 puts(&stock,"className","ihr-flyout__saved-page-stock");
 put(&style(&stock),"cssText",&get(&style(canvas),"cssText"));
 puts(&style(canvas),"opacity",&ns(opacity));
 vec![stock,canvas.clone()]
}
