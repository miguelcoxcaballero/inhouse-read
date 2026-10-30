//! The shelf scene's cold DOM and record recipes, run once per node, record update or layout and
//! never per frame: the bin's and the booklet's original node state and its restoration, the
//! semantic buttons' restoration, the plant foliage's native hit target, the scene's canvases,
//! and the material and model keys that decide when a book, plant or lamp is rebuilt. Every
//! property is read and written in the order the former JavaScript did, through the same DOM
//! calls; `JSON.stringify` is the engine's own, so the keys are the same strings.
use std::cell::Cell;
use wasm_bindgen::{prelude::*,JsCast};
use js_sys::{Array,Map,Object,Reflect,JSON};
use crate::host::{absent,get_at,global,jmin,method,method_opt,num,read,set,text_value,truthy};
type R<T=()> = Result<T,JsValue>;

fn st(text:&str)->JsValue{JsValue::from_str(text)}
fn attribute(node:&JsValue,name:&str)->R<JsValue>{method(node,"getAttribute",&[&st(name)])}
fn forget(target:&JsValue,keys:&[&str])->R{
 let dataset=read(target,"dataset")?;
 for key in keys{Reflect::delete_property(dataset.unchecked_ref::<Object>(),&st(key))?;}
 Ok(())
}
fn stringify(value:&JsValue)->R<JsValue>{Ok(JSON::stringify(value)?.into())}
fn list(target:&JsValue,keys:&[&str])->R<JsValue>{
 let values=Array::new();
 for key in keys{values.push(&read(target,key)?);}
 stringify(&values)
}
fn style_all(target:&JsValue,pairs:&[(&str,&str)])->R{
 let style=read(target,"style")?;
 for (key,value) in pairs{set(&style,key,&st(value))?;}
 Ok(())
}

const TRASH_DATA:[&str;17]=["trash3d","trashHover","hover","trashDropProgress","dropProgress","trashVisible","trashViewHidden",
 "trashLocalPosition","trashLocalScale","trashLocalRotation","trashFootY","cabinetFloorY","trashCameraInFrame",
 "trashFootWorld","floorContactWorld","trashRadius","trashHeight"];
const CATALOG_DATA:[&str;3]=["catalog3d","catalogVisible","catalogViewHidden"];
const PLANT_DATA:[&str;4]=["plantModelCatalogId","plantModelDepth","plantLeafTexture","plantLeafOpacity"];
const BUTTON_DATA:[&str;3]=["sceneProjected","sceneHitSurface","sceneLean"];

/// What the bin's (`trash`) or the booklet's node looked like before the scene styled it.
#[wasm_bindgen]
pub fn scene_remember_node(node:&JsValue,trash:bool)->R<JsValue>{
 let state:JsValue=Object::new().into();
 set(&state,"style",&attribute(node,"style")?)?;
 set(&state,"hidden",&read(node,"hidden")?)?;
 set(&state,"tabIndex",&attribute(node,"tabindex")?)?;
 set(&state,"ariaHidden",&attribute(node,"aria-hidden")?)?;
 if trash{
  let inert=truthy(&read(node,"inert")?)||truthy(&method(node,"hasAttribute",&[&st("inert")])?);
  set(&state,"inert",&JsValue::from_bool(inert))?;
 }
 Ok(state)
}

/// Puts back what `scene_remember_node` saw and drops the scene's diagnostics from the node.
#[wasm_bindgen]
pub fn scene_restore_node(node:&JsValue,original:&JsValue,trash:bool)->R{
 for (name,key) in [("style","style"),("tabindex","tabIndex"),("aria-hidden","ariaHidden")]{
  let value=read(original,key)?;
  if value.is_null(){method(node,"removeAttribute",&[&st(name)])?;}else{method(node,"setAttribute",&[&st(name),&value])?;}
 }
 set(node,"hidden",&read(original,"hidden")?)?;
 if trash{set(node,"inert",&read(original,"inert")?)?;}
 forget(node,if trash{&TRASH_DATA[..]}else{&CATALOG_DATA[..]})
}

/// A plant button's model diagnostics are removed (`node` may be absent).
#[wasm_bindgen]
pub fn scene_clear_plant_diagnostics(node:&JsValue)->R{if truthy(node){forget(node,&PLANT_DATA)?;}Ok(())}

/// Every projected button gets its original inline style back and loses the scene's data; with
/// `covers` (a layout replacing its DOM) each button's exposed-cover target goes with it.
#[wasm_bindgen]
pub fn scene_restore_buttons(original_styles:&Map,covers:&JsValue)->R{
 for item in original_styles.entries(){
  let pair:Array=item?.unchecked_into();
  let (node,style)=(pair.get(0),pair.get(1));
  if style.is_null(){method(&node,"removeAttribute",&[&st("style")])?;}else{method(&node,"setAttribute",&[&st("style"),&style])?;}
  forget(&node,&BUTTON_DATA)?;
  if let Some(covers)=covers.dyn_ref::<Map>(){
   method_opt(&covers.get(&node),"remove",&[])?;covers.delete(&node);
  }
  scene_clear_plant_diagnostics(&node)?;
 }
 Ok(())
}

thread_local!{static FOLIAGE_SERIAL:Cell<u32>=const{Cell::new(0)};}
/// A plant's native foliage target: an SVG whose path keeps only the painted leaves (its clip
/// path excludes the books' rectangles), appended to the plant's button. `[svg, path, exclusions]`.
#[wasm_bindgen]
pub fn scene_foliage_target(node:&JsValue,entry:&JsValue)->R<Array>{
 let document=read(&global(),"document")?;
 let make=|tag:&str|method(&document,"createElementNS",&[&st("http://www.w3.org/2000/svg"),&st(tag)]);
 let (svg,definitions,clip,exclusions,path)=(make("svg")?,make("defs")?,make("clipPath")?,make("path")?,make("path")?);
 let id=format!("ihr-foliage-{}",FOLIAGE_SERIAL.with(|serial|{serial.set(serial.get()+1);serial.get()}));
 method(&read(&svg,"classList")?,"add",&[&st("ihr-plant-foliage")])?;method(&svg,"setAttribute",&[&st("aria-hidden"),&st("true")])?;
 method(&svg,"setAttribute",&[&st("focusable"),&st("false")])?;
 let object_id=read(&read(node,"dataset")?,"objectId")?;
 set(&read(&svg,"dataset")?,"plantFoliageKey",&if truthy(&object_id){object_id}else{read(entry,"key")?})?;
 set(&clip,"id",&st(&id))?;method(&clip,"setAttribute",&[&st("clipPathUnits"),&st("userSpaceOnUse")])?;
 method(&exclusions,"setAttribute",&[&st("clip-rule"),&st("evenodd")])?;method(&clip,"append",&[&exclusions])?;method(&definitions,"append",&[&clip])?;
 method(&path,"setAttribute",&[&st("clip-path"),&st(&format!("url(#{id})"))])?;method(&path,"setAttribute",&[&st("fill"),&st("transparent")])?;
 style_all(&svg,&[("position","absolute"),("pointerEvents","none"),("touchAction","none"),("overflow","visible"),("maxWidth","none"),("maxHeight","none")])?;
 set(&read(&path,"style")?,"touchAction",&st("none"))?;method(&svg,"append",&[&definitions,&path])?;method(node,"append",&[&svg])?;
 Ok(Array::of3(&svg,&path,&exclusions))
}

/// One of the scene's own canvases with its 2D context: 0 the room (sticky, behind the
/// buttons), 1 the inspection snapshot and 2 its fitted overview (both absolute and hidden,
/// transformed by the compositor). `[canvas, context]`; a null context is the caller's to judge.
#[wasm_bindgen]
pub fn scene_canvas(kind:u32)->R<Array>{
 let canvas=method(&read(&global(),"document")?,"createElement",&[&st("canvas")])?;
 let context=method(&canvas,"getContext",&[&st("2d")])?;
 set(&canvas,"className",&st(match kind{0=>"ihr-bookshelf-scene",1=>"ihr-bookshelf-inspection-snapshot",_=>"ihr-bookshelf-inspection-overview"}))?;
 method(&canvas,"setAttribute",&[&st("aria-hidden"),&st("true")])?;
 if kind==0{style_all(&canvas,&[("position","sticky"),("top","0"),("left","0"),("display","block"),("pointerEvents","none"),("zIndex","0")])?;}
 else{style_all(&canvas,&[("position","absolute"),("left","0"),("top","0"),("display","none"),("pointerEvents","none"),
  ("zIndex",if kind==1{"1"}else{"0"}),("transformOrigin","0 0"),("willChange","transform")])?;}
 Ok(Array::of2(&canvas,&context))
}

/// The keys a book's materials are compared by: spine, cover, finishes, relief and ribbon
/// (`bookmark_for` is the layout's own `bookmarkFor`).
#[wasm_bindgen]
pub fn scene_material_keys(entry:&JsValue,bookmark_for:&js_sys::Function)->R<JsValue>{
 let (book,style,cover_url)=(read(entry,"book")?,read(entry,"style")?,read(entry,"coverUrl")?);
 let spine=Array::of1(&style);
 for key in ["spineTitleOverride","title","author","spineFontSize","spineAuthorFontSize","spineFinish","spineSurfaceFinish","spineTextFinish","spineTextColor","spineEngraved"]{
  spine.push(&read(&book,key)?);
 }
 let spine=stringify(&spine)?;
 let cover=Array::of3(&cover_url,&read(&style,"coverRatio")?,&read(&style,"color")?);
 if truthy(&cover_url){cover.push(&JsValue::FALSE);}
 else{
  let lettering=Array::new();
  for key in ["spineTitleOverride","title","author","format"]{lettering.push(&read(&book,key)?);}
  lettering.push(&read(&style,"fontFamily")?);cover.push(&lettering);
 }
 let keys:JsValue=Object::new().into();
 set(&keys,"spine",&spine)?;set(&keys,"cover",&stringify(&cover)?)?;
 set(&keys,"coverFinish",&read(&book,"coverFinish")?)?;
 let relief=read(&book,"coverRelief")?;
 let relief=if absent(&relief){JsValue::NULL}else{relief};
 set(&keys,"coverRelief",&stringify(&relief)?)?;
 set(&keys,"edgeFinish",&read(&book,"pageEdgeFinish")?)?;
 set(&keys,"bookmark",&stringify(&bookmark_for.call1(&JsValue::UNDEFINED,&book)?)?)?;
 Ok(keys)
}

/// A plant's model key (`0`), its shape without the pot colour (`1`) or a lamp's (`2`).
#[wasm_bindgen]
pub fn scene_model_key(entry:&JsValue,kind:u32)->R<JsValue>{
 list(entry,match kind{
  0=>&["width","height","variant","catalogId","potId","potColorId","seed"][..],
  1=>&["width","height","variant","catalogId","potId","seed"][..],
  _=>&["lampId","width","height","depth","mount"][..]})
}

/// What a quality replacement is built for: its geometry key and its material keys.
#[wasm_bindgen]
pub fn scene_replacement_target(entry:&JsValue,bookmark_for:&js_sys::Function)->R<JsValue>{
 let kind=read(entry,"kind")?;
 let geometry=Array::of1(&if truthy(&kind){kind}else{st("book")});
 for key in ["width","height","thickness"]{geometry.push(&read(entry,key)?);}
 geometry.push(&JsValue::from_bool(truthy(&read(entry,"overview")?)));
 let resolution=read(entry,"inspectionResolution")?;
 geometry.push(&if truthy(&resolution){resolution}else{JsValue::from(0)});
 let target:JsValue=Object::new().into();
 set(&target,"geometry",&stringify(&geometry)?)?;set(&target,"materials",&scene_material_keys(entry,bookmark_for)?)?;
 Ok(target)
}

/// Whether a pending book replacement can stay for `target`: same geometry, and at most its
/// ribbon changed, which the replacement updates in place. On success it adopts the target.
#[wasm_bindgen]
pub fn scene_retain_replacement(entry:&JsValue,target:&JsValue)->R<bool>{
 let replacement=read(entry,"replacement")?;
 let previous=if absent(&replacement){JsValue::UNDEFINED}else{read(&read(&replacement,"userData")?,"shelfReplacementTarget")?};
 let kind=read(entry,"kind")?;
 if kind==st("plant")||kind==st("lamp")||!truthy(&replacement)||truthy(&read(entry,"qualityReplacement")?)||
  !truthy(&previous)||read(&previous,"geometry")?!=read(target,"geometry")?{return Ok(false);}
 let (materials,before)=(read(target,"materials")?,read(&previous,"materials")?);
 let mut changed=Vec::new();
 for key in Object::keys(materials.unchecked_ref::<Object>()).iter(){
  let name=key.as_string().unwrap_or_default();
  if read(&before,&name)?!=read(&materials,&name)?{changed.push(name);}
 }
 let data=read(&replacement,"userData")?;
 if changed.iter().any(|key|key!="bookmark")||!changed.is_empty()&&!truthy(&read(&data,"updateBookmark")?){return Ok(false);}
 if !changed.is_empty(){method(&data,"updateBookmark",&[&read(entry,"book")?])?;}
 set(&data,"shelfReplacementTarget",target)?;set(&data,"shelfKeys",&materials)?;
 Ok(true)
}

/// A shown book's materials follow its record: each changed key updates its part in place; a
/// changed ribbon without an in-place update asks `replace` for a new model instead.
#[wasm_bindgen]
pub fn scene_update_materials(entry:&JsValue,bookmark_for:&js_sys::Function,replace:&js_sys::Function)->R{
 let model=read(entry,"model")?;
 let kind=read(entry,"kind")?;
 if !truthy(&model)||kind==st("plant")||kind==st("lamp"){return Ok(());}
 let data=read(&model,"userData")?;
 let saved=read(&data,"shelfKeys")?;
 let previous=if truthy(&saved){saved}else{Object::new().into()};
 let next=scene_material_keys(entry,bookmark_for)?;
 let differs=|key:&str|->R<bool>{Ok(read(&previous,key)?!=read(&next,key)?)};
 if differs("spine")?{method_opt(&data,"updateSpineAppearance",&[&read(entry,"book")?,&read(entry,"style")?])?;}
 if differs("cover")?{method_opt(&data,"updateCoverSource",&[&read(entry,"coverUrl")?,&read(entry,"book")?,&read(entry,"style")?])?;}
 if differs("coverFinish")?||differs("coverRelief")?{method_opt(&data,"updateCoverAppearance",&[&read(entry,"book")?])?;}
 if differs("edgeFinish")?{method_opt(&data,"updateEdgeAppearance",&[&read(entry,"book")?])?;}
 if differs("bookmark")?{
  if truthy(&read(&data,"updateBookmark")?){method(&data,"updateBookmark",&[&read(entry,"book")?])?;}
  else{replace.call1(&JsValue::UNDEFINED,entry)?;return Ok(());}
 }
 set(&data,"shelfKeys",&next)
}

/// Three's `Object3D#traverse` order: the object, then each child's subtree.
fn traverse(object:&JsValue,visit:&mut dyn FnMut(&JsValue)->R)->R{
 visit(object)?;
 let children=read(object,"children")?;
 let count=num(&read(&children,"length")?) as u32;
 for index in 0..count{traverse(&get_at(&children,index),visit)?;}
 Ok(())
}
/// `[].concat(object.material || [])`: a material list or a single material.
fn materials(object:&JsValue)->R<Vec<JsValue>>{
 let material=read(object,"material")?;
 Ok(if Array::is_array(&material){material.unchecked_into::<Array>().iter().collect()}else if truthy(&material){vec![material]}else{Vec::new()})
}

/// A new model's finishing touches: every map filters at the renderer's anisotropy (at most 16),
/// the model knows its entry, and every mesh receives shadows and, outside a lamp, casts them.
#[wasm_bindgen]
pub fn scene_prepare_model(model:&JsValue,entry:&JsValue,capabilities:&JsValue)->R{
 traverse(model,&mut |object|{
  for material in materials(object)?{
   for key in ["map","normalMap","bumpMap","roughnessMap"]{
    let map=read(&material,key)?;
    if truthy(&map){set(&map,"anisotropy",&JsValue::from_f64(jmin(16.0,num(&method(capabilities,"getMaxAnisotropy",&[])?))))?;}
   }
  }
  Ok(())
 })?;
 set(&read(model,"userData")?,"entry",entry)?;
 let lamp=read(entry,"kind")?==st("lamp");
 traverse(model,&mut |object|{
  if truthy(&read(object,"isMesh")?){
   if !lamp{set(object,"castShadow",&JsValue::TRUE)?;}
   set(object,"receiveShadow",&JsValue::TRUE)?;
  }
  Ok(())
 })
}

/// Releases every geometry and, once each, every material under `object`.
#[wasm_bindgen]
pub fn scene_release_object(object:&JsValue)->R{
 let seen=js_sys::Set::new(&JsValue::UNDEFINED);
 traverse(object,&mut |child|{
  method_opt(&read(child,"geometry")?,"dispose",&[])?;
  for material in materials(child)?{seen.add(&material);}
  Ok(())
 })?;
 for material in seen.values(){method(&material?,"dispose",&[])?;}
 Ok(())
}

/// Loading a font repaints each book's retained models (its shown model and any pending
/// replacement, once each) without their invalidation callback: the spine, and the generated
/// cover where there is no printed image.
#[wasm_bindgen]
pub fn scene_refresh_fonts(entries:&Array)->R{
 for entry in entries.iter(){
  let kind=read(&entry,"kind")?;
  if kind==st("plant")||kind==st("lamp"){continue;}
  let (model,replacement)=(read(&entry,"model")?,read(&entry,"replacement")?);
  let models=if replacement==model{vec![model]}else{vec![model,replacement]};
  for model in models{
   if !truthy(&model){continue;}
   let data=read(&model,"userData")?;
   let redraw=read(&data,"invalidate")?;
   set(&data,"invalidate",&JsValue::NULL)?;
   let painted=(||->R{
    method_opt(&read(&model,"userData")?,"updateSpineAppearance",&[&read(&entry,"book")?,&read(&entry,"style")?])?;
    if !truthy(&read(&entry,"coverUrl")?){method_opt(&read(&model,"userData")?,"updateCoverSource",&[&JsValue::NULL,&read(&entry,"book")?,&read(&entry,"style")?])?;}
    Ok(())
   })();
   set(&read(&model,"userData")?,"invalidate",&redraw)?;
   painted?;
  }
 }
 Ok(())
}

/// The release movement of a layout change: every entry whose old rectangle (by object id, book
/// id, button's book id or key) lies more than a pixel away from its new target, as
/// `{entry, x, y}`, then the dragged entry among them (`dragged_key`, by object id or key) or null.
#[wasm_bindgen]
pub fn scene_reorder_items(entries:&Array,old_rects:&Map,stage_left:f64,stage_top:f64,dragged_key:&JsValue)->R<Array>{
 let items=Array::new();let mut dragged=JsValue::NULL;
 for entry in entries.iter(){
  let node=read(&entry,"node")?;
  let dataset=if absent(&node){JsValue::UNDEFINED}else{read(&node,"dataset")?};
  let data=|key:&str|->R<JsValue>{Ok(if absent(&dataset){JsValue::UNDEFINED}else{read(&dataset,key)?})};
  let book=read(&entry,"book")?;
  let mut old=old_rects.get(&data("objectId")?);
  if !truthy(&old){old=old_rects.get(&if absent(&book){JsValue::UNDEFINED}else{read(&book,"id")?});}
  if !truthy(&old){old=old_rects.get(&data("bookId")?);}
  if !truthy(&old){old=old_rects.get(&read(&entry,"key")?);}
  let mut target=read(&entry,"tapRect")?;
  if !truthy(&target){target=read(&entry,"hitRect")?;}
  if !truthy(&target){target=read(&entry,"rect")?;}
  if !truthy(&old)||!truthy(&target){continue;}
  let x=num(&read(&old,"left")?)-(num(&read(&target,"left")?)+stage_left);
  let y=num(&read(&old,"top")?)-(num(&read(&target,"top")?)+stage_top);
  if x.abs()+y.abs()>1.0{
   let item:JsValue=Object::new().into();
   set(&item,"entry",&entry)?;set(&item,"x",&JsValue::from_f64(x))?;set(&item,"y",&JsValue::from_f64(y))?;
   items.push(&item);
  }
 }
 if !absent(dragged_key){
  let wanted=text_value(dragged_key);
  for item in items.iter(){
   let entry=read(&item,"entry")?;let node=read(&entry,"node")?;
   let object_id=if absent(&node){JsValue::UNDEFINED}else{read(&read(&node,"dataset")?,"objectId")?};
   if text_value(&if absent(&object_id){read(&entry,"key")?}else{object_id})==wanted{dragged=entry;break;}
  }
 }
 Ok(Array::of2(&items,&dragged))
}
