//! Taking an object off the shelf: a book, a plant or a lamp flies to the bin (or is removed at once from the
//! keyboard), and only after it has landed is it deleted. A failed write puts the book back, visibly. Also the
//! guard that swallows the compatibility click of a touch the shelf already handled.
use std::rc::Rc;
use wasm_bindgen::prelude::*;
use super::{util::*,ctx::{Ctx,RustShelfCtx},objects::*};

const EASE:&str="cubic-bezier(0.4, 0, 0.2, 1)";

fn trash_node(ctx:&Ctx)->JsValue{get(&ctx.parts,"trashNode")}
fn trash_status(ctx:&Ctx)->JsValue{get(&ctx.parts,"trashStatus")}
fn trash_announce(ctx:&Ctx)->JsValue{get(&ctx.parts,"trashAnnounce")}

/// `cancelTrashRemoval()`.
pub fn cancel_trash_removal(ctx:&Rc<Ctx>)->R{
 let operation=ctx.st("trashRemoval");
 if !truthy(&operation)||gb(&operation,"persisting"){return Ok(());}
 putb(&operation,"cancelled",true);
 method_opt(&get(&operation,"motion"),"cancel",&[])?;
 let clone=get(&operation,"clone");
 if !absent(&clone){method(&clone,"remove",&[])?;}
 cls_remove(&get(&operation,"node"),&["is-away"]);
 let bin=trash_node(ctx);
 if !absent(&bin){cls_remove(&bin,&["is-over"]);}
 ctx.scene_call("setTrashHover",&[&JsValue::FALSE])?;
 ctx.st_set("trashRemoval",&null());ctx.st_set("busy",&JsValue::FALSE);
 cls_remove(&ctx.root,&["is-discarding"]);
 ctx.scene_call("flush",&[])?;
 super::screen_lifecycle::apply_deferred_updates(&ctx)?;
 Ok(())
}

/// `removeBookInTrash(node, { motion, rect, duration })`.
pub async fn remove_in_trash(ctx:Rc<Ctx>,node:JsValue,motion:JsValue,rect_value:JsValue,duration:f64)->R<JsValue>{
 let key=object_key(&node);
 let plant=if cls_has(&node,"ihr-plant"){array_of(&ctx.st("plants")).into_iter().find(|item|get(item,"key")==key).unwrap_or(undef())}else{null()};
 let lamp=if cls_has(&node,"ihr-lamp"){array_of(&ctx.st("lamps")).into_iter().find(|item|get(item,"key")==key).unwrap_or(undef())}else{null()};
 let item=if truthy(&plant)||truthy(&lamp){null()}else{map_get(&ctx.st("itemsById"),&data_get(&node,"bookId"))};
 let has_trash=truthy(&get(&ctx.parts,"hasTrash"));
 let has_book_trash=truthy(&get(&ctx.parts,"hasBookTrash"));
 if !has_trash||!(truthy(&plant)||truthy(&lamp)||(has_book_trash&&truthy(&item)))||ctx.st_true("busy")||ctx.st_true("destroyed"){
  method_opt(&motion,"cancel",&[])?;
  return Ok(undef());
 }
 let operation=obj(&[("node",&node),("motion",&motion),("cancelled",&JsValue::FALSE),("persisting",&JsValue::FALSE),("clone",&null())]);
 ctx.st_set("trashRemoval",&operation);ctx.st_set("busy",&JsValue::TRUE);
 cls_add(&ctx.root,&["is-discarding"]);
 let status=trash_status(&ctx);let announce=trash_announce(&ctx);let bin=trash_node(&ctx);
 ctx.clear_timeout(&ctx.st("trashStatusTimer"));puts(&status,"textContent","");cls_remove(&status,&["is-error"]);puts(&announce,"textContent","");
 cls_add(&node,&["is-away"]);
 cls_add(&bin,&["is-over"]);
 let attempt=remove_flight(&ctx,&operation,&node,&rect_value,duration,&plant,&lamp,&item).await;
 let caught=match attempt{
  Ok(())=>Ok(()),
  Err(error)=>(||->R{
   method_opt(&get(&operation,"motion"),"cancel",&[])?;
   cls_remove(&node,&["is-away"]);
   let what=if truthy(&plant){"la planta"}else if truthy(&lamp){"la lámpara"}else{"el libro"};
   puts(&status,"textContent",&format!("No se pudo retirar {what}. Reintenta."));
   cls_add(&status,&["is-error"]);
   let timer=ctx.set_timeout(6500.0,|ctx|{puts(&trash_status(ctx),"textContent","");Ok(())});
   ctx.st_set("trashStatusTimer",&timer);
   warn("No se pudo retirar el objeto de la estantería:",&error);
   Ok(())
  })(),
 };
 let finished=(||->R{
  let clone=get(&operation,"clone");
  if !absent(&clone){method(&clone,"remove",&[])?;}
  if ctx.st("trashRemoval")==operation{
   ctx.st_set("trashRemoval",&null());ctx.st_set("busy",&JsValue::FALSE);
   cls_remove(&ctx.root,&["is-discarding"]);cls_remove(&bin,&["is-over"]);
   ctx.scene_call("setTrashHover",&[&JsValue::FALSE])?;
   if !ctx.st_true("destroyed"){
    // A sync may have queued newer records during the flight. Paint that final list once, instead of painting
    // the old list and then immediately rebuilding its layout when the queue is drained.
    let queued=ctx.st("queuedBooks");
    if truthy(&queued){
     ctx.st_set("queuedBooks",&null());
     super::screen_plan::refresh(&ctx,&queued,false)?;
    }else{super::screen_render::render(&ctx)?;}
    super::screen_lifecycle::apply_deferred_updates(&ctx)?;
   }
  }
  Ok(())
 })();
 finished?;caught?;
 Ok(undef())
}

/// The `try` of `removeBookInTrash`: the flight, the wait for the landing and the deletion.
#[allow(clippy::too_many_arguments)]
async fn remove_flight(ctx:&Rc<Ctx>,operation:&JsValue,node:&JsValue,rect_value:&JsValue,duration:f64,plant:&JsValue,lamp:&JsValue,item:&JsValue)->R{
 let bin=trash_node(ctx);
 if !truthy(&get(operation,"motion"))&&!gb(&bin,"hidden")&&ctx.st_str("viewMode")==ISOMETRIC{
  let start=if truthy(rect_value){rect_value.clone()}else{rect(node)?};
  let target=rect(&bin)?;
  let clone=method(node,"cloneNode",&[&JsValue::TRUE])?;
  put(operation,"clone",&clone);
  cls_remove(&clone,&["is-away","is-dragging","is-lifted"]);
  cls_add(&clone,&["ihr-trash-flight"]);
  remove_attr(&clone,"data-book-id");set_attr(&clone,"aria-hidden","true");put(&clone,"tabIndex",&f(-1.0));
  let clone_style=style(&clone);
  put(&clone_style,"position",&s("fixed"));
  put(&clone_style,"left",&s(&format!("{}px",ns(gn(&start,"left")))));
  put(&clone_style,"top",&s(&format!("{}px",ns(gn(&start,"top")))));
  put(&clone_style,"width",&s(&format!("{}px",ns(gn(&start,"width")))));
  put(&clone_style,"height",&s(&format!("{}px",ns(gn(&start,"height")))));
  put(&clone_style,"margin",&s("0"));put(&clone_style,"zIndex",&s("90"));put(&clone_style,"pointerEvents",&s("none"));
  append(&get(&document(),"body"),&clone);
  let dx=gn(&target,"left")+gn(&target,"width")/2.0-gn(&start,"left")-gn(&start,"width")/2.0;
  let dy=gn(&target,"top")+gn(&target,"height")*0.6-gn(&start,"top")-gn(&start,"height")/2.0;
  let flight=animate(&clone,&arr(&[
   &obj(&[("transform",&s("translate3d(0,0,0) rotateY(0deg) scale(1)")),("opacity",&f(1.0))]),
   &obj(&[("transform",&s(&format!("translate3d({}px,{}px,80px) rotateY(45deg) rotateZ(-18deg) scale(.65)",ns(dx*0.65),ns(dy*0.45-30.0)))),("opacity",&f(1.0)),("offset",&f(0.55))]),
   &obj(&[("transform",&s(&format!("translate3d({}px,{}px,-10px) rotateY(82deg) rotateZ(-32deg) scale(.12)",ns(dx),ns(dy)))),("opacity",&f(0.0))]),
  ]),&obj(&[("duration",&f(duration)),("easing",&s(EASE)),("fill",&s("both"))]))?;
  put(operation,"motion",&flight);
 }
 // Keyboard removal still works in the frontal view without flying to a hidden bin. Dragging to the visible
 // isometric bin retains its flight.
 let flying=get(operation,"motion");
 let landed=if truthy(&flying){wait_for_motion(&flying,duration).await?}else{true};
 if !landed{putb(operation,"cancelled",true);cls_remove(node,&["is-away"]);return Ok(());}
 if gb(operation,"cancelled")||ctx.st("trashRemoval")!=*operation||ctx.st_true("destroyed"){return Ok(());}
 ctx.sound_of(15,0,0.7);
 // Delete the app's record only after the model has landed. External originals are managed by the application
 // callback and stay intact.
 putb(operation,"persisting",true);
 let announce=trash_announce(ctx);
 if truthy(lamp){
  let previous=ctx.st("lamps");
  let kept:Vec<JsValue>=array_of(&previous).into_iter().filter(|record|get(record,"key")!=get(lamp,"key")).collect();
  ctx.st_set("lamps",&arr(&kept.iter().collect::<Vec<_>>()));
  if let Err(error)=save_lamps(ctx,true){ctx.st_set("lamps",&previous);return Err(error);}
  let name=ctx.env("getCatalogLamp",&[&get(lamp,"lampId")])?;
  puts(&announce,"textContent",&format!("{} retirada de la estantería",text(&read(&name,"name")?)));
  puts(&dataset(&ctx.root),"lastRemovedLamp",&text(&get(lamp,"key")));
  return Ok(());
 }
 if truthy(plant){
  let previous=ctx.st("plants");
  let kept:Vec<JsValue>=array_of(&previous).into_iter().filter(|record|get(record,"key")!=get(plant,"key")).collect();
  ctx.st_set("plants",&arr(&kept.iter().collect::<Vec<_>>()));
  if let Err(error)=save_plants(ctx,true,false){ctx.st_set("plants",&previous);return Err(error);}
  ctx.st_set("plantsInitialized",&JsValue::TRUE);
  let catalog=ctx.env("getCatalogPlant",&[&get(plant,"catalogId")])?;
  puts(&announce,"textContent",&format!("{} retirada de la estantería",text(&or(get(&catalog,"name"),s("Planta")))));
  puts(&dataset(&ctx.root),"lastRemovedPlant",&text(&get(plant,"key")));
  return Ok(());
 }
 // The book has landed in the bin: take it off the shelf now and let the stored removal finish in the background.
 // Waiting for IndexedDB (and the Drive-removed memory) here held the whole page still on a large library. A
 // failed write puts the book back, visibly.
 let book=read(item,"book")?;
 let id=string_value(&read(&book,"id")?);
 let books=array_of(&ctx.st("books"));
 let index=books.iter().position(|record|string_value(&get(record,"id"))==id);
 let persisted=match method(&ctx.options,"onBookRemove",&[&book]).map(|value|promise_resolve(&value)){
  Ok(promise)=>promise,
  Err(error)=>js_sys::Promise::reject(&error).into(),
 };
 method(&ctx.st("pendingRemovals"),"add",&[&id])?;
 let kept:Vec<JsValue>=books.into_iter().filter(|record|string_value(&get(record,"id"))!=id).collect();
 ctx.st_set("books",&arr(&kept.iter().collect::<Vec<_>>()));
 let queued=ctx.st("queuedBooks");
 if truthy(&queued){
  let rest:Vec<JsValue>=array_of(&queued).into_iter().filter(|record|string_value(&get(record,"id"))!=id).collect();
  ctx.st_set("queuedBooks",&arr(&rest.iter().collect::<Vec<_>>()));
 }
 let last=ctx.st("lastOpened");
 if string_value(&get(&get(&last,"book"),"id"))==id{ctx.st_set("lastOpened",&null());}
 map_delete(&ctx.st("coverAppearances"),&id);
 method(&get(&ctx.parts,"coverCache"),"delete",&[&book])?;
 let saved=get(&ctx.parts,"savedCoverUrls");
 for entry in js_sys::Array::from(&saved).iter(){
  let (cover_key,url)=(get_at(&entry,0),get_at(&entry,1));
  if truthy(&method(&cover_key,"startsWith",&[&join_strings(&[id.clone(),s("|")])])?){
   map_delete(&saved,&cover_key);
   if map_delete(&ctx.st("objectUrls"),&url){method_opt(&get(&global(),"URL"),"revokeObjectURL",&[&url])?;}
  }
 }
 let title=or(ctx.env("displayBookTitle",&[&book])?,s("Libro"));
 puts(&announce,"textContent",&format!("{} retirado de la estantería",text(&title)));
 put(&dataset(&ctx.root),"lastRemovedBook",&id);
 let (done_ctx,failed_ctx,done_id,failed_id)=(ctx.clone(),ctx.clone(),id.clone(),id.clone());
 let removed_book=book.clone();
 then(&persisted,move|_|{map_delete(&done_ctx.st("pendingRemovals"),&done_id);Ok(())},move|error|{
  let ctx=failed_ctx;let id=failed_id;
  map_delete(&ctx.st("pendingRemovals"),&id);
  warn("No se pudo retirar el objeto de la estantería:",&error);
  if ctx.st_true("destroyed"){return Ok(());}
  let announce=trash_announce(&ctx);let status=trash_status(&ctx);
  puts(&announce,"textContent","");
  puts(&status,"textContent","No se pudo retirar el libro. Vuelve a intentarlo.");
  cls_add(&status,&["is-error"]);
  ctx.clear_timeout(&ctx.st("trashStatusTimer"));
  let timer=ctx.set_timeout(6500.0,|ctx|{puts(&trash_status(ctx),"textContent","");Ok(())});
  ctx.st_set("trashStatusTimer",&timer);
  delete_key(&ctx.root_dataset(),"lastRemovedBook");
  let restore=|list:JsValue|->JsValue{
   let mut records=array_of(&list);
   if records.iter().any(|record|string_value(&get(record,"id"))==id){return list;}
   let at=match index{None=>records.len(),Some(index)=>index.min(records.len())};
   records.insert(at,removed_book.clone());
   arr(&records.iter().collect::<Vec<_>>())
  };
  // While another removal keeps the shelf busy only the queue is updated: refresh() would replace it with a list
  // built from state.books, dropping any book a sync queued in the meantime.
  let queued=ctx.st("queuedBooks");
  if truthy(&queued){ctx.st_set("queuedBooks",&restore(queued));}
  else{super::screen_plan::refresh(&ctx,&restore(ctx.st("books")),false)?;}
  Ok(())
 })?;
 Ok(())
}

impl Ctx{
 /// `root.dataset`.
 fn root_dataset(&self)->JsValue{dataset(&self.root)}
}

/// `pointerClick(event)`: a click a pointer produced, as opposed to the keyboard or assistive tech. Chromium can
/// deliver a touch's compatibility click with detail 0, so the pointer type counts too.
pub fn pointer_click(event:&JsValue)->bool{
 num(&get(event,"detail"))>0.0||["touch","mouse","pen"].contains(&text(&get(event,"pointerType")).as_str())
}

/// `clearOpeningClick?.()`.
pub fn clear_opening_click(ctx:&Ctx){
 let listeners=std::mem::take(&mut *ctx.opening_click.borrow_mut());
 drop(listeners);
}

/// `discardTouchCompatibilityClick(release)`: a touch handled on pointerup can still click a newly projected
/// surface or flyout. That contact's click is consumed before any surface acts twice; a new contact or a key press
/// ends the guard without a time window.
pub fn discard_touch_compatibility_click(ctx:&Rc<Ctx>,release:&JsValue)->R{
 clear_opening_click(ctx);
 let document=document();
 let (weak_click,weak_pointer,weak_key)=(Rc::downgrade(ctx),Rc::downgrade(ctx),Rc::downgrade(ctx));
 let release=release.clone();
 let discard=listen(&document,"click",None,true,move|event|{
  let Some(ctx)=weak_click.upgrade() else{return Ok(())};
  let pointer_type=get(&event,"pointerType");
  if !pointer_click(&event)||(truthy(&pointer_type)&&pointer_type!=s("touch")){return Ok(());}
  let id=get(&event,"pointerId");
  if !id.is_undefined()&&id!=get(&release,"pointerId"){return Ok(());}
  if hypot(num(&get(&event,"clientX"))-num(&get(&release,"clientX")),num(&get(&event,"clientY"))-num(&get(&release,"clientY")))>TAP_SLOP{return Ok(());}
  clear_opening_click(&ctx);
  method(&event,"preventDefault",&[])?;
  method(&event,"stopImmediatePropagation",&[])?;
  Ok(())
 })?;
 let on_pointer=listen(&document,"pointerdown",None,true,move|_|{if let Some(ctx)=weak_pointer.upgrade(){clear_opening_click(&ctx);}Ok(())})?;
 let on_key=listen(&document,"keydown",None,true,move|_|{if let Some(ctx)=weak_key.upgrade(){clear_opening_click(&ctx);}Ok(())})?;
 *ctx.opening_click.borrow_mut()=vec![discard,on_pointer,on_key];
 Ok(())
}

#[wasm_bindgen]
impl RustShelfCtx{
 #[wasm_bindgen(js_name=cancelTrashRemoval)]
 pub fn cancel_trash_removal(&self)->Result<(),JsValue>{cancel_trash_removal(&self.ctx)}
 #[wasm_bindgen(js_name=removeBookInTrash)]
 pub fn remove_book_in_trash(&self,node:JsValue,options:JsValue)->JsValue{
  let ctx=self.ctx.clone();
  run(async move{
   // `{ motion, rect, duration = prefersReducedMotion() ? 1 : 820 } = {}`
   let options=if options.is_undefined(){obj(&[])}else{options};
   let motion=read(&options,"motion")?;let rect_value=read(&options,"rect")?;let duration=read(&options,"duration")?;
   let duration=if duration.is_undefined(){if prefers_reduced_motion(){1.0}else{820.0}}else{num(&duration)};
   remove_in_trash(ctx,node,motion,rect_value,duration).await
  })
 }
 #[wasm_bindgen(js_name=discardTouchCompatibilityClick)]
 pub fn discard_touch_compatibility_click(&self,release:JsValue)->Result<(),JsValue>{discard_touch_compatibility_click(&self.ctx,&release)}
 #[wasm_bindgen(js_name=clearOpeningClick)]
 pub fn clear_opening_click(&self){clear_opening_click(&self.ctx)}
}
