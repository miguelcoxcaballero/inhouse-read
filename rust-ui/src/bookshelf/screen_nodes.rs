//! Shelf objects and their validated inputs. Bindings belong to the node's lifetime within the shelf;
//! the DOM owns forwarding callbacks; one weak Rust dispatcher calls the native gesture/placement controllers.
use std::rc::Rc;
use wasm_bindgen::prelude::*;
use super::{util::*,ctx::{Ctx,RustShelfCtx},objects,drag,trash,style};

struct Press(JsValue);
impl Press{
 fn new()->Self{Self(obj(&[("start",&null()),("touch",&null()),("ignore",&JsValue::FALSE)]))}
 fn start(&self)->Option<(f64,f64)>{let start=get(&self.0,"start");if nullish(&start){None}else{Some((gn(&start,"x"),gn(&start,"y")))}}
 fn set_start(&self,start:Option<(f64,f64)>){put(&self.0,"start",&match start{Some((x,y))=>obj(&[("x",&f(x)),("y",&f(y))]),None=>null()});}
 fn ignore(&self)->bool{gb(&self.0,"ignore")}
 fn set_ignore(&self,value:bool){putb(&self.0,"ignore",value);}
 fn touch(&self)->JsValue{get(&self.0,"touch")}
 fn set_touch(&self,value:JsValue){put(&self.0,"touch",&value);}
 fn cancel_touch(&self){let touch=self.touch();if truthy(&touch){putb(&touch,"cancelled",true);}}
}
// DOM forwarding only; listeners retain their JS data graph and a shared, weak native dispatcher.
// No per-node Rust root keeps a detached node alive or changes an already captured event target.
fn input_data(node:&JsValue,item:&JsValue)->JsValue{obj(&[("node",node),("item",item),("press",&Press::new().0)])}
fn input(ctx:&Rc<Ctx>,node:&JsValue,kind:&str,data:&JsValue,action:&str,capture:bool)->R{
 let known=ctx.input_dispatcher.borrow().clone();
 let dispatch=if known.is_undefined(){
  let weak=Rc::downgrade(ctx);
  let dispatch=ctx.input_callbacks.make(Stale::Undefined,move|binding,event|{
   let Some(ctx)=weak.upgrade()else{return Ok(undef())};
   if ctx.st_true("destroyed"){return Ok(undef());}
   handle_input(&ctx,&binding,event)?;Ok(undef())
  });
  *ctx.input_dispatcher.borrow_mut()=dispatch.clone();dispatch
 }else{known};
 let binding=obj(&[("data",data),("action",&s(action))]);
 let mut bind=get(&ctx.parts,"inputBinder");
 if bind.is_undefined(){
  bind=js_sys::Function::new_with_args("node,type,dispatch,binding,capture",
   "const listener = event => dispatch(binding, event); if (capture) node.addEventListener(type, listener, true); else node.addEventListener(type, listener);").into();
  put(&ctx.parts,"inputBinder",&bind);
 }
 call(&bind,"bind shelf input",&[node,&s(kind),&dispatch,&binding,&b(capture)])?;Ok(())
}
fn active_node(ctx:&Ctx,node:&JsValue)->JsValue{or(get(&ctx.st("dragSession"),"node"),node.clone())}
fn delete_key(ctx:&Rc<Ctx>,node:&JsValue,event:&JsValue,is_book:bool)->R<bool>{
 let allowed=gb(&ctx.parts,if is_book{"hasBookTrash"}else{"hasTrash"});
 if !allowed||get(event,"key")!=s("Delete")||gb(event,"repeat"){return Ok(false);}
 method(event,"preventDefault",&[])?;
 if ["busy","session","dragSession","returnMotion"].iter().any(|key|ctx.st_true(key)){return Ok(true);}
 ctx.scene_call("flush",&[])?;
 let duration=if prefers_reduced_motion(){1.0}else{820.0};
 let motion=ctx.scene_call(if is_book{"animateBookToTrash"}else{"animateObjectToTrash"},&[node,&obj(&[("duration",&f(duration))])])?;
 let (ctx,node)=(ctx.clone(),node.clone());spawn(async move{trash::remove_in_trash(ctx,node,motion,undef(),duration).await});
 Ok(true)
}
fn gesture_start(ctx:&Rc<Ctx>,press:&Press,node:&JsValue,event:&JsValue,is_book:bool)->R<bool>{
 let button=get(event,"button");if !button.is_undefined()&&button!=f(0.0){return Ok(false);}
 let drag=ctx.st("dragSession");
 if get(event,"isPrimary")==JsValue::FALSE||(truthy(&drag)&&get(&drag,"pointerId")!=get(event,"pointerId")){
  press.set_ignore(true);press.cancel_touch();
  if truthy(&drag){putb(&drag,"cancelled",true);ctx.clear_timeout(&get(&drag,"timer"));}
  return Ok(false);
 }
 press.set_ignore(false);
 if is_book{ctx.st_set("suppressOpenBookId",&null());press.set_start(Some((gn(event,"clientX"),gn(event,"clientY"))));}
 let touch=if get(event,"pointerType")==s("touch"){
  let valid=absent(&ctx.scene())||ctx.scene_call(if is_book{"getBookAtPoint"}else{"getObjectAtPoint"},&[&get(event,"clientX"),&get(event,"clientY")])?==*node;
  obj(&[("pointerId",&get(event,"pointerId")),("x",&get(event,"clientX")),("y",&get(event,"clientY")),("cancelled",&JsValue::FALSE),("valid",&b(valid))])
 }else{null()};
 press.set_touch(touch);Ok(true)
}

pub fn build_plant(ctx:&Rc<Ctx>,item:&JsValue)->R<JsValue>{
 let keyed=style::spread(&[item,&obj(&[("key",&or(get(item,"key"),join_strings(&[s("plant:"),string_value(&get(item,"seed"))])))])]);
 let item=ctx.env("normalizeShelfPlant",&[&keyed])?;let plant=ctx.env("resolveCatalogPlant",&[&item])?;
 let scale=objects::plant_scale(ctx)?;let width=gn(&item,"width")*scale;let height=gn(&item,"height")*scale;
 let color=ctx.env("getPotColor",&[&get(&item,"potId"),&get(&item,"potColorId")])?;
 let node=El::new("button").attr("type","button").class(&format!("ihr-plant ihr-plant--{}",text(&get(&item,"variant"))))
  .attr_value("data-object-id",&get(&item,"key")).attr_value("data-catalog-id",&get(&plant,"id")).attr_value("data-pot-id",&get(&item,"potId"))
  .attr_value("data-pot-color-id",&get(&color,"id")).attr_value("data-plant-seed",&get(&item,"seed")).attr_value("data-plant-variant",&get(&item,"variant"))
  .attr("aria-label",&format!("Mover planta {}",text(&get(&plant,"name"))))
  .attr("aria-keyshortcuts","Shift+ArrowLeft Shift+ArrowRight Shift+ArrowUp Shift+ArrowDown Delete")
  .attr("aria-description","Mantén pulsado para mover la planta o llevarla a la papelera. Usa Mayús y las flechas para cambiar su posición o balda, y Suprimir para retirarla.")
  .attr("title","Mantén pulsado para mover").style(&format!("--ihr-plant-w:{}px;--ihr-plant-h:{}px;--ihr-plant-overhang:0px",ns(width),ns(height))).done();
 let data=input_data(&node,&item);
 input(ctx,&node,"pointerdown",&data,"build_plant-pointerdown-1",false)?;
 input(ctx,&node,"pointermove",&data,"build_plant-pointermove-1",false)?;
 input(ctx,&node,"pointerup",&data,"build_plant-pointerup-1",false)?;
 input(ctx,&node,"pointercancel",&data,"build_plant-pointercancel-1",false)?;
 input(ctx,&node,"keydown",&data,"build_plant-keydown-1",false)?;
 Ok(node)
}

pub fn build_lamp(ctx:&Rc<Ctx>,item:&JsValue)->R<JsValue>{
 let lamp=ctx.env("getCatalogLamp",&[&get(item,"lampId")])?;
 let node=El::new("button").attr("type","button").class(&format!("ihr-lamp ihr-lamp--{}",text(&get(&lamp,"id"))))
  .attr_value("data-object-id",&get(item,"key")).attr_value("data-lamp-id",&get(&lamp,"id")).attr_value("data-lamp-mount",&get(&lamp,"mount"))
  .attr("aria-keyshortcuts","Enter Space Shift+ArrowLeft Shift+ArrowRight Shift+ArrowUp Shift+ArrowDown Delete")
  .attr("aria-description","Toca para encender o apagar. Mantén pulsado para cambiar su posición o balda. Usa Mayús y las flechas para moverla, y Suprimir para retirarla.")
  .style(&format!("--ihr-lamp-w:{}px;--ihr-lamp-h:{}px",text(&get(item,"width")),text(&get(item,"height")))).done();
 objects::update_lamp_control(ctx,&node,item)?;
 if !ctx.st_true("useScene"){
  put(&node,"innerHTML",&ctx.env("lampCatalogIllustration",&[&get(&lamp,"id")])?);
  method(&qs(&node,"svg"),"setAttribute",&[&s("preserveAspectRatio"),&s("none")])?;
 }
 let data=input_data(&node,item);
 input(ctx,&node,"pointerdown",&data,"build_lamp-pointerdown-1",false)?;
 input(ctx,&node,"pointermove",&data,"build_lamp-pointermove-1",false)?;
 input(ctx,&node,"pointerleave",&data,"build_lamp-pointerleave-1",false)?;
 input(ctx,&node,"pointerup",&data,"build_lamp-pointerup-1",false)?;
 input(ctx,&node,"pointercancel",&data,"build_lamp-pointercancel-1",false)?;
 input(ctx,&node,"click",&data,"build_lamp-click-1",false)?;
 input(ctx,&node,"keydown",&data,"build_lamp-keydown-1",false)?;
 Ok(node)
}


fn release_book(ctx:&Rc<Ctx>,press:&Press,node:&JsValue,item:&JsValue){
 press.set_start(None);cls_remove(node,&["is-pressed","is-press-pending"]);
 let id=super::covers::book_id(&get(item,"book"));
 if ctx.st("pressedBookId")==id{
  ctx.st_set("pressedBookId",&null());
  ctx.set_timeout(0.0,|ctx|super::covers::maybe_refresh_appearance_styles(ctx));
 }
}
fn open_book(ctx:&Rc<Ctx>,node:&JsValue,item:&JsValue){
 let (ctx,node,item)=(ctx.clone(),node.clone(),item.clone());
 spawn(async move{super::flyout::open(ctx,node,item).await?;Ok(undef())});
}
fn spine_body_view(ctx:&Ctx,body:&JsValue,item:&JsValue)->R<JsValue>{
 let book=get(item,"book");let style=get(item,"style");let height=(if inner_width()>=600.0{200.0}else{172.0})*gn(&style,"heightRatio");
 let width=coalesce(get(item,"displayWidth"),get(&style,"width"));
 ctx.env("bookView",&[body,&book,&style,&obj(&[("width",&f(height*num(&super::covers::cover_ratio_for(ctx,&style,&undef())?))),
  ("height",&f(height)),("thickness",&get(&style,"width")),("viewportWidth",&width),("viewportHeight",&f(height)),
  ("centerX",&f(num(&width)/2.0)),("centerY",&f(height/2.0)),("shelf",&JsValue::TRUE),("shelfView",&ctx.st("viewMode"))])])
}

pub fn build_spine(ctx:&Rc<Ctx>,item:&JsValue)->R<JsValue>{
 let book=read(item,"book")?;let style=get(item,"style");let _=read(&book,"id")?;
 map_set(&ctx.st("itemsById"),&super::covers::book_id(&book),item);
 let bookmark=ctx.env("bookmarkFor",&[&book])?;let texts=get(&ctx.opts,"texts");
 let aria=if truthy(&bookmark){
  let open=method(&texts,"openAria",&[&book])?;let progress=method(&texts,"progressAria",&[&get(&bookmark,"percent")])?;
  join_strings(&[string_value(&open),s(", "),string_value(&progress)])
 }else{method(&texts,"openAria",&[&book])?};
 let tilt=get(item,"tilt");
 let css=format!("--ihr-spine-w:{}px;--ihr-spine-h:{}%;{}{}",text(&coalesce(get(item,"displayWidth"),get(&style,"width"))),
  ns(round(gn(&style,"heightRatio")*100.0)),style::spine_style_vars(&style),if truthy(&tilt){format!("--ihr-spine-tilt:{}deg;",text(&tilt))}else{String::new()});
 let node=El::new("button").attr("type","button").class(&format!("ihr-spine ihr-spine--{}",text(&get(&style,"texture"))))
  .attr_value("data-book-id",&coalesce(get(&book,"id"),s(""))).attr_value("aria-label",&aria).attr("title","Mantén pulsado para mover")
  .attr("aria-keyshortcuts","Shift+ArrowLeft Shift+ArrowRight Shift+ArrowUp Shift+ArrowDown")
  .attr("aria-description","Mantén pulsado para sacar el libro y moverlo. Usa Mayús y las flechas para cambiar su posición o balda.").style(&css).done();
 if ctx.st("returningBookId")==string_value(&get(&book,"id")){cls_add(&node,&["is-away"]);}
 if truthy(&tilt){cls_add(&node,&["is-tilted"]);}
 if gn(&style,"width")<32.0{cls_add(&node,&["ihr-spine--slim"]);}
 let body=El::new("span").class("ihr-spine__body").attr("aria-hidden","true").done();
 let view=if ctx.st_true("useScene"){null()}else{spine_body_view(ctx,&body,item)?};
 if truthy(&view){method(&view,"dispose",&[&JsValue::FALSE])?;}
 else if !ctx.st_true("useScene"){
  let label=El::new("span").class("ihr-spine__label").child(&El::new("span").class("ihr-spine__title")
   .text_value(&or(get(&book,"spineTitleOverride"),or(get(&book,"title"),s("Sin título")))).done()).done();
  if truthy(&ctx.env("normalizeBookAuthor",&[&get(&book,"author")])?){
   append(&label,&El::new("span").class("ihr-spine__author").text_value(&ctx.env("normalizeBookAuthor",&[&get(&book,"author")])?).done());
  }
  append(&body,&label);
 }
 append(&node,&body);
 if truthy(&bookmark){
  cls_add(&node,&["has-bookmark"]);if gb(&bookmark,"finished"){cls_add(&node,&["is-finished"]);}
  if !truthy(&view)&&!ctx.st_true("useScene"){
   append(&node,&El::new("span").class("ihr-spine__bookmark").attr("aria-hidden","true").style(&format!("--ihr-bookmark-peek:{}px",text(&get(&bookmark,"peek")))).done());
  }
 }
 let data=input_data(&node,item);
 input(ctx,&node,"pointerdown",&data,"build_spine-pointerdown-1",false)?;
 input(ctx,&node,"pointerup",&data,"build_spine-pointerup-1",false)?;
 input(ctx,&node,"pointercancel",&data,"build_spine-pointercancel-1",false)?;
 input(ctx,&node,"pointerleave",&data,"build_spine-pointerleave-1",false)?;
 input(ctx,&node,"pointermove",&data,"build_spine-pointermove-1",false)?;
 input(ctx,&node,"click",&data,"build_spine-click-1",false)?;
 input(ctx,&node,"keydown",&data,"build_spine-keydown-1",false)?;
 input(ctx,&node,"pointerdown",&data,"build_spine-pointerdown-2",false)?;
 input(ctx,&node,"pointermove",&data,"build_spine-pointermove-2",false)?;
 input(ctx,&node,"pointerup",&data,"build_spine-pointerup-2",false)?;
 input(ctx,&node,"pointercancel",&data,"build_spine-pointercancel-2",false)?;
 Ok(node)
}


#[wasm_bindgen]
impl RustShelfCtx{
 #[wasm_bindgen(js_name=spineBodyView)]pub fn spine_body_view(&self,body:JsValue,item:JsValue)->Result<JsValue,JsValue>{spine_body_view(&self.ctx,&body,&item)}
}

pub fn build_geometry_status(ctx:&Rc<Ctx>,books:&JsValue)->R<JsValue>{
 let status=El::new("div").class("ihr-library-loading ihr-library-loading--books").attr("role","status").attr("aria-live","polite").done();
 for book in array_of(books){
  let state=ctx.geometry_state(&book)?;
  let row=El::new("div").class("ihr-library-loading__book").done();
  if state==s("pending"){append(&row,&El::new("span").class("ihr-library-loading__spinner").attr("aria-hidden","true").done());}
  let title=or(ctx.env("displayBookTitle",&[&book])?,or(get(&book,"name"),s("Libro")));
  let message=if state==s("pending"){join_strings(&[s("Preparando "),string_value(&title),s("…")])}
   else{join_strings(&[string_value(&title),s(if state==s("needs-source"){ " · vuelve a seleccionar el archivo" }else{ " · no se pudo contar su texto" })])};
  append(&row,&El::new("span").text_value(&message).done());
  let button=El::new("button").attr("type","button").class("ihr-btn ihr-btn--ghost").done();let failed=state==s("failed");let data=obj(&[("node",&button),("book",&book),("failed",&b(failed))]);
  input(ctx,&button,"click",&data,"build_geometry_status-click-1",false)?;
  append(&button,&El::new("span").text(if failed{"Reintentar"}else{"Abrir"}).done());

  append(&row,&button);append(&status,&row);
 }
 Ok(status)
}

pub fn build_preparing_state()->JsValue{
 El::new("div").class("ihr-library-loading").attr("role","status").attr("aria-live","polite").attr("aria-label","Preparando tu estantería")
  .child(&El::new("span").class("ihr-library-loading__spinner").attr("aria-hidden","true").done()).child(&El::new("span").text("Cargando…").done()).done()
}

pub fn build_shelf(ctx:&Rc<Ctx>,shelf:&JsValue)->R<JsValue>{
 let unit=El::new("div").class("ihr-shelf").attr_value("data-shelf-index",&get(shelf,"index")).done();
 let row=El::new("div").class("ihr-shelf__row").done();
 for item in array_of(&get(shelf,"items")){
  let kind=get(&item,"kind");let node=if kind==s("plant"){build_plant(ctx,&item)?}else if kind==s("lamp"){build_lamp(ctx,&item)?}else{build_spine(ctx,&item)?};
  let left=get(&item,"left");
  if is_finite(&left){
   cls_add(&row,&["has-placements"]);style_prop(&node,"position","absolute");style_prop(&node,"left",&format!("{}px",text(&left)));
   style_prop(&node,if kind==s("lamp")&&get(&item,"mount")==s("undershelf"){"top"}else{"bottom"},"0");
   put(&dataset(&node),"objectId",&get(&item,"key"));put(&dataset(&node),"shelfIndex",&string_value(&get(shelf,"index")));put(&dataset(&node),"shelfX",&string_value(&get(&item,"x")));
  }
  append(&row,&node);
 }
 append(&unit,&El::new("div").class("ihr-shelf__back").attr("aria-hidden","true").done());append(&unit,&row);
 append(&unit,&El::new("div").class("ihr-shelf__board").attr("aria-hidden","true").done());Ok(unit)
}


pub fn build_empty_state(ctx:&Rc<Ctx>)->R<JsValue>{
 let copy=El::new("div").class("ihr-empty__copy").done();
 append(&copy,&super::pieces::roof_mark("ihr-roof ihr-empty__roof")?);
 append(&copy,&El::new("h2").class("ihr-empty__title").text_value(&ctx.text_of("emptyTitle")).done());
 if truthy(&ctx.text_of("emptyBody")){append(&copy,&El::new("p").class("ihr-empty__body").text_value(&ctx.text_of("emptyBody")).done());}
 let pick=get(&ctx.parts,"onPickLocal");
 if truthy(&pick){
  let button=El::new("button").attr("type","button").class("ihr-btn ihr-btn--primary ihr-empty__action").text_value(&ctx.text_of("emptyAction")).done();let data=obj(&[("node",&button),("callback",&pick)]);
  input(ctx,&button,"click",&data,"build_empty_state-click-1",false)?;
  append(&copy,&button);
 }
 Ok(El::new("div").class("ihr-empty").child(&copy).done())
}

pub fn build_action_bar(ctx:&Rc<Ctx>)->R<JsValue>{
 let bar=El::new("div").class("ihr-actions").attr("role","group").attr("aria-label","Añadir libros").done();
 let pick=get(&ctx.parts,"onPickLocal");let drive=get(&ctx.parts,"onDrive");
 if truthy(&pick){
  let button=El::new("button").attr("type","button").class("ihr-btn ihr-btn--primary").done();let data=obj(&[("node",&button),("callback",&pick)]);
  input(ctx,&button,"click",&data,"build_action_bar-click-1",false)?;
  append(&button,&svg_icon(&["M12 5v14","M5 12h14"],"0 0 24 24","ihr-icon")?);
  append(&button,&El::new("span").text_value(&ctx.text_of("addLocal")).done());
  append(&bar,&button);
 }
 if truthy(&drive){
  let disabled=ctx.option("driveAvailable")==JsValue::FALSE;
  let title=if ctx.option("driveAvailable")==JsValue::FALSE{s("Drive no disponible")}else{null()};
  let button=El::new("button").attr("type","button").class("ihr-btn").attr_value("disabled",&b(disabled)).attr_value("title",&title).done();let data=obj(&[("node",&button),("callback",&drive)]);
  input(ctx,&button,"click",&data,"build_action_bar-click-2",false)?;
  append(&button,&svg_icon(&super::pieces::DRIVE,"0 0 24 24","ihr-icon")?);
  append(&button,&El::new("span").text_value(&ctx.text_of("addDrive")).done());
  append(&bar,&button);
 }
 Ok(bar)
}

#[wasm_bindgen]
impl RustShelfCtx{
 #[wasm_bindgen(js_name=buildActionBar)]pub fn build_action_bar(&self)->Result<JsValue,JsValue>{build_action_bar(&self.ctx)}
}

pub fn build_library_heading(count:&JsValue)->JsValue{
 let tools=El::new("div").class("ihr-library-heading__tools").child(&El::new("p").attr("aria-live","polite").text_value(count).done()).done();
 El::new("div").class("ihr-library-heading").child(&El::new("h1").text("Biblioteca").done()).child(&tools).done()
}
pub fn build_library_empty(ctx:&Rc<Ctx>)->R<JsValue>{
 let body=coalesce(ctx.text_of("emptyText"),ctx.text_of("emptyBody"));
 let root=El::new("div").class("ihr-empty ihr-empty--library").child(&El::new("h2").class("ihr-empty__title").text_value(&ctx.text_of("emptyTitle")).done()).done();
 if truthy(&body){append(&root,&El::new("p").class("ihr-empty__body").text_value(&body).done());}
 let pick=get(&ctx.parts,"onPickLocal");
 if truthy(&pick){
  let button=El::new("button").attr("type","button").class("ihr-btn ihr-btn--primary ihr-empty__action").done();let data=obj(&[("node",&button),("callback",&pick)]);
  input(ctx,&button,"click",&data,"build_library_empty-click-1",false)?;
  append(&button,&svg_icon(&["M12 5v14","M5 12h14"],"0 0 24 24","ihr-icon")?);
  append(&button,&El::new("span").text_value(&ctx.text_of("emptyAction")).done());
  append(&root,&button);
 }
 Ok(root)
}
pub fn build_stage(ctx:&Rc<Ctx>,width:f64)->R<JsValue>{
 let stage=El::new("div").class("ihr-shelf-stage").done();let data=obj(&[("node",&stage)]);
 for kind in ["selectstart","contextmenu","dragstart"]{input(ctx,&stage,kind,&data,"prevent-default",true)?;}
 style_set(&stage,"--ihr-cabinet-width",&format!("{}px",ns(width)));Ok(stage)
}
pub fn build_section(ctx:&Ctx,section:&JsValue,count:f64)->JsValue{
 let root=El::new("section").class(&format!("ihr-section ihr-section--{}",text(&get(section,"id")))).attr_value("aria-label",&or(get(section,"title"),ctx.text_of("shelfLabel"))).done();
 if truthy(&get(section,"title")){
  append(&root,&El::new("div").class("ihr-section__header").child(&El::new("h2").class("ihr-section__title").text_value(&get(section,"title")).done())
   .child(&El::new("span").class("ihr-section__count").text(&ns(count)).attr("aria-label",&format!("{} libros",ns(count))).done()).done());
 }root
}

fn handle_input(ctx:&Rc<Ctx>,binding:&JsValue,event:JsValue)->R{
 let data=get(binding,"data");let node=get(&data,"node");let node=&node;
 let item=get(&data,"item");let press=Press(get(&data,"press"));
 let book=get(&data,"book");let failed=gb(&data,"failed");
 let pick=get(&data,"callback");let drive=pick.clone();
 match text(&get(binding,"action")).as_str(){
  "prevent-default"=>{method(&event,"preventDefault",&[])?;Ok(())},
  "build_plant-pointerdown-1"=>drag::start_spine_drag(ctx,&event,node),
  "build_plant-pointermove-1"=>drag::move_spine_drag(ctx,&event,&active_node(ctx,node)),
  "build_plant-pointerup-1"=>drag::finish_spine_drag(ctx,&event,&active_node(ctx,node),false,false),
  "build_plant-pointercancel-1"=>drag::finish_spine_drag(ctx,&event,&active_node(ctx,node),true,false),
  "build_plant-keydown-1"=>{
  if !delete_key(ctx,node,&event,false)?{objects::move_object_with_keyboard(ctx,&event,node)?;}Ok(())
 },
  "build_lamp-pointerdown-1"=>{
  if gesture_start(ctx,&press,node,&event,false)?{drag::start_spine_drag(ctx,&event,node)?;}Ok(())
 },
  "build_lamp-pointermove-1"=>{
  let touch=press.touch();
  if get(&touch,"pointerId")==get(&event,"pointerId")&&hypot(gn(&event,"clientX")-gn(&touch,"x"),gn(&event,"clientY")-gn(&touch,"y"))>objects::TAP_SLOP{putb(&touch,"cancelled",true);}
  drag::move_spine_drag(ctx,&event,&active_node(ctx,node))
 },
  "build_lamp-pointerleave-1"=>{press.cancel_touch();Ok(())},
  "build_lamp-pointerup-1"=>{
  let touch=press.touch();let candidate=if get(&touch,"pointerId")==get(&event,"pointerId"){touch}else{null()};
  let active=ctx.st("dragSession");let activate=drag::is_touch_tap_release(ctx,&event,&active,node,&candidate);
  drag::finish_spine_drag(ctx,&event,&or(get(&active,"node"),node.clone()),false,false)?;
  if truthy(&candidate){press.set_touch(null());press.set_ignore(true);}
  if activate&&is_connected(node)&&ctx.st("suppressLampClickKey")!=objects::object_key(node){trash::discard_touch_compatibility_click(ctx,&event)?;objects::toggle_lamp(ctx,node)?;}
  Ok(())
 },
  "build_lamp-pointercancel-1"=>{
  if get(&press.touch(),"pointerId")==get(&event,"pointerId"){press.set_touch(null());press.set_ignore(true);}
  drag::finish_spine_drag(ctx,&event,&active_node(ctx,node),true,false)
 },
  "build_lamp-click-1"=>{
  let pointer=trash::pointer_click(&event);
  if pointer&&(press.ignore()||truthy(&press.touch())){press.set_ignore(false);press.set_touch(null());return Ok(());}
  if pointer&&ctx.st("suppressLampClickKey")==objects::object_key(node){ctx.st_set("suppressLampClickKey",&null());return Ok(());}
  if !pointer{ctx.st_set("suppressLampClickKey",&null());}
  if pointer&&!absent(&ctx.scene())&&ctx.scene_call("getObjectAtPoint",&[&get(&event,"clientX"),&get(&event,"clientY")])?!=*node{return Ok(());}
  objects::toggle_lamp(ctx,node)
 },
  "build_lamp-keydown-1"=>{
  if get(&event,"key")==s("Enter")||get(&event,"key")==s(" "){ctx.st_set("suppressLampClickKey",&null());}
  if !delete_key(ctx,node,&event,false)?{objects::move_object_with_keyboard(ctx,&event,node)?;}Ok(())
 },
  "build_spine-pointerdown-1"=>{
  if !gesture_start(ctx,&press,node,&event,true)?{return Ok(());}
  ctx.st_set("pressedBookId",&super::covers::book_id(&get(&item,"book")));
  if !absent(&ctx.scene()){cls_add(node,&["is-pressed","is-press-pending"]);}else{cls_add(node,&["is-pressed"]);}
  super::covers::warm_cover(ctx,&get(&item,"book"))?;Ok(())
 },
  "build_spine-pointerup-1"=>{
  let touch=press.touch();if !truthy(&touch)||get(&touch,"pointerId")==get(&event,"pointerId"){release_book(ctx,&press,node,&item);}Ok(())
 },
  "build_spine-pointercancel-1"=>{
  if get(&press.touch(),"pointerId")==get(&event,"pointerId"){press.set_touch(null());press.set_ignore(true);}
  release_book(ctx,&press,node,&item);Ok(())
 },
  "build_spine-pointerleave-1"=>{
  press.cancel_touch();release_book(ctx,&press,node,&item);Ok(())
 },
  "build_spine-pointermove-1"=>{
  if let Some((x,y))=press.start(){if hypot(gn(&event,"clientX")-x,gn(&event,"clientY")-y)>objects::TAP_SLOP{
   press.cancel_touch();release_book(ctx,&press,node,&item);
  }}Ok(())
 },
  "build_spine-click-1"=>{
  let pointer=trash::pointer_click(&event);
  if pointer&&(press.ignore()||truthy(&press.touch())){press.set_ignore(false);press.set_touch(null());return Ok(());}
  if ctx.st_true("arranging")||ctx.st_true("suppressOpenBookId"){ctx.st_set("suppressOpenBookId",&null());return Ok(());}
  let hit=if pointer{ctx.scene_call("getBookAtPoint",&[&get(&event,"clientX"),&get(&event,"clientY")])?}else{null()};
  if pointer&&!absent(&ctx.scene())&&!truthy(&hit){return Ok(());}
  let selected=if truthy(&hit){or(map_get(&ctx.st("itemsById"),&data_get(&hit,"bookId")),item.clone())}else{item.clone()};
  open_book(ctx,&or(hit,node.clone()),&selected);Ok(())
 },
  "build_spine-keydown-1"=>{
  if delete_key(ctx,node,&event,true)?{return Ok(());}
  if !truthy(&ctx.opts_get("sections")){return objects::move_object_with_keyboard(ctx,&event,node);}
  let key=get(&event,"key");if !gb(&event,"shiftKey")||(key!=s("ArrowLeft")&&key!=s("ArrowRight")){return Ok(());}
  method(&event,"preventDefault",&[])?;
  let siblings=qsa(&closest(node,".ihr-section"),".ihr-spine");let index=siblings.iter().position(|sibling|sibling==node).map(|v|v as isize).unwrap_or(-1);
  let target=index+if key==s("ArrowLeft"){-1}else{1};
  if target>=0{if let Some(target)=siblings.get(target as usize){drag::reorder_spine(ctx,node,target,key==s("ArrowRight"))?;}}
  Ok(())
 },
  "build_spine-pointerdown-2"=>drag::start_spine_drag(ctx,&event,node),
  "build_spine-pointermove-2"=>drag::move_spine_drag(ctx,&event,&active_node(ctx,node)),
  "build_spine-pointerup-2"=>{
  let touch=press.touch();let candidate=if get(&touch,"pointerId")==get(&event,"pointerId"){touch}else{null()};
  let active=ctx.st("dragSession");let activate=drag::is_touch_tap_release(ctx,&event,&active,node,&candidate)&&(truthy(&candidate)||gb(&active,"bookTapValid"));
  drag::finish_spine_drag(ctx,&event,&or(get(&active,"node"),node.clone()),false,activate)?;
  if truthy(&candidate){press.set_touch(null());press.set_ignore(true);}
  if activate&&is_connected(node)&&!ctx.st_true("suppressOpenBookId"){trash::discard_touch_compatibility_click(ctx,&event)?;open_book(ctx,node,&item);}
  Ok(())
 },
  "build_spine-pointercancel-2"=>drag::finish_spine_drag(ctx,&event,&active_node(ctx,node),true,false),
  "build_geometry_status-click-1"=>{
   if failed{ctx.option_call("onBookGeometryRetry",&[&book])?;}
   else{let open=ctx.initial_on_open();if !nullish(&open){call(&open,"onOpenBook",&[&book])?;}}
   Ok(())
  },
  "build_empty_state-click-1"=>{call(&pick,"onPickLocal",&[])?;Ok(())},
  "build_action_bar-click-1"=>{call(&pick,"onPickLocal",&[])?;Ok(())},
  "build_action_bar-click-2"=>{call(&drive,"onDrive",&[])?;Ok(())},
  "build_library_empty-click-1"=>{call(&pick,"onPickLocal",&[])?;Ok(())},
  _=>Ok(())
 }
}
