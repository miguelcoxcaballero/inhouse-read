//! Native reader control listeners. A weak host getter prevents a JS/WASM cycle;
//! dropping the controller removes every listener from its original target.
use wasm_bindgen::{prelude::*,JsCast};
use js_sys::{Function,Object};
use web_sys::{Element,Event,KeyboardEvent,HtmlElement};
use crate::{Listener,attr};
use crate::reader_actions::{get,set,call,one,two};
#[wasm_bindgen]
extern "C"{#[wasm_bindgen(catch,js_name=Number)]fn number(value:&JsValue)->Result<f64,JsValue>;}
#[derive(Clone,Copy)]
enum Action{Call(&'static str),Show(&'static str),Close,Backdrop,Closed,Tab,TabKey,Size,Voice,Stop,Theme,Preference,Rate,ProgressLabel,Progress,Page,Step(f64),Sleep,Toc,Search,SearchInput,QuoteColor,Kids,VoiceOption}
fn query(root:&Element,selector:&str)->Result<Element,JsValue>{root.query_selector(selector)?.ok_or_else(||JsValue::from_str("Missing reader control"))}
fn nodes(root:&Element,selector:&str)->Result<Vec<Element>,JsValue>{let list=root.query_selector_all(selector)?;Ok((0..list.length()).filter_map(|i|list.item(i).and_then(|n|n.dyn_into().ok())).collect())}
fn value(node:&Element)->Result<JsValue,JsValue>{get(node,"value")}
fn data(node:&Element,name:&str)->JsValue{node.get_attribute(name).map(JsValue::from).unwrap_or(JsValue::UNDEFINED)}
fn jump(host:&JsValue,fraction:f64,locator:JsValue)->Result<(),JsValue>{let place=Object::new();set(&place,"fraction",&fraction.into())?;set(&place,"locator",&locator)?;one(host,"jump",&place)?;Ok(())}
fn handle(host:&JsValue,node:&Element,event:Event,action:Action)->Result<(),JsValue>{
 match action{
  Action::Call(method)=>{call(host,method)?;},Action::Show(tab)=>{one(host,"show",&tab.into())?;},
  Action::Close=>{call(&get(host,"panel")?,"close")?;},
  Action::Backdrop=>{let r=node.get_bounding_client_rect();let x=number(&get(&event,"clientX")?)?;let y=number(&get(&event,"clientY")?)?;
   if event.target().is_some_and(|t|t==*node.unchecked_ref::<web_sys::EventTarget>())&&(x<r.left()||x>r.right()||y<r.top()||y>r.bottom()){call(node,"close")?;}
  },
  Action::Closed=>{if get(node,"open")?.is_truthy(){return Ok(());}if !get(host,"keepSearchHits")?.is_truthy(){call(host,"endSearch")?;}
   set(host,"keepSearchHits",&JsValue::FALSE)?;
   let doc=node.owner_document().ok_or_else(||JsValue::from_str("Missing document"))?;
   for id in ["reader-settings","reader-location","reader-audio"]{let button=doc.get_element_by_id(id).ok_or_else(||JsValue::from_str("Missing reader shortcut"))?;attr(&button,"aria-expanded","false");}
   call(host,"updateMiniPlayer")?;
  },
  Action::Tab=>{one(host,"showPlaceTab",&data(node,"data-place-tab"))?;},
  Action::TabKey=>{let key=event.unchecked_ref::<KeyboardEvent>().key();if !["ArrowLeft","ArrowRight","Home","End"].contains(&key.as_str()){return Ok(());}
   let panel:Element=get(host,"panel")?.dyn_into()?;let tabs:Vec<_>=nodes(&panel,"[data-place-tab]")?.into_iter().filter(|t|!t.has_attribute("hidden")).collect();let len=tabs.len() as i32;
   if len==0{return Err(js_sys::TypeError::new("No visible reader tab").into());}
   let at=tabs.iter().position(|t|t==node).map(|i|i as i32).unwrap_or(-1);
   let index=match key.as_str(){"Home"=>0,"End"=>len-1,"ArrowRight"=>(at+1)%len,_=>(at+len-1)%len};
   let target=tabs.get(index as usize).ok_or_else(||JsValue::from_str("Missing reader tab"))?;
   target.unchecked_ref::<HtmlElement>().click();target.unchecked_ref::<HtmlElement>().focus()?;event.prevent_default();
  },
  Action::Size=>{let size=number(&get(&get(host,"preferences")?,"fontSize")?)?+number(&data(node,"data-size-step"))?;two(host,"setPreference",&"fontSize".into(),&size.into())?;},
  Action::Voice=>{let voice=get(host,"voice")?;call(&voice,if get(&voice,"state")?.as_string().as_deref()==Some("playing"){"pause"}else{"play"})?;},
  Action::Stop=>{call(&get(host,"voice")?,"stop")?;},
  Action::Theme=>{two(host,"setPreference",&"theme".into(),&data(node,"data-theme"))?;},
  Action::Preference=>{two(host,"setPreference",&data(node,"data-pref"),&value(node)?)?;},
  Action::Rate=>{if get(node,"checked")?.is_truthy(){two(host,"setPreference",&"rate".into(),&value(node)?)?;}},
  Action::ProgressLabel=>{let panel:Element=get(host,"panel")?.dyn_into()?;query(&panel,".reading-position")?.set_text_content(Some(&format!("{} % del libro",crate::js_string(&JsValue::from(js_sys::Math::round(number(&value(&event.target().ok_or_else(||JsValue::from_str("Missing target"))?.dyn_into()?)?)?))))));},
  Action::Progress=>{let target:Element=event.target().ok_or_else(||JsValue::from_str("Missing target"))?.dyn_into()?;jump(host,number(&value(&target)?)?/100.0,JsValue::NULL)?;},
  Action::Page=>{event.prevent_default();let panel:Element=get(host,"panel")?.dyn_into()?;let page=number(&value(&query(&panel,"input[type=\"number\"]")?)?)?;
   let count=number(&get(&get(host,"reader")?,"pageCount")?)?;let locator=Object::new();set(&locator,"kind",&"pdf-page".into())?;set(&locator,"value",&page.into())?;jump(host,(page-1.0)/js_sys::Math::max(1.0,count-1.0),locator.into())?;
  },
  Action::Step(direction)=>{one(host,"step",&direction.into())?;},
  Action::Sleep=>{let minutes=number(&data(node,"data-sleep-value"))?;one(host,"setSleepChoice",&minutes.into())?;one(&get(host,"voice")?,"setSleep",&minutes.into())?;},
  Action::Toc=>{one(host,"show",&"navigation".into())?;let panel:Element=get(host,"panel")?.dyn_into()?;let tab=if query(&panel,"[data-place-tab=\"toc\"]")?.has_attribute("hidden"){"bookmarks"}else{"toc"};one(host,"showPlaceTab",&tab.into())?;},
  Action::Search=>{event.prevent_default();let panel:Element=get(host,"panel")?.dyn_into()?;one(host,"search",&value(&query(&panel,"[data-search-query]")?)?)?;},
  Action::SearchInput=>{let target:Element=event.target().ok_or_else(||JsValue::from_str("Missing target"))?.dyn_into()?;let text:js_sys::JsString=value(&target)?.unchecked_into();if text.trim().length()==0{call(host,"endSearch")?;}},
  Action::QuoteColor=>{set(host,"quoteColor",&data(node,"data-quote-color"))?;let panel:Element=get(host,"panel")?.dyn_into()?;for item in nodes(&panel,"[data-quote-color]")?{attr(&item,"aria-pressed",if item==*node{"true"}else{"false"});}},
  Action::Kids=>{let enabled=node.get_attribute("aria-pressed").as_deref()!=Some("true");attr(node,"aria-pressed",if enabled{"true"}else{"false"});let screen:Element=get(host,"screen")?.dyn_into()?;screen.class_list().toggle_with_force("reader-kids-mode",enabled)?;attr(node,"aria-label",if enabled{"Salir del modo infantil"}else{"Activar modo infantil"});},
  Action::VoiceOption=>{two(host,"setPreference",&data(node,"data-voice-option"),&get(node,"checked")?)?;}
 }Ok(())
}
enum Binding{Event(Listener),Property{target:Element,key:&'static str,callback:Closure<dyn FnMut(Event)>}}
impl Drop for Binding{
 fn drop(&mut self){
  if let Binding::Property{target,key,callback}=self{
   let owned:&JsValue=callback.as_ref();
   // Releasing an old controller must not remove a replacement handler.
   if get(target,key).map(|current|&current==owned).unwrap_or(false){let _=set(target,key,&JsValue::NULL);}
  }
 }
}
fn bind(listeners:&mut Vec<Binding>,node:Element,kind:&'static str,getter:&Function,action:Action)->Result<(),JsValue>{
 let property=match kind{"click" if !matches!(action,Action::Backdrop)=>Some("onclick"),"keydown"=>Some("onkeydown"),"submit"=>Some("onsubmit"),_=>None};
 let host=getter.clone();let target=node.clone();let handler=Closure::wrap(Box::new(move|event:Event|{
  let result=(||{let host=host.call0(&JsValue::UNDEFINED)?;if host.is_undefined(){return Ok(());}handle(&host,&target,event,action)})();
  if let Err(error)=result{wasm_bindgen::throw_val(error);}
 })as Box<dyn FnMut(Event)>);
 if let Some(key)=property{set(&node,key,handler.as_ref())?;listeners.push(Binding::Property{target:node,key,callback:handler});}
 else{node.add_event_listener_with_callback(kind,handler.as_ref().unchecked_ref())?;listeners.push(Binding::Event(Listener{target:node.into(),kind,callback:handler,capture:false}));}
 Ok(())
}
#[wasm_bindgen]
pub struct RustReaderControls{_listeners:Vec<Binding>}
#[wasm_bindgen]
impl RustReaderControls{
 #[wasm_bindgen(constructor)]pub fn new(host:Function,panel:Element,mini:Element)->Result<Self,JsValue>{
  let mut listeners=Vec::new();let document=panel.owner_document().ok_or_else(||JsValue::from_str("Missing document"))?;
  for(selector,kind,action)in [
   ("[data-close]","click",Action::Close),("[data-reset]","click",Action::Call("resetAppearance")),
   ("[data-progress]","input",Action::ProgressLabel),("[data-progress]","change",Action::Progress),(".reading-page-form","submit",Action::Page),
   ("[data-bookmark]","click",Action::Call("addBookmark")),("[data-play]","click",Action::Voice),("[data-stop]","click",Action::Stop),
   ("[data-audio-prev]","click",Action::Step(-1.0)),("[data-audio-next]","click",Action::Step(1.0)),
   ("[data-search-form]","submit",Action::Search),("[data-search-query]","input",Action::SearchInput),
   ("[data-save-quote]","click",Action::Call("addQuote")),("[data-about]","click",Action::Show("about")),
   ("[data-share]","click",Action::Call("shareBook")),("[data-kids]","click",Action::Kids)
  ]{bind(&mut listeners,query(&panel,selector)?,kind,&host,action)?;}
  for(selector,kind,action)in [("[data-place-tab]","click",Action::Tab),("[data-place-tab]","keydown",Action::TabKey),
   ("[data-size-step]","click",Action::Size),("[data-theme]","click",Action::Theme),("[data-pref]","change",Action::Preference),
   ("[data-rate]","change",Action::Rate),("[data-sleep-value]","click",Action::Sleep),("[data-quote-color]","click",Action::QuoteColor),("[data-voice-option]","change",Action::VoiceOption)]{
   for node in nodes(&panel,selector)?{bind(&mut listeners,node,kind,&host,action)?;}
  }
  for(id,action)in [("reader-save-bookmark",Action::Call("addBookmark")),("reader-rotate",Action::Call("rotateReading")),
   ("reader-settings",Action::Show("appearance")),("reader-audio",Action::Show("audio")),("reader-location",Action::Show("navigation")),
   ("reader-search-shortcut",Action::Show("search")),("reader-toc-shortcut",Action::Toc),("reader-more-shortcut",Action::Show("more"))]{
   bind(&mut listeners,document.get_element_by_id(id).ok_or_else(||JsValue::from_str("Missing reader shortcut"))?,"click",&host,action)?;
  }
  for(selector,action)in [("[data-mini-open]",Action::Show("audio")),("[data-mini-play]",Action::Voice),("[data-mini-stop]",Action::Stop)]{bind(&mut listeners,query(&mini,selector)?,"click",&host,action)?;}
  bind(&mut listeners,panel.clone(),"click",&host,Action::Backdrop)?;bind(&mut listeners,panel,"close",&host,Action::Closed)?;
  Ok(Self{_listeners:listeners})
 }
}
