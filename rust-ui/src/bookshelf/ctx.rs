//! What every part of the shelf screen shares: the state object, the merged options and the host's
//! functions. `state` is one JavaScript object shared with whatever of the screen has not moved here yet;
//! `env` holds the functions imported from other modules (looked up at call time, so a module that is
//! replaced after the shelf was built is still the one called) and `legacy` the functions still defined in
//! the screen's own JavaScript. Both shrink as parts move.
use std::{cell::{Cell,RefCell},collections::HashMap,rc::Rc};
use wasm_bindgen::prelude::*;
use super::util::*;

pub struct Ctx{
 pub state:JsValue,pub opts:JsValue,pub options:JsValue,pub env:JsValue,pub legacy:JsValue,
 pub root:JsValue,pub scroller:JsValue,pub container:JsValue,pub parts:JsValue,
 /// Callbacks handed to code that may call them after the part that made them is gone; the latest set is kept.
 pub keepalive_slot:std::cell::RefCell<Vec<Fun>>,
 /// Timers and frames whose ids live in the shared state (the host may cancel them by id): their closures are
 /// released when they fire, when `clear_timeout`/`cancel_frame_id` cancels them and when the shelf goes.
 timers:RefCell<HashMap<u64,Timer>>,frames:RefCell<HashMap<u64,Timer>>,
 /// The listeners that swallow the compatibility click of a touch the shelf already handled.
 pub opening_click:RefCell<Vec<Listener>>,
 /// The session that previews where a held object would land, with the drag it belongs to.
 pub preview:RefCell<Option<(JsValue,Rc<crate::placement_preview::ShelfPlacementPreview>)>>,
}
impl Drop for Ctx{
 fn drop(&mut self){
  for (_,timer) in self.timers.borrow_mut().drain(){cancel(&timer);}
  for (_,timer) in self.frames.borrow_mut().drain(){cancel_frame(&timer);}
 }
}
impl Ctx{
 pub fn new(parts:JsValue)->Result<Ctx,JsValue>{
  Ok(Ctx{state:read(&parts,"state")?,opts:read(&parts,"opts")?,options:read(&parts,"options")?,env:read(&parts,"env")?,
   legacy:read(&parts,"legacy")?,root:read(&parts,"root")?,scroller:read(&parts,"scroller")?,container:read(&parts,"container")?,parts,
   keepalive_slot:RefCell::new(Vec::new()),timers:RefCell::new(HashMap::new()),frames:RefCell::new(HashMap::new()),opening_click:RefCell::new(Vec::new()),preview:RefCell::new(None)})
 }
 /// `setTimeout(job, delay)`: the id for the state; the job runs only while the shelf is alive.
 pub fn set_timeout(self:&Rc<Self>,delay:f64,job:impl FnOnce(&Rc<Ctx>)->R+'static)->JsValue{
  let weak=Rc::downgrade(self);
  let slot:Rc<Cell<u64>>=Rc::new(Cell::new(0));
  let timer=after(delay,{let slot=slot.clone();move||match weak.upgrade(){
   Some(ctx)=>{ctx.timers.borrow_mut().remove(&slot.get());job(&ctx)}
   None=>Ok(()),
  }});
  let bits=num(&timer.id).to_bits();
  slot.set(bits);
  let id=timer.id.clone();
  self.timers.borrow_mut().insert(bits,timer);
  id
 }
 /// `clearTimeout(id)`.
 pub fn clear_timeout(&self,id:&JsValue){
  let known=if absent(id){None}else{self.timers.borrow_mut().remove(&num(id).to_bits())};
  match known{Some(timer)=>cancel(&timer),None=>{let _=clear_timeout(id);}}
 }
 /// `requestAnimationFrame(job)`: the id for the state.
 pub fn set_frame(self:&Rc<Self>,job:impl FnOnce(&Rc<Ctx>)->R+'static)->JsValue{
  let weak=Rc::downgrade(self);
  let slot:Rc<Cell<u64>>=Rc::new(Cell::new(0));
  let timer=frame({let slot=slot.clone();move||match weak.upgrade(){
   Some(ctx)=>{ctx.frames.borrow_mut().remove(&slot.get());job(&ctx)}
   None=>Ok(()),
  }});
  let bits=num(&timer.id).to_bits();
  slot.set(bits);
  let id=timer.id.clone();
  self.frames.borrow_mut().insert(bits,timer);
  id
 }
 /// `cancelAnimationFrame(id)`.
 pub fn cancel_frame_id(&self,id:&JsValue){
  let known=if absent(id){None}else{self.frames.borrow_mut().remove(&num(id).to_bits())};
  match known{Some(timer)=>cancel_frame(&timer),None=>{let _=crate::host::cancel_frame(id);}}
 }
 pub fn keepalive(&self,funs:Vec<Fun>){*self.keepalive_slot.borrow_mut()=funs;}
 /// `opts[name]`.
 pub fn opts_get(&self,name:&str)->JsValue{get(&self.opts,name)}
 pub fn legacy_value(&self,name:&str)->JsValue{get(&self.legacy,name)}
 /// `options[first] || options[second]`.
 pub fn option_or(&self,first:&str,second:&str)->JsValue{or(get(&self.options,first),get(&self.options,second))}
 /// `env[name](...args)`.
 pub fn env(&self,name:&str,args:&[&JsValue])->R<JsValue>{call(&read(&self.env,name)?,name,args)}
 pub fn env_value(&self,name:&str)->JsValue{get(&self.env,name)}
 /// `legacy[name](...args)`: a function that still lives in the screen's JavaScript.
 pub fn legacy(&self,name:&str,args:&[&JsValue])->R<JsValue>{call(&read(&self.legacy,name)?,name,args)}
 pub fn st(&self,key:&str)->JsValue{get(&self.state,key)}
 pub fn st_set(&self,key:&str,value:&JsValue){put(&self.state,key,value);}
 pub fn st_true(&self,key:&str)->bool{truthy(&get(&self.state,key))}
 pub fn st_str(&self,key:&str)->String{text(&get(&self.state,key))}
 /// `state.shelfScene` (null when the scene is not in use).
 pub fn scene(&self)->JsValue{get(&self.state,"shelfScene")}
 /// `state.shelfScene?.name(...args)`: a present scene must have the method, as in the original.
 pub fn scene_call(&self,name:&str,args:&[&JsValue])->R<JsValue>{
  let scene=self.scene();
  if absent(&scene){Ok(undef())}else{method(&scene,name,args)}
 } /// `options[name]`.
 pub fn option(&self,name:&str)->JsValue{get(&self.options,name)}
 /// `options[name]?.(...args)`.
 pub fn option_call(&self,name:&str,args:&[&JsValue])->R<JsValue>{
  let function=get(&self.options,name);
  if nullish(&function){Ok(undef())}else{call(&function,name,args)}
 }
 /// `opts.texts[name]`.
 pub fn text_of(&self,name:&str)->JsValue{get(&get(&self.opts,"texts"),name)}
}

#[wasm_bindgen]
pub struct RustShelfCtx{pub(crate) ctx:Rc<Ctx>}
#[wasm_bindgen]
impl RustShelfCtx{
 #[wasm_bindgen(constructor)]
 pub fn new(parts:JsValue)->Result<RustShelfCtx,JsValue>{
  Ok(RustShelfCtx{ctx:Rc::new(Ctx::new(parts)?)})
 }
}
#[wasm_bindgen]
impl RustShelfCtx{
 /// `clearTimeout(id)` for an id the shelf module handed to the shared state.
 #[wasm_bindgen(js_name=clearTimer)]
 pub fn clear_timer(&self,id:JsValue){self.ctx.clear_timeout(&id);}
}
