//! The book coming back from the reader: the slot it will land in is held while the shelf lays itself out,
//! then the closing book (page, ribbon, cover, flight and insertion) is played and the resting spine takes
//! its place. The 3D view, the scene and the reader's page stay the host's.
use std::{cell::RefCell,rc::{Rc,Weak}};
use wasm_bindgen::prelude::*;
use js_sys::{Array,Promise};
use super::{util::*,ctx::{Ctx,RustShelfCtx},style::*,pieces::*};

const SPINE:&str=".ihr-spine";

fn book_id_text(value:&JsValue)->JsValue{string_value(value)}
/// `[...root.querySelectorAll('.ihr-spine')].find(node => node.dataset.bookId === id)`.
fn spine_of(ctx:&Ctx,id:&JsValue)->Option<JsValue>{qsa(&ctx.root,SPINE).into_iter().find(|node|data_get(node,"bookId")==*id)}

/// `setReturningBook(bookId)`: the book that is away keeps its slot empty and the scene holds its paint.
pub fn set_returning_book(ctx:&Rc<Ctx>,book_id:&JsValue)->R{
 let next=if nullish(book_id){null()}else{book_id_text(book_id)};
 let waiter=ctx.st("returnSlotWaiter");
 if truthy(&waiter)&&get(&waiter,"bookId")!=next{finish_return_slot(ctx,false)?;}
 let scene=ctx.scene();
 method_opt(&scene,"setModalBackgroundDeferred",&[&null(),&obj(&[("resumeHidden",&JsValue::TRUE)])])?;
 let previous=ctx.st("returningBookId");
 ctx.st_set("returningBookId",&next);
 method_opt(&scene,"setPaintHeld",&[&b(next!=null())])?;
 for node in qsa(&ctx.root,SPINE){
  let id=data_get(&node,"bookId");
  if previous!=next&&id==previous{cls_remove(&node,&["is-away"]);}
  if id==next{cls_add(&node,&["is-away"]);}
 }
 Ok(())
}

/// `finishReturnSlot(ready)`.
pub fn finish_return_slot(ctx:&Rc<Ctx>,ready:bool)->R{
 let pending=ctx.st("returnSlotWaiter");
 if !truthy(&pending){return Ok(());}
 ctx.st_set("returnSlotWaiter",&null());
 if !ready&&ctx.st("returningBookId")==get(&pending,"bookId"){set_returning_book(ctx,&null())?;}
 call(&get(&pending,"resolve"),"resolve",&[&b(ready)])?;
 Ok(())
}

/// `settleReturnSlot({ beforeRender })`: the slot is ready once the shelf has laid the spine out.
pub fn settle_return_slot(ctx:&Rc<Ctx>,before_render:bool)->R{
 let pending=ctx.st("returnSlotWaiter");
 if !truthy(&pending){return Ok(());}
 let wanted=string_value(&get(&pending,"bookId"));
 let book=array_of(&ctx.st("books")).into_iter().find(|record|string_value(&get(record,"id"))==wanted);
 // `state.destroyed || !root.isConnected || !book || bookGeometryState(book) !== 'ready' || width/height changed`, in that order.
 let gone=if ctx.st_true("destroyed")||!is_connected(&ctx.root){true}else{match &book{
  Some(book)=>text(&ctx.geometry_state(book)?)!="ready",
  None=>true,
 }};
 if gone||inner_width()!=gn(&pending,"width")||inner_height()!=gn(&pending,"height"){
  return finish_return_slot(ctx,false);
 }
 // Initial analysis owns the next render; waiting for just its promise is insufficient, because its RAF has not
 // constructed the semantic slot yet. Full font matching is independent and never keeps this gate waiting.
 if !ctx.st_true("appearancesReady")||before_render{return Ok(());}
 let spine=spine_of(ctx,&wanted);
 let measured=num(&f(super::screen_plan::measure(&ctx)))>0.0;
 let known=map_has(&ctx.st("itemsById"),&wanted);
 finish_return_slot(ctx,measured&&known&&spine.map(|node|is_connected(&node)).unwrap_or(false))
}

/// `waitForReturnSlot(bookId)`.
fn wait_for_return_slot(ctx:&Rc<Ctx>,book_id:&JsValue)->R<JsValue>{
 let held=ctx.st("returningBookId")==book_id_text(book_id);
 finish_return_slot(ctx,false)?;
 if held{set_returning_book(ctx,book_id)?;}
 let (promise,resolve,_)=deferred();
 ctx.st_set("returnSlotWaiter",&obj(&[("bookId",&book_id_text(book_id)),("resolve",&resolve),("width",&f(inner_width())),("height",&f(inner_height()))]));
 settle_return_slot(ctx,false)?;
 Ok(promise)
}

#[wasm_bindgen]
impl RustShelfCtx{
 #[wasm_bindgen(js_name=setReturningBook)]
 pub fn set_returning_book(&self,book_id:JsValue)->Result<(),JsValue>{set_returning_book(&self.ctx,&book_id)}
 #[wasm_bindgen(js_name=finishReturnSlot)]
 pub fn finish_return_slot(&self,ready:bool)->Result<(),JsValue>{finish_return_slot(&self.ctx,ready)}
 #[wasm_bindgen(js_name=settleReturnSlot)]
 pub fn settle_return_slot(&self,before_render:bool)->Result<(),JsValue>{settle_return_slot(&self.ctx,before_render)}
 /// `returnToShelf(bookId, { pageSnapshot, book, onPageReady })`: closes the 3D book from the reader and puts it back.
 #[wasm_bindgen(js_name=returnToShelf)]
 pub fn return_to_shelf(&self,book_id:JsValue,options:JsValue)->JsValue{
  let ctx=self.ctx.clone();
  run(async move{return_to_shelf(ctx,book_id,options).await})
 }
}

/// The closing book while it plays: its nodes, its view and the animations that may have to be cancelled.
struct Closing{
 ctx:Rc<Ctx>,book_id:JsValue,spine:JsValue,flyout:JsValue,view:JsValue,motion:JsValue,
 animation:RefCell<JsValue>,insertion:RefCell<JsValue>,fallback:RefCell<Vec<JsValue>>,release:RefCell<JsValue>,callbacks:Callbacks,handlers:RefCell<Vec<Fun>>,
}
impl Closing{
 fn active(&self)->bool{self.ctx.st("returnMotion")==self.motion&&!self.ctx.st_true("destroyed")}
 /// `restoreShelfSpine({ flush })`: the resting spine is visible again and the scene no longer holds its paint.
 fn restore_spine(&self,flush:bool)->R<JsValue>{
  let id=book_id_text(&self.book_id);
  let current=spine_of(&self.ctx,&id).unwrap_or(self.spine.clone());
  cls_remove(&current,&["is-away"]);
  // A queued record refresh rebuilds the resting spine before the caller's final cleanup. Release this return's
  // marker with its actual landing so that rebuilt DOM cannot briefly hide the already inserted book again.
  if self.ctx.st("returningBookId")==id{
   self.ctx.st_set("returningBookId",&null());
   method_opt(&self.ctx.scene(),"setPaintHeld",&[&JsValue::FALSE])?;
  }
  if flush{self.ctx.scene_call("flush",&[])?;}
  Ok(current)
 }
 /// `motion.cancel()`.
 fn cancel(&self)->R{
  method_opt(&self.animation.borrow().clone(),"cancel",&[])?;
  let insertion=self.insertion.borrow().clone();
  if truthy(&insertion){method(&insertion,"cancel",&[])?;}
  for fallback in self.fallback.borrow().clone(){method_opt(&fallback,"cancel",&[])?;}
  self.restore_spine(true)?;
  if truthy(&self.view){method(&self.view,"dispose",&[])?;}
  remove(&self.flyout);
  if self.ctx.st("returnMotion")==self.motion{self.ctx.st_set("returnMotion",&null());}
  super::screen_lifecycle::apply_deferred_updates(&self.ctx)?;
  Ok(())
 }
 /// `releaseFrame?.()` as it stands, without forgetting it.
 fn call_release(&self)->R{
  let release=self.release.borrow().clone();
  if truthy(&release){call(&release,"release",&[])?;}
  Ok(())
 }
 /// `releaseFrame?.(); releaseFrame = null`.
 fn release_frame(&self)->R{self.call_release()?;*self.release.borrow_mut()=null();Ok(())}
 fn animation(&self,value:JsValue){*self.animation.borrow_mut()=value;}
}

async fn return_to_shelf(ctx:Rc<Ctx>,book_id:JsValue,options:JsValue)->R<JsValue>{
 // `{ pageSnapshot, book:latestBook, onPageReady } = {}`
 let options=if options.is_undefined(){obj(&[])}else{options};
 let page_snapshot=read(&options,"pageSnapshot")?;let latest_book=read(&options,"book")?;let on_page_ready=read(&options,"onPageReady")?;
 let timing=ctx.env("readerBookTiming",&[&b(prefers_reduced_motion())])?;
 let durations=get(&timing,"closing");
 let wanted=book_id_text(&book_id);
 let books=array_of(&ctx.st("books"));
 let record=books.iter().find(|book|string_value(&get(book,"id"))==wanted).cloned();
 let ready=match &record{Some(record)=>text(&ctx.geometry_state(record)?)=="ready",None=>false};
 if !ready{
  if ctx.st("returningBookId")==wanted{set_returning_book(&ctx,&null())?;}
  return Ok(JsValue::FALSE);
 }
 if (!ctx.st_true("appearancesReady")||!map_has(&ctx.st("itemsById"),&wanted))&&!truthy(&settle(wait_for_return_slot(&ctx,&book_id)?).await?){return Ok(JsValue::FALSE);}
 method_opt(&ctx.scene(),"setModalBackgroundDeferred",&[&null(),&obj(&[("resumeHidden",&JsValue::TRUE)])])?;
 let item=map_get(&ctx.st("itemsById"),&wanted);
 let last=ctx.st("lastOpened");
 let previous=if get(&get(&last,"book"),"id")==book_id&&truthy(&last){last.clone()}
  else if truthy(&item){obj(&[("book",&get(&item,"book")),("style",&get(&item,"style"))])}else{null()};
 if !truthy(&previous)||get(&get(&previous,"book"),"id")!=book_id||ctx.st_true("destroyed"){return Ok(JsValue::FALSE);}
 method_opt(&ctx.st("returnMotion"),"cancel",&[])?;
 ctx.st_set("lastOpened",&previous);
 // `state.books` is read again here: cancelling the earlier return applies the updates it had deferred.
 let current_books=array_of(&ctx.st("books"));
 let book=or(or(latest_book.clone(),current_books.iter().find(|candidate|get(candidate,"id")==book_id).cloned().unwrap_or(undef())),get(&previous,"book"));
 let mapped:Vec<JsValue>=current_books.into_iter().map(|record|if get(&record,"id")==book_id{book.clone()}else{record}).collect();
 ctx.st_set("books",&arr(&mapped.iter().collect::<Vec<_>>()));
 if truthy(&item){put(&item,"book",&book);}
 // Normally analysed while the reader was open. If not, wait briefly so the flight, the landing and the
 // resting spine share one cloth/ribbon.
 let appearance_key=super::covers::cover_key_for(&book);
 let known=map_get(&ctx.st("coverAppearances"),&wanted);
 if truthy(&item)&&!(get(&known,"key")==appearance_key&&get(&known,"complete")!=JsValue::FALSE){
  let resolving=then_map(&super::covers::resolve_cover_appearance(&ctx,&book,&undef())?,Ok,|_|Ok(null()))?;
  let (timeout,resolve,_)=deferred();
  let _timer=after(320.0,move||{let _=resolve.call1(&undef(),&null());Ok(())});
  let appearance=settle(Promise::race(&Array::of2(&resolving,&timeout)).into()).await?;
  if ctx.st_true("destroyed")||ctx.st("lastOpened")!=previous{return Ok(JsValue::FALSE);}
  if truthy(&appearance)&&apply_cover_appearance(&ctx,&item,&appearance)?{put(&previous,"style",&get(&item,"style"));}
 }
 let spine=spine_of(&ctx,&wanted).unwrap_or(get(&previous,"spineEl"));
 if !truthy(&spine)||!is_connected(&spine){ctx.st_set("lastOpened",&null());return Ok(JsValue::FALSE);}

 if ctx.st_str("viewMode")!="isometric"{method_opt(&spine,"scrollIntoView",&[&obj(&[("block",&s("nearest")),("behavior",&s("instant"))])])?;}
 ctx.scene_call("flush",&[])?;
 let rect_value=rect(&spine)?;
 let scene=ctx.scene();
 let source_pose=if absent(&scene){undef()}else{method(&scene,"getBookPose",&[&spine])?};
 let (rect_w,rect_h)=(gn(&rect_value,"width"),gn(&rect_value,"height"));
 if !(rect_w!=0.0&&!rect_w.is_nan())||!(rect_h!=0.0&&!rect_h.is_nan()){ctx.st_set("lastOpened",&null());return Ok(JsValue::FALSE);}
 let or_default=|value:f64,fallback:f64|if value.is_nan()||value==0.0{fallback}else{value};
 let vw=or_default(inner_width(),390.0);let vh=or_default(inner_height(),780.0);
 let landscape=vh<=560.0&&vw>=560.0;
 let ratio=num(&super::covers::cover_ratio_for(&ctx,&get(&previous,"style"),&undef())?);
 let has_pose=truthy(&source_pose);
 let aspect=if has_pose{gn(&source_pose,"thickness")/gn(&source_pose,"height")}else{rect_w/rect_h};
 let cover_h=min(min(min(min(vh*(if landscape{0.72}else{0.54}),if landscape{350.0}else{max(110.0,vh-330.0)}),440.0),(vw*(if landscape{0.35}else{0.78}))/ratio),(vw*0.86)/(ratio+aspect*0.55));
 let cover_w=cover_h*ratio;
 let start_scale=if has_pose{gn(&source_pose,"scale")*gn(&source_pose,"height")/cover_h}else{rect_h/cover_h};
 let thickness=if has_pose{gn(&source_pose,"thickness")*cover_h/gn(&source_pose,"height")}else{max(6.0,rect_w/start_scale)};
 let center_x=vw*(if landscape{0.26}else{0.5})+thickness*0.19;
 let center_y=vh*(if landscape{0.5}else{0.42});
 let reading_pose=ctx.env("planReadingBookPose",&[&obj(&[("width",&f(cover_w)),("height",&f(cover_h)),("thickness",&f(thickness)),("viewportWidth",&f(vw)),("viewportHeight",&f(vh)),("centerX",&f(center_x)),("centerY",&f(center_y))])])?;
 let dx=(if has_pose&&!nullish(&get(&source_pose,"centerX")){gn(&source_pose,"centerX")}else{gn(&rect_value,"left")+rect_w/2.0})-center_x;
 let dy=(if has_pose&&!nullish(&get(&source_pose,"centerY")){gn(&source_pose,"centerY")}else{gn(&rect_value,"top")+rect_h/2.0})-center_y;
 let lift=min(40.0,rect_h*0.2);
 let docking=if absent(&scene){undef()}else{method(&scene,"getReturnPose",&[&spine])?};
 let target=if truthy(&docking){docking.clone()}else{source_pose.clone()};
 let has_target=truthy(&target);
 let target_num=|key:&str,fallback:f64|->f64{let value=get(&target,key);if !has_target||nullish(&value){fallback}else{num(&value)}};
 let end=obj(&[
  ("x",&f((if has_target&&!nullish(&get(&target,"centerX")){gn(&target,"centerX")}else{center_x+dx})-center_x)),
  ("y",&f((if has_target&&!nullish(&get(&target,"centerY")){gn(&target,"centerY")}else{center_y+dy})-center_y)),
  ("scale",&f(if has_target{gn(&target,"scale")*gn(&target,"height")/cover_h}else{start_scale})),
  ("angle",&f(target_num("angle",90.0))),("pitch",&f(target_num("pitch",0.0))),("roll",&f(target_num("roll",0.0)))]);
 let (end_x,end_y,end_angle)=(gn(&end,"x"),gn(&end,"y"),gn(&end,"angle"));
 let stage=El::new("div").class("ihr-flyout__stage").done();
 let book_node=El::new("div").class("ihr-flyout__book").style(&format!("left:{}px;top:{}px;width:{}px;height:{}px",ns((vw-cover_w)/2.0),ns(center_y-cover_h/2.0),ns(cover_w),ns(cover_h))).done();
 append(&stage,&book_node);
 let scrim=El::new("div").class("ihr-flyout__scrim").style("opacity:0").done();
 let flyout=El::new("div").class("ihr-flyout ihr-flyout--return").attr("aria-hidden","true").style("visibility:hidden").child(&scrim).child(&stage).done();
 puts(&dataset(&flyout),"returnPhase","preparing");
 let cover_url=super::covers::resolve_cover_immediately(&ctx,&book)?;
 let stale=|ctx:&Ctx|ctx.st_true("destroyed")||ctx.st("lastOpened")!=previous||inner_width()!=vw||inner_height()!=vh;
 if stale(&ctx){return Ok(JsValue::FALSE);}
 let geometry=obj(&[("width",&f(cover_w)),("height",&f(cover_h)),("thickness",&f(thickness)),("viewportWidth",&f(vw)),("viewportHeight",&f(vh)),("centerX",&f(center_x)),("centerY",&f(center_y))]);
 let views=ctx.legacy_value("returnViews");
 let has_source=truthy(&get(&page_snapshot,"source"));
 let cached_view=if has_source{
  let previous_style=get(&previous,"style");
  let signature=ctx.env("bookReturnSignature",&[&book,&previous_style,&geometry,&cover_url])?;
  let compatibility=ctx.env("bookReturnCompatibility",&[&book,&previous_style,&geometry])?;
  let request=obj(&[("signature",&signature),("compatibility",&compatibility),("book",&book),("style",&previous_style),("coverUrl",&cover_url)]);
  settle(method(&views,"takeCompatible",&[&request])?).await?
 }else{method(&views,"take",&[&null()])?};
 if stale(&ctx){method_opt(&cached_view,"dispose",&[])?;return Ok(JsValue::FALSE);}
 if truthy(&cached_view){
  method_opt(&cached_view,"deferDrawing",&[])?;
  append(&book_node,&get(&cached_view,"canvas"));
  method(&cached_view,"updateBookmark",&[&book])?;
 }
 let view=if truthy(&cached_view){cached_view.clone()}else{
  let initial=obj(&[("x",&f(0.0)),("y",&f(0.0)),("scale",&f(1.0)),("angle",&f(0.0)),("pitch",&f(0.0)),
   ("coverOpen",&f(if truthy(&page_snapshot){1.0}else{0.0})),("bookmarkWithdraw",&f(if truthy(&page_snapshot){1.0}else{0.0}))]);
  let dimensions=obj(&[("width",&f(cover_w)),("height",&f(cover_h)),("thickness",&f(thickness)),("viewportWidth",&f(vw)),("viewportHeight",&f(vh)),("centerX",&f(center_x)),("centerY",&f(center_y)),
   ("coverUrl",&cover_url),("deferDraw",&b(has_source)),("compactReturnFrame",&b(has_source)),("adaptiveNativeFrame",&JsValue::TRUE),("initialPose",&initial)]);
  ctx.env("bookView",&[&book_node,&book,&get(&previous,"style"),&dimensions])?
 };
 let has_view=truthy(&view);
 if has_view{
  puts(&dataset(&flyout),"returnView",if truthy(&cached_view){"reused"}else{"created"});
  cls_add(&book_node,&["ihr-flyout__book--webgl"]);
  put(&style(&book_node),"cssText",&s("position:absolute;inset:0;width:100%;height:100%"));
 }else{
  cls_add(&book_node,&["ihr-flyout__book--fallback"]);
  put(&style(&book_node),"cssText",&s(&format!("position:absolute;width:{}px;height:{}px;left:{}px;top:{}px",ns(cover_w),ns(cover_h),ns((vw-cover_w)/2.0),ns(center_y-cover_h/2.0))));
  let pages=El::new("div").class("ihr-flyout__fallback-pages").done();
  let inside=El::new("div").class("ihr-flyout__face ihr-flyout__face--inside").done();
  let leaf=El::new("div").class("ihr-flyout__fallback-leaf").child(&build_cover_face(&ctx,&book,&cover_url,&get(&previous,"style"))?).child(&inside).done();
  append_all(&book_node,&[&pages,&leaf]);
 }
 append(&get(&document(),"body"),&flyout);
 cls_add(&spine,&["is-away"]);
 method_opt(&ctx.scene(),"updateEntry",&[&spine,&book,&get(&previous,"style"),&cover_url])?;
 ctx.scene_call("flush",&[])?;
 let duration=num(&get(&durations,"flight"));
 let approach=if has_view&&truthy(&docking){duration*0.66}else{duration};
 let closing=Rc::new(Closing{ctx:ctx.clone(),book_id:book_id.clone(),spine:spine.clone(),flyout:flyout.clone(),view:view.clone(),motion:obj(&[]),
  animation:RefCell::new(null()),insertion:RefCell::new(null()),fallback:RefCell::new(Vec::new()),release:RefCell::new(undef()),callbacks:Callbacks::new(),handlers:RefCell::new(Vec::new())});
 {
  let weak:Weak<Closing>=Rc::downgrade(&closing);
  let cancel=closing.callbacks.make(Stale::Undefined,move|_,_|{if let Some(closing)=weak.upgrade(){closing.cancel()?;}Ok(undef())});
  put(&closing.motion,"cancel",&cancel);
 }
 ctx.st_set("returnMotion",&closing.motion);
 let outcome=play(&ctx,&closing,PlayInput{page_snapshot:page_snapshot.clone(),on_page_ready,durations:durations.clone(),reading_pose,scrim,book_node,
  cover_w,cover_h,approach,duration,docking:docking.clone(),dx,dy,lift,start_scale,end,end_x,end_y,end_angle,spine:spine.clone(),book_id:wanted.clone(),has_view}).await;
 // `catch (error) { motion.cancel(); throw error } finally { releaseFrame?.() }`: a failure of the release
 // replaces whatever was being thrown.
 match outcome{
  Ok(value)=>{closing.call_release()?;Ok(value)}
  Err(error)=>{let cancelled=closing.cancel();closing.call_release()?;cancelled?;Err(error)}
 }
}

struct PlayInput{
 page_snapshot:JsValue,on_page_ready:JsValue,durations:JsValue,reading_pose:JsValue,scrim:JsValue,book_node:JsValue,cover_w:f64,cover_h:f64,approach:f64,duration:f64,
 docking:JsValue,dx:f64,dy:f64,lift:f64,start_scale:f64,end:JsValue,end_x:f64,end_y:f64,end_angle:f64,spine:JsValue,book_id:JsValue,has_view:bool,
}

/// The `try` of the original: `Ok(false)` where it returned early.
async fn play(ctx:&Rc<Ctx>,closing:&Rc<Closing>,input:PlayInput)->R<JsValue>{
 let PlayInput{page_snapshot,on_page_ready,durations,reading_pose,scrim,book_node,cover_w,cover_h,approach,duration,docking,dx,dy,lift,start_scale,end,end_x,end_y,end_angle,spine,book_id,has_view}=input;
 let view=closing.view.clone();let flyout=closing.flyout.clone();
 let has_source=truthy(&get(&page_snapshot,"source"));
 if has_view{settle(get(&view,"ready")).await?;}
 *closing.release.borrow_mut()=method_opt(&view,"holdNativeMotionFrame",&[])?.unwrap_or(undef());
 if !closing.active(){return Ok(JsValue::FALSE);}
 if has_source&&has_view{method_opt(&view,"deferDrawing",&[])?;method_opt(&view,"setCompactReturnFrame",&[&JsValue::TRUE])?;}
 let zoom=num(&get(&durations,"zoom"));let bookmark=num(&get(&durations,"bookmark"));let cover=num(&get(&durations,"cover"));
 let ease_timing=|duration:f64|obj(&[("duration",&f(duration)),("easing",&s(EASE)),("fill",&s("both"))]);
 if has_source&&has_view&&truthy(&method(&view,"setPageSnapshot",&[&page_snapshot])?){
  method(&view,"draw",&[&spread(&[&reading_pose,&obj(&[("bookmarkWithdraw",&f(1.0))])]),&obj(&[("redraw",&JsValue::FALSE)])])?;
  if !truthy(&method(&view,"alignToPage",&[&get(&page_snapshot,"displayBounds")])?){return Err(error("No se pudo alinear la página al cerrar el libro."));}
  method_opt(&ctx.scene(),"setPaintHeld",&[&JsValue::FALSE])?;ctx.scene_call("flush",&[])?;
  style_prop(&flyout,"visibility","");
  if !absent(&on_page_ready){call(&on_page_ready,"onPageReady",&[])?;}
  puts(&dataset(&flyout),"returnPhase","zooming");
  animate(&scrim,&arr(&[&obj(&[("opacity",&f(0.0))]),&obj(&[("opacity",&f(1.0))])]),&obj(&[("duration",&f(if prefers_reduced_motion(){1.0}else{320.0})),("fill",&s("both"))]))?;
  // Back to white paper on the zoom's own clock: the page leaves the reader in its theme (as the still image
  // shows it) and the book closes on white paper.
  let theme=if truthy(&get(&page_snapshot,"paper")){obj(&[("pageTheme",&f(0.0))])}else{obj(&[])};
  let animation=method(&view,"animate",&[&arr(&[&obj(&[("transform",&method(&view,"getPose",&[])?)]),&obj(&[("transform",&spread(&[&reading_pose,&obj(&[("bookmarkWithdraw",&f(1.0))]),&theme]))])]),&obj(&[("duration",&f(zoom))])])?;
  closing.animation(animation.clone());
  wait_for_motion(&animation,zoom).await?;
  if !closing.active(){return Ok(JsValue::FALSE);}
  // The zoom's large framebuffer no longer needs to survive the ribbon, hinge and flight. Their existing
  // per-motion reservations retain the exact projected book at the same DPR without keeping empty pixels.
  closing.release_frame()?;
  // White paper from here on, even if a stalled frame let the zoom's watchdog release it early.
  if truthy(&get(&page_snapshot,"paper"))&&num(&method(&view,"getPageTheme",&[])?)>0.0{method(&view,"setPageTheme",&[&f(0.0)])?;}
  puts(&dataset(&flyout),"returnPhase","bookmark");ctx.sound_of(21,0,0.5);
  let animation=method(&view,"animateBookmark",&[&obj(&[("withdraw",&f(0.0)),("duration",&f(bookmark))])])?;
  closing.animation(animation.clone());
  wait_for_motion(&animation,bookmark).await?;
  if !closing.active(){return Ok(JsValue::FALSE);}
  puts(&dataset(&flyout),"returnPhase","closing");
  let animation=method(&view,"animateCoverClose",&[&obj(&[("duration",&f(cover)),("targetPose",&obj(&[("x",&f(0.0)),("y",&f(0.0)),("scale",&f(1.0)),("angle",&f(0.0)),("pitch",&f(0.0)),("roll",&f(0.0))]))])])?;
  closing.animation(animation.clone());
  wait_for_motion(&animation,cover).await?;
  if !closing.active(){return Ok(JsValue::FALSE);}
  ctx.sound_of(19,0,0.6);
 }else if has_source&&!has_view{
  let pages=qs(&book_node,".ihr-flyout__fallback-pages");
  let leaf=qs(&book_node,".ihr-flyout__fallback-leaf");
  // The still-page layer owns the snapshot's DOM canvas until handoff. Only the non-WebGL fallback needs a second
  // DOM copy for its leaf.
  let image=ctx.env("readerReturnCanvas",&[&get(&page_snapshot,"source")])?;
  put(&dataset(&image),"pageSource",&or(get(&page_snapshot,"sourceType"),get(&page_snapshot,"engine")));
  puts(&dataset(&image),"pageLocator",&json(&coalesce(get(&get(&page_snapshot,"location"),"locator"),null()))?);
  let page_w=cover_w*0.92;let page_h=cover_h*0.975;
  let (snap_w,snap_h)=(gn(&page_snapshot,"width"),gn(&page_snapshot,"height"));
  let fit=min(page_w/snap_w,page_h/snap_h);
  puts(&image,"className","ihr-flyout__saved-page");
  put(&style(&image),"cssText",&s(&format!("position:absolute;width:{}px;height:{}px;left:{}px;top:{}px",ns(snap_w*fit),ns(snap_h*fit),ns((page_w-snap_w*fit)/2.0),ns((page_h-snap_h*fit)/2.0))));
  replace_children(&pages,&fallback_page_layers(&image,&page_snapshot,1.0));style_prop(&leaf,"transform","rotateY(-169deg)");
  let bounds=get(&page_snapshot,"displayBounds");
  let local=rect(&image)?;let scale=gn(&bounds,"width")/gn(&local,"width");
  let book_bounds=rect(&book_node)?;
  let x=gn(&bounds,"left")+gn(&bounds,"width")/2.0-gn(&local,"left")-gn(&local,"width")/2.0+(1.0-scale)*(gn(&local,"left")+gn(&local,"width")/2.0-gn(&book_bounds,"left")-gn(&book_bounds,"width")/2.0);
  let y=gn(&bounds,"top")+gn(&bounds,"height")/2.0-gn(&local,"top")-gn(&local,"height")/2.0+(1.0-scale)*(gn(&local,"top")+gn(&local,"height")/2.0-gn(&book_bounds,"top")-gn(&book_bounds,"height")/2.0);
  let start_transform=format!("translate({}px,{}px) scale({})",ns(x),ns(y),ns(scale));
  style_prop(&book_node,"transform",&start_transform);
  method_opt(&ctx.scene(),"setPaintHeld",&[&JsValue::FALSE])?;ctx.scene_call("flush",&[])?;
  style_prop(&flyout,"visibility","");
  if !absent(&on_page_ready){call(&on_page_ready,"onPageReady",&[])?;}
  puts(&dataset(&flyout),"returnPhase","zooming");
  let animation=animate(&book_node,&arr(&[&obj(&[("transform",&get(&style(&book_node),"transform"))]),&obj(&[("transform",&s("translate(0,0) scale(1)"))])]),&ease_timing(zoom))?;
  closing.animation(animation.clone());closing.fallback.borrow_mut().push(animation.clone());
  if truthy(&get(&get(&page_snapshot,"paper"),"source")){
   let fade=animate(&image,&arr(&[&obj(&[("opacity",&f(1.0))]),&obj(&[("opacity",&f(0.0))])]),&ease_timing(zoom))?;
   closing.fallback.borrow_mut().push(fade);
  }
  wait_for_motion(&animation,zoom).await?;
  if !closing.active(){return Ok(JsValue::FALSE);}
  style_prop(&book_node,"transform","translate(0,0) scale(1)");method_opt(&animation,"cancel",&[])?;
  puts(&dataset(&flyout),"returnPhase","bookmark");ctx.sound_of(21,0,0.5);
  let ribbon=El::new("div").class("ihr-flyout__return-ribbon").done();append(&pages,&ribbon);
  let animation=animate(&ribbon,&arr(&[&obj(&[("transform",&s("translateY(-130%)"))]),&obj(&[("transform",&s("translateY(0)"))])]),&obj(&[("duration",&f(bookmark)),("fill",&s("both")),("easing",&s(EASE))]))?;
  closing.animation(animation.clone());closing.fallback.borrow_mut().push(animation.clone());wait_for_motion(&animation,bookmark).await?;
  if !closing.active(){return Ok(JsValue::FALSE);}
  puts(&dataset(&flyout),"returnPhase","closing");
  let animation=animate(&leaf,&arr(&[&obj(&[("transform",&s("rotateY(-169deg)"))]),&obj(&[("transform",&s("rotateY(0deg)"))])]),&obj(&[("duration",&f(cover)),("fill",&s("both")),("easing",&s(EASE))]))?;
  closing.animation(animation.clone());closing.fallback.borrow_mut().push(animation.clone());wait_for_motion(&animation,cover).await?;
  if !closing.active(){return Ok(JsValue::FALSE);}
  ctx.sound_of(19,0,0.6);
 }
 method_opt(&ctx.scene(),"setPaintHeld",&[&JsValue::FALSE])?;ctx.scene_call("flush",&[])?;
 style_prop(&flyout,"visibility","");
 if !absent(&on_page_ready){call(&on_page_ready,"onPageReady",&[])?;}
 puts(&dataset(&flyout),"returnPhase","returning");
 animate(&scrim,&arr(&[&obj(&[("opacity",&f(if truthy(&page_snapshot){1.0}else{0.0}))]),&obj(&[("opacity",&f(0.0))])]),&obj(&[("duration",&f(approach)),("fill",&s("both"))]))?;
 let pose=|x:f64,y:f64,scale:f64,angle:f64,pitch:f64|->JsValue{obj(&[("x",&f(x)),("y",&f(y)),("scale",&f(scale)),("angle",&f(angle)),("pitch",&f(pitch))])};
 let flight=if has_view{
  method(&view,"animate",&[&arr(&[
   &obj(&[("transform",&pose(0.0,0.0,1.0,0.0,0.0)),("offset",&f(0.0))]),
   &obj(&[("transform",&pose(-dx*0.12,-lift*0.5,0.94,12.0,3.0)),("offset",&f(0.22))]),
   &obj(&[("transform",&pose(end_x*0.38,end_y*0.38-lift,start_scale+(1.0-start_scale)*0.38,end_angle*0.7,4.0)),("offset",&f(0.68))]),
   &obj(&[("transform",&end),("offset",&f(1.0))]),
  ]),&obj(&[("duration",&f(approach))])])?
 }else{
  animate(&book_node,&arr(&[
   &obj(&[("opacity",&f(1.0)),("transform",&s("translate(0,0) scale(1)"))]),
   &obj(&[("opacity",&f(0.85)),("transform",&s(&format!("translate({}px, {}px) scale({})",ns(dx),ns(dy),ns(start_scale))))]),
  ]),&ease_timing(duration))?
 };
 closing.animation(flight.clone());
 wait_for_motion(&flight,approach).await?;
 if closing.ctx.st("returnMotion")==closing.motion&&has_view&&truthy(&docking)&&!ctx.st_true("destroyed"){
  puts(&dataset(&flyout),"returnPhase","inserting");
  let remaining=duration-approach;
  let weak=Rc::downgrade(closing);let for_spine=spine.clone();
  let start=fun(move|presentation,_|match weak.upgrade(){
   Some(closing)=>closing.ctx.scene_call("returnBook",&[&for_spine,&obj(&[("duration",&f(remaining)),("overlayCanvas",&get(&closing.view,"canvas")),("nativePresentation",&presentation)])]),
   None=>Ok(undef()),
  });
  let mut insertion=method_opt(&view,"handoffToShelfInsertion",&[&start.function])?.unwrap_or(undef());
  closing.handlers.borrow_mut().push(start);
  if !truthy(&insertion){
   method_opt(&view,"releaseToSnapshot",&[])?;
   insertion=ctx.scene_call("returnBook",&[&spine,&obj(&[("duration",&f(remaining)),("overlayCanvas",&get(&view,"canvas"))])])?;
  }
  *closing.insertion.borrow_mut()=insertion.clone();
  if truthy(&insertion){wait_for_motion(&insertion,remaining).await?;}
  if closing.ctx.st("returnMotion")==closing.motion{ctx.sound_of(16,1,0.55);}
 }
 if closing.ctx.st("returnMotion")==closing.motion{
  ctx.st_set("returnMotion",&null());
  method_opt(&flight,"cancel",&[])?;
  for fallback in closing.fallback.borrow().clone(){method_opt(&fallback,"cancel",&[])?;}
  // A queued layout paints the landed book itself. Keep the insertion owner alive until that paint instead of
  // drawing the old room first.
  closing.restore_spine(false)?;
  super::screen_lifecycle::apply_deferred_updates(&ctx)?;
  // With no queued layout, this flush still paints the restored spine.
  ctx.scene_call("flush",&[])?;
  if has_view{method(&view,"dispose",&[])?;}
  remove(&flyout);
  ctx.st_set("lastOpened",&null());
  let current=spine_of(ctx,&book_id).unwrap_or(spine.clone());
  method_opt(&current,"focus",&[&obj(&[("preventScroll",&JsValue::TRUE)])])?;
  super::covers::maybe_refresh_appearance_styles(ctx)?;
  return Ok(JsValue::TRUE);
 }
 Ok(JsValue::FALSE)
}
