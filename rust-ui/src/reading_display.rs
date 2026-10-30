//! Reading owns the display: a screen wake lock in the browser and, in the Android app,
//! KEEP_SCREEN_ON with its status bar hidden (formerly src/js/reading-display.js, which now only
//! hands this controller the document, window and navigator it watches).
//!
//! A shell that reports a stable top inset (InhouseNative.getSafeTopInset) draws the page behind
//! its status bar, and the page always keeps the bar's strip free (index.html, --ihr-safe-top).
//! Hiding or showing the bar there moves and resizes nothing, so it follows the book itself: it
//! fades out as the page zooms in (body.is-reader-page-arriving) and comes back as the 3D book
//! starts carrying the page to the shelf (body.is-reader-page-leaving). Its icons follow what is
//! under them: the reading paper while the book owns the display, the app's theme otherwise.
//!
//! Older shells resize the WebView when the bar changes. Changing their insets during a 3D flight
//! would look like a user resize and cancel it, so for them the display changes only after the
//! book has opened and after it is back on the shelf.
//!
//! Every host call is the one the JavaScript made, in the same order and with the same promise
//! chain (`Promise.resolve().then(request).then(adopt).catch(ignore).finally(retry)`), so lock
//! requests and releases settle on the same microtasks.
use std::{cell::{Cell,RefCell},rc::Rc};
use wasm_bindgen::{prelude::*,JsCast};
use js_sys::{Array,Function,Object,Promise,Reflect};
use crate::host::{absent,get,listen,method,read,text,Listener};

type Step=Closure<dyn FnMut(JsValue)->Result<JsValue,JsValue>>;

struct State{
 doc:JsValue,win:JsValue,nav:JsValue,
 reading:Cell<bool>,active:Cell<bool>,disposed:Cell<bool>,page_active:Cell<bool>,
 lock:RefCell<JsValue>,pending:RefCell<JsValue>,epoch:Cell<u64>,
 native_state:Cell<Option<bool>>,light_state:Cell<Option<bool>>,
 /// The adopting step of the request in flight: it may never run (a refused lock), so it is
 /// owned here and dropped by the chain's `finally`, which always runs.
 chain:RefCell<Option<Step>>,
}

thread_local!{
 /// `() => {}` for `.catch`: one function for the page's lifetime.
 static IGNORE:Function=Closure::<dyn FnMut(JsValue)>::new(|_|{}).into_js_value().unchecked_into();
}

fn options(fields:&[(&str,JsValue)])->Result<JsValue,JsValue>{
 let object=Object::new();
 for (key,value) in fields{Reflect::set(&object,&JsValue::from_str(key),value)?;}
 Ok(object.into())
}
fn names(list:&[&str])->JsValue{list.iter().map(|name|JsValue::from_str(name)).collect::<Array>().into()}

/// `Promise.resolve(sentinel?.release()).catch(() => {})`, ignoring a sentinel already released.
fn release(sentinel:&JsValue){
 if absent(sentinel){return}
 if let Ok(result)=method(sentinel,"release",&[]){IGNORE.with(|ignore|{let _=method(&Promise::resolve(&result),"catch",&[ignore]);});}
}

impl State{
 fn has(&self,name:&str)->Result<bool,JsValue>{
  let list=read(&read(&self.doc,"body")?,"classList")?;
  Ok(method(&list,"contains",&[&JsValue::from_str(name)])?.is_truthy())
 }
 fn visible(&self)->Result<bool,JsValue>{Ok(self.page_active.get()&&!text(&read(&self.doc,"visibilityState")?,"hidden"))}
 fn eligible(&self)->Result<bool,JsValue>{Ok(self.active.get()&&!self.disposed.get()&&self.visible()?)}
 /// The book's page owns the screen: from its zoom in until the 3D book takes it back (stable
 /// shells only; `reading` itself changes after the motion).
 fn page_owns_display(&self)->Result<bool,JsValue>{
  if self.reading.get(){Ok(!(self.has("is-closing-reader")?&&self.has("is-reader-page-leaving")?))}
  else{Ok(self.has("is-opening-reader")?&&self.has("is-reader-page-arriving")?)}
 }
 /// New shells own their Activity lifecycle. A delayed WebView visibility event after unlocking
 /// must not hide a notification shade the user opened.
 fn native(&self,enabled:bool)->Result<(),JsValue>{
  let bridge=read(&self.win,"InhouseNative")?;
  let ownership=get(&bridge,"setReaderOwnership").is_function();
  let owned=if get(&bridge,"getSafeTopInset").is_function(){self.page_owns_display()?}else{self.reading.get()};
  let requested=if ownership{owned&&self.page_active.get()&&!self.disposed.get()}else{enabled};
  if self.native_state.get()==Some(requested){return Ok(())}
  // Older shells use the browser wake lock when available.
  if ownership{if method(&bridge,"setReaderOwnership",&[&requested.into()]).is_ok(){self.native_state.set(Some(requested))}}
  else if get(&bridge,"setReadingMode").is_function()&&method(&bridge,"setReadingMode",&[&requested.into()]).is_ok(){self.native_state.set(Some(requested))}
  Ok(())
 }
 /// Whether the surface under the status bar is light (dark icons).
 fn light_under_status_bar(&self)->Result<bool,JsValue>{
  // The optional update notice dims the whole screen, the bar's strip too.
  if method(&self.doc,"getElementById",&[&"inhouse-services-update".into()])?.is_truthy(){return Ok(false)}
  // So does the catalogue's backdrop: light paper when flown into from the booklet (both
  // themes), the dimmed room otherwise.
  let catalog=method(&self.doc,"querySelector",&[&"dialog.ihr-plant-catalog[open]".into()])?;
  if catalog.is_truthy(){return Ok(method(&catalog,"hasAttribute",&[&"data-catalog-camera".into()])?.is_truthy())}
  let scheme=if self.reading.get()&&self.page_owns_display()?{
   let screen=method(&self.doc,"getElementById",&[&"reader-screen".into()])?;
   if absent(&screen){JsValue::UNDEFINED}else{read(&read(&screen,"style")?,"colorScheme")?}
  }else{JsValue::from_str("")};
  if text(&scheme,"light")||text(&scheme,"dark"){return Ok(text(&scheme,"light"))}
  let theme=method(&read(&self.doc,"documentElement")?,"getAttribute",&[&"data-theme".into()])?;
  Ok(!text(&theme,"dark"))
 }
 fn status_bar_icons(&self)->Result<(),JsValue>{
  let bridge=read(&self.win,"InhouseNative")?;
  if self.disposed.get()||!get(&bridge,"setStatusBarAppearance").is_function(){return Ok(())}
  let light=self.light_under_status_bar()?;
  if self.light_state.get()==Some(light){return Ok(())}
  // A shell without icon control keeps its own.
  if method(&bridge,"setStatusBarAppearance",&[&light.into()]).is_ok(){self.light_state.set(Some(light))}
  Ok(())
 }
}

fn acquire(state:&Rc<State>)->Result<(),JsValue>{
 if !state.eligible()?||state.lock.borrow().is_truthy()||state.pending.borrow().is_truthy(){return Ok(())}
 if !get(&read(&state.nav,"wakeLock")?,"request").is_function(){return Ok(())}
 let requested=state.epoch.get();
 let owner=state.clone();
 let request=Closure::once_into_js(move|_:JsValue|->Result<JsValue,JsValue>{method(&read(&owner.nav,"wakeLock")?,"request",&[&"screen".into()])});
 let owner=state.clone();
 let adopt:Step=Closure::wrap(Box::new(move|sentinel:JsValue|->Result<JsValue,JsValue>{
  if requested!=owner.epoch.get()||!owner.eligible()?{release(&sentinel);return Ok(JsValue::UNDEFINED)}
  *owner.lock.borrow_mut()=sentinel.clone();
  let (watcher,own)=(owner.clone(),sentinel.clone());
  let released=Closure::once_into_js(move|_:JsValue|{let same=*watcher.lock.borrow()==own;if same{*watcher.lock.borrow_mut()=JsValue::NULL}});
  method(&sentinel,"addEventListener",&[&"release".into(),&released,&options(&[("once",JsValue::TRUE)])?])?;
  Ok(JsValue::UNDEFINED)
 }));
 let owner=state.clone();
 // Battery saver, permissions or an older WebView may refuse a lock. Retry only on
 // visibility/focus/user interaction, never a busy loop.
 let settled=Closure::once_into_js(move|_:JsValue|->Result<JsValue,JsValue>{
  *owner.pending.borrow_mut()=JsValue::NULL;
  let step=owner.chain.borrow_mut().take();drop(step);
  if requested!=owner.epoch.get()&&owner.eligible()?{acquire(&owner)?}
  Ok(JsValue::UNDEFINED)
 });
 let chain=method(&Promise::resolve(&JsValue::UNDEFINED),"then",&[&request])?;
 let chain=method(&chain,"then",&[adopt.as_ref()])?;
 let chain=IGNORE.with(|ignore|method(&chain,"catch",&[ignore]))?;
 let chain=method(&chain,"finally",&[&settled])?;
 *state.chain.borrow_mut()=Some(adopt);
 *state.pending.borrow_mut()=chain;
 Ok(())
}

fn sync(state:&Rc<State>)->Result<(),JsValue>{
 if state.disposed.get(){return Ok(())}
 // Retain the previous policy until the opening/return animation finishes.
 if !state.has("is-opening-reader")?&&!state.has("is-closing-reader")?{state.reading.set(state.has("is-reading")?)}
 let next=state.reading.get()&&state.visible()?;
 if state.active.get()!=next{
  state.active.set(next);state.epoch.set(state.epoch.get()+1);
  if !next{let previous=state.lock.replace(JsValue::NULL);release(&previous)}
 }
 // Icons first, so a bar coming back already matches what is under it.
 state.status_bar_icons()?;
 state.native(state.active.get())?;
 acquire(state)
}

#[wasm_bindgen]
pub struct RustReadingDisplay{state:Rc<State>,observers:Vec<JsValue>,listeners:Vec<Listener>,_sync:Closure<dyn FnMut(JsValue)->Result<(),JsValue>>}

#[wasm_bindgen]
impl RustReadingDisplay{
 #[wasm_bindgen(constructor)]
 pub fn new(doc:JsValue,win:JsValue,nav:JsValue)->Result<RustReadingDisplay,JsValue>{
  let state=Rc::new(State{doc:doc.clone(),win:win.clone(),nav,reading:Cell::new(false),active:Cell::new(false),disposed:Cell::new(false),
   page_active:Cell::new(true),lock:RefCell::new(JsValue::NULL),pending:RefCell::new(JsValue::NULL),epoch:Cell::new(0),
   native_state:Cell::new(None),light_state:Cell::new(None),chain:RefCell::new(None)});
  let owner=state.clone();
  let on_change=Closure::wrap(Box::new(move|_:JsValue|sync(&owner)) as Box<dyn FnMut(JsValue)->Result<(),JsValue>>);
  let observe=|options_list:&[(&JsValue,JsValue)]|->Result<JsValue,JsValue>{
   let constructor=read(&win,"MutationObserver")?.dyn_into::<Function>().map_err(|_|js_sys::TypeError::new("MutationObserver is not a constructor"))?;
   let observer=Reflect::construct(&constructor,&Array::of1(on_change.as_ref()))?;
   for (target,init) in options_list{method(&observer,"observe",&[target,init])?;}
   Ok(observer)
  };
  let body=read(&doc,"body")?;
  // Body: reader states and the update notice. Root: app theme. Reader: paper.
  let body_init=options(&[("attributes",JsValue::TRUE),("attributeFilter",names(&["class"])),("childList",JsValue::TRUE)])?;
  let root=read(&doc,"documentElement")?;
  let root_init=options(&[("attributes",JsValue::TRUE),("attributeFilter",names(&["data-theme"]))])?;
  let screen=method(&doc,"getElementById",&[&"reader-screen".into()])?;
  let mut targets=vec![(&body,body_init),(&root,root_init)];
  if screen.is_truthy(){targets.push((&screen,options(&[("attributes",JsValue::TRUE),("attributeFilter",names(&["data-reading-theme"]))])?))}
  let observer=observe(&targets)?;
  // Dialogs opening anywhere (the catalogue covers the status bar's strip).
  let dialogs=observe(&[(&body,options(&[("subtree",JsValue::TRUE),("attributes",JsValue::TRUE),("attributeFilter",names(&["open","data-catalog-camera"]))])?)])?;
  let (a,b,c,d,e)=(state.clone(),state.clone(),state.clone(),state.clone(),state.clone());
  let listeners=vec![
   listen(&doc,"visibilitychange",None,false,move|_|sync(&a))?,
   listen(&doc,"pointerdown",Some(true),false,move|_|acquire(&b))?,
   listen(&win,"focus",None,false,move|_|sync(&c))?,
   listen(&win,"pagehide",None,false,move|_|{d.page_active.set(false);sync(&d)})?,
   listen(&win,"pageshow",None,false,move|_|{e.page_active.set(true);e.native_state.set(None);e.light_state.set(None);sync(&e)})?,
  ];
  let display=RustReadingDisplay{state,observers:vec![observer,dialogs],listeners,_sync:on_change};
  sync(&display.state)?;
  Ok(display)
 }
 pub fn dispose(&mut self)->Result<(),JsValue>{
  let state=&self.state;
  if state.disposed.get(){return Ok(())}
  state.disposed.set(true);state.active.set(false);state.epoch.set(state.epoch.get()+1);
  for observer in &self.observers{method(observer,"disconnect",&[])?;}
  self.listeners.clear();
  let previous=state.lock.replace(JsValue::NULL);release(&previous);
  state.native(false)
 }
}
