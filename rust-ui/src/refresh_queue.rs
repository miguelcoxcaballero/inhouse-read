//! Coalesced shelf notifications. The host retains the actual library read.
use std::{cell::{Cell,RefCell},rc::Rc};
use wasm_bindgen::{prelude::*,JsCast};
use js_sys::{Function,Object,Promise,Reflect};
#[wasm_bindgen]
extern "C"{
 #[wasm_bindgen(extends=Promise)] type RawPromise;
 #[wasm_bindgen(method,js_name=then,catch)] fn chain(this:&RawPromise,yes:&JsValue,no:&JsValue)->Result<Promise,JsValue>;
}
struct Waiter{yes:Function,no:Function}
type Prepare=Closure<dyn FnMut(JsValue)->Result<JsValue,JsValue>>;
type Finish=Closure<dyn FnMut(JsValue)>;
struct Callbacks{_prepare:Prepare,_yes:Finish,_no:Finish}
struct State{
 perform:Function,set:Function,clear:Function,delay:JsValue,timer:RefCell<Option<JsValue>>,
 timer_callback:RefCell<Option<Closure<dyn FnMut()>>>,callbacks:RefCell<Option<Callbacks>>,
 pending:RefCell<Vec<Waiter>>,running:Cell<bool>,disposed:Cell<bool>,ready:Cell<bool>,immediate:Cell<bool>,
}
impl State{
 fn clear_timer(&self)->Result<(),JsValue>{let id=self.timer.borrow_mut().take();if let Some(id)=id{self.clear.call1(&JsValue::UNDEFINED,&id)?;}self.timer_callback.borrow_mut().take();Ok(())}
 fn finish(self:&Rc<Self>,batch:&Rc<RefCell<Vec<Waiter>>>,result:JsValue,failed:bool){
  self.running.set(false);let waiters=std::mem::take(&mut *batch.borrow_mut());
  for waiter in waiters{let _=if failed{waiter.no.call1(&JsValue::UNDEFINED,&result)}else{waiter.yes.call1(&JsValue::UNDEFINED,&result)};}
  self.callbacks.borrow_mut().take();if let Err(error)=self.start(){wasm_bindgen::throw_val(error)}
 }
 fn start(self:&Rc<Self>)->Result<(),JsValue>{
  if self.disposed.get()||self.running.get()||!self.ready.get()||self.pending.borrow().is_empty(){return Ok(())}
  let batch=Rc::new(RefCell::new(std::mem::take(&mut *self.pending.borrow_mut())));
  let options=Object::new();Reflect::set(&options,&"immediate".into(),&self.immediate.get().into())?;
  self.ready.set(false);self.immediate.set(false);self.running.set(true);
  let state=self.clone();let prepare=Closure::wrap(Box::new(move|_:JsValue|{
   if state.disposed.get(){Ok(JsValue::UNDEFINED)}else{state.perform.call1(&JsValue::UNDEFINED,&options)}
  })as Box<dyn FnMut(JsValue)->Result<JsValue,JsValue>>);
  let state=self.clone();let yes_batch=batch.clone();let yes=Closure::wrap(Box::new(move|value:JsValue|state.finish(&yes_batch,value,false))as Box<dyn FnMut(JsValue)>);
  let state=self.clone();let no_batch=batch.clone();let no=Closure::wrap(Box::new(move|value:JsValue|state.finish(&no_batch,value,true))as Box<dyn FnMut(JsValue)>);
  let promise=Promise::resolve(&JsValue::UNDEFINED).unchecked_ref::<RawPromise>().chain(prepare.as_ref(),&JsValue::UNDEFINED)?;
  let _=promise.unchecked_ref::<RawPromise>().chain(yes.as_ref(),no.as_ref())?;
  *self.callbacks.borrow_mut()=Some(Callbacks{_prepare:prepare,_yes:yes,_no:no});Ok(())
 }
 fn request(self:&Rc<Self>,urgent:bool)->Result<Promise,JsValue>{
  if self.disposed.get(){return Ok(Promise::resolve(&JsValue::UNDEFINED))}
  let promise=Promise::new(&mut|yes,no|self.pending.borrow_mut().push(Waiter{yes,no}));
  if urgent{self.immediate.set(true);self.ready.set(true);self.clear_timer()?;}
  else if !self.ready.get()&&self.timer.borrow().is_none(){
   let state=self.clone();let callback=Closure::wrap(Box::new(move||{
    state.timer.borrow_mut().take();state.timer_callback.borrow_mut().take();state.ready.set(true);
    if let Err(error)=state.start(){wasm_bindgen::throw_val(error)}
   })as Box<dyn FnMut()>);
   let id=self.set.call2(&JsValue::UNDEFINED,callback.as_ref(),&self.delay)?;
   *self.timer.borrow_mut()=Some(id);*self.timer_callback.borrow_mut()=Some(callback);
  }
  self.start()?;Ok(promise)
 }
 fn dispose(&self)->Result<(),JsValue>{
  if self.disposed.replace(true){return Ok(())}
  self.clear_timer()?;self.ready.set(false);self.immediate.set(false);
  let waiters=std::mem::take(&mut *self.pending.borrow_mut());for waiter in waiters{let _=waiter.yes.call0(&JsValue::UNDEFINED);}Ok(())
 }
}
#[wasm_bindgen]
pub struct RustShelfRefreshQueue{state:Rc<State>}
#[wasm_bindgen]
impl RustShelfRefreshQueue{
 #[wasm_bindgen(constructor)]
 pub fn new(perform:Function,delay:JsValue,set:Function,clear:Function)->Self{Self{state:Rc::new(State{perform,delay,set,clear,timer:RefCell::new(None),timer_callback:RefCell::new(None),callbacks:RefCell::new(None),pending:RefCell::new(Vec::new()),running:Cell::new(false),disposed:Cell::new(false),ready:Cell::new(false),immediate:Cell::new(false)})}}
 pub fn request(&self,urgent:bool)->Result<Promise,JsValue>{self.state.request(urgent)}
 pub fn idle(&self)->bool{!self.state.running.get()&&self.state.pending.borrow().is_empty()&&self.state.timer.borrow().is_none()}
 pub fn dispose(&self)->Result<(),JsValue>{self.state.dispose()}
}
