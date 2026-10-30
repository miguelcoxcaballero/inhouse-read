//! renderBookshelf's set-up (formerly the body of bookshelf.js): the merged options, the shared state, the
//! frame, the view-swipe and pinch-zoom controllers, the plant catalogue, the parts every piece of the screen
//! shares, the page listeners and the first render, in the original order; also the lookup table of the other
//! modules' functions (shelf_env_table) and the public handle (shelf_handle). Every function handed to the host comes from the context's dispatcher, so it costs no handle here
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

// ---- The shelf's lookup table and its public handle (formerly src/js/bookshelf.js) ----

/// The functions and values of the other modules the shelf's parts call: `(name, module, export)`. `module` is a
/// key of the namespaces bookshelf.js hands over, or `own` for the host's own entries. In the original order.
const ENV:&[(&str,&str,&str)]=&[
 ("physicalPlacement","own","physicalPlacement"),("playShelfSound","cozySounds","playShelfSound"),
 ("withDefaults","layout","withDefaults"),("createBookReturnCache","bookshelfReturn","createBookReturnCache"),
 ("attachShelfSounds","cozySounds","attachShelfSounds"),("createShelfViewGesture","viewGesture","createShelfViewGesture"),
 ("createShelfZoom","shelfZoom","createShelfZoom"),("createLazyPlantCatalog","plantCatalogLazy","createLazyPlantCatalog"),
 ("refreshCanvasFontsAfterPaint","canvasFonts","refreshCanvasFontsAfterPaint"),("displayBookTitle","bookTitle","displayBookTitle"),
 ("getBookRenderer","bookModel","getBookRenderer"),("canAdoptShelfMetadata","metadataRecords","canAdoptShelfMetadata"),
 ("planBookshelf","layout","planBookshelf"),("batchSpineStyles","spineStyles","batchSpineStyles"),
 ("bookSpineOptions","plantDimensions","bookSpineOptions"),("minimumBookCellWidth","plantDimensions","minimumBookCellWidth"),
 ("createBookshelfScene","scene","createBookshelfScene"),("DEFAULT_LAYOUT","layout","DEFAULT_LAYOUT"),
 ("normalizeBookAuthor","bookTitle","normalizeBookAuthor"),("bookColorOptions","bookColors","bookColorOptions"),
 ("spineColorStyle","bookColors","spineColorStyle"),("spineFinish","bookColors","spineFinish"),("surfaceFinish","bookColors","surfaceFinish"),
 ("withCoverAppearance","coverAppearance","withCoverAppearance"),("fitCoverImage","bookModel","fitCoverImage"),
 ("bookView","bookModel","bookView"),("bookmarkFor","layout","bookmarkFor"),("readCoverAspectRatio","coverAppearance","readCoverAspectRatio"),
 ("planReadingBookPose","bookModel","planReadingBookPose"),("markTiming","perfMarks","markTiming"),("resetTimeline","perfMarks","resetTimeline"),
 ("readerBookTiming","bookTiming","readerBookTiming"),("persistablePosition","persistable","persistablePosition"),
 ("bookReturnSignature","bookshelfReturn","bookReturnSignature"),("bookReturnCompatibility","bookshelfReturn","bookReturnCompatibility"),
 ("readerReturnCanvas","returnCanvas","readerReturnCanvas"),("coverAspectRatio","coverAppearance","coverAspectRatio"),
 ("analyzeCoverAppearance","own","analyzeCoverAppearance"),("warmShelfCover","own","warmShelfCover"),("prepareShelfFonts","own","prepareShelfFonts"),
 ("notifyCloudSettingsChanged","cloudSettings","notifyCloudSettingsChanged"),("getCatalogLamp","lampCatalogData","getCatalogLamp"),
 ("lampCatalogIllustration","lampIllustration","lampCatalogIllustration"),("normalizeShelfLamp","lampCatalogData","normalizeShelfLamp"),
 ("getCatalogPlant","plantCatalogData","getCatalogPlant"),("resolveCatalogPlant","plantRecords","resolveCatalogPlant"),
 ("normalizeShelfType","shelfTypes","normalizeShelfType"),("placeRooftopPlants","rooftop","placeRooftopPlants"),
 ("shelfModelLayout","modelLayout","measuredShelfModelLayout"),("getCatalogPot","plantCatalogData","getCatalogPot"),
 ("getPotColor","plantCatalogData","getPotColor"),("normalizeShelfPlant","plantRecords","normalizeShelfPlant"),
 ("shelfScale","plantDimensions","shelfScale"),("plantDimensions","plantDimensions","plantDimensions"),
 ("layoutShelfDecorations","decorationLayout","layoutShelfDecorations"),("moveShelfDecoration","decorationLayout","moveShelfDecoration"),
 ("getRustCore","rustCore","getRustCore"),("createShelfPlacementSession","placementWasm","createShelfPlacementSession"),
 ("SHELF_PREVIEW_MIN_OBJECTS","placementPreview","SHELF_PREVIEW_MIN_OBJECTS"),("SHELF_PREVIEW_DIRECT_MOVES","placementPreview","SHELF_PREVIEW_DIRECT_MOVES"),
 ("BAGGEBO_SPEC","shelfTypes","BAGGEBO_SPEC"),("needsDriveDownload","storagePolicy","needsDriveDownload"),
 ("coverReliefLayers","coverRelief","coverReliefLayers"),("normalizeCoverRelief","coverRelief","normalizeCoverRelief"),
 ("analyzeCoverRelief","coverRelief","analyzeCoverRelief"),("METAL_COLORS","bookColors","METAL_COLORS"),("COLOR_RELIEF_IDS","coverRelief","COLOR_RELIEF_IDS"),
];

/// The shelf's lookup table as `name:module:export` entries separated by spaces, in the original order.
/// bookshelf.js builds the accessors from it (each a `Reflect.get` bound to the namespace and export): built from
/// here, its 67 property definitions cost about 0.4 ms before the first shelf frame.
#[wasm_bindgen]
pub fn shelf_env_table()->String{
 ENV.iter().map(|(name,module,export)|format!("{name}:{module}:{export}")).collect::<Vec<_>>().join(" ")
}

/// The public handle of `renderBookshelf`: `{element, isInteracting, applyRoomPose, prepareCloudRoom, applyLiveRoomMotion,
/// clearLiveRoomMotion, refresh, queueRefresh, update, returnToShelf, updateCloudRecord, setPresentationActive,
/// setReturningBook, hasReaderOrigin, prepareOpeningPage, close, destroy}` over the mounted context `ctx` (a
/// `RustShelfCtx`). Its functions are this module's exports (`exports`) bound to one plain record, so the handle
/// holds no closure; once destroyed it has handed its context back and answers as the original's `shelfCtxLive`
/// guards did.
#[wasm_bindgen]
pub fn shelf_handle(ctx:JsValue,exports:JsValue)->R<JsValue>{
 let mounted=method(&ctx,"mounted",&[])?;
 let record=obj(&[("ctx",&ctx),("live",&JsValue::TRUE),("state",&read(&mounted,"state")?),("parts",&read(&mounted,"parts")?),
  ("lifecycle",&read(&mounted,"lifecycle")?),("exports",&exports)]);
 let bound=|name:&str|->R<JsValue>{method(&read(&exports,name)?,"bind",&[&JsValue::UNDEFINED,&record])};
 let handle:JsValue=js_sys::Object::new().into();
 put(&handle,"element",&read(&mounted,"root")?);
 let interacting=obj(&[("get",&bound("shelf_handle_interacting")?),("enumerable",&JsValue::TRUE),("configurable",&JsValue::TRUE)]);
 js_sys::Reflect::define_property(handle.unchecked_ref(),&"isInteracting".into(),interacting.unchecked_ref())?;
 let refresh=bound("shelf_handle_refresh")?;
 for (key,export) in [("applyRoomPose","shelf_handle_room_pose"),("prepareCloudRoom","shelf_handle_cloud_room"),
  ("applyLiveRoomMotion","shelf_handle_live_motion"),("clearLiveRoomMotion","shelf_handle_clear_motion")]{put(&handle,key,&bound(export)?);}
 put(&handle,"refresh",&refresh);
 put(&handle,"queueRefresh",&bound("shelf_handle_queue_refresh")?);
 put(&handle,"update",&refresh);
 for (key,export) in [("returnToShelf","shelf_handle_return"),("updateCloudRecord","shelf_handle_cloud_record"),
  ("setPresentationActive","shelf_handle_presentation"),("setReturningBook","shelf_handle_returning_book"),
  ("hasReaderOrigin","shelf_handle_reader_origin"),("prepareOpeningPage","shelf_handle_opening_page"),
  ("close","shelf_handle_close"),("destroy","shelf_handle_destroy")]{put(&handle,key,&bound(export)?);}
 Ok(handle)
}
fn live(record:&JsValue)->bool{truthy(&get(record,"live"))}
fn handle_state(record:&JsValue)->JsValue{get(record,"state")}
fn handle_ctx(record:&JsValue)->JsValue{get(record,"ctx")}

#[wasm_bindgen]
pub fn shelf_handle_interacting(record:&JsValue)->R<bool>{Ok(live(record)&&super::screen_lifecycle::shelf_has_interaction(handle_state(record))?)}
#[wasm_bindgen]
pub fn shelf_handle_room_pose(record:&JsValue)->R<bool>{Ok(live(record)&&super::screen_lifecycle::shelf_apply_room_pose(handle_state(record))?)}
#[wasm_bindgen]
pub fn shelf_handle_cloud_room(record:&JsValue)->R<()>{if live(record){method(&handle_ctx(record),"prepareCloudRoom",&[])?;}Ok(())}
#[wasm_bindgen]
pub fn shelf_handle_live_motion(record:&JsValue,packet:JsValue)->R<bool>{
 Ok(live(record)&&super::screen_lifecycle::shelf_apply_live_room_motion(handle_state(record),packet)?)
}
/// `shelfCtxLive && shelf_clear_live_room_motion(state, source)`: false once destroyed, otherwise undefined.
#[wasm_bindgen]
pub fn shelf_handle_clear_motion(record:&JsValue,source:JsValue)->R<JsValue>{
 if !live(record){return Ok(JsValue::FALSE);}
 super::screen_lifecycle::shelf_clear_live_room_motion(handle_state(record),source)?;Ok(undef())
}
/// `refresh(nextBooks, { defer = false } = {})`.
#[wasm_bindgen]
pub fn shelf_handle_refresh(record:&JsValue,books:JsValue,options:JsValue)->R<()>{
 let defer=if options.is_undefined(){JsValue::FALSE}else{let value=read(&options,"defer")?;if value.is_undefined(){JsValue::FALSE}else{value}};
 if live(record){method(&handle_ctx(record),"refresh",&[&books,&defer])?;}
 Ok(())
}
/// Storage may notify for several records in one turn. Keep only the last complete list and commit one
/// semantic/GPU layout on the next frame.
#[wasm_bindgen]
pub fn shelf_handle_queue_refresh(record:&JsValue,books:JsValue)->R<()>{
 if live(record){method(&handle_ctx(record),"refresh",&[&books,&JsValue::TRUE])?;}
 Ok(())
}
#[wasm_bindgen]
pub fn shelf_handle_return(record:&JsValue,book_id:JsValue,options:JsValue)->R<JsValue>{
 if live(record){method(&handle_ctx(record),"returnToShelf",&[&book_id,&options])}else{Ok(js_sys::Promise::resolve(&JsValue::FALSE).into())}
}
#[wasm_bindgen]
pub fn shelf_handle_cloud_record(record:&JsValue,cloud:JsValue)->R<()>{super::screen_lifecycle::shelf_update_cloud_record(handle_state(record),cloud)}
#[wasm_bindgen]
pub fn shelf_handle_presentation(record:&JsValue,value:JsValue)->R<()>{super::screen_lifecycle::shelf_set_presentation_active(handle_state(record),value)}
/// A destroyed shelf has handed its context back; whatever a late callback asks of it is then moot.
#[wasm_bindgen]
pub fn shelf_handle_returning_book(record:&JsValue,book_id:JsValue)->R<()>{
 if live(record){method(&handle_ctx(record),"setReturningBook",&[&book_id])?;}
 Ok(())
}
#[wasm_bindgen]
pub fn shelf_handle_reader_origin(record:&JsValue,book_id:JsValue)->R<bool>{super::screen_lifecycle::shelf_has_reader_origin(handle_state(record),book_id)}
/// The default wait between preparation steps: one task.
#[wasm_bindgen]
pub fn shelf_handle_next_task()->js_sys::Promise{
 js_sys::Promise::new(&mut |resolve,_|{let _=crate::host::set_timeout(&resolve,0.0);})
}
/// Hands the page a lifted book will open on to its 3D model ahead of the tap.
#[wasm_bindgen]
pub fn shelf_handle_opening_page(record:&JsValue,book_id:JsValue,snapshot:JsValue,idle:JsValue)->R<JsValue>{
 let idle=if idle.is_undefined(){read(&get(record,"exports"),"shelf_handle_next_task")?}else{idle};
 super::screen_lifecycle::shelf_prepare_opening_page(handle_state(record),book_id,snapshot,idle)
}
/// Folds the open cover back, if there is one.
#[wasm_bindgen]
pub fn shelf_handle_close(record:&JsValue)->R<JsValue>{
 if live(record){method(&handle_ctx(record),"finishReturnSlot",&[&JsValue::FALSE])?;}
 super::screen_lifecycle::shelf_public_close(handle_state(record))
}
#[wasm_bindgen]
pub fn shelf_handle_destroy(record:&JsValue)->R<()>{
 let parts=get(record,"parts");
 method(&get(&global(),"window"),"removeEventListener",&[&"blur".into(),&read(&parts,"onInputInterrupted")?])?;
 method(&get(&global(),"document"),"removeEventListener",&[&"visibilitychange".into(),&read(&parts,"onInputVisibility")?])?;
 let callback=if live(record){read(&get(record,"lifecycle"),"destroy")?}else{JsValue::NULL};
 super::screen_lifecycle::shelf_destroy_dispatch(parts,callback)?;
 if live(record){put(record,"live",&JsValue::FALSE);method(&handle_ctx(record),"free",&[])?;}
 Ok(())
}
