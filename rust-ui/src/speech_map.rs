//! Exact DOM text maps and range lookups. Results retain ordinary JS nodes;
//! no long-lived Rust allocation owns an open book or requires a GC finalizer.
use wasm_bindgen::{prelude::*,JsCast};
use js_sys::{Array,JsString,Object,Reflect};
use web_sys::{Document,Element,Node};
#[wasm_bindgen]
extern "C" {
 #[wasm_bindgen(extends=Object)] type Span;
 #[wasm_bindgen(method,getter)] fn node(this:&Span)->Node;
 #[wasm_bindgen(method,getter)] fn start(this:&Span)->f64;
 #[wasm_bindgen(method,getter)] fn end(this:&Span)->f64;
 #[wasm_bindgen(method,setter,js_name=node)] fn set_node(this:&Span,value:&Node);
 #[wasm_bindgen(method,setter,js_name=start)] fn set_start(this:&Span,value:u32);
 #[wasm_bindgen(method,setter,js_name=end)] fn set_end(this:&Span,value:u32);
 #[wasm_bindgen(extends=Object)] type Style;
 #[wasm_bindgen(method,getter)] fn display(this:&Style)->JsValue;
 #[wasm_bindgen(method,getter)] fn visibility(this:&Style)->JsValue;
 #[wasm_bindgen(extends=Node)] type TextNode;
 #[wasm_bindgen(method,getter,js_name=nodeValue)] fn text(this:&TextNode)->JsValue;
}
fn node_text(node:&Node)->JsValue{node.unchecked_ref::<TextNode>().text()}
fn prop(value:&JsValue,key:&str)->JsValue{Reflect::get(value,&JsValue::from_str(wasm_bindgen::intern(key))).unwrap_or(JsValue::UNDEFINED)}
fn set(object:&Object,key:&str,value:&JsValue)->Result<(),JsValue>{Reflect::set(object,&JsValue::from_str(wasm_bindgen::intern(key)),value)?;Ok(())}
fn skipped(name:&str)->bool{matches!(name,"script"|"style"|"noscript"|"template"|"head"|"title"|"rt"|"rp"|"svg"|"math")}
fn is_block(name:&str)->bool{matches!(name,"address"|"article"|"aside"|"blockquote"|"dd"|"details"|"div"|"dl"|"dt"|"fieldset"|"figcaption"|"figure"|"footer"|"form"|"h1"|"h2"|"h3"|"h4"|"h5"|"h6"|"header"|"hr"|"li"|"main"|"nav"|"ol"|"p"|"pre"|"section"|"summary"|"table"|"tbody"|"td"|"tfoot"|"th"|"thead"|"tr"|"ul"|"body"|"html")}
fn hard(name:&str)->bool{matches!(name,"h1"|"h2"|"h3"|"h4"|"h5"|"h6"|"li"|"dt"|"dd"|"th"|"td"|"caption"|"figcaption"|"summary")}
fn not_rendered(element:&Element,window:Option<&web_sys::Window>)->bool{
 if element.has_attribute(wasm_bindgen::intern("hidden"))||element.get_attribute(wasm_bindgen::intern("aria-hidden")).as_deref()==Some("true"){return true;}
 let style=window.and_then(|window|window.get_computed_style(element).ok().flatten()).map(JsValue::from).unwrap_or_else(||prop(element,"style"));
 if style.is_null()||style.is_undefined(){return false;}let style=style.unchecked_ref::<Style>();if style.display()==JsValue::from_str(wasm_bindgen::intern("none")){return true;}
 let visibility=style.visibility();visibility==JsValue::from_str(wasm_bindgen::intern("hidden"))||visibility==JsValue::from_str(wasm_bindgen::intern("collapse"))
}
struct Cursor {next:Option<Node>,block:u32,ancestor_hard:u32,block_hard:u32}
fn span(spans:&Array,node:&Node,start:u32,end:u32){let value=Object::new().unchecked_into::<Span>();value.set_node(node);value.set_start(start);value.set_end(end);spans.push(&value);}
#[wasm_bindgen]
pub fn speech_map(root:JsValue,mode:u32)->Result<JsValue,JsValue>{
 let spans=Array::new();let mut text=JsString::from("");let mut doc=JsValue::NULL;
 if !root.is_null()&&!root.is_undefined(){
  let node=root.unchecked_ref::<Node>();doc=node.owner_document().map(JsValue::from).unwrap_or_else(||root.clone());
  if mode==2{let value=node_text(node);if value.is_truthy(){text=value.unchecked_into::<JsString>();span(&spans,node,0,text.length());}}
  else{
   let document=doc.unchecked_ref::<Document>();let window=document.default_view();
   let initial=if node.node_type()==1{1}else{0};
   let initial_hard=if initial!=0&&hard(&node.unchecked_ref::<Element>().local_name()){1}else{0};let mut next_id=2u32;
   let mut stack=vec![Cursor{next:node.first_child(),block:initial,ancestor_hard:initial_hard,block_hard:initial_hard}];
   let mut text_length=0u32;let mut pending=false;let mut last_block=0;let mut last_hard=0;let mut separator=" ";
   while let Some(frame)=stack.last_mut(){
    let Some(item)=frame.next.take() else {stack.pop();continue};frame.next=item.next_sibling();
    let kind=item.node_type();let element=if kind==1{Some(item.unchecked_ref::<Element>())}else{None};
    let mut block=frame.block;let mut ancestor_hard=frame.ancestor_hard;let mut block_hard=frame.block_hard;
    if let Some(element)=element{
     let name=element.local_name();if mode==0&&(skipped(&name)||not_rendered(element,window.as_ref())){continue;}
     if name=="br"{if mode==0{pending=true;}else if mode==1{separator="\n";}}
     if mode==0{let id=next_id;next_id+=1;if hard(&name){ancestor_hard=id;}if is_block(&name){block=id;block_hard=ancestor_hard;}}
    }else if kind==3{
     let value=node_text(&item);if value.is_truthy(){let value=value.unchecked_into::<JsString>();
      if mode==0{if text_length>0&&(pending||block!=last_block){let split=if (block_hard!=0||last_hard!=0)&&(pending||block_hard!=last_hard){"\u{2029}"}else{"\n"};text=text.concat(&split.into());text_length+=1;}pending=false;last_block=block;last_hard=block_hard;}
      else if mode==1{if text_length>0{text=text.concat(&separator.into());text_length+=1;}separator=" ";}
      let end=text_length+value.length();span(&spans,&item,text_length,end);text_length=end;text=text.concat(&value);
     }
    }
    if kind!=3{if let Some(child)=item.first_child(){stack.push(Cursor{next:Some(child),block,ancestor_hard,block_hard});}}
   }
  }
 }
 let output=Object::new();set(&output,"text",&text)?;set(&output,"spans",&spans)?;set(&output,"doc",&doc)?;Ok(output.into())
}
fn dom_offset(value:f64)->u32{if value.is_finite(){value.trunc().rem_euclid(4294967296.0) as u32}else{0}}
fn span_start(value:&JsValue)->f64{value.unchecked_ref::<Span>().start()}
fn span_end(value:&JsValue)->f64{value.unchecked_ref::<Span>().end()}
fn span_node(value:&JsValue)->Node{value.unchecked_ref::<Span>().node()}
fn span_at(spans:&Array,offset:f64)->i32{let mut low=0i32;let mut high=spans.length() as i32-1;let mut found=-1;while low<=high{let mid=(low+high)>>1;if span_start(&spans.get(mid as u32))<=offset{found=mid;low=mid+1;}else{high=mid-1;}}found}
#[wasm_bindgen]
pub fn speech_range(doc:JsValue,spans:Array,start:f64,end:f64)->Result<JsValue,JsValue>{
 if spans.length()==0||!(end>start){return Ok(JsValue::NULL);}let mut a=span_at(&spans,start);let b=span_at(&spans,end-1.0);
 if a<0{a=0;}else if start>=span_end(&spans.get(a as u32)){a+=1;}if b<0||a>=spans.length() as i32||b<a{return Ok(JsValue::NULL);}
 let first=spans.get(a as u32);let last=spans.get(b as u32);let from=span_node(&first);let to=span_node(&last);
 let range=doc.unchecked_ref::<Document>().create_range()?;range.set_start(&from,dom_offset((start-span_start(&first)).max(0.0)))?;
 let length=node_text(&to).unchecked_into::<JsString>().length();range.set_end(&to,dom_offset((end-span_start(&last)).min(length as f64)))?;Ok(range.into())
}
#[wasm_bindgen]
pub fn speech_offset(doc:JsValue,spans:Array,container:Node,offset:f64)->Result<f64,JsValue>{
 if spans.length()==0{return Ok(0.0);}let point=doc.unchecked_ref::<Document>().create_range()?;point.set_start(&container,dom_offset(offset))?;point.collapse_with_to_start(true);
 let mut low=0;let mut high=spans.length();while low<high{let mid=(low+high)>>1;let node=span_node(&spans.get(mid));let length=node_text(&node).unchecked_into::<JsString>().length();if point.compare_point(&node,length)?>0{high=mid;}else{low=mid+1;}}
 if low>=spans.length(){return Ok(span_end(&spans.get(spans.length()-1)));}let span=spans.get(low);let start=span_start(&span);Ok(if span_node(&span)==container{start+offset}else{start})
}
