//! Voice catalogue DOM. Download ownership and playback remain with the engine.
use wasm_bindgen::{prelude::*,JsCast};
use js_sys::{Math,Object,Reflect};
use web_sys::{Document,Element,HtmlElement};
use crate::{attr,append,prop,js_string,focus};

fn string(value:&JsValue,key:&str)->String{js_string(&prop(value,key))}
#[wasm_bindgen]
extern "C" { #[wasm_bindgen(js_name=Number)] fn js_number(value:&JsValue)->f64; }
fn number(value:JsValue)->f64{js_number(&value)}
fn numeric(value:&JsValue,key:&str)->f64{number(prop(value,key))}
fn shown(node:&Element,visible:bool)->Result<(),JsValue>{if visible{node.remove_attribute("hidden")}else{node.set_attribute("hidden","")}}
fn set(object:&Object,key:&str,value:&JsValue)->Result<(),JsValue>{Reflect::set(object,&key.into(),value)?;Ok(())}

#[wasm_bindgen]
pub struct RustNeuralView{document:Document,panel:Element,block:Element,offer:Element}
impl RustNeuralView{
 fn node(&self,tag:&str,class:&str,text:Option<&str>)->Result<Element,JsValue>{
  let node=self.document.create_element(tag)?;if !class.is_empty(){node.set_class_name(class);}if let Some(text)=text{node.set_text_content(Some(text));}Ok(node)
 }
 fn button(&self,label:&str,action:&str,id:&str,class:&str,aria:&str)->Result<Element,JsValue>{
  let class=if class.is_empty(){"reading-neural-btn".to_owned()}else{format!("reading-neural-btn {class}")};let node=self.node("button",&class,Some(label))?;
  attr(&node,"type","button");attr(&node,"data-neural-action",action);if !id.is_empty(){attr(&node,"data-neural-id",id);}if !aria.is_empty(){attr(&node,"aria-label",aria);}Ok(node)
 }
 fn progress(&self,label:&str,download:&JsValue,voice:&JsValue)->Result<Element,JsValue>{
  let wrap=self.node("div","reading-neural-progress",None)?;let bar=self.node("div","reading-neural-bar",None)?;
  attr(&bar,"role","progressbar");attr(&bar,"aria-label",label);attr(&bar,"aria-valuemin","0");attr(&bar,"aria-valuemax","100");append(&bar,&self.node("i","",None)?);
  append(&wrap,&bar);append(&wrap,&self.node("span","reading-neural-percent",None)?);self.paint_progress(wrap.clone(),download.clone(),voice.clone())?;Ok(wrap)
 }
 fn error(&self,message:&JsValue)->Result<Element,JsValue>{let note=self.node("p","reading-neural-voice__error",if message.is_null()||message.is_undefined(){None}else{Some(js_string(message))}.as_deref())?;attr(&note,"role","alert");Ok(note)}
 fn query(node:&Element,selector:&str)->Result<Element,JsValue>{node.query_selector(selector)?.ok_or_else(||JsValue::from_str("Missing voice control"))}
}
#[wasm_bindgen]
impl RustNeuralView{
 #[wasm_bindgen(constructor)]
 pub fn new(panel:Element)->Result<Self,JsValue>{let document=panel.owner_document().ok_or_else(||JsValue::from_str("Document unavailable"))?;let block=Self::query(&panel,"[data-neural]")?;let offer=Self::query(&panel,"[data-neural-offer]")?;Ok(Self{document,panel,block,offer})}
 #[wasm_bindgen(js_name=paintProgress)]
 pub fn paint_progress(&self,wrap:Element,download:JsValue,voice:JsValue)->Result<(),JsValue>{
  let fraction=prop(&download,"fraction");let amount=if fraction.is_truthy(){number(fraction)}else{0.0};let percent=Math::round(amount*100.0);let percent=if percent.is_nan(){percent}else{percent.clamp(0.0,100.0)};
  let total=numeric(&download,"total");let total=if total>0.0{total/1e6}else{numeric(&voice,"sizeMB")};let number=js_string(&percent.into());
  attr(&Self::query(&wrap,"[role=\"progressbar\"]")?,"aria-valuenow",&number);
  Self::query(&wrap,"i")?.unchecked_ref::<HtmlElement>().style().set_property("width",&format!("{number}%"))?;
  let detail=if total!=0.0&&!total.is_nan(){format!(" · {} de {} MB",js_string(&Math::round(total*percent/100.0).into()),js_string(&Math::round(total).into()))}else{String::new()};
  Self::query(&wrap,".reading-neural-percent")?.set_text_content(Some(&format!("{number} %{detail}")));Ok(())
 }
 pub fn row(&self,voice:JsValue,state:JsValue,selected:bool,expansion:bool,language:&str,size:f64,license_url:&str)->Result<Element,JsValue>{
  let id=string(&voice,"id");let name=string(&voice,"name");let status=string(&state,"name");let shared=prop(&voice,"sharedPack").is_truthy();let size=js_string(&size.into());
  let item=self.node("li","reading-neural-voice",None)?;attr(&item,"data-neural-voice",&id);attr(&item,"data-state",&status);
  let text=self.node("div","reading-neural-voice__text",None)?;let title=self.node("span","reading-neural-voice__name",Some(&name))?;
  if prop(&voice,"recommended").is_truthy(){title.append_child(&self.document.create_text_node(" "))?;append(&title,&self.node("small","reading-neural-voice__badge",Some("Recomendada"))?);}
  let installed=if status=="installed"{"Instalada".to_owned()}else{format!("{size} MB{}",if expansion{" adicionales"}else{""})};
  let detail=format!("{language} · {installed}{}",if shared{" · Paquete compartido · todos sus idiomas y voces"}else{""});append(&text,&title);append(&text,&self.node("span","reading-neural-voice__meta",Some(&detail))?);
  if !license_url.is_empty(){let license_name=prop(&voice,"licenseName");let license_name=if license_name.is_truthy(){js_string(&license_name)}else{"OpenRAIL-M".to_owned()};let link=self.node("a","reading-neural-voice__license",Some(&format!("Licencia {license_name}")))?;attr(&link,"href",license_url);attr(&link,"target","_blank");attr(&link,"rel","noopener noreferrer");append(&text,&link);}
  let actions=self.node("div","reading-neural-voice__actions",None)?;let where_=format!("{name}, {language}");
  match status.as_str(){
   "idle"=>append(&actions,&self.button(if expansion{"Ampliar voces"}else{"Descargar"},"install",&id,"",&format!("{} la voz {where_} ({size} MB)",if expansion{"Ampliar con"}else{"Descargar"}))?),
   "downloading"=>append(&actions,&self.button("Cancelar","cancel",&id,"",&format!("Cancelar la descarga de {name}"))?),
   "error"=>append(&actions,&self.button("Reintentar","install",&id,"",&format!("Reintentar la descarga de {name}"))?),
   _=>{let use_=self.button(if selected{"En uso"}else{"Usar"},"use",&id,if selected{"is-selected"}else{""},&format!("{} {where_}",if selected{"Voz en uso"}else{"Usar la voz"}))?;attr(&use_,"aria-pressed",if selected{"true"}else{"false"});append(&actions,&use_);append(&actions,&self.button("Quitar","remove",&id,"is-quiet",&if shared{"Quitar el paquete compartido Supertonic del dispositivo".to_owned()}else{format!("Quitar la voz {where_} del dispositivo")})?);}
  }
  append(&item,&text);append(&item,&actions);
  if status=="downloading"{append(&item,&self.progress(&format!("Descargando {name}"),&prop(&state,"download"),&voice)?);}
  if status=="error"{append(&item,&self.error(&prop(&state,"message"))?);}Ok(item)
 }
 #[wasm_bindgen(js_name=renderOffer)]
 pub fn render_offer(&self,voice:JsValue,state:JsValue)->Result<(),JsValue>{
  let available=voice.is_truthy();shown(&self.offer,available)?;
  if !available{self.offer.set_text_content(None);self.offer.remove_attribute("data-voice")?;self.offer.remove_attribute("data-state")?;return Ok(());}
  let id=string(&voice,"id");let name=string(&voice,"name");let status=string(&state,"name");let size=js_string(&Math::round(numeric(&voice,"sizeMB")).into());
  attr(&self.offer,"data-voice",&id);attr(&self.offer,"data-state",&status);attr(&self.offer,"role","group");attr(&self.offer,"aria-label","Voz natural");
  let row=self.node("div","reading-neural-offer__row",None)?;append(&row,&self.node("p","reading-neural-offer__title",Some(&format!("Voz natural · {size} MB")))?);
  if status=="downloading"{append(&row,&self.button("Cancelar","cancel",&id,"",&format!("Cancelar la descarga de {name}"))?);}else{append(&row,&self.button(if status=="error"{"Reintentar"}else{"Descargar"},"install",&id,"is-primary",&format!("{} la voz natural {name} ({size} MB)",if status=="error"{"Reintentar la descarga de"}else{"Descargar"}))?);append(&row,&self.button("Ahora no","dismiss","","is-quiet","")?);}
  self.offer.set_text_content(None);append(&self.offer,&row);if status=="error"{append(&self.offer,&self.error(&prop(&state,"message"))?);}if status=="downloading"{append(&self.offer,&self.progress(&format!("Descargando {name}"),&prop(&state,"download"),&voice)?);}Ok(())
 }
 #[wasm_bindgen(js_name=focusKey)]
 pub fn focus_key(&self)->Result<JsValue,JsValue>{
  let Some(active)=self.document.active_element()else{return Ok(JsValue::NULL)};let Some(action)=active.get_attribute("data-neural-action").filter(|s|!s.is_empty())else{return Ok(JsValue::NULL)};
  if !self.panel.contains(Some(&active)){return Ok(JsValue::NULL);}let key=Object::new();set(&key,"action",&action.into())?;set(&key,"id",&active.get_attribute("data-neural-id").unwrap_or_default().into())?;set(&key,"inOffer",&self.offer.contains(Some(&active)).into())?;Ok(key.into())
 }
 #[wasm_bindgen(js_name=restoreFocus)]
 pub fn restore_focus(&self,key:JsValue)->Result<(),JsValue>{
  if !key.is_truthy(){return Ok(());}let root=if prop(&key,"inOffer").is_truthy()&&!self.offer.has_attribute("hidden"){&self.offer}else{&self.block};let nodes=root.query_selector_all("[data-neural-action]")?;
  let nodes:Vec<Element>=(0..nodes.length()).filter_map(|i|nodes.item(i)?.dyn_into::<Element>().ok()).collect();let id=string(&key,"id");let action=string(&key,"action");
  let same=nodes.iter().find(|n|n.get_attribute("data-neural-action").as_deref()==Some(&action)&&n.get_attribute("data-neural-id").unwrap_or_default()==id).or_else(||nodes.iter().find(|n|n.get_attribute("data-neural-id").unwrap_or_default()==id)).or_else(||nodes.first());
  if let Some(node)=same{focus(node);}Ok(())
 }
}
