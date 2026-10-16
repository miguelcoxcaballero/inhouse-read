//! The motions of the lifted book after it is ready: warming the page it opens on, the tap that expands the
//! cover, the hand-over to the reader (cover, ribbon, zoom, fade) and the way back to the shelf when it is
//! dismissed.
use std::rc::Rc;
use wasm_bindgen::prelude::*;
use js_sys::Array;
use super::{util::*,flyout::*,pieces::*,style::spread};

const PAGE_EASE:&str="cubic-bezier(.2,.74,.2,1)";

impl Flyout{
 /// `playReturn`: the book flies back to its slot and slides in.
 pub(super) async fn play_return(self:&Rc<Self>)->R{
  let return_duration=if prefers_reduced_motion(){1.0}else{num(&self.ctx.opts_get("returnDuration"))};
  self.scene_do("flush",&[])?;
  let docking=if self.has_view(){self.scene_do("getReturnPose",&[&self.spine()])?}else{self.view.clone()};
  let target=if truthy(&docking){docking.clone()}else{self.scene_do("getBookPose",&[&self.spine()])?};
  let g=self.geo;
  let end=if truthy(&target){
   let roll=get(&target,"roll");
   obj(&[("x",&f(gn(&target,"centerX")-g.center_x)),("y",&f(gn(&target,"centerY")-g.center_y)),("scale",&f(gn(&target,"scale")*gn(&target,"height")/g.cover_h)),
    ("angle",&get(&target,"angle")),("pitch",&get(&target,"pitch")),("roll",&if nullish(&roll){f(0.0)}else{roll})])
  }else{let start=self.start.borrow().clone();Flyout::tf(start.dx,start.dy,start.scale,90.0)};
  let approach=if truthy(&docking){return_duration*0.66}else{return_duration};
  let (end_x,end_y,end_angle)=(gn(&end,"x"),gn(&end,"y"),gn(&end,"angle"));
  let frames=arr(&[
   &obj(&[("transform",&Flyout::tf(0.0,0.0,1.0,0.0))]),
   &obj(&[("offset",&f(0.45)),("transform",&Flyout::tf(end_x*0.45,end_y*0.35-self.lift*0.6,self.scale_at(0.55),end_angle*0.7))]),
   &obj(&[("transform",&end)]),
  ]);
  let back=self.animate_book(&frames,&obj(&[("duration",&f(approach)),("easing",&s(EASE)),("fill",&s("both"))]))?;
  put(&self.session,"returnAnimation",&back);
  animate(&self.scrim,&arr(&[&obj(&[("opacity",&f(1.0))]),&obj(&[("opacity",&f(0.0))])]),&obj(&[("duration",&f(approach)),("easing",&s(EASE)),("fill",&s("both"))]))?;
  wait_for_motion(&back,approach).await?;
  if truthy(&docking)&&!self.destroyed()&&self.is_session(){
   let remaining=return_duration-approach;
   let spine=self.spine();
   let canvas=get(&self.view,"canvas");
   // The callback may be kept by the view for the length of the hand-over: it lives with the session.
   let weak=self.weak();let for_spine=spine.clone();let for_canvas=canvas.clone();
   let start=fun(move|presentation,_|match weak.upgrade(){
    Some(flyout)=>flyout.scene_opt("returnBook",&[&for_spine,&obj(&[("duration",&f(remaining)),("overlayCanvas",&for_canvas),("nativePresentation",&presentation)])]),
    None=>Ok(undef()),
   });
   let mut insertion=method_opt(&self.view,"handoffToShelfInsertion",&[&start.function])?.unwrap_or(undef());
   self.handlers.borrow_mut().push(start);
   if !truthy(&insertion){
    method_opt(&self.view,"releaseToSnapshot",&[])?;
    insertion=self.scene_do("returnBook",&[&spine,&obj(&[("duration",&f(remaining)),("overlayCanvas",&canvas)])])?;
   }
   put(&self.session,"insertion",&insertion);
   if truthy(&insertion){
    // The shelf scene owns the mesh and depth buffer for insertion. Its full-screen output keeps edge books
    // clear of the scroller's clip.
    wait_for_motion(&insertion,remaining).await?;
   }
  }
  Ok(())
 }

 /// `installOpeningPage(snapshot, { redraw })`: puts the page the book will open on into the model (or the DOM fallback).
 pub(super) fn install_opening_page(&self,snapshot:&JsValue,redraw:bool)->R<bool>{
  if !truthy(&get(snapshot,"source")){return Ok(false);}
  // The book opens on white paper whatever the reading theme: the snapshot's white-paper variant starts at
  // pageTheme 0 and fades to the theme on the zoom. A page warmed up while the book waited is already on the model.
  if self.has_view(){
   // Prepare the real current-page ribbon with the opening page, so its first material is ready before
   // returning from an unread book.
   let position=self.ctx.env("persistablePosition",&[&get(snapshot,"location")])?;
   if truthy(&position){
    let updated=spread(&[&self.book,&obj(&[("progressFraction",&get(&position,"fraction")),("locator",&get(&position,"locator"))])]);
    method_opt(&self.view,"updateBookmark",&[&updated,&obj(&[("redraw",&JsValue::FALSE)])])?;
   }
   let paper=truthy(&get(snapshot,"paper"));
   if !truthy(&method(&self.view,"hasPageSnapshot",&[snapshot])?){
    let options=spread(&[&if paper{obj(&[("pageTheme",&f(0.0))])}else{obj(&[])},&obj(&[("redraw",&b(redraw))])]);
    return Ok(truthy(&method(&self.view,"setPageSnapshot",&[snapshot,&options])?));
   }
   // A tap may interrupt the idle warm-up after installation but before its final draw. Commit the white page
   // before announcing the opening phase.
   let theme=if paper{obj(&[("pageTheme",&f(0.0))])}else{obj(&[])};
   if redraw{
    let committed=method_opt(&self.view,"commitPreparedPage",&[snapshot,&theme])?.map(|v|truthy(&v)).unwrap_or(false);
    if !committed{method(&self.view,"draw",&[&spread(&[&method(&self.view,"getPose",&[])?,&theme])])?;}
   }
   return Ok(true);
  }
  let pages=qs(&self.book_node,".ihr-flyout__fallback-pages");
  if !truthy(&pages){return Ok(false);}
  let canvas=get(snapshot,"source");
  let g=self.geo;
  let (page_w,page_h)=(g.cover_w*0.92,g.cover_h*0.975);
  let (snap_w,snap_h)=(gn(snapshot,"width"),gn(snapshot,"height"));
  let scale=min(page_w/snap_w,page_h/snap_h);
  puts(&canvas,"className","ihr-flyout__saved-page");
  put(&style(&canvas),"cssText",&s(&format!("position:absolute;width:{}px;height:{}px;left:{}px;top:{}px",ns(snap_w*scale),ns(snap_h*scale),ns((page_w-snap_w*scale)/2.0),ns((page_h-snap_h*scale)/2.0))));
  let source=or(get(snapshot,"sourceType"),get(snapshot,"engine"));
  put(&dataset(&canvas),"pageSource",&source);
  let locator=coalesce(get(&get(snapshot,"location"),"locator"),null());
  puts(&dataset(&canvas),"pageLocator",&json(&locator)?);
  let page_text=method(&or(get(snapshot,"text"),s("")),"slice",&[&f(0.0),&f(3000.0)])?;
  put(&dataset(&canvas),"pageText",&page_text);
  replace_children(&pages,&fallback_page_layers(&canvas,snapshot,0.0));
  Ok(true)
 }

 /// The page this book will open on arrives while the cover still waits for a tap (the cover is closed, so it
 /// stays hidden behind it). Textures and programs are built here, in separate idle slices, so the tap only has
 /// to play the animation. Resolves to false when it could not (or need not) be done.
 async fn warm_opening_page(self:Rc<Self>,snapshot:JsValue,idle:JsValue)->R<JsValue>{
  let stale=|me:&Flyout|me.cancelled()||me.destroyed()||!me.is_session()||me.phase()!="ready";
  if !self.has_view()||stale(&self)||!self.install_opening_page(&snapshot,false)?{return Ok(JsValue::FALSE);}
  settle(call(&idle,"idle",&[])?).await?;
  let has_page=|me:&Flyout|->R<bool>{Ok(truthy(&method(&me.view,"hasPageSnapshot",&[&snapshot])?))};
  if stale(&self)||!has_page(&self)?{return Ok(JsValue::FALSE);}
  if truthy(&get(&self.view,"preparePagePrograms")){
   let weak=self.weak();let watched=snapshot.clone();
   let keep_going=fun(move|_,_|match weak.upgrade(){
    Some(flyout)=>Ok(b(!(flyout.cancelled()||flyout.destroyed()||!flyout.is_session()||flyout.phase()!="ready")&&truthy(&method(&flyout.view,"hasPageSnapshot",&[&watched])?))),
    None=>Ok(JsValue::FALSE),
   });
   let pending=method(&self.view,"preparePagePrograms",&[&idle,&keep_going.function]);
   self.handlers.borrow_mut().push(keep_going);
   settle(pending?).await?;
  }else{method(&self.view,"compilePage",&[])?;}
  if stale(&self)||!has_page(&self)?{return Ok(JsValue::FALSE);}
  let textures=method(&self.view,"pageTextures",&[])?;
  for texture in Array::from(&textures).iter(){
   settle(call(&idle,"idle",&[])?).await?;
   if stale(&self)||!has_page(&self)?{return Ok(JsValue::FALSE);}
   method(&self.view,"uploadPageTexture",&[&texture])?;
  }
  settle(call(&idle,"idle",&[])?).await?;
  if stale(&self)||!has_page(&self)?{return Ok(JsValue::FALSE);}
  // links the page's programs and renders the covered page once
  method(&self.view,"draw",&[&method(&self.view,"getPose",&[])?])?;
  self.ctx.env("markTiming",&[&s("textures-uploaded")])?;
  Ok(JsValue::TRUE)
 }

 /// `animateBookToPage(target)`: the same textured leaf moves into its final place over the reader's page.
 async fn animate_book_to_page(self:Rc<Self>,target:JsValue)->R{
  if self.cancelled()||self.destroyed(){return Ok(());}
  let duration=gn(&target,"duration");
  if self.has_view(){
   // The pages fade from white paper to the reader's theme with the zoom itself.
   let zoom=method(&self.view,"animateToPage",&[&spread(&[&target,&obj(&[("pageTheme",&f(1.0))])])])?;
   put(&self.session,"pageZoom",&zoom);
   wait_for_motion(&zoom,duration).await?;
   return Ok(());
  }
  let page=qs(&self.book_node,".ihr-flyout__saved-page");
  let bounds=if truthy(&page){method(&page,"getBoundingClientRect",&[])?}else{undef()};
  if !truthy(&get(&bounds,"width"))||!truthy(&get(&bounds,"height")){return Ok(());}
  if truthy(&qs(&self.book_node,".ihr-flyout__saved-page-stock")){
   animate(&page,&arr(&[&obj(&[("opacity",&f(0.0))]),&obj(&[("opacity",&f(1.0))])]),&obj(&[("duration",&f(duration)),("easing",&s(PAGE_EASE)),("fill",&s("both"))]))?;
  }
  let scale=gn(&target,"width")/gn(&bounds,"width");
  let book_bounds=rect(&self.book_node)?;
  let image_x=gn(&bounds,"left")+gn(&bounds,"width")/2.0;let image_y=gn(&bounds,"top")+gn(&bounds,"height")/2.0;
  let dx=gn(&target,"left")+gn(&target,"width")/2.0-image_x+(1.0-scale)*(image_x-gn(&book_bounds,"left")-gn(&book_bounds,"width")/2.0);
  let dy=gn(&target,"top")+gn(&target,"height")/2.0-image_y+(1.0-scale)*(image_y-gn(&book_bounds,"top")-gn(&book_bounds,"height")/2.0);
  let zoom=animate(&self.book_node,&arr(&[&obj(&[("transform",&s("translate(0,0) scale(1)"))]),&obj(&[("transform",&s(&format!("translate({}px,{}px) scale({})",ns(dx),ns(dy),ns(scale))))])]),
   &obj(&[("duration",&f(duration)),("easing",&s(PAGE_EASE)),("fill",&s("both"))]))?;
  put(&self.session,"pageZoom",&zoom);
  wait_for_motion(&zoom,duration).await?;
  Ok(())
 }

 fn is_active_now(&self)->bool{!self.cancelled()&&!self.destroyed()&&self.is_session()}

 /// `finishReaderTransition({ pageSnapshot, animatePage })`: the cover opens, the ribbon is withdrawn, the page
 /// zooms to the reader and the lifted book hands over to it.
 pub(super) async fn finish_reader_transition(self:Rc<Self>,options:JsValue)->R<JsValue>{
  let page_snapshot=get(&options,"pageSnapshot");let animate_page=get(&options,"animatePage");
  if self.cancelled()||self.destroyed(){return Ok(JsValue::FALSE);}
  let timing=self.ctx.env("readerBookTiming",&[&b(prefers_reduced_motion())])?;
  let durations=get(&timing,"opening");
  let release=self.view_opt("holdNativeMotionFrame",&[])?;
  let outcome=self.transition_inner(&page_snapshot,&animate_page,&durations).await;
  if truthy(&release){call(&release,"release",&[])?;}
  outcome
 }
 async fn transition_inner(self:&Rc<Self>,page_snapshot:&JsValue,animate_page:&JsValue,durations:&JsValue)->R<JsValue>{
  let g=self.geo;
  if truthy(page_snapshot)&&!self.install_opening_page(page_snapshot,true)?{return Err(error("No se pudo preparar la página del modelo 3D."));}
  self.ctx.env("markTiming",&[&s("page-installed")])?;
  puts(&self.session,"phase","reading");
  puts(&dataset(&self.flyout),"openingPhase","opening");
  cls_add(&self.flyout,&["is-opening-book"]);
  putb(&self.close_button,"hidden",true);
  self.fade_meta()?;
  let reading=self.ctx.env("planReadingBookPose",&[&obj(&[("width",&f(g.cover_w)),("height",&f(g.cover_h)),("thickness",&f(g.thickness)),
   ("viewportWidth",&f(g.vw)),("viewportHeight",&f(g.vh)),("centerX",&f(g.center_x)),("centerY",&f(g.center_y))])])?;
  put(&self.session,"readingPose",&reading);
  let cover_duration=get(durations,"cover");
  put(&self.session,"coverOpeningDuration",&cover_duration);
  // The restored page is uploaded BEFORE its cover moves. Starting the hinge while the renderer loaded exposed a
  // blank, generic page block.
  let opening=if self.has_view(){
   method(&self.view,"animateCoverOpen",&[&obj(&[("duration",&cover_duration),("targetPose",&reading)])])?
  }else{
   let leaf=qs(&self.book_node,".ihr-flyout__fallback-leaf");
   animate(&leaf,&arr(&[&obj(&[("transform",&s("rotateY(0deg)"))]),&obj(&[("transform",&s("rotateY(-169deg)"))])]),
    &obj(&[("duration",&cover_duration),("easing",&s(EASE)),("fill",&s("both"))]))?
  };
  put(&self.session,"coverOpening",&opening);
  wait_for_motion(&opening,num(&cover_duration)).await?;
  if self.cancelled()||self.destroyed(){return Ok(JsValue::FALSE);}
  // Withdraw the fabric while the saved page is still readable, before moving the camera. Closing performs
  // these same steps in reverse.
  puts(&dataset(&self.flyout),"openingPhase","bookmark");
  if self.has_view(){
   let bookmark_duration=get(durations,"bookmark");
   let motion=method(&self.view,"animateBookmark",&[&obj(&[("withdraw",&f(1.0)),("duration",&bookmark_duration)])])?;
   put(&self.session,"bookmarkMotion",&motion);
   wait_for_motion(&motion,num(&bookmark_duration)).await?;
  }
  if self.cancelled()||self.destroyed(){return Ok(JsValue::FALSE);}
  if animate_page.is_function(){
   puts(&dataset(&self.flyout),"openingPhase","zooming");
   let to_page=self.callbacks.make(Stale::Promise,{let slot=self.slot.clone();move|target,_|match slot.get(){
    Some(flyout)=>Ok(flyout.animate_book_to_page_promise(target)),
    None=>Ok(promise_resolve(&undef())),
   }});
   let slot=self.slot.clone();
   let active=self.callbacks.make(Stale::False,move|_,_|Ok(b(slot.get().map(|flyout|flyout.is_active_now()).unwrap_or(false))));
   let result=call(animate_page,"animatePage",&[&obj(&[("duration",&get(durations,"zoom")),("pageSnapshot",page_snapshot),("animateBookToPage",&to_page),("isActive",&active)])])?;
   settle(result).await?;
  }
  if self.cancelled()||self.destroyed(){return Ok(JsValue::FALSE);}
  // Whatever ended the zoom, the book hands over in the reader's own colours.
  if self.has_view()&&num(&method(&self.view,"getPageTheme",&[])?)<1.0{method(&self.view,"setPageTheme",&[&f(1.0)])?;}
  puts(&dataset(&self.flyout),"openingPhase","handoff");
  // The handoff fades this host. Commit its last frame once so the live sibling cannot remain opaque; the
  // retained view resumes GPU presentation when it is moved into the closing animation's new host.
  self.view_opt("releaseToSnapshot",&[&obj(&[("resume",&JsValue::TRUE)])])?;
  let fade_duration=get(durations,"handoff");
  let fade=animate(&self.book_node,&arr(&[&obj(&[("opacity",&f(1.0))]),&obj(&[("opacity",&f(0.0))])]),&obj(&[("duration",&fade_duration),("easing",&s("linear")),("fill",&s("both"))]))?;
  animate(&self.scrim,&arr(&[&obj(&[("opacity",&f(1.0))]),&obj(&[("opacity",&f(0.0))])]),&obj(&[("duration",&fade_duration),("easing",&s("linear")),("fill",&s("both"))]))?;
  wait_for_motion(&fade,num(&fade_duration)).await?;
  if self.is_session(){
   puts(&dataset(&self.flyout),"openingPhase","complete");
   puts(&self.session,"phase","complete");
   self.scene_opt("setModalBackgroundDeferred",&[&null()])?;
   let opened=obj(&[("book",&self.book),("style",&get(&self.item,"style")),("spineEl",&self.spine())]);
   self.ctx.st_set("lastOpened",&opened);
   self.ctx.st_set("session",&null());
   self.ctx.st_set("busy",&JsValue::FALSE);
   putb(&self.session,"cancelled",true);
   self.clear_ready_check();
   let listener=self.key_listener.borrow_mut().take();drop(listener);
   self.end_editor();
   // The close animation uses the same physical book and viewport. Keep its decoded case and linked programs
   // instead of rebuilding them at Back. Only one view is retained, and incompatible geometry is never reused. The
   // ribbon is refreshed from the reader's final progress.
   if self.has_view()&&truthy(&get(&self.view,"updateBookmark")){
    let geometry=obj(&[("width",&f(g.cover_w)),("height",&f(g.cover_h)),("thickness",&f(g.thickness)),("viewportWidth",&f(g.vw)),("viewportHeight",&f(g.vh)),("centerX",&f(g.center_x)),("centerY",&f(g.center_y))]);
    let item_style=get(&self.item,"style");
    let signature=self.ctx.env("bookReturnSignature",&[&self.book,&item_style,&geometry,&self.cover_url])?;
    let compatibility=self.ctx.env("bookReturnCompatibility",&[&self.book,&item_style,&geometry])?;
    method(&self.ctx.legacy_value("returnViews"),"retain",&[&signature,&self.view,&compatibility])?;
    // An immediate cover tap can interrupt the page's idle preparation. Finish reflecting its hidden materials
    // while the reader is open, without drawing, and stop as soon as ownership moves again.
    self.prepare_programs_after_open(&opened)?;
   }else{self.view_do("dispose",&[])?;}
   remove(&self.flyout);
   self.slot.clear();
   return Ok(JsValue::TRUE);
  }
  Ok(JsValue::FALSE)
 }
 fn animate_book_to_page_promise(self:&Rc<Self>,target:JsValue)->JsValue{
  let flyout=self.clone();
  run(async move{flyout.animate_book_to_page(target).await?;Ok(undef())})
 }
 fn prepare_programs_after_open(self:&Rc<Self>,opened:&JsValue)->R{
  let ctx=self.ctx.clone();let view=self.view.clone();
  let current={let ctx=ctx.clone();let opened=opened.clone();
   fun(move|_,_|Ok(b(!ctx.st_true("destroyed")&&!ctx.st_true("returnMotion")&&!ctx.st_true("session")&&ctx.st("lastOpened")==opened)))};
  let idle_fn=fun(|_,_|{
   let (promise,resolve,_)=deferred();
   let _=idle(1000.0,16.0,move||{let _=resolve.call0(&undef());Ok(())});
   Ok(promise)
  });
  // `idle().then(() => current() && view.preparePagePrograms?.(idle, current)).catch(() => {})`
  let first=call(&idle_fn.function,"idle",&[])?;
  let (current_value,idle_value)=(current.function.clone(),idle_fn.function.clone());
  let derived=then_map(&first,move|_|{
   let live=call(&current_value,"current",&[])?;
   if !truthy(&live){return Ok(live);}
   Ok(method_opt(&view,"preparePagePrograms",&[&idle_value,&current_value])?.unwrap_or(undef()))
  },Err)?;
  then_map(&derived,Ok,|_|Ok(undef()))?;
  ctx.keepalive(vec![current,idle_fn]);
  Ok(())
 }

 /// Installs what the ready book offers the application: warming the page, tapping the cover.
 pub(super) fn install_ready_handlers(self:&Rc<Self>)->R{
  let slot=self.slot.clone();
  let warm=self.callbacks.make(Stale::PromiseFalse,move|snapshot,idle|match slot.get(){
   Some(flyout)=>Ok(run(async move{flyout.warm_opening_page(snapshot,idle).await})),
   None=>Ok(promise_resolve(&JsValue::FALSE)),
  });
  put(&self.session,"warmOpeningPage",&warm);
  let weak=self.weak();
  on(&self.keep,&self.cover_target,"click",move|_|{if let Some(flyout)=weak.upgrade(){flyout.expand_cover();}Ok(())})
 }

 /// `expandCover`: the tap on the cover. The application opens the reader and calls back to finish the hand-over.
 pub(super) fn expand_cover(self:&Rc<Self>){
  let flyout=self.clone();
  spawn(async move{flyout.expand_cover_task().await?;Ok(undef())});
 }
 async fn expand_cover_task(self:Rc<Self>)->R{
  if self.cancelled()||gb(&self.session,"expanding")||self.phase()!="ready"||self.destroyed(){return Ok(());}
  putb(&self.session,"expanding",true);
  puts(&self.session,"phase","preparing");
  puts(&dataset(&self.flyout),"openingPhase","preparing");
  putb(&self.cover_target,"disabled",true);
  cls_add(&self.flyout,&["is-expanding"]);
  putb(&self.cover_target,"hidden",true);
  for button in self.action_buttons.borrow().iter(){if truthy(button)&&gs(button,"tagName")=="BUTTON"{putb(button,"disabled",true);}}
  set_text(&self.readiness,"Preparando…");cls_remove(&self.readiness,&["is-error"]);
  self.ctx.env("markTiming",&[&s("open-tap")])?;
  let slot=self.slot.clone();
  let is_active=self.callbacks.make(Stale::False,{let slot=slot.clone();move|_,_|Ok(b(slot.get().map(|flyout|flyout.is_active_now()).unwrap_or(false)))});
  let on_cancel=self.callbacks.make(Stale::Undefined,{let slot=slot.clone();move|listener,_|{if let Some(flyout)=slot.get(){put(&flyout.session,"onCancel",&listener);}Ok(undef())}});
  let close=self.callbacks.make(Stale::Promise,{let slot=slot.clone();move|options,_|match slot.get(){
   Some(flyout)=>{let instant=truthy(&get(&options,"instant"));Ok(flyout.close(obj(&[("silent",&JsValue::TRUE),("instant",&b(instant))])))},
   None=>Ok(promise_resolve(&undef())),
  }});
  let finish=self.callbacks.make(Stale::PromiseFalse,{let slot=slot.clone();move|options,_|match slot.get(){
   Some(flyout)=>{let options=if nullish(&options){obj(&[])}else{options};Ok(run(async move{flyout.finish_reader_transition(options).await}))},
   None=>Ok(promise_resolve(&JsValue::FALSE)),
  }});
  let context=obj(&[("coverUrl",&self.cover_url),("isActive",&is_active),("onCancel",&on_cancel),("close",&close),("finish",&finish)]);
  let opened=self.ctx.option_or("onOpenBook","onBookOpen");
  let outcome=async{
   if !nullish(&opened){settle(call(&opened,"onOpenBook",&[&self.book,&context])?).await?;}
   Ok::<(),JsValue>(())
  }.await;
  if let Err(error)=outcome{
   log_error("No se pudo abrir el lector:",&error);
   let closing=self.close(obj(&[("silent",&JsValue::TRUE)]));
   settle(closing).await?;
  }
  Ok(())
 }
}
