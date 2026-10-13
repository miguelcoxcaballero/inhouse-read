//! IKEA catalogue controller: selection state, page switching, the add flow and
//! the open/close and keyboard rules. The host keeps the data tables, the three.js
//! studios and the camera flight (Web Animations); this module decides when each runs.
use std::{cell::RefCell,rc::{Rc,Weak}};
use wasm_bindgen::{prelude::*,JsCast};
use js_sys::{Array,Function,Object,Promise,Reflect};
use wasm_bindgen_futures::{spawn_local,JsFuture};
use web_sys::{Element,Event,EventTarget,HtmlElement,KeyboardEvent,MouseEvent};
use crate::{attr,Listener,catalog_view::{catalog_colors,RustCatalogView}};

fn get(value:&JsValue,key:&str)->JsValue{Reflect::get(value,&key.into()).unwrap_or(JsValue::UNDEFINED)}
fn function(value:&JsValue,name:&str)->Result<Function,JsValue>{value.dyn_ref::<Function>().cloned().ok_or_else(||JsValue::from_str(&format!("Catalogue host needs {name}")))}
fn host_function(host:&JsValue,name:&str)->Result<Function,JsValue>{function(&get(host,name),name)}
fn object(entries:&[(&str,JsValue)])->JsValue{let object=Object::new();for(key,value)in entries{let _=Reflect::set(&object,&(*key).into(),value);}object.into()}
fn text(value:&JsValue)->String{value.as_string().unwrap_or_default()}
fn query(root:&Element,selector:&str)->Result<Element,JsValue>{root.query_selector(selector)?.ok_or_else(||JsValue::from_str("Missing catalogue element"))}
/// `Number(id)` for the kelvin button ids this catalogue itself builds (whole numbers).
fn number(id:&str)->f64{let id=id.trim();if id.is_empty(){0.0}else{id.parse::<u32>().map(f64::from).unwrap_or(f64::NAN)}}
/// Calls `target[name](...args)` as the original `preview?.name(...)`, `undefined` when absent.
fn call_method(target:&JsValue,name:&str,args:&[&JsValue])->Result<JsValue,JsValue>{
 let method=function(&get(target,name),name)?;let list=Array::new();for argument in args{list.push(argument);}method.apply(target,&list)
}
/// The colour last chosen for each pot, in insertion order.
fn remember(list:&mut Vec<(String,String)>,pot:String,color:String){match list.iter_mut().find(|(known,_)|*known==pot){Some(entry)=>entry.1=color,None=>list.push((pot,color))}}
fn deliver(result:Result<(),JsValue>){if let Err(error)=result{wasm_bindgen::throw_val(error);}}

struct Host{describe:Function,color_id:Function,color_rows:Function,normalize_shelf:Function,create_preview:Function,frames:Function,fly:Function,after_paint:Function,
 on_add:JsValue,on_add_lamp:JsValue,on_close:JsValue,on_shelf_change:JsValue}
struct State{plant:String,pot:String,color:String,remembered:Vec<(String,String)>,lamp:String,kelvin:f64,page:String,saved_shelf:String,shelf:String,
 trigger:Option<HtmlElement>,destroyed:bool,busy:bool,opening:bool,motion:JsValue,closed_work:Vec<JsValue>,previews:[JsValue;3]}
struct Controller{dialog:Element,paper:Element,body:HtmlElement,close_button:HtmlElement,status:Element,add:HtmlElement,host:Host,when_closed:Function,
 state:RefCell<State>,view:RefCell<Option<RustCatalogView>>,listeners:RefCell<Vec<Listener>>,me:RefCell<Weak<Controller>>,
 flights:RefCell<Vec<Closure<dyn FnMut()->Result<(),JsValue>>>>}

const KINDS:[&str;3]=["plants","shelves","lights"];
impl Controller{
 fn me(&self)->Rc<Controller>{self.me.borrow().upgrade().expect("Catalogue controller is alive while it runs")}
 fn clear_status(&self){self.status.set_text_content(Some(""));let _=self.status.remove_attribute("data-error");}
 fn kind_index(page:&str)->usize{match page{"plants"=>0,"shelves"=>1,_=>2}}

 // ---- studios (host objects with update/setActive/dispose) ----
 fn preview_handles(&self)->[JsValue;3]{self.state.borrow().previews.clone()}
 fn dispose_previews(&self)->Result<(),JsValue>{
  for index in 0..3{let preview=std::mem::replace(&mut self.state.borrow_mut().previews[index],JsValue::UNDEFINED);if !preview.is_undefined(){call_method(&preview,"dispose",&[])?;}}Ok(())
 }
 fn suspend_previews(&self)->Result<(),JsValue>{
  for preview in self.preview_handles(){if !preview.is_undefined(){call_method(&preview,"setActive",&[&JsValue::FALSE])?;}}Ok(())
 }
 fn mount_preview(&self)->Result<(),JsValue>{
  {let state=self.state.borrow();if !state.opening||state.destroyed{return Ok(());}}
  self.suspend_previews()?;
  let index=Self::kind_index(&self.state.borrow().page);
  let existing=self.state.borrow().previews[index].clone();
  let preview=if existing.is_undefined(){let created=self.host.create_preview.call1(&JsValue::UNDEFINED,&KINDS[index].into())?;self.state.borrow_mut().previews[index]=created.clone();created}else{existing};
  call_method(&preview,"setActive",&[&JsValue::TRUE])?;Ok(())
 }
 fn update_previews(&self)->Result<(),JsValue>{
  let (opening,page,plant,pot,color,shelf,lamp,kelvin,previews)={let s=self.state.borrow();(s.opening,s.page.clone(),s.plant.clone(),s.pot.clone(),s.color.clone(),s.shelf.clone(),s.lamp.clone(),s.kelvin,s.previews.clone())};
  if !opening{return Ok(());}
  if page=="plants"&&!previews[0].is_undefined(){call_method(&previews[0],"update",&[&object(&[("catalogId",plant.into()),("potId",pot.into()),("potColorId",color.into())])])?;}
  if page=="shelves"&&!previews[1].is_undefined(){call_method(&previews[1],"update",&[&object(&[("shelfType",shelf.into())])])?;}
  if page=="lights"&&!previews[2].is_undefined(){call_method(&previews[2],"update",&[&object(&[("lampId",lamp.into()),("kelvin",kelvin.into())])])?;}
  Ok(())
 }

 // ---- view ----
 fn update(&self)->Result<(),JsValue>{
  let (plant,pot,color,shelf,lamp,page,kelvin,saved,busy)={let s=self.state.borrow();(s.plant.clone(),s.pot.clone(),s.color.clone(),s.shelf.clone(),s.lamp.clone(),s.page.clone(),s.kelvin,s.saved_shelf.clone(),s.busy)};
  let info=self.host.describe.apply(&JsValue::UNDEFINED,&Array::of5(&plant.clone().into(),&pot.clone().into(),&color.clone().into(),&shelf.clone().into(),&lamp.clone().into()))?;
  let info=info.dyn_into::<Array>()?;let field=|index:u32|info.get(index);
  if self.view.borrow().is_none(){
   let view=RustCatalogView::new(self.dialog.clone())?;let weak=Rc::downgrade(&self.me());
   view.connect_native(Rc::new(move|kind:&str,id:&str|match weak.upgrade(){Some(controller)=>controller.select(kind,id),None=>Ok(())}))?;
   *self.view.borrow_mut()=Some(view);
  }
  let light=page=="lights";let shelf_page=page=="shelves";
  let allowed=if shelf_page{self.host.on_shelf_change.is_function()}else if light{field(13).is_truthy()&&self.host.on_add_lamp.is_function()}else{field(11).is_truthy()&&field(12).is_truthy()&&self.host.on_add.is_function()};
  let mut values=vec![page.clone(),number_text(kelvin),lamp,shelf,saved,color,plant,pot];
  for index in 0..11{values.push(text(&field(index)));}
  self.view.borrow().as_ref().expect("View was just created").render_native(&values,busy,allowed)?;
  self.update_previews()
 }
 fn build_colors(&self)->Result<(),JsValue>{
  let pot=self.state.borrow().pot.clone();
  let rows=text(&self.host.color_rows.call1(&JsValue::UNDEFINED,&pot.into())?);
  catalog_colors(self.dialog.clone(),&rows)?;
  if let Some(view)=self.view.borrow().as_ref(){view.sync_colors()?;}Ok(())
 }

 // ---- selection ----
 fn switch_page(&self,page:&str)->Result<(),JsValue>{
  {let state=self.state.borrow();if state.busy||state.destroyed||state.page==page{return Ok(());}}
  self.state.borrow_mut().page=page.to_owned();self.clear_status();self.update()?;self.mount_preview()?;self.update()
 }
 fn select(&self,kind:&str,id:&str)->Result<(),JsValue>{
  if kind=="page"{return self.switch_page(id);}
  if self.state.borrow().busy{return Ok(());}
  match kind{
   "plant"=>self.state.borrow_mut().plant=id.to_owned(),
   "pot"=>{
    let remembered={let mut state=self.state.borrow_mut();let previous=state.pot.clone();let color=state.color.clone();remember(&mut state.remembered,previous,color);state.pot=id.to_owned();state.remembered.iter().find(|(known,_)|known==id).map(|(_,color)|color.clone())};
    let argument=remembered.map(JsValue::from).unwrap_or(JsValue::UNDEFINED);
    let color=text(&self.host.color_id.call2(&JsValue::UNDEFINED,&id.into(),&argument)?);
    self.state.borrow_mut().color=color;self.build_colors()?;
   },
   "shelf"=>self.state.borrow_mut().shelf=id.to_owned(),
   "lamp"=>self.state.borrow_mut().lamp=id.to_owned(),
   "kelvin"=>self.state.borrow_mut().kelvin=number(id),
   "color"=>{let mut state=self.state.borrow_mut();state.color=id.to_owned();let pot=state.pot.clone();remember(&mut state.remembered,pot,id.to_owned());},
   _=>return Ok(())
  }
  self.clear_status();self.update()
 }

 // ---- opening and closing ----
 fn after_paint(&self,work:&JsValue)->Result<(),JsValue>{self.host.after_paint.call1(&JsValue::UNDEFINED,work)?;Ok(())}
 fn frames(&self)->Result<JsValue,JsValue>{
  let trigger=self.state.borrow().trigger.clone();
  self.host.frames.call1(&JsValue::UNDEFINED,&trigger.map(JsValue::from).unwrap_or(JsValue::NULL))
 }
 fn fly(&self,phase:&str,frames:&JsValue,done:Closure<dyn FnMut()->Result<(),JsValue>>)->Result<(),JsValue>{
  let weak=self.me.borrow().clone();
  // The host's flight clears the motion through `ended`, then runs `done` once the page has landed.
  // Both stay owned by the controller (never dropped while the host may still call them).
  let ended=Closure::wrap(Box::new(move||{if let Some(controller)=weak.upgrade(){controller.state.borrow_mut().motion=JsValue::NULL;}Ok(())})as Box<dyn FnMut()->Result<(),JsValue>>);
  let motion=self.host.fly.call4(&JsValue::UNDEFINED,&phase.into(),frames,done.as_ref(),ended.as_ref())?;
  self.state.borrow_mut().motion=motion;
  self.flights.borrow_mut().extend([done,ended]);Ok(())
 }
 fn finish_close(&self)->Result<(),JsValue>{
  if !self.state.borrow().opening{return Ok(());}
  // Closed from elsewhere mid-flight: just put the room back.
  let motion=self.state.borrow().motion.clone();
  if motion.is_truthy(){call_method(&motion,"land",&[&object(&[("quiet",JsValue::TRUE)])])?;}
  {let mut state=self.state.borrow_mut();state.opening=false;}
  let _=self.dialog.remove_attribute("data-catalog-camera");
  self.suspend_previews()?;
  if self.host.on_close.is_truthy(){function(&self.host.on_close,"onClose")?.call0(&JsValue::UNDEFINED)?;}
  // The closed page paints first; the shelf's own update (a new lamp's shaders can take long) follows.
  let works:Vec<JsValue>=std::mem::take(&mut self.state.borrow_mut().closed_work);
  if !works.is_empty(){
   let runner=Closure::once_into_js(move||{for work in works{
    let failed=match work.dyn_ref::<Function>(){Some(work)=>work.call0(&JsValue::UNDEFINED).err(),None=>Some(JsValue::from_str("Catalogue work is not callable"))};
    if let Some(error)=failed{web_sys::console::warn_2(&"No se pudo actualizar la estantería:".into(),&error);}
   }});
   self.after_paint(&runner)?;
  }
  let trigger=self.state.borrow().trigger.clone();
  if let Some(trigger)=&trigger{if trigger.is_connected(){let options=web_sys::FocusOptions::new();options.set_prevent_scroll(true);let _=trigger.focus_with_options(&options);}}
  self.state.borrow_mut().trigger=None;Ok(())
 }
 fn close_now(&self)->Result<(),JsValue>{
  let close=get(self.dialog.as_ref(),"close");
  if close.is_function()&&get(self.dialog.as_ref(),"open").is_truthy(){close.unchecked_ref::<Function>().call0(self.dialog.as_ref())?;}else{self.dialog.remove_attribute("open")?;}
  self.finish_close()
 }
 fn close(&self,instant:bool)->Result<(),JsValue>{
  {let state=self.state.borrow();if state.destroyed||!state.opening{return Ok(());}}
  let motion=self.state.borrow().motion.clone();
  if motion.is_truthy(){
   if get(&motion,"phase").as_string().as_deref()==Some("closing"){if instant{call_method(&motion,"land",&[])?;}return Ok(());}
   call_method(&motion,"land",&[])?;
  }
  let frames=if instant{JsValue::FALSE}else{self.frames()?};
  if !frames.is_truthy(){return self.close_now();}
  // Nothing redraws inside the page while it flies back into the booklet.
  self.suspend_previews()?;
  let weak=self.me.borrow().clone();
  self.fly("closing",&frames,Closure::wrap(Box::new(move||match weak.upgrade(){Some(controller)=>controller.close_now(),None=>Ok(())})as Box<dyn FnMut()->Result<(),JsValue>>))
 }
 fn open(&self,from:&JsValue)->Result<(),JsValue>{
  {let state=self.state.borrow();if state.destroyed||state.opening{return Ok(());}}
  {let mut state=self.state.borrow_mut();state.trigger=from.dyn_ref::<HtmlElement>().cloned();state.shelf=state.saved_shelf.clone();state.page="plants".to_owned();state.opening=true;}
  self.clear_status();
  let show=get(self.dialog.as_ref(),"showModal");
  if show.is_function(){show.unchecked_ref::<Function>().call0(self.dialog.as_ref())?;}else{attr(&self.dialog,"open","");attr(&self.dialog,"aria-modal","true");}
  let frames=self.frames()?;
  self.update()?;
  if !frames.is_truthy()||!self.state.borrow().previews[0].is_undefined(){self.mount_preview()?;}
  self.update()?;
  self.body.set_scroll_top(0);
  let options=web_sys::FocusOptions::new();options.set_prevent_scroll(true);let _=self.close_button.focus_with_options(&options);
  if frames.is_truthy(){
   let weak=self.me.borrow().clone();
   self.fly("opening",&frames,Closure::wrap(Box::new(move||{
    let Some(controller)=weak.upgrade()else{return Ok(())};
    let live={let state=controller.state.borrow();state.opening&&!state.destroyed};
    if live{controller.mount_preview()?;controller.update()?;}Ok(())
   })as Box<dyn FnMut()->Result<(),JsValue>>))?;
  }
  Ok(())
 }
 fn prepare(&self)->Result<(),JsValue>{
  {let state=self.state.borrow();if state.destroyed||state.opening||!state.previews[0].is_undefined(){return Ok(());}}
  let preview=self.host.create_preview.call1(&JsValue::UNDEFINED,&"plants".into())?;
  self.state.borrow_mut().previews[0]=preview.clone();
  call_method(&preview,"setActive",&[&JsValue::FALSE])?;
  let (plant,pot,color)={let s=self.state.borrow();(s.plant.clone(),s.pot.clone(),s.color.clone())};
  call_method(&preview,"update",&[&object(&[("catalogId",plant.into()),("potId",pot.into()),("potColorId",color.into())])])?;
  if get(&preview,"prepare").is_function(){call_method(&preview,"prepare",&[])?;}Ok(())
 }

 // ---- events ----
 fn key(&self,event:&Event)->Result<(),JsValue>{
  let key=event.dyn_ref::<KeyboardEvent>().map(|event|event.key());
  if key.as_deref()==Some("Escape"){event.prevent_default();return self.close(false);}
  if key.as_deref()!=Some("Tab"){return Ok(());}
  let shift=event.dyn_ref::<KeyboardEvent>().map(|event|event.shift_key()).unwrap_or(false);
  let nodes=self.dialog.query_selector_all("button:not(:disabled)")?;
  let mut buttons=Vec::new();for index in 0..nodes.length(){if let Some(node)=nodes.item(index){if let Ok(button)=node.dyn_into::<HtmlElement>(){if button.closest("[hidden]")?.is_none(){buttons.push(button);}}}}
  let active=self.dialog.owner_document().and_then(|document|document.active_element()).map(JsValue::from).unwrap_or(JsValue::UNDEFINED);
  let first=buttons.first().cloned();let last=buttons.last().cloned();
  let same=|button:&Option<HtmlElement>|button.as_ref().is_some_and(|button|active==JsValue::from(button.clone()));
  if shift&&same(&first){event.prevent_default();if let Some(last)=&last{let _=last.focus();}}
  else if !shift&&same(&last){event.prevent_default();if let Some(first)=&first{let _=first.focus();}}
  Ok(())
 }
 fn backdrop(&self,event:&Event)->Result<(),JsValue>{
  let target=event.target().map(JsValue::from).unwrap_or(JsValue::UNDEFINED);
  if target!=JsValue::from(self.dialog.clone()){return Ok(());}
  let Some(mouse)=event.dyn_ref::<MouseEvent>()else{return Ok(())};
  let bounds=self.paper.get_bounding_client_rect();let (x,y)=(mouse.client_x() as f64,mouse.client_y() as f64);
  if x<bounds.left()||x>bounds.right()||y<bounds.top()||y>bounds.bottom(){self.close(false)?;}Ok(())
 }

 // ---- the add button ----
 fn add_clicked(self:&Rc<Self>)->Result<(),JsValue>{
  let (page,busy)={let s=self.state.borrow();(s.page.clone(),s.busy)};
  let shelf_page=page=="shelves";let lamp_page=page=="lights";
  let callable=if shelf_page{self.host.on_shelf_change.is_function()}else if lamp_page{self.host.on_add_lamp.is_function()}else{self.host.on_add.is_function()};
  if busy||!callable{return Ok(());}
  self.state.borrow_mut().busy=true;self.clear_status();self.update()?;
  let (selected_shelf,lamp,kelvin,plant,pot,color)={let s=self.state.borrow();(s.shelf.clone(),s.lamp.clone(),s.kelvin,s.plant.clone(),s.pot.clone(),s.color.clone())};
  let context=object(&[("whenClosed",self.when_closed.clone().into())]);
  let request=if shelf_page{(self.host.on_shelf_change.clone(),object(&[("shelfType",selected_shelf.clone().into())]))}
   else if lamp_page{(self.host.on_add_lamp.clone(),object(&[("lampId",lamp.into()),("kelvin",kelvin.into())]))}
   else{(self.host.on_add.clone(),object(&[("catalogId",plant.into()),("potId",pot.into()),("potColorId",color.into())]))};
  let call=request.0.unchecked_ref::<Function>().call2(&JsValue::UNDEFINED,&request.1,&context);
  match call{
   // A synchronous throw takes the same path a rejection takes, in the same turn.
   Err(error)=>self.add_failed(shelf_page,error),
   Ok(value)=>{
    // `await`: the continuation runs one turn after the host's promise settles.
    let controller=self.clone();
    spawn_local(async move{
     match JsFuture::from(Promise::resolve(&value)).await{
      Ok(_)=>deliver(controller.add_saved(shelf_page)),
      Err(error)=>deliver(controller.add_failed(shelf_page,error)),
     }
    });
    Ok(())
   }
  }
 }
 fn add_saved(self:&Rc<Self>,shelf_page:bool)->Result<(),JsValue>{
  let attempt=(||{
   // The saved shelf is whatever is selected once the host has saved it.
   if shelf_page{let mut state=self.state.borrow_mut();state.saved_shelf=state.shelf.clone();}
   let destroyed=self.state.borrow().destroyed;
   if !destroyed{self.close(false)?;}Ok(())
  })();
  match attempt{Ok(())=>self.add_finished(),Err(error)=>self.add_failed(shelf_page,error)}
 }
 fn add_failed(self:&Rc<Self>,shelf_page:bool,_error:JsValue)->Result<(),JsValue>{
  if !self.state.borrow().destroyed{
   attr(&self.status,"data-error","true");
   self.status.set_text_content(Some(if shelf_page{"No se pudo cambiar. Reintenta."}else{"No se pudo añadir. Reintenta."}));
  }
  self.add_finished()
 }
 fn add_finished(self:&Rc<Self>)->Result<(),JsValue>{
  self.state.borrow_mut().busy=false;
  if !self.state.borrow().destroyed{self.update()?;}Ok(())
 }

 fn listen(&self,target:EventTarget,kind:&'static str,callback:Closure<dyn FnMut(Event)>)->Result<(),JsValue>{
  target.add_event_listener_with_callback(kind,callback.as_ref().unchecked_ref())?;self.listeners.borrow_mut().push(Listener{target,kind,callback,capture:false});Ok(())
 }
 fn destroy(&self)->Result<(),JsValue>{
  if self.state.borrow().destroyed{return Ok(());}
  self.close(true)?;
  {let mut state=self.state.borrow_mut();state.closed_work.clear();state.destroyed=true;}
  self.dispose_previews()?;
  *self.view.borrow_mut()=None;self.listeners.borrow_mut().clear();self.dialog.remove();Ok(())
 }
}
/// `String(kelvin)` for the whole-number kelvins this catalogue offers.
fn number_text(value:f64)->String{if value.is_nan(){"NaN".to_owned()}else{(value as i64).to_string()}}

#[wasm_bindgen]
pub struct RustCatalogController{core:Rc<Controller>}
#[wasm_bindgen]
impl RustCatalogController{
 /// `initial` is `{plant, pot, color, lamp, kelvin, shelfType}`; `host` carries the data lookups,
 /// the studio factory, the camera flight and the application callbacks.
 #[wasm_bindgen(constructor)]
 pub fn new(dialog:Element,host:JsValue,initial:JsValue)->Result<RustCatalogController,JsValue>{
  let when_closed_work:Rc<RefCell<Weak<Controller>>>=Rc::new(RefCell::new(Weak::new()));
  let work_owner=when_closed_work.clone();
  let when_closed=Closure::wrap(Box::new(move|work:JsValue|{
   if work.is_function(){if let Some(controller)=work_owner.borrow().upgrade(){controller.state.borrow_mut().closed_work.push(work);}}
  })as Box<dyn FnMut(JsValue)>);
  let when_closed:Function=when_closed.into_js_value().unchecked_into();
  let hosted=Host{describe:host_function(&host,"describe")?,color_id:host_function(&host,"colorId")?,color_rows:host_function(&host,"colorRows")?,normalize_shelf:host_function(&host,"normalizeShelf")?,
   create_preview:host_function(&host,"createPreview")?,frames:host_function(&host,"frames")?,fly:host_function(&host,"fly")?,after_paint:host_function(&host,"afterPaint")?,
   on_add:get(&host,"onAdd"),on_add_lamp:get(&host,"onAddLamp"),on_close:get(&host,"onClose"),on_shelf_change:get(&host,"onShelfChange")};
  let saved=text(&hosted.normalize_shelf.call1(&JsValue::UNDEFINED,&get(&initial,"shelfType"))?);
  let element=|selector:&str|query(&dialog,selector);
  let controller=Rc::new(Controller{
   paper:element(".ihr-plant-catalog__paper")?,body:element(".ihr-plant-catalog__body:not(.ihr-plant-catalog__body--shelves):not(.ihr-plant-catalog__body--lights)")?.dyn_into::<HtmlElement>()?,
   close_button:element(".ihr-plant-catalog__close")?.dyn_into::<HtmlElement>()?,status:element(".ihr-plant-catalog__status")?,add:element(".ihr-plant-catalog__add")?.dyn_into::<HtmlElement>()?,
   dialog:dialog.clone(),host:hosted,when_closed,
   state:RefCell::new(State{plant:text(&get(&initial,"plant")),pot:text(&get(&initial,"pot")),color:text(&get(&initial,"color")),remembered:Vec::new(),lamp:text(&get(&initial,"lamp")),
    kelvin:get(&initial,"kelvin").as_f64().unwrap_or(f64::NAN),page:"plants".to_owned(),saved_shelf:saved.clone(),shelf:saved,trigger:None,destroyed:false,busy:false,opening:false,
    motion:JsValue::NULL,closed_work:Vec::new(),previews:[JsValue::UNDEFINED,JsValue::UNDEFINED,JsValue::UNDEFINED]}),
   view:RefCell::new(None),listeners:RefCell::new(Vec::new()),me:RefCell::new(Weak::new()),flights:RefCell::new(Vec::new())});
  *controller.me.borrow_mut()=Rc::downgrade(&controller);*when_closed_work.borrow_mut()=Rc::downgrade(&controller);
  let weak=Rc::downgrade(&controller);
  let on=|weak:&Weak<Controller>,f:fn(&Rc<Controller>,&Event)->Result<(),JsValue>|{let weak=weak.clone();Closure::wrap(Box::new(move|event:Event|{if let Some(controller)=weak.upgrade(){deliver(f(&controller,&event));}})as Box<dyn FnMut(Event)>)};
  controller.listen(controller.close_button.clone().into(),"click",on(&weak,|c,_|c.close(false)))?;
  controller.listen(dialog.clone().into(),"cancel",on(&weak,|c,event|{event.prevent_default();c.close(false)}))?;
  controller.listen(dialog.clone().into(),"close",on(&weak,|c,_|c.finish_close()))?;
  controller.listen(dialog.clone().into(),"click",on(&weak,|c,event|c.backdrop(event)))?;
  controller.listen(dialog.clone().into(),"keydown",on(&weak,|c,event|c.key(event)))?;
  controller.listen(controller.add.clone().into(),"click",on(&weak,|c,_|c.add_clicked()))?;
  // A constructor that fails leaves no mounted DOM, retained view or studio behind.
  if let Err(error)=controller.build_colors().and_then(|_|controller.update()){let _=controller.dispose_previews();*controller.view.borrow_mut()=None;controller.listeners.borrow_mut().clear();return Err(error);}
  Ok(RustCatalogController{core:controller})
 }
 pub fn open(&self,from:JsValue)->Result<(),JsValue>{self.core.open(&from)}
 pub fn prepare(&self)->Result<(),JsValue>{self.core.prepare()}
 #[wasm_bindgen(js_name=setShelfType)]
 pub fn set_shelf_type(&self,value:JsValue)->Result<(),JsValue>{
  let saved=text(&self.core.host.normalize_shelf.call1(&JsValue::UNDEFINED,&value)?);
  {let mut state=self.core.state.borrow_mut();state.saved_shelf=saved.clone();state.shelf=saved;}
  if !self.core.state.borrow().destroyed{self.core.update()?;}Ok(())
 }
 pub fn close(&self,instant:bool)->Result<(),JsValue>{self.core.close(instant)}
 pub fn destroy(&self)->Result<(),JsValue>{self.core.destroy()}
}
