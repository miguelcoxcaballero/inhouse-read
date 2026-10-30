//! The shelf scene's one-off recipes that run once per event and never per frame or per entry: a
//! cancelled drop into the bin, the bin's footprint and its hidden button, a plant button's model
//! diagnostics, a retained plant's touch surface moving to its new button, a lamp's switch, the
//! shared inspection capture check, the veneer swatch and the wood's theme tints. Every property is
//! read and written in the order the former JavaScript of bookshelf-scene.js did, through the same
//! calls. Scans of every entry, the layout's rebinding loop, record updates and model preparation
//! stay JavaScript: through Reflect calls they measured 9 to 58 times slower (scene-frame-5 DOC).
use wasm_bindgen::{prelude::*,JsCast};
use js_sys::{Function,Object};
use crate::host::{absent,method,num,read,set,truthy};
type R<T=()> = Result<T,JsValue>;

fn st(text:&str)->JsValue{JsValue::from_str(text)}
fn has_class(node:&JsValue,name:&str)->R<bool>{Ok(truthy(&method(&read(node,"classList")?,"contains",&[&st(name)])?))}
fn forget(target:&JsValue,keys:&[&str])->R{
 let dataset=read(target,"dataset")?;
 for key in keys{js_sys::Reflect::delete_property(dataset.unchecked_ref::<Object>(),&st(key))?;}
 Ok(())
}
fn fixed(value:f64,digits:u8)->R<JsValue>{Ok(js_sys::Number::from(value).to_fixed(digits)?.into())}

/// A retained plant's touch surface moves to its replacement button: the projected SVG is cloned
/// (triangles, cache and clip included), the outgoing one removed, and the clone appended to `node`.
/// Returns the foliage record pointing at the clone's path and exclusion path.
#[wasm_bindgen]
pub fn scene_rebind_foliage(native:&JsValue,node:&JsValue)->R<JsValue>{
 let svg=method(&read(native,"svg")?,"cloneNode",&[&JsValue::TRUE])?;
 method(&read(native,"svg")?,"remove",&[])?;
 let rebound:JsValue=Object::assign(&Object::new(),native.unchecked_ref::<Object>()).into();
 set(&rebound,"svg",&svg)?;
 set(&rebound,"path",&method(&svg,"querySelector",&[&st(":scope > path")])?)?;
 set(&rebound,"exclusions",&method(&svg,"querySelector",&[&st("clipPath path")])?)?;
 method(node,"append",&[&svg])?;
 Ok(rebound)
}

/// Puts back what a cancelled drop into the bin took: its promise settles as not dropped, the model
/// (when `restore`) returns to the room at the entry's pose, shown unless its button is away, and
/// the drop's diagnostics leave the bin's node and the canvas. True when the model's visibility changed.
#[wasm_bindgen]
pub fn scene_cancel_trash_drop(entry:&JsValue,restore:bool,furniture:&JsValue,trash_node:&JsValue,canvas:&JsValue)->R<bool>{
 let drop=read(entry,"trashDrop")?;
 set(entry,"trashDrop",&JsValue::NULL)?;
 if !truthy(&read(&drop,"settled")?){set(&drop,"settled",&JsValue::TRUE)?;method(&drop,"resolve",&[&JsValue::FALSE])?;}
 let mut changed=false;
 if truthy(&read(entry,"model")?)&&restore{
  method(furniture,"attach",&[&read(entry,"model")?])?;
  let node=read(entry,"node")?;
  let visible=JsValue::from_bool(!(!absent(&node)&&has_class(&node,"is-away")?));
  let model=read(entry,"model")?;
  if read(&model,"visible")?!=visible{changed=true;}
  set(&model,"visible",&visible)?;
  let pose=read(entry,"pose")?;
  for key in ["position","quaternion","scale"]{method(&read(&read(entry,"model")?,key)?,"copy",&[&read(&pose,key)?])?;}
 }
 if truthy(trash_node){forget(trash_node,&["trashDropProgress","dropProgress"])?;}
 forget(canvas,&["trashDropProgress","trashingBookId","trashingObjectId","trashingObjectKind"])
  .map(|_|changed)
}

/// Leaving the isometric view hides the bin's button from sight, focus and touch.
#[wasm_bindgen]
pub fn scene_hide_trash_node(node:&JsValue)->R{
 set(node,"hidden",&JsValue::TRUE)?;set(node,"inert",&JsValue::TRUE)?;set(node,"tabIndex",&JsValue::from_f64(-1.0))?;
 method(node,"setAttribute",&[&st("aria-hidden"),&st("true")])?;
 set(&read(node,"style")?,"pointerEvents",&st("none"))
}

/// A plant button's model diagnostics: its catalogue id, its depth (`depth`, four decimals), how its
/// first leaf is coloured and whether it is cut out. Kept on the model and copied to the button's data.
#[wasm_bindgen]
pub fn scene_plant_diagnostics(model:&JsValue,node:&JsValue,depth:f64)->R{
 let leaf=method(model,"getObjectByName",&[&st("leaf-0")])?;
 let diagnostics:JsValue=Object::new().into();
 set(&diagnostics,"plantModelCatalogId",&read(&read(model,"userData")?,"catalogId")?)?;
 set(&diagnostics,"plantModelDepth",&fixed(depth,4)?)?;
 let texture=if truthy(&leaf){
  let map=read(&read(&leaf,"material")?,"map")?;
  if !absent(&map)&&truthy(&read(&map,"isDataTexture")?){"procedural"}else if truthy(&read(&read(&leaf,"material")?,"map")?){"photo"}else{"none"}
 }else{"vertex-colors"};
 set(&diagnostics,"plantLeafTexture",&st(texture))?;
 let opaque=!truthy(&leaf)||{
  let material=read(&leaf,"material")?;
  read(&material,"alphaTest")?.as_f64()==Some(0.0)&&!truthy(&read(&read(&leaf,"material")?,"alphaToCoverage")?)
 };
 set(&diagnostics,"plantLeafOpacity",&st(if opaque{"opaque"}else{"cutout"}))?;
 set(&read(model,"userData")?,"shelfPlantDiagnostics",&diagnostics)?;
 Object::assign(read(node,"dataset")?.unchecked_ref::<Object>(),read(&read(model,"userData")?,"shelfPlantDiagnostics")?.unchecked_ref::<Object>());
 Ok(())
}

/// A missing veneer file leaves its map a one-pixel swatch of the wood's mean colour instead of an
/// empty (black) unit: zero roughness would turn the cabinet into a mirror.
#[wasm_bindgen]
pub fn scene_veneer_swatch(map:&JsValue,mean:&JsValue)->R{
 let document=read(&crate::host::global(),"document")?;
 let swatch=method(&document,"createElement",&[&st("canvas")])?;
 let context=method(&swatch,"getContext",&[&st("2d")])?;
 set(&swatch,"height",&JsValue::from_f64(1.0))?;set(&swatch,"width",&JsValue::from_f64(1.0))?;
 if truthy(&context){
  set(&context,"fillStyle",mean)?;
  let (zero,one)=(JsValue::from_f64(0.0),JsValue::from_f64(1.0));
  method(&context,"fillRect",&[&zero,&zero,&one,&one])?;
 }
 set(map,"image",&swatch)?;set(map,"needsUpdate",&JsValue::TRUE)
}

/// Theme tints: the canvas is transparent over the page, so the same walnut is graded slightly
/// deeper on the dark page and a little brighter on the light one. Near-neutral: the warmth comes
/// from the key light, not a colour cast. Floor contact reads softer on a pale page.
#[wasm_bindgen]
pub fn scene_wood_theme(dark:bool,wood:&JsValue,back:&JsValue,trim:&JsValue,occlusion:&JsValue,wall:&JsValue)->R{
 let tones=if dark{["#ebe8e5","#d2cec9","#e0dcd7"]}else{["#ffffff","#ebe8e4","#f5f2ee"]};
 for (material,tone) in [wood,back,trim].into_iter().zip(tones){method(&read(material,"color")?,"set",&[&st(tone)])?;}
 set(occlusion,"opacity",&JsValue::from_f64(if dark{1.0}else{0.8}))?;
 method(&read(wall,"color")?,"set",&[&st(if dark{"#353434"}else{"#f0f1ed"})])?;
 Ok(())
}

/// The bin's footprint: its bounds at the origin, unturned and unscaled, through the hinged lid's
/// whole sweep (closed, half and fully open), into `bounds`; `fresh` makes each sweep's box. Its
/// pose and openness are put back afterwards.
#[wasm_bindgen]
pub fn scene_trash_footprint(bin:&JsValue,bounds:&JsValue,fresh:&Function)->R<JsValue>{
 let keys=["position","rotation","scale"];
 let mut saved=Vec::new();
 for key in keys{saved.push(method(&read(bin,key)?,"clone",&[])?);}
 let openness={let value=num(&read(&read(bin,"userData")?,"openness")?);if value.is_nan()||value==0.0{0.0}else{value}};
 let zero=JsValue::from_f64(0.0);
 method(&read(bin,"position")?,"set",&[&zero,&zero,&zero])?;
 method(&read(bin,"rotation")?,"set",&[&zero,&zero,&zero])?;
 method(&read(bin,"scale")?,"setScalar",&[&JsValue::from_f64(1.0)])?;
 let state=|open:f64|->R{
  let state:JsValue=Object::new().into();set(&state,"openness",&JsValue::from_f64(open))?;
  method(&read(bin,"userData")?,"setState",&[&state])?;
  method(bin,"updateMatrixWorld",&[&JsValue::TRUE])?;Ok(())
 };
 for open in [0.0,0.5,1.0]{
  state(open)?;
  let sweep=method(&fresh.call0(&JsValue::UNDEFINED)?,"setFromObject",&[bin])?;
  method(bounds,"union",&[&sweep])?;
 }
 for (key,value) in keys.into_iter().zip(saved){method(&read(bin,key)?,"copy",&[&value])?;}
 state(openness)?;
 Ok(bounds.clone())
}

/// A lamp's switch: its power eases from the one it shows (its fade, its light, else its last
/// state) to on or off, over 220 ms when `animate`, starting now.
#[wasm_bindgen]
pub fn scene_lamp_switch(entry:&JsValue,is_on:&JsValue,animate:bool)->R{
 let power=read(entry,"lampPower")?;
 let mut previous=if absent(&power){JsValue::UNDEFINED}else{read(&power,"value")?};
 if absent(&previous){
  let model=read(entry,"model")?;
  if !absent(&model){
   let emitter=read(&read(&model,"userData")?,"lightEmitter")?;
   if !absent(&emitter){previous=read(&emitter,"power")?;}
  }
 }
 if absent(&previous){previous=JsValue::from_f64(if read(entry,"isOn")?==JsValue::FALSE{0.0}else{1.0});}
 set(entry,"isOn",&JsValue::from_bool(*is_on!=JsValue::FALSE))?;
 let fade:JsValue=Object::new().into();
 set(&fade,"value",&previous)?;set(&fade,"from",&previous)?;
 set(&fade,"target",&JsValue::from_f64(if truthy(&read(entry,"isOn")?){1.0}else{0.0}))?;
 set(&fade,"started",&JsValue::from_f64(crate::host::clock()?))?;
 set(&fade,"duration",&JsValue::from_f64(if animate{220.0}else{0.0}))?;
 set(entry,"lampPower",&fade)
}

/// Whether the other inspection export of this same synchronous batch (`captured`) already holds the
/// pixels of `frame`, so `raw` can copy its canvas instead of reading the GPU again: the same frame,
/// context, revision and materialized size, from the other tile.
#[wasm_bindgen]
pub fn scene_shared_capture(captured:&JsValue,overview:bool,frame:&JsValue,raw:&JsValue,source_frame:&JsValue,source_context:&JsValue,
 source_revision:&JsValue,source_materialized:&JsValue)->R<bool>{
 if !truthy(captured)||read(captured,"overview")?==JsValue::from_bool(overview)||read(captured,"frame")?!=*frame||*source_frame!=*frame||
  read(captured,"context")?!=*source_context||*source_context==*raw||read(captured,"revision")?!=*source_revision||
  *source_materialized!=*source_revision{return Ok(false);}
 let size=|key:&str|->R<JsValue>{Ok(JsValue::from_f64((num(&read(frame,key)?)*num(&read(frame,"ratio")?)).ceil()))};
 let (width,height)=(read(captured,"width")?,read(captured,"height")?);
 if width!=size("width")?||height!=size("height")?{return Ok(false);}
 for context in [raw,source_context]{
  let canvas=read(context,"canvas")?;
  if read(&canvas,"width")?!=width||read(&canvas,"height")?!=height{return Ok(false);}
 }
 Ok(true)
}
