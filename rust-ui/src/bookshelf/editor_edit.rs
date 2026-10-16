//! The editor's spine tab: wiring of every control, the customisation it writes to the book, the colour
//! and finish state of the sheet, the tab switch and the open/close of the sheet.
use wasm_bindgen::prelude::*;
use super::{util::*,editor::*,style::*};

impl Editor{
 /// Every listener of the sheet, in the order the original registered them.
 pub(super) fn wire(&self,font_size_input:&JsValue,author_size_input:&JsValue,auto_button:&JsValue,done_button:&JsValue)->R{
  let w=self.weak();
  let keep=&self.keep;
  // the dropper layer
  {let w=w.clone();on(keep,&self.pick_cancel,"click",move|_|live!(w,e=>{e.finish_color_pick(false);Ok(())}))?;}
  self.wire_color_pick()?;
  // the colour of the binding
  {let w=w.clone();let input=self.picker_input.clone();on(keep,&self.picker_input,"change",move|_|live!(w,e=>e.select_spine_color(&get(&input,"value"))))?;}
  {let w=w.clone();on(keep,&self.pipette,"click",move|_|live!(w,e=>{e.begin_color_pick();Ok(())}))?;}
  for (index,button) in self.color_buttons.iter().enumerate(){
   let w=w.clone();
   on(keep,button,"click",move|_|live!(w,e=>{let color=e.suggested.get(index).cloned().unwrap_or(undef());e.select_spine_color(&color)}))?;
  }
  // typography
  {let w=w.clone();let select=self.font_select.clone();on(keep,&self.font_select,"change",move|_|live!(w,e=>{
   let wanted=get(&select,"value");
   match SPINE_FONTS.iter().find(|font|s(font.family)==wanted){
    Some(font)=>e.update_customization(&obj(&[("spineFontFamily",&s(font.family))])),
    None=>Ok(()),
   }
  }))?;}
  for (input,output,field) in [(font_size_input,&self.size_output,"spineFontSize"),(author_size_input,&self.author_size_output,"spineAuthorFontSize")]{
   let w=w.clone();let (input,output)=(input.clone(),output.clone());
   on(keep,&input.clone(),"input",move|_|live!(w,e=>{
    let size=num(&get(&input,"value"));
    set_text(&output,&format!("{} px",ns(size)));
    sync_range(&input);
    e.update_customization(&obj(&[(field,&f(size))]))
   }))?;
  }
  {let w=w.clone();let input=self.title_input.clone();on(keep,&self.title_input,"input",move|_|live!(w,e=>e.update_customization(&obj(&[("spineTitleOverride",&get(&input,"value"))]))))?;}
  {let w=w.clone();let input=self.author_input.clone();on(keep,&self.author_input,"input",move|_|live!(w,e=>{
   let author=e.ctx.env("normalizeBookAuthor",&[&get(&input,"value")])?;
   e.update_customization(&obj(&[("author",&author)]))
  }))?;}
  // finishes
  for (select,field,fallback) in [(&self.binding_finish,"spineFinish",None),(&self.ink_finish,"spineTextFinish",None),
   (&self.cover_surface,"coverFinish",Some("satin")),(&self.edge_surface,"pageEdgeFinish",Some("satin")),(&self.spine_surface,"spineSurfaceFinish",Some("matte"))]{
   let w=w.clone();let node=select.clone();
   on(keep,select,"change",move|_|live!(w,e=>{
    let value=get(&node,"value");
    match fallback{
     None=>e.update_customization(&obj(&[(field,&value)])),
     Some(fallback)=>{let value=e.ctx.env("surfaceFinish",&[&value,&s(fallback)])?;e.update_customization(&obj(&[(field,&value)]))}
    }
   }))?;
  }
  for picker in &self.finish_pickers{
   for sample in &picker.samples{
    let select=picker.select.clone();let sample_node=sample.clone();
    on(keep,sample,"click",move|_|{
     let value=data_get(&sample_node,"value");
     if get(&select,"value")==value{return Ok(());}
     put(&select,"value",&value);
     let event=construct("Event",&[&s("change"),&obj(&[("bubbles",&JsValue::TRUE)])])?;
     method(&select,"dispatchEvent",&[&event])?;Ok(())
    })?;
   }
  }
  {let w=w.clone();let input=self.ink_picker.clone();on(keep,&self.ink_picker,"change",move|_|live!(w,e=>
   e.update_customization(&obj(&[("spineTextColor",&get(&input,"value")),("spineTextFinish",&s("matte"))]))))?;}
  {let w=w.clone();let input=self.engraved.clone();on(keep,&self.engraved,"change",move|_|live!(w,e=>
   e.update_customization(&obj(&[("spineEngraved",&get(&input,"checked"))]))))?;}
  {let w=w.clone();on(keep,auto_button,"click",move|_|live!(w,e=>
   e.update_customization(&obj(&[("spineTextColor",&null()),("spineTextFinish",&s("matte"))]))))?;}
  // tabs
  for (id,button) in &self.tab_buttons{
   let w=w.clone();let id=id.clone();
   on(keep,button,"click",move|_|live!(w,e=>e.select_editor_tab(&id,false)))?;
  }
  {
   let w=w.clone();
   let tabs=get(&self.tab_buttons[0].1,"parentElement");
   on(keep,&tabs,"keydown",move|event|live!(w,e=>{
    let current=e.tab.borrow().clone();
    let target=crate::cover_editor::next_editor_tab(&s(&current),&get(&event,"key"));
    if !truthy(&target){return Ok(());}
    prevent_default(&event);stop_propagation(&event);
    e.select_editor_tab(&text(&target),true)
   }))?;
  }
  {let w=w.clone();on(keep,done_button,"click",move|_|live!(w,e=>e.close_editor(true,true)))?;}
  // relief
  self.wire_relief()?;
  // the title field stays visible above the keyboard
  {
   let w=w.clone();let (title,author)=(self.title_input.clone(),self.author_input.clone());
   on(keep,&self.panel,"focusin",move|event|live!(w,e=>{
    let target=get(&event,"target");
    if target==title||target==author{
     let weak=e.weak();
     let timer=frame(move||live!(weak,e=>e.keep_title_visible()));
     drop(timer);
    }
    Ok(())
   }))?;
  }
  self.install_viewport_handler();
  Ok(())
 }

 // ---------------------------------------------------------------- the book's names
 pub(super) fn refresh_editor_preview(&self)->R{
  let item_style=get(&self.item,"style");
  super::style::update_book_style_vars(&self.preview,&item_style);
  super::style::update_book_style_vars(&self.panel,&item_style);
  let title=or(or(get(&self.book,"spineTitleOverride"),get(&self.book,"title")),s("Sin título"));
  put(&self.preview_title,"textContent",&title);
  put(&self.subtitle,"textContent",&get(&self.preview_title,"textContent"));
  put(&self.book,"author",&self.ctx.env("normalizeBookAuthor",&[&get(&self.book,"author")])?);
  put(&self.preview_author,"textContent",&get(&self.book,"author"));
  putb(&self.preview_author,"hidden",!truthy(&get(&self.book,"author")));
  Ok(())
 }
 /// The title and author written on the spine are the book's own, everywhere: this sheet, its labels and the shelf's.
 fn refresh_book_names(&self)->R{
  let title=self.ctx.env("displayBookTitle",&[&self.book])?;
  let author=self.ctx.env("normalizeBookAuthor",&[&get(&self.book,"author")])?;
  let title_node=qs(&self.meta,".ihr-flyout__title");
  if truthy(&title_node){put(&title_node,"textContent",&title);}
  let mut author_node=qs(&self.meta,".ihr-flyout__author");
  if truthy(&author)&&!truthy(&author_node){
   author_node=El::new("p").class("ihr-flyout__author").done();
   if truthy(&title_node){method(&title_node,"after",&[&author_node])?;}
  }
  if truthy(&author_node){if truthy(&author){put(&author_node,"textContent",&author);}else{remove(&author_node);}}
  let label=or(title,self.ctx.text_of("openAction"));
  set_attr(&self.flyout,"aria-label",&text(&label));
  let tap=call(&self.ctx.text_of("tapCover"),"tapCover",&[&self.book])?;
  set_attr(&self.cover_target,"aria-label",&text(&tap));
  if let Some(shelf_node)=self.shelf_spine_of_book(){
   let progress=get_attr(&shelf_node,"aria-label").map(|label|progress_suffix(&label)).unwrap_or_default();
   let open=call(&self.ctx.text_of("openAria"),"openAria",&[&self.book])?;
   set_attr(&shelf_node,"aria-label",&format!("{}{}",text(&open),progress));
  }
  Ok(())
 }
 /// Applies edited fields: the book keeps them, the host saves them and every view that shows the spine follows.
 pub(super) fn update_customization(&self,fields:&JsValue)->R{
  assign(&self.book,fields)?;assign(&self.fields,fields)?;
  if js_sys::Reflect::has(fields,&s("spineTitleOverride")).unwrap_or(false)||js_sys::Reflect::has(fields,&s("author")).unwrap_or(false){self.refresh_book_names()?;}
  // The relief only touches the cover and view.setCoverRelief already applies it.
  let keys=js_sys::Object::keys(fields.unchecked_ref::<js_sys::Object>());
  if keys.iter().all(|key|key.as_string().as_deref()==Some("coverRelief")){self.queue_customization_save();return Ok(());}
  self.dirty.set(true);
  super::style::apply_cover_appearance(&self.ctx,&self.item,&self.cached_appearance())?;
  *self.style.borrow_mut()=get(&self.item,"style");
  self.refresh_editor_preview()?;
  let item_style=get(&self.item,"style");
  update_book_style_vars(&self.book_node,&item_style);
  let shelf_node=self.shelf_spine_of_book().unwrap_or(undef());
  update_book_style_vars(&shelf_node,&item_style);
  if truthy(&self.view)&&truthy(&get(&self.view,"updateEditorAppearance")){method(&self.view,"updateEditorAppearance",&[&self.book])?;}
  else if self.has_view(){method(&self.view,"updateCoverAppearance",&[&self.book])?;method(&self.view,"updateEdgeAppearance",&[&self.book])?;}
  let last=self.ctx.st("lastOpened");
  if get(&get(&last,"book"),"id")==get(&self.book,"id"){
    if nullish(&last){return Err(js_sys::TypeError::new("Cannot set properties of null (setting 'style')").into());}
    put(&last,"style",&item_style);
  }
  self.ctx.st_set("appearanceRefreshPending",&JsValue::TRUE);
  self.update_color_selection()?;
  {let previous=self.preview_timer.borrow().clone();if previous.is_set(){cancel(&previous);}}
  let weak=self.weak();
  let timer=after(90.0,move||live!(weak,e=>{
   *e.preview_timer.borrow_mut()=Timer::none();
   if !e.hidden()&&e.ready(){e.view_do("updateSpineAppearance",&[&e.book,&get(&e.item,"style")])?;}
   Ok(())
  }));
  *self.preview_timer.borrow_mut()=timer;
  self.queue_customization_save();
  Ok(())
 }
 pub(super) fn queue_customization_save(&self){
  {let previous=self.save_timer.borrow().clone();if previous.is_set(){cancel(&previous);}}
  // Strong on purpose: a save already queued still happens after the lifted book has gone, as it always did.
  let editor=self.me();
  let timer=after(180.0,move||editor.save_customization_now());
  *self.save_timer.borrow_mut()=timer;
 }
 pub(super) fn save_customization_now(&self)->R{
  {let previous=self.save_timer.borrow().clone();if previous.is_set(){cancel(&previous);}}
  *self.save_timer.borrow_mut()=Timer::none();
  if js_sys::Object::keys(self.fields.unchecked_ref::<js_sys::Object>()).length()>0{
   let changed=spread(&[&self.fields]);
   for key in js_sys::Object::keys(self.fields.unchecked_ref::<js_sys::Object>()).iter(){delete_key(&self.fields,&key.as_string().unwrap_or_default());}
   let saved=self.ctx.option_call("onBookCustomizationChange",&[&self.book,&changed])?;
   let promise=promise_resolve(&saved);
   then(&promise,|_|Ok(()),|error|{warn("No se pudo guardar el aspecto del lomo:",&error);Ok(())})?;
  }
  Ok(())
 }

 // ---------------------------------------------------------------- colour and finish state
 pub(super) fn update_color_selection(&self)->R{
  let book=&self.book;
  let cloth=text(&self.ctx.env("spineFinish",&[&get(book,"spineFinish")])?)=="matte";
  let follows_cover=!truthy(&get(book,"spineColorOverride"));
  let selected=self.selected_color.borrow().clone();
  for (index,button) in self.color_buttons.iter().enumerate(){
   let on=cloth&&(if follows_cover{index==0}else{data_get(button,"color")==selected});
   set_attr(button,"aria-pressed",if on{"true"}else{"false"});
   cls_toggle(button,"is-selected",on);
  }
  put(&self.picker_input,"value",&get(&self.ctx.env("spineColorStyle",&[&selected])?,"color"));
  put(&self.binding_finish,"value",&self.ctx.env("spineFinish",&[&get(book,"spineFinish")])?);
  put(&self.ink_finish,"value",&self.ctx.env("spineFinish",&[&get(book,"spineTextFinish")])?);
  put(&self.cover_surface,"value",&self.ctx.env("surfaceFinish",&[&get(book,"coverFinish")])?);
  put(&self.edge_surface,"value",&self.ctx.env("surfaceFinish",&[&get(book,"pageEdgeFinish")])?);
  put(&self.spine_surface,"value",&self.ctx.env("surfaceFinish",&[&get(book,"spineSurfaceFinish"),&s("matte")])?);
  put(&self.ink_picker,"value",&get(&get(&self.item,"style"),"ink"));
  putb(&self.engraved,"checked",get(book,"spineEngraved")==JsValue::TRUE);
  let custom_selected=cloth&&!follows_cover&&!self.suggested.iter().any(|color|*color==selected);
  let chip=get(&self.picker_input,"parentElement");
  if truthy(&chip){
   cls_toggle(&chip,"is-selected",custom_selected);
   if custom_selected{let _=method(&style(&chip),"setProperty",&[&s("--ihr-swatch-color"),&selected]);}
   else{style_remove(&chip,"--ihr-swatch-color");}
  }
  let _=method(&style(&self.pipette),"setProperty",&[&s("--ihr-pipette-color"),&selected]);
  let wanted=get(&self.font_select,"value");
  let font=SPINE_FONTS.iter().find(|font|s(font.family)==wanted).unwrap_or(&SPINE_FONTS[0]);
  style_prop(&self.font_select,"fontFamily",&format!("\"{}\", {}",font.family,font.fallback));
  style_prop(&self.font_select,"fontWeight",&ns(font.weight));
  let cloth_color=if follows_cover{self.suggested.first().cloned().unwrap_or(undef())}else{selected.clone()};
  let _=method(&style(&self.panel),"setProperty",&[&s("--ihr-ed-cloth"),&cloth_color]);
  let text_color=or(get(book,"spineTextColor"),s(""));
  let ink=if is_hex6(&text(&text_color)){get(book,"spineTextColor")}else{get(&self.ctx.env("spineColorStyle",&[&get(&get(&self.item,"style"),"color")])?,"ink")};
  let _=method(&style(&self.panel),"setProperty",&[&s("--ihr-ed-ink"),&ink]);
  for picker in &self.finish_pickers{
   let value=get(&picker.select,"value");
   put(&dataset(&picker.picker),"value",&value);
   for sample in &picker.samples{cls_toggle(sample,"is-active",data_get(sample,"value")==value);}
  }
  Ok(())
 }
 pub(super) fn select_spine_color(&self,color:&JsValue)->R{
  let chosen=get(&self.ctx.env("spineColorStyle",&[color])?,"color");
  *self.selected_color.borrow_mut()=chosen.clone();
  put(&self.book,"spineColorOverride",&chosen);
  self.update_customization(&obj(&[("spineColorOverride",&chosen),("spineFinish",&s("matte"))]))
 }

 // ---------------------------------------------------------------- tabs
 fn set_tab_heading(&self,button:&JsValue){editor_tab_heading(&self.heading,button);}
 pub(super) fn sync_editor_tab(&self,tab:&str)->R{
  let id=text(&crate::cover_editor::editor_tab_id(&s(tab)));
  *self.tab.borrow_mut()=id.clone();
  let cover=id=="cover";
  for (tab_id,button) in &self.tab_buttons{
   set_attr(button,"aria-selected",if *tab_id==id{"true"}else{"false"});
   put(button,"tabIndex",&f(if *tab_id==id{0.0}else{-1.0}));
  }
  putb(&self.spine_panel,"hidden",cover);
  putb(&self.cover_panel,"hidden",!cover);
  let heading_label=TABS.iter().find(|(known,_,_)|*known==id).map(|(_,_,heading)|*heading).unwrap_or("Lomo");
  let button=self.tab_buttons.iter().find(|(known,_)|*known==id).map(|(_,node)|node.clone()).unwrap_or(undef());
  self.set_tab_heading(&button);
  set_attr(&self.panel,"aria-label",heading_label);
  puts(&dataset(&self.panel),"tab",&id);
  cls_toggle(&self.flyout,"is-editing-cover",cover);
  Ok(())
 }
 pub(super) fn select_editor_tab(&self,next:&str,focus_tab:bool)->R{
  let next=text(&crate::cover_editor::editor_tab_id(&s(next)));
  let previous=self.tab.borrow().clone();
  if focus_tab{
   if let Some((_,button)) = self.tab_buttons.iter().find(|(known,_)|*known==next){focus(button);}
  }
  if next==previous{return Ok(());}
  self.cancel_cover_tilt();
  self.sync_editor_tab(&next)?;
  put(&self.panel,"scrollTop",&f(0.0));
  let mut turned=undef();
  if !self.hidden()&&self.ready(){
   if next=="cover"{self.fit_cover_pose()?;}else{self.fit_editor_pose()?;}
   if self.has_view(){
    turned=method(&self.view,"animate",&[&arr(&[&Editor::tf(&self.pose_for_tab(&previous)),&Editor::tf(&self.pose_for_tab(&next))]),&Editor::timing(self.duration(300.0))])?;
   }
  }
  // The analysis waits for the turn to finish: it does not compete with its animation.
  if next=="cover"{
   let finished=if truthy(&turned)&&truthy(&get(&turned,"finished")){get(&turned,"finished")}else{promise_resolve(&undef())};
   let weak=self.weak();
   then(&finished,move|_|live!(weak,e=>{
    if e.tab_is("cover")&&!e.hidden()&&e.is_session(){e.load_relief_proposals();}
    Ok(())
   }),|_|Ok(()))?;
  }
  Ok(())
 }

 // ---------------------------------------------------------------- open and close the sheet
 pub(super) fn visible_viewport(&self)->(f64,f64,f64){
  let vv=visual_viewport();
  let width=inner_width();let width=if width.is_nan()||width==0.0{0.0}else{width};
  let inner_h=inner_height();let inner_h=if inner_h.is_nan()||inner_h==0.0{0.0}else{inner_h};
  let vv_height=if truthy(&vv){num(&get(&vv,"height"))}else{0.0};
  let vv_height=if vv_height.is_nan()||vv_height==0.0{inner_h}else{vv_height};
  let top=if truthy(&vv){num(&get(&vv,"offsetTop"))}else{0.0};let top=if top.is_nan()||top==0.0{0.0}else{top};
  (width,min(inner_h,vv_height),top)
 }
 pub(super) fn open_editor(&self)->R{
  if !self.ready(){return Ok(());}
  let (width,height,_)=self.visible_viewport();
  putf(&self.session,"editorViewportWidth",width);putf(&self.session,"editorViewportHeight",height);
  putb(&self.session,"keyboardOpen",false);
  // It always opens on the spine; the cover is chosen with its tab.
  self.sync_editor_tab("spine")?;
  putb(&self.panel,"hidden",false);
  cls_add(&self.flyout,&["is-editing-spine"]);
  cls_add(&self.meta,&["is-editing"]);
  putb(&self.cover_target,"hidden",true);
  set_attr(&self.edit_button,"aria-expanded","true");
  self.refresh_editor_preview()?;
  self.fit_editor_pose()?;
  if self.has_view(){
   method(&self.view,"animate",&[&arr(&[&Editor::tf(&Editor::identity_pose()),&Editor::tf(&self.editor_pose)]),&Editor::timing(self.duration(230.0))])?;
  }
  // Focus the sheet itself: keyboard users start at its top without a focus ring landing on a control.
  put(&self.panel,"scrollTop",&f(0.0));
  focus(&self.panel);
  Ok(())
 }
 pub(super) fn close_editor(&self,commit:bool,restore_focus:bool)->R{
  if self.hidden(){return Ok(());}
  let leaving=self.pose_for_tab(&self.tab.borrow().clone());
  self.stop_cover_editor_work()?;
  self.sync_editor_tab("spine")?;
  putb(&self.panel,"hidden",true);
  cls_remove(&self.flyout,&["is-editing-spine"]);
  cls_remove(&self.meta,&["is-editing"]);
  putb(&self.cover_target,"hidden",!truthy(&get(&self.ctx.opts,"autoOpen")));
  set_attr(&self.edit_button,"aria-expanded","false");
  {let previous=self.preview_timer.borrow().clone();if previous.is_set(){cancel(&previous);}*self.preview_timer.borrow_mut()=Timer::none();}
  let changed=self.dirty.get();
  if changed&&self.ready(){
   if commit{self.view_do("updateAppearance",&[&get(&self.item,"style"),&obj(&[("reuseModel",&JsValue::TRUE)])])?;}
   update_book_style_vars(&self.book_node,&get(&self.item,"style"));
   (self.host)()?;
   self.dirty.set(false);
  }
  if commit&&self.ready()&&self.has_view(){
   putb(&self.cover_target,"disabled",true);
   let back=method(&self.view,"animate",&[&arr(&[&Editor::tf(&leaving),&Editor::tf(&Editor::identity_pose())]),&Editor::timing(self.duration(220.0))])?;
   let weak=self.weak();
   then(&get(&back,"finished"),move|_|live!(weak,e=>{
    if e.is_session()&&e.ready()&&!e.hidden(){return Ok(());}
    if e.is_session()&&e.ready(){putb(&e.cover_target,"disabled",false);}
    Ok(())
   }),|_|Ok(()))?;
  }
  self.save_customization_now()?;
  if restore_focus&&self.ready(){focus(&self.edit_button);}
  Ok(())
 }

 pub(super) fn panel_node(&self)->JsValue{self.panel.clone()}
 pub(super) fn is_hidden(&self)->bool{self.hidden()}
 pub(super) fn disable_controls(&self){for control in qsa(&self.panel,"button, input, select"){putb(&control,"disabled",true);}}
 /// The sheet's work ends with its lifted book: callbacks, timers and listeners are let go.
 pub(super) fn dispose(&self){
  if self.disposed.replace(true){return;}
  let timers=[self.preview_timer.borrow().clone()];
  for timer in timers.iter(){if timer.is_set(){cancel(timer);}}
  {let mut relief=self.relief.borrow_mut();
   if relief.tilt_timer.is_set(){cancel(&relief.tilt_timer);}
   if relief.slider_frame.is_set(){cancel_frame(&relief.slider_frame);}
   relief.tilt_cleanup=None;}
  let listeners=std::mem::take(&mut *self.keep.borrow_mut());drop(listeners);
  let cards=std::mem::take(&mut *self.cards_keep.borrow_mut());drop(cards);
  // The session outlives its sheet for a moment: what it still holds must not call a closure that is gone.
  put(&self.session,"handleViewportResize",&js_sys::Function::new_no_args("return false"));
  let handlers=std::mem::take(&mut *self.handlers.borrow_mut());drop(handlers);
 }
}

/// `setEditorTabHeading`: the active tab is the visible section heading, with one shared hit target.
/// Wrapping the existing button preserves its id, handlers and tab order.
#[wasm_bindgen]
pub fn editor_tab_heading(heading:&JsValue,button:&JsValue){
 if !truthy(heading)||!truthy(button){return;}
 if get(heading,"firstElementChild")==*button{return;}
 let previous=get(heading,"firstElementChild");
 let focused=get(&get(heading,"ownerDocument"),"activeElement");
 if truthy(&previous){replace_with(heading,&previous);}else{remove(heading);}
 replace_with(button,heading);
 replace_children(heading,&[button.clone()]);
 if focused==previous||focused==*button{focus(&focused);}
}

/// `label.match(/, (?:leído al \d+ %|terminado)$/)?.[0] || ''`.
fn progress_suffix(label:&str)->String{
 let mut from=0;
 while let Some(found)=label[from..].find(", "){
  let start=from+found;let rest=&label[start+2..];
  if rest=="terminado"{return label[start..].to_string();}
  if let Some(tail)=rest.strip_prefix("leído al "){
   if let Some(digits)=tail.strip_suffix(" %"){if !digits.is_empty()&&digits.bytes().all(|byte|byte.is_ascii_digit()){return label[start..].to_string();}}
  }
  from=start+1;
 }
 String::new()
}
