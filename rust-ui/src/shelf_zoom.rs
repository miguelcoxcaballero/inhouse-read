//! Touch inspection of the shelf: two-finger zoom, one-finger pan while zoomed, edge
//! resistance and frame-rate independent coasting. Sampled once per display frame; book
//! holds stay native. The scene, the class on the root and every callback stay host-side.
use std::{cell::RefCell,rc::{Rc,Weak}};
use wasm_bindgen::prelude::*;
use js_sys::Object;
use crate::host::*;

const ZOOM_CLASS:&str="is-shelf-zoomed";
const EXCLUDED:&str=".ihr-view-switch";
const CATALOG:&str=".ihr-shelf-catalog";

fn resist(value:f64,limit:f64)->f64{
 let over=jmax(0.0,value.abs()-limit);
 if over!=0.0&&!over.is_nan(){jsign(value)*(limit+48.0*(1.0-exp(-over/48.0)))}else{value}
}
/// One axis of the coast: a critically damped spring at the edge, exponential glide inside.
fn axis(position:f64,velocity:f64,limit:f64,dt:f64)->(f64,f64){
 let bound=clamp(position,-limit,limit);let offset=position-bound;
 let truthy_number=|value:f64|value!=0.0&&!value.is_nan();
 if truthy_number(offset)||(position>=limit&&velocity>0.0)||(position<=-limit&&velocity<0.0){
  // Exact critically damped spring: no frame-rate-dependent edge bounce.
  let omega=0.018;let decay=exp(-omega*dt);let impulse=velocity+omega*offset;
  return (bound+(offset+impulse*dt)*decay,(velocity-omega*impulse*dt)*decay);
 }
 let decay=exp(-dt/180.0);
 let next=position+velocity*180.0*(1.0-decay);
 if next.abs()>limit&&truthy_number(velocity){
  let edge=jsign(velocity)*limit;
  let hit=-180.0*js_sys::Math::log(1.0-(edge-position)/(velocity*180.0));
  return axis(edge,velocity*exp(-hit/180.0),limit,jmax(0.0,dt-hit));
 }
 (next,velocity*decay)
}

#[derive(Clone,Copy)]
struct Origin{zoom:f64,pan_x:f64,pan_y:f64}
struct Gesture{pinch:bool,x:f64,y:f64,distance:f64,origin:Origin,last_time:f64,sample_time:f64,current_x:f64,current_y:f64,sample_x:f64,sample_y:f64,sample_dirty:bool,vx:f64,vy:f64}
struct State{
 points:Vec<(f64,f64,f64)>,gesture:Option<Gesture>,target:JsValue,frame:JsValue,frame_key:u64,coast:Option<(f64,f64)>,last_frame:f64,
 suppress_click:bool,click_timer:JsValue,click_key:u64,destroyed:bool,
}
struct Zoom{
 root:JsValue,scroller:JsValue,get_scene:JsValue,is_enabled:JsValue,on_gesture_start:JsValue,reduced:JsValue,
 state:RefCell<State>,listeners:RefCell<Vec<Listener>>,me:RefCell<Weak<Zoom>>,
}
fn same_point(a:f64,b:f64)->bool{a==b||(a.is_nan()&&b.is_nan())}
fn zero()->JsValue{JsValue::from_f64(0.0)}

impl Zoom{
 fn me(&self)->Rc<Zoom>{self.me.borrow().upgrade().expect("Shelf zoom is alive while it runs")}
 fn enabled(&self)->Result<JsValue,JsValue>{call(&self.is_enabled,"isEnabled",&[])}
 fn scene(&self)->Result<JsValue,JsValue>{call(&self.get_scene,"getScene",&[])}
 fn excluded(&self,target:&JsValue)->Result<bool,JsValue>{Ok(truthy(&method(target,"closest",&[&JsValue::from_str(EXCLUDED)])?))}
 fn consume(&self,event:&JsValue)->Result<(),JsValue>{method(event,"preventDefault",&[])?;method(event,"stopPropagation",&[])?;Ok(())}
 fn toggle_class(&self,force:&JsValue)->Result<(),JsValue>{
  let list=read(&self.root,"classList")?;
  method(&list,"toggle",&[&JsValue::from_str(ZOOM_CLASS),force])?;Ok(())
 }
 fn midpoint(&self)->(f64,f64,f64){
  let state=self.state.borrow();let (_,ax,ay)=state.points[0];let (_,bx,by)=state.points[1];
  ((ax+bx)/2.0,(ay+by)/2.0,jmax(1.0,hypot(ax-bx,ay-by)))
 }
 fn limits(&self,zoom:f64)->Result<(f64,f64),JsValue>{
  let target=self.state.borrow().target.clone();
  Ok(((zoom-1.0)*num(&read(&target,"width")?)/2.0,(zoom-1.0)*num(&read(&target,"height")?)/2.0))
 }
 fn snapshot(&self)->Result<Origin,JsValue>{
  let target=self.state.borrow().target.clone();
  // The original spread the whole view; only these three numbers are read back.
  Ok(Origin{zoom:num(&get(&target,"zoom")),pan_x:num(&get(&target,"panX")),pan_y:num(&get(&target,"panY"))})
 }
 fn copy_view(&self,zoom:f64,pan_x:f64,pan_y:f64)->Result<JsValue,JsValue>{
  let target=self.state.borrow().target.clone();
  let next=Object::assign(&Object::new(),&Object::from(target));
  let next:JsValue=next.into();
  set(&next,"zoom",&JsValue::from_f64(zoom))?;set(&next,"panX",&JsValue::from_f64(pan_x))?;set(&next,"panY",&JsValue::from_f64(pan_y))?;
  Ok(next)
 }

 fn publish(&self,moving:bool)->Result<(),JsValue>{
  let target=self.state.borrow().target.clone();
  if !truthy(&target)||!truthy(&self.scene()?){return Ok(());}
  let options=Object::new();let options:JsValue=options.into();
  set(&options,"moving",&JsValue::from_bool(moving))?;set(&options,"renderNow",&JsValue::TRUE)?;
  let next=method(&self.scene()?,"setInspectionView",&[&target,&options])?;
  self.state.borrow_mut().target=next.clone();
  let force=if num(&read(&next,"zoom")?)>1.001{self.enabled()?}else{JsValue::FALSE};
  self.toggle_class(&force)
 }
 fn sample_velocity(&self){
  let mut state=self.state.borrow_mut();
  let Some(gesture)=state.gesture.as_mut()else{return};
  if !gesture.sample_dirty{return;}
  // Sample the final midpoint once per frame, after both fingers' events. Individual
  // pointer events otherwise create false velocity in a pinch.
  let elapsed=jmax(1.0,gesture.last_time-gesture.sample_time);let blend=1.0-exp(-elapsed/40.0);
  gesture.vx+=(clamp((gesture.current_x-gesture.sample_x)/elapsed,-2.4,2.4)-gesture.vx)*blend;
  gesture.vy+=(clamp((gesture.current_y-gesture.sample_y)/elapsed,-2.4,2.4)-gesture.vy)*blend;
  gesture.sample_x=gesture.current_x;gesture.sample_y=gesture.current_y;
  gesture.sample_time=gesture.last_time;gesture.sample_dirty=false;
 }
 fn tick(&self,now:f64)->Result<(),JsValue>{
  {let mut state=self.state.borrow_mut();state.frame=zero();state.frame_key=0;}
  if self.state.borrow().destroyed||!truthy(&self.enabled()?){return self.stop();}
  self.sample_velocity();
  let coast=self.state.borrow().coast;
  if let Some((cx,cy))=coast{
   let dt=jmax(0.0,now-self.state.borrow().last_frame);
   let zoom=num(&read(&self.state.borrow().target.clone(),"zoom")?);
   let (limit_x,limit_y)=self.limits(zoom)?;
   let target=self.state.borrow().target.clone();
   let (pan_x,vx)=axis(num(&read(&target,"panX")?),cx,limit_x,dt);
   set(&target,"panX",&JsValue::from_f64(pan_x))?;
   let (pan_y,vy)=axis(num(&read(&target,"panY")?),cy,limit_y,dt);
   set(&target,"panY",&JsValue::from_f64(pan_y))?;
   {let mut state=self.state.borrow_mut();state.coast=Some((vx,vy));state.last_frame=now;}
   let pan_x=num(&read(&target,"panX")?);let pan_y=num(&read(&target,"panY")?);
   if hypot(vx,vy)<0.015&&(pan_x-clamp(pan_x,-limit_x,limit_x)).abs()<0.35&&(pan_y-clamp(pan_y,-limit_y,limit_y)).abs()<0.35{
    set(&target,"panX",&JsValue::from_f64(clamp(num(&read(&target,"panX")?),-limit_x,limit_x)))?;
    set(&target,"panY",&JsValue::from_f64(clamp(num(&read(&target,"panY")?),-limit_y,limit_y)))?;
    self.state.borrow_mut().coast=None;
    self.publish(false)?;return Ok(());
   }
  }
  let active={let state=self.state.borrow();state.gesture.is_some()||state.coast.is_some()};
  self.publish(active)?;
  if self.state.borrow().coast.is_some(){self.schedule()?;}
  Ok(())
 }
 fn schedule(&self)->Result<(),JsValue>{
  {let state=self.state.borrow();if truthy(&state.frame)||state.destroyed{return Ok(());}}
  let key=next_key();let weak=Rc::downgrade(&self.me());
  let callback=Closure::wrap(Box::new(move|now:JsValue|{
   release(key);
   if let Some(zoom)=weak.upgrade(){if let Err(error)=zoom.tick(num(&now)){wasm_bindgen::throw_val(error)}}
  })as Box<dyn FnMut(JsValue)>);
  let function=adopt(key,callback);
  let frame=request_frame(&function)?;
  let mut state=self.state.borrow_mut();state.frame=frame;state.frame_key=key;Ok(())
 }
 fn stop(&self)->Result<(),JsValue>{
  let (frame,key,moving)={let state=self.state.borrow();(state.frame.clone(),state.frame_key,truthy(&state.frame)||state.coast.is_some()||state.gesture.is_some())};
  cancel_frame(&frame)?;
  {let mut state=self.state.borrow_mut();state.frame=zero();state.frame_key=0;state.coast=None;state.gesture=None;}
  release(key);
  let has_target=truthy(&self.state.borrow().target);
  if has_target&&moving{self.publish(false)?;}
  self.state.borrow_mut().target=JsValue::NULL;Ok(())
 }
 fn release_captures(&self){
  let ids:Vec<f64>=self.state.borrow().points.iter().map(|point|point.0).collect();
  for id in ids{let _=method(&self.scroller,"releasePointerCapture",&[&JsValue::from_f64(id)]);}
 }
 pub fn sync(&self)->Result<(),JsValue>{
  if !truthy(&self.enabled()?){
   self.stop()?;
   self.release_captures();
   let (key,timer)={let mut state=self.state.borrow_mut();state.points.clear();state.suppress_click=false;(state.click_key,state.click_timer.clone())};
   clear_timeout(&timer)?;release(key);self.state.borrow_mut().click_key=0;
  }
  let enabled=self.enabled()?;
  let force=if truthy(&enabled){
   let scene=self.scene()?;
   let zoom=method_opt(&scene,"getInspectionZoom",&[])?;
   let zoom=match zoom{Some(zoom)if truthy(&zoom)=>num(&zoom),_=>1.0};
   JsValue::from_bool(zoom>1.001)
  }else{enabled};
  self.toggle_class(&force)
 }
 fn begin(&self,pinch:bool,x:f64,y:f64,distance:f64,time:f64)->Result<(),JsValue>{
  self.state.borrow_mut().coast=None;
  call(&self.on_gesture_start,"onGestureStart",&[])?;
  if !truthy(&self.state.borrow().target){
   let view=method(&self.scene()?,"getInspectionView",&[])?;
   self.state.borrow_mut().target=view;
  }
  let origin=self.snapshot()?;
  self.state.borrow_mut().gesture=Some(Gesture{pinch,x,y,distance,origin,last_time:time,sample_time:time,current_x:x,current_y:y,sample_x:x,sample_y:y,sample_dirty:false,vx:0.0,vy:0.0});
  let ids:Vec<f64>=self.state.borrow().points.iter().map(|point|point.0).collect();
  for id in ids{let _=method(&self.scroller,"setPointerCapture",&[&JsValue::from_f64(id)]);}
  Ok(())
 }
 fn start(&self,event:&JsValue)->Result<(),JsValue>{
  if !text(&read(event,"pointerType")?,"touch")||!truthy(&self.enabled()?)||self.excluded(&read(event,"target")?)?{return Ok(());}
  if self.state.borrow().points.is_empty(){
   self.stop()?;
   let (key,timer)={let mut state=self.state.borrow_mut();state.suppress_click=false;(state.click_key,state.click_timer.clone())};
   clear_timeout(&timer)?;release(key);self.state.borrow_mut().click_key=0;
  }
  let id=num(&read(event,"pointerId")?);
  let x=num(&read(event,"clientX")?);let y=num(&read(event,"clientY")?);
  let size={let mut state=self.state.borrow_mut();
   match state.points.iter_mut().find(|point|same_point(point.0,id)){Some(point)=>{point.1=x;point.2=y;}None=>state.points.push((id,x,y))}
   state.points.len()};
  let stamp=num(&read(event,"timeStamp")?);
  if size==2{
   let (mx,my,distance)=self.midpoint();
   self.begin(true,mx,my,distance,stamp)?;
   self.state.borrow_mut().suppress_click=true;
   self.consume(event)?;
  }else if size==1&&num(&method(&self.scene()?,"getInspectionZoom",&[])?)>1.001
   &&!truthy(&method(&read(event,"target")?,"closest",&[&JsValue::from_str(CATALOG)])?)
   &&!truthy(&method(&self.scene()?,"getObjectAtPoint",&[&read(event,"clientX")?,&read(event,"clientY")?])?){
   let (px,py)={let state=self.state.borrow();let point=state.points.iter().find(|point|same_point(point.0,id)).expect("point was just stored");(point.1,point.2)};
   self.begin(false,px,py,f64::NAN,stamp)?;
   self.consume(event)?;
  }
  Ok(())
 }
 fn tracked(&self,id:f64)->bool{self.state.borrow().points.iter().any(|point|same_point(point.0,id))}
 fn motion(&self,event:&JsValue)->Result<(),JsValue>{
  let id=num(&read(event,"pointerId")?);
  if !self.tracked(id){return Ok(());}
  let x=num(&read(event,"clientX")?);let y=num(&read(event,"clientY")?);
  {let mut state=self.state.borrow_mut();if let Some(point)=state.points.iter_mut().find(|point|same_point(point.0,id)){point.1=x;point.2=y;}}
  if self.state.borrow().gesture.is_none()||!truthy(&self.enabled()?){return Ok(());}
  let (pinch,gx,gy,gdistance,origin)={let state=self.state.borrow();let gesture=state.gesture.as_ref().ok_or_else(null_gesture)?;(gesture.pinch,gesture.x,gesture.y,gesture.distance,gesture.origin)};
  let (nx,ny,ndistance)=if pinch&&self.state.borrow().points.len()>=2{self.midpoint()}else{(x,y,f64::NAN)};
  let zoom=if pinch{clamp(origin.zoom*ndistance/gdistance,1.0,4.0)}else{origin.zoom};
  let ratio=zoom/origin.zoom;
  let (limit_x,limit_y)=self.limits(zoom)?;
  let target=self.state.borrow().target.clone();
  let pan_x=resist(origin.pan_x*ratio+(1.0-ratio)*(gx-num(&read(&target,"centerX")?))+nx-gx,limit_x);
  let pan_y=resist(origin.pan_y*ratio+(1.0-ratio)*(gy-num(&read(&target,"centerY")?))+ny-gy,limit_y);
  let next=self.copy_view(zoom,pan_x,pan_y)?;
  {
   let mut state=self.state.borrow_mut();state.target=next;
   let gesture=state.gesture.as_mut().ok_or_else(null_gesture)?;
   gesture.current_x=nx;gesture.current_y=ny;gesture.last_time=num(&read(event,"timeStamp")?);gesture.sample_dirty=true;
  }
  if hypot(nx-gx,ny-gy)>3.0{self.state.borrow_mut().suppress_click=true;}
  self.schedule()?;self.consume(event)
 }
 fn finish(&self,event:&JsValue)->Result<(),JsValue>{
  let id=num(&read(event,"pointerId")?);
  if !self.tracked(id){return Ok(());}
  self.state.borrow_mut().points.retain(|point|!same_point(point.0,id));
  let idv=JsValue::from_f64(id);
  let _=(||->Result<(),JsValue>{if truthy(&method(&self.scroller,"hasPointerCapture",&[&idv])?){method(&self.scroller,"releasePointerCapture",&[&idv])?;}Ok(())})();
  if self.state.borrow().gesture.is_some(){
   self.sample_velocity();self.consume(event)?;
   let stamp=num(&read(event,"timeStamp")?);
   let cancelled=text(&read(event,"type")?,"pointercancel");
   let size=self.state.borrow().points.len();
   if size>=2{
    let (mx,my,distance)=self.midpoint();
    self.begin(true,mx,my,distance,stamp)?;
   }else if size==1&&!cancelled{
    let (px,py)={let state=self.state.borrow();(state.points[0].1,state.points[0].2)};
    let origin=self.snapshot()?;
    let mut state=self.state.borrow_mut();
    let (vx,vy)=state.gesture.as_ref().map(|gesture|(gesture.vx,gesture.vy)).ok_or_else(null_gesture)?;
    state.gesture=Some(Gesture{pinch:false,x:px,y:py,distance:f64::NAN,origin,last_time:stamp,sample_time:stamp,current_x:px,current_y:py,sample_x:px,sample_y:py,sample_dirty:false,vx,vy});
   }else{
    let last=self.state.borrow().gesture.as_ref().map(|gesture|(gesture.last_time,gesture.vx,gesture.vy)).ok_or_else(null_gesture)?;
    let fresh=stamp-last.0<80.0&&!cancelled&&!truthy(&read(&self.reduced,"matches")?);
    {let mut state=self.state.borrow_mut();state.coast=Some((if fresh{last.1}else{0.0},if fresh{last.2}else{0.0}));state.gesture=None;}
    if truthy(&read(&self.reduced,"matches")?)||cancelled{
     self.state.borrow_mut().coast=None;self.publish(false)?;
    }else{
     let now=clock()?;self.state.borrow_mut().last_frame=now;self.schedule()?;
    }
   }
  }
  if self.state.borrow().points.is_empty(){
   let (timer,key)={let state=self.state.borrow();(state.click_timer.clone(),state.click_key)};
   clear_timeout(&timer)?;release(key);
   let key=next_key();let weak=Rc::downgrade(&self.me());
   let callback=Closure::wrap(Box::new(move|_:JsValue|{
    release(key);
    if let Some(zoom)=weak.upgrade(){let mut state=zoom.state.borrow_mut();state.suppress_click=false;state.click_key=0;}
   })as Box<dyn FnMut(JsValue)>);
   let function=adopt(key,callback);
   let timer=set_timeout(&function,250.0)?;
   let mut state=self.state.borrow_mut();state.click_timer=timer;state.click_key=key;
  }
  Ok(())
 }
 fn click(&self,event:&JsValue)->Result<(),JsValue>{
  if self.state.borrow().suppress_click&&!self.excluded(&read(event,"target")?)?{self.consume(event)?;}
  Ok(())
 }
 fn destroy(&self)->Result<(),JsValue>{
  self.stop()?;
  let (timer,key)={let mut state=self.state.borrow_mut();state.destroyed=true;(state.click_timer.clone(),state.click_key)};
  clear_timeout(&timer)?;release(key);
  self.release_captures();
  self.state.borrow_mut().points.clear();
  method(&read(&self.root,"classList")?,"remove",&[&JsValue::from_str(ZOOM_CLASS)])?;
  let listeners=std::mem::take(&mut *self.listeners.borrow_mut());
  drop(listeners);Ok(())
 }
}
fn null_gesture()->JsValue{js_sys::TypeError::new("Cannot read properties of null").into()}

#[wasm_bindgen]
pub struct RustShelfZoom{zoom:Rc<Zoom>}
#[wasm_bindgen]
impl RustShelfZoom{
 #[wasm_bindgen(constructor)]
 pub fn new(options:JsValue)->Result<RustShelfZoom,JsValue>{
  let root=read(&options,"root")?;let scroller=read(&options,"scroller")?;let get_scene=read(&options,"getScene")?;
  let is_enabled=read(&options,"isEnabled")?;let on_gesture_start=read(&options,"onGestureStart")?;
  let window=get(&global(),"window");
  let query=method_opt(&window,"matchMedia",&[&JsValue::from_str("(prefers-reduced-motion: reduce)")])?;
  let reduced=match query{Some(list)if truthy(&list)=>list,_=>{let fallback=Object::new();set(&fallback,"matches",&JsValue::FALSE)?;fallback.into()}};
  let zoom=Rc::new(Zoom{root,scroller:scroller.clone(),get_scene,is_enabled,on_gesture_start,reduced,
   state:RefCell::new(State{points:Vec::new(),gesture:None,target:JsValue::NULL,frame:zero(),frame_key:0,coast:None,last_frame:0.0,suppress_click:false,click_timer:zero(),click_key:0,destroyed:false}),
   listeners:RefCell::new(Vec::new()),me:RefCell::new(Weak::new())});
  *zoom.me.borrow_mut()=Rc::downgrade(&zoom);
  let add=|kind:&'static str,handler:fn(&Zoom,&JsValue)->Result<(),JsValue>|->Result<(),JsValue>{
   let weak=Rc::downgrade(&zoom);
   let listener=listen(&scroller,kind,None,true,move|event|match weak.upgrade(){Some(zoom)=>handler(&zoom,&event),None=>Ok(())})?;
   zoom.listeners.borrow_mut().push(listener);Ok(())
  };
  add("pointerdown",Zoom::start)?;add("pointermove",Zoom::motion)?;add("pointerup",Zoom::finish)?;add("pointercancel",Zoom::finish)?;add("click",Zoom::click)?;
  zoom.sync()?;
  Ok(RustShelfZoom{zoom})
 }
 pub fn sync(&self)->Result<(),JsValue>{self.zoom.sync()}
 pub fn destroy(&self)->Result<(),JsValue>{self.zoom.destroy()}
}
