//! Picking an object up: the hold that lifts it, the drag across the shelf (a preview of where it would land, the
//! scroll at the edges, the bin), its release, and the reordering that follows. The pointer events themselves
//! are the browser's; the scene answers what is under the finger.
use std::rc::Rc;
use wasm_bindgen::prelude::*;
use super::{util::*,ctx::{Ctx,RustShelfCtx},objects::*,trash};

const PRESSED:&[&str]=&["is-pressed","is-press-pending"];
const DROP_TARGET:&[&str]=&["is-drop-target","is-drop-before","is-drop-after"];

fn event_number(event:&JsValue,key:&str)->f64{num(&get(event,key))}

/// `event.button !== undefined && event.button !== 0`.
fn other_button(event:&JsValue)->bool{
 let button=get(event,"button");
 !button.is_undefined()&&button!=f(0.0)
}

/// `hitTrash(x, y, node)`: whether the point is over the bin for this object.
pub fn hit_trash(ctx:&Ctx,x:f64,y:f64,node:&JsValue)->R<bool>{Ok(truthy(&hit_trash_value(ctx,x,y,node)?))}

/// `hitTrash(x, y, node)` as the scene answered it (the value goes on to the scene and to `classList.toggle`).
pub fn hit_trash_value(ctx:&Ctx,x:f64,y:f64,node:&JsValue)->R<JsValue>{
 let trash_node=get(&ctx.parts,"trashNode");
 let has_book_trash=truthy(&get(&ctx.parts,"hasBookTrash"));
 let allowed=truthy(&trash_node)&&ctx.st_str("viewMode")==ISOMETRIC&&(
  matches(node,".ihr-plant, .ihr-lamp")||(has_book_trash&&!absent(node)&&cls_has(node,"ihr-spine")));
 if !allowed{return Ok(JsValue::FALSE);}
 // The scene flushes its pending scroll frame before testing the bin. Its DOM target can still be hidden just as
 // a held object reaches the floor.
 let scene=ctx.scene();
 if truthy(&scene){return method(&scene,"hitTrash",&[&f(x),&f(y)]);}
 if gb(&trash_node,"hidden"){return Ok(JsValue::FALSE);}
 let bounds=rect(&trash_node)?;
 let (left,right,top,bottom)=(gn(&bounds,"left"),gn(&bounds,"right"),gn(&bounds,"top"),gn(&bounds,"bottom"));
 Ok(b(gn(&bounds,"width")>0.0&&gn(&bounds,"height")>0.0&&x>=left-8.0&&x<=right+8.0&&y>=top-12.0&&y<=bottom+8.0))
}

/// `updateDropPreview(drag, node)`.
pub fn update_drop_preview(ctx:&Rc<Ctx>,drag:&JsValue,node:&JsValue)->R{
 let over=hit_trash_value(ctx,gn(drag,"x"),gn(drag,"y"),node)?;
 put(drag,"overTrash",&over);
 let trash_node=get(&ctx.parts,"trashNode");
 if !absent(&trash_node){method(&class_list(&trash_node),"toggle",&[&s("is-over"),&over])?;}
 ctx.scene_call("setTrashHover",&[&over])?;
 if truthy(&over){
  put(drag,"destination",&null());
  ctx.cancel_frame_id(&get(drag,"previewFrame"));
  put(drag,"previewFrame",&f(0.0));
  ctx.scene_call("setDropPosition",&[&null()])?;
  ctx.scene_call("previewPlacements",&[&null()])?;
  return Ok(());
 }
 let destination=local_drag_destination(ctx,node,drop_position_at(ctx,gn(drag,"x"),gn(drag,"y"),node)?)?;
 put(drag,"destination",&destination);
 ctx.scene_call("setDropPosition",&[&destination])?;
 if !truthy(&destination)&&get(&ctx.scene(),"physicalPlacement")==JsValue::TRUE{
  ctx.cancel_frame_id(&get(drag,"previewFrame"));put(drag,"previewFrame",&f(0.0));
  ctx.scene_call("previewPlacements",&[&null()])?;return Ok(());
 }
 if truthy(&destination)&&!truthy(&get(drag,"previewFrame")){
  let (drag,node)=(drag.clone(),node.clone());
  let id=ctx.set_frame({let drag=drag.clone();move|ctx|{
   put(&drag,"previewFrame",&f(0.0));
   if ctx.st("dragSession")!=drag||!truthy(&get(&drag,"destination")){return Ok(());}
   let preview=preview_object_placement(ctx,&drag,&object_key(&node),&get(&drag,"destination"))?;
   if ctx.st("dragSession")!=drag||ctx.st_true("destroyed"){return Ok(());}
   ctx.scene_call("previewPlacements",&[&get(&preview,"objects"),&object_key(&node)])?;
   Ok(())
  }});
  put(&drag,"previewFrame",&id);
 }
 Ok(())
}

/// `continueDragScroll(drag, node)`: the shelf scrolls by itself while the object is held near its edge.
pub fn continue_drag_scroll(ctx:&Rc<Ctx>,drag:&JsValue,node:&JsValue)->R{
 if truthy(&get(drag,"scrollFrame"))||ctx.st_str("viewMode")==ISOMETRIC{return Ok(());}
 fn tick(ctx:&Rc<Ctx>,drag:JsValue,node:JsValue)->R{
  put(&drag,"scrollFrame",&f(0.0));
  if ctx.st("dragSession")!=drag||!gb(&drag,"active")||ctx.st_str("viewMode")==ISOMETRIC{return Ok(());}
  if gb(&drag,"overTrash"){return Ok(());}
  let bounds=rect(&ctx.scroller)?;
  let y=gn(&drag,"y");
  let delta=if y<gn(&bounds,"top")+40.0{-12.0}else if y>gn(&bounds,"bottom")-40.0{12.0}else{0.0};
  if delta==0.0{return Ok(());}
  let previous=gn(&ctx.scroller,"scrollTop");
  put(&ctx.scroller,"scrollTop",&f(previous+delta));
  if gn(&ctx.scroller,"scrollTop")==previous{return Ok(());}
  style_set(&node,"--ihr-drag-y",&format!("{}px",ns(y-gn(&drag,"startY")+gn(&ctx.scroller,"scrollTop")-gn(&drag,"scrollTop"))));
  update_drop_preview(ctx,&drag,&node)?;
  let (next_drag,next_node)=(drag.clone(),node.clone());
  let id=ctx.set_frame(move|ctx|tick(ctx,next_drag,next_node));
  put(&drag,"scrollFrame",&id);
  Ok(())
 }
 let (first_drag,first_node)=(drag.clone(),node.clone());
 let id=ctx.set_frame(move|ctx|tick(ctx,first_drag,first_node));
 put(drag,"scrollFrame",&id);
 Ok(())
}

/// `persistShelfDomOrder(oldRects)`: the order of the spines on screen becomes the order of the books.
pub fn persist_shelf_dom_order(ctx:&Rc<Ctx>,old_rects:&JsValue)->R{
 let ordered:Vec<JsValue>=shelf_spine_nodes(ctx,&undef()).iter().map(|node|data_get(node,"bookId")).filter(truthy).collect();
 let rank=new_map()?;
 for (index,id) in ordered.iter().enumerate(){map_set(&rank,&string_value(id),&f(index as f64));}
 let books:Vec<JsValue>=array_of(&ctx.st("books")).into_iter().map(|book|{
  let position=map_get(&rank,&string_value(&get(&book,"id")));
  let order=if nullish(&position){f(9007199254740991.0)}else{position};
  super::style::spread(&[&book,&obj(&[("shelfOrder",&order)])])
 }).collect();
 ctx.st_set("books",&arr(&books.iter().collect::<Vec<_>>()));
 // Storage notifies once per updated book. Keep the animated scene alive until its meshes have settled before
 // applying those refreshed records.
 ctx.clear_timeout(&ctx.st("reorderTimer"));
 ctx.st_set("reorderTimer",&f(-1.0));
 ctx.cancel_frame_id(&ctx.st("frame"));
 ctx.st_set("frame",&f(0.0));
 let order:Vec<JsValue>=array_of(&ctx.st("books")).iter().map(|book|obj(&[("id",&get(book,"id")),("shelfOrder",&get(book,"shelfOrder"))])).collect();
 let saved=ctx.option_call("onBookOrderChange",&[&arr(&order.iter().collect::<Vec<_>>())])?;
 then_map(&promise_resolve(&saved),Ok,|error|{warn("No se pudo guardar el orden de la estantería:",&error);Ok(undef())})?;
 super::screen_render::render(&ctx)?;
 // Start the quiet period after constructing the scene: on slower phones its first frame can take a significant
 // part of the animation duration.
 let timer=ctx.set_timeout(if prefers_reduced_motion(){0.0}else{560.0},|ctx|{
  ctx.st_set("reorderTimer",&f(0.0));
  super::screen_lifecycle::apply_deferred_updates(&ctx)?;
  Ok(())
 });
 ctx.st_set("reorderTimer",&timer);
 if !truthy(old_rects)||prefers_reduced_motion(){return Ok(());}
 if truthy(&ctx.scene()){ctx.scene_call("animateFromRects",&[old_rects])?;return Ok(());}
 for node in shelf_spine_nodes(ctx,&undef()){
  let old=map_get(old_rects,&data_get(&node,"bookId"));
  if !truthy(&old){continue;}
  let now=rect(&node)?;
  let dx=gn(&old,"left")-gn(&now,"left");
  let dy=gn(&old,"top")-gn(&now,"top");
  if dx.abs()+dy.abs()<1.0{continue;}
  let from=format!("translate3d({}px,{}px,64px) rotateY({}deg) rotateX(-5deg)",ns(dx),ns(dy),if dx<0.0{"-13"}else{"13"});
  method(&node,"animate",&[&arr(&[&obj(&[("transform",&s(&from))]),&obj(&[("transform",&s("translate3d(0,0,0) rotateY(0) rotateX(0)"))])]),
   &obj(&[("duration",&f(520.0)),("easing",&s("cubic-bezier(.2,.75,.22,1)"))])])?;
 }
 Ok(())
}

/// `reorderSpine(source, target, after)`.
pub fn reorder_spine(ctx:&Rc<Ctx>,source:&JsValue,target:&JsValue,after:bool)->R{
 if !truthy(source)||!truthy(target)||source==target||closest(source,".ihr-section")!=closest(target,".ihr-section"){return Ok(());}
 let old_rects=new_map()?;
 for node in shelf_spine_nodes(ctx,&undef()){map_set(&old_rects,&data_get(&node,"bookId"),&rect(&node)?);}
 let reference=if after{get(target,"nextSibling")}else{target.clone()};
 method(&get(target,"parentElement"),"insertBefore",&[source,&reference])?;
 persist_shelf_dom_order(ctx,&old_rects)
}

/// The sounds of a held object: (lift, drag along the shelf, set down, material). A lamp's material is its lamp,
/// a plant's its pot (see cozy_synth); a book slides on a wooden board.
fn object_sounds(node:&JsValue)->(u32,u32,u32,u32){
 if cls_has(node,"ihr-lamp"){(22,8,9,crate::cozy_audio::lamp_index(&text(&data_get(node,"lampId"))))}
 else if cls_has(node,"ihr-plant"){(14,11,12,crate::cozy_audio::pot_index(&text(&data_get(node,"potId"))))}
 else{(0,4,16,1)}
}
/// A soft scuff while the held object slides sideways, at most every 260 ms and only after real travel.
fn drag_scuff(ctx:&Ctx,drag:&JsValue,node:&JsValue,x:f64,y:f64){
 let (dx,dy)=(x-gn(drag,"soundX"),y-gn(drag,"soundY"));let at=now();let since=at-gn(drag,"soundAt");
 if !(since>260.0)||dx.abs()<14.0{return;}
 put(drag,"soundAt",&f(at));put(drag,"soundX",&f(x));put(drag,"soundY",&f(y));
 // Carried up or down to another board it is in the air: no scrape.
 if dx.abs()<dy.abs()*1.5{return;}
 let (_,slide,_,material)=object_sounds(node);let material=if slide==4{0}else{material};
 ctx.sound_of(slide,material,(0.2+dx.abs()/(since.min(600.0)*1.2)).min(0.6));
}

/// `startSpineDrag(event, node)`: the press that may become a hold, a scroll or a tap.
pub fn start_spine_drag(ctx:&Rc<Ctx>,event:&JsValue,node:&JsValue)->R{
 if other_button(event)||ctx.st_true("dragSession")||ctx.st_true("busy")||ctx.st_true("session")||ctx.st_true("returnMotion"){return Ok(());}
 super::screen_lifecycle::clear_compatibility_tap_refresh(&ctx);
 ctx.st_set("suppressLampClickKey",&null());
 let mut background_only=false;
 let pressed=node.clone();
 let mut node=node.clone();
 if truthy(&ctx.scene()){
  let hit=ctx.scene_call("getObjectAtPoint",&[&get(event,"clientX"),&get(event,"clientY")])?;
  background_only=!truthy(&hit);
  if truthy(&hit)&&hit!=node{cls_remove(&node,PRESSED);ctx.st_set("pressedBookId",&null());}
  if truthy(&hit){node=hit;}
 }
 if !background_only&&text(&get(event,"pointerType"))=="touch"&&matches(&node,".ihr-plant, .ihr-lamp"){
  method(event,"preventDefault",&[])?;
  let stage=closest(&node,".ihr-shelf-stage");
  let selection=method_opt(&window(),"getSelection",&[])?.unwrap_or(undef());
  if truthy(&stage)&&truthy(&selection){
   let inside=|n:JsValue|->R<bool>{Ok(truthy(&method(&stage,"contains",&[&n])?))};
   if inside(get(&selection,"anchorNode"))?||inside(get(&selection,"focusNode"))?{method(&selection,"removeAllRanges",&[])?;}
  }
 }
 if !background_only&&!absent(&ctx.scene()){
  method_opt(&ctx.scene(),"setObjectGrip",&[&node,&get(event,"clientX"),&get(event,"clientY")])?;
 }
 let drag=obj(&[
  ("node",&node),("pointerId",&get(event,"pointerId")),("startX",&get(event,"clientX")),("startY",&get(event,"clientY")),
  ("x",&get(event,"clientX")),("y",&get(event,"clientY")),("scrollTop",&get(&ctx.scroller,"scrollTop")),
  ("pointerType",&get(event,"pointerType")),("target",&null()),("after",&JsValue::FALSE),("moved",&JsValue::FALSE),
  ("active",&JsValue::FALSE),("scrolling",&JsValue::FALSE),("cancelled",&JsValue::FALSE),("timer",&f(0.0)),
  ("bookTapValid",&b(!background_only&&cls_has(&node,"ihr-spine"))),
  // The 3D hit belongs to another button than the one touched (a lamp's square over a book, or the reverse):
  // pointer capture hands the release to the hit's own button, which then owns the tap.
  ("redirected",&b(!background_only&&node!=pressed)),
  ("soundX",&get(event,"clientX")),("soundY",&get(event,"clientY")),("soundAt",&f(f64::INFINITY)),
 ]);
 ctx.st_set("dragSession",&drag);
 // The browser may have cancelled the pointer already.
 let _=method_opt(&node,"setPointerCapture",&[&get(event,"pointerId")]);
 // Rotated hit rectangles contain some empty space. It must still scroll naturally on touch, without starting a
 // hold on an occluded book.
 if background_only{cls_remove(&node,PRESSED);return Ok(());}
 let timer=ctx.set_timeout(REORDER_HOLD_MS,{let (drag,node)=(drag.clone(),node.clone());move|ctx|{
  if ctx.st("dragSession")!=drag||ctx.st_true("destroyed"){return Ok(());}
  putb(&drag,"active",true);
  ctx.st_set("arranging",&JsValue::TRUE);
  cls_add(&ctx.root,&["is-arranging"]);
  cls_remove(&node,PRESSED);
  cls_add(&node,&["is-lifted"]);
  let (lift,_,_,material)=object_sounds(&node);
  ctx.sound_of(lift,if lift==0{0}else{material},if lift==0{0.75}else{0.55});
  put(&drag,"soundAt",&f(now()));
  ctx.scene_call("flush",&[])?;
  Ok(())
 }});
 put(&drag,"timer",&timer);
 Ok(())
}

/// `moveSpineDrag(event, node)`.
pub fn move_spine_drag(ctx:&Rc<Ctx>,event:&JsValue,node:&JsValue)->R{
 let drag=ctx.st("dragSession");
 if !truthy(&drag)||get(&drag,"node")!=*node||get(&drag,"pointerId")!=get(event,"pointerId"){return Ok(());}
 let (client_x,client_y)=(event_number(event,"clientX"),event_number(event,"clientY"));
 if !gb(&drag,"active"){
  if gb(&drag,"cancelled"){return Ok(());}
  let (start_x,start_y)=(gn(&drag,"startX"),gn(&drag,"startY"));
  if hypot(client_x-start_x,client_y-start_y)>TAP_SLOP{
   ctx.clear_timeout(&get(&drag,"timer"));
   if ctx.st_str("viewMode")!=ISOMETRIC&&text(&get(&drag,"pointerType"))=="touch"&&(client_y-start_y).abs()>(client_x-start_x).abs(){
    putb(&drag,"scrolling",true);
   }else{
    putb(&drag,"cancelled",true);
   }
  }
  if gb(&drag,"scrolling"){
   method(event,"preventDefault",&[])?;
   put(&ctx.scroller,"scrollTop",&f(gn(&drag,"scrollTop")+start_y-client_y));
  }
  return Ok(());
 }
 method(event,"preventDefault",&[])?;
 put(&drag,"x",&get(event,"clientX"));put(&drag,"y",&get(event,"clientY"));
 let dx=gn(&drag,"x")-gn(&drag,"startX");
 let dy=gn(&drag,"y")-gn(&drag,"startY")+gn(&ctx.scroller,"scrollTop")-gn(&drag,"scrollTop");
 putb(&drag,"moved",true);
 drag_scuff(ctx,&drag,node,client_x,client_y);
 cls_remove(node,&["is-lifted"]);
 cls_add(node,&["is-dragging"]);
 style_set(node,"--ihr-drag-x",&format!("{}px",ns(dx)));
 style_set(node,"--ihr-drag-y",&format!("{}px",ns(dy)));
 if !truthy(&ctx.opts_get("sections")){
  update_drop_preview(ctx,&drag,node)?;
  continue_drag_scroll(ctx,&drag,node)?;
  return Ok(());
 }
 style_prop(node,"pointerEvents","none");
 let hit=closest(&method(&document(),"elementFromPoint",&[&get(event,"clientX"),&get(event,"clientY")])?,".ihr-spine");
 style_prop(node,"pointerEvents","");
 let section=closest(node,".ihr-section");
 let candidates:Vec<JsValue>=if absent(&section){Vec::new()}else{qsa(&section,".ihr-spine").into_iter().filter(|candidate|candidate!=node).collect()};
 let target=if truthy(&hit)&&hit!=*node&&closest(&hit,".ihr-section")==section{hit}else{
  let mut measured:Vec<(JsValue,f64)>=Vec::new();
  for candidate in candidates{
   let bounds=rect(&candidate)?;
   let ddx=max(max(gn(&bounds,"left")-client_x,0.0),client_x-gn(&bounds,"right"));
   let ddy=max(max(gn(&bounds,"top")-client_y,0.0),client_y-gn(&bounds,"bottom"));
   measured.push((candidate,hypot(ddx,ddy)));
  }
  measured.sort_by(|a,b|{let d=a.1-b.1;if d<0.0{std::cmp::Ordering::Less}else if d>0.0{std::cmp::Ordering::Greater}else{std::cmp::Ordering::Equal}});
  measured.into_iter().next().map(|entry|entry.0).unwrap_or(undef())
 };
 let previous=get(&drag,"target");
 if truthy(&previous){cls_remove(&previous,DROP_TARGET);}
 put(&drag,"target",&target);
 let after=if truthy(&target){
  let bounds=rect(&target)?;
  client_x>gn(&bounds,"left")+gn(&bounds,"width")/2.0
 }else{false};
 putb(&drag,"after",after);
 if truthy(&target){cls_add(&target,&["is-drop-target",if after{"is-drop-after"}else{"is-drop-before"}]);}
 Ok(())
}

/// `isTouchTapRelease(event, drag, node, candidate)`: a touch released where it started, on its own unmoved hold.
pub fn is_touch_tap_release(ctx:&Ctx,event:&JsValue,drag:&JsValue,node:&JsValue,candidate:&JsValue)->bool{
 if text(&get(event,"pointerType"))!="touch"||get(drag,"pointerId")!=get(event,"pointerId")||get(drag,"node")!=*node
  ||gb(drag,"active")||gb(drag,"moved")||gb(drag,"cancelled")||gb(drag,"scrolling")||ctx.st_true("arranging"){return false;}
 let (x,y)=(event_number(event,"clientX"),event_number(event,"clientY"));
 if truthy(candidate){
  return gb(candidate,"valid")&&!gb(candidate,"cancelled")&&hypot(x-gn(candidate,"x"),y-gn(candidate,"y"))<=TAP_SLOP;
 }
 gb(drag,"redirected")&&hypot(x-gn(drag,"startX"),y-gn(drag,"startY"))<=TAP_SLOP
}

/// `finishSpineDrag(event, node, cancelled, activateTouch)`: the release (or cancellation) of the press.
pub fn finish_spine_drag(ctx:&Rc<Ctx>,event:&JsValue,node:&JsValue,cancelled:bool,activate_touch:bool)->R{
 let drag=ctx.st("dragSession");
 if !truthy(&drag)||get(&drag,"node")!=*node||get(&drag,"pointerId")!=get(event,"pointerId"){return Ok(());}
 ctx.clear_timeout(&get(&drag,"timer"));
 clear_placement_preview(ctx,&drag)?;
 ctx.cancel_frame_id(&get(&drag,"previewFrame"));
 ctx.cancel_frame_id(&get(&drag,"scrollFrame"));
 let active_moved=gb(&drag,"active")&&gb(&drag,"moved");
 let discard=active_moved&&!cancelled&&!gb(&drag,"cancelled")&&hit_trash(ctx,
  num(&coalesce(get(event,"clientX"),get(&drag,"x"))),num(&coalesce(get(event,"clientY"),get(&drag,"y"))),node)?;
 let discard_duration=if prefers_reduced_motion(){1.0}else{820.0};
 let mut discard_motion=null();let mut discard_rect=null();
 if discard{
  // Capture the moving model before resetting its drag offset. The drop starts at the pointer, with no jump back
  // to its old slot.
  ctx.scene_call("flush",&[])?;
  discard_rect=rect(node)?;
  discard_motion=ctx.scene_call("animateObjectToTrash",&[node,&obj(&[("duration",&f(discard_duration))])])?;
 }
 if active_moved&&!discard{ctx.scene_call("flush",&[])?;}
 let old_rects=if active_moved{object_rects(ctx)?}else{null()};
 ctx.st_set("dragSession",&null());
 if cls_has(node,"ihr-lamp")&&(gb(&drag,"active")||gb(&drag,"scrolling")||gb(&drag,"cancelled")||cancelled){
  ctx.st_set("suppressLampClickKey",&object_key(node));
 }
 ctx.scene_call("setDropPosition",&[&null()])?;
 ctx.scene_call("previewPlacements",&[&null()])?;
 let trash_node=get(&ctx.parts,"trashNode");
 if !discard{
  if truthy(&trash_node){cls_remove(&trash_node,&["is-over"]);}
  ctx.scene_call("setTrashHover",&[&JsValue::FALSE])?;
 }
 let target=get(&drag,"target");
 if truthy(&target){cls_remove(&target,DROP_TARGET);}
 cls_remove(node,&["is-dragging","is-lifted","is-press-pending"]);
 style_remove(node,"--ihr-drag-x");
 style_remove(node,"--ihr-drag-y");
 style_prop(node,"pointerEvents","");
 // The capture may be released already.
 let _=method_opt(node,"releasePointerCapture",&[&get(event,"pointerId")]);
 if gb(&drag,"scrolling")||gb(&drag,"cancelled"){
  ctx.st_set("suppressOpenBookId",&string_value(&or(data_get(node,"bookId"),s(""))));
  ctx.set_timeout(0.0,|ctx|{ctx.st_set("suppressOpenBookId",&null());Ok(())});
  super::screen_lifecycle::apply_deferred_updates(&ctx)?;
  return Ok(());
 }
 if !gb(&drag,"active"){
  // Keep the validated semantic hit alive until its compatibility click or synchronous touch activation. A WebGL
  // refresh replaces it too.
  if !cancelled&&!gb(&drag,"cancelled")&&!gb(&drag,"moved")&&gb(&drag,"bookTapValid")&&(text(&get(&drag,"pointerType"))=="mouse"||activate_touch){
   super::screen_lifecycle::defer_compatibility_tap_refresh(&ctx);
  }else{
   super::screen_lifecycle::apply_deferred_updates(&ctx)?;
  }
  return Ok(());
 }
 ctx.st_set("arranging",&JsValue::FALSE);
 cls_remove(&ctx.root,&["is-arranging"]);
 ctx.st_set("suppressOpenBookId",&string_value(&or(data_get(node,"bookId"),s(""))));
 ctx.set_timeout(0.0,|ctx|{ctx.st_set("suppressOpenBookId",&null());Ok(())});
 if discard{
  let (task_ctx,task_node)=(ctx.clone(),node.clone());
  spawn(async move{trash::remove_in_trash(task_ctx,task_node,discard_motion,discard_rect,discard_duration).await});
  return Ok(());
 }
 // A book is set down by the hand; a lamp or plant lands under the physics of the 3D shelf, which plays its
 // landing (set down, or a fall when it drops from high), so only a shelf without that scene sets it down here.
 if gb(&drag,"moved")&&!cancelled{
  let (_,_,set_down,material)=object_sounds(node);
  if set_down==16||!truthy(&ctx.scene()){ctx.sound_of(set_down,material,0.45);}
 }
 if gb(&drag,"moved")&&!cancelled&&!truthy(&ctx.opts_get("sections"))&&truthy(&get(&drag,"destination")){
  persist_object_placement(ctx,node,&get(&drag,"destination"),&old_rects)?;
 }else if gb(&drag,"moved")&&!cancelled&&truthy(&target){
  reorder_spine(ctx,node,&target,gb(&drag,"after"))?;
 }else{
  ctx.scene_call("flush",&[])?;
  super::screen_lifecycle::apply_deferred_updates(&ctx)?;
 }
 Ok(())
}

#[wasm_bindgen]
impl RustShelfCtx{
 #[wasm_bindgen(js_name=hitTrash)]
 pub fn hit_trash(&self,x:f64,y:f64,node:JsValue)->Result<bool,JsValue>{hit_trash(&self.ctx,x,y,&node)}
 #[wasm_bindgen(js_name=startSpineDrag)]
 pub fn start_spine_drag(&self,event:JsValue,node:JsValue)->Result<(),JsValue>{start_spine_drag(&self.ctx,&event,&node)}
 #[wasm_bindgen(js_name=moveSpineDrag)]
 pub fn move_spine_drag(&self,event:JsValue,node:JsValue)->Result<(),JsValue>{move_spine_drag(&self.ctx,&event,&node)}
 #[wasm_bindgen(js_name=finishSpineDrag)]
 pub fn finish_spine_drag(&self,event:JsValue,node:JsValue,cancelled:JsValue,activate_touch:JsValue)->Result<(),JsValue>{
  finish_spine_drag(&self.ctx,&event,&node,truthy(&cancelled),truthy(&activate_touch))
 }
 #[wasm_bindgen(js_name=isTouchTapRelease)]
 pub fn is_touch_tap_release(&self,event:JsValue,drag:JsValue,node:JsValue,candidate:JsValue)->bool{is_touch_tap_release(&self.ctx,&event,&drag,&node,&candidate)}
 #[wasm_bindgen(js_name=reorderSpine)]
 pub fn reorder_spine(&self,source:JsValue,target:JsValue,after:JsValue)->Result<(),JsValue>{reorder_spine(&self.ctx,&source,&target,truthy(&after))}
}
