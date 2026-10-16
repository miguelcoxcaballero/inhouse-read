//! The cover tab: relief proposals, the intensity of each colour layer and the sway of the book that lets
//! the light travel over the chosen relief.
use wasm_bindgen::prelude::*;
use std::rc::Rc;
use js_sys::Array;
use super::{util::*,editor::*,style::*};

impl Editor{
 pub(super) fn wire_relief(&self)->R{
  let w=self.weak();
  let keep=&self.keep;
  {let w=w.clone();on(keep,&self.relief_retry,"click",move|_|live!(w,e=>{e.relief.borrow_mut().status="idle".to_string();e.load_relief_proposals();Ok(())}))?;}
  {let w=w.clone();on(keep,&self.relief_none,"click",move|_|live!(w,e=>e.choose_relief(None,true)))?;}
  {let w=w.clone();let select=self.relief_color_select.clone();on(keep,&self.relief_color_select,"change",move|_|live!(w,e=>{
   e.relief.borrow_mut().active_color=get(&select,"value");e.sync_relief_selection()
  }))?;}
  {let w=w.clone();let input=self.relief_strength.clone();on(keep,&self.relief_strength,"input",move|_|live!(w,e=>{
   let percent=num(&get(&input,"value"));
   set_text(&e.relief_strength_output,&format!("{} %",ns(percent)));
   sync_range(&input);
   let layers=array_of(&e.ctx.env("coverReliefLayers",&[&get(&e.book,"coverRelief")])?);
   if layers.is_empty(){return Ok(());}
   let active=e.relief.borrow().active_color.clone();
   let mut next=Vec::new();
   for layer in &layers{
    if get(layer,"color")==active{next.push(spread(&[layer,&obj(&[("strength",&f(percent/100.0))])]));}else{next.push(layer.clone());}
   }
   let packed=e.pack_relief(&next)?;
   e.update_customization(&obj(&[("coverRelief",&packed)]))?;
   // One push to the view per frame at most while dragging.
   let pending=e.relief.borrow().slider_frame.is_set();
   if !pending{
    let weak=e.weak();
    let timer=frame(move||live!(weak,e=>{
     e.relief.borrow_mut().slider_frame=Timer::none();
     let normalized=e.ctx.env("normalizeCoverRelief",&[&get(&e.book,"coverRelief")])?;
     e.push_relief_to_view(&normalized)?;Ok(())
    }));
    e.relief.borrow_mut().slider_frame=timer;
   }
   Ok(())
  }))?;}
  Ok(())
 }

 // ---------------------------------------------------------------- the pose of the book on the cover tab
 /// Wide screens float the tray under the spine: grow the preview into the clear band above it.
 pub(super) fn fit_editor_pose(&self)->R{
  let g=&self.geo;
  if g.landscape||g.vw<760.0{return Ok(());}
  let top=28.0;let bottom=num(&get(&rect(&self.panel)?,"top"))-22.0;
  // The bookmark ribbon rises about 8 % above the head of the spine.
  let scale=min(0.92,max(0.58,(bottom-top)/(g.cover_h*1.08)));
  if !scale.is_finite(){return Ok(());}
  putf(&self.editor_pose,"scale",scale);
  putf(&self.editor_pose,"y",bottom-g.cover_h*scale/2.0-g.center_y);
  Ok(())
 }
 /// The sheet of the active tab is laid out: its top edge limits the free band. Without a usable measure, a fallback.
 pub(super) fn fit_cover_pose(&self)->R{
  let g=&self.geo;
  let sheet_top=if self.hidden(){f64::NAN}else{num(&get(&rect(&self.panel)?,"top"))};
  let options=obj(&[("viewportWidth",&f(g.vw)),("viewportHeight",&f(g.vh)),("landscape",&b(g.landscape)),("coverW",&f(g.cover_w)),("coverH",&f(g.cover_h)),
   ("centerY",&f(g.center_y)),("thickness",&f(g.thickness)),("sheetTop",&f(sheet_top))]);
  let pose=crate::cover_editor::cover_editor_pose(&options)?;
  assign(&self.cover_pose,&pose)?;
  Ok(())
 }
 /// When the cards arrive the sheet can change height by a few pixels: the cover resettles gently, unless it is already swaying.
 pub(super) fn refit_cover_pose(&self)->R{
  if !self.has_view()||!self.tab_is("cover")||self.hidden()||!self.ready()||self.relief.borrow().tilt_cleanup.is_some(){return Ok(());}
  let before=spread(&[&self.cover_pose]);
  self.fit_cover_pose()?;
  if (gn(&before,"y")-gn(&self.cover_pose,"y")).abs()<6.0&&(gn(&before,"scale")-gn(&self.cover_pose,"scale")).abs()<0.02{assign(&self.cover_pose,&before)?;return Ok(());}
  method(&self.view,"animate",&[&arr(&[&Editor::tf(&before),&Editor::tf(&self.cover_pose)]),&Editor::timing(self.duration(220.0))])?;
  Ok(())
 }
 fn relief_key(&self)->R<String>{
  let key=coalesce(coalesce(get(&self.item,"coverKey"),self.cover_url.clone()),s(""));
  let title=self.ctx.env("displayBookTitle",&[&self.book])?;
  let author=self.ctx.env("normalizeBookAuthor",&[&get(&self.book,"author")])?;
  Ok(format!("color-zones-v3-ten|{}|{}|{}",text(&key),text(&title),text(&author)))
 }

 // ---------------------------------------------------------------- the sway
 /// Everything that depends on the tab is set aside: the sway, its timers and the analysis in flight.
 pub(super) fn cancel_cover_tilt(&self){
  let (timer,cleanup)={let mut relief=self.relief.borrow_mut();
   let timer=std::mem::replace(&mut relief.tilt_timer,Timer::none());
   relief.tilt_token=relief.tilt_token.wrapping_add(1);
   (timer,relief.tilt_cleanup.take())};
  if timer.is_set(){cancel(&timer);}
  drop(cleanup);
 }
 pub(super) fn stop_cover_editor_work(&self)->R{
  self.cancel_cover_tilt();
  let slider=std::mem::replace(&mut self.relief.borrow_mut().slider_frame,Timer::none());
  if slider.is_set(){cancel_frame(&slider);}
  let loading=self.relief.borrow().status=="loading";
  if loading{
   let controller=std::mem::replace(&mut self.relief.borrow_mut().controller,null());
   if truthy(&controller){method(&controller,"abort",&[])?;}
   self.relief.borrow_mut().status="idle".to_string();
   self.render_relief_cards()?;
  }
  Ok(())
 }
 fn start_cover_tilt(&self)->R{
  self.relief.borrow_mut().tilt_timer=Timer::none();
  if !self.has_view()||!self.tab_is("cover")||self.hidden()||!self.ready(){return Ok(());}
  let token={let mut relief=self.relief.borrow_mut();relief.tilt_token=relief.tilt_token.wrapping_add(1);relief.tilt_token};
  let sway=crate::cover_editor::cover_tilt_frames(&self.cover_pose,&undef())?;
  let frames=get(&sway,"frames");let duration=get(&sway,"duration");
  let motion=method(&self.view,"animate",&[&frames,&obj(&[("duration",&duration)])])?;
  // Any gesture of the user stops the sway and returns the cover to its place: it does not compete with the hand.
  let mut listeners=Vec::new();
  for kind in ["pointerdown","keydown","wheel","touchstart"]{
   let weak=self.weak();
   listeners.push(on_capture_passive(&document(),kind,move|_|live!(weak,e=>{
    if token!=e.relief.borrow().tilt_token{return Ok(());}
    e.cancel_cover_tilt();
    let current=coalesce(method_opt(&e.view,"getPose",&[])?.unwrap_or(undef()),e.cover_pose.clone());
    method(&e.view,"animate",&[&arr(&[&Editor::tf(&current),&Editor::tf(&e.cover_pose)]),&Editor::timing(240.0)])?;Ok(())
   }))?);
  }
  self.relief.borrow_mut().tilt_cleanup=Some(listeners);
  let weak=self.weak();
  then(&get(&motion,"finished"),move|_|live!(weak,e=>{if token==e.relief.borrow().tilt_token{e.cancel_cover_tilt();}Ok(())}),|_|Ok(()))?;
  Ok(())
 }
 /// After choosing a relief the book sways a few times so the light travels over the surface. With reduced motion it does not.
 fn schedule_cover_tilt(&self)->R{
  self.cancel_cover_tilt();
  if !self.has_view()||prefers_reduced_motion()||!self.tab_is("cover"){return Ok(());}
  let token=self.relief.borrow().tilt_token;
  let applied=coalesce(self.relief.borrow().applied.clone(),JsValue::TRUE);
  let weak=self.weak();
  then(&promise_resolve(&applied),move|done|live!(weak,e=>{
   if done==JsValue::FALSE||token!=e.relief.borrow().tilt_token||!e.tab_is("cover")||e.hidden()||!e.is_session(){return Ok(());}
   let again=e.weak();
   let timer=after(140.0,move||live!(again,e=>e.start_cover_tilt()));
   e.relief.borrow_mut().tilt_timer=timer;Ok(())
  }),|_|Ok(()))?;
  Ok(())
 }

 // ---------------------------------------------------------------- proposals
 fn clean_proposals(&self,list:&JsValue)->R<JsValue>{
  let proposals=Array::new();let mut colors:Vec<JsValue>=Vec::new();let mut ids:Vec<JsValue>=Vec::new();
  let limit=array_of(&self.ctx.env_value("COLOR_RELIEF_IDS")).len();
  for proposal in array_of(list){
   let choice=self.ctx.env("normalizeCoverRelief",&[&proposal])?;
   let color=get(&choice,"color");
   if !truthy(&color)||get(&proposal,"label").as_string().is_none()||colors.contains(&color)||ids.contains(&get(&choice,"id")){continue;}
   colors.push(color);ids.push(get(&choice,"id"));
   let description=get(&proposal,"description");
   let thumbnail=get(&proposal,"thumbnail");
   let thumb=thumbnail.as_string().filter(|value|value.starts_with("data:image/")).map(|value|s(&value)).unwrap_or(s(""));
   let entry=spread(&[&choice,&obj(&[("label",&get(&proposal,"label")),("description",&if description.as_string().is_some(){description}else{s("")}),("thumbnail",&thumb)])]);
   proposals.push(&entry);
   if proposals.length() as usize==limit{break;}
  }
  Ok(proposals.into())
 }
 pub(super) fn push_relief_to_view(&self,next:&JsValue)->R<JsValue>{
  let applied=if truthy(&self.view)&&truthy(&get(&self.view,"setCoverRelief")){
   let result=method(&self.view,"setCoverRelief",&[next])?;
   then_map(&promise_resolve(&result),Ok,|error|{warn("No se pudo aplicar el relieve:",&error);Ok(JsValue::FALSE)})?
  }else{
   view_update_cover(&self.view,&self.book)?;
   promise_resolve(&JsValue::TRUE)
  };
  self.relief.borrow_mut().applied=applied.clone();
  Ok(applied)
 }
 fn apply_relief(&self,next:&JsValue)->R{
  self.update_customization(&obj(&[("coverRelief",next)]))?;
  self.push_relief_to_view(next)?;Ok(())
 }
 pub(super) fn pack_relief(&self,layers:&[JsValue])->R<JsValue>{
  if layers.len()>1{
   let list:Vec<&JsValue>=layers.iter().collect();
   self.ctx.env("normalizeCoverRelief",&[&obj(&[("layers",&arr(&list))])])
  }else{Ok(layers.first().cloned().unwrap_or(null()))}
 }
 pub(super) fn sync_relief_selection(&self)->R{
  let current=self.ctx.env("normalizeCoverRelief",&[&get(&self.book,"coverRelief")])?;
  let layers=array_of(&self.ctx.env("coverReliefLayers",&[&current])?);
  let active_color=self.relief.borrow().active_color.clone();
  if !layers.iter().any(|layer|get(layer,"color")==active_color){
   self.relief.borrow_mut().active_color=layers.last().map(|layer|get(layer,"color")).filter(truthy).unwrap_or(null());
  }
  let active_color=self.relief.borrow().active_color.clone();
  let active=layers.iter().find(|layer|get(layer,"color")==active_color).cloned();
  let proposals=array_of(&self.relief.borrow().proposals_value());
  for input in qsa(&self.relief_grid,"input"){
   let value=get(&input,"value");
   let proposal=proposals.iter().find(|item|get(item,"id")==value);
   let on=layers.iter().any(|layer|match proposal{Some(proposal)=>get(proposal,"color")==get(layer,"color")&&get(proposal,"tolerance")==get(layer,"tolerance"),None=>false});
   putb(&input,"checked",on);
   cls_toggle(&closest(&input,".ihr-relief-card"),"is-selected",on);
  }
  let status=self.relief.borrow().status.clone();
  set_attr(&self.relief_none,"aria-pressed",if truthy(&current){"false"}else{"true"});
  cls_toggle(&self.relief_none,"is-selected",!truthy(&current));
  putb(&self.relief_none,"hidden",!(status=="ready"||truthy(&current)));
  putb(&self.relief_color_select,"hidden",layers.len()<2);
  putb(&self.relief_intensity_label,"hidden",layers.len()>1);
  let mut options=Vec::new();
  for layer in &layers{
   let color=get(layer,"color");
   let label=proposals.iter().find(|proposal|get(proposal,"color")==color).map(|proposal|get(proposal,"label")).filter(truthy).unwrap_or(color.clone());
   options.push(El::new("option").attr("value",&text(&color)).text(&text(&label)).done());
  }
  replace_children(&self.relief_color_select,&options);
  put(&self.relief_color_select,"value",&or(self.relief.borrow().active_color.clone(),s("")));
  putb(&self.relief_strength,"disabled",active.is_none());
  let strength=coalesce(active.as_ref().map(|layer|get(layer,"strength")).unwrap_or(undef()),f(0.7));
  let percent=round(num(&strength)*100.0);
  puts(&self.relief_strength,"value",&ns(max(10.0,percent)));
  set_text(&self.relief_strength_output,&if active.is_some(){format!("{} %",ns(percent))}else{"—".to_string()});
  set_attr(&self.relief_strength,"aria-description",&match &active{Some(layer)=>format!("Intensidad de {}",text(&get(layer,"color"))),None=>"Elige uno o varios colores".to_string()});
  sync_range(&self.relief_strength);
  putb(&self.relief_strength_row,"hidden",!(status=="ready"||truthy(&current)));
  if status=="ready"{
   set_text(&self.relief_status,if truthy(&current)&&layers.is_empty(){"Elige un color para actualizar el relieve."}else{""});
  }
  Ok(())
 }
 pub(super) fn choose_relief(&self,proposal:Option<&JsValue>,checked:bool)->R{
  let choice=match proposal{Some(proposal)=>self.ctx.env("normalizeCoverRelief",&[proposal])?,None=>null()};
  if proposal.is_some()&&!truthy(&choice){return Ok(());}
  let choice_color=if truthy(&choice){get(&choice,"color")}else{undef()};
  let mut layers:Vec<JsValue>=array_of(&self.ctx.env("coverReliefLayers",&[&get(&self.book,"coverRelief")])?).into_iter().filter(|layer|get(layer,"color")!=choice_color).collect();
  if truthy(&choice)&&checked{layers.push(choice.clone());self.relief.borrow_mut().active_color=get(&choice,"color");}
  let next=if proposal.is_some(){self.pack_relief(&layers)?}else{null()};
  self.apply_relief(&next)?;
  self.sync_relief_selection()?;
  if truthy(&next){self.schedule_cover_tilt()}else{self.cancel_cover_tilt();Ok(())}
 }
 fn relief_card(&self,proposal:&JsValue)->R<JsValue>{
  let input=El::new("input").attr("type","checkbox").attr("value",&text(&get(proposal,"id"))).class("ihr-relief__input").done();
  {
   let weak=self.weak();let proposal=proposal.clone();let node=input.clone();
   let listener=crate::host::listen(&input,"change",None,false,move|_|live!(weak,e=>e.choose_relief(Some(&proposal),truthy(&get(&node,"checked")))))?;
   self.cards_keep.borrow_mut().push(listener);
  }
  let color=text(&get(proposal,"color"));
  let preview=El::new("span").class("ihr-relief-card__preview").style(&format!("background:{color}")).attr("aria-hidden","true");
  let thumbnail=get(proposal,"thumbnail");
  let preview=if truthy(&thumbnail){
   let image=El::new("img").class("ihr-relief-card__thumb").attr("src",&text(&thumbnail)).attr("alt","").attr("draggable","false").done();
   preview.child(&image)
  }else{preview}.done();
  let swatch=El::new("span").class("ihr-relief-card__swatch").style(&format!("background:{color}")).attr("aria-hidden","true").done();
  let name=El::new("span").text(&text(&get(proposal,"label"))).done();
  let label_row=El::new("span").class("ihr-relief-card__label").child(&swatch).child(&name).done();
  let text_block=El::new("span").class("ihr-relief-card__text").child(&label_row);
  let description=get(proposal,"description");
  let text_block=if truthy(&description){text_block.child(&El::new("span").class("ihr-relief-card__description").text(&text(&description)).done())}else{text_block}.done();
  Ok(El::new("label").class("ihr-relief-card").attr("data-relief-color",&color).attr("title",&format!("{} · {}",text(&get(proposal,"label")),color))
   .child(&input).child(&preview).child(&text_block).done())
 }
 pub(super) fn render_relief_cards(&self)->R{
  let (status,proposals)={let relief=self.relief.borrow();(relief.status.clone(),relief.proposals_value())};
  set_attr(&self.cover_panel,"aria-busy",if status=="loading"{"true"}else{"false"});
  cls_toggle(&self.relief_group,"is-loading",status=="loading");
  putb(&self.relief_retry,"hidden",status!="error");
  let message=match status.as_str(){
   "loading"=>"Analizando…",
   "error"=>"No se pudo analizar la portada",
   "empty"=>if truthy(&self.cover_url){"Sin zonas detectadas"}else{"Sin portada"},
   "ready"=>{
    let current=self.ctx.env("normalizeCoverRelief",&[&get(&self.book,"coverRelief")])?;
    if truthy(&current)&&array_of(&self.ctx.env("coverReliefLayers",&[&get(&self.book,"coverRelief")])?).is_empty(){"Elige un color para actualizar el relieve."}else{""}
   },
   _=>"",
  };
  set_text(&self.relief_status,message);
  cls_toggle(&self.relief_status,"is-busy",status=="loading");
  // Reserve the cards before the turn; starting analysis must not grow the sheet over the cover that was just fitted above it.
  if status=="loading"||status=="idle"{
   self.cards_keep.borrow_mut().clear();
   let mut skeletons=Vec::new();
   for _ in array_of(&self.ctx.env_value("COLOR_RELIEF_IDS")){
    let preview=El::new("span").class("ihr-relief-card__preview").done();
    let label_row=El::new("span").class("ihr-relief-card__label").done();
    let description=El::new("span").class("ihr-relief-card__description").done();
    let text_block=El::new("span").class("ihr-relief-card__text").child(&label_row).child(&description).done();
    skeletons.push(El::new("span").class("ihr-relief-card is-skeleton").attr("aria-hidden","true").child(&preview).child(&text_block).done());
   }
   replace_children(&self.relief_grid,&skeletons);
  }else{
   self.cards_keep.borrow_mut().clear();
   let mut cards=Vec::new();
   if status=="ready"{for proposal in array_of(&proposals){cards.push(self.relief_card(&proposal)?);}}
   replace_children(&self.relief_grid,&cards);
  }
  self.sync_relief_selection()
 }
 /// Analyses the cover for relief colours (cached per cover and title) while the view prepares its relief shader.
 pub(super) fn load_relief_proposals(&self){
  let editor=self.me();
  spawn(async move{editor.load_relief_task().await?;Ok(undef())});
 }
 async fn load_relief_task(self:Rc<Editor>)->R{
  {let status=self.relief.borrow().status.clone();if status=="loading"||status=="ready"{return Ok(());}}
  if !truthy(&self.cover_url){
   self.relief.borrow_mut().status="empty".to_string();
   self.render_relief_cards()?;return self.refit_cover_pose();
  }
  self.analyse_relief().await
 }
 async fn analyse_relief(self:&Rc<Editor>)->R{
  let key=self.relief_key()?;
  let cache=self.ctx.st("reliefProposals");
  let cached=map_get(&cache,&s(&key));
  let controller=construct("AbortController",&[])?;
  {let mut relief=self.relief.borrow_mut();relief.controller=controller.clone();relief.status="loading".to_string();}
  self.render_relief_cards()?;
  let result=self.analyse_relief_inner(&key,&cache,&cached,&controller).await;
  match result{
   Ok(true)=>{}
   Ok(false)=>return Ok(()),
   Err(error)=>{
    if self.relief.borrow().controller!=controller||gb(&get(&controller,"signal"),"aborted"){return Ok(());}
    warn("No se pudo analizar la portada para el relieve:",&error);
    self.relief.borrow_mut().status="error".to_string();
   }
  }
  self.relief.borrow_mut().controller=null();
  self.render_relief_cards()?;
  self.refit_cover_pose()
 }
 /// The `try` of the original: `Ok(false)` where it returned early.
 async fn analyse_relief_inner(self:&Rc<Editor>,key:&str,cache:&JsValue,cached:&JsValue,controller:&JsValue)->R<bool>{
  // Cached proposals still belong to a new flyout/material. Prepare its shader before any card can be chosen.
  let first=if truthy(cached){obj(&[("proposals",cached)])}else{
   let options=obj(&[("title",&get(&self.book,"title")),("author",&self.ctx.env("normalizeBookAuthor",&[&get(&self.book,"author")])?),("signal",&get(controller,"signal")),("previews",&JsValue::FALSE)]);
   self.ctx.env("analyzeCoverRelief",&[&self.cover_url,&options])?
  };
  let second=self.view_opt("prepareCoverRelief",&[])?;
  let all=method(&get(&global(),"Promise"),"all",&[&arr(&[&first,&second])])?;
  let results=settle(all).await?;
  let result=array_of(&results).into_iter().next().unwrap_or(undef());
  if self.relief.borrow().controller!=*controller||!self.is_session(){return Ok(false);}
  let proposals=self.clean_proposals(&get(&result,"proposals"))?;
  let count=Array::from(&proposals).length();
  {let mut relief=self.relief.borrow_mut();relief.set_proposals(proposals.clone());relief.status=if count>0{"ready"}else{"empty"}.to_string();}
  if count>0{
   map_set(cache,&s(key),&proposals);
   if map_size(cache)>12.0{
    let keys=method(cache,"keys",&[])?;let first_key=get(&method(&keys,"next",&[])?,"value");
    map_delete(cache,&first_key);
   }
  }
  Ok(true)
 }
}

impl Relief{
 pub(super) fn proposals_value(&self)->JsValue{self.proposals.clone()}
 /// Keeps the very array that was cached with the host (it is read back as the next flyout's proposals).
 pub(super) fn set_proposals(&mut self,array:JsValue){self.proposals=array;}
}

/// `view.updateCoverAppearance?.(book)` of the fallback that has no `setCoverRelief`.
fn view_update_cover(view:&JsValue,book:&JsValue)->R{
 method_opt(view,"updateCoverAppearance",&[book])?;Ok(())
}
