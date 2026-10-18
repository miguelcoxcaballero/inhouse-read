//! DOM updates for the reader. Pagination, audio and persistence remain owned
//! by their engines; this object only owns references to the existing UI.
use std::{cell::RefCell,collections::HashMap,rc::Rc,sync::Once};
use wasm_bindgen::{prelude::*,JsCast};
use web_sys::{Document,Element,HtmlElement,CssStyleDeclaration};
use crate::{attr,prop,js_string};

// Structural DOM bindings avoid reflected property names and round-tripping
// already-normalized control values through UTF-8. The browser owns coercion.
#[wasm_bindgen]
extern "C" {
 #[wasm_bindgen(extends=Element)] type ValueControl;
 #[wasm_bindgen(method,structural,setter,catch,js_name=textContent)] fn set_control_text(this:&ValueControl,value:&JsValue)->Result<(),JsValue>;
 #[wasm_bindgen(method,structural,setter,catch,js_name=title)] fn set_control_title(this:&ValueControl,value:&JsValue)->Result<(),JsValue>;
 #[wasm_bindgen(method,structural,setter,catch,js_name=max)] fn set_control_max(this:&ValueControl,value:&JsValue)->Result<(),JsValue>;
 #[wasm_bindgen(method,structural,catch,js_name=setAttribute)] fn set_value_attribute(this:&ValueControl,name:&str,value:&JsValue)->Result<(),JsValue>;
 #[wasm_bindgen(method,structural,setter,catch,js_name=value)] fn set_control_value(this:&ValueControl,value:&JsValue)->Result<(),JsValue>;
 #[wasm_bindgen(method,structural,setter,catch,js_name=checked)] fn set_control_checked(this:&ValueControl,value:bool)->Result<(),JsValue>;
 #[wasm_bindgen(method,structural,setter,catch,js_name=disabled)] fn set_control_disabled(this:&ValueControl,value:bool)->Result<(),JsValue>;
}

fn hidden(node:&Element,value:bool){if value{attr(node,"hidden","")}else{let _=node.remove_attribute("hidden");}}
fn property(node:&Element,key:&str,value:&JsValue)->Result<(),JsValue>{let control=node.unchecked_ref::<ValueControl>();match key{
 "value"=>control.set_control_value(value),"checked"=>control.set_control_checked(value.is_truthy()),"disabled"=>control.set_control_disabled(value.is_truthy()),_=>unreachable!(),
}}
fn toggle(node:&Element,name:&str,value:bool){let _=node.class_list().toggle_with_force(name,value);}
fn style(node:&CssStyleDeclaration,name:&str,value:&str){let _=node.set_property(name,value);}
fn element_style(node:&Element)->CssStyleDeclaration{node.unchecked_ref::<HtmlElement>().style()}
fn list(root:&Element,query:&str)->Result<Vec<Element>,JsValue>{let nodes=root.query_selector_all(query)?;Ok((0..nodes.length()).filter_map(|i|nodes.item(i)?.dyn_into().ok()).collect())}
fn bool_text(value:bool)->&'static str{if value{"true"}else{"false"}}

struct LocationNodes{button:Element,label:Element,position:Element,audio:Element,range:Element,page:Element}
#[wasm_bindgen]
pub struct RustReaderView {
 document:Document,screen:Element,panel:Element,mini:Element,return_button:Element,
 screen_style:CssStyleDeclaration,theme_surfaces:Vec<(Element,CssStyleDeclaration)>,paper_surfaces:Vec<CssStyleDeclaration>,
 cache:RefCell<HashMap<String,Element>>,
 groups:RefCell<HashMap<String,Rc<Vec<(Element,String)>>>>,
 preferences:RefCell<Vec<JsValue>>,location:RefCell<Option<Rc<LocationNodes>>>,
}
impl RustReaderView {
 fn query(&self,selector:&str)->Result<Element,JsValue>{
  if let Some(node)=self.cache.borrow().get(selector){return Ok(node.clone());}
  let node=self.panel.query_selector(selector)?.ok_or_else(||JsValue::from_str(&format!("Missing reader control: {selector}")))?;
  self.cache.borrow_mut().insert(selector.to_owned(),node.clone());Ok(node)
 }
 // These groups belong to the immutable panel template. Cache their node
 // references and data keys; live values and visibility are still read/applied.
 fn group(&self,selector:&str)->Result<Rc<Vec<(Element,String)>>,JsValue>{
  if let Some(nodes)=self.groups.borrow().get(selector){return Ok(Rc::clone(nodes));}
  let attribute=if selector=="[data-rate]"{"value"}else{&selector[1..selector.len()-1]};
  let nodes=Rc::new(list(&self.panel,selector)?.into_iter().map(|node|{let key=node.get_attribute(attribute).unwrap_or_default();(node,key)}).collect());
  self.groups.borrow_mut().insert(selector.to_owned(),Rc::clone(&nodes));Ok(nodes)
 }
 fn id(&self,id:&str)->Result<Element,JsValue>{self.document.get_element_by_id(id).ok_or_else(||JsValue::from_str(&format!("Missing reader element: {id}")))}
 fn cached_id(&self,id:&str)->Result<Element,JsValue>{
  let key=format!("@id:{id}");if let Some(node)=self.cache.borrow().get(&key){if node.is_connected(){return Ok(node.clone());}}
  let node=self.id(id)?;self.cache.borrow_mut().insert(key,node.clone());Ok(node)
 }
 fn location_label(&self,button:&Element)->Result<Element,JsValue>{
  if let Some(node)=self.cache.borrow().get("@location-label"){if node.is_connected(){return Ok(node.clone());}}
  let node=button.query_selector(".reader-location-label")?.ok_or_else(||JsValue::from_str("Missing location label"))?;
  self.cache.borrow_mut().insert("@location-label".to_owned(),node.clone());Ok(node)
 }
 fn location_nodes(&self)->Result<Rc<LocationNodes>,JsValue>{
  if let Some(nodes)=self.location.borrow().as_ref(){if nodes.button.is_connected(){return Ok(Rc::clone(nodes));}}
  let button=self.cached_id("reader-location")?;
  let nodes=Rc::new(LocationNodes{label:self.location_label(&button)?,button,position:self.query(".reading-position")?,audio:self.query("[data-audio-where]")?,range:self.query("[data-progress]")?,page:self.query("input[type=\"number\"]")?});
  *self.location.borrow_mut()=Some(Rc::clone(&nodes));Ok(nodes)
 }
 fn mini_query(&self,selector:&str)->Result<Element,JsValue>{self.mini.query_selector(selector)?.ok_or_else(||JsValue::from_str("Missing mini player control"))}
 fn layout(&self,node:&Element,key:&str){let height=if node.has_attribute("hidden"){0.0}else{node.get_bounding_client_rect().height().ceil()};style(&self.screen_style,key,&format!("{height}px"));}
}
#[wasm_bindgen]
impl RustReaderView {
 #[wasm_bindgen(constructor)]
 pub fn new(screen:Element,panel:Element,mini:Element,return_button:Element)->Result<Self,JsValue>{
  // Only finite template/API strings are interned. Book titles, messages and
  // user text never enter a permanent string cache.
  static STRINGS:Once=Once::new();STRINGS.call_once(||{
   for key in ["Progreso y capítulos, ","hidden","open","aria-expanded","aria-selected","aria-pressed","aria-label","aria-checked","tabindex","title","data-view","data-reading-theme","disabled","checked","value","true","false","0","-1","theme","scheme","background","color","brightness","fontSize","pdfMode","rate","font","fontWeight","lineHeight","margin","zoom","flow","align","footnotes","multilingual","skipHeaders","color-scheme","--reading-paper","--reading-ink","--reader-brightness-filter","--reader-audio-height","--reader-return-height","paper","sepia","night","amoled","sage","light","dark","none"]{wasm_bindgen::intern(key);}
  });
  let document=screen.owner_document().ok_or_else(||JsValue::from_str("Document unavailable"))?;
  let screen_style=element_style(&screen);
  let theme_surfaces=[Some(screen.clone()),Some(panel.clone()),document.query_selector(".app-header")?].into_iter().flatten().map(|node|{let style=element_style(&node);(node,style)}).collect();
  let paper_surfaces=[Some(screen.clone()),screen.parent_element(),Some(panel.clone())].into_iter().flatten().map(|node|element_style(&node)).collect();
  Ok(Self{document,screen,panel,mini,return_button,screen_style,theme_surfaces,paper_surfaces,cache:RefCell::new(HashMap::new()),groups:RefCell::new(HashMap::new()),preferences:RefCell::new(Vec::new()),location:RefCell::new(None)})
 }
 #[wasm_bindgen(js_name=setDocumentInfo)]
 pub fn set_document_info(&self,title:JsValue,author:JsValue,about:JsValue,update_mini:bool)->Result<(),JsValue>{
  self.query("#reading-book-title")?.unchecked_ref::<ValueControl>().set_control_text(&title)?;
  self.cached_id("reader-top-title")?.unchecked_ref::<ValueControl>().set_control_text(&title)?;
  self.cached_id("reader-top-byline")?.unchecked_ref::<ValueControl>().set_control_text(&author)?;
  self.query("#reading-document-about")?.unchecked_ref::<ValueControl>().set_control_text(&about)?;
  if update_mini{if let Some(node)=self.mini.query_selector("[data-mini-title]")?{node.unchecked_ref::<ValueControl>().set_control_text(&title)?;}}
  Ok(())
 }
 #[wasm_bindgen(js_name=configureFormat)]
 pub fn configure_format(&self,pdf:bool,page_count:JsValue)->Result<(),JsValue>{
  for (node,_) in self.group("[data-pdf]")?.iter(){hidden(node,!pdf);}
  hidden(&self.query("[data-epub]")?,pdf);
  self.query("input[type=\"number\"]")?.unchecked_ref::<ValueControl>().set_control_max(&page_count)?;Ok(())
 }
 #[wasm_bindgen(js_name=relocate)]
 pub fn relocate(&self,label:js_sys::JsString,compact:JsValue,progress:JsValue,pdf:bool,page:JsValue)->Result<(),JsValue>{
  let nodes=self.location_nodes()?;
  nodes.label.unchecked_ref::<ValueControl>().set_control_text(&compact)?;
  let aria=js_sys::JsString::from("Progreso y capítulos, ").concat(&label);
  nodes.button.unchecked_ref::<ValueControl>().set_value_attribute("aria-label",&aria)?;
  nodes.button.unchecked_ref::<ValueControl>().set_control_title(&label)?;
  nodes.position.unchecked_ref::<ValueControl>().set_control_text(&label)?;
  nodes.audio.unchecked_ref::<ValueControl>().set_control_text(&label)?;
  let focused=self.document.active_element();
  if focused.as_ref()!=Some(&nodes.range){nodes.range.unchecked_ref::<ValueControl>().set_control_value(&progress)?;}
  if focused.as_ref()!=Some(&nodes.page)&&pdf{nodes.page.unchecked_ref::<ValueControl>().set_control_value(&page)?;}
  Ok(())
 }
 #[wasm_bindgen(js_name=showTab)]
 pub fn show_tab(&self,name:&str)->Result<(),JsValue>{
  for section in ["appearance","navigation","audio","search","more","about"]{hidden(&self.query(&format!("#reading-{section}"))?,section!=name);}
  let title=match name{"appearance"=>"Texto","navigation"=>"Contenido","audio"=>"Escuchar","search"=>"Buscar","more"=>"Más opciones","about"=>"Documento",_=>""};
  self.query("#reading-panel-title")?.set_text_content(Some(title));attr(&self.panel,"data-view",name);self.panel.set_scroll_top(0);
  for (id,tab) in [("reader-settings","appearance"),("reader-location","navigation"),("reader-audio","audio")]{attr(&self.id(id)?,"aria-expanded",bool_text(tab==name));}
  Ok(())
 }
 #[wasm_bindgen(js_name=showPlaceTab)]
 pub fn show_place_tab(&self,name:&str)->Result<(),JsValue>{
  for (button,tab) in self.group("[data-place-tab]")?.iter(){
   if button.has_attribute("hidden"){continue;}
   let selected=tab==name;
   attr(&button,"aria-selected",bool_text(selected));attr(&button,"tabindex",if selected{"0"}else{"-1"});
   hidden(&self.query(&format!("[data-places=\"{tab}\"]"))?,!selected);
  }Ok(())
 }
 #[wasm_bindgen(js_name=syncMiniPlayerLayout)]
 pub fn sync_mini_player_layout(&self){self.layout(&self.mini,"--reader-audio-height");}
 #[wasm_bindgen(js_name=syncReturnLayout)]
 pub fn sync_return_layout(&self){self.layout(&self.return_button,"--reader-return-height");}
 #[wasm_bindgen(js_name=updateMiniPlayer)]
 pub fn update_mini_player(&self,state:&str,message:&str,title:&str,rate_label:&str,has_book:bool,icon:&str)->Result<(),JsValue>{
  let active=has_book&&matches!(state,"playing"|"paused"|"loading");let mini_hidden=!active||self.panel.has_attribute("open");
  toggle(&self.screen,"has-reading-audio",active);hidden(&self.mini,mini_hidden);toggle(&self.screen,"has-reading-mini-player",!mini_hidden);
  self.mini_query("[data-mini-title]")?.set_text_content(Some(title));
  let fallback=format!("{} · {rate_label}",match state{"paused"=>"En pausa","loading"=>"Preparando…",_=>"Leyendo"});
  self.mini_query("[data-mini-status]")?.set_text_content(Some(if message.is_empty(){&fallback}else{message}));
  let play=self.mini_query("[data-mini-play]")?;play.set_inner_html(icon);attr(&play,"aria-label",if state=="playing"{"Pausar lectura"}else{"Continuar lectura"});property(&play,"disabled",&(state=="loading").into())?;
  self.sync_mini_player_layout();Ok(())
 }
 #[wasm_bindgen(js_name=updateReadingMetrics)]
 pub fn update_reading_metrics(&self,time:&str,pages:&str)->Result<(),JsValue>{
  for root in [&self.panel,&self.mini] {
   if let Some(node)=root.query_selector("[data-audio-remaining]")? {
    if node.text_content().as_deref()!=Some(time){node.set_text_content(Some(time));attr(&node,"aria-label",&format!("Tiempo restante estimado: {time}"));}
   }
  }
  let button=self.cached_id("reader-location")?;
  attr(&button,"title",&format!("{} · {pages}",button.get_attribute("aria-label").unwrap_or_default()));
  Ok(())
 }
 #[wasm_bindgen(js_name=updateBookmarkButton)]
 pub fn update_bookmark_button(&self,marked:bool)->Result<(),JsValue>{
  let button=self.query("[data-bookmark]")?;let label=if marked{"Quitar marcador de esta página"}else{"Marcar esta página"};
  attr(&button,"aria-pressed",bool_text(marked));attr(&button,"aria-label",label);attr(&button,"title",label);
  let quick=self.id("reader-save-bookmark")?;attr(&quick,"aria-pressed",bool_text(marked));attr(&quick,"aria-label",if marked{"Quitar marcador rápido"}else{"Guardar marcador rápido"});Ok(())
 }
 #[wasm_bindgen(js_name=setSleepChoice)]
 pub fn set_sleep_choice(&self,minutes:f64)->Result<(),JsValue>{
  for (chip,key) in self.group("[data-sleep-value]")?.iter(){let value=key.parse::<f64>().unwrap_or(f64::NAN);attr(&chip,"aria-checked",bool_text(value==minutes));}Ok(())
 }
 #[wasm_bindgen(js_name=applyPreferences)]
 pub fn apply_preferences(&self,p:&JsValue,theme:&JsValue,pdf:bool)->Result<(),JsValue>{
  const KEYS:[&str;15]=["theme","font","fontSize","brightness","fontWeight","lineHeight","margin","zoom","rate","pdfMode","flow","align","footnotes","multilingual","skipHeaders"];
  let mut values:Vec<JsValue>=KEYS.iter().map(|key|prop(p,key)).collect();
  values.extend([prop(theme,"scheme"),prop(theme,"background"),prop(theme,"color"),pdf.into()]);
  let changed:Vec<bool>={let previous=self.preferences.borrow();values.iter().enumerate().map(|(i,value)|previous.get(i)!=Some(value)).collect()};
  let name=js_string(&values[0]);
  for (i,(surface,css)) in self.theme_surfaces.iter().enumerate(){
   // The app clears the shared header theme on shelf return. Always restore it,
   // even when reopening a book with exactly the previous reading preferences.
   if changed[0]||i==2{attr(surface,"data-reading-theme",&name);}
   if changed[15]{style(css,"color-scheme",&js_string(&values[15]));}
  }
  if changed[3]{style(&self.screen_style,"--reader-brightness-filter",&if values[3].as_f64()==Some(100.0){"none".to_owned()}else{format!("brightness({}%)",js_string(&values[3]))});}
  if changed[16]||changed[17]{let paper=js_string(&values[16]);let ink=js_string(&values[17]);for css in &self.paper_surfaces{if changed[16]{style(css,"--reading-paper",&paper);}if changed[17]{style(css,"--reading-ink",&ink);}}}
  if changed[2]{let size=values[2].as_f64().unwrap_or(f64::NAN);property(&self.query("[data-size-step=\"-1\"]")?,"disabled",&(size<=14.0).into())?;property(&self.query("[data-size-step=\"1\"]")?,"disabled",&(size>=36.0).into())?;}
  for (field,key) in self.group("[data-pref]")?.iter(){if let Some(i)=KEYS.iter().position(|k|*k==key){if changed[i]{property(field,"value",&values[i])?;}}}
  if changed[8]{for (radio,key) in self.group("[data-rate]")?.iter(){let value=key.parse::<f64>().unwrap_or(f64::NAN);property(radio,"checked",&(Some(value)==values[8].as_f64()).into())?;}}
  for (field,key) in self.group("[data-voice-option]")?.iter(){if let Some(i)=KEYS.iter().position(|k|*k==key){if changed[i]{property(field,"checked",&values[i].is_truthy().into())?;}}}
  for (output,key) in self.group("[data-output]")?.iter(){if let Some(i)=KEYS.iter().position(|k|*k==key){if changed[i]{let suffix=match key.as_str(){"rate"=>"×","zoom"|"brightness"=>"%","fontSize"|"margin"=>" px",_=>""};output.set_text_content(Some(&format!("{}{suffix}",js_string(&values[i]))));}}}
  if changed[0]{for (button,key) in self.group("[data-theme]")?.iter(){attr(button,"aria-pressed",bool_text(key==&name));}}
  if changed[9]||changed[18]{let original=pdf&&values[9].as_string().as_deref()==Some("original");hidden(&self.query("[data-typography]")?,original);hidden(&self.query("[data-pdf-hint]")?,!original);hidden(&self.query("[data-pdf-zoom]")?,!original);}
  *self.preferences.borrow_mut()=values;Ok(())
 }
 #[wasm_bindgen(js_name=updateReturnButton)]
 pub fn update_return_button(&self,audio:bool,history:bool,label:&str){
  hidden(&self.return_button,!audio&&!history);self.return_button.set_text_content(Some(&if audio{"↶ Volver al audio".to_owned()}else if history{format!("↶ Volver a {label}")}else{String::new()}));self.sync_return_layout();
 }
}
