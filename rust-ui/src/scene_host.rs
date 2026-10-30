//! More of the shelf scene's cold recipes, run on a layout, a gesture's start, a cancelled drop, a
//! new model or a theme change, never per frame: the scans of every entry that decide whether the
//! room is at rest, an entry's identity key, the cabinet's local bounds, the bin's footprint and
//! what a cancelled drop puts back. Every property is read and written in the order the former
//! JavaScript of bookshelf-scene.js did, through the same calls; the numbers follow three.js's own
//! operation order, so the bounds are the same doubles.
use wasm_bindgen::{prelude::*,JsCast};
use js_sys::{Array,Float64Array,Function,JsString,Map,Object,JSON};
use crate::host::{absent,get_at,jmax,jmin,method,num,read,set,text_value,truthy};
type R<T=()> = Result<T,JsValue>;

fn st(text:&str)->JsValue{JsValue::from_str(text)}
fn has_class(node:&JsValue,name:&str)->R<bool>{Ok(truthy(&method(&read(node,"classList")?,"contains",&[&st(name)])?))}
fn forget(target:&JsValue,keys:&[&str])->R{
 let dataset=read(target,"dataset")?;
 for key in keys{js_sys::Reflect::delete_property(dataset.unchecked_ref::<Object>(),&st(key))?;}
 Ok(())
}
fn fixed(value:f64,digits:u8)->R<JsValue>{Ok(js_sys::Number::from(value).to_fixed(digits)?.into())}
fn stringify(value:&JsValue)->R<JsValue>{Ok(JSON::stringify(value)?.into())}
/// `${prefix}${value}`, kept in UTF-16.
fn joined(prefix:&str,value:&JsValue)->JsValue{JsString::from(prefix).concat(&text_value(value)).into()}

/// The key an entry is kept by across layouts: `plant:`/`lamp:` and its object id (else its key, else
/// its index), or `book:` and its id (else its button's book id, its path, its title, its index).
#[wasm_bindgen]
pub fn scene_entry_key(entry:&JsValue,index:f64)->R<JsValue>{
 let kind=read(entry,"kind")?;
 let node=read(entry,"node")?;
 let data=|key:&str|->R<JsValue>{Ok(if absent(&node){JsValue::UNDEFINED}else{read(&read(&node,"dataset")?,key)?})};
 if kind==st("plant")||kind==st("lamp"){
  let mut id=data("objectId")?;
  if absent(&id){id=read(entry,"key")?;}
  if absent(&id){id=JsValue::from_f64(index);}
  return Ok(joined(if kind==st("plant"){"plant:"}else{"lamp:"},&id));
 }
 let book=read(entry,"book")?;
 let field=|key:&str|->R<JsValue>{Ok(if absent(&book){JsValue::UNDEFINED}else{read(&book,key)?})};
 let mut id=field("id")?;
 if absent(&id){id=data("bookId")?;}
 if absent(&id){id=field("path")?;}
 if absent(&id){id=field("title")?;}
 if absent(&id){id=JsValue::from_f64(index);}
 Ok(joined("book:",&id))
}

/// Whether every entry of the incoming layout keeps its old entry's shelf and, for a book, the
/// same saved shelf position (compared as JSON): a resize that moved nothing physical.
#[wasm_bindgen]
pub fn scene_same_placements(old_entries:&Map,next_entries:&Array)->R<bool>{
 for (index,data) in next_entries.iter().enumerate(){
  let old=old_entries.get(&scene_entry_key(&data,index as f64)?);
  if !truthy(&old){return Ok(false);}
  if read(&old,"shelf")?!=read(&data,"shelf")?{return Ok(false);}
  let book=read(&data,"book")?;
  if !truthy(&book){continue;}
  let old_book=read(&old,"book")?;
  let before=stringify(&if absent(&old_book){JsValue::UNDEFINED}else{read(&old_book,"shelfPosition")?})?;
  if before!=stringify(&read(&book,"shelfPosition")?)?{return Ok(false);}
 }
 Ok(true)
}

/// The painted pose of every entry that has a shared motion key, as the room transition takes it:
/// `[key, x, y, z (metres, x from the room's centre), qx, qy, qz, qw, scale]`.
#[wasm_bindgen]
pub fn scene_painted_poses(entries:&Array,motion_key:&Function,width:f64,pixels_per_metre:f64)->R<Array>{
 let painted=Array::new();
 let mut keyed=Vec::new();
 for entry in entries.iter(){if truthy(&motion_key.call1(&JsValue::UNDEFINED,&entry)?){keyed.push(entry);}}
 for entry in keyed{
  let key=motion_key.call1(&JsValue::UNDEFINED,&entry)?;
  let pose=read(&entry,"pose")?;
  let (p,q)=(read(&pose,"position")?,read(&pose,"quaternion")?);
  let row=Array::of1(&key);
  for value in [(num(&read(&p,"x")?)+width/2.0)/pixels_per_metre,num(&read(&p,"y")?)/pixels_per_metre,num(&read(&p,"z")?)/pixels_per_metre,
   num(&read(&q,"x")?),num(&read(&q,"y")?),num(&read(&q,"z")?),num(&read(&q,"w")?),num(&read(&read(&pose,"scale")?,"x")?)]{
   row.push(&JsValue::from_f64(value));
  }
  painted.push(&row);
 }
 Ok(painted)
}

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

/// A lamp still fading between its target powers at `now`.
fn fading(power:&JsValue,now:f64)->R<bool>{
 Ok(truthy(&read(power,"duration")?)&&read(power,"from")?!=read(power,"target")?&&now<num(&read(power,"started")?)+num(&read(power,"duration")?))
}
fn tint_moving(entry:&JsValue)->R<bool>{
 let tint=read(entry,"lampTint")?;
 Ok(!absent(&tint)&&truthy(&method(&tint,"moving",&[])?))
}

/// Whether a second finger may turn a tentative tap into an inspection: 0 while anything still moves
/// (a return, a drop, a landing, a preview, a held, lifted or dragged button, a lift beyond a press, a
/// lamp's tint or power fade), 1 at rest, 2 at rest under a press's small lift.
#[wasm_bindgen]
pub fn scene_inspection_rest(entries:&Array,now:f64)->R<u32>{
 for entry in entries.iter(){
  if truthy(&read(&entry,"insertion")?)||truthy(&read(&entry,"trashDrop")?)||truthy(&read(&entry,"landing")?)||
   truthy(&read(&read(&entry,"preview")?,"active")?){return Ok(0);}
  let node=read(&entry,"node")?;
  if !absent(&node)&&truthy(&method(&node,"matches",&[&st(".is-pressed, .is-lifted, .is-dragging")])?){return Ok(0);}
  let lift=read(&entry,"lift")?;
  let values=[read(&lift,"value")?,read(&lift,"from")?,read(&lift,"target")?];
  if !values.iter().all(|value|num(value).abs()<=0.220001){return Ok(0);}
  if tint_moving(&entry)?{return Ok(0);}
  let power=read(&entry,"lampPower")?;
  if !absent(&power)&&fading(&power,now)?{return Ok(0);}
 }
 for entry in entries.iter(){
  let lift=read(&entry,"lift")?;
  if truthy(&read(&lift,"value")?)||truthy(&read(&lift,"from")?)||truthy(&read(&lift,"target")?){return Ok(2);}
 }
 Ok(1)
}

/// Whether every entry stands as the already painted room shows it, so a selected book's modal can
/// keep that image: nothing returns, drops, lands, previews, fades or tints, and every other entry's
/// lift is the one its button's classes ask for (1 held or dragged, 0.22 pressed, else 0).
#[wasm_bindgen]
pub fn scene_modal_rest(entries:&Array,selected:&JsValue,now:f64)->R<bool>{
 for entry in entries.iter(){
  if truthy(&read(&entry,"insertion")?)||truthy(&read(&entry,"trashDrop")?)||truthy(&read(&entry,"landing")?)||
   truthy(&read(&read(&entry,"preview")?,"active")?){return Ok(false);}
  if tint_moving(&entry)?{return Ok(false);}
  let power=read(&entry,"lampPower")?;
  if truthy(&power){
   let target=read(&power,"target")?;
   if read(&power,"value")?!=target||read(&power,"from")?!=target&&now<num(&read(&power,"started")?)+num(&read(&power,"duration")?){return Ok(false);}
  }
  if entry!=*selected{
   let node=read(&entry,"node")?;
   let target=if !absent(&node)&&truthy(&method(&node,"matches",&[&st(".is-dragging, .is-lifted")])?){1.0}
    else if !absent(&node)&&has_class(&node,"is-pressed")?&&!has_class(&node,"is-press-pending")?{0.22}else{0.0};
   if read(&read(&entry,"lift")?,"value")?!=JsValue::from_f64(target){return Ok(false);}
  }
 }
 Ok(true)
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

fn elements(matrix:&JsValue)->R<[f64;16]>{
 let mut out=[0.0;16];
 Float64Array::new(&read(matrix,"elements")?).copy_to(&mut out);
 Ok(out)
}
/// `Matrix4#multiplyMatrices(a, b)`, term for term.
fn multiply(a:&[f64;16],b:&[f64;16])->[f64;16]{
 let (a11,a12,a13,a14)=(a[0],a[4],a[8],a[12]);let (a21,a22,a23,a24)=(a[1],a[5],a[9],a[13]);
 let (a31,a32,a33,a34)=(a[2],a[6],a[10],a[14]);let (a41,a42,a43,a44)=(a[3],a[7],a[11],a[15]);
 let (b11,b12,b13,b14)=(b[0],b[4],b[8],b[12]);let (b21,b22,b23,b24)=(b[1],b[5],b[9],b[13]);
 let (b31,b32,b33,b34)=(b[2],b[6],b[10],b[14]);let (b41,b42,b43,b44)=(b[3],b[7],b[11],b[15]);
 let mut t=[0.0;16];
 t[0]=a11*b11+a12*b21+a13*b31+a14*b41;t[4]=a11*b12+a12*b22+a13*b32+a14*b42;
 t[8]=a11*b13+a12*b23+a13*b33+a14*b43;t[12]=a11*b14+a12*b24+a13*b34+a14*b44;
 t[1]=a21*b11+a22*b21+a23*b31+a24*b41;t[5]=a21*b12+a22*b22+a23*b32+a24*b42;
 t[9]=a21*b13+a22*b23+a23*b33+a24*b43;t[13]=a21*b14+a22*b24+a23*b34+a24*b44;
 t[2]=a31*b11+a32*b21+a33*b31+a34*b41;t[6]=a31*b12+a32*b22+a33*b32+a34*b42;
 t[10]=a31*b13+a32*b23+a33*b33+a34*b43;t[14]=a31*b14+a32*b24+a33*b34+a34*b44;
 t[3]=a41*b11+a42*b21+a43*b31+a44*b41;t[7]=a41*b12+a42*b22+a43*b32+a44*b42;
 t[11]=a41*b13+a42*b23+a43*b33+a44*b43;t[15]=a41*b14+a42*b24+a43*b34+a44*b44;
 t
}
/// `Vector3#applyMatrix4`, with its perspective divide.
fn transform(e:&[f64;16],x:f64,y:f64,z:f64)->[f64;3]{
 let w=1.0/(e[3]*x+e[7]*y+e[11]*z+e[15]);
 [(e[0]*x+e[4]*y+e[8]*z+e[12])*w,(e[1]*x+e[5]*y+e[9]*z+e[13])*w,(e[2]*x+e[6]*y+e[10]*z+e[14])*w]
}
/// A `Box3` as `[min x, y, z, max x, y, z]`.
type Bounds=[f64;6];
const EMPTY:Bounds=[f64::INFINITY,f64::INFINITY,f64::INFINITY,f64::NEG_INFINITY,f64::NEG_INFINITY,f64::NEG_INFINITY];
fn expand(bounds:&mut Bounds,point:&[f64;3]){
 for axis in 0..3{bounds[axis]=jmin(bounds[axis],point[axis]);bounds[axis+3]=jmax(bounds[axis+3],point[axis]);}
}
/// `box.clone().applyMatrix4(matrix)`: an empty box stays as it is.
fn transformed(source:&Bounds,matrix:&[f64;16])->Bounds{
 if source[3]<source[0]||source[4]<source[1]||source[5]<source[2]{return *source;}
 let [x0,y0,z0,x1,y1,z1]=*source;
 let mut out=EMPTY;
 for (x,y,z) in [(x0,y0,z0),(x0,y0,z1),(x0,y1,z0),(x0,y1,z1),(x1,y0,z0),(x1,y0,z1),(x1,y1,z0),(x1,y1,z1)]{expand(&mut out,&transform(matrix,x,y,z));}
 out
}
fn vector(value:&JsValue)->R<[f64;3]>{Ok([num(&read(value,"x")?),num(&read(value,"y")?),num(&read(value,"z")?)])}
fn measure(object:&JsValue,parent:&[f64;16],bounds:&mut Bounds)->R{
 method(object,"updateMatrix",&[])?;
 let matrix=multiply(parent,&elements(&read(object,"matrix")?)?);
 let geometry=read(object,"geometry")?;
 if truthy(&geometry){
  method(&geometry,"computeBoundingBox",&[])?;
  let bounding=read(&geometry,"boundingBox")?;
  let [a,b]=[vector(&read(&bounding,"min")?)?,vector(&read(&bounding,"max")?)?];
  let local=transformed(&[a[0],a[1],a[2],b[0],b[1],b[2]],&matrix);
  for axis in 0..3{bounds[axis]=jmin(bounds[axis],local[axis]);bounds[axis+3]=jmax(bounds[axis+3],local[axis+3]);}
 }
 let children=read(object,"children")?;
 let count=num(&read(&children,"length")?) as u32;
 for index in 0..count{measure(&get_at(&children,index),&matrix,bounds)?;}
 Ok(())
}

/// The cabinet's bounds in its own frame, from every geometry's bounding box under the composed
/// local matrices (each object's matrix is updated from its pose first), as `[min, max]` xyz.
/// Long upright ends or the last shelf board can be its lowest physical surface: the shared floor.
#[wasm_bindgen]
pub fn scene_local_bounds(cabinet:&JsValue)->R<Vec<f64>>{
 let identity=[1.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,1.0];
 let mut bounds=EMPTY;
 measure(cabinet,&identity,&mut bounds)?;
 Ok(bounds.to_vec())
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

/// `for (const value of iterable)`, failing like the engine for a value that is not iterable.
fn each(iterable:&JsValue,mut visit:impl FnMut(JsValue)->R<bool>)->R<bool>{
 let values=js_sys::try_iter(iterable)?.ok_or_else(||JsValue::from(js_sys::TypeError::new("object is not iterable")))?;
 for value in values{if !visit(value?)?{return Ok(false);}}
 Ok(true)
}
fn decorative(entry:&JsValue)->R<bool>{let kind=read(entry,"kind")?;Ok(kind==st("plant")||kind==st("lamp"))}

/// Saved metadata replaces the shown books' records without a frame when nothing else changed: one
/// record per book, no replacement, plant quality, return, drop, preview or landing under way, unique
/// ids, an adoptable batch (`can_adopt(previous, records)`) and every previous record still shown by a
/// connected, bound button in the same state (`state_for`). Only then is every record assigned.
#[wasm_bindgen]
pub fn scene_adopt_records(entries:&Array,previous:&JsValue,records:&JsValue,by_node:&Map,state_for:&Function,can_adopt:&Function)->R<bool>{
 let mut books=Vec::new();
 for entry in entries.iter(){if !decorative(&entry)?{books.push(entry);}}
 if !Array::is_array(records)||read(records,"length")?!=JsValue::from_f64(books.len() as f64){return Ok(false);}
 for entry in entries.iter(){
  for key in ["replacement","plantQuality","insertion","trashDrop"]{if truthy(&read(&entry,key)?){return Ok(false);}}
  if truthy(&read(&read(&entry,"preview")?,"active")?)||truthy(&read(&entry,"landing")?){return Ok(false);}
 }
 let by_id=Map::new();
 for entry in &books{
  let book=read(entry,"book")?;
  by_id.set(&text_value(&if absent(&book){JsValue::UNDEFINED}else{read(&book,"id")?}),entry);
 }
 if by_id.size() as usize!=books.len()||!truthy(&can_adopt.call2(&JsValue::UNDEFINED,previous,records)?){return Ok(false);}
 let current=each(previous,|book|{
  let entry=by_id.get(&text_value(&read(&book,"id")?));
  if !truthy(&entry)||read(&entry,"book")?!=book{return Ok(false);}
  let node=read(&entry,"node")?;
  if absent(&node)||!truthy(&read(&node,"isConnected")?)||by_node.get(&node)!=entry{return Ok(false);}
  Ok(state_for.call1(&JsValue::UNDEFINED,&entry)?==read(&entry,"state")?)
 })?;
 if !current{return Ok(false);}
 each(records,|book|{set(&by_id.get(&text_value(&read(&book,"id")?)),"book",&book)?;Ok(true)})?;
 Ok(true)
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

/// Whether another visible book than `caller` still decodes its first cover.
#[wasm_bindgen]
pub fn scene_covers_pending(entries:&Array,caller:&JsValue)->R<bool>{
 for entry in entries.iter(){
  if entry==*caller||decorative(&entry)?{continue;}
  let model=read(&entry,"model")?;
  if absent(&model)||!truthy(&read(&model,"visible")?){continue;}
  if read(&read(&model,"userData")?,"coverLoaded")?.is_undefined(){return Ok(true);}
 }
 Ok(false)
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

/// The resting offset of a shelf entry's placement preview.
#[wasm_bindgen]
pub fn scene_fresh_preview()->R<JsValue>{
 let preview:JsValue=Object::new().into();
 for key in ["x","y","fromX","fromY","targetX","targetY","started"]{set(&preview,key,&JsValue::from_f64(0.0))?;}
 set(&preview,"active",&JsValue::FALSE)?;
 Ok(preview)
}

/// A layout's new entry: its record, key and `pose`, no model yet, at rest, and empty per-frame caches
/// of what the DOM said last time (see stateFor, hitSurface, project); `flags` is the shared at-rest set.
#[wasm_bindgen]
pub fn scene_fresh_entry(entry:&JsValue,index:f64,pose:&JsValue,flags:&JsValue)->R<JsValue>{
 let fresh:JsValue=Object::assign(&Object::new(),entry.unchecked_ref::<Object>()).into();
 set(&fresh,"key",&scene_entry_key(entry,index)?)?;
 let (null,zero,empty,no)=(JsValue::NULL,JsValue::from_f64(0.0),st(""),JsValue::FALSE);
 set(&fresh,"model",&null)?;set(&fresh,"replacement",&null)?;set(&fresh,"pose",pose)?;
 let lift:JsValue=Object::new().into();
 for key in ["value","from","target","started"]{set(&lift,key,&zero)?;}
 set(&fresh,"lift",&lift)?;set(&fresh,"landing",&null)?;
 let offset:JsValue=Object::new().into();set(&offset,"x",&zero)?;set(&offset,"y",&zero)?;
 set(&fresh,"offset",&offset)?;set(&fresh,"preview",&scene_fresh_preview()?)?;
 for (key,value) in [("state",&empty),("rect",&null),("hitRect",&null),("insertion",&null),("overview",&no),("inspectionResolution",&zero),
  ("qualityReplacement",&no),("replacementReady",&no),("classText",&null),("flags",flags),("bits",&zero),("dragX",&empty),("dragY",&empty),
  ("dragNumberX",&zero),("dragNumberY",&zero),("stateText",&empty),("box",&null),("fallback",&null),("written",&null),("seen",&zero),
  ("domDirty",&JsValue::TRUE)]{set(&fresh,key,value)?;}
 Ok(fresh)
}

/// A retained plant or lamp takes the incoming layout's record: a changed lamp or plant model is
/// released, unless only a plant's pot colour changed and its model recolours itself in place (its
/// detail is then prepared again); a retained model's projected foliage moves to the new button;
/// the old button loses its model diagnostics; the record's fields are copied over.
fn rebind_decor(entry:&JsValue,data:&JsValue,lamp:bool,host:&JsValue,foliage:&Map)->R{
 use crate::scene_dom::{scene_clear_plant_diagnostics,scene_model_key};
 let keys=if lamp{2}else{0};
 let changed=scene_model_key(entry,keys)?!=scene_model_key(data,keys)?;
 let mut retain=!changed;
 if changed{
  let recolored=!lamp&&scene_model_key(entry,1)?==scene_model_key(data,1)?&&{
   let model=read(entry,"model")?;
   if absent(&model){false}else{
    let user=read(&model,"userData")?;
    let recolor=read(&user,"updatePotColor")?;
    !absent(&recolor)&&truthy(&method(&user,"updatePotColor",&[&read(data,"potColorId")?])?)
   }
  };
  if !recolored{method(host,"release",&[entry])?;}
  else{
   let quality=read(entry,"plantQuality")?;
   if !absent(&quality){method(&read(&quality,"plan")?,"dispose",&[])?;}
   set(entry,"plantQuality",&JsValue::NULL)?;
   set(&read(&read(entry,"model")?,"userData")?,"shelfPlantKeys",&scene_model_key(data,0)?)?;
   retain=true;
  }
 }
 if retain&&read(entry,"node")?!=read(data,"node")?{
  let native=foliage.get(&read(entry,"node")?);
  let node=read(data,"node")?;
  if truthy(&native)&&truthy(&node){
   foliage.delete(&read(entry,"node")?);
   foliage.set(&node,&scene_rebind_foliage(&native,&node)?);
  }
 }
 if read(entry,"node")?!=read(data,"node")?{scene_clear_plant_diagnostics(&read(entry,"node")?)?;}
 Object::assign(entry.unchecked_ref::<Object>(),data.unchecked_ref::<Object>());
 method(host,"place",&[entry])?;
 Ok(())
}

/// A committed layout's entries, in its order: each incoming one takes over the old entry of its key
/// (which leaves `old_entries`) or starts fresh (`host.fresh`, then `host.place`). A book's record goes
/// through `host.record(entry, data)`, a plant's or lamp's through `rebind_decor`. Every entry
/// restarts its preview, landing and written DOM state, and its button's original inline style is
/// remembered once (`host.styles`). An away button hands its class to its replacement.
#[wasm_bindgen]
pub fn scene_rebind_entries(next_entries:&Array,old_entries:&Map,host:&JsValue)->R<Array>{
 let foliage:Map=read(host,"foliage")?.unchecked_into();
 let styles:Map=read(host,"styles")?.unchecked_into();
 let retained=Array::new();
 let count=num(&read(next_entries,"length")?) as u32;
 for index in 0..count{
  let data=get_at(next_entries,index);
  let key=scene_entry_key(&data,f64::from(index))?;
  let mut entry=old_entries.get(&key);
  if truthy(&entry){
   old_entries.delete(&key);
   let (node,incoming)=(read(&entry,"node")?,read(&data,"node")?);
   if node!=incoming&&!absent(&node)&&has_class(&node,"is-away")?&&!absent(&incoming){
    method(&read(&incoming,"classList")?,"add",&[&st("is-away")])?;
   }
   let kind=read(&data,"kind")?;
   if kind==st("plant")||kind==st("lamp"){rebind_decor(&entry,&data,kind==st("lamp"),host,&foliage)?;}
   else{set(&entry,"node",&read(&data,"node")?)?;method(host,"record",&[&entry,&data])?;}
  }else{
   entry=method(host,"fresh",&[&data,&JsValue::from_f64(f64::from(index))])?;
   method(host,"place",&[&entry])?;
  }
  set(&entry,"preview",&scene_fresh_preview()?)?;
  set(&entry,"landing",&JsValue::NULL)?;
  set(&entry,"written",&JsValue::NULL)?;set(&entry,"leanNode",&JsValue::NULL)?;set(&entry,"domDirty",&JsValue::TRUE)?;
  set(&entry,"key",&key)?;
  retained.push(&entry);
  let node=read(&entry,"node")?;
  if truthy(&node)&&!styles.has(&node){styles.set(&node,&method(&node,"getAttribute",&[&st("style")])?);}
 }
 Ok(retained)
}
