//! The things on the shelf besides books and the places an object may be put: the lamps and plants (their
//! records, sizes, switches and the way a new one is added), where a dragged object would land, the preview of
//! the whole shelf with it there, and the keyboard rules that move an object. The layout itself, the storage and
//! the 3D scene stay the host's.
use std::rc::Rc;
use wasm_bindgen::prelude::*;
use super::{util::*,ctx::{Ctx,RustShelfCtx},style::spread};

pub const SHELF_PLANTS_KEY:&str="inhouse-read-shelf-plants";
pub const SHELF_LAMPS_KEY:&str="inhouse-read-shelf-lamps";
pub const TAP_SLOP:f64=12.0;
pub const REORDER_HOLD_MS:f64=440.0;
pub const ISOMETRIC:&str="isometric";
const BUSY:&str="Espera a que termine la animación.";

/// `objectKey(node)`.
pub fn object_key(node:&JsValue)->JsValue{
 let id=data_get(node,"objectId");
 if truthy(&id){id}else{join_strings(&[s("book:"),string_value(&data_get(node,"bookId"))])}
}

/// `objectRects()`: the box of every book, plant and lamp, by key.
pub fn object_rects(ctx:&Ctx)->R<JsValue>{
 let map=new_map()?;
 for node in qsa(&ctx.scroller,".ihr-spine, .ihr-plant, .ihr-lamp"){
  let rect=rect(&node)?;
  map_set(&map,&object_key(&node),&rect);
 }
 Ok(map)
}

/// `shelfSpineNodes(section)`.
pub fn shelf_spine_nodes(ctx:&Ctx,section:&JsValue)->Vec<JsValue>{
 qsa(&if truthy(section){section.clone()}else{ctx.scroller.clone()},".ihr-spine")
}

fn store(key:&str,value:&JsValue)->R{local_storage_set(key,&json(value)?)}

/// `savePlants({ strict, initial })`.
pub fn save_plants(ctx:&Ctx,strict:bool,initial:bool)->R{
 let attempt=||->R{
  store(SHELF_PLANTS_KEY,&ctx.st("plants"))?;
  if !initial{ctx.env("notifyCloudSettingsChanged",&[&s(SHELF_PLANTS_KEY)])?;}
  Ok(())
 };
 match attempt(){Err(error) if strict=>Err(error),_=>Ok(())}
}

/// `saveLamps({ strict })`.
pub fn save_lamps(ctx:&Ctx,strict:bool)->R{
 let attempt=||->R{
  store(SHELF_LAMPS_KEY,&ctx.st("lamps"))?;
  ctx.env("notifyCloudSettingsChanged",&[&s(SHELF_LAMPS_KEY)])?;
  Ok(())
 };
 match attempt(){Err(error) if strict=>Err(error),_=>Ok(())}
}

/// `shelfScale({ shelfType, shelfWidth, viewportWidth })`.
fn shelf_scale(ctx:&Ctx)->R<f64>{
 Ok(num(&ctx.env("shelfScale",&[&obj(&[("shelfType",&ctx.st("shelfType")),("shelfWidth",&ctx.st("shelfWidth")),("viewportWidth",&f(inner_width()))])])?))
}

/// `lampShelfObject(record)`.
pub fn lamp_shelf_object(ctx:&Ctx,record:&JsValue)->R<JsValue>{
 let lamp=ctx.env("getCatalogLamp",&[&get(record,"lampId")])?;
 let scale=shelf_scale(ctx)?;
 let out=spread(&[record]);
 put(&out,"kind",&s("lamp"));
 put(&out,"mount",&read(&lamp,"mount")?);
 let dimensions=read(&lamp,"dimensions")?;
 put(&out,"width",&f(num(&read(&dimensions,"width")?)*scale));
 put(&out,"height",&f(num(&read(&dimensions,"height")?)*scale));
 put(&out,"depth",&f(num(&read(&dimensions,"depth")?)*scale));
 Ok(out)
}

/// `plantScale()`.
pub fn plant_scale(ctx:&Ctx)->R<f64>{shelf_scale(ctx)}

/// `plantShelfObject(record, scale)`.
pub fn plant_shelf_object(ctx:&Ctx,record:&JsValue,scale:f64)->R<JsValue>{
 let keyed=spread(&[record,&obj(&[("key",&or(get(record,"key"),s("plant")))])]);
 let size=ctx.env("normalizeShelfPlant",&[&keyed])?;
 let real=ctx.env("plantDimensions",&[&read(&size,"catalogId")?,&read(&size,"potId")?])?;
 let out=spread(&[record]);
 put(&out,"kind",&s("plant"));
 put(&out,"width",&f(num(&read(&size,"width")?)*scale));
 put(&out,"height",&f(num(&read(&size,"height")?)*scale));
 put(&out,"depth",&f(num(&read(&real,"depth")?)*scale));
 Ok(out)
}

/// `updateLampControl(node, record)`.
pub fn update_lamp_control(ctx:&Ctx,node:&JsValue,record:&JsValue)->R{
 let lamp=ctx.env("getCatalogLamp",&[&get(record,"lampId")])?;
 let is_on=get(record,"isOn")!=JsValue::FALSE;
 let name=text(&read(&lamp,"name")?);
 puts(&dataset(node),"lampOn",&is_on.to_string());
 set_attr(node,"aria-pressed",&is_on.to_string());
 set_attr(node,"aria-label",&format!("{} lámpara {name}",if is_on{"Apagar"}else{"Encender"}));
 puts(node,"title",&format!("{name} · {}",if is_on{"Apagar"}else{"Encender"}));
 Ok(())
}

/// A status message in the trash line (`trashStatus`), if the shelf has one.
fn trash_status(ctx:&Ctx)->JsValue{get(&ctx.parts,"trashStatus")}

/// `toggleLamp(node)`.
pub fn toggle_lamp(ctx:&Rc<Ctx>,node:&JsValue)->R{
 if ctx.st_true("destroyed")||ctx.st_true("busy")||ctx.st_true("session")||ctx.st_true("dragSession")||ctx.st_true("returnMotion")||ctx.st_true("arranging"){return Ok(());}
 let key=object_key(node);
 let lamps=array_of(&ctx.st("lamps"));
 let Some(record)=lamps.iter().find(|lamp|get(lamp,"key")==key).cloned() else{return Ok(())};
 let next=spread(&[&record]);
 putb(&next,"isOn",get(&record,"isOn")==JsValue::FALSE);
 let previous=ctx.st("lamps");
 let replaced:Vec<JsValue>=lamps.iter().map(|lamp|if get(lamp,"key")==key{next.clone()}else{lamp.clone()}).collect();
 ctx.st_set("lamps",&arr(&replaced.iter().collect::<Vec<_>>()));
 if save_lamps(ctx,true).is_err(){
  ctx.st_set("lamps",&previous);
  let status=trash_status(ctx);
  if truthy(&status){
   puts(&status,"textContent","No se pudo guardar la lámpara. Reintenta.");
   cls_add(&status,&["is-error"]);
  }
  return Ok(());
 }
 let placed:Vec<JsValue>=array_of(&ctx.st("placementObjects")).into_iter().map(|item|if get(&item,"key")==key{spread(&[&item,&obj(&[("isOn",&get(&next,"isOn"))])])}else{item}).collect();
 ctx.st_set("placementObjects",&arr(&placed.iter().collect::<Vec<_>>()));
 update_lamp_control(ctx,node,&next)?;
 ctx.scene_call("setLampPower",&[node,&get(&next,"isOn"),&obj(&[("animate",&b(!prefers_reduced_motion()))])])?;
 Ok(())
}

/// `globalThis.crypto?.randomUUID?.() || \`${Date.now()}-${Math.random().toString(36).slice(2)}\``.
fn unique_suffix()->R<String>{
 let uuid=method_opt(&get(&global(),"crypto"),"randomUUID",&[])?.unwrap_or(undef());
 if truthy(&uuid){return Ok(text(&uuid));}
 let random=js_sys::Math::random();
 let digits=text(&method(&f(random),"toString",&[&f(36.0)])?);
 Ok(format!("{}-{}",ns(js_sys::Date::now()),digits.chars().skip(2).collect::<String>()))
}

/// The `{ shelf, x }` of every object `layoutShelfDecorations` placed, by key.
fn positions_of(arranged:&JsValue)->R<JsValue>{
 let map=new_map()?;
 for shelf in array_of(arranged){
  for item in array_of(&get(&shelf,"items")){
   map_set(&map,&get(&item,"key"),&obj(&[("shelf",&get(&item,"shelf")),("x",&get(&item,"x"))]));
  }
 }
 Ok(map)
}

/// `[...records].map(item => ({ ...item, ...positions.get(item.key) }))`.
fn with_positions(records:&[JsValue],positions:&JsValue)->JsValue{
 let list:Vec<JsValue>=records.iter().map(|item|spread(&[item,&map_get(positions,&get(item,"key"))])).collect();
 arr(&list.iter().collect::<Vec<_>>())
}

/// A call's `whenClosed` (default: run at once) handed the job to run.
fn when_closed(options:&JsValue,job:impl FnOnce()->R+'static)->R{
 let hook=get(options,"whenClosed");
 let work=once(job);
 if hook.is_undefined(){call(&work,"run",&[])?;}else{call(&hook,"whenClosed",&[&work])?;}
 Ok(())
}

/// `addCatalogLamp({ lampId, kelvin }, { whenClosed })`.
pub async fn add_catalog_lamp(ctx:Rc<Ctx>,request:JsValue,options:JsValue)->R<JsValue>{
 let lamp_id=read(&request,"lampId")?;let kelvin=read(&request,"kelvin")?;
 let options=if options.is_undefined(){obj(&[])}else{options};
 if ctx.st_true("destroyed")||ctx.st_true("busy")||ctx.st_true("session")||ctx.st_true("dragSession")||ctx.st_true("returnMotion"){return Err(error(BUSY));}
 let lamp=ctx.env("getCatalogLamp",&[&lamp_id])?;
 if !truthy(&lamp){return Err(error("Elige una lámpara."));}
 let key=format!("lamp:{}",unique_suffix()?);
 let mut entries:Vec<(&str,JsValue)>=vec![("key",s(&key)),("seed",s(&key)),("lampId",read(&lamp,"id")?),("shelf",f(0.0)),("kelvin",kelvin)];
 if read(&lamp,"mount")?==s("undershelf"){entries.push(("x",f(0.5)));}
 let refs:Vec<(&str,&JsValue)>=entries.iter().map(|(k,v)|(*k,v)).collect();
 let record=ctx.env("normalizeShelfLamp",&[&obj(&refs)])?;
 let previous=ctx.st("lamps");
 let old_rects=object_rects(&ctx)?;
 let mut objects=array_of(&ctx.st("placementObjects"));
 objects.push(lamp_shelf_object(&ctx,&record)?);
 let arranged=ctx.env("layoutShelfDecorations",&[&arr(&objects.iter().collect::<Vec<_>>()),&placement_config(&ctx)?])?;
 let positions=positions_of(&arranged)?;
 let mut all=array_of(&previous);all.push(record);
 ctx.st_set("lamps",&with_positions(&all,&positions));
 if let Err(cause)=save_lamps(&ctx,true){
  ctx.st_set("lamps",&previous);
  return Err(error_with_cause("No se pudo guardar la lámpara. Reintenta.",cause));
 }
 // Saved now; drawn as soon as the catalogue has closed.
 let after_ctx=ctx.clone();
 when_closed(&options,move||{
  if after_ctx.st_true("destroyed"){return Ok(());}
  super::screen_render::render(&after_ctx)?;
  after_ctx.scene_call("animateFromRects",&[&old_rects])?;
  puts(&dataset(&after_ctx.root),"lastAddedLamp",&key);
  Ok(())
 })?;
 Ok(undef())
}

/// `addCatalogPlant({ catalogId, potId, potColorId }, { whenClosed })`.
pub async fn add_catalog_plant(ctx:Rc<Ctx>,request:JsValue,options:JsValue)->R<JsValue>{
 let catalog_id=read(&request,"catalogId")?;let pot_id=read(&request,"potId")?;let pot_color_id=read(&request,"potColorId")?;
 let options=if options.is_undefined(){obj(&[])}else{options};
 if ctx.st_true("destroyed")||ctx.st_true("busy")||ctx.st_true("session")||ctx.st_true("dragSession")||ctx.st_true("returnMotion"){return Err(error(BUSY));}
 let plant=ctx.env("getCatalogPlant",&[&catalog_id])?;
 let pot=ctx.env("getCatalogPot",&[&pot_id])?;
 if !truthy(&plant)||!truthy(&pot){return Err(error("Elige una planta y una maceta."));}
 let key=format!("plant:{}",unique_suffix()?);
 let viewport=rect(&ctx.scroller)?;
 let destination=drop_position_at(&ctx,gn(&viewport,"left")+gn(&viewport,"width")*0.4,gn(&viewport,"top")+min(gn(&viewport,"height")*0.4,260.0),&null())?;
 let pot_color=ctx.env("getPotColor",&[&read(&pot,"id")?,&pot_color_id])?;
 let record=obj(&[("key",&s(&key)),("seed",&s(&key)),("catalogId",&read(&plant,"id")?),("variant",&read(&plant,"variant")?),("potId",&read(&pot,"id")?),
  ("potColorId",&read(&pot_color,"id")?),("shelf",&coalesce(get(&destination,"shelf"),f(0.0)))]);
 let old_rects=object_rects(&ctx)?;let previous=ctx.st("plants");
 let record=ctx.env("normalizeShelfPlant",&[&record])?;
 let mut objects=array_of(&ctx.st("placementObjects"));
 objects.push(plant_shelf_object(&ctx,&record,plant_scale(&ctx)?)?);
 let arranged=ctx.env("layoutShelfDecorations",&[&arr(&objects.iter().collect::<Vec<_>>()),&placement_config(&ctx)?])?;
 let positions=positions_of(&arranged)?;
 let mut all=array_of(&previous);all.push(record);
 ctx.st_set("plants",&with_positions(&all,&positions));
 if let Err(cause)=save_plants(&ctx,true,false){
  ctx.st_set("plants",&previous);
  return Err(error_with_cause("No se pudo guardar la planta. Vuelve a intentarlo.",cause));
 }
 ctx.st_set("plantsInitialized",&JsValue::TRUE);
 let after_ctx=ctx.clone();
 when_closed(&options,move||{
  if after_ctx.st_true("destroyed"){return Ok(());}
  super::screen_render::render(&after_ctx)?;
  after_ctx.scene_call("animateFromRects",&[&old_rects])?;
  puts(&dataset(&after_ctx.root),"lastAddedPlant",&key);
  let added=qsa(&after_ctx.scroller,".ihr-plant").into_iter().find(|node|object_key(node)==s(&key));
  if after_ctx.st_str("viewMode")!=ISOMETRIC{
   if let Some(added)=added{
    method_opt(&added,"scrollIntoView",&[&obj(&[("block",&s("nearest")),("behavior",&s(if prefers_reduced_motion(){"instant"}else{"smooth"}))])])?;
   }
  }
  Ok(())
 })?;
 Ok(undef())
}

/// `shelfPadding()`.
pub fn shelf_padding(ctx:&Ctx)->f64{
 // Both shelves are 600 mm units: the same side clearance, in millimetres.
 let spec=ctx.env_value("BAGGEBO_SPEC");
 max(16.0,(gn(&spec,"postSize")+4.0)*num(&ctx.st("shelfWidth"))/gn(&spec,"width"))
}

/// `placementConfig()`.
pub fn placement_config(ctx:&Ctx)->R<JsValue>{
 let minimum=num(&ctx.opts_get("minimumShelves"));
 let minimum=if minimum.is_nan()||minimum==0.0{3.0}else{minimum};
 Ok(obj(&[("shelfWidth",&ctx.st("shelfWidth")),("padding",&f(shelf_padding(ctx))),("gap",&ctx.opts_get("gap")),("minShelves",&f(max(3.0,minimum)))]))
}

/// `clearPlacementPreview(drag)`.
pub fn clear_placement_preview(ctx:&Ctx,drag:&JsValue)->R{
 let drag=if drag.is_undefined(){ctx.st("dragSession")}else{drag.clone()};
 if absent(&drag){return Ok(());}
 let session=get(&get(&drag,"placementSnapshot"),"session");
 if !absent(&session){
  // The session is owned here and given back with its disposal.
  let owned=ctx.preview.borrow_mut().take_if(|(owner,_)|*owner==drag);
  if let Some((_,preview))=owned{preview.dispose()?;}
 }
 put(&drag,"placementSnapshot",&null());
 Ok(())
}

/// `previewObjectPlacement(drag, key, destination)`: the shelf as it would be with the object there.
pub fn preview_object_placement(ctx:&Ctx,drag:&JsValue,key:&JsValue,destination:&JsValue)->R<JsValue>{
 let cfg=placement_config(ctx)?;
 let objects=ctx.st("placementObjects");
 let core=ctx.env("getRustCore",&[])?;
 if !truthy(&core){return ctx.env("moveShelfDecoration",&[&objects,key,destination,&cfg]);}
 let viewport=visual_viewport();
 let width=coalesce(get(&viewport,"width"),f(inner_width()));
 let height=coalesce(get(&viewport,"height"),f(inner_height()));
 let scale=coalesce(get(&viewport,"scale"),f(1.0));
 let pixel_ratio=or(get(&window(),"devicePixelRatio"),f(1.0));
 let current=get(drag,"placementSnapshot");
 let old_cfg=get(&current,"cfg");
 let stale=!truthy(&current)||get(&current,"objects")!=objects||get(&current,"shelfType")!=ctx.st("shelfType")||get(&current,"viewMode")!=ctx.st("viewMode")
  ||get(&current,"width")!=width||get(&current,"height")!=height||get(&current,"scale")!=scale||get(&current,"pixelRatio")!=pixel_ratio
  ||get(&old_cfg,"shelfWidth")!=get(&cfg,"shelfWidth")||get(&old_cfg,"padding")!=get(&cfg,"padding")||get(&old_cfg,"gap")!=get(&cfg,"gap")
  ||get(&old_cfg,"minShelves")!=get(&cfg,"minShelves");
 let current=if stale{
  clear_placement_preview(ctx,drag)?;
  // The session copies its own immutable records. The application's mutable objects are neither branded
  // nor re-used as trusted inputs.
  let preview=crate::placement_preview::ShelfPlacementPreview::new(objects.clone(),cfg.clone(),ctx.env_value("createShelfPlacementSession"),
   ctx.env_value("moveShelfDecoration"),num(&ctx.env_value("SHELF_PREVIEW_MIN_OBJECTS")),num(&ctx.env_value("SHELF_PREVIEW_DIRECT_MOVES")));
  *ctx.preview.borrow_mut()=Some((drag.clone(),Rc::new(preview)));
  let session=JsValue::TRUE;
  let snapshot=obj(&[("objects",&objects),("cfg",&cfg),("width",&width),("height",&height),("scale",&scale),("pixelRatio",&pixel_ratio),
   ("shelfType",&ctx.st("shelfType")),("viewMode",&ctx.st("viewMode")),("session",&session)]);
  put(drag,"placementSnapshot",&snapshot);
  snapshot
 }else{current};
 let session=get(&current,"session");
 let owned=ctx.preview.borrow().as_ref().filter(|(owner,_)|owner==drag).map(|(_,preview)|preview.clone());
 let moved=match (absent(&session),owned){
  (false,Some(preview))=>preview.move_to(&core,key,&read(destination,"shelf")?,&read(destination,"x")?)?,
  _=>undef(),
 };
 if !nullish(&moved){return Ok(moved);}
 ctx.env("moveShelfDecoration",&[&objects,key,destination,&cfg])
}

/// `dropPositionAt(x, y, node)`: the shelf and the position along it a dropped object would take.
pub fn drop_position_at(ctx:&Ctx,x:f64,y:f64,node:&JsValue)->R<JsValue>{
 let node=if node.is_undefined(){null()}else{node.clone()};
 let scene=ctx.scene();
 if truthy(&scene){return method(&scene,"getDropPosition",&[&f(x),&f(y),&node]);}
 let mut rows:Vec<(usize,JsValue,f64)>=Vec::new();
 for (shelf,row) in qsa(&ctx.scroller,".ihr-shelf__row").into_iter().enumerate(){
  let bounds=rect(&row)?;
  let distance=max(max(gn(&bounds,"top")-y,0.0),y-gn(&bounds,"bottom"));
  rows.push((shelf,bounds,distance));
 }
 rows.sort_by(|a,b|{let d=a.2-b.2;if d<0.0{std::cmp::Ordering::Less}else if d>0.0{std::cmp::Ordering::Greater}else{std::cmp::Ordering::Equal}});
 let Some((shelf,bounds,_))=rows.into_iter().next() else{return Ok(null())};
 let padding=shelf_padding(ctx);
 let along=(x-gn(&bounds,"left")-padding)/(num(&ctx.st("shelfWidth"))-padding*2.0);
 Ok(obj(&[("shelf",&f(shelf as f64)),("x",&f(max(0.0,min(1.0,along))))]))
}

/// `persistObjectPlacement(node, destination, oldRects)`.
pub fn persist_object_placement(ctx:&Rc<Ctx>,node:&JsValue,destination:&JsValue,old_rects:&JsValue)->R{
 let old_rects=if old_rects.is_undefined(){object_rects(ctx)?}else{old_rects.clone()};
 if !truthy(destination)||array_of(&ctx.st("placementObjects")).is_empty(){return Ok(());}
 let result=ctx.env("moveShelfDecoration",&[&ctx.st("placementObjects"),&object_key(node),destination,&placement_config(ctx)?])?;
 let placements=get(&result,"placements");
 let changed=js_sys::Array::new();
 let books:Vec<JsValue>=array_of(&ctx.st("books")).into_iter().map(|book|{
  let position=property(&placements,&join_strings(&[s("book:"),string_value(&get(&book,"id"))]));
  if !truthy(&position){return book;}
  if stringify(&get(&book,"shelfPosition"))!=stringify(&position){changed.push(&obj(&[("id",&get(&book,"id")),("shelfPosition",&position)]));}
  spread(&[&book,&obj(&[("shelfPosition",&position)])])
 }).collect();
 ctx.st_set("books",&arr(&books.iter().collect::<Vec<_>>()));
 let placed=|records:JsValue|->JsValue{
  let list:Vec<JsValue>=array_of(&records).into_iter().map(|record|spread(&[&record,&property(&placements,&get(&record,"key"))])).collect();
  arr(&list.iter().collect::<Vec<_>>())
 };
 ctx.st_set("plants",&placed(ctx.st("plants")));
 ctx.st_set("lamps",&placed(ctx.st("lamps")));
 save_plants(ctx,false,false)?;
 save_lamps(ctx,false)?;
 let plants=obj(&[]);
 for plant in array_of(&ctx.st("plants")){put_property(&plants,&get(&plant,"key"),&obj(&[("shelf",&get(&plant,"shelf")),("x",&get(&plant,"x"))]));}
 let saved=ctx.option_call("onShelfPlacementChange",&[&obj(&[("books",&changed),("plants",&plants)])]);
 let pending=promise_resolve(&saved?);
 then_map(&pending,Ok,|error|{warn("No se pudo guardar la posición en la estantería:",&error);Ok(undef())})?;
 ctx.clear_timeout(&ctx.st("reorderTimer"));
 ctx.st_set("reorderTimer",&f(-1.0));
 super::screen_render::render(&ctx)?;
 ctx.scene_call("animateFromRects",&[&old_rects,&obj(&[("draggedKey",&object_key(node))])])?;
 let timer=ctx.set_timeout(if prefers_reduced_motion(){0.0}else{560.0},|ctx|{
  ctx.st_set("reorderTimer",&f(0.0));
  super::screen_lifecycle::apply_deferred_updates(&ctx)?;
  Ok(())
 });
 ctx.st_set("reorderTimer",&timer);
 Ok(())
}

/// `moveObjectWithKeyboard(event, node)`: Shift with an arrow moves the object a step or a shelf.
pub fn move_object_with_keyboard(ctx:&Rc<Ctx>,event:&JsValue,node:&JsValue)->R{
 let key=text(&get(event,"key"));
 if !gb(event,"shiftKey")||!["ArrowLeft","ArrowRight","ArrowUp","ArrowDown"].contains(&key.as_str()){return Ok(());}
 method(event,"preventDefault",&[])?;
 let wanted=object_key(node);
 let Some(item)=array_of(&ctx.st("placementObjects")).into_iter().find(|item|get(item,"key")==wanted) else{return Ok(())};
 let direction=if key=="ArrowLeft"||key=="ArrowUp"{-1.0}else{1.0};
 let vertical=key=="ArrowUp"||key=="ArrowDown";
 let destination=obj(&[
  ("shelf",&f(max(0.0,gn(&item,"shelf")+if vertical{direction}else{0.0}))),
  ("x",&f(max(0.0,min(1.0,gn(&item,"x")+if vertical{0.0}else{direction*0.08})))),
 ]);
 persist_object_placement(ctx,node,&destination,&undef())?;
 let focus_key=get(&item,"key");
 if let Some(candidate)=qsa(&ctx.scroller,"[data-object-id]").into_iter().find(|candidate|object_key(candidate)==focus_key){
  method_opt(&candidate,"focus",&[&obj(&[("preventScroll",&JsValue::TRUE)])])?;
 }
 Ok(())
}

#[wasm_bindgen]
impl RustShelfCtx{
 #[wasm_bindgen(js_name=objectKey)]
 pub fn object_key(&self,node:JsValue)->JsValue{object_key(&node)}
 #[wasm_bindgen(js_name=clearPlacementPreview)]
 pub fn clear_placement_preview(&self,drag:JsValue)->Result<(),JsValue>{clear_placement_preview(&self.ctx,&drag)}
 #[wasm_bindgen(js_name=toggleLamp)]
 pub fn toggle_lamp(&self,node:JsValue)->Result<(),JsValue>{toggle_lamp(&self.ctx,&node)}
 #[wasm_bindgen(js_name=addCatalogLamp)]
 pub fn add_catalog_lamp(&self,request:JsValue,options:JsValue)->JsValue{let ctx=self.ctx.clone();run(async move{add_catalog_lamp(ctx,request,options).await})}
 #[wasm_bindgen(js_name=addCatalogPlant)]
 pub fn add_catalog_plant(&self,request:JsValue,options:JsValue)->JsValue{let ctx=self.ctx.clone();run(async move{add_catalog_plant(ctx,request,options).await})}
 #[wasm_bindgen(js_name=lampShelfObject)]
 pub fn lamp_shelf_object(&self,record:JsValue)->Result<JsValue,JsValue>{lamp_shelf_object(&self.ctx,&record)}
 #[wasm_bindgen(js_name=plantShelfObject)]
 pub fn plant_shelf_object(&self,record:JsValue,scale:JsValue)->Result<JsValue,JsValue>{
  let scale=if scale.is_undefined(){plant_scale(&self.ctx)?}else{num(&scale)};
  plant_shelf_object(&self.ctx,&record,scale)
 }
 #[wasm_bindgen(js_name=plantScale)]
 pub fn plant_scale(&self)->Result<f64,JsValue>{plant_scale(&self.ctx)}
 #[wasm_bindgen(js_name=updateLampControl)]
 pub fn update_lamp_control(&self,node:JsValue,record:JsValue)->Result<(),JsValue>{update_lamp_control(&self.ctx,&node,&record)}
 #[wasm_bindgen(js_name=placementConfig)]
 pub fn placement_config(&self)->Result<JsValue,JsValue>{placement_config(&self.ctx)}
 #[wasm_bindgen(js_name=shelfPadding)]
 pub fn shelf_padding(&self)->f64{shelf_padding(&self.ctx)}
 #[wasm_bindgen(js_name=dropPositionAt)]
 pub fn drop_position_at(&self,x:f64,y:f64,node:JsValue)->Result<JsValue,JsValue>{drop_position_at(&self.ctx,x,y,&node)}
 #[wasm_bindgen(js_name=persistObjectPlacement)]
 pub fn persist_object_placement(&self,node:JsValue,destination:JsValue,old_rects:JsValue)->Result<(),JsValue>{persist_object_placement(&self.ctx,&node,&destination,&old_rects)}
 #[wasm_bindgen(js_name=moveObjectWithKeyboard)]
 pub fn move_object_with_keyboard(&self,event:JsValue,node:JsValue)->Result<(),JsValue>{move_object_with_keyboard(&self.ctx,&event,&node)}
 #[wasm_bindgen(js_name=savePlants)]
 pub fn save_plants(&self,strict:bool,initial:bool)->Result<(),JsValue>{save_plants(&self.ctx,strict,initial)}
 #[wasm_bindgen(js_name=saveLamps)]
 pub fn save_lamps(&self,strict:bool)->Result<(),JsValue>{save_lamps(&self.ctx,strict)}
 #[wasm_bindgen(js_name=objectRects)]
 pub fn object_rects(&self)->Result<JsValue,JsValue>{object_rects(&self.ctx)}
}
