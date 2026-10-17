//! Shelf lifecycle decisions; DOM event registration remains at the browser boundary.
use std::rc::Rc;
use wasm_bindgen::prelude::*;
use super::{util::*,ctx::{Ctx,RustShelfCtx},screen_plan,screen_render,covers,drag,trash,objects,returning};

pub fn clear_compatibility_tap_refresh(ctx:&Ctx){
 ctx.clear_timeout(&ctx.st("compatibilityTapTimer"));ctx.st_set("compatibilityTapTimer",&f(0.0));
}
pub fn defer_compatibility_tap_refresh(ctx:&Rc<Ctx>){
 clear_compatibility_tap_refresh(ctx);
 let timer=ctx.set_timeout(0.0,|ctx|{ctx.st_set("compatibilityTapTimer",&f(0.0));apply_deferred_updates(ctx)});
 ctx.st_set("compatibilityTapTimer",&timer);
}
pub fn apply_deferred_updates(ctx:&Rc<Ctx>)->R{
 if ["destroyed","returnMotion","reorderTimer","busy","session","dragSession","compatibilityTapTimer"].iter().any(|key|ctx.st_true(key)){return Ok(());}
 covers::maybe_refresh_appearance_styles(ctx)?;
 if ctx.st_true("queuedBooks"){
  let books=ctx.st("queuedBooks");ctx.st_set("queuedBooks",&null());screen_plan::refresh(ctx,&books,false)?;
 }else if ctx.st_true("renderQueued"){
  ctx.st_set("renderQueued",&JsValue::FALSE);screen_plan::schedule_render(ctx);
 }Ok(())
}
fn call_on_present(receiver:&JsValue,name:&str,args:&[&JsValue])->R<JsValue>{
 if nullish(receiver){Ok(undef())}else{method(receiver,name,args)}
}
pub fn viewport_resize(ctx:&Rc<Ctx>)->R{
 returning::finish_return_slot(ctx,false)?;
 method(&ctx.legacy_value("returnViews"),"clear",&[])?;
 trash::cancel_trash_removal(ctx)?;
 if truthy(&method_opt(&ctx.st("session"),"handleViewportResize",&[])?.unwrap_or(undef())){return Ok(());}
 let active=ctx.st("dragSession");if truthy(&active){drag::finish_spine_drag(ctx,&obj(&[("pointerId",&get(&active,"pointerId"))]),&get(&active,"node"),true,false)?;}
 call_on_present(&ctx.st("pendingSelection"),"cancel",&[])?;
 call_on_present(&ctx.st("session"),"close",&[&obj(&[("instant",&JsValue::TRUE),("silent",&JsValue::TRUE)])])?;
 call_on_present(&ctx.st("returnMotion"),"cancel",&[])?;
 screen_plan::schedule_render(ctx);Ok(())
}
pub fn visual_viewport_change(ctx:&Rc<Ctx>)->R{
 objects::clear_placement_preview(ctx,&undef())?;
 method_opt(&ctx.st("session"),"handleViewportResize",&[])?;Ok(())
}
pub fn observed_resize(ctx:&Rc<Ctx>)->R{
 if (screen_plan::measure(ctx)-num(&ctx.st("shelfWidth"))).abs()>=8.0{
  objects::clear_placement_preview(ctx,&undef())?;screen_plan::schedule_render(ctx);
 }Ok(())
}
pub fn refresh_fonts(ctx:&Rc<Ctx>)->R{
 if ctx.st_true("destroyed")||ctx.st_true("session")||ctx.st_true("useScene"){return Ok(());}
 for node in qsa(&ctx.scroller,".ihr-spine"){
  let body=qs(&node,".ihr-spine__body");let item=map_get(&ctx.st("itemsById"),&data_get(&node,"bookId"));
  if !truthy(&item)||nullish(&body)||!truthy(&qs(&body,"canvas")){continue;}
  let replacement=El::new("span").class("ihr-spine__body").attr("aria-hidden","true").done();
  let view=super::screen_nodes::spine_body_view(ctx,&replacement,&item)?;if !truthy(&view){continue;}
  method(&view,"dispose",&[&JsValue::FALSE])?;replace_with(&body,&replacement);
 }Ok(())
}


/// Initial state in the same field/evaluation order as the shelf's original constructor.
#[wasm_bindgen]
pub fn shelf_screen_state(env:JsValue,books:JsValue,options:JsValue)->Result<JsValue,JsValue>{
 let plants=super::screen_prefs::shelf_saved_plants(env.clone());
 let books=if js_sys::Array::is_array(&books){method(&books,"slice",&[])?}else{js_sys::Array::new().into()};
 let shelf_type=if truthy(&read(&options,"shelfType")?){call(&read(&env,"normalizeShelfType")?,"normalizeShelfType",&[&read(&options,"shelfType")?])?}
  else{super::screen_prefs::shelf_stored_type(env.clone())};
 let state=obj(&[
  ("books",&books),("shelfWidth",&f(0.0)),("metadataContext",&null()),("shelfType",&shelf_type),
  ("busy",&JsValue::FALSE),("session",&null()),("pendingSelection",&null()),("objectUrls",&new_set()?),
  ("destroyed",&JsValue::FALSE),("frame",&f(0.0)),("coverAppearances",&new_map()?),
  ("reliefProposals",&new_map()?),("appearanceTasks",&new_map()?),("itemsById",&new_map()?),
  ("placementObjects",&js_sys::Array::new().into()),("plants",&or(plants.clone(),js_sys::Array::new().into())),
  ("lamps",&super::screen_prefs::shelf_saved_lamps(env.clone())),("plantsInitialized",&b(plants!=null())),
  ("appearanceRefreshPending",&JsValue::FALSE),("pressedBookId",&null()),("lastOpened",&null()),("returnMotion",&null()),
  ("arranging",&JsValue::FALSE),("dragSession",&null()),("trashRemoval",&null()),("trashStatusTimer",&f(0.0)),
  ("suppressOpenBookId",&null()),("suppressLampClickKey",&null()),("queuedBooks",&null()),("compatibilityTapTimer",&f(0.0)),
  ("pendingRemovals",&new_set()?),("renderQueued",&JsValue::FALSE),("reorderTimer",&f(0.0)),
  ("appearancesReady",&JsValue::TRUE),("appearanceGeneration",&f(0.0)),("shelfScene",&null()),
  ("presentationActive",&JsValue::TRUE),("returningBookId",&null()),("returnSlotWaiter",&null())
 ]);
 let mut gl=read(&global(),"WebGLRenderingContext")?;if !truthy(&gl){gl=read(&global(),"WebGL2RenderingContext")?;}
 let scene=if truthy(&gl){truthy(&call(&read(&env,"getBookRenderer")?,"getBookRenderer",&[])?)}else{false};
 putb(&state,"useScene",scene);
 let view=read(&options,"viewMode")?;
 put(&state,"viewMode",&if view==s("spine")||view==s("isometric"){read(&options,"viewMode")?}else{super::screen_prefs::shelf_stored_view(s("spine"))});
 Ok(state)
}

fn clear_press(ctx:&Ctx){
 ctx.st_set("pressedBookId",&null());for node in qsa(&ctx.scroller,".is-pressed"){cls_remove(&node,&["is-pressed","is-press-pending"]);}
}
pub fn begin_view_gesture(ctx:&Rc<Ctx>,event:&JsValue)->R{
 let active=ctx.st("dragSession");if truthy(&active){putb(&active,"cancelled",true);drag::finish_spine_drag(ctx,event,&get(&active,"node"),true,false)?;}
 clear_press(ctx);Ok(())
}
pub fn begin_zoom_gesture(ctx:&Rc<Ctx>)->R{
 let active=ctx.st("dragSession");if truthy(&active){drag::finish_spine_drag(ctx,&obj(&[("pointerId",&get(&active,"pointerId"))]),&get(&active,"node"),true,false)?;}
 clear_press(ctx);method_opt(&ctx.scene(),"beginInspectionGesture",&[])?;Ok(())
}
fn prefetch_catalog(ctx:&Ctx)->R{
 if !ctx.st_true("destroyed"){method(&get(&ctx.parts,"plantCatalog"),"prefetch",&[])?;}Ok(())
}
fn catalog_idle(ctx:&Rc<Ctx>)->R<JsValue>{
 let idle=read(&global(),"requestIdleCallback")?;
 if idle.is_function(){
  let weak=Rc::downgrade(ctx);let run=ctx.input_callbacks.make(Stale::Undefined,move|_,_|{
   if let Some(ctx)=weak.upgrade(){prefetch_catalog(&ctx)?;}Ok(undef())
  });
  method(&global(),"requestIdleCallback",&[&run,&obj(&[("timeout",&f(4000.0))])])
 }else{Ok(ctx.set_timeout(1500.0,|ctx|prefetch_catalog(ctx)))}
}
pub fn prepare_catalog_when_idle(ctx:&Rc<Ctx>,delay:f64)->R{
 if ctx.st_true("catalogPrepare")||truthy(&ctx.opts_get("sections"))||ctx.st("viewMode")!=s("isometric"){return Ok(());}
 let id=if delay!=0.0&&!delay.is_nan(){ctx.set_timeout(delay,|ctx|{catalog_idle(ctx)?;Ok(())})}else{catalog_idle(ctx)?};
 ctx.st_set("catalogPrepare",&id);Ok(())
}
pub fn set_view_mode(ctx:&Rc<Ctx>,mode:&JsValue)->R{
 if ctx.st_true("trashRemoval")||(*mode!=s("spine")&&*mode!=s("isometric"))||ctx.st("viewMode")==*mode{return Ok(());}
 ctx.st_set("viewMode",mode);
 let persist=||->R{local_storage_set("inhouse-read-shelf-view",&text(mode))?;ctx.env("notifyCloudSettingsChanged",&[&s("inhouse-read-shelf-view")])?;Ok(())};let _=persist();
 prepare_catalog_when_idle(ctx,0.0)?;
 if ctx.st_true("shelfScene"){
  put(&dataset(&ctx.root),"viewMode",mode);method(&ctx.scene(),"setMode",&[mode])?;ctx.legacy("syncShelfZoom",&[])?;
 }else{screen_render::render(ctx)?;}Ok(())
}


#[wasm_bindgen]
pub fn shelf_can_change_view(state:JsValue)->Result<bool,JsValue>{
 if ["destroyed","busy","session","returnMotion","trashRemoval","arranging"].iter().any(|key|gb(&state,key)){return Ok(false);}
 let zoom=method_opt(&get(&state,"shelfScene"),"getInspectionZoom",&[])?.unwrap_or(undef());Ok(num(&or(zoom,f(1.0)))<=1.001)
}
#[wasm_bindgen]
pub fn shelf_can_zoom(state:JsValue)->bool{
 gb(&state,"shelfScene")&&get(&state,"viewMode")==s("isometric")&&!["busy","session","returnMotion","trashRemoval"].iter().any(|key|gb(&state,key))
}

#[wasm_bindgen]
pub fn shelf_public_close(state:JsValue)->Result<JsValue,JsValue>{
 call_on_present(&get(&state,"pendingSelection"),"cancel",&[])?;
 let result=call_on_present(&get(&state,"session"),"close",&[])?;
 Ok(if nullish(&result){promise_resolve(&undef())}else{result})
}
#[wasm_bindgen]
pub fn shelf_update_cloud_record(state:JsValue,record:JsValue)->Result<(),JsValue>{
 let session=get(&state,"session");
 let id=if nullish(&session){undef()}else{read(&read(&session,"book")?,"id")?};
 if id==read(&record,"id")?{
  // The original dereferences session here, after the optional-chain comparison above.
  if nullish(&session){let _=read(&session,"updateCloudRecord")?;}method_opt(&session,"updateCloudRecord",&[&record])?;
 }Ok(())
}
#[wasm_bindgen]
pub fn shelf_set_presentation_active(state:JsValue,value:JsValue)->Result<(),JsValue>{
 let value=b(truthy(&value));put(&state,"presentationActive",&value);method_opt(&get(&state,"shelfScene"),"setPresentationActive",&[&value])?;Ok(())
}
#[wasm_bindgen]
pub fn shelf_has_reader_origin(state:JsValue,book_id:JsValue)->Result<bool,JsValue>{
 let last=get(&state,"lastOpened");let id=if nullish(&last){undef()}else{read(&read(&last,"book")?,"id")?};Ok(id==book_id)
}
#[wasm_bindgen]
pub fn shelf_prepare_opening_page(state:JsValue,book_id:JsValue,snapshot:JsValue,idle:JsValue)->Result<JsValue,JsValue>{
 let session=get(&state,"session");let warm=if nullish(&session){undef()}else{read(&session,"warmOpeningPage")?};
 if !truthy(&warm)||gb(&session,"cancelled")||read(&read(&session,"book")?,"id")?!=book_id{return Ok(promise_resolve(&JsValue::FALSE));}
 method(&session,"warmOpeningPage",&[&snapshot,&idle])
}

fn set_catalog_shelf_type(ctx:&Ctx,shelf_type:&JsValue)->R{
 ctx.st_set("shelfType",&ctx.env("normalizeShelfType",&[shelf_type])?);
 let persist=||->R{local_storage_set("inhouse-read-shelf-type",&text(&ctx.st("shelfType")))?;ctx.env("notifyCloudSettingsChanged",&[&s("inhouse-read-shelf-type")])?;Ok(())};let _=persist();Ok(())
}
fn open_catalog(ctx:&Ctx)->R{
 if !["busy","session","dragSession","returnMotion"].iter().any(|key|ctx.st_true(key))&&ctx.st("viewMode")==s("isometric"){
  let catalog=get(&ctx.parts,"plantCatalog");method(&catalog,"setShelfType",&[&ctx.st("shelfType")])?;method(&catalog,"open",&[&get(&ctx.parts,"catalogNode")])?;
 }Ok(())
}

#[wasm_bindgen]
impl RustShelfCtx{
 #[wasm_bindgen(js_name=lifecycleCallbacks)]
 pub fn lifecycle_callbacks(&self)->JsValue{
  let callbacks=obj(&[]);
  for name in ["clearCompatibilityTapRefresh","deferCompatibilityTapRefresh","applyDeferredShelfUpdates",
   "viewportResize","visualViewportChange","observedResize","refreshFonts","beginViewGesture","beginZoomGesture",
   "prepareCatalogWhenIdle","setViewMode","setCatalogShelfType","setCatalogMotion","openCatalog","destroy"]{
   let weak=Rc::downgrade(&self.ctx);
   let callback=self.ctx.input_callbacks.make(Stale::Undefined,move|argument,_|{
    let Some(ctx)=weak.upgrade()else{return Ok(undef())};
    match name{
     "clearCompatibilityTapRefresh"=>clear_compatibility_tap_refresh(&ctx),
     "deferCompatibilityTapRefresh"=>defer_compatibility_tap_refresh(&ctx),
     "applyDeferredShelfUpdates"=>apply_deferred_updates(&ctx)?,
     "viewportResize"=>viewport_resize(&ctx)?,
     "visualViewportChange"=>visual_viewport_change(&ctx)?,
     "observedResize"=>observed_resize(&ctx)?,
     "refreshFonts"=>refresh_fonts(&ctx)?,
     "beginViewGesture"=>begin_view_gesture(&ctx,&argument)?,
     "beginZoomGesture"=>begin_zoom_gesture(&ctx)?,
     "prepareCatalogWhenIdle"=>prepare_catalog_when_idle(&ctx,num(&argument))?,
     "setViewMode"=>set_view_mode(&ctx,&argument)?,
     "setCatalogShelfType"=>set_catalog_shelf_type(&ctx,&argument)?,
     "setCatalogMotion"=>{method_opt(&ctx.scene(),"setPaintHeld",&[&b(argument==s("start"))])?;},
     "openCatalog"=>open_catalog(&ctx)?,
     "destroy"=>destroy_screen(&ctx)?,
     _=>{}
    }Ok(undef())
   });
   put(&callbacks,name,&callback);
  }callbacks
 }
}

fn destroy_screen(ctx:&Rc<Ctx>)->R{
 method_opt(&ctx.scene(),"setModalBackgroundDeferred",&[&null(),&obj(&[("resumeHidden",&JsValue::TRUE)])])?;
 ctx.st_set("destroyed",&JsValue::TRUE);
 call_on_present(&get(&ctx.parts,"soundBindings"),"destroy",&[])?;
 returning::finish_return_slot(ctx,false)?;clear_compatibility_tap_refresh(ctx);
 method(&ctx.legacy_value("returnViews"),"clear",&[])?;trash::clear_opening_click(ctx);
 for key in ["plantCatalog","shelfViewGesture","shelfZoom"]{method(&get(&ctx.parts,key),"destroy",&[])?;}
 trash::cancel_trash_removal(ctx)?;
 let active=ctx.st("dragSession");if truthy(&active){drag::finish_spine_drag(ctx,&obj(&[("pointerId",&get(&active,"pointerId"))]),&get(&active,"node"),true,false)?;}
 call_on_present(&ctx.st("pendingSelection"),"cancel",&[])?;
 call_on_present(&ctx.st("returnMotion"),"cancel",&[])?;
 call_on_present(&ctx.st("session"),"close",&[&obj(&[("instant",&JsValue::TRUE),("silent",&JsValue::TRUE)])])?;
 if ctx.st_true("frame"){ctx.cancel_frame_id(&ctx.st("frame"));}
 ctx.clear_timeout(&ctx.st("reorderTimer"));ctx.clear_timeout(&ctx.st("trashStatusTimer"));
 call_on_present(&get(&ctx.parts,"observer"),"disconnect",&[])?;
 call_on_present(&ctx.scene(),"dispose",&[])?;
 method(&window(),"removeEventListener",&[&s("resize"),&get(&ctx.parts,"onViewportResize")])?;
 let visual=get(&window(),"visualViewport");
 call_on_present(&visual,"removeEventListener",&[&s("resize"),&get(&ctx.parts,"onVisualViewportChange")])?;
 call_on_present(&visual,"removeEventListener",&[&s("scroll"),&get(&ctx.parts,"onVisualViewportChange")])?;
 let url=get(&global(),"URL");
 if get(&url,"revokeObjectURL").is_function(){if let Some(values)=js_sys::try_iter(&ctx.st("objectUrls"))?{for value in values{method(&url,"revokeObjectURL",&[&value?])?;}}}
 method(&ctx.st("objectUrls"),"clear",&[])?;ctx.clear_view_bindings();remove(&ctx.root);Ok(())
}

/// The original public destroy may be called repeatedly. A later call must
/// repeat host cleanup without retaining a Rust context after its first free.
#[wasm_bindgen]
pub fn shelf_destroy_dispatch(parts:JsValue,live_callback:JsValue)->Result<(),JsValue>{
 if live_callback.is_function(){call(&live_callback,"destroy",&[])?;Ok(())}
 else{destroy_screen(&Rc::new(Ctx::new(parts)?))}
}
