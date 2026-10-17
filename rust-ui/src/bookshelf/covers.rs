//! The covers of the books on the shelf: the URL of each (one per saved cover, so decoded pixels survive a
//! refresh), the cloth and colour read from it, and the refresh of the spine that shows the result. The
//! analysis of the image, the storage and the 3D view stay the host's.
use std::{cell::RefCell,rc::Rc};
use wasm_bindgen::prelude::*;
use js_sys::Object;
use super::{util::*,ctx::{Ctx,RustShelfCtx},style::*};

/// `String(book?.id ?? book?.path ?? book?.title ?? 'book')`.
pub fn book_id(book:&JsValue)->JsValue{
 string_value(&coalesce(get(book,"id"),coalesce(get(book,"path"),coalesce(get(book,"title"),s("book")))))
}

/// `typeof Blob !== 'undefined' && value instanceof Blob`.
fn is_blob(value:&JsValue)->bool{
 let blob=get(&global(),"Blob");
 if !blob.is_function(){return false;}
 let prototype=get(&blob,"prototype");
 prototype.is_object()&&Object::from(prototype).is_prototype_of(value)
}

/// `coverKeyFor(book)`.
pub fn cover_key_for(book:&JsValue)->JsValue{
 let id=book_id(book);
 let cover=coalesce(get(book,"cover"),coalesce(get(book,"coverBlob"),get(book,"coverUrl")));
 let title=string_value(&coalesce(get(book,"title"),s("")));
 let mut parts=vec![id,s("|"),title,s("|")];
 if is_blob(&cover){
  parts.extend([string_value(&get(&cover,"type")),s("|"),string_value(&get(&cover,"size")),s("|"),
   string_value(&coalesce(get(&cover,"lastModified"),s("")))]);
  let updated=get(book,"coverUpdatedAt");
  if truthy(&updated){parts.extend([s("|"),string_value(&updated)]);}
 }else if cover.is_string(){parts.push(cover);}
 join_strings(&parts)
}

impl Ctx{
 fn cover_cache(&self)->JsValue{get(&self.parts,"coverCache")}
 fn saved_cover_urls(&self)->JsValue{get(&self.parts,"savedCoverUrls")}
 fn busy_for_refresh(&self)->bool{
  self.st_true("busy")||self.st_true("session")||self.st_true("returnMotion")||self.st_true("dragSession")||self.st_true("compatibilityTapTimer")
 }
}

/// `toUrl(source)`: a string is its own URL, a Blob gets an object URL the shelf revokes later.
fn to_url(ctx:&Ctx,source:&JsValue)->R<JsValue>{
 if !truthy(source){return Ok(null());}
 if source.is_string(){return Ok(source.clone());}
 if is_blob(source){
  let url=method(&get(&global(),"URL"),"createObjectURL",&[source])?;
  method(&ctx.st("objectUrls"),"add",&[&url])?;
  return Ok(url);
 }
 Ok(null())
}

/// `cachedCover(book)`.
fn cached_cover(ctx:&Ctx,book:&JsValue)->R<JsValue>{
 let saved=method(&ctx.saved_cover_urls(),"get",&[&cover_key_for(book)])?;
 if truthy(&saved){method(&ctx.cover_cache(),"set",&[book,&saved])?;}
 Ok(saved)
}

/// `rememberCover(book, url)`.
fn remember_cover(ctx:&Ctx,book:&JsValue,url:&JsValue)->R<JsValue>{
 method(&ctx.cover_cache(),"set",&[book,url])?;
 if truthy(url)&&(truthy(&get(book,"cover"))||truthy(&get(book,"coverBlob"))||truthy(&get(book,"coverUrl"))){
  method(&ctx.saved_cover_urls(),"set",&[&cover_key_for(book),url])?;
 }
 Ok(url.clone())
}

/// `book.cover ?? book.coverUrl ?? book.coverBlob`.
fn stored_cover(book:&JsValue)->R<JsValue>{
 Ok(coalesce(read(book,"cover")?,coalesce(read(book,"coverUrl")?,read(book,"coverBlob")?)))
}

/// `resolveCover(book)`: the cover's URL, from the application's source first and the record's own cover next.
pub async fn resolve_cover(ctx:Rc<Ctx>,book:JsValue)->R<JsValue>{
 if truthy(&method(&ctx.cover_cache(),"has",&[&book])?){return method(&ctx.cover_cache(),"get",&[&book]);}
 let saved=cached_cover(&ctx,&book)?;
 if truthy(&saved){return Ok(saved);}
 let mut url=null();
 let attempt=async{
  let source_for=read(&ctx.options,"coverSrcFor")?;
  if source_for.is_function(){
   let source=settle(method(&ctx.options,"coverSrcFor",&[&book])?).await?;
   url=to_url(&ctx,&source)?;
  }
  if !truthy(&url){url=to_url(&ctx,&stored_cover(&book)?)?;}
  Ok::<(),JsValue>(())
 }.await;
 // A cover that fails cannot stop the book from opening.
 if attempt.is_err(){url=null();}
 remember_cover(&ctx,&book,&url)
}

/// `resolveCover(book)` as the promise an `async function` returns: awaiting it always takes a turn, even when the
/// cover was already known, as it does in the original.
pub fn resolve_cover_promise(ctx:&Rc<Ctx>,book:&JsValue)->JsValue{
 let (ctx,book)=(ctx.clone(),book.clone());
 run(async move{resolve_cover(ctx,book).await})
}

/// `coverRatioFor(style, fallback = opts.coverRatio)`.
pub fn cover_ratio_for(ctx:&Ctx,style:&JsValue,fallback:&JsValue)->R<JsValue>{
 let fallback=if fallback.is_undefined(){ctx.opts_get("coverRatio")}else{fallback.clone()};
 Ok(or(ctx.env("coverAspectRatio",&[&get(style,"coverRatio"),&f(1.0)])?,fallback))
}

/// `maybeRefreshAppearanceStyles()`: the styles that changed while the shelf was busy are drawn once it is free.
pub fn maybe_refresh_appearance_styles(ctx:&Rc<Ctx>)->R{
 if !ctx.st_true("appearanceRefreshPending")||ctx.busy_for_refresh()||ctx.st_true("destroyed"){return Ok(());}
 ctx.st_set("appearanceRefreshPending",&JsValue::FALSE);
 super::screen_plan::schedule_render(&ctx);
 Ok(())
}

/// `resolveCoverImmediately(book)`: the return from the reader needs its first frame before the browser paints
/// the shelf, and the normal resolution awaits even when the cover is already a Blob.
pub fn resolve_cover_immediately(ctx:&Ctx,book:&JsValue)->R<JsValue>{
 if truthy(&method(&ctx.cover_cache(),"has",&[book])?){return method(&ctx.cover_cache(),"get",&[book]);}
 let saved=cached_cover(ctx,book)?;
 if truthy(&saved){return Ok(saved);}
 let attempt=||->R<JsValue>{
  let source_for=read(&ctx.options,"coverSrcFor")?;
  let source=if source_for.is_function(){method(&ctx.options,"coverSrcFor",&[book])?}else{stored_cover(book)?};
  if truthy(&source)&&is_fn(&get(&source,"then")){return Ok(null());}
  let url=to_url(ctx,&source)?;
  let url=if truthy(&url){url}else{to_url(ctx,&stored_cover(book)?)?};
  remember_cover(ctx,book,&url)
 };
 Ok(attempt().unwrap_or(null()))
}

/// `resolveCoverAppearance(book, knownUrl)`: one analysis per cover key; a result older than the record on the shelf
/// is not allowed to overwrite it.
pub fn resolve_cover_appearance(ctx:&Rc<Ctx>,book:&JsValue,known_url:&JsValue)->R<JsValue>{
 let key=cover_key_for(book);
 let id=book_id(book);
 let appearances=ctx.st("coverAppearances");
 let cached=map_get(&appearances,&id);
 if get(&cached,"key")==key&&get(&cached,"complete")!=JsValue::FALSE{return Ok(promise_resolve(&get(&cached,"appearance")));}
 let tasks=ctx.st("appearanceTasks");
 if map_has(&tasks,&key){return Ok(map_get(&tasks,&key));}
 let (task_ctx,task_book,task_url,task_key,task_id)=(ctx.clone(),book.clone(),known_url.clone(),key.clone(),id);
 let task=run(async move{appearance_task(task_ctx,task_book,task_url,task_key,task_id).await});
 // `.finally(() => state.appearanceTasks.delete(key))`
 let finished_ctx=ctx.clone();let finished_key=key.clone();
 let task=finally(&task,move||{map_delete(&finished_ctx.st("appearanceTasks"),&finished_key);Ok(())})?;
 map_set(&tasks,&key,&task);
 Ok(task)
}

/// Whether the record on the shelf has a newer cover than the one being analysed.
fn is_stale(ctx:&Ctx,id:&JsValue,key:&JsValue)->bool{
 let current=array_of(&ctx.st("books")).into_iter().find(|candidate|book_id(candidate)==*id);
 match current{Some(current)=>cover_key_for(&current)!=*key,None=>false}
}

async fn appearance_task(ctx:Rc<Ctx>,book:JsValue,known_url:JsValue,key:JsValue,id:JsValue)->R<JsValue>{
 let appearances=ctx.st("coverAppearances");
 let url=if truthy(&known_url){known_url.clone()}else{settle(resolve_cover_promise(&ctx,&book)).await?};
 if !truthy(&url){
  if !is_stale(&ctx,&id,&key){map_set(&appearances,&id,&obj(&[("key",&key),("appearance",&null()),("complete",&JsValue::TRUE)]));}
  return Ok(null());
 }
 let appearance=settle(ctx.env("analyzeCoverAppearance",&[&url,&text_or_empty(&get(&book,"title"))])?).await?;
 if ctx.st_true("destroyed"){return Ok(null());}
 if is_stale(&ctx,&id,&key){return Ok(appearance);}
 map_set(&appearances,&id,&obj(&[("key",&key),("appearance",&appearance),("complete",&JsValue::TRUE)]));
 if !truthy(&appearance){return Ok(null());}
 let saved=async{
  // `await options.onCoverAppearance?.(...)`: an absent callback still yields one turn.
  settle(ctx.option_call("onCoverAppearance",&[&book,&appearance,&key])?).await?;
  Ok::<(),JsValue>(())
 }.await;
 if let Err(error)=saved{warn("No se pudo guardar el aspecto de la portada:",&error);}
 let item=map_get(&ctx.st("itemsById"),&id);
 if truthy(&item)&&get(&item,"coverKey")==key&&apply_cover_appearance(&ctx,&item,&appearance)?{
  let session=ctx.st("session");
  if string_value(&coalesce(get(&get(&session,"book"),"id"),s("")))==id{
   let view=get(&session,"view");
   if !absent(&view){method(&view,"updateAppearance",&[&get(&item,"style"),&obj(&[("reuseModel",&JsValue::TRUE)])])?;}
   update_book_style_vars(&get(&session,"bookNode"),&get(&item,"style"));
   let book_node=get(&session,"bookNode");
   let face=if absent(&book_node){undef()}else{method(&book_node,"querySelector",&[&s(".ihr-flyout__face--cover")])?};
   update_book_style_vars(&face,&get(&item,"style"));
  }
  let last=ctx.st("lastOpened");
  if string_value(&coalesce(get(&get(&last,"book"),"id"),s("")))==id{put(&last,"style",&get(&item,"style"));}
  let existing=qsa(&ctx.root,".ihr-spine").into_iter().find(|node|data_get(node,"bookId")==id);
  let pressed=ctx.st("pressedBookId");
  if let Some(existing)=existing.filter(|node|is_connected(node)&&!ctx.busy_for_refresh()&&pressed!=id){
   if !absent(&ctx.scene()){
    let cover_url=resolve_cover_immediately(&ctx,&get(&item,"book"))?;
    ctx.scene_call("updateEntry",&[&existing,&get(&item,"book"),&get(&item,"style"),&cover_url])?;
    return Ok(appearance);
   }
   let had_focus=active_element()==existing;
   let replacement=super::screen_nodes::build_spine(&ctx,&item)?;
   replace_with(&existing,&replacement);
   let last=ctx.st("lastOpened");
   if string_value(&coalesce(get(&get(&last,"book"),"id"),s("")))==id{put(&last,"spineEl",&replacement);}
   if had_focus{method(&replacement,"focus",&[&obj(&[("preventScroll",&JsValue::TRUE)])])?;}
  }else{
   ctx.st_set("appearanceRefreshPending",&JsValue::TRUE);
  }
 }
 Ok(appearance)
}

/// `book?.title ?? ''` as the text handed to the analysis.
fn text_or_empty(value:&JsValue)->JsValue{coalesce(value.clone(),s(""))}

/// `quickCoverAppearance(book, url)`: the appearance if it arrives within 20 ms, `null` otherwise.
pub fn quick_cover_appearance(ctx:&Rc<Ctx>,book:&JsValue,url:&JsValue)->R<JsValue>{
 if !truthy(url){return Ok(promise_resolve(&null()));}
 let (promise,resolve,reject)=deferred();
 let timer:Rc<RefCell<Option<Timer>>>=Rc::new(RefCell::new(None));
 let on_time=resolve.clone();
 *timer.borrow_mut()=Some(after(20.0,move||{let _=on_time.call1(&undef(),&null());Ok(())}));
 let body=||->R{
  let analysis=resolve_cover_appearance(ctx,book,url)?;
  let (done,failed)=(timer.clone(),timer.clone());
  let (on_value,on_error)=(resolve.clone(),resolve.clone());
  then(&analysis,move|appearance|{
   if let Some(pending)=done.borrow_mut().take(){cancel(&pending);}
   let _=on_value.call1(&undef(),&appearance);Ok(())
  },move|_|{
   if let Some(pending)=failed.borrow_mut().take(){cancel(&pending);}
   let _=on_error.call1(&undef(),&null());Ok(())
  })?;
  Ok(())
 };
 // An error in the executor rejects the promise.
 if let Err(error)=body(){let _=reject.call1(&undef(),&error);}
 Ok(promise)
}

/// `warmCover(book)`: pointer down starts the cover loading, so it is painted when the lift shows its face.
pub fn warm_cover(ctx:&Rc<Ctx>,book:&JsValue)->R{
 let (for_ctx,for_book)=(ctx.clone(),book.clone());
 let promise=resolve_cover_promise(ctx,book);
 then_map(&promise,move|url|{
  if !truthy(&url){return Ok(undef());}
  resolve_cover_appearance(&for_ctx,&for_book,&url)?;
  if get(&global(),"Image").is_function(){
   let image=construct("Image",&[])?;
   put(&image,"decoding",&s("async"));
   put(&image,"src",&url);
  }
  Ok(undef())
 },|error|Err(error))?;
 Ok(())
}

#[wasm_bindgen]
impl RustShelfCtx{
 #[wasm_bindgen(js_name=resolveCover)]
 pub fn resolve_cover(&self,book:JsValue)->JsValue{resolve_cover_promise(&self.ctx,&book)}
 #[wasm_bindgen(js_name=coverKeyFor)]
 pub fn cover_key_for(&self,book:JsValue)->JsValue{cover_key_for(&book)}
 #[wasm_bindgen(js_name=coverRatioFor)]
 pub fn cover_ratio_for(&self,style:JsValue,fallback:JsValue)->Result<JsValue,JsValue>{cover_ratio_for(&self.ctx,&style,&fallback)}
 #[wasm_bindgen(js_name=resolveCoverImmediately)]
 pub fn resolve_cover_immediately(&self,book:JsValue)->Result<JsValue,JsValue>{resolve_cover_immediately(&self.ctx,&book)}
 #[wasm_bindgen(js_name=resolveCoverAppearance)]
 pub fn resolve_cover_appearance(&self,book:JsValue,known_url:JsValue)->Result<JsValue,JsValue>{resolve_cover_appearance(&self.ctx,&book,&known_url)}
 #[wasm_bindgen(js_name=quickCoverAppearance)]
 pub fn quick_cover_appearance(&self,book:JsValue,url:JsValue)->Result<JsValue,JsValue>{quick_cover_appearance(&self.ctx,&book,&url)}
 #[wasm_bindgen(js_name=warmCover)]
 pub fn warm_cover(&self,book:JsValue)->Result<(),JsValue>{warm_cover(&self.ctx,&book)}
 #[wasm_bindgen(js_name=maybeRefreshAppearanceStyles)]
 pub fn maybe_refresh_appearance_styles(&self)->Result<(),JsValue>{maybe_refresh_appearance_styles(&self.ctx)}
}
