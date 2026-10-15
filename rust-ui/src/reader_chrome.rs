//! Reader chrome: original DOM, audiobook status and keyboard-aware panel layout.
//! Browser values and callbacks stay borrowed handles; no book content is copied.
use wasm_bindgen::{prelude::*,JsCast};
use js_sys::Function;
use web_sys::Element;
use crate::reader_actions::{get,set,call,one,two};
fn node(host:&JsValue,key:&str)->Result<Element,JsValue>{get(host,key)?.dyn_into()}
fn query(root:&Element,selector:&str)->Result<Element,JsValue>{root.query_selector(selector)?.ok_or_else(||JsValue::from_str("Missing reader chrome"))}
fn absent(value:&JsValue)->bool{value.is_null()||value.is_undefined()}
#[wasm_bindgen]
extern "C"{#[wasm_bindgen(catch,js_name=Number)]fn number(value:&JsValue)->Result<f64,JsValue>;}
#[wasm_bindgen]
pub fn reader_create_chrome(host:JsValue,panel_markup:String,mini_markup:String,on_return:Function,doc:web_sys::Document)->Result<(),JsValue>{
 for (key,id) in [("screen","reader-screen"),("toolbar","reader-toolbar"),("locationButton","reader-location")]{
  set(&host,key,&doc.get_element_by_id(id).map(JsValue::from).unwrap_or(JsValue::NULL))?;
 }
 let back=doc.create_element("button")?;set(&host,"returnButton",&back)?;
 set(&back,"type",&"button".into())?;back.set_class_name("reader-return");set(&back,"hidden",&JsValue::TRUE)?;
 back.add_event_listener_with_callback("click",&on_return)?;
 let audio=doc.create_element("div")?;set(&host,"audioHost",&audio)?;audio.set_class_name("reader-audio-dock");
 node(&host,"screen")?.append_child(&audio)?;audio.append_child(&back)?;
 let panel=doc.create_element("dialog")?;set(&host,"panel",&panel)?;panel.set_class_name("reading-panel");panel.set_id("reading-controls");
 for id in ["reader-settings","reader-location","reader-audio"]{
  let button=doc.get_element_by_id(id).ok_or_else(||JsValue::from_str("Missing reader shortcut"))?;
  for (name,value) in [("aria-haspopup","dialog"),("aria-controls","reading-controls"),("aria-expanded","false")]{button.set_attribute(name,value)?;}
 }
 panel.set_inner_html(&panel_markup);panel.set_attribute("aria-labelledby","reading-panel-title")?;
 let mini=doc.create_element("div")?;set(&host,"miniPlayer",&mini)?;mini.set_class_name("reading-mini-player");set(&mini,"hidden",&JsValue::TRUE)?;
 mini.set_inner_html(&mini_markup);audio.append_child(&mini)?;Ok(())
}
#[wasm_bindgen]
pub fn reader_voice_state(host:JsValue,state:JsValue,message:JsValue,doc:web_sys::Document)->Result<(),JsValue>{
 let playing=state==JsValue::from_str("playing");let paused=state==JsValue::from_str("paused");let loading=state==JsValue::from_str("loading");
 let label=if playing{"Pausar"}else if paused{"Continuar"}else if loading{"Preparando…"}else{"Reproducir"};
 query(&node(&host,"panel")?,"[data-play]")?.set_attribute("aria-label",label)?;
 let button=query(&node(&host,"panel")?,"[data-play]")?;set(&button,"innerHTML",&JsValue::from_str(&crate::reader_markup::icon(if playing{"pause"}else{"play"})))?;
 set(query(&node(&host,"panel")?,"[data-play]")?.as_ref(),"disabled",&loading.into())?;
 let status=query(&node(&host,"panel")?,".reading-audio-status")?;
 set(&status,"textContent",&if message.is_truthy(){message.clone()}else{JsValue::from_str(if playing{"Leyendo"}else if paused{"En pausa"}else{"Detenido"})})?;
 doc.get_element_by_id("reader-audio").ok_or_else(||JsValue::from_str("Missing audio button"))?.class_list().toggle_with_force("is-playing",playing)?;
 if state==JsValue::from_str("stopped"){one(&host,"setSleepChoice",&0.into())?;}
 two(&host,"updateMiniPlayer",&state,&message)?;call(&host,"updateReturnButton")?;
 if paused&&!get(&get(&host,"voice")?,"neuralOff")?.is_truthy(){let picker=get(&host,"neuralPicker")?;if !absent(&picker){call(&picker,"warmUp")?;}}
 let picker=get(&host,"neuralPicker")?;if !absent(&picker){call(&picker,"render")?;}Ok(())
}
#[wasm_bindgen]
pub fn reader_resize_panel(host:JsValue,window:JsValue)->Result<bool,JsValue>{
 if !get(&get(&host,"panel")?,"open")?.is_truthy(){return Ok(false);}
 let viewport=get(&window,"visualViewport")?;
 let visible=if absent(&viewport){JsValue::UNDEFINED}else{get(&viewport,"height")?};
 let visible=number(&if visible.is_truthy(){visible}else{get(&window,"innerHeight")?})?;
 let offset=if absent(&viewport){JsValue::UNDEFINED}else{get(&viewport,"offsetTop")?};
 let offset=if offset.is_truthy(){number(&offset)?}else{0.0};
 let keyboard=js_sys::Math::max(0.0,number(&get(&window,"innerHeight")?)?-visible-offset);
 let anchor=if !JsValue::from_f64(keyboard).is_truthy()&&number(&get(&window,"innerWidth")?)?>=760.0{node(&host,"toolbar")?.get_bounding_client_rect().height()+12.0}else{0.0};
 let max=js_sys::Math::max(0.0,js_sys::Math::min(visible-anchor-16.0,number(&get(&window,"innerHeight")?)?*0.82));
 let style=get(&get(&host,"panel")?,"style")?;set(&style,"maxHeight",&format!("{}px",crate::js_string(&max.into())).into())?;
 let style=get(&get(&host,"panel")?,"style")?;set(&style,"bottom",&format!("{}px",crate::js_string(&(keyboard+anchor).into())).into())?;
 Ok(true)
}
#[wasm_bindgen]
pub fn reader_reveal_field(host:JsValue,doc:web_sys::Document)->Result<(),JsValue>{
 let active=doc.active_element();let panel=node(&host,"panel")?;
 if !get(&panel,"open")?.is_truthy()||!panel.contains(active.as_ref().map(|v|v.unchecked_ref())){return Ok(());}
 let active=active.ok_or_else(||JsValue::from_str("Missing active field"))?;if !active.matches("input,select")?{return Ok(());}
 let field=active.get_bounding_client_rect();let rect=node(&host,"panel")?.get_bounding_client_rect();
 if field.bottom()>rect.bottom()-16.0{let panel=get(&host,"panel")?;let scroll=number(&get(&panel,"scrollTop")?)?;set(&panel,"scrollTop",&(scroll+(field.bottom()-rect.bottom()+16.0)).into())?;}
 else if field.top()<rect.top()+60.0{let panel=get(&host,"panel")?;let scroll=number(&get(&panel,"scrollTop")?)?;set(&panel,"scrollTop",&(scroll-(rect.top()+60.0-field.top())).into())?;}Ok(())
}
