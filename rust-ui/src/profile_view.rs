//! Account presentation. Authentication, sync and updater actions keep their
//! existing host callbacks; DOM references are retained by this view only.
use wasm_bindgen::{prelude::*,JsCast};
#[wasm_bindgen]
extern "C" {
 #[wasm_bindgen(extends=Element)]
 type ProfileNode;
 #[wasm_bindgen(extends=js_sys::Object)]
 type ProfileTokenList;
 #[wasm_bindgen(method, js_name=setAttribute, catch)]
 fn set_raw_attribute(this:&ProfileNode,key:&JsValue,value:&JsValue)->Result<(),JsValue>;
 #[wasm_bindgen(method, js_name=removeAttribute, catch)]
 fn remove_raw_attribute(this:&ProfileNode,key:&JsValue)->Result<(),JsValue>;
 #[wasm_bindgen(method, getter=classList)]
 fn raw_class_list(this:&ProfileNode)->ProfileTokenList;
 #[wasm_bindgen(method, js_name=toggle, catch)]
 fn toggle_raw(this:&ProfileTokenList,key:&JsValue,force:bool)->Result<bool,JsValue>;
 #[wasm_bindgen(method, setter=textContent, catch)]
 fn set_raw_text(this:&ProfileNode,value:&JsValue)->Result<(),JsValue>;
 #[wasm_bindgen(method, setter=title, catch)]
 fn set_raw_title(this:&ProfileNode,value:&JsValue)->Result<(),JsValue>;
 #[wasm_bindgen(method, setter=src, catch)]
 fn set_raw_src(this:&ProfileNode,value:&JsValue)->Result<(),JsValue>;
}
use web_sys::{Document,Element,HtmlElement};
use std::{cell::{RefCell,Cell},rc::Rc};
use js_sys::Function;
use web_sys::{Event,EventTarget,KeyboardEvent};
use crate::Listener;

fn text(node:&Element,value:&JsValue)->Result<(),JsValue>{node.unchecked_ref::<ProfileNode>().set_raw_text(value)?;Ok(())}
fn hidden(node:&Element,value:bool){node.unchecked_ref::<HtmlElement>().set_hidden(value);}
struct ProfileState{nodes:Vec<Element>,aria_label:JsValue,aria_expanded:JsValue,yes:JsValue,no:JsValue,src:JsValue,syncing:JsValue,cache:RefCell<Vec<Option<JsValue>>>,connected:Cell<Option<bool>>,close_updates:RefCell<Option<Function>>}
impl ProfileState{
 fn changed(&self,index:usize,value:&JsValue)->bool{
  let primitive=value.is_string()||value.is_null()||value.is_undefined()||value.as_bool().is_some()||value.as_f64().is_some();
  let mut cache=self.cache.borrow_mut();
  if primitive&&cache[index].as_ref()==Some(value){return false;}
  cache[index]=if primitive{Some(value.clone())}else{None};true
 }
 fn text_changed(&self,index:usize,node:usize,value:&JsValue)->Result<(),JsValue>{if self.changed(index,value){text(&self.nodes[node],value)?;}Ok(())}
  pub fn new(document:Document)->Result<Self,JsValue>{
  let ids=["drive-profile","drive-connect-btn","theme-toggle","drive-sync-btn","drive-signout-btn","drive-sync-status","drive-profile-name","drive-profile-email","drive-profile-btn","drive-profile-menu","drive-profile-initial","drive-profile-initial-menu","drive-profile-avatar","drive-profile-avatar-menu"];
  let mut nodes=Vec::with_capacity(ids.len());for id in ids{nodes.push(document.get_element_by_id(id).ok_or_else(||JsValue::from_str("Missing profile element"))?);}Ok(Self{nodes,aria_label:"aria-label".into(),aria_expanded:"aria-expanded".into(),yes:"true".into(),no:"false".into(),src:"src".into(),syncing:"is-syncing".into(),cache:RefCell::new(vec![None;8]),connected:Cell::new(None),close_updates:RefCell::new(None)})
 }
  pub fn sync_status(&self,message:JsValue,syncing:bool)->Result<(),JsValue>{self.text_changed(0,5,&message)?;self.nodes[5].unchecked_ref::<ProfileNode>().raw_class_list().toggle_raw(&self.syncing,syncing)?;Ok(())}
 pub fn visibility(&self,connected:bool){
  if self.connected.get().is_none(){hidden(&self.nodes[0],false);hidden(&self.nodes[2],true);}
  if self.connected.replace(Some(connected))==Some(connected){return;}
  hidden(&self.nodes[1],connected);
  for index in [3,4,5]{hidden(&self.nodes[index],!connected);}
 }
  pub fn profile_text(&self,name:JsValue,email:JsValue,label:JsValue,title:JsValue)->Result<(),JsValue>{
  self.text_changed(1,6,&name)?;self.text_changed(2,7,&email)?;if self.changed(3,&label){self.nodes[8].unchecked_ref::<ProfileNode>().set_raw_attribute(&self.aria_label,&label)?;}if self.changed(4,&title){self.nodes[8].unchecked_ref::<ProfileNode>().set_raw_title(&title)?;}Ok(())
 }
 pub fn avatar(&self,initial:JsValue,photo:JsValue)->Result<(),JsValue>{
  if self.changed(5,&initial){for index in [10,11]{text(&self.nodes[index],&initial)?;}}
  if !photo.is_truthy()&&!self.changed(7,&photo){return Ok(());}
  if photo.is_truthy(){self.cache.borrow_mut()[7]=None;}
  for index in [12,13]{let image=&self.nodes[index];let previous=image.previous_element_sibling().ok_or_else(||JsValue::from_str("Missing profile initial"))?;
   if photo.is_truthy(){image.unchecked_ref::<ProfileNode>().set_raw_src(&photo)?;hidden(image,false);hidden(&previous,true);}
   else{image.unchecked_ref::<ProfileNode>().remove_raw_attribute(&self.src)?;hidden(image,true);hidden(&previous,false);}
  }Ok(())
 }
 pub fn profile(&self,name:JsValue,email:JsValue,label:JsValue,title:JsValue,initial:JsValue,photo:JsValue)->Result<(),JsValue>{self.profile_text(name,email,label,title)?;self.avatar(initial,photo)}
  pub fn close_menu(&self){let callback=self.close_updates.borrow().clone();if let Some(callback)=callback{if let Err(error)=callback.call0(&JsValue::UNDEFINED){wasm_bindgen::throw_val(error);}}hidden(&self.nodes[9],true);let _=self.nodes[8].unchecked_ref::<ProfileNode>().set_raw_attribute(&self.aria_expanded,&self.no);}
  pub fn toggle_menu(&self)->bool{
  let open=self.nodes[9].unchecked_ref::<HtmlElement>().hidden();hidden(&self.nodes[9],!open);let _=self.nodes[8].unchecked_ref::<ProfileNode>().set_raw_attribute(&self.aria_expanded,if open{&self.yes}else{&self.no});open
 }
}

// The view owns and releases all listeners. Each closure retains the state,
// which owns no listeners, so freeing a view cannot create an ownership cycle.
#[wasm_bindgen]
pub struct RustProfileView{state:Rc<ProfileState>,document:Document,listeners:RefCell<Vec<Listener>>}
#[wasm_bindgen]
impl RustProfileView{
 #[wasm_bindgen(constructor)]
 pub fn new(document:Document)->Result<Self,JsValue>{Ok(Self{state:Rc::new(ProfileState::new(document.clone())?),document,listeners:RefCell::new(Vec::new())})}
 #[wasm_bindgen(js_name=syncStatus)]
 pub fn sync_status(&self,message:JsValue,syncing:bool)->Result<(),JsValue>{self.state.sync_status(message,syncing)}
 pub fn visibility(&self,connected:bool){self.state.visibility(connected);}
 #[wasm_bindgen(js_name=profileText)]
 pub fn profile_text(&self,name:JsValue,email:JsValue,label:JsValue,title:JsValue)->Result<(),JsValue>{self.state.profile_text(name,email,label,title)}
 pub fn avatar(&self,initial:JsValue,photo:JsValue)->Result<(),JsValue>{self.state.avatar(initial,photo)}
 pub fn profile(&self,name:JsValue,email:JsValue,label:JsValue,title:JsValue,initial:JsValue,photo:JsValue)->Result<(),JsValue>{self.state.profile(name,email,label,title,initial,photo)}
 #[wasm_bindgen(js_name=closeMenu)]
 pub fn close_menu(&self){self.state.close_menu();}
 #[wasm_bindgen(js_name=toggleMenu)]
 pub fn toggle_menu(&self)->bool{self.state.toggle_menu()}
 pub fn connect(&self,close_updates:Function,theme_toggle:HtmlElement)->Result<(),JsValue>{
  self.listeners.borrow_mut().clear();*self.state.close_updates.borrow_mut()=Some(close_updates);
  let mut listeners=Vec::new();
  let mut listen=|target:EventTarget,kind:&'static str,callback:Closure<dyn FnMut(Event)>|->Result<(),JsValue>{target.add_event_listener_with_callback(kind,callback.as_ref().unchecked_ref())?;listeners.push(Listener{target,kind,callback,capture:false});Ok(())};
  let state=self.state.clone();listen(self.state.nodes[8].clone().into(),"click",Closure::wrap(Box::new(move|_:Event|{
   if !state.nodes[9].unchecked_ref::<HtmlElement>().hidden(){state.close_menu();return;}
   state.toggle_menu();let _=theme_toggle.focus();
  })as Box<dyn FnMut(Event)>))?;
  let state=self.state.clone();listen(self.document.clone().into(),"click",Closure::wrap(Box::new(move|event:Event|{
   // The updater can replace its button while this event bubbles.
   if !event.composed_path().includes(state.nodes[0].as_ref(),0){state.close_menu();}
  })as Box<dyn FnMut(Event)>))?;
  let state=self.state.clone();listen(self.document.clone().into(),"keydown",Closure::wrap(Box::new(move|event:Event|{
   if event.dyn_ref::<KeyboardEvent>().map(|event|event.key()=="Escape").unwrap_or(false){let open=!state.nodes[9].unchecked_ref::<HtmlElement>().hidden();state.close_menu();if open{let _=state.nodes[8].unchecked_ref::<HtmlElement>().focus();}}
  })as Box<dyn FnMut(Event)>))?;
  for index in [12,13]{let image=self.state.nodes[index].clone();listen(image.clone().into(),"error",Closure::wrap(Box::new(move|_:Event|{hidden(&image,true);if let Some(initial)=image.previous_element_sibling(){hidden(&initial,false);}})as Box<dyn FnMut(Event)>))?;}
  *self.listeners.borrow_mut()=listeners;Ok(())
 }
}
