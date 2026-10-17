//! A book that comes back from the reader: the key of the case it is allowed to reuse, the single
//! view that waits for it, and the parked matrix and projected pose it lands on. The view, its
//! `dispose()` and `prepareReturnAppearance()` stay host objects; the matrices follow
//! three@0.180's operation order and the host's `Math` supplies the transcendentals.
use std::{cell::{Cell,RefCell},rc::Rc};
use wasm_bindgen::{prelude::*,JsCast};
use js_sys::{Array,Object};
use crate::host::*;
#[allow(dead_code)]
#[path="../../rust-core/src/jsmath.rs"]
mod jsmath;
use jsmath::Mat4;

const CASE_FIELDS:[&str;19]=["id","path","name","title","author","format","spineTitleOverride","spineColorOverride",
 "spineFontFamily","spineFontSize","spineAuthorFontSize","spineFinish","spineSurfaceFinish","spineTextFinish",
 "spineTextColor","spineEngraved","coverFinish","coverRelief","pageEdgeFinish"];
const RETURN_PAINT_FIELDS:[&str;8]=["color","shade","ink","fontFamily","fontCanvasFamily","fontFallback","fontWeight","appearanceSource"];
const CANONICAL_GEOMETRY_FIELDS:[&str;5]=["width","height","thickness","centerX","centerY"];

fn case_fields(book:&JsValue)->Result<Array,JsValue>{
 let fields=Array::new();
 for key in CASE_FIELDS{fields.push(&if absent(book){JsValue::UNDEFINED}else{read(book,key)?});}
 Ok(fields)
}
fn own_values(geometry:&JsValue)->Array{Object::values(&boxed(geometry).unchecked_into::<Object>())}
fn own_keys(value:&JsValue)->Array{Object::keys(&boxed(value).unchecked_into::<Object>())}
fn stringify(value:&JsValue)->Result<JsValue,JsValue>{Ok(js_sys::JSON::stringify(value)?.into())}

/// The case's visual inputs, strictly: storage and cloud metadata and progress cannot alter its
/// pixels (the final progress is applied to the ribbon separately). `null` for a camera that is
/// not finite or has no positive size.
#[wasm_bindgen]
pub fn book_return_signature(book:&JsValue,style:&JsValue,geometry:&JsValue,cover_url:&JsValue)->Result<JsValue,JsValue>{
 if !truthy(geometry)||own_values(geometry).iter().any(|value|!finite(&value)){return Ok(JsValue::NULL);}
 for key in ["width","height","thickness","viewportWidth","viewportHeight"]{if !(num(&read(geometry,key)?)>0.0){return Ok(JsValue::NULL);}}
 let fields:JsValue=case_fields(book)?.into();
 stringify(&Array::of4(&fields,style,geometry,cover_url))
}

/// Explicit reuse key: discard only arithmetic noise in the comparison, never in the actual
/// geometry. Viewport, cover ratio and structural style stay strict.
#[wasm_bindgen]
pub fn book_return_compatibility(book:&JsValue,style:&JsValue,geometry:&JsValue)->Result<JsValue,JsValue>{
 if !truthy(&book_return_signature(book,style,geometry,&JsValue::NULL)?){return Ok(JsValue::NULL);}
 let dimensions=Array::new();
 for key in own_keys(geometry).sort().iter(){
  let name=key.as_string().unwrap_or_default();
  let value=read(geometry,&name)?;
  let value=if CANONICAL_GEOMETRY_FIELDS.contains(&name.as_str()){
   // Number(value.toPrecision(14)): fourteen significant digits, read back.
   JsValue::from_f64(num(&js_sys::Number::from(num(&value)).to_precision(14)?.into()))
  }else{value};
  dimensions.push(&Array::of2(&key,&value));
 }
 let structure=Array::new();
 let source=if truthy(style){style.clone()}else{Object::new().into()};
 for key in own_keys(&source).sort().iter(){
  let name=key.as_string().unwrap_or_default();
  if RETURN_PAINT_FIELDS.contains(&name.as_str()){continue;}
  structure.push(&Array::of2(&key,&read(&source,&name)?));
 }
 let fields:JsValue=case_fields(book)?.into();let (structure,dimensions):(JsValue,JsValue)=(structure.into(),dimensions.into());
 stringify(&Array::of3(&fields,&structure,&dimensions))
}

struct Held{signature:JsValue,view:JsValue,compatibility:JsValue,released:Cell<bool>}

fn release(previous:Option<Rc<Held>>)->Result<(),JsValue>{
 if let Some(previous)=previous{if !previous.released.get(){previous.released.set(true);method(&previous.view,"dispose",&[])?;}}
 Ok(())
}
fn same(a:&Option<Rc<Held>>,b:&Rc<Held>)->bool{a.as_ref().is_some_and(|a|Rc::ptr_eq(a,b))}

/// One already rendered book may wait behind the reader. Ownership transfers once to the close
/// animation; a mismatch, replacement or destroy releases it. The host object around this one
/// (native-book-return.js) keeps the promise reactions of a pending upgrade, so the host frees
/// this object, and the views it still holds, when it collects a cache that was dropped.
#[wasm_bindgen]
#[derive(Default)]
pub struct BookReturnCache{
 held:RefCell<Option<Rc<Held>>>,taking:RefCell<Option<Rc<Held>>>,
 // Upgrades whose promise has not answered yet, by the token the host gets back.
 upgrades:RefCell<Vec<(u32,Rc<Held>)>>,next:Cell<u32>,
}

#[wasm_bindgen]
impl BookReturnCache{
 #[wasm_bindgen(constructor)]
 pub fn new()->BookReturnCache{BookReturnCache::default()}
 pub fn retain(&self,signature:&JsValue,view:&JsValue,compatibility:&JsValue)->Result<bool,JsValue>{
  self.clear()?;
  let compatibility=if compatibility.is_undefined(){JsValue::NULL}else{compatibility.clone()};
  if !truthy(signature)||!truthy(view){
   // view?.dispose(): nothing for null or undefined, and a missing method is the engine's TypeError.
   if !absent(view){
    if !read(view,"dispose")?.is_function(){return Err(js_sys::TypeError::new("view?.dispose is not a function").into());}
    method(view,"dispose",&[])?;
   }
   return Ok(false);
  }
  *self.held.borrow_mut()=Some(Rc::new(Held{signature:signature.clone(),view:view.clone(),compatibility,released:Cell::new(false)}));
  Ok(true)
 }
 pub fn take(&self,signature:&JsValue)->Result<JsValue,JsValue>{
  let previous=self.held.borrow_mut().take();
  if let Some(held)=&previous{if truthy(signature)&&held.signature==*signature{return Ok(held.view.clone());}}
  if let Some(held)=&previous{method(&held.view,"dispose",&[])?;}
  Ok(JsValue::NULL)
 }
 /// The synchronous half of `takeCompatible`: `[answer, 0]` when the request is decided now,
 /// `[what the upgrade returned, token]` when the host must await it and call `finish` or `fail`.
 #[wasm_bindgen(js_name=startCompatible)]
 pub fn start_compatible(&self,request:&JsValue)->Result<Array,JsValue>{
  // The parameter list destructures the request, which fails before anything else for null or undefined.
  if absent(request){return Err(js_sys::TypeError::new(&format!("Cannot destructure property 'signature' of '{}' as it is {}.",
   if request.is_null(){"object null"}else{"undefined"},if request.is_null(){"null"}else{"undefined"})).into());}
  let signature=read(request,"signature")?;let compatibility=read(request,"compatibility")?;
  let book=read(request,"book")?;let style=read(request,"style")?;let cover_url=read(request,"coverUrl")?;
  let decided=|answer:JsValue|Ok(Array::of2(&answer,&JsValue::from_f64(0.0)));
  let previous=self.held.borrow_mut().take();
  let Some(previous)=previous else{return decided(JsValue::NULL)};
  if truthy(&signature)&&previous.signature==signature{return decided(previous.view.clone());}
  if !truthy(&compatibility)||compatibility!=previous.compatibility||!read(&previous.view,"prepareReturnAppearance")?.is_function(){
   release(Some(previous))?;return decided(JsValue::NULL);
  }
  *self.taking.borrow_mut()=Some(previous.clone());
  // try { const ready = await previous.view.prepareReturnAppearance(book, style, coverUrl); ...
  match method(&previous.view,"prepareReturnAppearance",&[&book,&style,&cover_url]){
   Ok(pending)=>{
    let token=self.next.get()+1;self.next.set(token);
    self.upgrades.borrow_mut().push((token,previous));
    Ok(Array::of2(&pending,&JsValue::from_f64(f64::from(token))))
   }
   Err(_)=>{let answer=self.give_up(&previous)?;decided(answer)}
  }
 }
 /// The upgrade answered: hand the view over only for `true`, and only if nothing claimed it meanwhile.
 pub fn finish(&self,token:u32,ready:&JsValue)->Result<JsValue,JsValue>{
  let Some(previous)=self.upgrade(token) else{return Ok(JsValue::NULL)};
  if !same(&self.taking.borrow(),&previous)||previous.released.get(){return Ok(JsValue::NULL);}
  *self.taking.borrow_mut()=None;
  if *ready==JsValue::TRUE{return Ok(previous.view.clone());}
  self.give_up(&previous)
 }
 /// The upgrade failed.
 pub fn fail(&self,token:u32)->Result<JsValue,JsValue>{
  let Some(previous)=self.upgrade(token) else{return Ok(JsValue::NULL)};
  self.give_up(&previous)
 }
 pub fn clear(&self)->Result<(),JsValue>{
  let previous=self.held.borrow_mut().take();
  release(previous)?;
  let taking=self.taking.borrow().clone();
  release(taking)?;
  *self.taking.borrow_mut()=None;Ok(())
 }
}
impl BookReturnCache{
 fn upgrade(&self,token:u32)->Option<Rc<Held>>{
  let mut upgrades=self.upgrades.borrow_mut();
  upgrades.iter().position(|(known,_)|*known==token).map(|at|upgrades.remove(at).1)
 }
 /// The tail every unfinished upgrade shares: forget the pending claim and dispose the view.
 fn give_up(&self,previous:&Rc<Held>)->Result<JsValue,JsValue>{
  if same(&self.taking.borrow(),previous){*self.taking.borrow_mut()=None;}
  release(Some(previous.clone()))?;Ok(JsValue::NULL)
 }
}

fn element(list:&[f64],at:usize)->f64{list.get(at).copied().unwrap_or(f64::NAN)}
fn matrix(list:&[f64])->Mat4{let mut elements=[0.0;16];for (at,slot) in elements.iter_mut().enumerate(){*slot=element(list,at);}Mat4(elements)}

/// A parked book's transform in the cabinet's coordinate system, as sixteen matrix elements:
/// turned a quarter about Y, centred on its slot and `depth_inset` into the shelf. The rotation is
/// the quaternion of `Euler(0, PI / 2, 0, 'XYZ')`, whose half-angle sine and cosine are the host's.
#[wasm_bindgen]
pub fn shelf_book_slot(entry:&JsValue,cabinet_width:f64,physical:JsValue)->Result<Vec<f64>,JsValue>{
 if !physical.is_null()&&!physical.is_undefined(){
  let values=js_sys::Array::from(&physical);if values.length()==16{
   let matrix:Option<Vec<f64>>=values.iter().map(|v|v.as_f64().filter(|n|n.is_finite())).collect();
   if let Some(matrix)=matrix{return Ok(matrix);}
  }
 }
 let x=num(&read(entry,"x")?);let y=num(&read(entry,"y")?);let width=num(&read(entry,"width")?);
 let inset=read(entry,"depthInset")?;
 let inset=if truthy(&inset){num(&inset)}else{0.0};
 let half=std::f64::consts::PI/2.0/2.0;
 let (s2,c2)=(js_sys::Math::sin(half),js_sys::Math::cos(half));
 // x = s1 c2 c3 + c1 s2 s3 and z = c1 c2 s3 + s1 s2 c3 vanish for a lone Y turn; y = s2 and w = c2.
 let rotation=[0.0*c2*1.0+1.0*s2*0.0,1.0*s2*1.0-0.0*c2*0.0,1.0*c2*0.0+0.0*s2*1.0,1.0*c2*1.0-0.0*s2*0.0];
 Ok(Mat4::compose([x-cabinet_width/2.0,-y,-width/2.0-inset],rotation,[1.0,1.0,1.0]).0.to_vec())
}

fn euler_xyz(quaternion:[f64;4])->[f64;3]{
 let e=Mat4::compose([0.0;3],quaternion,[1.0;3]).0;
 let (m12,m13,m22,m23,m32,m33,m11)=(e[4],e[8],e[5],e[9],e[6],e[10],e[0]);
 let y=js_sys::Math::asin(clamp(m13,-1.0,1.0));
 if m13.abs()<0.9999999{[js_sys::Math::atan2(-m23,m33),y,js_sys::Math::atan2(-m12,m11)]}else{[js_sys::Math::atan2(m32,m22),y,0.0]}
}

/// `[angle, pitch, roll, scale, centerX, centerY, depth]` of a book in the cabinet's local frame
/// once the furniture matrix is applied: the composed rotation survives the switch between the
/// canvases, including the frontal gimbal boundary.
#[wasm_bindgen]
pub fn project_shelf_book_pose(furniture:&[f64],local:&[f64],stage_left:f64,stage_top:f64)->Vec<f64>{
 let world=Mat4::multiply(&matrix(furniture),&matrix(local));
 let (position,quaternion,scale)=world.decompose();
 let rotation=euler_xyz(quaternion);
 let degrees=180.0/std::f64::consts::PI;
 vec![rotation[1]*degrees,rotation[0]*degrees,rotation[2]*degrees,scale[0],stage_left+position[0],stage_top-position[1],position[2]]
}
