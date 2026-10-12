//! Picker reconciliation runs beside its DOM view, without re-entering JS
//! wrappers for each row, availability decision and progress update.
use wasm_bindgen::{prelude::*,JsCast};
use js_sys::{Array,Function,Math,Map,Set,Object};
use std::collections::HashMap;
use web_sys::Element;
use crate::neural_view::RustNeuralView;
use crate::reader_actions::{get,set,call,one,invoke};
use crate::picker_policy::{picker_state,picker_offer_for};
enum AvailabilityState{Installed,Downloading(JsValue),Error(JsValue),Idle}
impl AvailabilityState{
 fn name(&self)->&str{match self{Self::Installed=>"installed",Self::Downloading(_)=>"downloading",Self::Error(_)=>"error",Self::Idle=>"idle"}}
 fn value(self)->Result<JsValue,JsValue>{let result=Object::new();set(&result,"name",&self.name().into())?;match self{Self::Downloading(value)=>set(&result,"download",&value)?,Self::Error(value)=>set(&result,"message",&value)?,_=>{}}Ok(result.into())}
}
struct Availability{installed:Set,downloads:Option<Map>,tasks:Map,errors:Map,messages:JsValue}
impl Availability{
 fn new(host:&JsValue,engine:&JsValue,messages:&JsValue)->Result<Self,JsValue>{let downloads=get(engine,"downloads")?;Ok(Self{installed:get(engine,"installed")?.unchecked_into(),downloads:if absent(&downloads){None}else{Some(downloads.unchecked_into())},tasks:get(host,"tasks")?.unchecked_into(),errors:get(host,"errors")?.unchecked_into(),messages:messages.clone()})}
 fn state(&self,voice:&JsValue)->Result<AvailabilityState,JsValue>{
  let id=get(voice,"id")?;let download=self.downloads.as_ref().map(|map|map.get(&id)).unwrap_or(JsValue::UNDEFINED);
  if self.installed.has(&id){return Ok(AvailabilityState::Installed);}
  if self.tasks.has(&id)||optional(&download,"state")?==JsValue::from_str("downloading"){return Ok(AvailabilityState::Downloading(download));}
  if self.errors.has(&id)||optional(&download,"state")?==JsValue::from_str("error"){
   let mut message=self.errors.get(&id);if !message.is_truthy(){message=js_sys::Reflect::get(&self.messages,&optional(&download,"code")?)?;}if !message.is_truthy(){message=get(&self.messages,"default")?;}
   return Ok(AvailabilityState::Error(message));
  }Ok(AvailabilityState::Idle)
 }
}
pub(crate) struct PickerServices {
 engine:Function,list:Function,order:Function,language:Function,url:Function,
 base:Function,recommend:Function,cancel:Function,device:Function,messages:JsValue,warnings:JsValue,
}
fn function(value:&JsValue,key:&str)->Result<Function,JsValue>{get(value,key)?.dyn_into().map_err(|_|js_sys::TypeError::new("Missing picker service").into())}
impl PickerServices {
 fn new(v:JsValue)->Result<Self,JsValue>{Ok(Self{engine:function(&v,"engine")?,list:function(&v,"list")?,order:function(&v,"order")?,language:function(&v,"language")?,url:function(&v,"url")?,base:function(&v,"base")?,recommend:function(&v,"recommend")?,cancel:function(&v,"cancel")?,device:function(&v,"device")?,messages:get(&v,"messages")?,warnings:get(&v,"warnings")?})}
 fn voices(&self,engine:&JsValue)->Result<Array,JsValue>{self.list.call1(&JsValue::UNDEFINED,engine)?.dyn_into().map_err(|_|js_sys::TypeError::new("Voice list is not an array").into())}
 fn state(&self,host:&JsValue,engine:&JsValue,voice:&JsValue)->Result<JsValue,JsValue>{Ok(picker_state(host.clone(),engine.clone(),voice.clone(),self.messages.clone())?.into())}
 fn offered(&self,host:&JsValue,engine:&JsValue,voices:&Array)->Result<JsValue,JsValue>{picker_offer_for(host.clone(),engine.clone(),voices.clone(),self.base.clone(),self.recommend.clone(),self.device.call0(&JsValue::UNDEFINED)?)}
}
fn shown(node:&Element,value:bool)->Result<(),JsValue>{if value{node.remove_attribute("hidden")}else{node.set_attribute("hidden","")}}
fn query(node:&Element,selector:&str)->Result<Element,JsValue>{node.query_selector(selector)?.ok_or_else(||JsValue::from_str("Missing voice control"))}
fn absent(value:&JsValue)->bool{value.is_null()||value.is_undefined()}
fn optional(value:&JsValue,key:&str)->Result<JsValue,JsValue>{if absent(value){Ok(JsValue::UNDEFINED)}else{get(value,key)}}
#[wasm_bindgen]extern "C"{
 #[wasm_bindgen(catch,js_name=Number)]fn number(value:&JsValue)->Result<f64,JsValue>;
 #[wasm_bindgen(catch,js_name=String)]fn string(value:&JsValue)->Result<String,JsValue>;
}
impl RustNeuralView {
 fn row_native(&self,engine:&JsValue,voice:JsValue,availability:&Availability,selected_id:&JsValue)->Result<Element,JsValue>{
  let services=self.services()?;let mut expansion=false;
  if get(&voice,"sharedPack")?.is_truthy()&&number(&get(&voice,"upgradeBytes")?)?>0.0{
   let prefix=format!("{}:",string(&get(&voice,"modelKey")?)?);
   for id in js_sys::try_iter(&get(&engine,"installed")?)?.ok_or_else(||js_sys::TypeError::new("Installed voices not iterable"))?{if string(&id?)?.starts_with(&prefix){expansion=true;break;}}
  }
  let size=Math::round(if expansion{number(&get(&voice,"upgradeBytes")?)?/1e6}else{number(&get(&voice,"sizeMB")?)?});
  let license=get(&voice,"licenseUrl")?;let license=if license.is_truthy(){services.url.call1(&JsValue::UNDEFINED,&license)?.as_string().unwrap_or_default()}else{String::new()};
  let state=availability.state(&voice)?.value()?;
  let selected=*selected_id==get(&voice,"id")?;
  let language=services.language.call1(&JsValue::UNDEFINED,&get(&voice,"lang")?)?.as_string().unwrap_or_default();
  self.row(voice,state,selected,expansion,&language,size,&license)
 }
 fn services(&self)->Result<&PickerServices,JsValue>{self.picker.as_ref().ok_or_else(||JsValue::from_str("Picker services not configured"))}
 fn offered_row(&self,host:&JsValue,engine:&JsValue,list:&Array)->Result<(),JsValue>{let services=self.services()?;let voice=services.offered(host,engine,list)?;let state=if voice.is_truthy(){services.state(host,engine,&voice)?}else{JsValue::NULL};self.render_offer(voice,state)}
 fn paint_native_download(&self,node:&Element,state:AvailabilityState,voice:&JsValue)->Result<bool,JsValue>{
  let AvailabilityState::Downloading(download)=state else{return Ok(true)};
  let Some(wrap)=node.query_selector(".reading-neural-progress")?else{return Ok(false)};
  self.paint_progress(wrap,download,voice.clone())?;Ok(true)
 }
}
#[wasm_bindgen]
impl RustNeuralView {
 #[wasm_bindgen(js_name=configurePicker)]
 pub fn configure_picker(&mut self,services:JsValue)->Result<(),JsValue>{self.picker=Some(PickerServices::new(services)?);Ok(())}
 #[wasm_bindgen(js_name=pickerRow)]
 pub fn picker_row_owned(&self,host:JsValue,engine:JsValue,voice:JsValue)->Result<Element,JsValue>{
  let availability=Availability::new(&host,&engine,&self.services()?.messages)?;
  self.row_native(&engine,voice,&availability,&get(&get(&get(&host,"host")?,"preferences")?,"voice")?)
 }
 #[wasm_bindgen(js_name=renderPicker)]
 pub fn render_picker_owned(&self,host:JsValue)->Result<(),JsValue>{
  let services=self.services()?;services.cancel.call1(&JsValue::UNDEFINED,&get(&host,"frame")?)?;set(&host,"frame",&0.into())?;
  let engine=services.engine.call0(&JsValue::UNDEFINED)?;let voices=if engine.is_truthy(){services.voices(&engine)?}else{Array::new()};
  let signature=if engine.is_truthy(){let entries=Array::from(&get(&engine,"installed")?);call(&entries,"sort")?;one(&entries,"join",&",".into())?}else{"".into()};
  set(&host,"signature",&signature)?;shown(&self.block,voices.length()>0)?;
  if voices.length()==0{shown(&self.offer,false)?;self.offer.set_text_content(None);return Ok(());}
  let focus=self.focus_key()?;let owner=get(&host,"host")?;let filter=get(&owner,"voiceBaseShown")?;
  let ordered:Array=services.order.call3(&JsValue::UNDEFINED,&voices,&get(&host,"bookLang")?,&services.device.call0(&JsValue::UNDEFINED)?)?.dyn_into()?;
  let mut visible=Vec::new();for voice in ordered.iter(){if !filter.is_truthy()||get(&voice,"base")?==filter{visible.push(voice);}}
  shown(&self.block,!visible.is_empty())?;
  let reason=optional(&get(&owner,"voice")?,"neuralOff")?;
  shown(&query(&self.block,"[data-neural-warning]")?,reason.is_truthy())?;
  let text=query(&self.block,"[data-neural-warning-text]")?;
  let warning=if reason.is_truthy(){let value=js_sys::Reflect::get(&services.warnings,&reason)?;if value.is_truthy(){value}else{get(&services.warnings,"default")?}}else{"".into()};
  set(&text,"textContent",&warning)?;
  let list=query(&self.block,"[data-neural-list]")?;let rows=Array::new();
  let availability=Availability::new(&host,&engine,&services.messages)?;let selected_id=get(&get(&owner,"preferences")?,"voice")?;
  for voice in visible{rows.push(&self.row_native(&engine,voice,&availability,&selected_id)?.into());}
  invoke(&list,"replaceChildren",&rows)?;
  self.offered_row(&host,&engine,&voices)?;self.restore_focus(focus)?;Ok(())
 }
 #[wasm_bindgen(js_name=patchPickerProgress)]
 pub fn patch_picker_owned(&self,host:JsValue,engine:JsValue)->Result<bool,JsValue>{
  let services=self.services()?;let voices=services.voices(&engine)?;
  if self.block.has_attribute("hidden")||voices.length()==0{return Ok(false);}
  let availability=Availability::new(&host,&engine,&services.messages)?;
  let mut by_id=HashMap::new();for voice in voices.iter(){if let Some(id)=get(&voice,"id")?.as_string(){by_id.entry(id).or_insert(voice);}}
  let nodes=self.block.query_selector_all("[data-neural-voice]")?;
  for i in 0..nodes.length(){
   let Some(item)=nodes.item(i).and_then(|n|n.dyn_into::<Element>().ok())else{continue};
   let id=item.get_attribute("data-neural-voice").unwrap_or_default();
   let Some(voice)=by_id.get(&id)else{return Ok(false)};let state=availability.state(voice)?;
   if item.get_attribute("data-state").as_deref()!=Some(state.name()){return Ok(false);}
   if !self.paint_native_download(&item,state,voice)?{return Ok(false);}
  }
  let offered=services.offered(&host,&engine,&voices)?;let id=optional(&offered,"id")?;let id=if id.is_truthy(){string(&id)?}else{String::new()};
  if id!=self.offer.get_attribute("data-voice").unwrap_or_default(){return Ok(false);}
  if offered.is_truthy(){let state=availability.state(&offered)?;if self.offer.get_attribute("data-state").as_deref()!=Some(state.name()){return Ok(false);}if !self.paint_native_download(&self.offer,state,&offered)?{return Ok(false);}}
  Ok(true)
 }
}
