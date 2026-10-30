//! The shelf scene's room as it is set up once: the walnut's materials, the baked occlusion, the
//! floor and the room's wall, the placement guide and the return's depth writers, the clip that
//! holds the native room's canvas, the occlusion rebuilt for a new cabinet or theme, a drop into the
//! bin's starting record and the book-only exports of the native room and of a returning book.
//! None of these run per frame or per entry: once per scene, rebuild, theme change, drop or export.
//! Every object is created, named, flagged and added in the order bookshelf-scene.js created it,
//! so three.js hands out the same ids (render-list ties fall back to them) and the same children.
use wasm_bindgen::{prelude::*,JsCast};
use js_sys::{Array,Function,Object,Reflect};
use crate::host::{absent,call,jmax,method,num,read,set,truthy};
type R<T=()> = Result<T,JsValue>;

fn st(text:&str)->JsValue{JsValue::from_str(text)}
fn n(value:f64)->JsValue{JsValue::from_f64(value)}
/// `new THREE[name](...args)`.
fn make(three:&JsValue,name:&str,args:&[&JsValue])->R<JsValue>{
 let constructor=read(three,name)?.dyn_into::<Function>().map_err(|_|js_sys::TypeError::new(&format!("THREE.{name} is not a constructor")))?;
 let list=Array::new();for argument in args{list.push(argument);}
 Reflect::construct(&constructor,&list)
}
/// A material's parameters, in the order the scene listed them (setValues assigns them in that order).
fn params(entries:&[(&str,JsValue)])->R<JsValue>{
 let object:JsValue=Object::new().into();
 for (key,value) in entries{set(&object,key,value)?;}
 Ok(object)
}
fn user(object:&JsValue,key:&str,value:&JsValue)->R{set(&read(object,"userData")?,key,value)}

/// The room's materials and its fixed meshes. Oiled walnut under a thin satin lacquer: the pores stay
/// open and matte in the base layer while a smooth clearcoat carries the room's reflections; vertex
/// colours carry each board's own tone, end grain and joint shadow. The back panel takes the lighting's
/// wide penumbra (`wide_penumbra`). The baked corner occlusion and floor contact are one unlit,
/// depth-tested draw; three unlit depth writers (indexed by side) serve the insertion's depth pass.
/// The floor keeps the physical support and contact diagnostics without painting a wooden platform
/// around the cabinet or reserving camera space for it. The room's wall, apart from the open steel
/// cabinet, catches real warm light through its mesh; its edges stay outside the viewport at any zoom
/// and it adds neither furniture bounds nor selectable or drop surfaces. Both untouchable meshes take
/// `inert` as their raycast. Returns [wood, backWood, darkWood, occlusionMaterial, depthOnly,
/// occlusion, floor, roomWallMaterial, roomWall]; the floor, the occlusion and the wall join `furniture`.
#[wasm_bindgen]
pub fn scene_room_materials(three:&JsValue,texture:&JsValue,grain:&JsValue,wide_penumbra:&Function,furniture:&JsValue,inert:&JsValue)->R<Array>{
 let yes=JsValue::TRUE;
 let wood=make(three,"MeshPhysicalMaterial",&[&params(&[("map",texture.clone()),("bumpMap",grain.clone()),("bumpScale",n(0.55)),
  ("roughnessMap",grain.clone()),("vertexColors",yes.clone()),("color",st("#ffffff")),("roughness",n(0.9)),("clearcoat",n(0.32)),
  ("clearcoatRoughness",n(0.36))])?])?;
 let back=wide_penumbra.call1(&JsValue::UNDEFINED,&make(three,"MeshStandardMaterial",&[&params(&[("map",texture.clone()),
  ("bumpMap",grain.clone()),("bumpScale",n(0.4)),("roughnessMap",grain.clone()),("vertexColors",yes.clone()),("color",st("#e6dccf")),
  ("roughness",n(1.2)),("envMapIntensity",n(0.7))])?])?)?;
 let dark=make(three,"MeshPhysicalMaterial",&[&params(&[("map",texture.clone()),("bumpMap",grain.clone()),("bumpScale",n(0.5)),
  ("roughnessMap",grain.clone()),("vertexColors",yes.clone()),("color",st("#f2e6d6")),("roughness",n(0.95)),("clearcoat",n(0.26)),
  ("clearcoatRoughness",n(0.4))])?])?;
 let floor_material=make(three,"MeshStandardMaterial",&[&params(&[("map",texture.clone()),("color",st("#b3a68d")),("roughness",n(0.94))])?])?;
 let occlusion_material=make(three,"MeshBasicMaterial",&[&params(&[("vertexColors",yes.clone()),("transparent",yes.clone()),
  ("depthWrite",JsValue::FALSE),("side",read(three,"DoubleSide")?),("polygonOffset",yes.clone()),("polygonOffsetFactor",n(-1.0)),
  ("polygonOffsetUnits",n(-2.0))])?])?;
 let depth_only=Array::new();
 for side in ["FrontSide","BackSide","DoubleSide"]{
  depth_only.push(&make(three,"MeshBasicMaterial",&[&params(&[("side",read(three,side)?),("colorWrite",JsValue::FALSE)])?])?);
 }
 let occlusion=make(three,"Mesh",&[&make(three,"BufferGeometry",&[])?,&occlusion_material])?;
 set(&occlusion,"name",&st("Cabinet occlusion"))?;set(&occlusion,"raycast",inert)?;
 let floor=make(three,"Mesh",&[&make(three,"BoxGeometry",&[&n(1.0),&n(2.0),&n(1.0)])?,&floor_material])?;
 set(&floor,"name",&st("Library floor"))?;user(&floor,"floor",&yes)?;set(&floor,"receiveShadow",&yes)?;
 set(&floor,"visible",&JsValue::FALSE)?;
 method(furniture,"add",&[&floor,&occlusion])?;
 let wall_material=make(three,"MeshStandardMaterial",&[&params(&[("color",st("#f0f1ed")),("roughness",n(1.0)),("envMapIntensity",n(0.7))])?])?;
 let wall=make(three,"Mesh",&[&make(three,"PlaneGeometry",&[&n(1.0),&n(1.0)])?,&wall_material])?;
 set(&wall,"name",&st("Library room wall"))?;user(&wall,"roomReceiver",&yes)?;
 set(&wall,"receiveShadow",&yes)?;set(&wall,"raycast",inert)?;
 method(furniture,"add",&[&wall])?;
 Ok([wood,back,dark,occlusion_material,depth_only.into(),occlusion,floor,wall_material,wall].into_iter().collect())
}

/// The placement guide, prepared hidden with the first scene so dragging a book never links a new
/// GPU program, joined to `furniture`; and the return's depth writers, one per side of `depth_only`,
/// on the guide's own geometry: they never add a visible object or render pass. Returns
/// [dropMarker, dropGuide, depthWriters].
#[wasm_bindgen]
pub fn scene_room_drop_marker(three:&JsValue,furniture:&JsValue,depth_only:&Array)->R<Array>{
 let marker=make(three,"Group",&[])?;
 set(&marker,"name",&st("Shelf placement guide"))?;user(&marker,"dropMarker",&JsValue::TRUE)?;set(&marker,"visible",&JsValue::FALSE)?;
 let material=make(three,"MeshBasicMaterial",&[&params(&[("color",st("#709980")),("transparent",JsValue::TRUE),("opacity",n(0.9)),
  ("depthTest",JsValue::FALSE),("depthWrite",JsValue::FALSE)])?])?;
 let guide=make(three,"Mesh",&[&make(three,"BoxGeometry",&[&n(2.0),&n(1.0),&n(2.0)])?,&material])?;
 let foot=make(three,"Mesh",&[&make(three,"BoxGeometry",&[&n(12.0),&n(2.0),&n(4.0)])?,&material])?;
 set(&read(&foot,"position")?,"y",&n(1.0))?;
 method(&marker,"add",&[&guide,&foot])?;method(furniture,"add",&[&marker])?;
 let writers=Array::new();
 for material in depth_only.iter(){writers.push(&make(three,"Mesh",&[&read(&guide,"geometry")?,&material])?);}
 Ok([marker,guide,writers.into()].into_iter().collect())
}

/// The clip that holds the native room's canvas, hidden and untouchable, at the end of `stage`.
#[wasm_bindgen]
pub fn scene_native_room_clip(stage:&JsValue)->R<JsValue>{
 let document=read(&crate::host::global(),"document")?;
 let clip=method(&document,"createElement",&[&st("div")])?;
 set(&clip,"className",&st("ihr-bookshelf-native-room-clip"))?;method(&clip,"setAttribute",&[&st("aria-hidden"),&st("true")])?;
 let style=read(&clip,"style")?;
 for (key,value) in [("position","absolute"),("overflow","hidden"),("pointerEvents","none"),("zIndex","0"),("display","none")]{set(&style,key,&st(value))?;}
 method(stage,"append",&[&clip])?;
 Ok(clip)
}

/// The public export of the native room into `raw` (the room canvas' 2D context), from the GL canvas
/// `source` the caller has just repainted with `frame`. A physical frame without overscan keeps the
/// ceil-sized export, including the original floor-to-ceil resample, without performing it on shown
/// frames; one with overscan first scales the complete GL source to its ceil-sized 2D tile, as the
/// original export did, then crops that tile into the base; an aligned frame crops its overscan.
#[wasm_bindgen]
pub fn scene_native_room_export(raw:&JsValue,canvas:&JsValue,source:&JsValue,frame:&JsValue,margin:f64)->R{
 let size=|key:&str|read(canvas,key);
 let zero=n(0.0);
 method(raw,"clearRect",&[&zero,&zero,&size("width")?,&size("height")?])?;
 let physical=truthy(&read(frame,"physical")?);
 if physical&&!(margin!=0.0&&!margin.is_nan()){
  return method(raw,"drawImage",&[source,&zero,&zero,&size("width")?,&size("height")?]).map(|_|());
 }
 if physical{
  let document=read(&crate::host::global(),"document")?;
  let tile=method(&document,"createElement",&[&st("canvas")])?;
  set(&tile,"width",&n((num(&read(frame,"width")?)*num(&read(frame,"ratio")?)).ceil()))?;
  set(&tile,"height",&n((num(&read(frame,"height")?)*num(&read(frame,"ratio")?)).ceil()))?;
  let drawn=(||->R{
   let context=method(&tile,"getContext",&[&st("2d")])?;
   if !truthy(&context){return Err(js_sys::Error::new("Native room crop export requires a 2D context").into());}
   method(&context,"drawImage",&[source,&zero,&zero,&read(&tile,"width")?,&read(&tile,"height")?])?;
   let offset=n(margin*num(&read(frame,"ratio")?));
   let offset2=n(margin*num(&read(frame,"ratio")?));
   method(raw,"drawImage",&[&tile,&offset,&offset2,&size("width")?,&size("height")?,&zero,&zero,&size("width")?,&size("height")?])?;
   Ok(())
  })();
  set(&tile,"height",&zero)?;set(&tile,"width",&zero)?;
  return drawn;
 }
 let offset=n(margin*num(&read(frame,"ratio")?));
 let offset2=n(margin*num(&read(frame,"ratio")?));
 method(raw,"drawImage",&[source,&offset,&offset2,&size("width")?,&size("height")?,&zero,&zero,&size("width")?,&size("height")?]).map(|_|())
}

/// The book-only export of a returning book into `raw`: the overlay's whole surface cleared, then the
/// GL canvas `source` (just repainted with `frame`) placed at the frame's device-pixel origin.
#[wasm_bindgen]
pub fn scene_insertion_export(raw:&JsValue,overlay:&JsValue,source:&JsValue,frame:&JsValue)->R{
 let zero=n(0.0);
 method(raw,"clearRect",&[&zero,&zero,&read(overlay,"width")?,&read(overlay,"height")?])?;
 let x=n(num(&read(frame,"x")?)*num(&read(frame,"ratio")?));
 let y=n(num(&read(frame,"y")?)*num(&read(frame,"ratio")?));
 method(raw,"drawImage",&[source,&x,&y]).map(|_|())
}

/// The cabinet's baked occlusion for `units` units laid out by `plan` (scale at 0, each unit's x from
/// 10), into `occlusion`'s new geometry: each unit's own rows; the bin's footprint and, on the dark page
/// (`floor_light` given), the lamp's floor pool belong to the right-hand end. Several units are merged
/// (`merge`) and their parts disposed. BAGGEBO has none: an empty geometry, hidden. The caller
/// disposed the old geometry and decided `floor_light` from the page's theme.
#[wasm_bindgen]
pub fn scene_room_occlusion(three:&JsValue,occlusion:&JsValue,baggebo:bool,plan:&[f64],units:f64,unit_width:f64,height:f64,depth:f64,
 floor_y:f64,rows:&JsValue,floor_light:&JsValue,trash:&JsValue,create:&Function,merge:&Function)->R{
 set(occlusion,"visible",&JsValue::from_bool(!baggebo))?;
 if baggebo{return set(occlusion,"geometry",&make(three,"BufferGeometry",&[])?);}
 let parts=Array::new();
 let mut index=0.0;
 while index<units{
  let x=plan.get(10+index as usize).copied().unwrap_or(f64::NAN);
  let last=index==units-1.0;
  let unit_rows=Array::new();
  let list:&Array=rows.unchecked_ref();
  // `(row.unit ?? 0) === index`: strictly a number, so a unit written as text matches none.
  for row in list.iter(){
   let unit=read(&row,"unit")?;
   if if absent(&unit){index==0.0}else{unit.as_f64()==Some(index)}{unit_rows.push(&row);}
  }
  let footprints=Array::new();
  if truthy(trash)&&last{
   let footprint=params(&[("x",n(num(&read(&read(trash,"position")?,"x")?)-x)),("z",read(&read(trash,"position")?,"z")?),
    ("radius",read(&read(trash,"userData")?,"radius")?)])?;
   footprints.push(&footprint);
  }
  let light=if truthy(floor_light)&&last{floor_light.clone()}else{JsValue::NULL};
  let options=params(&[("width",n(unit_width)),("height",n(height)),("depth",n(depth)),("scale",n(plan.first().copied().unwrap_or(f64::NAN))),("floorY",n(floor_y)),
   ("rows",unit_rows.into()),("floorLight",light),("footprints",footprints.into())])?;
  let geometry=call(create,"createShelfOcclusion",&[&options])?;
  method(&geometry,"translate",&[&n(x),&n(0.0),&n(0.0)])?;parts.push(&geometry);
  index+=1.0;
 }
 let single=parts.length()==1;
 let geometry=if single{parts.get(0)}else{merge.call2(&JsValue::UNDEFINED,&parts,&JsValue::FALSE)?};
 set(occlusion,"geometry",&geometry)?;
 if parts.length()>1{for part in parts.iter(){method(&part,"dispose",&[])?;}}
 Ok(())
}

/// The floor under the cabinet and the room's wall behind it, placed by the room's plan `room`
/// (rust-ui/src/scene_plan.rs): the floor's old box is disposed for one of the plan's size.
#[wasm_bindgen]
pub fn scene_room_floor(three:&JsValue,floor:&JsValue,wall:&JsValue,room:&[f64])->R{
 method(&read(floor,"geometry")?,"dispose",&[])?;
 let at=|index:usize|n(room.get(index).copied().unwrap_or(f64::NAN));
 set(floor,"geometry",&make(three,"BoxGeometry",&[&at(2),&n(2.0),&at(3)])?)?;
 method(&read(floor,"geometry")?,"computeBoundingBox",&[])?;
 method(&read(floor,"position")?,"set",&[&at(4),&at(5),&at(6)])?;
 method(&read(wall,"scale")?,"set",&[&at(7),&at(7),&n(1.0)])?;
 method(&read(wall,"position")?,"set",&[&n(0.0),&at(8),&at(9)]).map(|_|())
}

/// A layout on a new stage: the outgoing `stage` gets back its height, top and (unless it already had
/// one) its scene class, and every projected button its own style while its cover hit leaves; the
/// replacement `next` keeps its own height and top (it has not been pixel-shifted), takes the scene class
/// and the scene's canvases: the room first, the inspection tiles and the native room's clip after.
/// Returns [height, top, already] of `next`.
#[wasm_bindgen]
pub fn scene_move_stage(stage:&JsValue,next:&JsValue,height:&JsValue,top:&JsValue,already:bool,styles:&js_sys::Map,covers:&JsValue,
 canvases:&Array)->R<Array>{
 let style=read(stage,"style")?;
 set(&style,"height",height)?;set(&style,"top",top)?;
 if !already{method(&read(stage,"classList")?,"remove",&[&st("has-scene")])?;}
 // The expensive projected leaf triangles stay until entries are rebound: an unchanged plant moves
 // its native hit surface to the replacement button without tessellating again.
 crate::scene_dom::scene_restore_buttons(styles,covers)?;
 styles.clear();
 let height=read(&read(next,"style")?,"height")?;
 let top=read(&read(next,"style")?,"top")?;
 let already=truthy(&method(&read(next,"classList")?,"contains",&[&st("has-scene")])?);
 method(&read(next,"classList")?,"add",&[&st("has-scene")])?;
 method(next,"prepend",&[&canvases.get(0)])?;
 method(next,"append",&[&canvases.get(1)])?;
 method(next,"append",&[&canvases.get(2)])?;
 if truthy(&canvases.get(3)){method(next,"append",&[&canvases.get(3)])?;}
 Ok([height,top,JsValue::from_bool(already)].into_iter().collect())
}

/// A disposed scene leaves its stage: the room canvas and the inspection tiles (shrunk to one pixel)
/// are removed, the stage gets back its height and (unless it already had one) its scene class, and
/// every projected button its own style.
#[wasm_bindgen]
pub fn scene_release_stage(stage:&JsValue,height:&JsValue,already:bool,styles:&js_sys::Map,canvases:&Array)->R{
 let one=n(1.0);
 method(&canvases.get(0),"remove",&[])?;
 for tile in [canvases.get(1),canvases.get(2)]{
  method(&tile,"remove",&[])?;set(&tile,"height",&one)?;set(&tile,"width",&one)?;
 }
 set(&read(stage,"style")?,"height",height)?;
 if !already{method(&read(stage,"classList")?,"remove",&[&st("has-scene")])?;}
 crate::scene_dom::scene_restore_buttons(styles,&JsValue::UNDEFINED)
}

/// A drop into the bin's starting record for `model`, settling through `resolve`: its clock at `now`,
/// its duration (none under reduced motion, else the requested one, at least zero), the model's starting
/// position, scale and turn, the book's tumble into the bin and the lid's current openness.
#[wasm_bindgen]
pub fn scene_trash_drop_record(three:&JsValue,resolve:&JsValue,now:f64,reduced:bool,duration:&JsValue,model:&JsValue,trash:&JsValue)->R<JsValue>{
 // `Number(value) || 0`: NaN and both zeros give zero.
 let or_zero=|value:f64|if value.is_nan()||value==0.0{0.0}else{value};
 let duration=if reduced{0.0}else{jmax(0.0,or_zero(num(duration)))};
 let start=method(&read(model,"position")?,"clone",&[])?;
 let scale=read(&read(model,"scale")?,"x")?;
 let turn=method(&read(model,"quaternion")?,"clone",&[])?;
 let end=make(three,"Quaternion",&[])?;
 let book=make(three,"Quaternion",&[])?;
 let book=method(&book,"setFromEuler",&[&make(three,"Euler",&[&n(-0.22),&n(0.18),&n(-0.46)])?])?;
 let openness=or_zero(num(&read(&read(trash,"userData")?,"openness")?));
 params(&[("resolve",resolve.clone()),("settled",JsValue::FALSE),("complete",JsValue::FALSE),("started",n(now)),("lastFrame",n(now)),
  ("elapsed",n(0.0)),("duration",n(duration)),("start",start),("startScale",scale),("startQuaternion",turn),("endQuaternion",end),
  ("bookQuaternion",book),("initialOpenness",n(openness))])
}
