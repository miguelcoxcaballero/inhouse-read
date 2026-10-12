//! Per-document narration highlights. Painting never changes page content,
//! selection or pagination; the registry belongs to the range's own window.
use wasm_bindgen::{prelude::*,JsCast};
use js_sys::{Array,Function,JsString,Reflect};
use web_sys::{Document,Element};
fn prop(value:&JsValue,key:&str)->JsValue{Reflect::get(value,&JsValue::from_str(wasm_bindgen::intern(key))).unwrap_or(JsValue::UNDEFINED)}
const KEY:&str="inhouse-speech";
fn theme_index(theme:&str)->usize{match theme{"sepia"=>1,"night"=>2,"amoled"=>3,"sage"=>4,_=>0}}
const TINTS:[&str;5]=["rgba(226,166,48,.40)","rgba(200,108,24,.40)","rgba(236,184,76,.42)","rgba(244,192,84,.44)","rgba(196,128,24,.38)"];
const OVERLAYS:[&str;5]=["#d9a23a","#c4701c","#ecb84c","#f4c054","#be821e"];
thread_local!{static CSS:[JsString;5]=std::array::from_fn(|i|{let tint=TINTS[i];JsString::from(format!("::highlight({KEY}) {{ background-color:{tint}; color:inherit; }}\n.inhouse-speech-current {{ background-color:{tint}; border-radius:2px; }}"))});}
#[wasm_bindgen]
pub fn speech_overlay(theme:&str)->String{OVERLAYS[theme_index(theme)].into()}
#[wasm_bindgen]
pub fn speech_css(theme:&str)->JsString{CSS.with(|css|css[theme_index(theme)].clone())}
#[wasm_bindgen]
pub fn speech_style(doc:JsValue,theme:&str)->Result<(),JsValue>{
 if doc.is_null()||doc.is_undefined(){return Ok(());}
 let mut parent=prop(&doc,"head");if !parent.is_truthy(){parent=prop(&doc,"documentElement");}if !parent.is_truthy(){return Ok(());}
 let parent=parent.unchecked_into::<Element>();let style=if let Some(style)=parent.query_selector(wasm_bindgen::intern("style[data-inhouse-speech]"))?{style}else{
  let style=doc.unchecked_ref::<Document>().create_element("style")?;style.set_attribute(wasm_bindgen::intern("data-inhouse-speech"),"")?;parent.append_child(&style)?;style
 };
 let css=JsValue::from(speech_css(theme));if prop(&style,"textContent")!=css{Reflect::set(&style,&JsValue::from_str(wasm_bindgen::intern("textContent")),&css)?;}Ok(())
}
fn registry(doc:&JsValue)->Option<(JsValue,Function)>{
 let win=prop(doc,"defaultView");let registry=prop(&prop(&win,"CSS"),"highlights");let highlight=prop(&win,"Highlight");
 if registry.is_truthy()&&highlight.is_truthy(){Some((registry,highlight.unchecked_into::<Function>()))}else{None}
}
#[wasm_bindgen]
pub fn speech_can_paint(doc:JsValue)->bool{registry(&doc).is_some()}
#[wasm_bindgen]
pub fn speech_paint(range:JsValue)->Result<bool,JsValue>{
 let doc=prop(&prop(&range,"startContainer"),"ownerDocument");let Some((registry,constructor))=registry(&doc)else{return Ok(false)};
 let args=Array::new();args.push(&range);let highlight=Reflect::construct(&constructor,&args)?;
 prop(&registry,"set").dyn_into::<Function>()?.call2(&registry,&JsValue::from_str(wasm_bindgen::intern(KEY)),&highlight)?;Ok(true)
}
#[wasm_bindgen]
pub fn speech_clear(doc:JsValue)->Result<(),JsValue>{if let Some((registry,_))=registry(&doc){prop(&registry,"delete").dyn_into::<Function>()?.call1(&registry,&JsValue::from_str(wasm_bindgen::intern(KEY)))?;}Ok(())}

fn number(value:&JsValue,key:&str)->f64{prop(value,key).as_f64().unwrap_or(f64::NAN)}
/// The full painted range determines visibility, including wrapped lines.
#[wasm_bindgen]
pub fn speech_follow(rects:JsValue,viewport:JsValue)->Result<JsValue,JsValue>{
 if rects.is_null()||rects.is_undefined(){return Ok(JsValue::NULL);}
 let mut top=f64::INFINITY;let mut bottom=f64::NEG_INFINITY;let mut left=f64::INFINITY;let mut right=f64::NEG_INFINITY;
 for rect in Array::from(&rects).iter(){
  let t=number(&rect,"top");let b=number(&rect,"bottom");let l=number(&rect,"left");let r=number(&rect,"right");
  if [t,b,l,r].iter().all(|value|value.is_finite())&&b>=t&&r>=l{top=top.min(t);bottom=bottom.max(b);left=left.min(l);right=right.max(r);}
 }
 let vt=number(&viewport,"top");let vb=number(&viewport,"bottom");let vl=number(&viewport,"left");let vr=number(&viewport,"right");let width=number(&viewport,"width");let height=number(&viewport,"height");
 if !top.is_finite()||![vt,vb,vl,vr,width,height].iter().all(|value|value.is_finite())||width<=0.0||height<=0.0{return Ok(JsValue::NULL);}
 let lower=bottom>vb-24.0||top<vt+8.0;let side=right>vr||left<vl;if !lower&&!side{return Ok(JsValue::NULL);}
 let output=js_sys::Object::new();
 Reflect::set(&output,&"top".into(),&JsValue::from_f64(if lower{top-vt-(height*0.3).min((height-(bottom-top)-24.0).max(8.0))}else{0.0}))?;
 Reflect::set(&output,&"left".into(),&JsValue::from_f64(if side{left-vl-(width*0.15).min((width-(right-left)).max(0.0))}else{0.0}))?;Ok(output.into())
}
