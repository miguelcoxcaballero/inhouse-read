//! Reader gestures: page swipes, taps, double taps, narration holds and the damped
//! page spring. Native scrolling and text selection keep ownership of vertical drags.
//! Every timer, frame and callback runs at the moment the original handlers ran it.
use std::{cell::RefCell,rc::{Rc,Weak}};
use wasm_bindgen::prelude::*;
use crate::host::*;

const EDGE_ZONE_FRACTION:f64=0.28;
const SWIPE_MIN_DISTANCE:f64=40.0;
const SWIPE_MAX_DURATION:f64=600.0;
const DOUBLE_TAP_MAX_DELAY:f64=300.0;
const TAP_MAX_MOVEMENT:f64=10.0;
const TAP_MAX_DURATION:f64=450.0;
const HOLD_DURATION:f64=500.0;
const INTERACTIVE:&str="a,button,input,select,textarea,[contenteditable=true]";
const TEXT_LAYERS:&str=".pdf-text-layer,.pdf-reflow-page";

fn tap_zone_name(x:f64,width:f64)->&'static str{
 if width<=0.0{return "center";}
 let fraction=x/width;
 if fraction<=EDGE_ZONE_FRACTION{return "prev";}
 if fraction>=1.0-EDGE_ZONE_FRACTION{return "next";}
 "center"
}
fn swipe_name(dx:f64,dy:f64,duration_ms:f64,velocity_x:f64)->Option<&'static str>{
 if dy.abs()>dx.abs(){return None;}
 // A deliberate short flick responds without treating tap jitter as navigation.
 let flick=dx.abs()>=22.0&&velocity_x.abs()>=0.45&&jsign(dx)==jsign(velocity_x);
 if !flick&&(duration_ms>SWIPE_MAX_DURATION||dx.abs()<SWIPE_MIN_DISTANCE){return None;}
 Some(if dx<0.0{"next"}else{"prev"})
}
#[wasm_bindgen]
pub fn classify_tap_zone(x:f64,width:f64)->String{tap_zone_name(x,width).to_owned()}
#[wasm_bindgen]
pub fn classify_swipe(dx:f64,dy:f64,duration_ms:f64,velocity_x:f64)->Option<String>{swipe_name(dx,dy,duration_ms,velocity_x).map(str::to_owned)}

#[derive(Clone)]
struct Gesture{serial:u64,id:f64,x:f64,y:f64,t:f64,last_x:f64,last_t:f64,velocity:f64,moved:f64,axis:u8,pointer_type:JsValue,selecting:bool,scroll_left:f64,scroll_top:f64,reported_pan:bool}
struct Motion{surface:JsValue,transform:JsValue,will_change:JsValue,offset:f64,settling:bool,start:f64,velocity:f64,started:f64}
struct NativeTouch{x:f64,y:f64,notified:bool}
const AXIS_SWIPE:u8=1;
const AXIS_SCROLL:u8=2;
struct State{
 points:Vec<f64>,gesture:Option<Gesture>,blocked:bool,detached:bool,native_touch:Option<NativeTouch>,
 tap_timer:JsValue,tap_key:u64,last_tap:Option<(f64,f64,f64)>,frame:JsValue,frame_key:u64,motion:Option<Motion>,
 hold_timer:JsValue,hold_key:u64,selection_style:Option<(JsValue,JsValue)>,held:bool,serial:u64,
}
struct Nav{
 el:JsValue,doc:JsValue,view:JsValue,
 on_next:JsValue,on_prev:JsValue,on_toggle_zoom:JsValue,on_toggle_chrome:JsValue,can_swipe:Option<JsValue>,native_touch_swipes:JsValue,
 on_native_swipe:JsValue,get_motion_surface:JsValue,tap_zone:JsValue,can_long_press:Option<JsValue>,on_long_press:JsValue,on_manual_pan:JsValue,
 state:RefCell<State>,listeners:RefCell<Vec<Listener>>,me:RefCell<Weak<Nav>>,
}
fn same_point(a:f64,b:f64)->bool{a==b||(a.is_nan()&&b.is_nan())}
fn timestamp(event:&JsValue)->Result<f64,JsValue>{let stamp=read(event,"timeStamp")?;if finite(&stamp){Ok(num(&stamp))}else{clock()}}
fn pointer_id(event:&JsValue)->Result<f64,JsValue>{let id=read(event,"pointerId")?;Ok(if absent(&id){0.0}else{num(&id)})}
fn zero()->JsValue{JsValue::from_f64(0.0)}

impl Nav{
 fn me(&self)->Rc<Nav>{self.me.borrow().upgrade().expect("Gesture controller is alive while it runs")}
 fn interactive(&self,target:&JsValue)->Result<bool,JsValue>{Ok(method_opt(target,"closest",&[&JsValue::from_str(INTERACTIVE)])?.is_some_and(|found|truthy(&found)))}
 fn selected(&self)->Result<bool,JsValue>{
  let Some(selection)=method_opt(&self.doc,"getSelection",&[])?else{return Ok(false)};
  if absent(&selection){return Ok(false);}
  Ok(truthy(&method(&selection,"toString",&[])?))
 }
 fn reduced_motion(&self)->Result<bool,JsValue>{
  Ok(match method_opt(&self.view,"matchMedia",&[&JsValue::from_str("(prefers-reduced-motion: reduce)")])?{Some(list)=>truthy(&read(&list,"matches")?),None=>false})
 }
 fn can_swipe(&self)->Result<bool,JsValue>{match &self.can_swipe{None=>Ok(true),Some(function)=>Ok(truthy(&call(function,"canSwipe",&[])?))}}
 fn style(&self)->Result<JsValue,JsValue>{read(&self.el,"style")}
 
 // ---- timers ----
 fn clear_tap(&self)->Result<(),JsValue>{
  let (timer,key)={let state=self.state.borrow();(state.tap_timer.clone(),state.tap_key)};
  clear_timeout(&timer)?;
  {let mut state=self.state.borrow_mut();state.tap_timer=zero();state.tap_key=0;state.last_tap=None;}
  release(key);Ok(())
 }
 fn clear_hold(&self)->Result<(),JsValue>{
  let (timer,key)={let state=self.state.borrow();(state.hold_timer.clone(),state.hold_key)};
  clear_timeout(&timer)?;
  {let mut state=self.state.borrow_mut();state.hold_timer=zero();state.hold_key=0;}
  release(key);Ok(())
 }
 fn restore_selection(&self)->Result<(),JsValue>{
  let saved=self.state.borrow_mut().selection_style.take();
  if let Some((user_select,webkit))=saved{
   set(&self.style()?,"userSelect",&user_select)?;
   set(&self.style()?,"webkitUserSelect",&webkit)?;
  }
  Ok(())
 }

 // ---- page spring ----
 fn restore_surface(&self)->Result<(),JsValue>{
  let saved=self.state.borrow().motion.as_ref().map(|motion|(motion.surface.clone(),motion.transform.clone(),motion.will_change.clone()));
  if let Some((surface,transform,will_change))=saved{
   set(&read(&surface,"style")?,"transform",&transform)?;
   set(&read(&surface,"style")?,"willChange",&will_change)?;
   self.state.borrow_mut().motion=None;
  }
  Ok(())
 }
 fn stop_motion(&self)->Result<(),JsValue>{
  let (frame,key)={let state=self.state.borrow();(state.frame.clone(),state.frame_key)};
  if truthy(&frame){cancel_frame(&frame)?;}
  {let mut state=self.state.borrow_mut();state.frame=zero();state.frame_key=0;}
  release(key);
  self.restore_surface()
 }
 fn schedule_motion(&self)->Result<(),JsValue>{
  if truthy(&self.state.borrow().frame){return Ok(());}
  let key=next_key();let weak=Rc::downgrade(&self.me());
  let callback=Closure::wrap(Box::new(move|stamp:JsValue|{
   release(key);if let Some(nav)=weak.upgrade(){if let Err(error)=nav.draw_motion(num(&stamp)){wasm_bindgen::throw_val(error)}}
  })as Box<dyn FnMut(JsValue)>);
  let function=adopt(key,callback);
  let frame=request_frame(&function)?;
  let mut state=self.state.borrow_mut();state.frame=frame;state.frame_key=key;Ok(())
 }
 fn draw_motion(&self,stamp:f64)->Result<(),JsValue>{
  {let mut state=self.state.borrow_mut();state.frame=zero();state.frame_key=0;}
  if self.state.borrow().detached||self.state.borrow().motion.is_none(){return Ok(());}
  let settling=self.state.borrow().motion.as_ref().is_some_and(|motion|motion.settling);
  if settling{
   // Exact critically damped spring: independent of 60/90/120 Hz displays.
   let (started,velocity0,start)={let state=self.state.borrow();let motion=state.motion.as_ref().expect("motion exists");(motion.started,motion.velocity,motion.start)};
   let seconds=jmax(0.0,(stamp-started)/1000.0);
   let decay=exp(-18.0*seconds);
   let b=velocity0+18.0*start;
   let offset=(start+b*seconds)*decay;
   let velocity=(velocity0-18.0*b*seconds)*decay;
   self.state.borrow_mut().motion.as_mut().expect("motion exists").offset=offset;
   if offset.abs()<0.15&&velocity.abs()<3.0{return self.restore_surface();}
  }
  let (surface,offset,transform)={let state=self.state.borrow();let motion=state.motion.as_ref().expect("motion exists");(motion.surface.clone(),motion.offset,motion.transform.clone())};
  let value=trimmed(&format!("translate3d({}px,0,0) {}",fixed2(offset)?,js_text(&transform)));
  set(&read(&surface,"style")?,"transform",&JsValue::from_str(&value))?;
  if self.state.borrow().motion.as_ref().is_some_and(|motion|motion.settling){self.schedule_motion()?;}
  Ok(())
 }
 fn drag_surface(&self,dx:f64)->Result<(),JsValue>{
  let surface=if absent(&self.get_motion_surface){JsValue::UNDEFINED}else{call(&self.get_motion_surface,"getMotionSurface",&[])?};
  if !truthy(&surface)||self.reduced_motion()?{return Ok(());}
  let replace=self.state.borrow().motion.as_ref().is_none_or(|motion|motion.surface!=surface);
  if replace{
   self.stop_motion()?;
   let style=read(&surface,"style")?;
   let motion=Motion{surface:surface.clone(),transform:read(&style,"transform")?,will_change:read(&read(&surface,"style")?,"willChange")?,offset:0.0,settling:false,start:0.0,velocity:0.0,started:0.0};
   self.state.borrow_mut().motion=Some(motion);
   set(&read(&surface,"style")?,"willChange",&JsValue::from_str("transform"))?;
  }
  let width=num(&read(&method(&self.el,"getBoundingClientRect",&[])?,"width")?);
  let limit=jmax(36.0,width*0.22);
  let offset=jsign(dx)*limit*(1.0-exp(-dx.abs()/limit));
  if let Some(motion)=self.state.borrow_mut().motion.as_mut(){motion.offset=offset;}
  self.schedule_motion()
 }
 fn settle_surface(&self,velocity:f64)->Result<(),JsValue>{
  if self.state.borrow().motion.is_none(){return Ok(());}
  if self.reduced_motion()?{return self.stop_motion();}
  let started=clock()?;
  let mut state=self.state.borrow_mut();
  if let Some(motion)=state.motion.as_mut(){
   motion.start=motion.offset;
   motion.velocity=clamp(velocity*1000.0,-900.0,900.0);
   motion.started=started;
   motion.settling=true;
  }
  drop(state);
  self.schedule_motion()
 }
 fn release_capture(&self,id:f64)->Result<(),JsValue>{
  let id=JsValue::from_f64(id);
  let result=(||->Result<(),JsValue>{
   if let Some(has)=method_opt(&self.el,"hasPointerCapture",&[&id])?{if truthy(&has){method(&self.el,"releasePointerCapture",&[&id])?;}}
   Ok(())
  })();
  let _=result;Ok(())
 }
 fn abandon(&self)->Result<(),JsValue>{
  self.clear_hold()?;self.restore_selection()?;self.state.borrow_mut().held=false;
  let id=self.state.borrow().gesture.as_ref().map(|gesture|gesture.id);
  if let Some(id)=id{self.release_capture(id)?;}
  self.state.borrow_mut().gesture=None;
  self.clear_tap()?;
  self.settle_surface(0.0)
 }
 fn navigate(&self,zone:&JsValue,event:&JsValue)->Result<(),JsValue>{
  if text(zone,"prev"){call_opt(&self.on_prev,"onPrev",&[])?;}
  else if text(zone,"next"){call_opt(&self.on_next,"onNext",&[])?;}
  else{call_opt(&self.on_toggle_chrome,"onToggleChrome",&[event])?;}
  Ok(())
 }

 // ---- pointer events ----
 fn pointer_down(&self,event:&JsValue)->Result<(),JsValue>{
  let button=read(event,"button")?;
  if !absent(&button)&&button.as_f64()!=Some(0.0)||self.interactive(&read(event,"target")?)?{return Ok(());}
  let id=pointer_id(event)?;
  let size={let mut state=self.state.borrow_mut();if !state.points.iter().any(|known|same_point(*known,id)){state.points.push(id);}state.points.len()};
  if size>1{self.state.borrow_mut().blocked=true;self.abandon()?;return Ok(());}
  if self.state.borrow().blocked||self.selected()?{return Ok(());}
  self.stop_motion()?;
  let x=num(&read(event,"clientX")?);
  let y=num(&read(event,"clientY")?);
  let t=timestamp(event)?;
  let last_x=num(&read(event,"clientX")?);
  let last_t=timestamp(event)?;
  let pointer_type=read(event,"pointerType")?;
  let mouse=text(&pointer_type,"mouse");
  let selecting=if mouse{
   let root=if absent(&self.doc){JsValue::UNDEFINED}else{read(&self.doc,"documentElement")?};
   (!absent(&root)&&root==self.el)||truthy(&method_opt(&read(event,"target")?,"closest",&[&JsValue::from_str(TEXT_LAYERS)])?.unwrap_or(JsValue::UNDEFINED))
  }else{false};
  let scroll_left=num(&read(&self.el,"scrollLeft")?);
  let scroll_top=num(&read(&self.el,"scrollTop")?);
  let serial={let mut state=self.state.borrow_mut();state.serial+=1;state.serial};
  {
   let mut state=self.state.borrow_mut();
   state.gesture=Some(Gesture{serial,id,x,y,t,last_x,last_t,velocity:0.0,moved:0.0,axis:0,pointer_type,selecting,scroll_left,scroll_top,reported_pan:false});
   state.held=false;
  }
  if truthy(&self.on_long_press)&&match &self.can_long_press{None=>false,Some(function)=>truthy(&call(function,"canLongPress",&[event])?)}{
   let style=self.style()?;
   let saved=(read(&style,"userSelect")?,read(&self.style()?,"webkitUserSelect")?);
   self.state.borrow_mut().selection_style=Some(saved);
   let none=JsValue::from_str("none");
   set(&self.style()?,"webkitUserSelect",&none)?;set(&self.style()?,"userSelect",&none)?;
   let key=next_key();let weak=Rc::downgrade(&self.me());let event=event.clone();
   let callback=Closure::wrap(Box::new(move|_:JsValue|{
    release(key);if let Some(nav)=weak.upgrade(){if let Err(error)=nav.hold_fired(serial,&event){wasm_bindgen::throw_val(error)}}
   })as Box<dyn FnMut(JsValue)>);
   let function=adopt(key,callback);
   let timer=set_timeout(&function,HOLD_DURATION)?;
   let mut state=self.state.borrow_mut();state.hold_timer=timer;state.hold_key=key;
  }
  Ok(())
 }
 fn hold_fired(&self,candidate:u64,event:&JsValue)->Result<(),JsValue>{
  {let mut state=self.state.borrow_mut();state.hold_timer=zero();state.hold_key=0;}
  let (detached,blocked,current)={let state=self.state.borrow();(state.detached,state.blocked,state.gesture.clone())};
  if detached{return Ok(());}
  let Some(gesture)=current.filter(|gesture|gesture.serial==candidate)else{return Ok(())};
  if blocked||gesture.moved>TAP_MAX_MOVEMENT
   ||(num(&read(&self.el,"scrollTop")?)-gesture.scroll_top).abs()>2.0
   ||(num(&read(&self.el,"scrollLeft")?)-gesture.scroll_left).abs()>2.0{return Ok(());}
  self.state.borrow_mut().held=true;
  self.clear_tap()?;self.stop_motion()?;
  call(&self.on_long_press,"onLongPress",&[event])?;Ok(())
 }
 fn pointer_move(&self,event:&JsValue)->Result<(),JsValue>{
  {
   let state=self.state.borrow();
   let Some(gesture)=state.gesture.as_ref()else{return Ok(())};
   if gesture.id!=pointer_id(event)?||state.blocked{return Ok(());}
  }
  let client_x=num(&read(event,"clientX")?);
  let client_y=num(&read(event,"clientY")?);
  let (dx,dy,moved)={
   let mut state=self.state.borrow_mut();let gesture=state.gesture.as_mut().expect("gesture exists");
   let dx=client_x-gesture.x;let dy=client_y-gesture.y;
   gesture.moved=jmax(gesture.moved,hypot(dx,dy));(dx,dy,gesture.moved)
  };
  if moved>TAP_MAX_MOVEMENT{self.clear_tap()?;self.clear_hold()?;self.restore_selection()?;}
  if self.state.borrow().held{return Ok(());}
  let stamp=timestamp(event)?;
  {
   let mut state=self.state.borrow_mut();let gesture=state.gesture.as_mut().ok_or_else(null_gesture)?;
   let dt=stamp-gesture.last_t;
   if dt>0.0{
    let sample=clamp((client_x-gesture.last_x)/dt,-3.0,3.0);
    gesture.velocity+=(sample-gesture.velocity)*(1.0-exp(-dt/45.0));
   }
   gesture.last_x=client_x;gesture.last_t=stamp;
  }
  let (reported,moved)={let state=self.state.borrow();let gesture=state.gesture.as_ref().ok_or_else(null_gesture)?;(gesture.reported_pan,gesture.moved)};
  if !reported&&moved>TAP_MAX_MOVEMENT&&(dy.abs()>dx.abs()||!self.can_swipe()?){
   self.state.borrow_mut().gesture.as_mut().ok_or_else(null_gesture)?.reported_pan=true;
   call_opt(&self.on_manual_pan,"onManualPan",&[])?;
  }
  let (selecting,touch)={let state=self.state.borrow();let gesture=state.gesture.as_ref().ok_or_else(null_gesture)?;(gesture.selecting,text(&gesture.pointer_type,"touch"))};
  if self.selected()?||selecting||!self.can_swipe()?||truthy(&self.native_touch_swipes)&&touch{return Ok(());}
  {
   let mut state=self.state.borrow_mut();let gesture=state.gesture.as_mut().ok_or_else(null_gesture)?;
   if gesture.axis==0&&gesture.moved>TAP_MAX_MOVEMENT{gesture.axis=if dx.abs()>dy.abs()*1.2{AXIS_SWIPE}else{AXIS_SCROLL};}
   if gesture.axis!=AXIS_SWIPE{return Ok(());}
  }
  self.drag_surface(dx)?;
  // Capture only a committed horizontal drag; long presses remain selectable.
  let id=self.state.borrow().gesture.as_ref().ok_or_else(null_gesture)?.id;
  let _=method_opt(&self.el,"setPointerCapture",&[&JsValue::from_f64(id)]);
  if truthy(&read(event,"cancelable")?){method(event,"preventDefault",&[])?;}
  Ok(())
 }
 fn pointer_up(&self,event:&JsValue)->Result<(),JsValue>{
  let id=pointer_id(event)?;
  let blocked={let mut state=self.state.borrow_mut();state.points.retain(|known|!same_point(*known,id));state.blocked};
  if blocked{if self.state.borrow().points.is_empty(){self.state.borrow_mut().blocked=false;}return Ok(());}
  let ended={let state=self.state.borrow();match state.gesture.as_ref(){Some(gesture)if gesture.id==id=>gesture.clone(),_=>return Ok(())}};
  self.state.borrow_mut().gesture=None;
  self.clear_hold()?;self.restore_selection()?;
  self.release_capture(id)?;
  if self.state.borrow().held{
   {let mut state=self.state.borrow_mut();state.held=false;}
   self.clear_tap()?;
   if truthy(&read(event,"cancelable")?){method(event,"preventDefault",&[])?;}
   return Ok(());
  }
  let client_x=num(&read(event,"clientX")?);
  let client_y=num(&read(event,"clientY")?);
  let dx=client_x-ended.x;let dy=client_y-ended.y;
  let duration_ms=timestamp(event)?-ended.t;
  let moved=jmax(ended.moved,hypot(dx,dy));
  let velocity=ended.velocity*exp(-jmax(0.0,timestamp(event)?-ended.last_t)/65.0);
  self.settle_surface(velocity)?;
  if self.interactive(&read(event,"target")?)?||self.selected()?{return self.clear_tap();}
  // The browser owns scrolling; Foliate also already owns touch page swipes.
  let scrolled=(num(&read(&self.el,"scrollLeft")?)-ended.scroll_left).abs()>2.0||(num(&read(&self.el,"scrollTop")?)-ended.scroll_top).abs()>2.0;
  let native_touch=truthy(&self.native_touch_swipes)&&text(&ended.pointer_type,"touch");
  if !scrolled&&!ended.selecting&&self.can_swipe()?&&!native_touch&&ended.axis!=AXIS_SCROLL{
   if let Some(zone)=swipe_name(dx,dy,duration_ms,velocity){self.clear_tap()?;return self.navigate(&JsValue::from_str(zone),&JsValue::UNDEFINED);}
  }
  if moved>TAP_MAX_MOVEMENT||duration_ms>TAP_MAX_DURATION||scrolled{return self.clear_tap();}
  let rect=method(&self.el,"getBoundingClientRect",&[])?;
  let stamp=timestamp(event)?;
  // tapZone lets a caller judge the tap against what the reader actually shows when
  // this element is much larger than the screen (a paginated EPUB section).
  let supplied=call_opt(&self.tap_zone,"tapZone",&[event])?;
  let zone=if absent(&supplied){JsValue::from_str(tap_zone_name(client_x-num(&read(&rect,"left")?),num(&read(&rect,"width")?)))}else{supplied};
  // A page turn on the side edges acts at once. Only the centre waits for a possible
  // second tap (zoom), because that tap would otherwise hide the controls.
  if !truthy(&self.on_toggle_zoom)||!text(&zone,"center"){self.clear_tap()?;return self.navigate(&zone,event);}
  let double=self.state.borrow().last_tap.is_some_and(|(time,x,y)|stamp-time<DOUBLE_TAP_MAX_DELAY&&hypot(client_x-x,client_y-y)<30.0);
  if double{self.clear_tap()?;call(&self.on_toggle_zoom,"onToggleZoom",&[&JsValue::from_f64(client_x),&JsValue::from_f64(client_y)])?;return Ok(());}
  self.clear_tap()?;
  self.state.borrow_mut().last_tap=Some((stamp,client_x,client_y));
  // Wait only when double-tap zoom is supported: its first tap must not hide the
  // toolbar before the second finger tap.
  let key=next_key();let weak=Rc::downgrade(&self.me());let event=event.clone();
  let callback=Closure::wrap(Box::new(move|_:JsValue|{
   release(key);if let Some(nav)=weak.upgrade(){if let Err(error)=nav.tap_fired(&zone,&event){wasm_bindgen::throw_val(error)}}
  })as Box<dyn FnMut(JsValue)>);
  let function=adopt(key,callback);
  let timer=set_timeout(&function,DOUBLE_TAP_MAX_DELAY)?;
  let mut state=self.state.borrow_mut();state.tap_timer=timer;state.tap_key=key;
  Ok(())
 }
 fn tap_fired(&self,zone:&JsValue,event:&JsValue)->Result<(),JsValue>{
  {let mut state=self.state.borrow_mut();state.tap_timer=zero();state.tap_key=0;state.last_tap=None;}
  if !self.state.borrow().detached&&!self.selected()?{self.navigate(zone,event)?;}
  Ok(())
 }
 fn cancelled(&self,event:&JsValue)->Result<(),JsValue>{
  // Touch browsers release implicit capture from the tapped child after every pointerup.
  // Only an interrupted capture owned by this drag cancels the gesture; ordinary
  // releases must preserve a pending double tap.
  if text(&read(event,"type")?,"lostpointercapture"){
   let owned=match self.state.borrow().gesture.as_ref(){None=>false,Some(gesture)=>gesture.id==pointer_id(event)?};
   if !owned||read(event,"target")?!=self.el{return Ok(());}
  }
  let id=pointer_id(event)?;
  self.state.borrow_mut().points.retain(|known|!same_point(*known,id));
  self.abandon()?;
  if self.state.borrow().points.is_empty(){self.state.borrow_mut().blocked=false;}
  Ok(())
 }
 fn blur(&self)->Result<(),JsValue>{
  {let mut state=self.state.borrow_mut();state.points.clear();state.blocked=false;}
  self.abandon()?;self.stop_motion()
 }
 fn visibility(&self)->Result<(),JsValue>{if truthy(&read(&self.doc,"hidden")?){self.blur()?;}Ok(())}
 fn context_menu(&self,event:&JsValue)->Result<(),JsValue>{
  let engaged={let state=self.state.borrow();state.selection_style.is_some()||state.held};
  if engaged{method(event,"preventDefault",&[])?;method(event,"stopPropagation",&[])?;}
  Ok(())
 }

 // ---- native touch ----
 // A browser may cancel PointerEvents while Foliate's native TouchEvents continue.
 // Observe the committed native drag once to stop narration; leave scrolling,
 // velocity and page navigation entirely with the paginator.
 fn touch_start(&self,event:&JsValue)->Result<(),JsValue>{
  let touches=read(event,"touches")?;
  let first=if absent(&touches){JsValue::UNDEFINED}else{get_at(&touches,0)};
  let single=!absent(&touches)&&num(&read(&touches,"length")?)==1.0;
  let started=single&&!self.interactive(&read(event,"target")?)?&&!self.selected()?;
  self.state.borrow_mut().native_touch=if started{Some(NativeTouch{x:num(&read(&first,"clientX")?),y:num(&read(&first,"clientY")?),notified:false})}else{None};
  Ok(())
 }
 fn touch_move(&self,event:&JsValue)->Result<(),JsValue>{
  let touches=read(event,"touches")?;
  let single=!absent(&touches)&&num(&read(&touches,"length")?)==1.0;
  if !single{self.state.borrow_mut().native_touch=None;return Ok(());}
  {let state=self.state.borrow();match state.native_touch.as_ref(){None=>return Ok(()),Some(touch)if touch.notified=>return Ok(()),_=>{}}}
  if !self.can_swipe()?||self.selected()?{return Ok(());}
  let touch=get_at(&touches,0);
  let (dx,dy)={let state=self.state.borrow();let origin=state.native_touch.as_ref().ok_or_else(null_gesture)?;(num(&read(&touch,"clientX")?)-origin.x,num(&read(&touch,"clientY")?)-origin.y)};
  if hypot(dx,dy)<22.0{return Ok(());}
  if let Some(origin)=self.state.borrow_mut().native_touch.as_mut(){origin.notified=true;}
  call_opt(&self.on_native_swipe,"onNativeSwipe",&[])?;Ok(())
 }
 fn touch_end(&self,event:&JsValue)->Result<(),JsValue>{
  let touches=read(event,"touches")?;
  let length=if absent(&touches){JsValue::UNDEFINED}else{read(&touches,"length")?};
  if !truthy(&length){self.state.borrow_mut().native_touch=None;}Ok(())
 }
 fn detach(&self)->Result<(),JsValue>{
  self.state.borrow_mut().detached=true;
  self.blur()?;
  let listeners=std::mem::take(&mut *self.listeners.borrow_mut());
  drop(listeners);Ok(())
 }
}
fn null_gesture()->JsValue{js_sys::TypeError::new("Cannot read properties of null").into()}
fn js_text(value:&JsValue)->String{crate::js_string(value)}

#[wasm_bindgen]
pub struct RustSwipeNavigation{nav:Rc<Nav>}
#[wasm_bindgen]
impl RustSwipeNavigation{
 #[wasm_bindgen(constructor)]
 pub fn new(el:JsValue,options:JsValue)->Result<RustSwipeNavigation,JsValue>{
  let options=if options.is_undefined(){js_sys::Object::new().into()}else{options};
  if options.is_null(){return Err(js_sys::TypeError::new("Cannot destructure 'undefined' or 'null'").into());}
  let on_next=read(&options,"onNext")?;let on_prev=read(&options,"onPrev")?;let on_toggle_zoom=read(&options,"onToggleZoom")?;let on_toggle_chrome=read(&options,"onToggleChrome")?;
  let can_swipe=read(&options,"canSwipe")?;
  let native_touch_swipes=read(&options,"nativeTouchSwipes")?;
  let on_native_swipe=read(&options,"onNativeSwipe")?;let get_motion_surface=read(&options,"getMotionSurface")?;let tap_zone=read(&options,"tapZone")?;
  let can_long_press=read(&options,"canLongPress")?;
  let on_long_press=read(&options,"onLongPress")?;let on_manual_pan=read(&options,"onManualPan")?;
  let doc=read(&el,"ownerDocument")?;
  let default_view=if absent(&doc){JsValue::UNDEFINED}else{read(&doc,"defaultView")?};
  let view=if truthy(&default_view){default_view}else{get(&global(),"window")};
  let nav=Rc::new(Nav{el:el.clone(),doc:doc.clone(),view:view.clone(),on_next,on_prev,on_toggle_zoom,on_toggle_chrome,
   can_swipe:if can_swipe.is_undefined(){None}else{Some(can_swipe)},native_touch_swipes:native_touch_swipes.clone(),on_native_swipe:on_native_swipe.clone(),
   get_motion_surface,tap_zone,can_long_press:if can_long_press.is_undefined(){None}else{Some(can_long_press)},on_long_press,on_manual_pan,
   state:RefCell::new(State{points:Vec::new(),gesture:None,blocked:false,detached:false,native_touch:None,tap_timer:zero(),tap_key:0,last_tap:None,frame:zero(),frame_key:0,
    motion:None,hold_timer:zero(),hold_key:0,selection_style:None,held:false,serial:0}),
   listeners:RefCell::new(Vec::new()),me:RefCell::new(Weak::new())});
  *nav.me.borrow_mut()=Rc::downgrade(&nav);
  let add=|target:&JsValue,kind:&'static str,passive:Option<bool>,handler:Box<dyn Fn(&Nav,&JsValue)->Result<(),JsValue>>|->Result<(),JsValue>{
   let weak=Rc::downgrade(&nav);
   let listener=listen(target,kind,passive,false,move|event|match weak.upgrade(){Some(nav)=>handler(&nav,&event),None=>Ok(())})?;
   nav.listeners.borrow_mut().push(listener);Ok(())
  };
  add(&el,"pointerdown",None,Box::new(|nav,event|nav.pointer_down(event)))?;
  add(&el,"contextmenu",None,Box::new(|nav,event|nav.context_menu(event)))?;
  add(&el,"pointermove",Some(false),Box::new(|nav,event|nav.pointer_move(event)))?;
  add(&el,"pointerup",None,Box::new(|nav,event|nav.pointer_up(event)))?;
  add(&el,"pointercancel",None,Box::new(|nav,event|nav.cancelled(event)))?;
  add(&el,"lostpointercapture",None,Box::new(|nav,event|nav.cancelled(event)))?;
  add(&view,"blur",None,Box::new(|nav,_|nav.blur()))?;
  if !absent(&doc){add(&doc,"visibilitychange",None,Box::new(|nav,_|nav.visibility()))?;}
  if truthy(&native_touch_swipes)&&truthy(&on_native_swipe){
   add(&el,"touchstart",Some(true),Box::new(|nav,event|nav.touch_start(event)))?;
   add(&el,"touchmove",Some(true),Box::new(|nav,event|nav.touch_move(event)))?;
   add(&el,"touchend",None,Box::new(|nav,event|nav.touch_end(event)))?;
   add(&el,"touchcancel",None,Box::new(|nav,event|nav.touch_end(event)))?;
  }
  Ok(RustSwipeNavigation{nav})
 }
 /// Cancels pending taps, holds and animation frames and removes every listener.
 pub fn detach(&self)->Result<(),JsValue>{self.nav.detach()}
}
