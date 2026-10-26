mod room_motion;
mod gestures;
mod cloud_host;
mod legacy_recovery;
mod cloud_sync;
mod library_backup;
mod drive_client;
mod live_room;
mod room_stream;
mod android_import;
mod folder_store;
mod import_gate;
mod stage_gate;
mod prepared_page;
mod refresh_queue;
mod foliage;
mod profile_view;
mod catalog_art;
mod catalog_view;
mod catalog_controller;
mod catalog_present;
mod catalog_motion;
mod book_projection;
mod speech_mask;
mod speech_pipeline;
#[path="../../rust-core/src/speech_normalize.rs"]
mod speech_normalize;
mod speech_numbers;
#[path="../../rust-core/src/speech_fragments.rs"]
mod speech_fragments_core;
mod speech_plan;
mod sentence_ends;
mod voice_order;
mod voice_catalog;
mod picker_owned;
mod language_detect;
mod language_data;
mod picker_policy;
mod picker_actions;
mod picker_warm;
mod voice_session;
mod voice_advance;
mod voice_dispatch;
mod voice_preparation;
mod voice_presentation;
mod voice_ahead;
mod lifetime;
mod voice_navigation;
mod voice_join;
mod voice_selection;
mod voice_stop;
mod voice_start;
mod reader_chrome;
mod reader_lifecycle;
mod reader_labels;
mod voice_flow;
mod preference_flow;
mod reader_controls;
mod reader_actions;
mod progress_queue;
mod reader_navigation;
mod reading_places;
mod speech_highlight;
mod speech_map;
mod speech_pages;
mod voice_options;
mod neural_view;
mod neural_engine;
mod neural_player;
mod voice_store;
mod voice_urls;
mod supertonic_store;
mod package_store;
mod synth_client;
mod native_synth_client;
mod reader_lists;
mod foliate_cursor;
mod eager;
mod page_snapshot;
mod page_box;
mod promises;
mod foliate_reader;
mod pdf_reader;
mod pdf_speech;
mod reader_controller;
mod pdf_reflow;
mod pdf_theme;
mod reader_markup;
use std::{cell::{Cell, RefCell}, rc::{Rc, Weak}};
use wasm_bindgen::{prelude::*, JsCast};
use js_sys::{Array, Function, Reflect};
use web_sys::{Document, Element, Event, HtmlElement, KeyboardEvent};
mod reader_view;
mod reader_metrics;

#[wasm_bindgen]
pub fn ui_abi_version() -> u32 { 1 }

/// Timer and frame callbacks the module still owns: zero once everything scheduled has run or been cancelled.
#[wasm_bindgen]
pub fn ui_pending_callbacks() -> u32 { crate::host::pending_callbacks() as u32 }

#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_name = String)]
    fn js_string(value: &JsValue) -> String;
}

thread_local! {
    static COUNTER: Cell<u32> = const { Cell::new(0) };
    static OPEN: RefCell<Weak<Menu>> = RefCell::new(Weak::new());
}
const CHEVRON: &str = "<svg viewBox=\"0 0 24 24\" aria-hidden=\"true\" focusable=\"false\"><path d=\"m6 9 6 6 6-6\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.7\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/></svg>";

fn prop(value: &JsValue, key: &str) -> JsValue { Reflect::get(value, &key.into()).unwrap_or(JsValue::UNDEFINED) }
fn attr(node: &Element, key: &str, value: &str) { let _ = node.set_attribute(key, value); }
fn element(doc: &Document, tag: &str, class: &str, text: Option<&str>) -> Result<Element, JsValue> {
    let node = doc.create_element(tag)?; node.set_class_name(class);
    if let Some(text) = text { node.set_text_content(Some(text)); }
    Ok(node)
}
fn append(parent: &Element, child: &Element) { let _ = parent.append_child(child); }
fn focus(node: &Element) {
    if let Some(node) = node.dyn_ref::<HtmlElement>() {
        let options = web_sys::FocusOptions::new(); options.set_prevent_scroll(true);
        let _ = node.focus_with_options(&options);
    }
}
fn scroll(node: &Element) {
    // The optional method is absent in jsdom/older hosts; match the existing adapter.
    if let Ok(function) = Reflect::get(node, &"scrollIntoView".into()) {
        if let Some(function) = function.dyn_ref::<Function>() {
            let options = js_sys::Object::new(); let _ = Reflect::set(&options, &"block".into(), &"nearest".into());
            let _ = function.call1(node, &options);
        }
    }
}
struct Selection { options: Array, current: JsValue, value_text: String }
struct Listener { target: web_sys::EventTarget, kind: &'static str, callback: Closure<dyn FnMut(Event)>, capture: bool }
impl Drop for Listener {
    fn drop(&mut self) { let _ = self.target.remove_event_listener_with_callback_and_bool(self.kind, self.callback.as_ref().unchecked_ref(), self.capture); }
}
struct Menu {
    document: Document, root: Element, trigger: Element, panel: Element, list: Element,
    label: Element, value: Element, extra: Option<Element>, selection: RefCell<Selection>,
    on_change: Function, listeners: RefCell<Vec<Listener>>, outside: RefCell<Option<Listener>>,
}
impl Menu {
    fn is_open(&self) -> bool { !self.panel.has_attribute("hidden") }
    fn items(&self) -> Vec<Element> {
        let children=self.list.children(); (0..children.length()).filter_map(|i| children.item(i))
            .filter(|item| item.get_attribute("aria-disabled").unwrap_or_default().is_empty()).collect()
    }
    fn selected(&self) -> Option<JsValue> {
        let selection=self.selection.borrow(); selection.options.iter().find(|option| prop(option,"value")==selection.current)
    }
    fn paint(&self) {
        let selected=self.selected(); let selection=self.selection.borrow();
        let label=selected.map(|o|prop(&o,"label")).unwrap_or(JsValue::UNDEFINED);
        self.value.set_text_content(Some(&if !selection.value_text.is_empty(){selection.value_text.clone()}else if label.is_truthy(){js_string(&label)}else{String::new()}));
        let children=self.list.children();
        for i in 0..children.length() { if let Some(item)=children.item(i) {
            let value=JsValue::from_str(&item.get_attribute("data-value").unwrap_or_default());
            attr(&item,"aria-selected",if value==selection.current{"true"}else{"false"});
        }}
    }
    fn close(&self, return_focus: bool) {
        if !self.is_open(){return;}
        attr(&self.panel,"hidden","");attr(&self.trigger,"aria-expanded","false");let _=self.root.class_list().remove_1("is-open");
        self.outside.borrow_mut().take();
        OPEN.with(|open| {if open.borrow().upgrade().is_some_and(|value|std::ptr::eq(value.as_ref(),self)){*open.borrow_mut()=Weak::new();}});
        if return_focus {focus(&self.trigger);}
    }
    fn open(this: &Rc<Self>, where_: &str) {
        if this.is_open(){return;}
        let previous=OPEN.with(|open|open.borrow().upgrade());
        if let Some(previous)=previous {if !Rc::ptr_eq(&previous,this){previous.close(false);}}
        OPEN.with(|open|*open.borrow_mut()=Rc::downgrade(this));
        let _=this.panel.remove_attribute("hidden");attr(&this.trigger,"aria-expanded","true");let _=this.root.class_list().add_1("is-open");
        let weak=Rc::downgrade(this);
        let callback=Closure::wrap(Box::new(move |event:Event| {if let Some(menu)=weak.upgrade(){
            let inside=event.target().and_then(|target|target.dyn_into::<web_sys::Node>().ok()).is_some_and(|target|menu.root.contains(Some(&target)));
            if !inside {menu.close(false);}
        }}) as Box<dyn FnMut(Event)>);
        let target:web_sys::EventTarget=this.document.clone().into();
        let _=target.add_event_listener_with_callback_and_bool("click",callback.as_ref().unchecked_ref(),true);
        *this.outside.borrow_mut()=Some(Listener{target,kind:"click",callback,capture:true});
        let items=this.items(); let current=this.selection.borrow().current.clone();
        let target=if where_=="last"{items.last()}else{items.iter().find(|item|JsValue::from_str(&item.get_attribute("data-value").unwrap_or_default())==current).or_else(||items.first())};
        if let Some(target)=target{focus(target);scroll(target);}scroll(&this.root);
    }
    fn choose(&self, value: JsValue) -> Result<(), JsValue> {
        let changed={let mut selection=self.selection.borrow_mut();let changed=value!=selection.current;selection.current=value.clone();changed};
        self.paint();self.close(true);
        if changed {let option=self.selected().unwrap_or(JsValue::UNDEFINED);self.on_change.call2(&JsValue::UNDEFINED,&value,&option)?;}
        Ok(())
    }
    fn keydown(&self, event:&KeyboardEvent) -> Result<(), JsValue> {
        let items=self.items(); let active=self.document.active_element();
        let index=items.iter().position(|item|Some(item)==active.as_ref()).map_or(-1,|i|i as i32);
        let key=event.key();
        let next=match key.as_str(){"ArrowDown"=>Some(index+1),"ArrowUp"=>Some(index-1),"Home"=>Some(0),"End"=>Some(items.len() as i32-1),_=>None};
        if let Some(next)=next {event.prevent_default();if !items.is_empty(){let target=&items[next.rem_euclid(items.len() as i32) as usize];focus(target);scroll(target);}return Ok(());}
        match key.as_str(){
            "Enter"|" "=>{event.prevent_default();if index>=0{self.choose(items[index as usize].get_attribute("data-value").unwrap_or_default().into())?;}},
            "Escape"=>{event.prevent_default();event.stop_propagation();self.close(true);},
            "Tab"=>self.close(false),
            _=>{if key.encode_utf16().count()!=1||event.ctrl_key()||event.meta_key()||event.alt_key(){return Ok(());}
                // Locale folding belongs to the browser, preserving its ICU version.
                let letter=js_sys::JsString::from(key).to_locale_lower_case(Some("es")).as_string().unwrap_or_default();
                for offset in 1..=items.len(){let i=(index+offset as i32).rem_euclid(items.len() as i32) as usize;
                    let text=js_sys::JsString::from(items[i].text_content().unwrap_or_default()).trim().to_locale_lower_case(Some("es")).as_string().unwrap_or_default();
                    if text.starts_with(&letter){focus(&items[i]);scroll(&items[i]);break;}
                }
            }
        }
        Ok(())
    }
    fn listen(this: &Rc<Self>, target: &Element, kind: &'static str, mode: u8) -> Result<(), JsValue> {
        let weak=Rc::downgrade(this);
        let callback=Closure::wrap(Box::new(move|event:Event|{
          let result=(|| -> Result<(),JsValue> {let Some(menu)=weak.upgrade()else{return Ok(());};match mode{
            0=>{if menu.is_open(){menu.close(false)}else{Self::open(&menu,"selected")}},
            1=>{if let Some(event)=event.dyn_ref::<KeyboardEvent>(){if event.key()=="ArrowDown"||event.key()=="ArrowUp"{event.prevent_default();Self::open(&menu,if event.key()=="ArrowUp"{"last"}else{"selected"});}}},
            2=>{if let Some(item)=event.target().and_then(|n|n.dyn_into::<Element>().ok()).and_then(|n|n.closest("[role=option]").ok().flatten()){
                if item.get_attribute("aria-disabled").unwrap_or_default().is_empty(){menu.choose(item.get_attribute("data-value").unwrap_or_default().into())?;}
            }},
            _=>{if let Some(event)=event.dyn_ref::<KeyboardEvent>(){menu.keydown(event)?;}}
          }Ok(())})();
          // All Rust borrows/strong menu references are released before throwing
          // through an event callback, so a host error does not leak the menu.
          if let Err(error)=result{wasm_bindgen::throw_val(error);}
        })as Box<dyn FnMut(Event)>);
        target.add_event_listener_with_callback(kind,callback.as_ref().unchecked_ref())?;
        this.listeners.borrow_mut().push(Listener{target:target.clone().into(),kind,callback,capture:false});Ok(())
    }
}

#[wasm_bindgen]
pub struct RustSelectMenu { menu: Rc<Menu> }
#[wasm_bindgen]
impl RustSelectMenu {
    #[wasm_bindgen(constructor)]
    pub fn new(label: JsValue, extra: Option<Element>, on_change: Function) -> Result<RustSelectMenu,JsValue> {
        let document=Reflect::get(&js_sys::global(), &"document".into())?.dyn_into::<Document>()
            .map_err(|_| JsValue::from_str("Document unavailable"))?;
        let id=COUNTER.with(|counter|{counter.set(counter.get()+1);format!("select-menu-{}",counter.get())});
        let root=element(&document,"div","select-menu",None)?;
        let trigger=element(&document,"button","select-menu__trigger",None)?;
        attr(&trigger,"type","button");attr(&trigger,"id",&format!("{id}-trigger"));attr(&trigger,"aria-haspopup","listbox");attr(&trigger,"aria-expanded","false");attr(&trigger,"aria-controls",&format!("{id}-panel"));
        let label_node=element(&document,"span","select-menu__label",if label.is_null()||label.is_undefined(){None}else{Some(js_string(&label))}.as_deref())?;
        let value=element(&document,"span","select-menu__value",None)?;append(&trigger,&label_node);append(&trigger,&value);trigger.insert_adjacent_html("beforeend",CHEVRON)?;
        let panel=element(&document,"div","select-menu__panel",None)?;attr(&panel,"id",&format!("{id}-panel"));attr(&panel,"hidden","");
        let list=element(&document,"ul","select-menu__list",None)?;attr(&list,"role","listbox");attr(&list,"aria-label",&js_string(&label));append(&panel,&list);
        if let Some(extra)=&extra{append(&panel,extra);root.class_list().add_1("select-menu--catalog")?;}
        append(&root,&trigger);append(&root,&panel);
        let menu=Rc::new(Menu{document,root,trigger,panel,list,label:label_node,value,extra,selection:RefCell::new(Selection{options:Array::new(),current:"".into(),value_text:String::new()}),on_change,listeners:RefCell::new(Vec::new()),outside:RefCell::new(None)});
        Menu::listen(&menu,&menu.trigger,"click",0)?;Menu::listen(&menu,&menu.trigger,"keydown",1)?;
        Menu::listen(&menu,&menu.list,"click",2)?;Menu::listen(&menu,&menu.list,"keydown",3)?;
        Ok(Self{menu})
    }
    #[wasm_bindgen(getter)] pub fn root(&self)->Element{self.menu.root.clone()}
    #[wasm_bindgen(getter)] pub fn trigger(&self)->Element{self.menu.trigger.clone()}
    #[wasm_bindgen(getter)] pub fn panel(&self)->Element{self.menu.panel.clone()}
    #[wasm_bindgen(getter)] pub fn list(&self)->Element{self.menu.list.clone()}
    #[wasm_bindgen(getter,js_name=labelNode)] pub fn label_node(&self)->Element{self.menu.label.clone()}
    #[wasm_bindgen(getter,js_name=valueNode)] pub fn value_node(&self)->Element{self.menu.value.clone()}
    #[wasm_bindgen(getter)] pub fn extra(&self)->Option<Element>{self.menu.extra.clone()}
    #[wasm_bindgen(getter,js_name=isOpen)] pub fn is_open(&self)->bool{self.menu.is_open()}
    #[wasm_bindgen(getter)] pub fn value(&self)->JsValue{self.menu.selection.borrow().current.clone()}
    #[wasm_bindgen(getter)] pub fn options(&self)->Array{self.menu.selection.borrow().options.clone()}
    #[wasm_bindgen(js_name=setOptions)] pub fn set_options(&self,options:Array,value:JsValue)->Result<(),JsValue>{
        let value=if value.is_undefined(){self.value()}else{value};
        let current=if options.iter().any(|o|prop(&o,"value")==value){value}else{let first=prop(&options.get(0),"value");if first.is_null()||first.is_undefined(){"".into()}else{first}};
        {let mut selection=self.menu.selection.borrow_mut();selection.current=current;selection.options=options.clone();}
        self.menu.list.set_text_content(None);
        for (i,option) in options.iter().enumerate(){
            let item=element(&self.menu.document,"li","select-menu__option",None)?;attr(&item,"role","option");attr(&item,"id",&format!("{}-{i}",self.menu.trigger.id()));attr(&item,"tabindex","-1");attr(&item,"data-value",&js_string(&prop(&option,"value")));
            let label=prop(&option,"label");let label=if label.is_null()||label.is_undefined(){None}else{Some(js_string(&label))};
            append(&item,&element(&self.menu.document,"span","select-menu__option-label",label.as_deref())?);
            let hint=prop(&option,"hint");if hint.is_truthy(){append(&item,&element(&self.menu.document,"small","select-menu__option-hint",Some(&js_string(&hint)))?);}
            if prop(&option,"disabled").is_truthy(){attr(&item,"aria-disabled","true");}append(&self.menu.list,&item);
        }
        self.menu.paint();Ok(())
    }
    #[wasm_bindgen(js_name=setValue)] pub fn set_value(&self,value:JsValue){if self.menu.selection.borrow().options.iter().any(|o|prop(&o,"value")==value){self.menu.selection.borrow_mut().current=value;self.menu.paint();}}
    #[wasm_bindgen(js_name=setValueText)] pub fn set_value_text(&self,text:JsValue){self.menu.selection.borrow_mut().value_text=if text.is_truthy(){js_string(&text)}else{String::new()};self.menu.paint();}
    #[wasm_bindgen(js_name=setDisabled)] pub fn set_disabled(&self,disabled:JsValue){let disabled=disabled.is_truthy();if let Some(button)=self.menu.trigger.dyn_ref::<web_sys::HtmlButtonElement>(){button.set_disabled(disabled);}if disabled{self.menu.close(false);}}
    pub fn open(&self,where_:Option<String>){Menu::open(&self.menu,where_.as_deref().unwrap_or("selected"));}
    pub fn close(&self,options:JsValue){self.menu.close(prop(&options,"focus").is_truthy());}
    pub fn choose(&self,value:JsValue)->Result<(),JsValue>{self.menu.choose(value)}
    pub fn paint(&self){self.menu.paint();}
    pub fn items(&self)->Array{self.menu.items().into_iter().map(JsValue::from).collect()}
    pub fn keydown(&self,event:KeyboardEvent)->Result<(),JsValue>{self.menu.keydown(&event)}
}
