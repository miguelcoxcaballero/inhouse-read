//! Screen layout planning and repaint scheduling. The browser supplies dimensions and owns the
//! animation clock; Rust owns the layout records, initial decorations and deferred repaint decisions.
use std::rc::Rc;
use wasm_bindgen::prelude::*;
use js_sys::Array;
use super::{util::*,ctx::{Ctx,RustShelfCtx},objects,style::spread};

pub fn measure(ctx:&Ctx)->f64{
 let explicit=ctx.option("shelfWidth");
 if is_finite(&explicit)&&num(&explicit)>0.0{return round(num(&explicit));}
 let mut width=get(&ctx.scroller,"clientWidth");
 if !truthy(&width){width=get(&ctx.container,"clientWidth");}
 max(0.0,round(num(&or(width,f(0.0)))))
}

pub fn metadata_context(ctx:&Ctx)->R<String>{
 json(&arr(&[&f(inner_width()),&f(inner_height()),&or(get(&window(),"devicePixelRatio"),f(1.0)),
  &ctx.st("shelfType"),&ctx.st("viewMode"),&get(&ctx.scroller,"clientHeight")]))
}

pub fn consume_render_requests(ctx:&Ctx){
 let frame=ctx.st("frame");if truthy(&frame){ctx.cancel_frame_id(&frame);}
 ctx.st_set("frame",&f(0.0));ctx.st_set("renderQueued",&JsValue::FALSE);ctx.st_set("appearanceRefreshPending",&JsValue::FALSE);
}

pub fn schedule_render(ctx:&Rc<Ctx>){
 if ["returnMotion","reorderTimer","busy","session","dragSession","compatibilityTapTimer"].iter().any(|key|ctx.st_true(key)){
  ctx.st_set("renderQueued",&JsValue::TRUE);return;
 }
 if ctx.st_true("frame"){return;}
 let frame=ctx.set_frame(|ctx|{
  ctx.st_set("frame",&f(0.0));
  if ctx.st_true("queuedBooks"){ctx.legacy("applyDeferredShelfUpdates",&[])?;}else{ctx.legacy("render",&[])?;}
  Ok(())
 });
 ctx.st_set("frame",&frame);
}

fn has_placed_book(ctx:&Ctx)->bool{
 let books=ctx.st("books");let length=gn(&books,"length") as u32;
 (0..length).any(|index|gb(&get_at(&books,index),"shelfPosition"))
}

pub fn freely_placed_shelves(ctx:&Ctx,shelves:&JsValue)->R<JsValue>{
 let cfg=objects::placement_config(ctx)?;
 let padding=gn(&cfg,"padding");let inner_width=gn(&cfg,"shelfWidth")-padding*2.0;
 let objects=Array::new();let initial_plants=Array::new();
 for shelf in array_of(shelves){
  let mut cursor=padding;
  for item in array_of(&get(&shelf,"items")){
   let book=get(&item,"book");let is_book=get(&item,"kind")==s("book");
   let key=if is_book{join_strings(&[s("book:"),string_value(&get(&book,"id"))])}
    else{join_strings(&[s("plant:"),string_value(&get(&item,"seed"))])};
   let width=gn(&item,"width");let x=(cursor+width/2.0-padding)/inner_width;
   let new_book=is_book&&!gb(&book,"shelfPosition")&&has_placed_book(ctx);
   let object=spread(&[&item,&obj(&[("key",&key),("shelf",&get(&shelf,"index")),("x",&if new_book{undef()}else{f(x)}),("tilt",&f(0.0))])]);
   if is_book{objects.push(&object);}else{initial_plants.push(&object);}
   cursor+=width+gn(&cfg,"gap");
  }
 }
 if !ctx.st_true("plantsInitialized"){
  let plants=Array::new();
  for item in initial_plants.iter(){
   let variant=get(&item,"variant");
   let plant=ctx.env("resolveCatalogPlant",&[&obj(&[("variant",&variant)])])?;
   plants.push(&ctx.env("normalizeShelfPlant",&[&obj(&[("key",&get(&item,"key")),("seed",&get(&item,"seed")),("variant",&variant),
    ("shelf",&get(&item,"shelf")),("x",&get(&item,"x")),("potId",&get(&plant,"defaultPotId"))])])?);
  }
  ctx.st_set("plants",&plants.into());ctx.st_set("plantsInitialized",&JsValue::TRUE);
  objects::save_plants(ctx,false,true)?;
 }
 let scale=objects::plant_scale(ctx)?;
 for plant in array_of(&ctx.st("plants")){objects.push(&objects::plant_shelf_object(ctx,&plant,scale)?);}
 for lamp in array_of(&ctx.st("lamps")){objects.push(&objects::lamp_shelf_object(ctx,&lamp)?);}
 let placements=obj(&[]);
 for item in objects.iter(){
  let book=get(&item,"book");
  if get(&item,"kind")==s("book")&&gb(&book,"shelfPosition"){put_property(&placements,&get(&item,"key"),&get(&book,"shelfPosition"));}
 }
 let result=ctx.env("layoutShelfDecorations",&[&objects.into(),&spread(&[&cfg,&obj(&[("placements",&placements)])])])?;
 let flat=Array::new();for shelf in array_of(&result){for item in array_of(&get(&shelf,"items")){flat.push(&item);}}
 ctx.st_set("placementObjects",&flat.into());
 Ok(result)
}

#[wasm_bindgen]
impl RustShelfCtx{
 #[wasm_bindgen(js_name=measure)]pub fn measure(&self)->f64{measure(&self.ctx)}
 #[wasm_bindgen(js_name=metadataContext)]pub fn metadata_context(&self)->Result<String,JsValue>{metadata_context(&self.ctx)}
 #[wasm_bindgen(js_name=consumeRenderRequests)]pub fn consume_render_requests(&self){consume_render_requests(&self.ctx)}
 #[wasm_bindgen(js_name=scheduleRender)]pub fn schedule_render(&self){schedule_render(&self.ctx)}
 #[wasm_bindgen(js_name=freelyPlacedShelves)]pub fn freely_placed_shelves(&self,shelves:JsValue)->Result<JsValue,JsValue>{freely_placed_shelves(&self.ctx,&shelves)}
}

/// Adopt a metadata-only refresh without repainting the room or changing its hit targets.
pub fn adopt_metadata_records(ctx:&Rc<Ctx>,next_books:&JsValue)->R<bool>{
 if ctx.option("adoptMetadata")!=JsValue::TRUE||truthy(&ctx.option("texts"))||ctx.opts_get("sections")!=JsValue::FALSE
  ||ctx.opts_get("sort")!=s("none")||!ctx.st_true("useScene")||!ctx.st_true("shelfScene")||!ctx.st_true("presentationActive")
  ||["destroyed","busy","session","pendingSelection","returnMotion","dragSession","compatibilityTapTimer","reorderTimer","trashRemoval","arranging"].iter().any(|key|ctx.st_true(key))
  ||ctx.st("returningBookId")!=null()||ctx.st("pressedBookId")!=null()||map_size(&ctx.st("pendingRemovals"))!=0.0
  ||["queuedBooks","frame","renderQueued","appearanceRefreshPending"].iter().any(|key|ctx.st_true(key))
  ||!ctx.st_true("appearancesReady")||map_size(&ctx.st("appearanceTasks"))!=0.0
  ||ctx.st("metadataContext")!=s(&metadata_context(ctx)?)||measure(ctx)!=num(&ctx.st("shelfWidth"))
  ||!truthy(&ctx.env("canAdoptShelfMetadata",&[&ctx.st("books"),next_books])?){return Ok(false);}
 let books=ctx.st("books");let items=ctx.st("itemsById");
 if map_size(&items)!=gn(&books,"length"){return Ok(false);}
 for book in array_of(&books){
  if get(&map_get(&items,&string_value(&get(&book,"id"))),"book")!=book
   ||ctx.geometry_state(&book)?!=s("ready"){return Ok(false);}
 }
 for book in array_of(next_books){
  if ctx.geometry_state(&book)?!=s("ready")||!map_has(&items,&string_value(&get(&book,"id"))){return Ok(false);}
 }
 let by_id=new_map()?;
 for book in array_of(next_books){map_set(&by_id,&string_value(&get(&book,"id")),&book);}
 for item in array_of(&ctx.st("placementObjects")){
  if get(&item,"kind")==s("book")&&!map_has(&by_id,&string_value(&get(&get(&item,"book"),"id"))){return Ok(false);}
 }
 let adopted=method_opt(&ctx.scene(),"adoptMetadataRecords",&[&ctx.st("books"),next_books])?.unwrap_or(undef());
 if !truthy(&adopted){return Ok(false);}
 objects::clear_placement_preview(ctx,&undef())?;
 ctx.st_set("books",&method(next_books,"slice",&[])?);
 for book in array_of(next_books){put(&map_get(&items,&string_value(&get(&book,"id"))),"book",&book);}
 for item in array_of(&ctx.st("placementObjects")){
  if get(&item,"kind")==s("book"){
   let book=map_get(&by_id,&string_value(&get(&get(&item,"book"),"id")));put(&item,"book",&book);
  }
 }
 let last=ctx.st("lastOpened");
 if truthy(&last){
  if let Some(latest)=array_of(next_books).into_iter().find(|book|get(book,"id")==get(&get(&last,"book"),"id")){put(&last,"book",&latest);}
 }
 Ok(true)
}

fn filtered_books(ctx:&Ctx,books:&JsValue)->JsValue{
 let filtered=Array::new();
 for book in array_of(books){
  if !map_has(&ctx.st("pendingRemovals"),&string_value(&get(&book,"id"))){filtered.push(&book);}
 }
 filtered.into()
}

/// `refresh(nextBooks, { defer })`, keeping the synchronous prefix and scroll restoration.
pub fn refresh(ctx:&Rc<Ctx>,next_books:&JsValue,defer:bool)->R{
 if ctx.st_true("destroyed"){return Ok(());}
 if defer||["returnMotion","reorderTimer","busy","session","dragSession","compatibilityTapTimer"].iter().any(|key|ctx.st_true(key)){
  if Array::is_array(next_books){ctx.st_set("queuedBooks",&filtered_books(ctx,next_books));}
  if defer{schedule_render(ctx);}
  return Ok(());
 }
 if adopt_metadata_records(ctx,next_books)?{return Ok(());}
 ctx.st_set("queuedBooks",&null());
 let top=get(&ctx.scroller,"scrollTop");
 if Array::is_array(next_books){ctx.st_set("books",&filtered_books(ctx,next_books));}
 if !ctx.st_true("appearancesReady")&&truthy(&ctx.option("waitForCoverAppearance")){
  ctx.st_set("appearanceGeneration",&f(num(&ctx.st("appearanceGeneration"))+1.0));
  ctx.st_set("appearancesReady",&JsValue::TRUE);
  ctx.legacy("prepareInitialAppearances",&[])?;
 }
 ctx.st_set("shelfWidth",&f(0.0));
 super::returning::settle_return_slot(ctx,true)?;
 ctx.legacy("render",&[])?;
 put(&ctx.scroller,"scrollTop",&top);
 Ok(())
}

#[wasm_bindgen]
impl RustShelfCtx{
 #[wasm_bindgen(js_name=refresh)]pub fn refresh(&self,books:JsValue,defer:JsValue)->Result<(),JsValue>{refresh(&self.ctx,&books,truthy(&defer))}
}

/// Measure the semantic shelf and construct the scene's entries before the shared renderer replaces it.
pub fn read_shelf_layout(ctx:&Ctx,stage:&JsValue,width:f64)->R<JsValue>{
 let origin=rect(stage)?;let entries=Array::new();let rows=Array::new();
 for shelf in qsa(stage,".ihr-shelf"){
  style_prop(&shelf,"contentVisibility","visible");
  let row=rect(&qs(&shelf,".ihr-shelf__row"))?;let index=rows.length();
  let ceiling=if index>0{gn(&rows.get(index-1),"bottom")+15.0}else{12.0};
  rows.push(&obj(&[("top",&f(gn(&row,"top")-gn(&origin,"top"))),("bottom",&f(gn(&row,"bottom")-gn(&origin,"top"))),("ceiling",&f(ceiling))]));
  for node in qsa(&shelf,".ihr-spine, .ihr-plant, .ihr-lamp"){
   let bounds=rect(&node)?;
   let x=gn(&bounds,"left")+gn(&bounds,"width")/2.0-gn(&origin,"left");
   let y=gn(&bounds,"top")+gn(&bounds,"height")/2.0-gn(&origin,"top");
   if cls_has(&node,"ihr-lamp"){
    let record=array_of(&ctx.st("lamps")).into_iter().find(|record|get(record,"key")==data_get(&node,"objectId"));
    let Some(record)=record else{continue};
    let item=objects::lamp_shelf_object(ctx,&record)?;
    entries.push(&spread(&[&item,&obj(&[("node",&node),("x",&f(x)),("y",&f(if get(&item,"mount")==s("undershelf"){ceiling}else{y})),
     ("shelf",&f(index as f64)),("depthInset",&f(0.0))])]));
    continue;
   }
   if cls_has(&node,"ihr-plant"){
    let record=array_of(&ctx.st("plants")).into_iter().find(|record|get(record,"key")==data_get(&node,"objectId"));
    let depth=match record{Some(record)=>get(&objects::plant_shelf_object(ctx,&record,objects::plant_scale(ctx)?)?,"depth"),None=>f(gn(&bounds,"width")*0.7)};
    entries.push(&obj(&[("kind",&s("plant")),("key",&data_get(&node,"objectId")),("node",&node),("x",&f(x)),("y",&f(y)),
     ("shelf",&f(index as f64)),("depthInset",&f(0.0)),("width",&get(&bounds,"width")),("height",&get(&bounds,"height")),("depth",&depth),
     ("catalogId",&data_get(&node,"catalogId")),("potId",&data_get(&node,"potId")),("potColorId",&data_get(&node,"potColorId")),
     ("seed",&data_get(&node,"plantSeed")),("variant",&data_get(&node,"plantVariant"))]));
    continue;
   }
   let item=map_get(&ctx.st("itemsById"),&data_get(&node,"bookId"));
   if !truthy(&item){continue;}
   let style=get(&item,"style");let book=get(&item,"book");
   let height=if inner_width()>=600.0{200.0}else{172.0}*gn(&style,"heightRatio");
   entries.push(&obj(&[("node",&node),("book",&book),("style",&style),("x",&f(x)),("y",&f(y)),("height",&f(height)),
    ("shelf",&f(index as f64)),("depthInset",&f(0.0)),("width",&f(height*num(&super::covers::cover_ratio_for(ctx,&style,&undef())?))),
    ("thickness",&get(&style,"width")),("coverUrl",&super::covers::resolve_cover_immediately(ctx,&book)?)]));
  }
 }
 let layout=obj(&[("stage",stage),("scroller",&ctx.scroller),("entries",&entries.into()),("rows",&rows.into()),("width",&f(width)),
  ("sceneWidth",&f(width)),("trashNode",&get(&ctx.parts,"trashNode")),("catalogNode",&get(&ctx.parts,"catalogNode")),
  ("shelfType",&ctx.st("shelfType")),("height",&get(&rect(stage)?,"height")),("mode",&ctx.st("viewMode"))]);
 ctx.env("placeRooftopPlants",&[&ctx.env("shelfModelLayout",&[&layout,&ctx.st("shelfType")])?])
}

#[wasm_bindgen]
impl RustShelfCtx{
 #[wasm_bindgen(js_name=readShelfLayout)]pub fn read_shelf_layout(&self,stage:JsValue,width:f64)->Result<JsValue,JsValue>{read_shelf_layout(&self.ctx,&stage,width)}
}

/// Enough appearance information for the first stable shelf frame; full font matching follows it.
pub fn prepare_initial_appearances(ctx:&Rc<Ctx>)->R{
 if !truthy(&ctx.option("waitForCoverAppearance"))||gn(&ctx.st("books"),"length")==0.0{return Ok(());}
 let pending=Array::new();
 for book in array_of(&ctx.st("books")){
  let id=super::covers::book_id(&book);let key=super::covers::cover_key_for(&book);
  let saved=if gb(&book,"coverAppearance")&&get(&book,"coverAppearanceKey")==key{get(&book,"coverAppearance")}else{null()};
  if truthy(&saved){map_set(&ctx.st("coverAppearances"),&id,&obj(&[("key",&key),("appearance",&saved),("complete",&JsValue::TRUE)]));continue;}
  let mut cover=get(&book,"cover");
  if nullish(&cover){cover=get(&book,"coverBlob");}
  if nullish(&cover){cover=get(&book,"coverUrl");}
  if truthy(&cover){pending.push(&book);}
 }
 if pending.length()==0{return Ok(());}
 ctx.st_set("appearancesReady",&JsValue::FALSE);
 let generation=num(&ctx.st("appearanceGeneration"))+1.0;ctx.st_set("appearanceGeneration",&f(generation));
 let jobs=Array::new();
 for book in pending.iter(){
  let task_ctx=ctx.clone();
  jobs.push(&run(async move{
   let id=super::covers::book_id(&book);let key=super::covers::cover_key_for(&book);
   let url=settle(super::covers::resolve_cover_promise(&task_ctx,&book)).await?;
   if !truthy(&url){
    map_set(&task_ctx.st("coverAppearances"),&id,&obj(&[("key",&key),("appearance",&null()),("complete",&JsValue::TRUE)]));
    return Ok(undef());
   }
   let appearance=settle(task_ctx.env("analyzeCoverAppearance",&[&url,&coalesce(get(&book,"title"),s("")),&obj(&[("matchFont",&JsValue::FALSE)])])?).await?;
   if !task_ctx.st_true("destroyed"){
    map_set(&task_ctx.st("coverAppearances"),&id,&obj(&[("key",&key),("appearance",&appearance),("complete",&b(nullish(&appearance)))]));
   }
   Ok(undef())
  }));
 }
 let all=method(&get(&global(),"Promise"),"allSettled",&[&jobs.into()])?;
 let done_ctx=ctx.clone();
 then_map(&all,move|_|{
  if done_ctx.st_true("destroyed")||generation!=num(&done_ctx.st("appearanceGeneration")){return Ok(undef());}
  done_ctx.st_set("appearancesReady",&JsValue::TRUE);schedule_render(&done_ctx);Ok(undef())
 },Err)?;
 Ok(())
}

#[wasm_bindgen]
impl RustShelfCtx{
 #[wasm_bindgen(js_name=prepareInitialAppearances)]pub fn prepare_initial_appearances(&self)->Result<(),JsValue>{prepare_initial_appearances(&self.ctx)}
}
