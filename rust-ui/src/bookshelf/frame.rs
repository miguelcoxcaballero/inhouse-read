//! The frame of the shelf screen, built first by `renderBookshelf` (bookshelf.js): the region with its
//! keyboard description, the scroller, the bin with its two status lines and the catalogue booklet. Every
//! node gets its attributes in the order `el()` gave them, so the markup is the same byte for byte.
use wasm_bindgen::prelude::*;
use super::util::*;

fn put_object(target:&JsValue,key:&str,value:&JsValue)->R{js_sys::Reflect::set(target,&JsValue::from_str(key),value)?;Ok(())}

/// `{ root, scroller, trashNode, trashStatus, trashAnnounce, catalogNode }`; the bin's nodes are null without
/// a bin, the booklet null for a sectioned library. The bin starts hidden and inert outside the diagonal view,
/// the region knows whether it has a bin and already holds the scroller.
#[wasm_bindgen]
pub fn shelf_frame(has_trash:bool,catalog:bool,isometric:bool)->R<JsValue>{
 let root=El::new("div").class("ihr-bookshelf").attr("data-ihr-bookshelf","").attr("role","region").attr("tabindex","0")
  .attr("aria-label","Estantería").attr("aria-keyshortcuts","ArrowLeft ArrowRight")
  .attr("aria-description","Desliza a la izquierda para ver la estantería de lado y a la derecha para volver a los lomos. También puedes usar las flechas al enfocar la estantería.")
  .done();
 let scroller=El::new("div").class("ihr-bookshelf__scroll").done();
 let (trash,status,announce)=if has_trash{
  let body=El::new("span").class("ihr-shelf-trash__body").attr("aria-hidden","true").done();
  let lid=El::new("span").class("ihr-shelf-trash__lid").attr("aria-hidden","true").done();
  let label=El::new("span").class("ihr-shelf-trash__label").text("Retirar").attr("aria-hidden","true").done();
  let trash=El::new("div").class("ihr-shelf-trash").attr("role","img")
   .attr("aria-label","Papelera: arrastra un libro, una planta o una lámpara para retirarlos de la estantería")
   .attr("title","Retirar de la estantería").children(&[body,lid,label]).done();
  // Errors stay visible. A successful removal is only announced to assistive technology: the object
  // leaving the shelf is its own confirmation.
  let status=El::new("div").class("ihr-trash-status").attr("role","status").attr("aria-live","polite").done();
  let announce=El::new("div").class("ihr-trash-announce visually-hidden").attr("role","status").attr("aria-live","polite").done();
  put_object(&trash,"hidden",&(!isometric).into())?;
  put_object(&trash,"inert",&(!isometric).into())?;
  (trash,status,announce)
 }else{(JsValue::NULL,JsValue::NULL,JsValue::NULL)};
 cls_toggle(&root,"has-trash",has_trash);
 append(&root,&scroller);
 let booklet=if catalog{
  let brand=El::new("span").class("ihr-shelf-catalog__brand").text("IKEA").attr("aria-hidden","true").done();
  let title=El::new("span").class("ihr-shelf-catalog__title").text("PLANTAS").attr("aria-hidden","true").done();
  let drawing=svg_icon(&["M7 15h10l-1.5 7h-7L7 15Z","M12 15V4","M12 10C5 10 5 3 5 3c6 0 7 7 7 7Z","M12 8s0-6 7-7c0 6-7 7-7 7Z"],"0 0 24 24","ihr-shelf-catalog__drawing")?;
  El::new("button").attr("type","button").class("ihr-shelf-catalog").attr("hidden","").attr("tabindex","-1")
   .attr("aria-label","Abrir catálogo IKEA de plantas, estanterías e iluminación").attr("title","Catálogo · IKEA")
   .children(&[brand,title,drawing]).done()
 }else{JsValue::NULL};
 let frame:JsValue=js_sys::Object::new().into();
 for (key,value) in [("root",root),("scroller",scroller),("trashNode",trash),("trashStatus",status),("trashAnnounce",announce),("catalogNode",booklet)]{
  put_object(&frame,key,&value)?;
 }
 Ok(frame)
}
