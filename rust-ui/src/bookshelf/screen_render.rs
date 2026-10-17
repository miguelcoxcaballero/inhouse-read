//! The shelf screen's paint transaction: guards, planning, retained-room handover and focus.
//! The host builders still create DOM subtrees/listeners; Rust plans and commits each paint transaction.
use std::rc::Rc;
use wasm_bindgen::prelude::*;
use js_sys::Array;
use super::{util::*,ctx::{Ctx,RustShelfCtx},screen_plan,objects,covers,style,returning,screen_nodes};

fn geometry_state(ctx:&Ctx,book:&JsValue)->R<JsValue>{ctx.geometry_state(book)}

fn render_inner(ctx:&Rc<Ctx>)->R{
 if ctx.st_true("destroyed"){return Ok(());}
 put(&dataset(&ctx.root),"viewMode",&ctx.st("viewMode"));put(&dataset(&ctx.root),"shelfType",&ctx.st("shelfType"));
 if ["returnMotion","busy","session","dragSession","compatibilityTapTimer"].iter().any(|key|ctx.st_true(key)){
  ctx.st_set("renderQueued",&JsValue::TRUE);return Ok(());
 }
 let count=gn(&ctx.st("books"),"length");
 if !ctx.st_true("appearancesReady")&&count>0.0{
  ctx.scene_call("dispose",&[])?;ctx.st_set("shelfScene",&null());set_text(&ctx.scroller,"");
  append(&ctx.scroller,&screen_nodes::build_preparing_state());return Ok(());
 }
 let focused_book=data_get(&closest(&active_element(),".ihr-spine"),"bookId");
 let focused_object=data_get(&closest(&active_element(),"[data-object-id]"),"objectId");
 let width=screen_plan::measure(ctx);ctx.st_set("shelfWidth",&f(width));
 if width<=0.0&&count>0.0{
  for book in array_of(&ctx.st("books")){covers::resolve_cover_appearance(ctx,&book,&undef())?;}
  returning::settle_return_slot(ctx,false)?;return Ok(());
 }
 let sections=truthy(&ctx.opts_get("sections"));
 if count==0.0&&sections{
  if width>0.0{screen_plan::consume_render_requests(ctx);}
  ctx.scene_call("dispose",&[])?;ctx.st_set("shelfScene",&null());set_text(&ctx.scroller,"");
  append(&ctx.scroller,&screen_nodes::build_empty_state(ctx)?);returning::settle_return_slot(ctx,false)?;return Ok(());
 }
 if width<=0.0{returning::settle_return_slot(ctx,false)?;return Ok(());}
 screen_plan::consume_render_requests(ctx);
 let retained=ctx.scene();let previous=if truthy(&retained){Array::from(&get(&ctx.scroller,"children")).iter().collect::<Vec<_>>()}else{Vec::new()};
 if !truthy(&retained){set_text(&ctx.scroller,"");}
 let pending=Array::new();for book in array_of(&ctx.st("books")){if geometry_state(ctx,&book)?!=s("ready"){pending.push(&book);}}
 let ready=Array::new();for book in array_of(&ctx.st("books")){if geometry_state(ctx,&book)?==s("ready"){ready.push(&book);}}
 let plant_ctx=ctx.clone();
 let plant_width=fun(move|variant,_|Ok(get(&objects::plant_shelf_object(&plant_ctx,&obj(&[("key",&s("plant")),("variant",&variant)]),objects::plant_scale(&plant_ctx)?)?,"width")));
 let display_width=fun(move|_,style|Ok(get(&style,"width")));
 let spine=ctx.env("bookSpineOptions",&[&f(width)])?;
 let variants=get(&ctx.env_value("DEFAULT_LAYOUT"),"plantVariants");let mut minimum_plant=f64::INFINITY;
 for variant in array_of(&variants){minimum_plant=min(minimum_plant,num(&call(&plant_width.function,"plantWidthFor",&[&variant])?));}
 let plan=ctx.env("planBookshelf",&[&ready.into(),&obj(&[
  ("shelfWidth",&f(width)),("padding",&f(objects::shelf_padding(ctx))),("gap",&ctx.opts_get("gap")),("plantEvery",&ctx.opts_get("plantEvery")),
  ("sort",&ctx.opts_get("sort")),("spine",&spine),
  ("displayWidthFor",&display_width.function),("plantWidth",&f(minimum_plant)),("plantWidthFor",&plant_width.function),
  ("recentLimit",&if sections{ctx.opts_get("recentLimit")}else{f(0.0)})]),&ctx.env_value("batchSpineStyles")])?;
 if !sections&&gn(&plan,"length")==0.0{method(&plan,"push",&[&obj(&[("id",&s("library")),("title",&s("")),("count",&f(0.0)),("shelves",&Array::new().into())])])?;}
 if !sections&&gn(&plan,"length")==1.0{
  let value=num(&ctx.opts_get("minimumShelves"));let value=if value==0.0||value.is_nan(){1.0}else{value};
  let minimum=max(1.0,js_sys::Math::floor(value));let plants=["sansevieria","pothos","suculenta","monstera"];
  let shelves=get(&get_at(&plan,0),"shelves");
  while gn(&shelves,"length")<minimum{
   let index=gn(&shelves,"length");let variant=s(plants[index as usize%plants.len()]);
   let item=obj(&[("kind",&s("plant")),("variant",&variant),("seed",&s(&format!("empty-shelf-{}",ns(index)))),
    ("width",&call(&plant_width.function,"plantWidthFor",&[&variant])?)]);
   method(&shelves,"push",&[&obj(&[("index",&f(index)),("items",&arr(&[&item]))])])?;
  }
 }
 for section in array_of(&plan){for shelf in array_of(&get(&section,"shelves")){for item in array_of(&get(&shelf,"items")){
  if get(&item,"kind")!=s("book"){continue;}
  put(&item,"baseStyle",&get(&item,"style"));let book=get(&item,"book");let key=covers::cover_key_for(&book);put(&item,"coverKey",&key);
  let cached=map_get(&ctx.st("coverAppearances"),&covers::book_id(&book));
  let appearance=if get(&cached,"key")==key{get(&cached,"appearance")}else{null()};style::apply_cover_appearance(ctx,&item,&appearance)?;
 }}}
 if !sections&&gn(&plan,"length")==1.0{
  let section=get_at(&plan,0);put(&section,"shelves",&screen_plan::freely_placed_shelves(ctx,&get(&section,"shelves"))?);
 }
 method(&ctx.st("itemsById"),"clear",&[])?;
 let fragment=method(&document(),"createDocumentFragment",&[])?;
 let text=if count>0.0{format!("{} {}",ns(count),if count==1.0{"libro"}else{"libros"})}else{String::new()};
 let heading=screen_nodes::build_library_heading(&s(&text));append(&fragment,&heading);
 if pending.length()>0{append(&fragment,&screen_nodes::build_geometry_status(ctx,pending.as_ref())?);}
 if count==0.0{append(&fragment,&screen_nodes::build_library_empty(ctx)?);}
 let stage=screen_nodes::build_stage(ctx,width)?;
 let trash=get(&ctx.parts,"trashNode");let catalogue=get(&ctx.parts,"catalogNode");
 if truthy(&trash){
  if !ctx.st_true("useScene"){putb(&trash,"hidden",ctx.st("viewMode")!=s("isometric"));put(&trash,"inert",&get(&trash,"hidden"));}
  append(&stage,&trash);
 }
 if truthy(&catalogue){
  if !ctx.st_true("useScene"){putb(&catalogue,"hidden",ctx.st("viewMode")!=s("isometric"));putf(&catalogue,"tabIndex",if gb(&catalogue,"hidden"){-1.0}else{0.0});}
  append(&stage,&catalogue);
 }
 for section in array_of(&plan){
  let mut books=0.0;
  if gb(&section,"title"){
   for shelf in array_of(&get(&section,"shelves")){for item in array_of(&get(&shelf,"items")){if get(&item,"kind")==s("book"){books+=1.0;}}}
  }
  let wrapper=screen_nodes::build_section(ctx,&section,books);
  for shelf in array_of(&get(&section,"shelves")){append(&wrapper,&screen_nodes::build_shelf(ctx,&shelf)?);}
  append(&stage,&wrapper);
 }
 append(&fragment,&stage);
 if truthy(&retained){
  style_prop(&stage,"cssText",&format!("position:absolute;left:0;top:0;width:{}px;visibility:hidden;--ihr-cabinet-width:{}px",ns(width),ns(width)));
  style_prop(&heading,"cssText","position:absolute;visibility:hidden");
 }
 append(&ctx.scroller,&fragment);
 if ctx.st_true("useScene"){
  let layout=screen_plan::read_shelf_layout(ctx,&stage,width)?;
  method(&get(&global(),"Object"),"defineProperty",&[&layout,&s("physicsReady"),&obj(&[("value",&b(pending.length()==0))])])?;
  style_prop(&stage,"cssText",&format!("--ihr-cabinet-width:{}px",ns(width)));style_prop(&heading,"cssText","");
  for child in previous{remove(&child);}
  if truthy(&retained){method(&retained,"updateLayout",&[&layout])?;}else{ctx.st_set("shelfScene",&ctx.env("createBookshelfScene",&[&layout])?);}
  method_opt(&ctx.scene(),"setPresentationActive",&[&ctx.st("presentationActive")])?;ctx.legacy("syncShelfZoom",&[])?;
 }
 if truthy(&focused_object){
  if let Some(node)=qsa(&ctx.scroller,"[data-object-id]").into_iter().find(|node|data_get(node,"objectId")==focused_object){method(&node,"focus",&[&obj(&[("preventScroll",&JsValue::TRUE)])])?;}
 }else if truthy(&focused_book){
  if let Some(node)=qsa(&ctx.scroller,".ihr-spine").into_iter().find(|node|data_get(node,"bookId")==focused_book){method(&node,"focus",&[&obj(&[("preventScroll",&JsValue::TRUE)])])?;}
 }
 ctx.st_set("metadataContext",&s(&screen_plan::metadata_context(ctx)?));
 for book in array_of(&ctx.st("books")){covers::resolve_cover_appearance(ctx,&book,&undef())?;}
 returning::settle_return_slot(ctx,false)?;
 Ok(())
}

pub fn render(ctx:&Rc<Ctx>)->R{render_inner(ctx)}

#[wasm_bindgen]
impl RustShelfCtx{
 #[wasm_bindgen(js_name=render)]pub fn render(&self)->Result<(),JsValue>{render(&self.ctx)}
}
