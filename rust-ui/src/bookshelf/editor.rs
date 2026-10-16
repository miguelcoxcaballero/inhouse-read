//! The spine / cover editor of the lifted book: tabs, text, typography, cloth and foil, gloss, relief
//! proposals and the colour dropper. It builds its own sheet, edits the book through the host's callbacks
//! and tells the 3D view what to show; the lifted book itself (the flyout) hands over the nodes and the
//! geometry it was laid out with. Same operations, same order and the same DOM as the original.
use std::{cell::{Cell,RefCell},rc::{Rc,Weak}};
use wasm_bindgen::prelude::*;
use super::{util::*,ctx::Ctx,style::*};

pub(super) struct FinishPicker{pub select:JsValue,pub picker:JsValue,pub samples:Vec<JsValue>}
pub(super) struct Relief{
 pub status:String,pub proposals:JsValue,pub active_color:JsValue,pub controller:JsValue,pub tilt_timer:Timer,pub tilt_token:u32,
 pub tilt_cleanup:Option<Vec<Listener>>,pub slider_frame:Timer,pub applied:JsValue,
}
pub(super) struct SheetDrag{pub id:JsValue,pub y:f64,pub time:f64,pub dy:f64}
#[derive(Clone,Copy)]
pub(super) struct Geometry{pub vw:f64,pub vh:f64,pub landscape:bool,pub cover_w:f64,pub cover_h:f64,pub center_x:f64,pub center_y:f64,pub thickness:f64}

/// What the lifted book hands its editor.
pub(super) struct EditorParts{
 pub book:JsValue,pub item:JsValue,pub view:JsValue,pub session:JsValue,pub book_node:JsValue,pub flyout:JsValue,pub meta:JsValue,
 pub cover_target:JsValue,pub edit_button:JsValue,pub cover_url:JsValue,pub style:JsValue,pub geo:Geometry,
 pub pick_layer:JsValue,pub pick_message:JsValue,pub pick_cancel:JsValue,pub pick_handle:JsValue,pub host:Rc<dyn Fn()->R>,
}

pub(super) const FOIL_CHOICES:[(&str,&str);2]=[("gold","Oro"),("silver","Plata")];
pub(super) const SURFACE_CHOICES:[(&str,&str);3]=[("matte","Mate"),("satin","Satinado"),("glossy","Brillante")];
pub(super) const TABS:[(&str,&str,&str);2]=[("spine","Lomo","Lomo"),("cover","Portada","Portada")];
pub(super) const PIPETTE:[&str;3]=["m19 5-2-2a2.12 2.12 0 0 0-3 0l-1 1 5 5 1-1a2.12 2.12 0 0 0 0-3Z","m14 5 5 5","m3 21 3-1 11-11-3-3L3 17l-1 3Z"];
thread_local!{static SERIAL:Counter=const{Counter::new()};}

pub struct Editor{
 pub(super) ctx:Rc<Ctx>,pub(super) me:RefCell<Weak<Editor>>,pub(super) keep:Keep,pub(super) disposed:Cell<bool>,
 // what the flyout hands over
 pub(super) book:JsValue,pub(super) item:JsValue,pub(super) view:JsValue,pub(super) session:JsValue,pub(super) book_node:JsValue,
 pub(super) flyout:JsValue,pub(super) meta:JsValue,pub(super) cover_target:JsValue,pub(super) edit_button:JsValue,pub(super) cover_url:JsValue,
 pub(super) geo:Geometry,pub(super) host:Rc<dyn Fn()->R>,
 pub(super) pick_layer:JsValue,pub(super) pick_message:JsValue,pub(super) pick_cancel:JsValue,pub(super) pick_handle:JsValue,
 // the sheet
 pub(super) panel:JsValue,pub(super) subtitle:JsValue,pub(super) preview_title:JsValue,pub(super) preview_author:JsValue,pub(super) preview:JsValue,
 pub(super) heading:JsValue,pub(super) header:JsValue,pub(super) grip:JsValue,pub(super) spine_panel:JsValue,pub(super) cover_panel:JsValue,
 pub(super) tab_buttons:Vec<(String,JsValue)>,pub(super) color_buttons:Vec<JsValue>,pub(super) picker_input:JsValue,
 pub(super) pipette:JsValue,pub(super) font_select:JsValue,pub(super) size_output:JsValue,pub(super) author_size_output:JsValue,
 pub(super) title_input:JsValue,pub(super) author_input:JsValue,pub(super) binding_finish:JsValue,pub(super) ink_finish:JsValue,
 pub(super) cover_surface:JsValue,pub(super) edge_surface:JsValue,pub(super) spine_surface:JsValue,pub(super) ink_picker:JsValue,pub(super) engraved:JsValue,
 pub(super) finish_pickers:Vec<FinishPicker>,
 pub(super) relief_status:JsValue,pub(super) relief_retry:JsValue,pub(super) relief_grid:JsValue,pub(super) relief_none:JsValue,pub(super) relief_group:JsValue,
 pub(super) relief_color_select:JsValue,pub(super) relief_intensity_label:JsValue,pub(super) relief_strength_output:JsValue,pub(super) relief_strength:JsValue,
 pub(super) relief_strength_row:JsValue,
 pub(super) suggested:Vec<JsValue>,
 // state
 pub(super) style:RefCell<JsValue>,pub(super) selected_color:RefCell<JsValue>,pub(super) tab:RefCell<String>,
 pub(super) editor_pose:JsValue,pub(super) cover_pose:JsValue,pub(super) fields:JsValue,
 pub(super) save_timer:RefCell<Timer>,pub(super) preview_timer:RefCell<Timer>,pub(super) dirty:Cell<bool>,
 pub(super) relief:RefCell<Relief>,pub(super) sample_canvas:RefCell<JsValue>,pub(super) sampled:RefCell<String>,pub(super) dragging:Cell<bool>,
 pub(super) sheet_drag:RefCell<Option<SheetDrag>>,pub(super) uid:String,
 pub(super) handlers:RefCell<Vec<Fun>>,pub(super) cards_keep:RefCell<Vec<Listener>>,
}

/// Runs the body while the editor is alive and not disposed.
macro_rules! live{($weak:expr,$editor:ident=>$body:expr)=>{match $weak.upgrade(){Some($editor)=>if $editor.disposed.get(){Ok(())}else{$body},None=>Ok(())}}}
pub(super) use live;

fn label(name:&str)->JsValue{El::new("span").class("ihr-spine-editor__label").text(name).done()}

impl Editor{
 pub(super) fn weak(&self)->Weak<Editor>{self.me.borrow().clone()}
 pub(super) fn me(&self)->Rc<Editor>{self.me.borrow().upgrade().expect("The editor is alive while it runs")}
 pub(super) fn phase(&self)->String{gs(&self.session,"phase")}
 pub(super) fn ready(&self)->bool{self.phase()=="ready"}
 pub(super) fn hidden(&self)->bool{gb(&self.panel,"hidden")}
 pub(super) fn has_view(&self)->bool{truthy(&self.view)}
 pub(super) fn is_session(&self)->bool{self.ctx.st("session")==self.session}
 pub(super) fn tab_is(&self,id:&str)->bool{*self.tab.borrow()==id}
 /// `view?.name(...args)`: nothing when there is no view, a TypeError when the view lacks the method.
 pub(super) fn view_do(&self,name:&str,args:&[&JsValue])->R<JsValue>{if self.has_view(){method(&self.view,name,args)}else{Ok(undef())}}
 /// `view?.name?.(...args)`.
 pub(super) fn view_opt(&self,name:&str,args:&[&JsValue])->R<JsValue>{Ok(method_opt(&self.view,name,args)?.unwrap_or(undef()))}
 pub(super) fn pose_for_tab(&self,tab:&str)->JsValue{if tab=="cover"{self.cover_pose.clone()}else{self.editor_pose.clone()}}
 /// The animation frame `{ transform: pose }`.
 pub(super) fn tf(pose:&JsValue)->JsValue{obj(&[("transform",pose)])}
 pub(super) fn identity_pose()->JsValue{obj(&[("x",&f(0.0)),("y",&f(0.0)),("scale",&f(1.0)),("angle",&f(0.0)),("pitch",&f(0.0))])}
 pub(super) fn timing(duration:f64)->JsValue{obj(&[("duration",&f(duration))])}
 pub(super) fn duration(&self,normal:f64)->f64{if prefers_reduced_motion(){1.0}else{normal}}
 /// `shelfSpineNodes()`.
 pub(super) fn shelf_spines(&self)->Vec<JsValue>{qsa(&self.ctx.scroller,".ihr-spine")}
 pub(super) fn shelf_spine_of_book(&self)->Option<JsValue>{
  let id=string_value(&get(&self.book,"id"));
  self.shelf_spines().into_iter().find(|node|data_get(node,"bookId")==id)
 }
 /// `cached?.key === item.coverKey ? cached.appearance : null` for this book.
 pub(super) fn cached_appearance(&self)->JsValue{
  let cached=map_get(&self.ctx.st("coverAppearances"),&appearance_id(&self.book));
  if truthy(&cached)&&get(&cached,"key")==get(&self.item,"coverKey"){get(&cached,"appearance")}else{null()}
 }

 // ---------------------------------------------------------------- construction
 pub(super) fn build(ctx:&Rc<Ctx>,parts:EditorParts)->R<Rc<Editor>>{
  let EditorParts{book,item,view,session,book_node,flyout,meta,cover_target,edit_button,cover_url,style:style0,geo,pick_layer,pick_message,pick_cancel,pick_handle,host}=parts;

  let cached=map_get(&ctx.st("coverAppearances"),&appearance_id(&book));
  let cached_appearance=if truthy(&cached)&&get(&cached,"key")==get(&item,"coverKey"){get(&cached,"appearance")}else{null()};
  let cover_color=if truthy(&get(&cached_appearance,"color")){get(&cached_appearance,"color")}else{get(&get(&item,"baseStyle"),"color")};
  let suggested=array_of(&ctx.env("bookColorOptions",&[&cover_color])?);
  let selected=or(get(&book,"spineColorOverride"),get(&style0,"color"));

  let panel=El::new("section").class("ihr-spine-editor").flag("hidden").attr("role","region").attr("aria-label","Editar el lomo").attr("tabindex","-1")
   .style(&format!("--ihr-ed-cover:{}",text(&cover_color))).done();
  let subtitle=El::new("p").class("ihr-spine-editor__subtitle").attr("aria-hidden","true").done();
  let title_text=or(or(get(&book,"spineTitleOverride"),get(&book,"title")),s("Sin título"));
  let preview_title=El::new("span").class("ihr-spine-editor__preview-title").text(&text(&title_text)).done();
  put(&book,"author",&ctx.env("normalizeBookAuthor",&[&get(&book,"author")])?);
  let author_now=get(&book,"author");
  let preview_author=El::new("span").class("ihr-spine-editor__preview-author");
  let preview_author=if nullish(&author_now)||author_now==JsValue::FALSE{preview_author}else{preview_author.text(&text(&author_now))}.done();
  let preview_pages=El::new("span").class("ihr-spine-editor__preview-pages").attr("aria-hidden","true").done();
  let ornament=El::new("span").class("ihr-spine-editor__preview-ornament").attr("aria-hidden","true").done();
  let binding=El::new("div").class("ihr-spine-editor__preview-binding").child(&ornament).child(&preview_title).child(&preview_author).done();
  let preview=El::new("div").class("ihr-spine-editor__preview").attr("role","img").attr("aria-label","Vista previa del lomo").style(&spine_style_vars(&style0))
   .child(&preview_pages).child(&binding).done();

  let editor_pose=obj(&[("x",&f(-geo.thickness*0.19)),("y",&f(if geo.landscape{0.0}else{-geo.vh*0.15})),("scale",&f(if geo.landscape{0.7}else{0.58})),("angle",&f(90.0)),("pitch",&f(0.0))]);
  let cover_pose=Editor::identity_pose();
  let uid=format!("ihr-ed-{}",SERIAL.with(|counter|counter.next()));

  // ---- text fields
  let title_input=El::new("input").attr("type","text").attr("maxlength","120").attr("value",&text(&coalesce(get(&book,"spineTitleOverride"),s(""))))
   .attr("placeholder",&text(&or(get(&book,"title"),s("Título del libro")))).class("ihr-spine-editor__input").attr("aria-label","Texto del lomo").attr("enterkeyhint","done").done();
  let author_input=El::new("input").attr("type","text").attr("maxlength","120").attr("value",&text(&ctx.env("normalizeBookAuthor",&[&get(&book,"author")])?))
   .attr("placeholder","Sin autor").attr("aria-label","Autor del libro").attr("autocomplete","name").class("ihr-spine-editor__input").attr("enterkeyhint","done").done();
  // ---- typography
  let font_select=El::new("select").class("ihr-spine-editor__select").attr("aria-label","Fuente del lomo").done();
  for font in SPINE_FONTS.iter(){
   let option=El::new("option").attr("value",font.family).text(font.label)
    .style(&format!("font-family:\"{}\", {};font-weight:{}",font.family,font.fallback,ns(font.weight))).done();
   append(&font_select,&option);
  }
  let wanted=or(or(get(&book,"spineFontFamily"),get(&style0,"fontFamily")),s(SPINE_FONTS[0].family));
  put(&font_select,"value",&wanted);
  // `Math.max(lo, Math.min(hi, Number(book[key]) || Number(style[key]) || fallback))`
  let range_value=|key:&str,lo:f64,hi:f64,fallback:f64|->String{
   let first=num(&get(&book,key));let first=if first.is_nan()||first==0.0{num(&get(&style0,key))}else{first};
   let first=if first.is_nan()||first==0.0{fallback}else{first};
   ns(max(lo,min(hi,first)))
  };
  let font_size_input=El::new("input").attr("type","range").attr("min","8").attr("max","48").attr("step","1").class("ihr-spine-editor__slider")
   .attr("value",&range_value("spineFontSize",8.0,48.0,10.0)).attr("aria-label","Tamaño del título del lomo").done();
  let size_output=El::new("output").class("ihr-spine-editor__size").text(&format!("{} px",text(&get(&font_size_input,"value")))).done();
  let author_size_input=El::new("input").attr("type","range").attr("min","6").attr("max","36").attr("step","1").class("ihr-spine-editor__slider")
   .attr("value",&range_value("spineAuthorFontSize",6.0,36.0,12.0)).attr("aria-label","Tamaño del autor del lomo").done();
  let author_size_output=El::new("output").class("ihr-spine-editor__size").text(&format!("{} px",text(&get(&author_size_input,"value")))).done();
  sync_range(&font_size_input);sync_range(&author_size_input);

  // ---- colour of the binding
  let picker_input=El::new("input").attr("type","color").attr("value",&text(&get(&ctx.env("spineColorStyle",&[&selected])?,"color")))
   .attr("aria-label","Elegir otro color para el lomo").done();
  let pipette=El::new("button").attr("type","button").class("ihr-spine-editor__pipette").attr("aria-label","Elegir color de la portada")
   .attr("title","Tomar un color de la portada").child(&icon(&PIPETTE)?).done();
  let color_controls=El::new("div").class("ihr-flyout__colors").attr("role","group").attr("aria-label","Color del lomo").done();
  let mut color_buttons=Vec::new();
  let names=["Color de la portada","Color complementario 1","Color complementario 2"];
  for (index,color) in suggested.iter().enumerate(){
   let mut button=El::new("button").attr("type","button").class("ihr-flyout__swatch");
   if let Some(name)=names.get(index){button=button.attr("aria-label",name).attr("title",name);}
   color_buttons.push(button.attr("data-color",&text(color)).style(&format!("--ihr-swatch-color:{}",text(color))).done());
  }
  let swatches=El::new("div").class("ihr-flyout__swatches").children(&color_buttons).done();
  let rule=El::new("span").class("ihr-flyout__colors-rule").attr("aria-hidden","true").done();
  let mark=El::new("span").class("ihr-flyout__custom-mark").attr("aria-hidden","true").text("+").done();
  let custom=El::new("label").class("ihr-flyout__custom-color").attr("title","Elegir otro color").child(&picker_input).child(&mark).done();
  append_all(&color_controls,&[&swatches,&rule,&pipette,&custom]);

  // ---- finishes
  let pickers:RefCell<Vec<FinishPicker>>=RefCell::new(Vec::new());
  let (binding_finish,binding_picker)=finish_select(ctx,&book,&pickers,"Acabado del lomo","spineFinish")?;
  let (cover_surface,cover_picker)=surface_select(ctx,&book,&pickers,"Brillo de la portada","coverFinish","satin","cover")?;
  let (edge_surface,edge_picker)=surface_select(ctx,&book,&pickers,"Brillo del canto","pageEdgeFinish","satin","edge")?;
  let (spine_surface,spine_surface_picker)=surface_select(ctx,&book,&pickers,"Brillo del lomo","spineSurfaceFinish","matte","spine")?;
  let picker_row=|name:&str,picker:&JsValue,extra:&str|->JsValue{
   El::new("div").class(format!("ihr-spine-editor__row {extra}").trim()).child(&label(name)).child(picker).done()
  };
  let column_names:Vec<JsValue>=SURFACE_CHOICES.iter().map(|(_,name)|El::new("span").text(name).done()).collect();
  let gloss_columns=El::new("span").class("ihr-spine-editor__gloss-columns").children(&column_names).done();
  let gloss_head=El::new("div").class("ihr-spine-editor__row ihr-spine-editor__gloss-head").attr("aria-hidden","true")
   .child(&El::new("span").class("ihr-spine-editor__label").done()).child(&gloss_columns).done();
  let surface_controls=El::new("div").class("ihr-spine-editor__gloss").attr("role","group").attr("aria-label","Acabados de superficie").child(&gloss_head)
   .child(&picker_row("Portada",&cover_picker,"ihr-spine-editor__gloss-row")).child(&picker_row("Canto",&edge_picker,"ihr-spine-editor__gloss-row"))
   .child(&picker_row("Lomo",&spine_surface_picker,"ihr-spine-editor__gloss-row")).done();
  let (ink_finish,ink_finish_picker)=finish_select(ctx,&book,&pickers,"Acabado del texto","spineTextFinish")?;
  let ink_style=get(&get(&item,"style"),"ink");
  let mut ink_node=El::new("input").attr("type","color");
  if !(nullish(&ink_style)||ink_style==JsValue::FALSE){ink_node=ink_node.attr("value",&text(&ink_style));}
  let ink_picker=ink_node.attr("aria-label","Color del texto").done();
  let engraved=El::new("input").attr("type","checkbox").attr("role","switch").attr("aria-label","Texto grabado").done();
  let auto_button=El::new("button").attr("type","button").class("ihr-spine-editor__auto").text("Auto").attr("title","Contraste automático").done();
  let ink_chip=El::new("span").class("ihr-spine-editor__ink-chip").child(&ink_picker).done();
  let ink_inner=El::new("span").class("ihr-spine-editor__ink-controls").child(&ink_chip).child(&auto_button).done();
  let ink_controls=El::new("div").class("ihr-spine-editor__row ihr-spine-editor__ink").child(&label("Color")).child(&ink_inner).done();
  let section=|title:&str,modifier:&str,children:&[JsValue]|->JsValue{
   let heading=El::new("h3").class("ihr-spine-editor__section-title").text(title).done();
   El::new("div").class(&format!("ihr-spine-editor__section ihr-spine-editor__section--{modifier}")).child(&heading).children(children).done()
  };
  let editor_row=|name:&str,control:&JsValue,extra:&str|->JsValue{
   El::new("label").class(format!("ihr-spine-editor__row {extra}").trim()).child(&label(name)).child(control).done()
  };
  let select_wrap=El::new("span").class("ihr-spine-editor__select-wrap").child(&font_select).done();
  let grip=El::new("span").class("ihr-spine-editor__grip").attr("aria-hidden","true").done();
  let heading=El::new("h2").class("ihr-spine-editor__heading").text("Editar el lomo").done();
  let tab_buttons:Vec<(String,JsValue)>=TABS.iter().map(|(id,tab_label,_)|{
   let node=El::new("button").attr("type","button").attr("role","tab").class("ihr-spine-editor__tab").attr("id",&format!("{uid}-tab-{id}"))
    .attr("aria-selected",if *id=="spine"{"true"}else{"false"}).attr("aria-controls",&format!("{uid}-panel-{id}"))
    .attr("tabindex",if *id=="spine"{"0"}else{"-1"}).text(tab_label).done();
   (id.to_string(),node)
  }).collect();
  let tab_nodes:Vec<JsValue>=tab_buttons.iter().map(|(_,node)|node.clone()).collect();
  let tabs=El::new("div").class("ihr-spine-editor__tabs").attr("role","tablist").attr("aria-label","Qué quieres editar").children(&tab_nodes).done();
  let done_button=El::new("button").attr("type","button").class("ihr-btn ihr-spine-editor__done").text("Listo").done();
  let titles=El::new("div").class("ihr-spine-editor__titles").child(&heading).child(&subtitle).done();
  let header=El::new("header").class("ihr-spine-editor__header").child(&grip).child(&titles).child(&done_button).child(&tabs).done();
  let title_field=El::new("label").class("ihr-spine-editor__field ihr-spine-editor__field--title").child(&label("Texto del lomo")).child(&title_input).done();
  let author_field=El::new("label").class("ihr-spine-editor__field ihr-spine-editor__field--author").child(&label("Autor")).child(&author_input).done();
  let range_title=El::new("span").class("ihr-spine-editor__range").child(&font_size_input).child(&size_output).done();
  let range_author=El::new("span").class("ihr-spine-editor__range").child(&author_size_input).child(&author_size_output).done();
  let engraving=El::new("label").class("ihr-spine-editor__row ihr-spine-editor__engraving").child(&label("Texto grabado")).child(&engraved).done();
  let swatch_row=El::new("div").class("ihr-spine-editor__row ihr-spine-editor__row--swatches").child(&label("Color")).child(&color_controls).done();
  let spine_panel=El::new("div").class("ihr-spine-editor__body").attr("id",&format!("{uid}-panel-spine")).attr("role","tabpanel")
   .attr("aria-labelledby",&format!("{uid}-tab-spine")).children(&[
    section("Rótulo","text",&[title_field,author_field]),
    section("Tipografía","type",&[editor_row("Fuente",&select_wrap,"ihr-spine-editor__row--font"),editor_row("Título",&range_title,"ihr-spine-editor__field--size"),editor_row("Autor",&range_author,"ihr-spine-editor__field--size")]),
    section("Letras","ink",&[ink_controls,picker_row("Acabado",&ink_finish_picker,""),engraving]),
    section("Encuadernación","binding",&[swatch_row,picker_row("Acabado",&binding_picker,"")]),
    section("Brillo","gloss",&[surface_controls]),
   ]).done();

  // ---- cover tab · relief
  let relief_status=El::new("p").class("ihr-relief__status").attr("role","status").attr("aria-live","polite").done();
  let relief_retry=El::new("button").attr("type","button").class("ihr-spine-editor__auto ihr-relief__retry").text("Reintentar").flag("hidden").done();
  let relief_grid=El::new("div").class("ihr-relief__cards").done();
  let none_mark=El::new("span").class("ihr-relief-none__mark").attr("aria-hidden","true").done();
  let none_text=El::new("span").text("Sin relieve").done();
  let relief_none=El::new("button").attr("type","button").class("ihr-relief-none").flag("hidden").attr("aria-pressed","true").child(&none_mark).child(&none_text).done();
  let relief_group=El::new("div").class("ihr-relief__group").attr("role","group").attr("aria-label","Propuestas de relieve").child(&relief_grid).child(&relief_none).done();
  let relief_color_select=El::new("select").class("ihr-relief__color-select").flag("hidden").attr("aria-label","Color del relieve a ajustar").done();
  let relief_intensity_label=label("Intensidad");
  let relief_strength_output=El::new("output").class("ihr-spine-editor__size").done();
  let relief_strength=El::new("input").attr("type","range").attr("min","10").attr("max","100").attr("step","5").class("ihr-spine-editor__slider").attr("aria-label","Intensidad del relieve").done();
  let relief_range=El::new("span").class("ihr-spine-editor__range").child(&relief_strength).child(&relief_strength_output).done();
  let relief_strength_row=El::new("div").class("ihr-spine-editor__row ihr-relief__strength").child(&relief_intensity_label).child(&relief_color_select).child(&relief_range).done();
  let relief_state=El::new("div").class("ihr-relief__state").child(&relief_status).child(&relief_retry).done();
  let cover_panel=El::new("div").class("ihr-spine-editor__cover").attr("id",&format!("{uid}-panel-cover")).attr("role","tabpanel")
   .attr("aria-labelledby",&format!("{uid}-tab-cover")).flag("hidden")
   .child(&section("Relieve","relief",&[relief_state,relief_group.clone(),relief_strength_row.clone()])).done();
  append_all(&panel,&[&header,&preview,&spine_panel,&cover_panel]);

  let editor=Rc::new(Editor{
   ctx:ctx.clone(),me:RefCell::new(Weak::new()),keep:keep(),disposed:Cell::new(false),
   book,item,view,session,book_node,flyout,meta,cover_target,edit_button,cover_url,geo,host,
   pick_layer,pick_message,pick_cancel,pick_handle,
   panel,subtitle,preview_title,preview_author,preview,heading,header,grip,spine_panel,cover_panel,tab_buttons,color_buttons,picker_input,pipette,
   font_select,size_output,author_size_output,title_input,author_input,binding_finish,ink_finish,cover_surface,edge_surface,spine_surface,ink_picker,engraved,
   finish_pickers:pickers.into_inner(),relief_status,relief_retry,relief_grid,relief_none,relief_group,relief_color_select,relief_intensity_label,relief_strength_output,
   relief_strength,relief_strength_row,suggested,
   style:RefCell::new(style0),selected_color:RefCell::new(selected),tab:RefCell::new("spine".to_string()),editor_pose,cover_pose,fields:js_sys::Object::new().into(),
   save_timer:RefCell::new(Timer::none()),preview_timer:RefCell::new(Timer::none()),dirty:Cell::new(false),
   relief:RefCell::new(Relief{status:"idle".to_string(),proposals:js_sys::Array::new().into(),active_color:null(),controller:null(),tilt_timer:Timer::none(),tilt_token:0,
    tilt_cleanup:None,slider_frame:Timer::none(),applied:undef()}),
   sample_canvas:RefCell::new(null()),sampled:RefCell::new(String::new()),dragging:Cell::new(false),sheet_drag:RefCell::new(None),uid,
   handlers:RefCell::new(Vec::new()),cards_keep:RefCell::new(Vec::new()),
  });
  *editor.me.borrow_mut()=Rc::downgrade(&editor);
  editor.wire(&font_size_input,&author_size_input,&auto_button,&done_button)?;
  editor.render_relief_cards()?;
  editor.update_color_selection()?;
  editor.wire_sheet_drag()?;
  Ok(editor)
 }
}

/// `String(book.id ?? book.path ?? book.title ?? 'book')`.
pub(super) fn appearance_id(book:&JsValue)->JsValue{
 string_value(&coalesce(coalesce(coalesce(get(book,"id"),get(book,"path")),get(book,"title")),s("book")))
}
/// The filled part of a range track follows its value (CSS reads `--ihr-range-fill`).
pub(super) fn sync_range(input:&JsValue){
 let value=num(&get(input,"value"));let low=num(&get(input,"min"));let high=num(&get(input,"max"));
 style_set(input,"--ihr-range-fill",&format!("{}%",ns((value-low)/(high-low)*100.0)));
}

/// `finishSelect(label, field)` of the original: a foil/cloth select with its material samples.
fn finish_select(ctx:&Ctx,book:&JsValue,pickers:&RefCell<Vec<FinishPicker>>,label_text:&str,field:&str)->R<(JsValue,JsValue)>{
 let select=El::new("select").class("ihr-spine-editor__select ihr-spine-editor__finish").attr("aria-label",label_text).done();
 let first=if field=="spineTextFinish"{"Tinta"}else{"Tela"};
 let choices=[("matte",first),FOIL_CHOICES[0],FOIL_CHOICES[1]];
 for (value,name) in choices{append(&select,&El::new("option").attr("value",value).text(name).done());}
 put(&select,"value",&ctx.env("spineFinish",&[&get(book,field)])?);
 let picker=material_picker(pickers,&select,if field=="spineTextFinish"{"ink"}else{"binding"},&choices);
 Ok((select,picker))
}
/// `surfaceFinishSelect(label, field, fallback, part)`.
fn surface_select(ctx:&Ctx,book:&JsValue,pickers:&RefCell<Vec<FinishPicker>>,label_text:&str,field:&str,fallback:&str,part:&str)->R<(JsValue,JsValue)>{
 let select=El::new("select").class("ihr-spine-editor__select ihr-spine-editor__finish").attr("aria-label",label_text).done();
 for (value,name) in SURFACE_CHOICES{append(&select,&El::new("option").attr("value",value).text(name).done());}
 put(&select,"value",&ctx.env("surfaceFinish",&[&get(book,field),&s(fallback)])?);
 let picker=material_picker(pickers,&select,part,&SURFACE_CHOICES);
 Ok((select,picker))
}
/// Finishes are chosen from material samples, like a binder's swatch card. The native select stays the
/// real control; the samples only answer the pointer.
fn material_picker(pickers:&RefCell<Vec<FinishPicker>>,select:&JsValue,part:&str,choices:&[(&str,&str)])->JsValue{
 let mut samples=Vec::new();
 for (value,name) in choices{
  let specimen=El::new("span").class("ihr-spine-editor__specimen").done();
  let label_node=El::new("span").class("ihr-spine-editor__material-name").text(name).done();
  samples.push(El::new("span").class("ihr-spine-editor__material").attr("data-value",value).attr("title",name).child(&specimen).child(&label_node).done());
 }
 let track=El::new("span").class("ihr-spine-editor__materials-track").attr("aria-hidden","true").children(&samples).done();
 let picker=El::new("span").class("ihr-spine-editor__materials").attr("data-part",part).child(select).child(&track).done();
 pickers.borrow_mut().push(FinishPicker{select:select.clone(),picker:picker.clone(),samples});
 picker
}
