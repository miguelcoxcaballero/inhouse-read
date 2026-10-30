//! renderBookshelf's set-up (formerly the body of bookshelf.js): the merged options, the shared state, the
//! frame, the view-swipe and pinch-zoom controllers, the plant catalogue, the parts every piece of the screen
//! shares, the page listeners and the first render, in the original order. bookshelf.js keeps the public
//! handle. Every function handed to the host comes from the context's dispatcher, so it costs no handle here
//! and, once the shelf is destroyed, answers as the original's `shelfCtxLive` guards did.
use std::rc::{Rc,Weak};
use wasm_bindgen::{prelude::*,JsCast};
use super::{util::*,ctx::{Ctx,RustShelfCtx},frame::shelf_frame};

/// The context while the shelf lives (the original `if (shelfCtxLive)`).
fn alive(weak:&Weak<Ctx>)->Option<RustShelfCtx>{weak.upgrade().map(|ctx|RustShelfCtx{ctx})}
/// `shelfLifecycle[name](...args)`.
fn lifecycle(ctx:&Ctx,name:&str,args:&[&JsValue])->R<JsValue>{method(&get(&ctx.parts,"lifecycle"),name,args)}
fn lifecycle_callback(ctx:&Rc<Ctx>,name:&'static str)->JsValue{
 let weak=Rc::downgrade(ctx);
 ctx.input_callbacks.make(Stale::Undefined,move|argument,_|match weak.upgrade(){Some(ctx)=>{lifecycle(&ctx,name,&[&argument])?;Ok(undef())},None=>Ok(undef())})
}

/// Builds and draws the shelf of `renderBookshelf(container, booksOrOptions, maybeOptions)`: the context the
/// returned handle keeps (its `mounted()` hands back the state, the parts and the lifecycle callbacks).
#[wasm_bindgen]
pub fn shelf_mount(env:JsValue,container:JsValue,books_or_options:JsValue,maybe_options:JsValue,default_texts:JsValue)->R<RustShelfCtx>{
 let args=super::screen_prefs::shelf_normalize_args(books_or_options,maybe_options);
 let defaults=defaults(&default_texts);
 let (books,options)=(read(&args,"books")?,read(&args,"options")?);
 let opts=call(&read(&env,"withDefaults")?,"withDefaults",&[&defaults,&options])?;
 put(&opts,"texts",&call(&read(&env,"withDefaults")?,"withDefaults",&[&default_texts,&read(&options,"texts")?])?);
 // Nombres del handoff y nombres genéricos: valen los dos.
 let on_open=or_else(read(&options,"onOpenBook")?,||read(&options,"onBookOpen"))?;
 let on_pick_local=or_else(read(&options,"onPickLocalFile")?,||read(&options,"onAddBooks"))?;
 let on_drive=read(&options,"onOpenDrive")?;
 let state=super::screen_lifecycle::shelf_screen_state(env.clone(),books,options.clone())?;
 let return_views=call(&read(&env,"createBookReturnCache")?,"createBookReturnCache",&[])?;
 super::screen_prefs::shelf_forget_boot_poster();
 let has_book_trash=read(&options,"onBookRemove")?.is_function();
 let has_trash=!truthy(&read(&opts,"sections")?)||has_book_trash;
 let frame=shelf_frame(has_trash,!truthy(&read(&opts,"sections")?),read(&state,"viewMode")?==s("isometric"))?;
 let [root,scroller,trash_node,trash_status,trash_announce,catalog_node]=["root","scroller","trashNode","trashStatus","trashAnnounce","catalogNode"].map(|key|get(&frame,key));
 let sounds=obj(&[("destroy",&call(&read(&env,"attachShelfSounds")?,"attachShelfSounds",&[&root])?)]);
 let legacy=obj(&[("returnViews",&return_views)]);
 let parts=obj(&[("state",&state),("opts",&opts),("options",&options),("env",&env),("root",&root),("scroller",&scroller),("container",&container),
  ("onOpen",&on_open),("onPickLocal",&on_pick_local),("onDrive",&on_drive),("soundBindings",&sounds),("legacy",&legacy)]);
 let ctx=Rc::new(Ctx::new(parts.clone())?);
 let weak=Rc::downgrade(&ctx);
 put(&legacy,"syncShelfZoom",&ctx.input_callbacks.make(Stale::Undefined,{let weak=weak.clone();move|_,_|match weak.upgrade(){
  Some(ctx)=>method(&get(&ctx.parts,"shelfZoom"),"sync",&[]),None=>Ok(undef())}}));
 // The view swipe and the pinch zoom.
 let reader=|key:&'static str|{let weak=weak.clone();ctx.input_callbacks.make(Stale::Undefined,move|_,_|Ok(match weak.upgrade(){Some(ctx)=>ctx.st(key),None=>undef()}))};
 let view_enabled=ctx.input_callbacks.make(Stale::Undefined,{let weak=weak.clone();move|_,_|match weak.upgrade(){
  Some(ctx)=>Ok(b(super::screen_lifecycle::shelf_can_change_view(ctx.state.clone())?)),None=>Ok(undef())}});
 let view_gesture=call(&read(&env,"createShelfViewGesture")?,"createShelfViewGesture",&[&obj(&[("root",&root),("scroller",&scroller),
  ("getMode",&reader("viewMode")),("setMode",&lifecycle_callback(&ctx,"setViewMode")),("isEnabled",&view_enabled),
  ("onGestureStart",&lifecycle_callback(&ctx,"beginViewGesture"))])])?;
 let zoom_enabled=ctx.input_callbacks.make(Stale::Undefined,{let weak=weak.clone();move|_,_|match weak.upgrade(){
  Some(ctx)=>Ok(b(super::screen_lifecycle::shelf_can_zoom(ctx.state.clone()))),None=>Ok(undef())}});
 let zoom_start=ctx.input_callbacks.make(Stale::Undefined,{let weak=weak.clone();move|_,_|match weak.upgrade(){
  Some(ctx)=>{lifecycle(&ctx,"beginZoomGesture",&[])?;Ok(undef())},None=>Ok(undef())}});
 let zoom_sound=ctx.input_callbacks.make(Stale::Undefined,{let env=env.clone();move|kind,strength|{
  call(&read(&env,"playShelfSound")?,"playShelfSound",&[&kind,&f(0.0),&strength,&f(0.0)])}});
 let zoom=call(&read(&env,"createShelfZoom")?,"createShelfZoom",&[&obj(&[("root",&root),("scroller",&scroller),("getScene",&reader("shelfScene")),
  ("isEnabled",&zoom_enabled),("onGestureStart",&zoom_start),("onSound",&zoom_sound)])])?;
 if truthy(&trash_status){method(&root,"append",&[&trash_status,&trash_announce])?;}
 // The plant catalogue. It may answer after the shelf is gone: the original refused then, as busy.
 let adder=|name:&'static str|{let weak=weak.clone();ctx.input_callbacks.make(Stale::Busy,move|request,options|match alive(&weak){
  Some(shelf)=>Ok(if name=="lamp"{shelf.add_catalog_lamp(request,options)}else{shelf.add_catalog_plant(request,options)}),None=>Ok(undef())})};
 let shelf_change=ctx.input_callbacks.make(Stale::Undefined,{let weak=weak.clone();move|change,choice|{
  let Some(ctx)=weak.upgrade()else{return Ok(undef())};
  let shelf_type=read(&change,"shelfType")?;
  let choice=if choice.is_undefined(){obj(&[])}else{choice};
  let when_closed=read(&choice,"whenClosed")?;
  lifecycle(&ctx,"setCatalogShelfType",&[&shelf_type])?;
  let rerender=ctx.input_callbacks.make(Stale::Undefined,{let weak=Rc::downgrade(&ctx);move|_,_|{
   if let Some(shelf)=alive(&weak){if !shelf.ctx.st_true("destroyed"){shelf.render()?;}}Ok(undef())}});
  if when_closed.is_undefined(){call(&rerender,"run",&[])?;}else{call(&when_closed,"whenClosed",&[&rerender])?;}
  Ok(undef())
 }});
 let motion_target=ctx.input_callbacks.make(Stale::Undefined,{let root=root.clone();move|_,_|{
  let screen=method(&root,"closest",&[&s(".screen")])?;Ok(if truthy(&screen){screen}else{root.clone()})}});
 let catalog=call(&read(&env,"createLazyPlantCatalog")?,"createLazyPlantCatalog",&[&obj(&[("onAdd",&adder("plant")),("onAddLamp",&adder("lamp")),
  ("shelfType",&read(&state,"shelfType")?),("onShelfChange",&shelf_change),("motionTarget",&motion_target),
  ("onMotion",&lifecycle_callback(&ctx,"setCatalogMotion"))])])?;
 if !absent(&catalog_node){method(&catalog_node,"addEventListener",&[&s("click"),&lifecycle_callback(&ctx,"openCatalog")])?;}
 // La app monta hoy "añadir libro" y "Drive" en su propio header, así que la barra de acciones de la
 // estantería está apagada por defecto para no duplicar controles. Se enciende con `showActions: true` (o
 // sola, si se pasa `onOpenDrive`, que es la integración del handoff original).
 let requested=read(&options,"showActions")?;
 let show_actions=if absent(&requested){truthy(&on_drive)}else{truthy(&requested)}&&(truthy(&on_pick_local)||truthy(&on_drive));
 // One URL per saved cover: IndexedDB returns fresh record/Blob objects after every progress write, and the
 // decoded pixels must survive refreshes.
 for (key,value) in [("coverCache",construct("WeakMap",&[])?),("savedCoverUrls",construct("Map",&[])?),("trashNode",trash_node),("trashStatus",trash_status),
  ("trashAnnounce",trash_announce),("hasTrash",b(has_trash)),("hasBookTrash",b(has_book_trash)),("catalogNode",catalog_node),("plantCatalog",catalog),
  ("shelfViewGesture",view_gesture.clone()),("shelfZoom",zoom.clone()),("observer",JsValue::NULL)]{put(&parts,key,&value);}
 let shelf=RustShelfCtx{ctx:ctx.clone()};
 put(&parts,"lifecycle",&shelf.lifecycle_callbacks());
 if show_actions{
  append(&root,&shelf.build_action_bar()?);
  cls_toggle(&root,"ihr-bookshelf--with-actions",true);
 }
 append(&container,&root);
 // Opened straight in the diagonal view: leave the startup work first.
 lifecycle(&ctx,"prepareCatalogWhenIdle",&[&f(6000.0)])?;
 // The page's listeners: an interrupted input (blur, hidden page), the viewport and the scroller's size.
 let interrupted=ctx.input_callbacks.make(Stale::Undefined,{let weak=weak.clone();move|_,_|{
  let Some(ctx)=weak.upgrade()else{return Ok(undef())};
  method(&get(&ctx.parts,"shelfViewGesture"),"cancel",&[])?;method(&get(&ctx.parts,"shelfZoom"),"cancel",&[])?;
  lifecycle(&ctx,"cancelInput",&[])?;Ok(undef())
 }});
 let visibility=ctx.input_callbacks.make(Stale::Undefined,{let interrupted=interrupted.clone();move|_,_|{
  if truthy(&get(&document(),"hidden")){call(&interrupted,"onInputInterrupted",&[])?;}Ok(undef())}});
 let resize=lifecycle_callback(&ctx,"viewportResize");
 let visual=lifecycle_callback(&ctx,"visualViewportChange");
 for (key,value) in [("onInputInterrupted",&interrupted),("onInputVisibility",&visibility),("onViewportResize",&resize),("onVisualViewportChange",&visual)]{put(&parts,key,value);}
 method(&window(),"addEventListener",&[&s("blur"),&interrupted])?;
 method(&document(),"addEventListener",&[&s("visibilitychange"),&visibility])?;
 method(&window(),"addEventListener",&[&s("resize"),&resize])?;
 let viewport=get(&window(),"visualViewport");
 method_opt(&viewport,"addEventListener",&[&s("resize"),&visual])?;
 method_opt(&viewport,"addEventListener",&[&s("scroll"),&visual])?;
 if get(&global(),"ResizeObserver").is_function(){
  let observer=construct("ResizeObserver",&[&lifecycle_callback(&ctx,"observedResize")])?;
  method(&observer,"observe",&[&scroller])?;
  put(&parts,"observer",&observer);
 }
 shelf.prepare_initial_appearances()?;
 shelf.render()?;
 // The shared scene refreshes its own text textures when fonts arrive. Keep its semantic buttons: rebuilding
 // them here can detach a visible spine between pointerdown/measurement and the following event.
 call(&read(&env,"refreshCanvasFontsAfterPaint")?,"refreshCanvasFontsAfterPaint",&[&lifecycle_callback(&ctx,"refreshFonts")])?;
 Ok(shelf)
}

/// The screen's defaults, under the options the app passes.
fn defaults(texts:&JsValue)->JsValue{
 let defaults=obj(&[
  ("autoOpen",&b(true)),        // tras revelar la portada, avisar a la app
  ("holdMs",&f(320.0)),         // pausa para que la portada se vea antes de abrir
  ("revealDuration",&f(680.0)),
  ("returnDuration",&f(460.0)),
  ("sections",&b(false)),       // la biblioteca es una estantería continua
  ("sort",&s("none")),          // conserva el orden guardado y permite organizarlo a mano
  ("minimumShelves",&f(3.0)),
  ("shelfPadding",&f(16.0)),
  ("gap",&f(0.0)),
  ("plantEvery",&f(5.0)),
  ("coverRatio",&f(0.66)),      // ancho/alto de portada: proporción de libro comercial
  ("texts",texts),
 ]);
 js_sys::Object::freeze(defaults.unchecked_ref());defaults
}

fn or_else(value:JsValue,other:impl FnOnce()->R<JsValue>)->R<JsValue>{if truthy(&value){Ok(value)}else{other()}}

#[wasm_bindgen]
impl RustShelfCtx{
 /// What the public handle of bookshelf.js keeps: `{ state, parts, root, lifecycle }`.
 pub fn mounted(&self)->JsValue{
  let parts=&self.ctx.parts;
  obj(&[("state",&self.ctx.state),("parts",parts),("root",&self.ctx.root),("lifecycle",&get(parts,"lifecycle"))])
 }
}
