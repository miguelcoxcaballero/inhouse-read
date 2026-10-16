//! The lifted book: from the tap on a spine to the reader opening (or the book going back), including the
//! pull-out from the shelf, its cover, title and progress, the cloud action, the page it will open on and
//! the keyboard rules of the dialog. The 3D view, the scene and the application's callbacks stay the host's;
//! this decides when each is asked for what, in the order the original did.
use std::{cell::{Cell,RefCell},rc::{Rc,Weak}};
use wasm_bindgen::prelude::*;
use js_sys::Function;
use super::{util::*,ctx::{Ctx,RustShelfCtx},style::*,pieces::*,editor::{Editor,EditorParts,Geometry}};

/// A strong reference that can be dropped from outside: the owner of something that must outlive the code that
/// started it, and the only thing the long-lived callbacks it hands out capture.
pub struct Slot<T>(RefCell<Option<Rc<T>>>);
impl<T> Slot<T>{
 pub fn new()->Rc<Slot<T>>{Rc::new(Slot(RefCell::new(None)))}
 pub fn put(&self,value:Rc<T>){*self.0.borrow_mut()=Some(value);}
 pub fn get(&self)->Option<Rc<T>>{self.0.borrow().clone()}
 pub fn clear(&self){let old=self.0.borrow_mut().take();drop(old);}
}

/// The pose a lifted book starts from, taken from where it sat on the shelf.
#[derive(Clone)]
pub(super) struct Start{pub dx:f64,pub dy:f64,pub scale:f64,pub angle:f64,pub pitch:f64,pub roll:f64,
 /// The angle, pitch and roll exactly as the scene gave them (they go on to the view untouched, whatever they are).
 pub raw:Option<(JsValue,JsValue,JsValue)>}
impl Start{
 pub(super) fn pose(&self)->JsValue{
  let (angle,pitch,roll)=match &self.raw{Some((a,p,r))=>(a.clone(),p.clone(),r.clone()),None=>(f(self.angle),f(self.pitch),f(self.roll))};
  obj(&[("x",&f(self.dx)),("y",&f(self.dy)),("scale",&f(self.scale)),("angle",&angle),("pitch",&pitch),("roll",&roll)])
 }
}

pub struct Flyout{
 pub(super) ctx:Rc<Ctx>,pub(super) me:RefCell<Weak<Flyout>>,pub(super) keep:Keep,
 pub(super) book:JsValue,pub(super) item:JsValue,pub(super) view:JsValue,pub(super) cover_url:JsValue,pub(super) session:JsValue,
 pub(super) spine_el:RefCell<JsValue>,pub(super) previous_focus:RefCell<JsValue>,pub(super) geo:Geometry,pub(super) start:RefCell<Start>,pub(super) lift:f64,
 pub(super) scrim:JsValue,pub(super) book_node:JsValue,pub(super) meta:JsValue,pub(super) readiness:JsValue,pub(super) cover_target:JsValue,
 pub(super) flyout:JsValue,pub(super) close_button:JsValue,pub(super) action_buttons:RefCell<Vec<JsValue>>,pub(super) cloud_action:RefCell<JsValue>,
 pub(super) slot:Rc<Slot<Flyout>>,pub(super) callbacks:Callbacks,
 pub(super) settle:Function,pub(super) editor:RefCell<Option<Rc<Editor>>>,pub(super) ready_check:RefCell<Option<Interval>>,
 pub(super) key_listener:RefCell<Option<Listener>>,pub(super) meta_entrance:RefCell<JsValue>,pub(super) handlers:RefCell<Vec<Fun>>,
}

/// The selection that has begun but whose cover is not yet on screen: Escape or a resize cancels it.
pub(super) struct Pending{pub ctx:Rc<Ctx>,pub cancelled:Cell<bool>,pub book:JsValue,pub settle:Function,pub object:JsValue,pub key_listener:RefCell<Option<Listener>>,pub slot:Rc<Slot<Pending>>,pub callbacks:Callbacks}
impl Pending{
 /// `finishPendingSelection`.
 pub(super) fn finish(&self){
  let listener=self.key_listener.borrow_mut().take();drop(listener);
  if self.ctx.st("pendingSelection")==self.object{self.ctx.st_set("pendingSelection",&null());}
  self.slot.clear();
  self.callbacks.clear();
 }
 fn cancel(&self)->R{
  if self.ctx.st("pendingSelection")!=self.object{return Ok(());}
  self.cancelled.set(true);
  let _=self.settle.call1(&undef(),&JsValue::FALSE);
  self.ctx.option_call("onBookDismiss",&[&self.book])?;
  self.finish();
  self.ctx.st_set("busy",&JsValue::FALSE);
  self.ctx.legacy("applyDeferredShelfUpdates",&[])?;Ok(())
 }
}

/// `String(item.book.id ?? item.book.path ?? item.book.title ?? 'book')` of a shelf item.
fn item_id(item:&JsValue)->JsValue{super::editor::appearance_id(&get(item,"book"))}

impl Flyout{
 pub(super) fn me(&self)->Rc<Flyout>{self.me.borrow().upgrade().expect("The lifted book is alive while it runs")}
 pub(super) fn weak(&self)->Weak<Flyout>{self.me.borrow().clone()}
 pub(super) fn phase(&self)->String{gs(&self.session,"phase")}
 pub(super) fn cancelled(&self)->bool{gb(&self.session,"cancelled")}
 pub(super) fn destroyed(&self)->bool{self.ctx.st_true("destroyed")}
 pub(super) fn is_session(&self)->bool{self.ctx.st("session")==self.session}
 pub(super) fn scene(&self)->JsValue{self.ctx.scene()}
 /// `state.shelfScene?.name(...args)`.
 pub(super) fn scene_do(&self,name:&str,args:&[&JsValue])->R<JsValue>{let scene=self.scene();if absent(&scene){Ok(undef())}else{method(&scene,name,args)}}
 /// `state.shelfScene?.name?.(...args)`.
 pub(super) fn scene_opt(&self,name:&str,args:&[&JsValue])->R<JsValue>{Ok(method_opt(&self.scene(),name,args)?.unwrap_or(undef()))}
 pub(super) fn has_view(&self)->bool{truthy(&self.view)}
 pub(super) fn spine(&self)->JsValue{self.spine_el.borrow().clone()}
 pub(super) fn editor(&self)->Option<Rc<Editor>>{self.editor.borrow().clone()}
 pub(super) fn reduced(&self)->bool{prefers_reduced_motion()}
 /// `tf(x, y, z, scale, angle)` of the original: a pose whose pitch follows how far the book is turned.
 pub(super) fn tf(x:f64,y:f64,scale:f64,angle:f64)->JsValue{
  obj(&[("x",&f(x)),("y",&f(y)),("scale",&f(scale)),("angle",&f(angle)),("pitch",&f(max(0.0,(90.0-angle)/90.0)*7.0))])
 }
 pub(super) fn scale_at(&self,t:f64)->f64{let start=self.start.borrow().scale;start+(1.0-start)*t}
 /// `animateBook(frames, timing)`: the view's animation, or a placeholder animation of the DOM book.
 pub(super) fn animate_book(&self,frames:&JsValue,timing:&JsValue)->R<JsValue>{
  if self.has_view(){method(&self.view,"animate",&[frames,timing])}
  else{animate(&self.book_node,&arr(&[&obj(&[("opacity",&f(1.0))])]),timing)}
 }
 pub(super) fn clear_ready_check(&self){let interval=self.ready_check.borrow_mut().take();if let Some(interval)=interval{clear_interval(&interval);}}
 /// `endEditor`: the sheet lives exactly as long as the session.
 pub(super) fn end_editor(&self){let finished=self.editor.borrow_mut().take();if let Some(editor)=finished{editor.dispose();}}

 /// `finishClose`.
 pub(super) fn finish_close(&self,silent:bool,instant:bool)->R{
  self.scene_opt("setModalBackgroundDeferred",&[&null(),&obj(&[("resumeHidden",&JsValue::TRUE)])])?;
  cls_remove(&self.spine(),&["is-away"]);
  self.scene_do("flush",&[])?;
  self.view_do("dispose",&[])?;
  remove(&self.flyout);
  self.end_editor();
  if self.is_session(){self.ctx.st_set("session",&null());self.ctx.st_set("busy",&JsValue::FALSE);}
  cls_remove(&self.spine(),&["is-away"]);
  let previous=self.previous_focus.borrow().clone();
  if !silent&&!instant&&get(&previous,"focus").is_function(){focus(&previous);}
  // The session is over: nothing keeps the lifted book alive but the code still running on its behalf.
  self.slot.clear();
  super::covers::maybe_refresh_appearance_styles(&self.ctx)?;
  self.ctx.legacy("applyDeferredShelfUpdates",&[])?;
  Ok(())
 }
 pub(super) fn view_do(&self,name:&str,args:&[&JsValue])->R<JsValue>{if self.has_view(){method(&self.view,name,args)}else{Ok(undef())}}
 pub(super) fn view_opt(&self,name:&str,args:&[&JsValue])->R<JsValue>{Ok(method_opt(&self.view,name,args)?.unwrap_or(undef()))}

 /// `close({ silent, instant })`.
 pub(super) fn close(self:&Rc<Self>,options:JsValue)->JsValue{
  let flyout=self.clone();
  run(async move{flyout.close_task(options).await?;Ok(undef())})
 }
 async fn close_task(self:Rc<Self>,options:JsValue)->R{
  let silent=truthy(&get(&options,"silent"));let mut instant=truthy(&get(&options,"instant"));
  if !self.is_session(){return Ok(());}
  self.scene_opt("setModalBackgroundDeferred",&[&null(),&obj(&[("resumeHidden",&JsValue::TRUE)])])?;
  if self.cancelled(){
   if instant{
    method_opt(&get(&self.session,"returnAnimation"),"cancel",&[])?;
    method_opt(&get(&self.session,"insertion"),"cancel",&[])?;
    self.finish_close(silent,instant)?;
   }
   return Ok(());
  }
  self.clear_ready_check();
  putb(&self.session,"cancelled",true);
  let _=self.settle.call1(&undef(),&JsValue::FALSE);
  self.ctx.option_call("onBookDismiss",&[&self.book])?;
  let on_cancel=get(&self.session,"onCancel");
  if !absent(&on_cancel){call(&on_cancel,"onCancel",&[])?;}
  let listener=self.key_listener.borrow_mut().take();drop(listener);
  // A slow image may still be loading before the flyout's first frame.
  // Cancel that selection without running an entrance/return not yet set up.
  if !is_connected(&self.flyout){instant=true;}else{self.fade_meta()?;}
  cls_remove(&self.flyout,&["is-ready"]);
  // A cancelled or failed opening may stop mid-fade: the book flies back on white paper, not in a half-mixed page.
  if self.has_view()&&self.phase()=="reading"{method(&self.view,"setPageTheme",&[&f(0.0)])?;}
  if !instant{self.play_return().await?;}
  if self.is_session(){self.finish_close(silent,instant)?;}
  Ok(())
 }

 /// The keyboard rules of the dialog: Tab stays inside, Escape peels one layer.
 fn on_keydown(self:&Rc<Self>,event:&JsValue)->R{
  let key=gs(event,"key");
  let editor=self.editor();
  if key=="Tab"{
   let controls:Vec<JsValue>=qsa(&self.flyout,"button:not([disabled]), input:not([disabled]), select:not([disabled])").into_iter()
    .filter(|control|!truthy(&closest(control,"[hidden]"))).collect();
   let first=controls.first().cloned().unwrap_or(undef());let last=controls.last().cloned().unwrap_or(undef());
   let active=active_element();
   let panel=editor.as_ref().map(|editor|editor.panel_node()).unwrap_or(undef());
   let container=active==self.flyout||active==panel;
   let shift=gb(event,"shiftKey");
   if shift&&(active==first||container){prevent_default(event);focus_plain(&last);}
   else if !shift&&(active==last||active==self.flyout){prevent_default(event);focus_plain(&first);}
  }
  if key=="Escape"{
   stop_propagation(event);
   // Also dismisses the "no se pudo leer esta portada" notice.
   let pick_hidden=gb(&self.pick_layer(),"hidden");
   if let Some(editor)=editor{
    if gb(&self.session,"colorPicking")||!pick_hidden{editor.finish_color_pick(false);return Ok(());}
    if !editor.is_hidden(){editor.close_editor(true,true)?;return Ok(());}
   }
   if self.phase()!="reading"{self.close(undef());}
  }
  Ok(())
 }
 fn pick_layer(&self)->JsValue{qs(&self.flyout,".ihr-color-pick")}

 /// `fadeMeta`: the title block leaves, its controls stop answering.
 pub(super) fn fade_meta(&self)->R{
  if let Some(editor)=self.editor(){if !editor.is_hidden(){editor.close_editor(false,false)?;}}
  let opacity=get(&call(&get(&global(),"getComputedStyle"),"getComputedStyle",&[&self.meta])?,"opacity");
  method_opt(&self.meta_entrance.borrow().clone(),"cancel",&[])?;
  animate(&self.meta,&arr(&[&obj(&[("opacity",&opacity)]),&obj(&[("opacity",&f(0.0))])]),&obj(&[("duration",&f(if self.reduced(){1.0}else{160.0})),("fill",&s("both"))]))?;
  style_prop(&self.meta,"pointerEvents","none");
  for button in self.action_buttons.borrow().iter(){if truthy(button)&&gs(button,"tagName")=="BUTTON"{putb(button,"disabled",true);}}
  if let Some(editor)=self.editor(){editor.disable_controls();}
  Ok(())
 }
}

#[wasm_bindgen]
impl RustShelfCtx{
 /// `openBook(spineEl, item)`: lifts the book out of the shelf and shows its cover.
 #[wasm_bindgen(js_name=openBook)]
 pub fn open_book(&self,spine_el:JsValue,item:JsValue)->JsValue{
  let ctx=self.ctx.clone();
  run(async move{open(ctx,spine_el,item).await?;Ok(undef())})
 }
}

async fn open(ctx:Rc<Ctx>,mut spine_el:JsValue,mut item:JsValue)->R{
 if ctx.st_true("busy")||ctx.st_true("session")||ctx.st_true("returnMotion")||ctx.st_true("destroyed"){return Ok(());}
 ctx.legacy("clearCompatibilityTapRefresh",&[])?;
 if ctx.st_true("queuedBooks"){
  // The validated painted hit selects the ID. Commit the accepted list through the original path before
  // using its current source/style/pose.
  let id=item_id(&item);
  ctx.legacy("applyDeferredShelfUpdates",&[])?;
  // A reordering animation can still own the queued list. Keep it intact and do not open the stale source
  // or geometry from the painted hit.
  if ctx.st_true("queuedBooks"){return Ok(());}
  item=map_get(&ctx.st("itemsById"),&id);
  let found=if truthy(&item){
   let wanted=string_value(&coalesce(get(&get(&item,"book"),"id"),s("")));
   qsa(&ctx.root,".ihr-spine").into_iter().find(|node|data_get(node,"bookId")==wanted)
  }else{None};
  spine_el=found.unwrap_or(undef());
  if !truthy(&item)||!is_connected(&spine_el)||text(&ctx.legacy("bookGeometryState",&[&get(&item,"book")])?)!="ready"{return Ok(());}
 }
 method(&ctx.legacy_value("returnViews"),"clear",&[])?;
 ctx.st_set("busy",&JsValue::TRUE);
 // True once the lifted book sits still (the pull-out has finished), false if the selection ends without that.
 // The page being prepared for this book waits for it.
 let (settled,settle_fn,_)=deferred();
 let pending_object=js_sys::Object::new();
 let pending_slot=Slot::new();
 let pending=Rc::new(Pending{ctx:ctx.clone(),cancelled:Cell::new(false),book:get(&item,"book"),settle:settle_fn.clone(),object:pending_object.clone().into(),key_listener:RefCell::new(None),slot:pending_slot.clone(),callbacks:Callbacks::new()});
 pending_slot.put(pending.clone());
 {
  let slot=pending_slot.clone();
  let cancel=pending.callbacks.make(Stale::Undefined,move|_,_|match slot.get(){Some(pending)=>{pending.cancel()?;Ok(undef())},None=>Ok(undef())});
  put(&pending.object,"cancelled",&JsValue::FALSE);put(&pending.object,"cancel",&cancel);
  let slot=pending_slot.clone();
  let listener=listen(&document(),"keydown",None,true,move|event|{
   if gs(&event,"key")!="Escape"{return Ok(());}
   stop_propagation(&event);
   if let Some(pending)=slot.get(){pending.cancel()?;}
   Ok(())
  })?;
  *pending.key_listener.borrow_mut()=Some(listener);
 }
 ctx.st_set("pendingSelection",&pending.object);

 let book=get(&item,"book");
 let initial_style=get(&item,"style");
 ctx.env("resetTimeline",&[])?;ctx.env("markTiming",&[&s("select")])?;
 ctx.option_call("onPrepareBook",&[&book,&obj(&[("settled",&settled)])])?;
 // Measured without a transform: a tilted book's getBoundingClientRect returns the box of the rotated rectangle
 // (wider and taller than the spine) and the handoff would come out misaligned. The price is a forced reflow,
 // once per tap with the finger already still. A side effect is intended: leaving the shelf the book straightens up.
 let spine_style=style(&spine_el);
 let previous_transition=get(&spine_style,"transition");
 style_prop(&spine_el,"transition","none");
 style_prop(&spine_el,"transform","none");
 let rect_value=rect(&spine_el)?;
 let mut source_pose=ctx_scene_pose(&ctx,&spine_el)?;
 style_prop(&spine_el,"transform","");
 let _=get(&spine_el,"offsetWidth");
 put(&spine_style,"transition",&previous_transition);

 let cover_url=settle_value(super::covers::resolve_cover_promise(&ctx,&book)).await?;
 if pending.cancelled.get()||ctx.st_true("destroyed"){pending.finish();return Ok(());}
 let image_ratio=settle_value(ctx.env("readCoverAspectRatio",&[&cover_url])?).await?;
 if pending.cancelled.get()||ctx.st_true("destroyed"){pending.finish();return Ok(());}
 if truthy(&image_ratio){put(&item,"style",&spread(&[&get(&item,"style"),&obj(&[("coverRatio",&image_ratio)])]));}
 let appearance=settle_value(super::covers::quick_cover_appearance(&ctx,&book,&cover_url)?).await?;
 if pending.cancelled.get()||ctx.st_true("destroyed"){pending.finish();return Ok(());}
 if truthy(&appearance){apply_cover_appearance(&ctx,&item,&appearance)?;}
 if get(&item,"style")!=initial_style&&is_connected(&spine_el){
  if truthy(&ctx.scene()){method(&ctx.scene(),"updateEntry",&[&spine_el,&book,&get(&item,"style"),&cover_url])?;}
  else{
   let had_focus=active_element()==spine_el;
   let replacement=ctx.legacy("buildSpine",&[&item])?;
   replace_with(&spine_el,&replacement);
   spine_el=replacement.clone();
   if had_focus{focus(&replacement);}
  }
 }
 let style_value=get(&item,"style");
 if ctx.st_true("destroyed"){return Ok(());}
 if truthy(&ctx.scene()){
  method(&ctx.scene(),"flush",&[])?;
  source_pose=method(&ctx.scene(),"getBookPose",&[&spine_el])?;
 }

 let width_now=inner_width();let height_now=inner_height();
 let vw=if width_now.is_nan()||width_now==0.0{390.0}else{width_now};
 let vh=if height_now.is_nan()||height_now==0.0{780.0}else{height_now};
 let landscape=vh<=560.0&&vw>=560.0;
 let ratio=num(&super::covers::cover_ratio_for(&ctx,&style_value,&undef())?);
 // Match the model's physical front board to the image ratio before sizing its reveal. This keeps the same
 // silhouette on the shelf and in flight.
 let has_pose=truthy(&source_pose);
 let rect_w=gn(&rect_value,"width");let rect_h=gn(&rect_value,"height");
 let or_default=|value:f64,fallback:f64|if value.is_nan()||value==0.0{fallback}else{value};
 let shelf_aspect=if has_pose{gn(&source_pose,"thickness")/gn(&source_pose,"height")}else{or_default(rect_w,32.0)/or_default(rect_h,150.0)};
 let cover_h=min(min(min(min(vh*(if landscape{0.72}else{0.54}),if landscape{350.0}else{max(110.0,vh-330.0)}),440.0),(vw*(if landscape{0.35}else{0.78}))/ratio),(vw*0.86)/(ratio+shelf_aspect*0.55));
 let cover_w=cover_h*ratio;
 let start_scale=if has_pose{gn(&source_pose,"scale")*gn(&source_pose,"height")/cover_h}else if rect_h>0.0{rect_h/cover_h}else{0.3};
 let thickness=if has_pose{gn(&source_pose,"thickness")*cover_h/gn(&source_pose,"height")}else{max(6.0,or_default(rect_w,32.0)/start_scale)};
 let center_x=vw*(if landscape{0.26}else{0.5})+thickness*0.38/2.0;
 let center_y=vh*(if landscape{0.5}else{0.42});
 let pose_value=|key:&str,fallback:f64|->f64{if has_pose{let value=get(&source_pose,key);if nullish(&value){fallback}else{num(&value)}}else{fallback}};
 let start=Start{
  dx:(if has_pose&&!nullish(&get(&source_pose,"centerX")){gn(&source_pose,"centerX")}else{gn(&rect_value,"left")+rect_w/2.0})-center_x,
  dy:(if has_pose&&!nullish(&get(&source_pose,"centerY")){gn(&source_pose,"centerY")}else{gn(&rect_value,"top")+rect_h/2.0})-center_y,
  scale:start_scale,angle:pose_value("angle",90.0),pitch:pose_value("pitch",0.0),roll:pose_value("roll",0.0),
  raw:if has_pose{Some((coalesce(get(&source_pose,"angle"),f(90.0)),coalesce(get(&source_pose,"pitch"),f(0.0)),coalesce(get(&source_pose,"roll"),f(0.0))))}else{None}};

 let scrim=El::new("div").class("ihr-flyout__scrim").done();
 let book_node=El::new("div").class("ihr-flyout__book").style(&format!("width:{}px;height:{}px;left:{}px;top:{}px;--ihr-thickness:{}px;{}",
  ns(cover_w),ns(cover_h),ns(center_x-cover_w/2.0),ns(center_y-cover_h/2.0),ns(thickness),spine_style_vars(&style_value))).done();

 let view_dimensions=obj(&[("width",&f(cover_w)),("height",&f(cover_h)),("thickness",&f(thickness)),("viewportWidth",&f(vw)),("viewportHeight",&f(vh)),
  ("centerX",&f(center_x)),("centerY",&f(center_y)),("coverUrl",&cover_url),("deferDraw",&JsValue::TRUE),("compactReturnFrame",&JsValue::TRUE),
  ("adaptiveNativeFrame",&JsValue::TRUE),("initialPose",&start.pose())]);
 let view=ctx.env("bookView",&[&book_node,&book,&style_value,&view_dimensions])?;
 if truthy(&view){
  // Keep an inspectable cue on the lifted canvas too; the ribbon itself is geometry inside the model, so no DOM
  // ribbon needs to be re-created.
  let bookmark=ctx.env("bookmarkFor",&[&book])?;
  puts(&dataset(&get(&view,"canvas")),"bookmark3d",&truthy(&bookmark).to_string());
  method(&view,"draw",&[&start.pose(),&obj(&[("redraw",&JsValue::FALSE)])])?;
  cls_add(&book_node,&["ihr-flyout__book--webgl"]);
  style_prop(&book_node,"position","absolute");style_prop(&book_node,"inset","0");style_prop(&book_node,"width","100%");style_prop(&book_node,"height","100%");
 }else{
  cls_add(&book_node,&["ihr-flyout__book--fallback"]);
  let pages=El::new("div").class("ihr-flyout__fallback-pages").attr("aria-hidden","true").done();
  let inside=El::new("div").class("ihr-flyout__face ihr-flyout__face--inside").attr("aria-hidden","true").done();
  let leaf=El::new("div").class("ihr-flyout__fallback-leaf").child(&build_cover_face(&ctx,&book,&cover_url,&style_value)?).child(&inside).done();
  append_all(&book_node,&[&pages,&leaf]);
 }
 // Title and author, and how far the reader got: the cover itself says the rest.
 let progress_raw=num(&get(&book,"progressFraction"));let progress_raw=if progress_raw.is_nan()||progress_raw==0.0{0.0}else{progress_raw};
 let progress=round(min(1.0,max(0.0,progress_raw))*100.0);
 let title=ctx.env("displayBookTitle",&[&book])?;
 let author=ctx.env("normalizeBookAuthor",&[&get(&book,"author")])?;
 let mut meta=El::new("div").class("ihr-flyout__meta").child(&El::new("p").class("ihr-flyout__title").text(&text(&title)).done());
 if truthy(&author){meta=meta.child(&El::new("p").class("ihr-flyout__author").text(&text(&ctx.env("normalizeBookAuthor",&[&get(&book,"author")])?)).done());}
 if progress>0.0{
  let fill=El::new("span").class("ihr-flyout__progress-fill").style(&format!("width:{}%",ns(progress))).done();
  let track=El::new("span").class("ihr-flyout__progress-track").attr("aria-hidden","true").child(&fill).done();
  let value=El::new("span").class("ihr-flyout__progress-value").attr("aria-hidden","true").text(&format!("{} %",ns(progress))).done();
  meta=meta.child(&El::new("p").class("ihr-flyout__progress").attr("aria-label",&format!("{} % leído",ns(progress))).child(&track).child(&value).done());
 }
 let meta=meta.done();
 // Read aloud for assistive technology; shown only when preparing fails.
 let readiness=El::new("p").class("ihr-flyout__readiness").text(if truthy(&ctx.option("getBookPreparation")){"Preparando…"}else{"Toca la portada para leer"}).attr("aria-live","polite").done();
 append(&meta,&readiness);
 let tap_label=call(&ctx.text_of("tapCover"),"tapCover",&[&book])?;
 let cover_target=El::new("button").attr("type","button").class("ihr-flyout__cover-target").attr("aria-label",&text(&tap_label)).flag("hidden")
  .style(&format!("left:{}px;top:{}px;width:{}px;height:{}px",ns(center_x-cover_w/2.0),ns(center_y-cover_h/2.0),ns(cover_w),ns(cover_h))).done();
 let pick_layer=El::new("div").class("ihr-color-pick").flag("hidden").attr("aria-label","Elegir un color de la portada").done();
 let pick_message=El::new("p").class("ihr-color-pick__message").text("Arrastra sobre la portada").done();
 let pick_cancel=El::new("button").attr("type","button").class("ihr-color-pick__cancel").text("Cancelar").done();
 let handle_color=El::new("span").class("ihr-color-pick__handle-color").attr("aria-hidden","true").done();
 let handle_cross=El::new("span").class("ihr-color-pick__handle-cross").attr("aria-hidden","true").text("+").done();
 let pick_handle=El::new("button").attr("type","button").class("ihr-color-pick__handle").attr("aria-label","Muestra de color: arrastra sobre la portada")
  .style(&format!("--ihr-picked-color:{}",text(&get(&style_value,"color")))).child(&handle_color).child(&handle_cross).done();
 append_all(&pick_layer,&[&pick_message,&pick_cancel,&pick_handle]);

 let open_label=ctx.text_of("openAction");
 let flyout_label=or(title.clone(),open_label.clone());
 let flyout=El::new("div").class("ihr-flyout").attr("role","dialog").attr("aria-modal","true").attr("aria-label",&text(&flyout_label)).attr("tabindex","-1").done();
 cls_add(&flyout,&[if truthy(&view){"has-webgl"}else{"no-webgl"}]);
 let close_text=text(&ctx.text_of("closeAction"));
 let close_button=El::new("button").attr("type","button").class("ihr-btn ihr-flyout__close").attr("aria-label",&close_text).attr("title",&close_text)
  .child(&icon(&CLOSE)?).done();
 let shadow=El::new("div").class("ihr-flyout__shadow").attr("aria-hidden","true")
  .style(&format!("--ihr-cover-bottom:{}px;left:{}px",ns(center_y+cover_h/2.0),ns(vw*(if landscape{0.26}else{0.5})))).done();
 let stage=El::new("div").class("ihr-flyout__stage").child(&book_node).done();
 append_all(&flyout,&[&scrim,&shadow,&stage,&meta,&cover_target,&pick_layer,&close_button]);

 let previous_focus=active_element();
 let session=obj(&[("book",&book),("item",&item),("cancelled",&JsValue::FALSE),("phase",&s("revealing")),("view",&view),("bookNode",&book_node)]);
 let geo=Geometry{vw,vh,landscape,cover_w,cover_h,center_x,center_y,thickness};
 let lift=min(64.0,rect_h*0.35);

 let slot=Slot::new();
 let flyout_rc=Rc::new(Flyout{
  ctx:ctx.clone(),me:RefCell::new(Weak::new()),keep:keep(),book:book.clone(),item:item.clone(),view:view.clone(),cover_url:cover_url.clone(),session:session.clone(),
  spine_el:RefCell::new(spine_el.clone()),previous_focus:RefCell::new(previous_focus),geo,start:RefCell::new(start),lift,
  scrim,book_node,meta,readiness,cover_target,flyout,close_button,action_buttons:RefCell::new(Vec::new()),cloud_action:RefCell::new(null()),slot:slot.clone(),callbacks:Callbacks::new(),
  settle:settle_fn.clone(),editor:RefCell::new(None),ready_check:RefCell::new(None),key_listener:RefCell::new(None),meta_entrance:RefCell::new(undef()),
  handlers:RefCell::new(Vec::new()),
 });
 *flyout_rc.me.borrow_mut()=Rc::downgrade(&flyout_rc);
 slot.put(flyout_rc.clone());
 flyout_rc.install_session(&pending)?;
 flyout_rc.build_actions(PickNodes{layer:pick_layer,message:pick_message,cancel:pick_cancel,handle:pick_handle},&style_value)?;
 flyout_rc.reveal().await?;
 Ok(())
}

pub(super) struct PickNodes{pub layer:JsValue,pub message:JsValue,pub cancel:JsValue,pub handle:JsValue}

impl Flyout{
 /// `session.close`, the scrim, the dialog's keyboard rules and `state.session`.
 fn install_session(self:&Rc<Self>,pending:&Rc<Pending>)->R{
  let slot=self.slot.clone();
  let close=self.callbacks.make(Stale::Promise,move|options,_|match slot.get(){Some(flyout)=>Ok(flyout.close(options)),None=>Ok(promise_resolve(&undef()))});
  put(&self.session,"close",&close);
  {let weak=self.weak();on(&self.keep,&self.scrim,"click",move|_|{
   if let Some(flyout)=weak.upgrade(){if flyout.phase()!="reading"{flyout.close(undef());}}
   Ok(())
  })?;}
  {let weak=self.weak();on(&self.keep,&self.close_button,"click",move|_|{
   if let Some(flyout)=weak.upgrade(){flyout.close(undef());}
   Ok(())
  })?;}
  {let weak=self.weak();
   let listener=listen(&document(),"keydown",None,true,move|event|match weak.upgrade(){Some(flyout)=>flyout.on_keydown(&event),None=>Ok(())})?;
   *self.key_listener.borrow_mut()=Some(listener);}
  self.ctx.st_set("session",&self.session);
  pending.finish();
  Ok(())
 }

 /// The cloud action, the actions row, the editor, the metadata block and the readiness poll.
 fn build_actions(self:&Rc<Self>,pick:PickNodes,style_value:&JsValue)->R{
  let ctx=&self.ctx;let book=&self.book;
  let cloud=ctx.option_call("getBookCloudState",&[book])?;
  let cloud=if truthy(&cloud){cloud}else{obj(&[("connected",&JsValue::FALSE),("saved",&b(truthy(&get(book,"driveFileId"))))])};
  let needs_download=truthy(&ctx.env("needsDriveDownload",&[book])?);
  let has_action=truthy(&ctx.option("onBookAction"));
  let cloud_action=if needs_download{
   let mut button=El::new("button").attr("type","button").class("ihr-btn ihr-btn--quiet ihr-btn--icon").attr("title","Descargar para usar sin conexión").attr("aria-label","Descargar para usar sin conexión");
   if !has_action{button=button.flag("disabled");}
   let button=button.child(&icon(&DOWNLOAD)?).done();
   self.wire_cloud_button(&button,"offline")?;button
  }else if truthy(&get(&cloud,"saved")){cloud_saved_mark()?}
  else if truthy(&get(&cloud,"connected"))&&truthy(&get(book,"content")){
   let mut button=El::new("button").attr("type","button").class("ihr-btn ihr-btn--quiet ihr-btn--icon ihr-flyout__cloud-action").attr("title","Subir a Google Drive").attr("aria-label","Subir a Google Drive");
   if !has_action{button=button.flag("disabled");}
   let button=button.child(&icon(&DRIVE)?).done();
   self.wire_cloud_button(&button,"drive")?;button
  }else{null()};
  *self.cloud_action.borrow_mut()=cloud_action.clone();
  {
   let slot=self.slot.clone();
   let update=self.callbacks.make(Stale::Undefined,move|record,_|{
    let Some(flyout)=slot.get()else{return Ok(undef())};
    let action=flyout.cloud_action.borrow().clone();
    if !truthy(&get(&record,"driveFileId"))||!truthy(&action)||!is_connected(&action)||!cls_has(&action,"ihr-flyout__cloud-action"){return Ok(undef());}
    put(&flyout.book,"driveFileId",&get(&record,"driveFileId"));
    put(&flyout.book,"cloudAccountId",&get(&record,"cloudAccountId"));
    replace_with(&action,&cloud_saved_mark()?);
    Ok(undef())
   });
   put(&self.session,"updateCloudRecord",&update);
  }
  let open_label=text(&ctx.text_of("openAction"));
  let open_button=El::new("button").attr("type","button").class("ihr-btn ihr-btn--primary").flag("disabled")
   .child(&icon(&READ)?).child(&El::new("span").text(&open_label).done()).done();
  let edit_button=El::new("button").attr("type","button").class("ihr-btn ihr-btn--quiet ihr-btn--icon ihr-flyout__edit-button").flag("disabled")
   .attr("aria-expanded","false").attr("aria-label","Editar").attr("title","Editar").child(&icon(&BRUSH)?).done();
  *self.action_buttons.borrow_mut()=vec![open_button.clone(),cloud_action.clone(),edit_button.clone()];
  {let weak=self.weak();on(&self.keep,&open_button,"click",move|_|{if let Some(flyout)=weak.upgrade(){flyout.expand_cover();}Ok(())})?;}
  {let weak=self.weak();on(&self.keep,&edit_button,"click",move|_|{
   let Some(flyout)=weak.upgrade()else{return Ok(())};
   let editor=flyout.editor();
   match editor{Some(editor)=>if editor.is_hidden(){editor.open_editor()}else{editor.close_editor(true,true)},None=>Ok(())}
  })?;}

  // The spine / cover editor of this lifted book; it lives exactly as long as the session.
  let host:Rc<dyn Fn()->R>={let weak=self.weak();Rc::new(move||match weak.upgrade(){Some(flyout)=>flyout.replace_shelf_spine(),None=>Ok(())})};
  let editor=Editor::build(ctx,EditorParts{
   book:book.clone(),item:self.item.clone(),view:self.view.clone(),session:self.session.clone(),book_node:self.book_node.clone(),flyout:self.flyout.clone(),
   meta:self.meta.clone(),cover_target:self.cover_target.clone(),edit_button:edit_button.clone(),cover_url:self.cover_url.clone(),style:style_value.clone(),
   geo:self.geo,pick_layer:pick.layer,pick_message:pick.message,pick_cancel:pick.cancel,pick_handle:pick.handle,host})?;
  let actions=El::new("div").class("ihr-flyout__actions").children(&[open_button,cloud_action,edit_button]).done();
  append(&self.meta,&actions);
  append(&self.meta,&editor.panel_node());
  *self.editor.borrow_mut()=Some(editor);

  let has_preparation=truthy(&ctx.option("getBookPreparation"));
  let weak=self.weak();
  let interval=every(250.0,move||{
   let Some(flyout)=weak.upgrade()else{return Ok(())};
   let task=flyout.ctx.option_call("getBookPreparation",&[&flyout.book])?;
   flyout.clear_ready_check();
   if !truthy(&task){set_text(&flyout.readiness,"Toca la portada para leer");return Ok(());}
   let (ok_weak,err_weak)=(flyout.weak(),flyout.weak());
   // `task.then(ok => ...).catch(() => ...)`
   let derived=then_map(&task,move|ok|{
    let Some(flyout)=ok_weak.upgrade()else{return Ok(undef())};
    if !flyout.is_session(){return Ok(undef());}
    set_text(&flyout.readiness,if truthy(&ok){"Listo para leer"}else{"No se pudo preparar. Toca para reintentar."});
    cls_toggle(&flyout.readiness,"is-error",!truthy(&ok));Ok(undef())
   },Err)?;
   then_map(&derived,Ok,move|_|{
    let Some(flyout)=err_weak.upgrade()else{return Ok(undef())};
    if !flyout.is_session(){return Ok(undef());}
    set_text(&flyout.readiness,"No se pudo preparar. Toca para reintentar.");cls_add(&flyout.readiness,&["is-error"]);Ok(undef())
   })?;
   Ok(())
  });
  *self.ready_check.borrow_mut()=Some(interval);
  if !has_preparation{self.clear_ready_check();}
  Ok(())
 }

 fn wire_cloud_button(self:&Rc<Self>,button:&JsValue,action:&'static str)->R{
  let weak=self.weak();let node=button.clone();
  on(&self.keep,button,"click",move|_|{
   let Some(flyout)=weak.upgrade()else{return Ok(())};
   flyout.ctx.option_call("onBookAction",&[&s(action),&flyout.book,&node])?;Ok(())
  })
 }

 /// `replaceShelfSpine`: the resting spine follows the edited style.
 pub(super) fn replace_shelf_spine(&self)->R{
  let id=string_value(&get(&self.book,"id"));
  let existing=qsa(&self.ctx.scroller,".ihr-spine").into_iter().find(|node|data_get(node,"bookId")==id);
  let Some(existing)=existing else{return Ok(())};
  if truthy(&self.scene()){
   method(&self.scene(),"updateEntry",&[&existing,&self.book,&get(&self.item,"style"),&self.cover_url])?;return Ok(());
  }
  let had_focus=active_element()==existing;
  let was_away=cls_has(&existing,"is-away");
  let replacement=self.ctx.legacy("buildSpine",&[&self.item])?;
  if was_away{cls_add(&replacement,&["is-away"]);}
  replace_with(&existing,&replacement);
  *self.spine_el.borrow_mut()=replacement.clone();
  if *self.previous_focus.borrow()==existing{*self.previous_focus.borrow_mut()=replacement.clone();}
  if had_focus{focus(&replacement);}
  let last=self.ctx.st("lastOpened");
  if get(&get(&last,"book"),"id")==get(&self.book,"id"){
   if nullish(&last){return Err(js_sys::TypeError::new("Cannot set properties of null (setting 'spineEl')").into());}
   put(&last,"spineEl",&replacement);
  }
  Ok(())
 }

 /// From the cover being ready to the book resting in front of the user.
 async fn reveal(self:Rc<Self>)->R{
  // The real cover and its initial pose must be ready before replacing the shelf mesh; a generated jacket
  // must never flash during this handoff.
  if self.has_view(){settle(get(&self.view,"ready")).await?;}
  if self.cancelled()||self.destroyed(){self.view_do("dispose",&[])?;return Ok(());}
  self.scene_do("flush",&[])?;
  let handoff=self.scene_do("getBookPose",&[&self.spine()])?;
  if self.has_view()&&truthy(&handoff){
   let g=self.geo;
   let roll=get(&handoff,"roll");
   let mut start=self.start.borrow().clone();
   start.dx=gn(&handoff,"centerX")-g.center_x;
   start.dy=gn(&handoff,"centerY")-g.center_y;
   start.scale=gn(&handoff,"scale")*gn(&handoff,"height")/g.cover_h;
   start.angle=gn(&handoff,"angle");start.pitch=gn(&handoff,"pitch");
   start.roll=if nullish(&roll){0.0}else{num(&roll)};
   start.raw=Some((get(&handoff,"angle"),get(&handoff,"pitch"),coalesce(roll.clone(),f(0.0))));
   *self.start.borrow_mut()=start.clone();
   method(&self.view,"draw",&[&start.pose(),&obj(&[("redraw",&JsValue::FALSE)])])?;
  }
  append(&get(&document(),"body"),&self.flyout);
  // The cover is ready and the final shelf pose is known. Paint once in its connected stage before replacing
  // the resting book; detached setup needs no GPU draw or full-screen readback.
  let pose=self.start.borrow().pose();
  self.view_do("draw",&[&pose])?;
  cls_add(&self.spine(),&["is-away"]);
  self.scene_do("flush",&[])?;
  self.scene_opt("setModalBackgroundDeferred",&[&self.spine()])?;
  method_opt(&self.flyout,"focus",&[])?;

  let reduce=prefers_reduced_motion();
  let revealed=num(&self.ctx.opts_get("revealDuration"));
  let duration=if reduce{1.0}else{revealed};
  let start=self.start.borrow().clone();
  let (dx,dy)=(start.dx,start.dy);
  let frames=arr(&[
   &obj(&[("transform",&start.pose()),("easing",&s("cubic-bezier(0.34, 0, 0.26, 1)"))]),
   &obj(&[("offset",&f(0.26)),("transform",&Flyout::tf(dx*0.9,dy*0.86-self.lift,self.scale_at(0.15),start.angle*0.89)),("easing",&s(EASE))]),
   &obj(&[("offset",&f(0.7)),("transform",&Flyout::tf(dx*0.18,dy*0.16,self.scale_at(0.85),16.0)),("easing",&s("cubic-bezier(0.3, 0, 0.2, 1)"))]),
   &obj(&[("transform",&Flyout::tf(0.0,0.0,1.0,0.0))]),
  ]);
  style_prop(&self.book_node,"willChange","transform");
  // Linear timing on purpose: each keyframe brings its own easing and, if a global one is set too, they
  // compose and the choreography eats the last third of the animation (it stands still while the clock runs).
  let revealing=self.animate_book(&frames,&obj(&[("duration",&f(duration)),("easing",&s("linear")),("fill",&s("both"))]))?;
  animate(&self.scrim,&arr(&[&obj(&[("opacity",&f(0.0))]),&obj(&[("opacity",&f(1.0))])]),&obj(&[("duration",&f(min(280.0,duration))),("easing",&s(EASE)),("fill",&s("both"))]))?;
  let entrance=animate(&self.meta,&arr(&[&obj(&[("opacity",&f(0.0)),("transform",&s("translateY(12px)"))]),&obj(&[("opacity",&f(1.0)),("transform",&s("translateY(0)"))])]),
   &obj(&[("duration",&f(min(260.0,duration))),("delay",&f(duration*0.62)),("easing",&s(EASE)),("fill",&s("both"))]))?;
  *self.meta_entrance.borrow_mut()=entrance;

  let waited=async{
   let finished=get(&revealing,"finished");
   if nullish(&finished){settle(undef()).await}
   else{let caught=then_map(&finished,Ok,|_|Ok(undef()))?;settle(caught).await}
  }.await;
  style_prop(&self.book_node,"willChange","");
  waited?;

  if self.cancelled()||self.destroyed(){return Ok(());}
  puts(&self.session,"phase","ready");
  self.ctx.env("markTiming",&[&s("flyout-ready")])?;
  let _=self.settle.call1(&undef(),&JsValue::TRUE);
  cls_add(&self.flyout,&["is-ready"]);
  let buttons=self.action_buttons.borrow().clone();
  putb(&buttons[0],"disabled",false);putb(&buttons[2],"disabled",false);
  putb(&self.cover_target,"hidden",!truthy(&self.ctx.opts_get("autoOpen")));
  cls_add(&self.cover_target,&["is-ready"]);
  self.install_ready_handlers()
 }
}

/// The discreet Drive mark with a small tick, shown once the book is saved.
pub(super) fn cloud_saved_mark()->R<JsValue>{
 let tick=El::new("span").class("ihr-flyout__cloud-check").attr("aria-hidden","true").child(&icon(&CHECK)?).done();
 Ok(El::new("span").class("ihr-btn ihr-btn--quiet ihr-btn--icon ihr-flyout__cloud-saved").attr("role","status").attr("aria-label","Guardado en Google Drive").attr("title","Guardado en Google Drive")
  .child(&icon(&DRIVE)?).child(&tick).done())
}

/// `await value` where the value may or may not be a promise.
async fn settle_value(value:JsValue)->R<JsValue>{settle(value).await}
/// `state.shelfScene?.getBookPose(spineEl)`.
fn ctx_scene_pose(ctx:&Ctx,node:&JsValue)->R<JsValue>{let scene=ctx.scene();if absent(&scene){Ok(undef())}else{method(&scene,"getBookPose",&[node])}}
