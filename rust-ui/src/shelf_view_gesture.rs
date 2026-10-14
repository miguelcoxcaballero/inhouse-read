//! A short horizontal swipe turns the cabinet; holds, scrolling and pinches retain their
//! existing owners. No render loop is needed to recognise it.
use std::{cell::RefCell,rc::{Rc,Weak}};
use wasm_bindgen::prelude::*;
use crate::host::*;

const EXCLUDED:&str="input,select,textarea,a,.ihr-shelf-catalog,.ihr-shelf-trash,.ihr-plant-catalog,button:not(.ihr-spine):not(.ihr-plant):not(.ihr-lamp)";

/// `Set` membership: SameValueZero.
fn same_value(a:&JsValue,b:&JsValue)->bool{a==b||(a.as_f64().is_some_and(f64::is_nan)&&b.as_f64().is_some_and(f64::is_nan))}

#[derive(Clone)]
struct Candidate{id:JsValue,x:f64,y:f64,mode:JsValue,claimed:bool,rejected:bool}
struct State{contacts:Vec<JsValue>,candidate:Option<Candidate>,suppress_click:bool,click_timer:JsValue,click_key:u64}
struct Gesture{
 root:JsValue,scroller:JsValue,get_mode:JsValue,set_mode:JsValue,is_enabled:JsValue,on_gesture_start:JsValue,
 state:RefCell<State>,listeners:RefCell<Vec<Listener>>,me:RefCell<Weak<Gesture>>,
}
fn zero()->JsValue{JsValue::from_f64(0.0)}

impl Gesture{
 fn me(&self)->Rc<Gesture>{self.me.borrow().upgrade().expect("Shelf view gesture is alive while it runs")}
 fn consume(&self,event:&JsValue)->Result<(),JsValue>{method(event,"preventDefault",&[])?;method(event,"stopPropagation",&[])?;Ok(())}
 fn excluded(&self,target:&JsValue)->Result<bool,JsValue>{Ok(truthy(&method(target,"closest",&[&JsValue::from_str(EXCLUDED)])?))}
 fn enabled(&self)->Result<bool,JsValue>{Ok(truthy(&call(&self.is_enabled,"isEnabled",&[])?))}
 fn mode(&self)->Result<JsValue,JsValue>{call(&self.get_mode,"getMode",&[])}
 fn threshold(&self)->Result<f64,JsValue>{
  let scroller=read(&self.scroller,"clientWidth")?;
  let width=if truthy(&scroller){scroller}else{let root=read(&self.root,"clientWidth")?;if truthy(&root){root}else{JsValue::from_f64(390.0)}};
  Ok(jmax(48.0,jmin(96.0,num(&width)*0.16)))
 }
 fn direction(&self,mode:&JsValue,dx:f64)->bool{if text(mode,"spine"){dx<0.0}else{dx>0.0}}
 fn forget(&self){self.state.borrow_mut().candidate=None;}
 fn start(&self,event:&JsValue)->Result<(),JsValue>{
  let kind=read(event,"pointerType")?;
  if !(text(&kind,"touch")||text(&kind,"pen")){return Ok(());}
  let button=read(event,"button")?;
  if !button.is_undefined()&&button.as_f64()!=Some(0.0){return Ok(());}
  let id=read(event,"pointerId")?;
  let size={let mut state=self.state.borrow_mut();if !state.contacts.iter().any(|known|same_value(known,&id)){state.contacts.push(id.clone());}state.contacts.len()};
  if size!=1||read(event,"isPrimary")?==JsValue::FALSE{self.forget();return Ok(());}
  if !self.enabled()?||self.excluded(&read(event,"target")?)?{return Ok(());}
  let (timer,key)={let state=self.state.borrow();(state.click_timer.clone(),state.click_key)};
  clear_timeout(&timer)?;release(key);
  {let mut state=self.state.borrow_mut();state.click_key=0;state.suppress_click=false;}
  let x=num(&read(event,"clientX")?);let y=num(&read(event,"clientY")?);
  let mode=self.mode()?;
  self.state.borrow_mut().candidate=Some(Candidate{id,x,y,mode,claimed:false,rejected:false});
  Ok(())
 }
 fn motion(&self,event:&JsValue)->Result<(),JsValue>{
  let Some(swipe)=self.state.borrow().candidate.clone()else{return Ok(())};
  if !same_strict(&swipe.id,&read(event,"pointerId")?){return Ok(());}
  if !self.enabled()?||self.state.borrow().contacts.len()!=1||self.mode()?!=swipe.mode{self.forget();return Ok(());}
  let dx=num(&read(event,"clientX")?)-swipe.x;let dy=num(&read(event,"clientY")?)-swipe.y;
  if !swipe.claimed{
   let mut rejected=swipe.rejected;
   if dy.abs()>12.0&&dy.abs()>dx.abs(){rejected=true;if let Some(live)=self.state.borrow_mut().candidate.as_mut(){live.rejected=true;}}
   if rejected||dx.abs()<14.0||dx.abs()<dy.abs()*1.5||!self.direction(&swipe.mode,dx){return Ok(());}
   // Claim before the semantic book receives this move. Its hold is cancelled once;
   // releasing the swipe must never open that book.
   {let mut state=self.state.borrow_mut();if let Some(live)=state.candidate.as_mut(){live.claimed=true;}state.suppress_click=true;}
   call(&self.on_gesture_start,"onGestureStart",&[event])?;
   let _=method_opt(&self.scroller,"setPointerCapture",&[&read(event,"pointerId")?]);
  }
  self.consume(event)
 }
 fn finish(&self,event:&JsValue)->Result<(),JsValue>{
  let id=read(event,"pointerId")?;
  self.state.borrow_mut().contacts.retain(|known|!same_value(known,&id));
  let Some(swipe)=self.state.borrow().candidate.clone()else{return Ok(())};
  if !same_strict(&swipe.id,&id){return Ok(());}
  self.forget();
  if !swipe.claimed{return Ok(());}
  self.consume(event)?;
  let _=method_opt(&self.scroller,"releasePointerCapture",&[&read(event,"pointerId")?]);
  let dx=num(&read(event,"clientX")?)-swipe.x;let dy=num(&read(event,"clientY")?)-swipe.y;
  if !text(&read(event,"type")?,"pointercancel")&&self.enabled()?&&self.mode()?==swipe.mode
   &&dx.abs()>=self.threshold()?&&dx.abs()>dy.abs()*1.5&&self.direction(&swipe.mode,dx){
   let next=if text(&swipe.mode,"spine"){"isometric"}else{"spine"};
   call(&self.set_mode,"setMode",&[&JsValue::from_str(next)])?;
  }
  let (timer,key)={let state=self.state.borrow();(state.click_timer.clone(),state.click_key)};
  clear_timeout(&timer)?;release(key);
  let key=next_key();let weak=Rc::downgrade(&self.me());
  let callback=Closure::wrap(Box::new(move|_:JsValue|{
   release(key);
   if let Some(gesture)=weak.upgrade(){let mut state=gesture.state.borrow_mut();state.suppress_click=false;state.click_key=0;}
  })as Box<dyn FnMut(JsValue)>);
  let function=adopt(key,callback);
  let timer=set_timeout(&function,400.0)?;
  let mut state=self.state.borrow_mut();state.click_timer=timer;state.click_key=key;
  Ok(())
 }
 fn click(&self,event:&JsValue)->Result<(),JsValue>{
  if self.state.borrow().suppress_click&&truthy(&read(event,"detail")?){self.consume(event)?;}
  Ok(())
 }
 fn key(&self,event:&JsValue)->Result<(),JsValue>{
  if read(event,"target")?!=self.root||!self.enabled()?||truthy(&read(event,"ctrlKey")?)||truthy(&read(event,"altKey")?)||truthy(&read(event,"metaKey")?)||truthy(&read(event,"shiftKey")?)||truthy(&read(event,"repeat")?){return Ok(());}
  let pressed=read(event,"key")?;
  let mode=if text(&pressed,"ArrowLeft"){"isometric"}else if text(&pressed,"ArrowRight"){"spine"}else{return Ok(())};
  self.consume(event)?;
  call(&self.set_mode,"setMode",&[&JsValue::from_str(mode)])?;Ok(())
 }
 fn destroy(&self)->Result<(),JsValue>{
  {let mut state=self.state.borrow_mut();state.candidate=None;state.contacts.clear();}
  let (timer,key)={let state=self.state.borrow();(state.click_timer.clone(),state.click_key)};
  clear_timeout(&timer)?;release(key);
  let listeners=std::mem::take(&mut *self.listeners.borrow_mut());
  drop(listeners);Ok(())
 }
}
/// `===` between pointer ids.
fn same_strict(a:&JsValue,b:&JsValue)->bool{a==b}

#[wasm_bindgen]
pub struct RustShelfViewGesture{gesture:Rc<Gesture>}
#[wasm_bindgen]
impl RustShelfViewGesture{
 #[wasm_bindgen(constructor)]
 pub fn new(options:JsValue)->Result<RustShelfViewGesture,JsValue>{
  let root=read(&options,"root")?;let scroller=read(&options,"scroller")?;let get_mode=read(&options,"getMode")?;
  let set_mode=read(&options,"setMode")?;let is_enabled=read(&options,"isEnabled")?;let on_gesture_start=read(&options,"onGestureStart")?;
  let gesture=Rc::new(Gesture{root:root.clone(),scroller:scroller.clone(),get_mode,set_mode,is_enabled,on_gesture_start,
   state:RefCell::new(State{contacts:Vec::new(),candidate:None,suppress_click:false,click_timer:zero(),click_key:0}),
   listeners:RefCell::new(Vec::new()),me:RefCell::new(Weak::new())});
  *gesture.me.borrow_mut()=Rc::downgrade(&gesture);
  let add=|target:&JsValue,kind:&'static str,capture:bool,handler:fn(&Gesture,&JsValue)->Result<(),JsValue>|->Result<(),JsValue>{
   let weak=Rc::downgrade(&gesture);
   let listener=listen(target,kind,None,capture,move|event|match weak.upgrade(){Some(gesture)=>handler(&gesture,&event),None=>Ok(())})?;
   gesture.listeners.borrow_mut().push(listener);Ok(())
  };
  add(&scroller,"pointerdown",true,Gesture::start)?;add(&scroller,"pointermove",true,Gesture::motion)?;add(&scroller,"pointerup",true,Gesture::finish)?;
  add(&scroller,"pointercancel",true,Gesture::finish)?;add(&scroller,"click",true,Gesture::click)?;add(&root,"keydown",false,Gesture::key)?;
  Ok(RustShelfViewGesture{gesture})
 }
 pub fn destroy(&self)->Result<(),JsValue>{self.gesture.destroy()}
}
