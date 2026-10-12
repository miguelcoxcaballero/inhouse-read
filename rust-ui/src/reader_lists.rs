//! Dynamic reader lists. Host callbacks retain navigation and persistence;
//! Rust owns DOM construction and the lifetime of each list's event handlers.
use std::{cell::RefCell,collections::HashMap};
use wasm_bindgen::{prelude::*,JsCast};
use js_sys::{Array,Function};
use web_sys::{Document,Element,Event,HtmlElement};
use crate::{attr,prop,js_string,element,append,Listener};

fn fallback(value:JsValue,other:JsValue)->JsValue{if value.is_undefined(){other}else{value}}
fn text_value(value:&JsValue)->Option<String>{if value.is_null()||value.is_undefined(){None}else{Some(js_string(value))}}
fn listen(node:&Element,callback:&Function,args:Array)->Result<Listener,JsValue>{
 let callback=callback.clone();let handler=Closure::wrap(Box::new(move|_:Event|{
  let result=callback.apply(&JsValue::UNDEFINED,&args);
  if let Err(error)=result{wasm_bindgen::throw_val(error);}
 })as Box<dyn FnMut(Event)>);
 node.add_event_listener_with_callback("click",handler.as_ref().unchecked_ref())?;
 Ok(Listener{target:node.clone().into(),kind:"click",callback:handler,capture:false})
}
fn args(values:&[JsValue])->Array{values.iter().cloned().collect()}
#[wasm_bindgen]
pub struct RustReaderLists{document:Document,panel:Element,listeners:RefCell<HashMap<String,Vec<Listener>>>}
impl RustReaderLists{
 fn query(&self,query:&str)->Result<Element,JsValue>{self.panel.query_selector(query)?.ok_or_else(||JsValue::from_str("Missing reader list"))}
 fn clear(&self,name:&str,query:&str)->Result<Element,JsValue>{
  self.listeners.borrow_mut().remove(name);let list=self.query(query)?;list.set_text_content(None);Ok(list)
 }
 fn button(&self,class:&str,text:Option<&str>)->Result<Element,JsValue>{let button=self.document.create_element("button")?;attr(&button,"type","button");if !class.is_empty(){button.set_class_name(class);}if let Some(text)=text{button.set_text_content(Some(text));}Ok(button)}
 fn add_toc(&self,list:&Element,items:&JsValue,depth:u32,jump:&Function,listeners:&mut Vec<Listener>)->Result<(),JsValue>{
  if items.is_null()||items.is_undefined(){return Ok(());}
  for item in Array::from(items).iter(){
   let href=prop(&item,"href");if !href.is_null()&&!href.is_undefined(){
    let label=prop(&item,"label");let label=if label.is_truthy(){js_string(&label)}else{"Capítulo".to_owned()};let button=self.button("",Some(&label))?;
    let _=button.unchecked_ref::<HtmlElement>().style().set_property("padding-inline-start",&format!("{}px",12+depth.min(4)*12));
    listeners.push(listen(&button,jump,args(&[href]))?);append(list,&button);
   }
   if depth<8{self.add_toc(list,&prop(&item,"subitems"),depth+1,jump,listeners)?;}
  }Ok(())
 }
}
#[wasm_bindgen]
impl RustReaderLists{
 #[wasm_bindgen(constructor)]
 pub fn new(panel:Element)->Result<Self,JsValue>{let document=panel.owner_document().ok_or_else(||JsValue::from_str("Document unavailable"))?;Ok(Self{document,panel,listeners:RefCell::new(HashMap::new())})}
 #[wasm_bindgen(js_name=renderToc)]
 pub fn render_toc(&self,items:JsValue,jump:Function)->Result<bool,JsValue>{
  let list=self.clear("toc","[data-toc]")?;let mut listeners=Vec::new();self.add_toc(&list,&items,0,&jump,&mut listeners)?;
  self.listeners.borrow_mut().insert("toc".to_owned(),listeners);let available=list.child_element_count()>0;let button=self.query("[data-place-tab=\"toc\"]")?;
  if available{button.remove_attribute("hidden")?;}else{attr(&button,"hidden","");}Ok(available)
 }
 #[wasm_bindgen(js_name=renderPlaces)]
 pub fn render_places(&self,name:&str,places:Array,labels:Array,select:Function,remove:Function,close_icon:&str)->Result<(),JsValue>{
  let empty=match name{"history"=>"Sin recientes","quotes"=>"Sin citas","bookmarks"=>"Sin marcadores",_=>return Err(JsValue::from_str("Unknown reader list"))};
  let list=self.clear(name,&format!("[data-{name}]"))?;let mut listeners=Vec::new();
  if places.length()==0{append(&list,&element(&self.document,"p","reading-hint",Some(empty))?);}
  for (index,place) in places.iter().enumerate(){
   let label=js_string(&labels.get(index as u32));let caption=if name=="quotes"{format!("“{}” · {label}",js_string(&prop(&place,"text")))}else{label.clone()};
   let row=element(&self.document,"div","reading-place",None)?;let button=self.button("",Some(&caption))?;
   listeners.push(listen(&button,&select,args(&[(index as f64).into(),place.clone()]))?);
   let remove_button=self.button("",None)?;remove_button.set_inner_html(close_icon);attr(&remove_button,"aria-label",&format!("Eliminar {label}"));
   listeners.push(listen(&remove_button,&remove,args(&[(index as f64).into(),place]))?);
   append(&row,&button);append(&row,&remove_button);append(&list,&row);
  }
  self.listeners.borrow_mut().insert(name.to_owned(),listeners);Ok(())
 }
 #[wasm_bindgen(js_name=clearSearch)]
 pub fn clear_search(&self,message:&str)->Result<(),JsValue>{self.clear("search","[data-search-results]")?;self.query("[data-search-status]")?.set_text_content(Some(message));Ok(())}
 #[wasm_bindgen(js_name=renderSearch)]
 pub fn render_search(&self,results:Array,select:Function)->Result<(),JsValue>{
  let list=self.clear("search","[data-search-results]")?;let mut listeners=Vec::new();let count=results.length();
  self.query("[data-search-status]")?.set_text_content(Some(&if count==0{"Sin resultados".to_owned()}else{format!("{count} {}",if count==1{"resultado"}else{"resultados"})}));
  for result in results.iter(){
   let button=self.button("reading-search-hit",None)?;let label=prop(&result,"label");
   if label.is_truthy(){let where_=element(&self.document,"small","",Some(&js_string(&label)))?;where_.remove_attribute("class")?;append(&button,&where_);}
   let line=element(&self.document,"span","",None)?;line.remove_attribute("class")?;let parts=prop(&result,"parts");
   let excerpt=prop(&result,"excerpt");let pre=fallback(prop(&parts,"pre"),if excerpt.is_truthy(){excerpt}else{"".into()});
   let matched=fallback(prop(&parts,"match"),"".into());let post=fallback(prop(&parts,"post"),"".into());
   if matched.is_truthy(){
    let mark=element(&self.document,"mark","",Some(&js_string(&matched)))?;mark.remove_attribute("class")?;
    line.append_child(&self.document.create_text_node(&js_string(&pre)))?;append(&line,&mark);line.append_child(&self.document.create_text_node(&js_string(&post)))?;
   }else{line.set_text_content(text_value(&pre).as_deref());}
   append(&button,&line);listeners.push(listen(&button,&select,args(&[result]))?);append(&list,&button);
  }
  self.listeners.borrow_mut().insert("search".to_owned(),listeners);Ok(())
 }
}
