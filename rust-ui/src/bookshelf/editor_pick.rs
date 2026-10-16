//! The colour dropper of the editor, the sheet's drag-down gesture and the keyboard-aware viewport.
use std::rc::Rc;
use wasm_bindgen::prelude::*;
use super::{util::*,editor::*};

const EASE:&str="cubic-bezier(0.4, 0, 0.2, 1)";

impl Editor{
 // ---------------------------------------------------------------- the dropper
 async fn prepare_cover_sampler(self:&Rc<Editor>)->R<JsValue>{
  {let canvas=self.sample_canvas.borrow().clone();if truthy(&canvas){return Ok(canvas);}}
  if !truthy(&self.cover_url){return Err(error("Este libro no tiene portada para muestrear."));}
  let image=construct("Image",&[])?;
  puts(&image,"decoding","async");
  put(&image,"src",&self.cover_url);
  if truthy(&get(&image,"decode")){settle(method(&image,"decode",&[])?).await?;}
  else{
   let (promise,resolve,reject)=deferred();
   put(&image,"onload",&resolve);put(&image,"onerror",&reject);
   settle(promise).await?;
  }
  let natural_w=gn(&image,"naturalWidth");let natural_h=gn(&image,"naturalHeight");
  let scale=min(1.0,1200.0/max(natural_w,natural_h));
  let width=max(1.0,round(natural_w*scale));let height=max(1.0,round(natural_h*scale));
  let canvas=create("canvas")?;
  putf(&canvas,"width",width);putf(&canvas,"height",height);
  let context=method(&canvas,"getContext",&[&s("2d"),&obj(&[("willReadFrequently",&JsValue::TRUE)])])?;
  put(&context,"fillStyle",&get(&self.style.borrow().clone(),"color"));
  method(&context,"fillRect",&[&f(0.0),&f(0.0),&f(width),&f(height)])?;
  let fit=self.ctx.env("fitCoverImage",&[&f(natural_w),&f(natural_h),&f(width),&f(height)])?;
  method(&context,"drawImage",&[&image,&f(gn(&fit,"x")*scale),&f(gn(&fit,"y")*scale),&f(gn(&fit,"width")*scale),&f(gn(&fit,"height")*scale)])?;
  // Force a read now so tainted/cross-origin covers fail before the user starts dragging.
  method(&context,"getImageData",&[&f(0.0),&f(0.0),&f(1.0),&f(1.0)])?;
  *self.sample_canvas.borrow_mut()=canvas.clone();
  Ok(canvas)
 }
 fn sample_cover_at(&self,client_x:f64,client_y:f64)->R<bool>{
  let g=&self.geo;
  let (left,top)=(g.center_x-g.cover_w/2.0,g.center_y-g.cover_h/2.0);
  let (right,bottom)=(g.center_x+g.cover_w/2.0,g.center_y+g.cover_h/2.0);
  let canvas=self.sample_canvas.borrow().clone();
  if !truthy(&canvas)||client_x<left||client_x>right||client_y<top||client_y>bottom{
   self.sampled.borrow_mut().clear();
   set_text(&self.pick_message,"Arrastra sobre la portada");
   style_remove(&self.pick_handle,"--ihr-picked-color");
   remove_attr(&self.pick_handle,"data-color");
   return Ok(false);
  }
  let (cw,ch)=(gn(&canvas,"width"),gn(&canvas,"height"));
  let x=min(cw-1.0,((client_x-left)/g.cover_w*cw).floor());
  let y=min(ch-1.0,((client_y-top)/g.cover_h*ch).floor());
  let context=method(&canvas,"getContext",&[&s("2d"),&obj(&[("willReadFrequently",&JsValue::TRUE)])])?;
  let data=get(&method(&context,"getImageData",&[&f(x),&f(y),&f(1.0),&f(1.0)])?,"data");
  let channel=|index:u32|num(&get_at(&data,index)) as u32;
  let color=format!("#{:02x}{:02x}{:02x}",channel(0),channel(1),channel(2));
  *self.sampled.borrow_mut()=color.clone();
  style_set(&self.pick_handle,"--ihr-picked-color",&color);
  puts(&dataset(&self.pick_handle),"color",&color);
  set_text(&self.pick_message,&format!("{} · Suelta",color.to_uppercase()));
  Ok(true)
 }
 pub(super) fn begin_color_pick(&self){
  let editor=self.me();
  spawn(async move{editor.begin_color_pick_task().await?;Ok(undef())});
 }
 async fn begin_color_pick_task(self:Rc<Editor>)->R{
  if !self.ready()||gb(&self.session,"colorPicking"){return Ok(());}
  let button=self.pipette.clone();
  putb(&button,"disabled",true);
  if let Err(error)=self.prepare_cover_sampler().await{
   warn("No se pudo leer la portada para elegir un color:",&error);
   set_text(&self.pick_message,"No se pudo leer esta portada");
   putb(&self.pick_layer,"hidden",false);
   cls_add(&self.flyout,&["is-picking-color"]);
   set_text(&self.pick_cancel,"Cerrar");
   putb(&button,"disabled",false);
   return Ok(());
  }
  putb(&button,"disabled",false);
  putb(&self.session,"colorPicking",true);
  put(&self.session,"pickingButton",&button);
  putb(&self.panel,"hidden",true);
  cls_remove(&self.flyout,&["is-editing-spine"]);
  cls_remove(&self.meta,&["is-editing"]);
  set_attr(&self.edit_button,"aria-expanded","false");
  putb(&self.pick_layer,"hidden",false);
  set_text(&self.pick_cancel,"Cancelar");
  set_text(&self.pick_message,"Arrastra sobre la portada");
  let _=method(&style(&self.pick_handle),"setProperty",&[&s("--ihr-picked-color"),&self.selected_color.borrow().clone()]);
  let g=&self.geo;
  style_prop(&self.pick_handle,"left",&format!("{}px",ns(g.center_x)));
  style_prop(&self.pick_handle,"top",&format!("{}px",ns(min(g.vh-76.0,g.center_y+g.cover_h/2.0+44.0))));
  cls_add(&self.flyout,&["is-picking-color"]);
  let motion=if self.has_view(){
   method(&self.view,"animate",&[&arr(&[&Editor::tf(&self.editor_pose),&Editor::tf(&Editor::identity_pose())]),&Editor::timing(self.duration(360.0))])?
  }else{
   let frames=arr(&[&obj(&[("transform",&s("scale(.92)"))]),&obj(&[("transform",&s("scale(1)"))])]);
   animate(&self.book_node,&frames,&obj(&[("duration",&f(self.duration(260.0))),("easing",&s(EASE))]))?
  };
  settle(get(&motion,"finished")).await?;
  focus(&self.pick_handle);
  Ok(())
 }
 pub(super) fn finish_color_pick(&self,apply:bool)->JsValue{
  let editor=self.me();
  run(async move{editor.finish_color_pick_task(apply).await?;Ok(undef())})
 }
 async fn finish_color_pick_task(self:Rc<Editor>,apply:bool)->R{
  if !gb(&self.session,"colorPicking")&&gb(&self.pick_layer,"hidden"){return Ok(());}
  let was_picking=gb(&self.session,"colorPicking");
  putb(&self.session,"colorPicking",false);
  self.dragging.set(false);
  putb(&self.pick_layer,"hidden",true);
  cls_remove(&self.pick_handle,&["is-dragging"]);
  cls_remove(&self.flyout,&["is-picking-color"]);
  let sampled=self.sampled.borrow().clone();
  if apply&&!sampled.is_empty(){self.select_spine_color(&s(&sampled))?;}
  self.sampled.borrow_mut().clear();
  if self.ready()&&!self.hidden(){return Ok(());}
  putb(&self.panel,"hidden",false);
  cls_add(&self.flyout,&["is-editing-spine"]);
  cls_add(&self.meta,&["is-editing"]);
  set_attr(&self.edit_button,"aria-expanded","true");
  self.refresh_editor_preview()?;
  self.fit_editor_pose()?;
  if was_picking&&self.ready(){
   let motion=if self.has_view(){
    method(&self.view,"animate",&[&arr(&[&Editor::tf(&Editor::identity_pose()),&Editor::tf(&self.editor_pose)]),&Editor::timing(self.duration(320.0))])?
   }else{
    let frames=arr(&[&obj(&[("transform",&s("scale(1)"))]),&obj(&[("transform",&s("scale(.92)"))])]);
    animate(&self.book_node,&frames,&obj(&[("duration",&f(self.duration(260.0))),("easing",&s(EASE))]))?
   };
   settle(get(&motion,"finished")).await?;
  }
  let button=get(&self.session,"pickingButton");
  if truthy(&button)&&is_connected(&button){focus(&button);}
  put(&self.session,"pickingButton",&null());
  Ok(())
 }
 pub(super) fn wire_color_pick(&self)->R{
  let w=self.weak();
  let keep=&self.keep;
  {let w=w.clone();on(keep,&self.pick_handle,"pointerdown",move|event|live!(w,e=>{
   if !gb(&e.session,"colorPicking"){return Ok(());}
   prevent_default(&event);
   e.dragging.set(true);
   cls_add(&e.pick_handle,&["is-dragging"]);
   method_opt(&e.pick_handle,"setPointerCapture",&[&get(&event,"pointerId")])?;Ok(())
  }))?;}
  {let w=w.clone();on(keep,&self.pick_handle,"pointermove",move|event|live!(w,e=>{
   if !e.dragging.get()||!gb(&e.session,"colorPicking"){return Ok(());}
   let bounds=rect(&e.flyout)?;
   let x=gn(&event,"clientX")-gn(&bounds,"left");let y=gn(&event,"clientY")-gn(&bounds,"top");
   style_prop(&e.pick_handle,"left",&format!("{}px",ns(x)));style_prop(&e.pick_handle,"top",&format!("{}px",ns(y)));
   e.sample_cover_at(x,y)?;Ok(())
  }))?;}
  {let w=w.clone();on(keep,&self.pick_handle,"pointerup",move|event|live!(w,e=>{
   if !e.dragging.get(){return Ok(());}
   e.dragging.set(false);
   cls_remove(&e.pick_handle,&["is-dragging"]);
   let bounds=rect(&e.flyout)?;
   let x=gn(&event,"clientX")-gn(&bounds,"left");let y=gn(&event,"clientY")-gn(&bounds,"top");
   style_prop(&e.pick_handle,"left",&format!("{}px",ns(x)));style_prop(&e.pick_handle,"top",&format!("{}px",ns(y)));
   e.sample_cover_at(x,y)?;
   if !e.sampled.borrow().is_empty(){e.finish_color_pick(true);}
   else{set_text(&e.pick_message,"Suelta sobre la portada");}
   Ok(())
  }))?;}
  {let w=w.clone();on(keep,&self.pick_handle,"pointercancel",move|_|live!(w,e=>{
   e.dragging.set(false);
   cls_remove(&e.pick_handle,&["is-dragging"]);Ok(())
  }))?;}
  Ok(())
 }

 // ---------------------------------------------------------------- the sheet follows the keyboard
 fn sync_flyout_viewport(&self){
  if !gb(&self.session,"keyboardOpen"){
   cls_remove(&self.flyout,&["uses-visual-viewport"]);
   style_remove(&self.flyout,"--ihr-visible-top");style_remove(&self.flyout,"--ihr-visible-height");
   return;
  }
  let (_,height,top)=self.visible_viewport();
  style_set(&self.flyout,"--ihr-visible-top",&format!("{}px",ns(top)));
  style_set(&self.flyout,"--ihr-visible-height",&format!("{}px",ns(height)));
  cls_add(&self.flyout,&["uses-visual-viewport"]);
 }
 pub(super) fn keep_title_visible(&self)->R{
  if self.hidden()||active_element()!=self.title_input{return Ok(());}
  let panel_rect=rect(&self.panel)?;let field_rect=rect(&self.title_input)?;
  // The sticky header covers the top of the scrollport.
  let top=max(gn(&panel_rect,"top"),gn(&rect(&self.header)?,"bottom"));
  let margin=14.0;
  if gn(&field_rect,"bottom")>gn(&panel_rect,"bottom")-margin{
   putf(&self.panel,"scrollTop",gn(&self.panel,"scrollTop")+gn(&field_rect,"bottom")-gn(&panel_rect,"bottom")+margin);
  }else if gn(&field_rect,"top")<top+margin{
   putf(&self.panel,"scrollTop",gn(&self.panel,"scrollTop")-(top+margin-gn(&field_rect,"top")));
  }
  Ok(())
 }
 fn handle_viewport_resize(&self)->R<bool>{
  let height=num(&get(&self.session,"editorViewportHeight"));
  if self.hidden()||height.is_nan()||height==0.0{return Ok(false);}
  let (width,viewport_height,_)=self.visible_viewport();
  if (width-gn(&self.session,"editorViewportWidth")).abs()>=40.0{return Ok(false);}
  let visible=viewport_height<height-100.0;
  putb(&self.session,"keyboardOpen",visible);
  self.sync_flyout_viewport();
  if visible{
   let weak=self.weak();
   let outer=frame(move||live!(weak,e=>{
    let again=e.weak();
    let inner=frame(move||live!(again,e=>e.keep_title_visible()));
    drop(inner);Ok(())
   }));
   drop(outer);
  }
  Ok(true)
 }
 pub(super) fn install_viewport_handler(&self){
  let weak=self.weak();
  let handler=fun(move|_,_|match weak.upgrade(){Some(editor)=>editor.handle_viewport_resize().map(b),None=>Ok(JsValue::FALSE)});
  put(&self.session,"handleViewportResize",&handler.function);
  self.handlers.borrow_mut().push(handler);
 }

 // ---------------------------------------------------------------- mobile sheet: dragging the header down dismisses it
 pub(super) fn wire_sheet_drag(&self)->R{
  let w=self.weak();
  let keep=&self.keep;
  {let w=w.clone();on(keep,&self.header,"pointerdown",move|event|live!(w,e=>{
   if gn(&event,"button")!=0.0||num(&get(&e.grip,"offsetWidth"))==0.0||truthy(&closest(&get(&event,"target"),"button")){return Ok(());}
   *e.sheet_drag.borrow_mut()=Some(SheetDrag{id:get(&event,"pointerId"),y:gn(&event,"clientY"),time:now(),dy:0.0});
   method_opt(&e.header,"setPointerCapture",&[&get(&event,"pointerId")])?;
   cls_add(&e.panel,&["is-dragging"]);Ok(())
  }))?;}
  {let w=w.clone();on(keep,&self.header,"pointermove",move|event|live!(w,e=>{
   let dy={
    let mut slot=e.sheet_drag.borrow_mut();
    let Some(drag)=slot.as_mut()else{return Ok(())};
    if drag.id!=get(&event,"pointerId"){return Ok(());}
    drag.dy=max(0.0,gn(&event,"clientY")-drag.y);
    drag.dy
   };
   style_prop(&e.panel,"transform",&if dy!=0.0&&!dy.is_nan(){format!("translateY({}px)",ns(dy))}else{String::new()});
   Ok(())
  }))?;}
  for kind in ["pointerup","pointercancel"]{
   let w=w.clone();
   on(keep,&self.header,kind,move|event|live!(w,e=>{
    let finished={let mut slot=e.sheet_drag.borrow_mut();
     match slot.as_ref(){Some(drag)if drag.id==get(&event,"pointerId")=>slot.take(),_=>None}};
    let Some(drag)=finished else{return Ok(())};
    cls_remove(&e.panel,&["is-dragging"]);
    style_prop(&e.panel,"transform","");
    let flick=drag.dy>36.0&&drag.dy/max(1.0,now()-drag.time)>0.55;
    if gs(&event,"type")=="pointerup"&&(drag.dy>110.0||flick){e.close_editor(true,true)?;}
    Ok(())
   }))?;
  }
  Ok(())
 }
}
