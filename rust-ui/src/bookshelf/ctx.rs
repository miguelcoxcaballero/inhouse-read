//! What every part of the shelf screen shares: the state object, the merged options and the host's
//! functions. `state` is one JavaScript object shared with whatever of the screen has not moved here yet;
//! `env` holds the functions imported from other modules (looked up at call time, so a module that is
//! replaced after the shelf was built is still the one called) and `legacy` the functions still defined in
//! the screen's own JavaScript. Both shrink as parts move.
use std::rc::Rc;
use wasm_bindgen::prelude::*;
use super::util::*;

pub struct Ctx{
 pub state:JsValue,pub opts:JsValue,pub options:JsValue,pub env:JsValue,pub legacy:JsValue,
 pub root:JsValue,pub scroller:JsValue,pub container:JsValue,pub parts:JsValue,
 /// Callbacks handed to code that may call them after the part that made them is gone; the latest set is kept.
 pub keepalive_slot:std::cell::RefCell<Vec<Fun>>,
}
impl Ctx{
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
 /// `options[name]`.
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
  let ctx=Rc::new(Ctx{state:read(&parts,"state")?,opts:read(&parts,"opts")?,options:read(&parts,"options")?,env:read(&parts,"env")?,
   legacy:read(&parts,"legacy")?,root:read(&parts,"root")?,scroller:read(&parts,"scroller")?,container:read(&parts,"container")?,parts,keepalive_slot:std::cell::RefCell::new(Vec::new())});
  Ok(RustShelfCtx{ctx})
 }
}
