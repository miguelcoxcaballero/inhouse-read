//! Retained IKEA catalogue view. Selection callbacks, studios and the camera
//! keep their host ownership; this component updates the existing DOM in place.
use std::{cell::RefCell,rc::Rc};
use wasm_bindgen::{prelude::*,JsCast};
use js_sys::{Array,Function};
use web_sys::{Document,Element,Event,HtmlButtonElement,HtmlElement};
use crate::{attr,Listener};

fn make(document:&Document,tag:&str,class:&str,text:Option<&str>)->Result<Element,JsValue>{
 let node=crate::element(document,tag,class,text)?;if class.is_empty(){node.remove_attribute("class")?;}Ok(node)
}
fn escaped(text:&str)->String{
 let mut output=String::with_capacity(text.len());for character in text.chars(){match character{'&'=>output.push_str("&amp;"),'<'=>output.push_str("&lt;"),'>'=>output.push_str("&gt;"),'"'=>output.push_str("&quot;"),_=>output.push(character)}}output
}
fn build_rows(root:&Element,packet:&str,only_colors:bool)->Result<(),JsValue>{
 if packet.len()>2*1024*1024{return Err(JsValue::from_str("Catalogue packet too large"));}
 let fields:Vec<&str>=if packet.is_empty(){Vec::new()}else{packet.split('\0').collect()};
 if fields.len()%9!=0||fields.len()>2048*9{return Err(JsValue::from_str("Incomplete catalogue rows"));}
 let mut html:[String;6]=std::array::from_fn(|_|String::new());let mut swatches:[Vec<String>;6]=std::array::from_fn(|_|Vec::new());
 for values in fields.chunks_exact(9){
  let kind=values[0];if only_colors&&kind!="color"{return Err(JsValue::from_str("Invalid catalogue color"));}
  let(index,icon)=match kind{"plant"=>(0,"thumbnail"),"pot"=>(1,"pot-thumbnail"),"shelf"=>(2,"shelf-icon"),"lamp"=>(3,"lamp-icon"),"kelvin"=>(4,"kelvin-swatch"),"color"=>(5,"swatch"),_=>return Err(JsValue::from_str("Unknown catalogue row"))};
  let output=&mut html[index];output.push_str(&format!("<button class=\"ihr-plant-catalog__{kind}\" type=\"button\" data-catalog-{kind}=\"{}\"",escaped(&values[1])));
  if !values[2].is_empty(){output.push_str(&format!(" aria-label=\"{}\"",escaped(&values[2])));}output.push('>');
  output.push_str(&format!("<span class=\"ihr-plant-catalog__{icon}\""));
  if index>=4{if kind=="color"{output.push_str(" aria-hidden=\"true\"");}swatches[index].push(values[8].to_owned());output.push('>');}
  else{output.push('>');output.push_str(&values[3]);}output.push_str("</span>");
  if kind=="shelf"||kind=="lamp"{
   output.push_str(&format!("<span class=\"ihr-plant-catalog__{kind}-option-caption\"><strong>{}</strong><span>{}</span>",escaped(&values[4]),escaped(&values[5])));
   if kind=="shelf"{output.push_str(&format!("<span>{}</span><span class=\"ihr-plant-catalog__shelf-current\"></span>",escaped(&values[6])));}
   else{output.push_str(&format!("<span class=\"ihr-plant-catalog__lamp-installation\">{}</span>",escaped(&values[7])));}output.push_str("</span>");
  }else{
   let class=if kind=="color"{" class=\"ihr-plant-catalog__color-name\""}else if kind=="kelvin"{""}else{" class=\"ihr-plant-catalog__option-name\""};output.push_str(&format!("<span{class}>{}</span>",escaped(&values[4])));
  }output.push_str("</button>");
 }
 for(index,list)in["plants","pots","shelves","lamps","kelvins","colors"].iter().enumerate(){
  if only_colors&&index!=5{continue}let node=query(root,&format!(".ihr-plant-catalog__{list}"))?;node.set_inner_html(&html[index]);
  if index>=4{let nodes=node.query_selector_all("button > span:first-child")?;for(i,color)in swatches[index].iter().enumerate(){let swatch=nodes.item(i as u32).ok_or_else(||JsValue::from_str("Missing catalogue swatch"))?.dyn_into::<HtmlElement>()?;swatch.style().set_property(if index==5{"background-color"}else{"background"},color)?;}}
 }Ok(())
}
#[wasm_bindgen]
pub fn catalog_build(document:Document,id:&str,logo:&str,items:&str)->Result<Element,JsValue>{
 let dialog=make(&document,"dialog","ihr-plant-catalog",None)?;attr(&dialog,"data-testid","plant-catalog");attr(&dialog,"aria-labelledby",&format!("{id}-title"));attr(&dialog,"aria-describedby",&format!("{id}-description"));
 dialog.set_inner_html(&include_str!("catalog_template.html").replace("__ID__",&escaped(id)));query(&dialog,".ihr-plant-catalog__brand")?.set_inner_html(logo);
 build_rows(&dialog,items,false)?;Ok(dialog)
}
#[wasm_bindgen]
pub fn catalog_colors(root:Element,items:&str)->Result<(),JsValue>{build_rows(&root,items,true)}

fn query(root:&Element,selector:&str)->Result<Element,JsValue>{
 root.query_selector(selector)?.ok_or_else(||JsValue::from_str("Missing catalogue element"))
}
struct Row{key:String,node:HtmlButtonElement,current:Option<Element>,pressed:Option<bool>,disabled:Option<bool>}
impl Row{
 fn paint(&mut self,key:&str,busy:bool,saved:Option<&str>){
  let pressed=self.key==key;
  if self.pressed!=Some(pressed){attr(&self.node,"aria-pressed",if pressed{"true"}else{"false"});self.pressed=Some(pressed);}
  if self.disabled!=Some(busy){self.node.set_disabled(busy);self.disabled=Some(busy);}
  if let Some(current)=&self.current{let text=if saved==Some(self.key.as_str()){"Actual"}else{""};if current.text_content().as_deref()!=Some(text){current.set_text_content(Some(text));}}
 }
}
fn rows(root:&Element,key:&str,shelf:bool)->Result<Vec<Row>,JsValue>{
 let nodes=root.query_selector_all(&format!("[data-catalog-{key}]"))?;let mut rows=Vec::with_capacity(nodes.length()as usize);
 for i in 0..nodes.length(){let node=nodes.item(i).ok_or_else(||JsValue::from_str("Missing catalogue row"))?.dyn_into::<HtmlButtonElement>()?;
  let value=node.get_attribute(&format!("data-catalog-{key}")).unwrap_or_default();
  let current=if shelf{Some(query(&node,".ihr-plant-catalog__shelf-current")?)}else{None};
  rows.push(Row{key:value,node,current,pressed:None,disabled:None});
 }Ok(rows)
}
struct Text{node:Element,last:Option<String>}
impl Text{fn paint(&mut self,value:&str){if self.last.as_deref()!=Some(value){self.node.set_text_content(Some(value));self.last=Some(value.to_owned());}}}
struct State{groups:Vec<Vec<Row>>,captions:Vec<Text>,title:Text,description:Text,page_number:Text,add_text:Option<String>,page:Option<String>,busy:Option<bool>,allowed:Option<bool>}
#[wasm_bindgen]
pub struct RustCatalogView{dialog:Element,bodies:[HtmlElement;3],add:HtmlButtonElement,state:RefCell<State>,listener:RefCell<Option<Listener>>}
#[wasm_bindgen]
impl RustCatalogView{
 #[wasm_bindgen(constructor)]
 pub fn new(dialog:Element)->Result<Self,JsValue>{
  let body=|selector:&str|->Result<HtmlElement,JsValue>{query(&dialog,selector)?.dyn_into::<HtmlElement>().map_err(Into::into)};
  let bodies=[body(".ihr-plant-catalog__body:not(.ihr-plant-catalog__body--shelves):not(.ihr-plant-catalog__body--lights)")?,body(".ihr-plant-catalog__body--shelves")?,body(".ihr-plant-catalog__body--lights")?];
  let mut groups=Vec::new();for key in ["page","kelvin","lamp","shelf","color","plant","pot"]{groups.push(rows(&dialog,key,key=="shelf")?);}
  let mut captions=Vec::new();for selector in [".ihr-plant-catalog__lamp-preview h3",".ihr-plant-catalog__lamp-preview .ihr-plant-catalog__caption > p:not(.ihr-plant-catalog__lamp-mount)",".ihr-plant-catalog__lamp-mount",".ihr-plant-catalog__shelf-preview h3",".ihr-plant-catalog__shelf-preview .ihr-plant-catalog__caption > p:not(.ihr-plant-catalog__shelf-dimensions)",".ihr-plant-catalog__shelf-dimensions",".ihr-plant-catalog__body:not(.ihr-plant-catalog__body--shelves):not(.ihr-plant-catalog__body--lights) h3",".ihr-plant-catalog__body:not(.ihr-plant-catalog__body--shelves):not(.ihr-plant-catalog__body--lights) .ihr-plant-catalog__caption > p:not(.ihr-plant-catalog__plant-size)",".ihr-plant-catalog__pot-name",".ihr-plant-catalog__color-caption",".ihr-plant-catalog__plant-size"]{captions.push(Text{node:query(&dialog,selector)?,last:None});}
  let text=|selector:&str|->Result<Text,JsValue>{Ok(Text{node:query(&dialog,selector)?,last:None})};
  let title=text(".ihr-plant-catalog__title")?;let description=text(".ihr-plant-catalog__description")?;let page_number=text(".ihr-plant-catalog__page-number")?;
  let add=query(&dialog,"[data-catalog-add]")?.dyn_into::<HtmlButtonElement>()?;
  Ok(Self{dialog,bodies,add,state:RefCell::new(State{groups,captions,title,description,page_number,add_text:None,page:None,busy:None,allowed:None}),listener:RefCell::new(None)})
 }
 pub fn connect(&self,select:Function)->Result<(),JsValue>{
  self.connect_native(Rc::new(move|kind:&str,id:&str|select.call2(&JsValue::UNDEFINED,&kind.into(),&id.into()).map(|_|())))
 }
 #[wasm_bindgen(js_name=syncColors)]
 pub fn sync_colors(&self)->Result<(),JsValue>{self.state.borrow_mut().groups[4]=rows(&self.dialog,"color",false)?;Ok(())}
 pub fn render(&self,frame:Array)->Result<(),JsValue>{
  if frame.length()!=21{return Err(JsValue::from_str("Incomplete catalogue frame"));}
  let mut values=Vec::with_capacity(19);for i in 0..19{values.push(frame.get(i).as_string().ok_or_else(||JsValue::from_str("Invalid catalogue text"))?);}
  let busy=frame.get(19).as_bool().ok_or_else(||JsValue::from_str("Invalid catalogue busy state"))?;
  let allowed=frame.get(20).as_bool().ok_or_else(||JsValue::from_str("Invalid catalogue action state"))?;
  self.render_native(&values,busy,allowed)
 }
}
impl RustCatalogView{
 /// Selection clicks reach `select(kind, id)`; the catalogue controller passes a Rust callback.
 pub(crate) fn connect_native(&self,select:Rc<dyn Fn(&str,&str)->Result<(),JsValue>>)->Result<(),JsValue>{
  let handler=Closure::wrap(Box::new(move|event:Event|{
   let Some(target)=event.target().and_then(|target|{
    if let Some(element)=target.dyn_ref::<Element>(){Some(element.clone())}else{target.dyn_into::<web_sys::Node>().ok().and_then(|node|node.parent_element())}
   })else{return};
   let Ok(Some(button))=target.closest("button")else{return};
   for kind in ["page","plant","pot","shelf","lamp","kelvin","color"]{if let Some(id)=button.get_attribute(&format!("data-catalog-{kind}")){
    if let Err(error)=select(kind,&id){wasm_bindgen::throw_val(error);}break;
   }}
  })as Box<dyn FnMut(Event)>);
  let target:web_sys::EventTarget=self.dialog.clone().into();target.add_event_listener_with_callback("click",handler.as_ref().unchecked_ref())?;
  *self.listener.borrow_mut()=Some(Listener{target,kind:"click",callback:handler,capture:false});Ok(())
 }
 pub(crate) fn render_native(&self,values:&[String],busy:bool,allowed:bool)->Result<(),JsValue>{
  let page=&values[0];let shelf=page=="shelves";let lamp=page=="lights";let mut state=self.state.borrow_mut();
  if state.page.as_deref()!=Some(page){
   attr(&self.dialog,"data-catalog-page",page);self.bodies[0].set_hidden(page!="plants");self.bodies[1].set_hidden(!shelf);self.bodies[2].set_hidden(!lamp);
   state.title.paint(if shelf{"ESTANTERÍAS"}else if lamp{"ILUMINACIÓN"}else{"PLANTAS"});
   state.description.paint(if shelf{"Estantería"}else if lamp{"Lámpara"}else{"Planta, maceta y color"});
   state.page_number.paint(if shelf{"02 / 03"}else if lamp{"03 / 03"}else{"01 / 03"});
   if shelf{attr(&self.add,"data-catalog-shelf-add","");}else{self.add.remove_attribute("data-catalog-shelf-add")?;}
   if lamp{attr(&self.add,"data-catalog-lamp-add","");}else{self.add.remove_attribute("data-catalog-lamp-add")?;}
   state.page=Some(page.to_owned());
  }
  let keys=[0,1,2,3,5,6,7];for (group,index)in keys.iter().enumerate(){for row in &mut state.groups[group]{row.paint(&values[*index],busy,if group==3{Some(&values[4])}else{None});}}
  for(i,text)in state.captions.iter_mut().enumerate(){text.paint(&values[8+i]);}
  if state.busy!=Some(busy){attr(&self.dialog,"aria-busy",if busy{"true"}else{"false"});state.busy=Some(busy);}
  let disabled=busy||!allowed;if state.allowed!=Some(!disabled){self.add.set_disabled(disabled);state.allowed=Some(!disabled);}
  let add_text=if shelf{if busy{"Cambiando…"}else{"Usar"}}else if busy{"Añadiendo…"}else{"Añadir"};
  if state.add_text.as_deref()!=Some(add_text){self.add.set_text_content(Some(add_text));state.add_text=Some(add_text.to_owned());}
  Ok(())
 }
}
