//! The shelf scene's recipes that follow an event and never a frame's entries: saving a room that
//! has come to rest, the idle preparation of a resting book's presentation and the place the solver
//! accepts for a dropped object. Every property is read and
//! written, and every host function called, in the order the former JavaScript of
//! bookshelf-scene.js did (frozen in tests/unit/helpers/reference-scene-events.js).
use std::{cell::RefCell,rc::Rc};
use wasm_bindgen::{prelude::*,JsCast};
use js_sys::Function;
use crate::host::{get,global,method,read,truthy};
use crate::book_gravity::RustBookGravity;
type R<T=()> = Result<T,JsValue>;
fn st(text:&str)->JsValue{JsValue::from_str(text)}

/// A room at rest is stored under `key` in its canonical form and acknowledged, unless nobody
/// touched it and what is stored already describes the same resting room: received geometry is
/// authoritative, and a passive render or resize must neither rewrite it nor turn the solver's
/// roundoff into a local edit.
#[wasm_bindgen]
pub fn scene_room_save(saved:JsValue,records:JsValue,key:&str,interacted:bool,acknowledge:&Function)->R{
 let canonical=crate::room_physics_sync::room_physics_canonical(saved,records);
 let storage=read(&global(),"localStorage")?;
 let existing=method(&storage,"getItem",&[&st(key)])?;
 if !interacted&&truthy(&existing)&&crate::room_physics_sync::room_physics_passive_compatible(existing,canonical.clone()){return Ok(());}
 method(&storage,"setItem",&[&st(key),&canonical])?;
 acknowledge.call1(&JsValue::UNDEFINED,&canonical)?;Ok(())
}

type Reaction=Closure<dyn FnMut(JsValue)>;
/// `await value`, then `next` with what it settled to (`Err` for a rejection). Both reactions are
/// released once one has run.
fn settled(value:&JsValue,next:impl FnOnce(Result<JsValue,JsValue>)+'static)->R{
 let pair:Rc<RefCell<Option<(Reaction,Reaction)>>>=Rc::new(RefCell::new(None));
 let next:Rc<RefCell<Option<Box<dyn FnOnce(Result<JsValue,JsValue>)>>>>=Rc::new(RefCell::new(Some(Box::new(next))));
 let reaction=|fulfilled:bool|{
  let (pair,next)=(pair.clone(),next.clone());
  Closure::wrap(Box::new(move|value:JsValue|{
   let work=next.borrow_mut().take();
   if let Some(work)=work{work(if fulfilled{Ok(value)}else{Err(value)});}
   pair.borrow_mut().take();
  }) as Box<dyn FnMut(JsValue)>)
 };
 let (fulfilled,rejected)=(reaction(true),reaction(false));
 let promise=method(&read(&global(),"Promise")?,"resolve",&[value])?;
 method(&promise,"then",&[fulfilled.as_ref(),rejected.as_ref()])?;
 *pair.borrow_mut()=Some((fulfilled,rejected));
 Ok(())
}
/// The preparation ended: `retry` is told unless both phases completed.
fn finish(prepared:bool,retry:&Function){if !prepared{let _=retry.call0(&JsValue::UNDEFINED);}}
fn failed(error:&JsValue,retry:&Function){
 let _=method(&get(&global(),"console"),"warn",&[&st("No se pudo preparar el libro en reposo:"),error]);
 finish(false,retry);
}
/// One already visible book's presentation is prepared in idle slices after a stable room frame:
/// `data.preparePresentation(idle, current)`, then, if it answered yes and the owner is still
/// `current()`, `data.prepareDetailPresentation(idle, current)` when the model has one. A phase that
/// answers no, a busy or hidden owner, a rejection or an exception (reported) calls `retry`, so a
/// later stable paint may try again; nothing here ever asks for a frame.
#[wasm_bindgen]
pub fn scene_prepare_resting(data:JsValue,idle:JsValue,current:Function,retry:Function){
 let first=match method(&data,"preparePresentation",&[&idle,current.as_ref()]){Ok(value)=>value,Err(error)=>return failed(&error,&retry)};
 let again=retry.clone();
 let waiting=settled(&first,move|ready|{
  let ready=match ready{Ok(value)=>value,Err(error)=>return failed(&error,&retry)};
  if !truthy(&ready){return finish(false,&retry);}
  match current.call0(&JsValue::UNDEFINED){Ok(still)=>if !truthy(&still){return finish(false,&retry);},Err(error)=>return failed(&error,&retry)}
  let detail=match read(&data,"prepareDetailPresentation"){Ok(value)=>value,Err(error)=>return failed(&error,&retry)};
  let Some(detail)=detail.dyn_ref::<Function>()else{return finish(true,&retry)};
  let second=match detail.call2(&data,&idle,current.as_ref()){Ok(value)=>value,Err(error)=>return failed(&error,&retry)};
  let last=retry.clone();
  let waiting=settled(&second,move|done|match done{Ok(value)=>finish(truthy(&value),&retry),Err(error)=>failed(&error,&retry)});
  if let Err(error)=waiting{failed(&error,&last);}
 });
 if let Err(error)=waiting{failed(&error,&again);}
}

/// Where the solver lets `key` rest on a shelf: `x` is the place asked for, as a fraction of the
/// bay between its paddings, and the answer is the accepted one in the same terms; nothing when the
/// solver refuses the place or the bay has no room.
#[wasm_bindgen]
pub fn scene_drop_x(gravity:&RustBookGravity,key:&JsValue,shelf:f64,x:f64,left:f64,right:f64,padding:f64,bottom:f64,ceiling:f64,pixels_per_metre:f64)->Option<f64>{
 let available=right-left-padding*2.0;
 let result=gravity.drop_position(key,&[shelf,left+padding+x*available,left,right,bottom,ceiling,pixels_per_metre]);
 if !result.is_empty()&&available>0.0{Some((result[0]-left-padding)/available)}else{None}
}
