//! One book view (src/js/book-model.js `bookView`): a lifted or shelf book on its own export canvas,
//! presented straight from the flyout's renderer where it can be. This module builds the view and owns
//! everything that is not a frame: the renderer choice and canvas, the model's replacement when its
//! appearance changes, the parked return's in-place upgrade, the page snapshot, the shelf insertion
//! handoff, the animations it starts and disposal. The view's variables live in one plain state object
//! `v`, shared with the host's per-frame functions (`env.draw`, the framebuffer window and the snapshot
//! copies), so a frame reads them without crossing into WebAssembly. Nothing here holds a handle once a
//! call returns: the view's methods are this module's functions or the host's bound to `v`, and its
//! asynchronous steps continue through promises the same way.
use wasm_bindgen::{prelude::*,JsCast};
use js_sys::{Array,Function,JsString,Object,Promise,Reflect};
use crate::host::{absent,jmax,jmin,num,truthy};

type R<T>=Result<T,JsValue>;
fn k(name:&'static str)->&'static str{wasm_bindgen::intern(name)}
fn get(v:&JsValue,name:&'static str)->JsValue{crate::host::get(v,k(name))}
fn read(v:&JsValue,name:&'static str)->R<JsValue>{crate::host::read(v,k(name))}
fn put(v:&JsValue,name:&'static str,x:&JsValue)->R<()>{crate::host::set(v,k(name),x)}
fn call(v:&JsValue,name:&'static str,args:&[&JsValue])->R<JsValue>{crate::host::method(v,k(name),args)}
fn word(t:&'static str)->JsValue{JsValue::from_str(k(t))}
fn n(x:f64)->JsValue{JsValue::from_f64(x)}
fn b(x:bool)->JsValue{JsValue::from_bool(x)}
fn object(fields:&[(&'static str,JsValue)])->R<JsValue>{let o:JsValue=Object::new().into();for(key,value)in fields{put(&o,key,value)?;}Ok(o)}
/// A destructured option: its default only when it is `undefined`.
fn or_default(value:JsValue,fallback:JsValue)->JsValue{if value.is_undefined(){fallback}else{value}}
/// `function(...args)` with `this`.
fn invoke(function:&JsValue,this:&JsValue,args:&[&JsValue])->R<JsValue>{
 let list=Array::new();for a in args{list.push(a);}
 Reflect::apply(function.dyn_ref::<Function>().ok_or_else(||JsValue::from(js_sys::TypeError::new("not a function")))?,this,&list)
}
/// `target.userData.name?.(...args)`: the user data must exist, the method may not.
fn user_opt(target:&JsValue,name:&'static str,args:&[&JsValue])->R<JsValue>{
 let user=read(target,"userData")?;let function=read(&user,name)?;
 if absent(&function){Ok(JsValue::UNDEFINED)}else{invoke(&function,&user,args)}
}
fn user(target:&JsValue)->R<JsValue>{read(target,"userData")}
/// `f.bind(null, ...args)`.
fn bind(function:&JsValue,args:&[&JsValue])->R<JsValue>{
 let list=Array::new();list.push(&JsValue::NULL);for a in args{list.push(a);}
 Reflect::apply(read(function,"bind")?.unchecked_ref(),function,&list)
}
fn state(v:&JsValue,name:&'static str)->JsValue{get(v,name)}
fn env(v:&JsValue)->JsValue{state(v,"env")}
/// This module's export `name` bound to the view (and `extra`).
fn own(v:&JsValue,name:&'static str,extra:&[&JsValue])->R<JsValue>{
 let mut all=vec![v];all.extend_from_slice(extra);bind(&read(&read(&env(v),"rust")?,name)?,&all)
}
/// The host's function `name` bound to the view.
fn hosted(v:&JsValue,name:&'static str)->R<JsValue>{bind(&read(&env(v),name)?,&[v])}
fn disposed(v:&JsValue)->bool{truthy(&state(v,"disposed"))}
/// `{ ...a, ...b, ...c }`, by the engine.
fn spread(v:&JsValue,a:&JsValue,b:&JsValue,c:&JsValue)->R<JsValue>{call(&env(v),"spread",&[a,b,c])}
fn copy(v:&JsValue,a:&JsValue)->R<JsValue>{spread(v,a,&JsValue::UNDEFINED,&JsValue::UNDEFINED)}
fn bump(v:&JsValue,name:&'static str)->R<f64>{let next=num(&state(v,name))+1.0;put(v,name,&n(next))?;Ok(next)}
fn slot(v:&JsValue)->R<JsValue>{read(&env(v),"presentation")}
fn owns_presentation(v:&JsValue)->R<bool>{Ok(read(&slot(v)?,"owner")?==state(v,"owner"))}
fn dataset(v:&JsValue)->R<JsValue>{read(&state(v,"canvas"),"dataset")}
fn opacity(v:&JsValue,value:&'static str)->R<()>{put(&read(&state(v,"canvas"),"style")?,"opacity",&word(value))}
fn bookmark_flag(v:&JsValue)->R<()>{
 let has=truthy(&read(&user(&state(v,"model"))?,"hasBookmark")?);
 put(&dataset(v)?,"bookmark3d",&word(if has{"true"}else{"false"}))
}

// ---- the host's frame functions ------------------------------------------------------------------------
fn draw(v:&JsValue,pose:&JsValue,options:Option<&JsValue>)->R<JsValue>{
 match options{Some(options)=>call(&env(v),"draw",&[v,pose,options]),None=>call(&env(v),"draw",&[v,pose])}
}
fn capture(v:&JsValue)->R<()>{call(&env(v),"capture",&[v])?;Ok(())}
/// An appearance completion repaints the current pose, keeping the first explicit framebuffer commit.
fn draw_updated(v:&JsValue)->R<()>{
 let current=state(v,"current");
 if truthy(&current){draw(v,&current,Some(&object(&[("redraw",b(!truthy(&state(v,"waitingForFirstDraw"))))])?))?;}
 Ok(())
}
/// The model's own invalidation: `current && !waitingForFirstDraw && draw(current)`.
#[wasm_bindgen]
pub fn book_view_redraw(v:&JsValue)->R<JsValue>{
 let current=state(v,"current");
 if !truthy(&current){return Ok(current);}
 if truthy(&state(v,"waitingForFirstDraw")){return Ok(JsValue::FALSE);}
 draw(v,&current,None)
}
/// A lost or restored context leaves no presented frame to reuse.
#[wasm_bindgen]
pub fn book_view_invalidate_presentation(v:&JsValue)->R<()>{put(v,"displayedRevision",&n(-1.0))}
/// The key of what the cover paints: a jacket by its URL, a generated case by its lettering too.
fn paint_key(v:&JsValue,book:&JsValue,style:&JsValue)->R<JsValue>{
 let url=state(v,"coverUrl");
 let list=Array::new();list.push(&url);
 for(of,key)in[(book,"id"),(book,"title"),(style,"color"),(style,"coverRatio")]{list.push(&read(of,key)?);}
 if truthy(&url){list.push(&JsValue::FALSE);}else{
  let lettering=Array::new();
  for(of,key)in[(book,"author"),(style,"ink"),(style,"fontCanvasFamily"),(style,"fontFamily"),(style,"fontFallback"),(style,"fontWeight")]{lettering.push(&read(of,key)?);}
  list.push(&lettering);
 }
 Ok(js_sys::JSON::stringify(&list)?.into())
}
fn motion_options(v:&JsValue)->R<JsValue>{
 object(&[("direct",state(v,"directEnabled")),("compact",state(v,"compactReturnFrame")),("adaptive",state(v,"adaptiveNativeFrame")),
  ("ratio",state(v,"pixelRatio")),("width",state(v,"viewportWidth")),("height",state(v,"viewportHeight"))])
}

// ---- construction --------------------------------------------------------------------------------------
/// `bookView(host, book, style, { width, height, thickness, viewportWidth, viewportHeight, centerX, centerY, coverUrl,
/// shelf = false, shelfView = 'spine', initialPose, deferDraw = false, compactReturnFrame = false,
/// directPresentation = true, adaptiveNativeFrame = false })`: null without WebGL.
#[wasm_bindgen]
pub fn book_view_create(environment:&JsValue,node:&JsValue,book:&JsValue,style:&JsValue,options:&JsValue)->R<JsValue>{
 if absent(options){
  let what=if options.is_null(){"null"}else{"undefined"};
  return Err(js_sys::TypeError::new(&format!("Cannot destructure property 'width' of '{what}' as it is {what}.")).into());
 }
 let field=|key:&'static str|crate::host::read(options,k(key));
 let (width,height,thickness)=(field("width")?,field("height")?,field("thickness")?);
 let (viewport_width,viewport_height)=(field("viewportWidth")?,field("viewportHeight")?);
 let (center_x,center_y,cover_url)=(field("centerX")?,field("centerY")?,field("coverUrl")?);
 let shelf=or_default(field("shelf")?,JsValue::FALSE);
 let shelf_view=or_default(field("shelfView")?,word("spine"));
 let initial_pose=field("initialPose")?;
 let defer=or_default(field("deferDraw")?,JsValue::FALSE);
 let compact=or_default(field("compactReturnFrame")?,JsValue::FALSE);
 let direct=or_default(field("directPresentation")?,JsValue::TRUE);
 let adaptive=or_default(field("adaptiveNativeFrame")?,JsValue::FALSE);
 let shared=call(environment,"renderer",&[])?;
 if !truthy(&shared){return Ok(JsValue::NULL);}
 let direct_capable=truthy(&direct)&&!truthy(&shelf)&&get(&shared,"getContext").is_function();
 let gpu=if direct_capable{let presenter=call(environment,"presentationRenderer",&[])?;if truthy(&presenter){presenter}else{shared.clone()}}else{shared.clone()};
 let direct_enabled=direct_capable&&gpu!=shared;
 // Shelf books are static snapshots. Keep their framebuffer modest on phones
 // so a long library does not retain a pile of high-DPI canvases in memory.
 let global=crate::host::global();
 let sizes=call(environment,"plan",&[&object(&[("shelf",shelf.clone()),("devicePixelRatio",get(&global,"devicePixelRatio")),
  ("innerWidth",read(&read(&global,"window")?,"innerWidth")?),("viewportWidth",viewport_width.clone()),("viewportHeight",viewport_height.clone()),
  ("width",width.clone()),("height",height.clone()),("thickness",thickness.clone())])?])?;
 let pixel_ratio=read(&sizes,"pixelRatio")?;
 let canvas=call(&read(&global,"document")?,"createElement",&[&word("canvas")])?;
 put(&canvas,"className",&word("ihr-book-canvas"))?;call(&canvas,"setAttribute",&[&word("aria-hidden"),&word("true")])?;
 put(&canvas,"width",&read(&sizes,"canvasWidth")?)?;put(&canvas,"height",&read(&sizes,"canvasHeight")?)?;
 call(node,"append",&[&canvas])?;let context=call(&canvas,"getContext",&[&word("2d")])?;
 let three=read(environment,"three")?;
 let scene=call(environment,"light",&[&Reflect::construct(read(&three,"Scene")?.unchecked_ref(),&Array::new())?,&gpu])?;
 let model=call(environment,"model",&[book,style,&width,&height,&thickness,&cover_url,&object(&[("shelf",shelf.clone()),("eagerRelief",JsValue::FALSE)])?])?;
 call(&scene,"add",&[&model])?;
 // The host's state object already has every field (src/js/book-model.js, viewState): writing existing keys keeps
 // it a fast object for draw().
 let v=call(environment,"state",&[])?;
 for(key,value)in[("env",environment.clone()),("canvas",canvas.clone()),("model",model.clone())]{put(&v,key,&value)?;}
 bookmark_flag(&v)?;
 if truthy(&shelf){put(&dataset(&v)?,"shelfView",&shelf_view)?;}
 let (vw,vh)=(num(&viewport_width),num(&viewport_height));
 let camera=Reflect::construct(read(&three,"OrthographicCamera")?.unchecked_ref(),
  &[n(-vw/2.0),n(vw/2.0),n(vh/2.0),n(-vh/2.0),n(0.1),n(10000.0)].iter().collect::<Array>())?;
 put(&read(&camera,"position")?,"z",&n(3000.0))?;
 for(key,value)in[("node",node.clone()),("book",book.clone()),("style",style.clone()),("width",width),("height",height),("thickness",thickness),
  ("viewportWidth",viewport_width),("viewportHeight",viewport_height),("centerX",center_x),("centerY",center_y),("coverUrl",cover_url),
  ("shelf",shelf.clone()),("shelfView",shelf_view.clone()),("compactReturnFrame",compact),("adaptiveNativeFrame",adaptive),
  ("shared",shared),("gpu",gpu.clone()),("directEnabled",b(direct_enabled)),("pixelRatio",pixel_ratio),("context",context),
  ("scene",scene.clone()),("camera",camera.clone()),("disposed",JsValue::FALSE),("current",JsValue::UNDEFINED),("pendingModel",JsValue::NULL),
  ("appearanceRevision",n(0.0)),("reliefPrepared",JsValue::FALSE),("reliefPreparation",JsValue::NULL),("currentBook",book.clone()),
  ("currentSnapshot",JsValue::NULL),("pageTheme",n(1.0))]{put(&v,key,&value)?;}
 put(&v,"coverPaintKey",&paint_key(&v,book,style)?)?;
 put(&v,"waitingForFirstDraw",&defer)?;
 put(&v,"compactCamera",&call(&camera,"clone",&[])?)?;
 put(&v,"compactBox",&Reflect::construct(read(&three,"Box3")?.unchecked_ref(),&Array::new())?)?;
 put(&v,"compactPoint",&Reflect::construct(read(&three,"Vector3")?.unchecked_ref(),&Array::new())?)?;
 put(&v,"projectionPacket",&call(environment,"packet",&[])?)?;
 for key in["compactWidth","closedCompactWidth","compactHeight"]{put(&v,key,&read(&sizes,key)?)?;}
 for(key,value)in[("copiedRectangle",JsValue::NULL),("displayedFrame",JsValue::NULL),("snapshotDirty",JsValue::FALSE),("live",JsValue::FALSE),
  ("suspendedHost",JsValue::NULL),("displayedPose",JsValue::NULL),("visualRevision",n(0.0)),("displayedRevision",n(-1.0))]{put(&v,key,&value)?;}
 let invalidate=own(&v,"book_view_invalidate_presentation",&[])?;put(&v,"invalidatePresentation",&invalidate)?;
 if direct_enabled{
  let element=read(&gpu,"domElement")?;
  call(&element,"addEventListener",&[&word("webglcontextlost"),&invalidate])?;
  call(&element,"addEventListener",&[&word("webglcontextrestored"),&invalidate])?;
 }
 put(&v,"externalPresentation",&JsValue::NULL)?;
 put(&v,"unregisterSnapshot",&if direct_enabled{call(environment,"lazyExports",&[&v])?}else{JsValue::UNDEFINED})?;
 put(&v,"owner",&object(&[("suspend",hosted(&v,"suspend")?),("repaint",hosted(&v,"repaint")?)])?)?;
 put(&v,"compactBounds",&hosted(&v,"compactBounds")?)?;
 put(&v,"bookmarkFrame",&hosted(&v,"bookmarkFrame")?)?;
 // One shared state object: reading frame capacities never crosses WASM.
 // Rust owns RAF jobs, cancellation and native frame reservation tokens.
 let rust=read(environment,"rust")?;
 let motion=crate::book_view_motion::book_view_motion_state(object(&[("createSampler",read(environment,"sampler")?),("draw",hosted(&v,"draw")?),
  ("position",hosted(&v,"positionModel")?),("measure",hosted(&v,"measure")?),("noop",read(environment,"noop")?),
  ("tick",read(&rust,"book_view_motion_tick")?),("cancel",read(&rust,"book_view_motion_cancel")?),("release",read(&rust,"book_view_motion_release")?)])?)?;
 put(&v,"motionState",&motion)?;
 put(&user(&model)?,"invalidate",&own(&v,"book_view_redraw",&[])?)?;
 // Lifted books reveal hidden materials mid-motion (the inside of the board,
 // the page). Queue every program now, not in the middle of the opening.
 // three only issues compile/link here and waits for a program on its first
 // draw, so hidden ones build in the background (in parallel where
 // KHR_parallel_shader_compile exists). compileAsync adds nothing to that,
 // and its polling throws if the flyout is closed before a program is ready.
 if !truthy(&shelf){let _compiled_lazily_on_first_use=call(environment,"compilePrograms",&[&gpu,&scene,&camera]);}
 let pose=if absent(&initial_pose){
  let isometric=shelf_view.as_string().is_some_and(|view|view=="isometric");
  let angle=if truthy(&shelf){if isometric{76.0}else{90.0}}else{0.0};
  object(&[("x",n(0.0)),("y",n(0.0)),("scale",n(1.0)),("angle",n(angle)),("pitch",n(if truthy(&shelf)&&isometric{9.0}else{0.0}))])?
 }else{initial_pose};
 draw(&v,&pose,Some(&object(&[("redraw",b(!truthy(&defer)))])?))?;
 let api:JsValue=Object::new().into();
 put(&api,"canvas",&canvas)?;
 let getter=Object::new();
 for(key,value)in[("get",own(&v,"book_view_ready",&[])?),("enumerable",JsValue::TRUE),("configurable",JsValue::TRUE)]{put(&getter,key,&value)?;}
 Object::define_property(api.unchecked_ref(),&word("ready"),&getter);
 put(&api,"draw",&hosted(&v,"draw")?)?;
 for(key,export)in[("deferDrawing","book_view_defer"),("releaseToSnapshot","book_view_release"),("handoffToShelfInsertion","book_view_handoff"),
  ("setCompactReturnFrame","book_view_compact"),("holdNativeMotionFrame","book_view_hold"),("updateAppearance","book_view_update_appearance"),
  ("prepareReturnAppearance","book_view_prepare_return"),("updateSpineAppearance","book_view_spine"),("updateCoverAppearance","book_view_cover"),
  ("prepareCoverRelief","book_view_prepare_relief"),("setCoverRelief","book_view_set_relief"),("updateEdgeAppearance","book_view_edges"),
  ("updateEditorAppearance","book_view_editor"),("updateBookmark","book_view_bookmark"),("setPageSnapshot","book_view_page_snapshot"),
  ("commitPreparedPage","book_view_commit_page"),("pageTextures","book_view_page_textures"),("uploadPageTexture","book_view_upload_texture"),
  ("compilePage","book_view_compile_page"),("preparePagePrograms","book_view_prepare_programs"),("hasPageSnapshot","book_view_has_snapshot"),
  ("setPageTheme","book_view_page_theme"),("animatePageTheme","book_view_animate_theme"),("getPageTheme","book_view_get_theme"),
  ("getPageBounds","book_view_page_bounds"),("getPose","book_view_pose"),("setBookmarkWithdraw","book_view_withdraw"),
  ("animateCoverOpen","book_view_open"),("animateCoverClose","book_view_close"),("animateBookmark","book_view_animate_bookmark"),
  ("alignToPage","book_view_align"),("animateToPage","book_view_animate_page"),("animate","book_view_animate"),("dispose","book_view_dispose")]{
  put(&api,key,&own(&v,export,&[])?)?;
 }
 Ok(api)
}

// ---- the view's methods --------------------------------------------------------------------------------
#[wasm_bindgen]
pub fn book_view_ready(v:&JsValue)->R<JsValue>{
 let pending=state(v,"pendingModel");
 let target=if truthy(&pending){pending}else{state(v,"model")};
 read(&user(&target)?,"ready")
}
#[wasm_bindgen]
pub fn book_view_defer(v:&JsValue)->R<()>{if !disposed(v){put(v,"waitingForFirstDraw",&JsValue::TRUE)?;}Ok(())}
#[wasm_bindgen]
pub fn book_view_compact(v:&JsValue,enabled:&JsValue)->R<()>{put(v,"compactReturnFrame",&b(truthy(enabled)))}
#[wasm_bindgen]
pub fn book_view_hold(v:&JsValue)->R<JsValue>{
 if disposed(v){return read(&env(v),"noop");}
 crate::book_view_motion::book_view_motion_hold(state(v,"motionState"),state(v,"displayedFrame"),motion_options(v)?)
}
/// `releaseToSnapshot({ resume = false } = {})`: the export canvas shows the last frame again.
#[wasm_bindgen]
pub fn book_view_release(v:&JsValue,options:&JsValue)->R<()>{
 let resume=!options.is_undefined()&&truthy(&crate::host::read(options,"resume")?);
 capture(v)?;
 if owns_presentation(v)?{call(&read(&state(v,"gpu"),"domElement")?,"remove",&[])?;put(&slot(v)?,"owner",&JsValue::NULL)?;}
 opacity(v,"")?;put(v,"live",&JsValue::FALSE)?;
 put(v,"suspendedHost",&if resume{read(&state(v,"canvas"),"parentElement")?}else{JsValue::NULL})?;
 if !resume{put(v,"directEnabled",&JsValue::FALSE)?;}
 Ok(())
}

// A shelf insertion owns its exact cached RGBA after its first successful
// two-pass paint. Until then the existing closed flyout stays on screen.
// The bridge never exposes a general-purpose bypass of book snapshots.
#[wasm_bindgen]
pub fn book_view_handoff(v:&JsValue,start:&JsValue)->R<JsValue>{
 if disposed(v)||truthy(&state(v,"externalPresentation"))||!truthy(&state(v,"directEnabled"))||!truthy(&state(v,"live"))
  ||!owns_presentation(v)?||!truthy(&state(v,"displayedFrame"))||!truthy(&read(&state(v,"canvas"),"isConnected")?)
  ||!truthy(&state(v,"context"))||!start.is_function(){return Ok(JsValue::NULL);}
 let transaction=object(&[("lease",JsValue::NULL),("candidate",JsValue::NULL),("committed",JsValue::FALSE)])?;
 put(v,"externalPresentation",&transaction)?;
 let bridge:JsValue=Object::new().into();
 put(&bridge,"canvas",&state(v,"canvas"))?;put(&bridge,"context",&state(v,"context"))?;
 put(&bridge,"createLease",&own(v,"book_view_bridge_lease",&[&transaction])?)?;
 put(&bridge,"commit",&own(v,"book_view_bridge_commit",&[&transaction])?)?;
 put(&bridge,"cancel",&own(v,"book_view_bridge_cancel",&[&transaction])?)?;
 put(&bridge,"fallback",&own(v,"book_view_bridge_fallback",&[&transaction,&bridge])?)?;
 let attempt=||->R<JsValue>{
  let handle=crate::host::call(start,"start",&[&bridge])?;
  if !truthy(&handle){call(&bridge,"cancel",&[])?;return Ok(JsValue::NULL);}
  Ok(handle)
 };
 match attempt(){Ok(handle)=>Ok(handle),Err(error)=>{call(&bridge,"cancel",&[])?;Err(error)}}
}
fn current_transaction(v:&JsValue,transaction:&JsValue)->bool{state(v,"externalPresentation")==*transaction}
#[wasm_bindgen]
pub fn book_view_bridge_lease(v:&JsValue,transaction:&JsValue,callbacks:&JsValue)->R<JsValue>{
 if disposed(v)||!current_transaction(v,transaction)||truthy(&read(transaction,"candidate")?){return Ok(JsValue::NULL);}
 let candidate=call(&env(v),"lease",&[&state(v,"shared"),callbacks,&state(v,"canvas"),&state(v,"context")])?;
 put(transaction,"candidate",&candidate)?;
 read(transaction,"candidate")
}
#[wasm_bindgen]
pub fn book_view_bridge_commit(v:&JsValue,transaction:&JsValue,lease:&JsValue)->R<bool>{
 if disposed(v)||!current_transaction(v,transaction)||read(transaction,"candidate")?!=*lease||absent(lease)||!truthy(&call(lease,"isOwner",&[])?){return Ok(false);}
 put(transaction,"lease",lease)?;put(transaction,"committed",&JsValue::TRUE)?;
 if owns_presentation(v)?{call(&read(&state(v,"gpu"),"domElement")?,"remove",&[])?;put(&slot(v)?,"owner",&JsValue::NULL)?;}
 opacity(v,"0")?;put(v,"live",&JsValue::FALSE)?;put(v,"directEnabled",&JsValue::FALSE)?;
 Ok(true)
}
#[wasm_bindgen]
pub fn book_view_bridge_cancel(v:&JsValue,transaction:&JsValue)->R<()>{
 if !current_transaction(v,transaction){return Ok(());}
 let candidate=read(transaction,"candidate")?;
 let still_owns_frame=if absent(&candidate){JsValue::UNDEFINED}else{call(&candidate,"isOwner",&[])?};
 let candidate=read(transaction,"candidate")?;
 if !absent(&candidate){call(&candidate,"dispose",&[&object(&[("snapshot",JsValue::FALSE)])?])?;}
 put(v,"externalPresentation",&JsValue::NULL)?;
 // A failed first paint retains the existing native book. A later
 // cancellation explicitly restores that closed frame before fallback.
 if truthy(&read(transaction,"committed")?)&&truthy(&still_owns_frame)&&!disposed(v){
  let owner=read(&slot(v)?,"owner")?;
  if !truthy(&owner)||owner==state(v,"owner"){
   put(v,"directEnabled",&JsValue::TRUE)?;
   // A late appearance replacement may have been prepared, but never
   // drawn. Reapply the preserved closed pose before restoring it.
   draw(v,&state(v,"current"),None)?;
  }
 }
 Ok(())
}
#[wasm_bindgen]
pub fn book_view_bridge_fallback(v:&JsValue,_transaction:&JsValue,bridge:&JsValue)->R<JsValue>{
 call(bridge,"cancel",&[])?;
 if !disposed(v){book_view_release(v,&JsValue::UNDEFINED)?;}
 Ok(state(v,"context"))
}

/// `updateAppearance(nextStyle, { reuseModel = false } = {})`.
#[wasm_bindgen]
pub fn book_view_update_appearance(v:&JsValue,next_style:&JsValue,options:&JsValue)->R<bool>{
 let reuse=!options.is_undefined()&&truthy(&crate::host::read(options,"reuseModel")?);
 if disposed(v){return Ok(false);}
 // Editor previews already changed the cover/edges. Flush their last spine
 // choice into the same model; retain page, ribbon and material ownership.
 // Cold/failed covers and outstanding full replacements keep their original
 // lifecycle. A decoded image (or generated case) can repaint synchronously.
 let model=state(v,"model");
 if reuse&&!truthy(&state(v,"pendingModel"))&&read(&user(&model)?,"coverLoaded")?==JsValue::TRUE{
  let next_key=paint_key(v,&state(v,"currentBook"),next_style)?;
  let invalidate=read(&user(&model)?,"invalidate")?;
  put(&user(&model)?,"invalidate",&JsValue::NULL)?;
  let body=||->R<()>{
   call(&user(&model)?,"updateSpineAppearance",&[&state(v,"currentBook"),next_style])?;
   if next_key!=state(v,"coverPaintKey"){
    call(&user(&model)?,"updateCoverSource",&[&state(v,"coverUrl"),&state(v,"currentBook"),next_style,&object(&[("force",JsValue::TRUE)])?])?;
    if read(&user(&model)?,"coverLoaded")?==JsValue::TRUE{put(v,"coverPaintKey",&next_key)?;}
   }
   Ok(())
  };
  let result=body();
  put(&user(&model)?,"invalidate",&invalidate)?;
  result?;
  draw_updated(v)?;
  return Ok(true);
 }
 let replacement_key=paint_key(v,&state(v,"currentBook"),next_style)?;
 let revision=bump(v,"appearanceRevision")?;
 let pending=state(v,"pendingModel");
 if !absent(&pending){call(&user(&pending)?,"dispose",&[])?;}
 let replacement=call(&env(v),"model",&[&state(v,"currentBook"),next_style,&state(v,"width"),&state(v,"height"),&state(v,"thickness"),
  &state(v,"coverUrl"),&object(&[("shelf",state(v,"shelf")),("eagerRelief",state(v,"reliefPrepared"))])?])?;
 put(v,"pendingModel",&replacement)?;
 let job=object(&[("replacement",replacement.clone()),("revision",n(revision)),("key",replacement_key)])?;
 if truthy(&read(&user(&replacement)?,"coverLoaded")?){book_view_replace(v,&job)?;}
 else{call(&read(&user(&replacement)?,"ready")?,"then",&[&own(v,"book_view_replace",&[&job])?])?;}
 Ok(true)
}
/// The replacement model takes the old one's place once its cover is on (or is dropped if outdated).
#[wasm_bindgen]
pub fn book_view_replace(v:&JsValue,job:&JsValue)->R<()>{
 let replacement=read(job,"replacement")?;
 if disposed(v)||num(&read(job,"revision")?)!=num(&state(v,"appearanceRevision")){call(&user(&replacement)?,"dispose",&[])?;return Ok(());}
 let previous=state(v,"model");let scene=state(v,"scene");
 call(&scene,"remove",&[&previous])?;put(v,"model",&replacement)?;put(v,"pendingModel",&JsValue::NULL)?;
 put(v,"coverPaintKey",&read(job,"key")?)?;
 bookmark_flag(v)?;
 call(&scene,"add",&[&replacement])?;
 put(&user(&replacement)?,"invalidate",&own(v,"book_view_redraw",&[])?)?;
 let snapshot=state(v,"currentSnapshot");
 if truthy(&snapshot){call(&user(&replacement)?,"setPageSnapshot",&[&snapshot])?;}
 draw_updated(v)?;
 call(&user(&previous)?,"dispose",&[])?;
 Ok(())
}

/// Upgrade a parked reader model without replacing its page or GPU programs.
/// This explicit return-only operation never presents a partly decoded cover.
#[wasm_bindgen]
pub fn book_view_prepare_return(v:&JsValue,next_book:&JsValue,next_style:&JsValue,next_url:&JsValue)->JsValue{
 let (mut resolve,mut reject)=(JsValue::UNDEFINED,JsValue::UNDEFINED);
 let promise=Promise::new(&mut |yes,no|{resolve=yes.into();reject=no.into();});
 if let Err(error)=prepare_return(v,next_book,next_style,next_url,&resolve){let _=crate::host::call(&reject,"reject",&[&error]);}
 promise.into()
}
fn settle(job:&JsValue,value:bool)->R<()>{crate::host::call(&read(job,"resolve")?,"resolve",&[&b(value)])?;Ok(())}
fn prepare_return(v:&JsValue,next_book:&JsValue,next_style:&JsValue,next_url:&JsValue,resolve:&JsValue)->R<()>{
 let geometry=object(&[("width",state(v,"width")),("height",state(v,"height")),("thickness",state(v,"thickness")),
  ("viewportWidth",state(v,"viewportWidth")),("viewportHeight",state(v,"viewportHeight")),("centerX",state(v,"centerX")),("centerY",state(v,"centerY"))])?;
 let environment=env(v);
 let compatible=call(&environment,"compatibility",&[&state(v,"currentBook"),&state(v,"style"),&geometry])?;
 let declined=disposed(v)||truthy(&state(v,"pendingModel"))||truthy(&state(v,"externalPresentation"))
  ||read(&user(&state(v,"model"))?,"coverLoaded")?!=JsValue::TRUE||!truthy(&compatible)
  ||compatible!=call(&environment,"compatibility",&[next_book,next_style,&geometry])?;
 if declined{crate::host::call(resolve,"resolve",&[&JsValue::FALSE])?;return Ok(());}
 put(v,"waitingForFirstDraw",&JsValue::TRUE)?;
 book_view_bookmark(v,next_book,&JsValue::UNDEFINED)?;
 let target=state(v,"model");let revision=bump(v,"appearanceRevision")?;
 let job=object(&[("target",target),("revision",n(revision)),("resolve",resolve.clone()),("style",next_style.clone())])?;
 match return_body(v,&job,next_book,next_style,next_url){
  Ok(Some(done))=>settle(&job,done),
  Ok(None)=>Ok(()),
  Err(_)=>settle(&job,false),
 }
}
fn active(v:&JsValue,job:&JsValue)->R<bool>{
 Ok(!disposed(v)&&state(v,"model")==read(job,"target")?&&!truthy(&state(v,"pendingModel"))
  &&num(&read(job,"revision")?)==num(&state(v,"appearanceRevision")))
}
/// The synchronous part; `None` while a promise continues it.
fn return_body(v:&JsValue,job:&JsValue,next_book:&JsValue,next_style:&JsValue,next_url:&JsValue)->R<Option<bool>>{
 let target=read(job,"target")?;
 let spine_changed=JsValue::from(js_sys::JSON::stringify(&state(v,"style"))?)!=JsValue::from(js_sys::JSON::stringify(next_style)?);
 put(v,"currentBook",&spread(v,&state(v,"currentBook"),next_book,&JsValue::UNDEFINED)?)?;
 if spine_changed{call(&user(&target)?,"updateSpineAppearance",&[&state(v,"currentBook"),next_style])?;}
 put(v,"coverUrl",next_url)?;
 let next_key=paint_key(v,&state(v,"currentBook"),next_style)?;
 put(job,"key",&next_key)?;
 if next_key!=state(v,"coverPaintKey"){
  let loaded=call(&user(&target)?,"updateCoverSource",&[&state(v,"coverUrl"),&state(v,"currentBook"),next_style,&object(&[("force",JsValue::TRUE)])?])?;
  call(&Promise::resolve(&loaded).into(),"then",&[&own(v,"book_view_return_cover",&[job])?,&own(v,"book_view_return_failed",&[job])?])?;
  return Ok(None);
 }
 return_finish(v,job).map(Some)
}
fn return_finish(v:&JsValue,job:&JsValue)->R<bool>{
 if !active(v,job)?{return Ok(false);}
 put(v,"coverPaintKey",&read(job,"key")?)?;put(v,"style",&read(job,"style")?)?;
 Ok(true)
}
/// After `await target.userData.updateCoverSource(...)`.
#[wasm_bindgen]
pub fn book_view_return_cover(v:&JsValue,job:&JsValue,loaded:&JsValue){
 let step=||->R<Option<bool>>{
  if *loaded!=JsValue::TRUE||!active(v,job)?{return Ok(Some(false));}
  let relief=read(&state(v,"currentBook"),"coverRelief")?;
  if truthy(&relief){
   let target=read(job,"target")?;
   let applied=call(&user(&target)?,"setCoverRelief",&[&read(&state(v,"currentBook"),"coverRelief")?])?;
   call(&Promise::resolve(&applied).into(),"then",&[&own(v,"book_view_return_relief",&[job])?,&own(v,"book_view_return_failed",&[job])?])?;
   return Ok(None);
  }
  return_finish(v,job).map(Some)
 };
 let _=match step(){Ok(Some(done))=>settle(job,done),Ok(None)=>Ok(()),Err(_)=>settle(job,false)};
}
/// After `await target.userData.setCoverRelief(...)`.
#[wasm_bindgen]
pub fn book_view_return_relief(v:&JsValue,job:&JsValue,applied:&JsValue){
 let done=if *applied!=JsValue::TRUE{Ok(false)}else{return_finish(v,job)};
 let _=settle(job,done.unwrap_or(false));
}
#[wasm_bindgen]
pub fn book_view_return_failed(_v:&JsValue,job:&JsValue){let _=settle(job,false);}

#[wasm_bindgen]
pub fn book_view_spine(v:&JsValue,next_book:&JsValue,next_style:&JsValue)->R<bool>{
 if disposed(v){return Ok(false);}
 put(v,"currentBook",&spread(v,&state(v,"currentBook"),next_book,&JsValue::UNDEFINED)?)?;
 let pending=state(v,"pendingModel");
 if !absent(&pending){user_opt(&pending,"updateSpineAppearance",&[next_book,next_style])?;}
 user_opt(&state(v,"model"),"updateSpineAppearance",&[next_book,next_style])?;
 draw_updated(v)?;
 Ok(true)
}
/// Both models (the one still loading included) without their own invalidation while `silent`: the
/// callbacks are restored as they were, even when a mutation throws or disposes the view.
fn without_invalidation(v:&JsValue,silent:bool,each:impl Fn(&JsValue)->R<()>)->R<()>{
 let targets:Vec<JsValue>=[state(v,"pendingModel"),state(v,"model")].into_iter().filter(truthy).collect();
 let mut saved=Vec::new();
 if silent{
  for target in &targets{
   let data=user(target)?;let invalidate=read(&data,"invalidate")?;
   let own=Object::has_own(data.unchecked_ref(),&word("invalidate"));
   saved.push((target.clone(),invalidate,own));
  }
 }
 for(target,_,_)in &saved{put(&user(target)?,"invalidate",&JsValue::NULL)?;}
 let result=(||->R<()>{for target in &targets{each(target)?;}Ok(())})();
 for(target,invalidate,own)in &saved{
  let data=user(target)?;
  if *own{put(&data,"invalidate",invalidate)?;}else{Reflect::delete_property(data.unchecked_ref(),&word("invalidate"))?;}
 }
 result
}
fn material_appearance(v:&JsValue,next_book:&JsValue,method:&'static str,options:&JsValue)->R<bool>{
 if disposed(v){return Ok(false);}
 put(v,"currentBook",&spread(v,&state(v,"currentBook"),next_book,&JsValue::UNDEFINED)?)?;
 // Only the editor's explicit batch defers a synchronous paint. Existing
 // callers, including null or ignored extra arguments, still draw by default.
 let redraw=crate::host::get(options,"redraw")!=JsValue::FALSE;
 without_invalidation(v,!redraw,|target|{user_opt(target,method,&[next_book])?;Ok(())})?;
 if redraw{draw_updated(v)?;}
 Ok(true)
}
#[wasm_bindgen]
pub fn book_view_cover(v:&JsValue,next_book:&JsValue,options:&JsValue)->R<bool>{material_appearance(v,next_book,"updateCoverAppearance",options)}
#[wasm_bindgen]
pub fn book_view_edges(v:&JsValue,next_book:&JsValue,options:&JsValue)->R<bool>{material_appearance(v,next_book,"updateEdgeAppearance",options)}
#[wasm_bindgen]
pub fn book_view_editor(v:&JsValue,next_book:&JsValue)->R<bool>{
 if disposed(v){return Ok(false);}
 // Apply the complete latest record to both materials before presenting it.
 // One conservative paint also covers changes made outside this editor input.
 book_view_cover(v,next_book,&object(&[("redraw",JsValue::FALSE)])?)?;
 book_view_edges(v,next_book,&object(&[("redraw",JsValue::FALSE)])?)?;
 if disposed(v){return Ok(false);}
 draw_updated(v)?;
 Ok(true)
}
#[wasm_bindgen]
pub fn book_view_bookmark(v:&JsValue,next_book:&JsValue,options:&JsValue)->R<bool>{
 if disposed(v){return Ok(false);}
 let environment=env(v);
 let before=JsValue::from(js_sys::JSON::stringify(&call(&environment,"bookmarkFor",&[&state(v,"currentBook")])?)?);
 let after=JsValue::from(js_sys::JSON::stringify(&call(&environment,"bookmarkFor",&[next_book])?)?);
 put(v,"currentBook",&spread(v,&state(v,"currentBook"),next_book,&JsValue::UNDEFINED)?)?;
 if before!=after{
  bump(v,"visualRevision")?;
  let silent=crate::host::get(options,"redraw")==JsValue::FALSE;
  without_invalidation(v,silent,|target|{user_opt(target,"updateBookmark",&[next_book])?;Ok(())})?;
  bookmark_flag(v)?;
 }
 Ok(true)
}

/// Compile and draw the neutral relief material before offering choices.
/// The first draw completes any deferred driver compilation and uploads its
/// maps; later selections replace pixels/uniforms without a shader variant.
#[wasm_bindgen]
pub fn book_view_prepare_relief(v:&JsValue)->R<JsValue>{
 if disposed(v){return Ok(Promise::resolve(&JsValue::FALSE).into());}
 let pending=state(v,"reliefPreparation");
 if truthy(&pending){return Ok(pending);}
 let prepared=call(&Promise::resolve(&JsValue::UNDEFINED).into(),"then",&[&own(v,"book_view_relief_step",&[])?])?;
 let preparation=call(&prepared,"catch",&[&own(v,"book_view_relief_reset",&[])?])?;
 put(v,"reliefPreparation",&preparation)?;
 Ok(preparation)
}
#[wasm_bindgen]
pub fn book_view_relief_step(v:&JsValue)->R<bool>{
 if disposed(v)||!truthy(&user_opt(&state(v,"model"),"prepareCoverRelief",&[])?){return Ok(false);}
 put(v,"reliefPrepared",&JsValue::TRUE)?;
 let pending=state(v,"pendingModel");
 if !absent(&pending){user_opt(&pending,"prepareCoverRelief",&[])?;}
 call(&state(v,"gpu"),"compile",&[&state(v,"scene"),&state(v,"camera")])?;
 draw_updated(v)?;
 Ok(true)
}
#[wasm_bindgen]
pub fn book_view_relief_reset(v:&JsValue,error:JsValue)->R<()>{put(v,"reliefPreparation",&JsValue::NULL)?;Err(error)}
/// Apply (or clear, with null) a cover relief on the book, the one still
/// loading included. Resolves once the maps are on the cover and drawn.
#[wasm_bindgen]
pub fn book_view_set_relief(v:&JsValue,relief:&JsValue)->JsValue{
 if disposed(v){return Promise::resolve(&JsValue::FALSE).into();}
 let (mut resolve,mut reject)=(JsValue::UNDEFINED,JsValue::UNDEFINED);
 let promise=Promise::new(&mut |yes,no|{resolve=yes.into();reject=no.into();});
 let start=||->R<()>{
  let normalized=call(&env(v),"normalizeRelief",&[relief])?;
  put(v,"currentBook",&spread(v,&state(v,"currentBook"),&object(&[("coverRelief",normalized)])?,&JsValue::UNDEFINED)?)?;
  let pending=state(v,"pendingModel");
  let first=if absent(&pending){JsValue::UNDEFINED}else{user_opt(&pending,"setCoverRelief",&[relief])?};
  let second=user_opt(&state(v,"model"),"setCoverRelief",&[relief])?;
  let all=Promise::all(&[first,second].iter().collect::<Array>());
  let job=object(&[("resolve",resolve.clone()),("reject",reject.clone())])?;
  call(&all.into(),"then",&[&own(v,"book_view_relief_set",&[&job])?,&reject])?;
  Ok(())
 };
 if let Err(error)=start(){let _=crate::host::call(&reject,"reject",&[&error]);}
 promise.into()
}
#[wasm_bindgen]
pub fn book_view_relief_set(v:&JsValue,job:&JsValue,results:&JsValue){
 let finish=||->R<bool>{
  if !disposed(v){draw_updated(v)?;}
  Ok(Array::from(results).iter().any(|result|truthy(&result)))
 };
 let _=match finish(){
  Ok(any)=>read(job,"resolve").and_then(|resolve|crate::host::call(&resolve,"resolve",&[&b(any)])),
  Err(error)=>read(job,"reject").and_then(|reject|crate::host::call(&reject,"reject",&[&error])),
 };
}

fn animate_motion(v:&JsValue,frames:JsValue,duration:JsValue,on_frame:JsValue)->R<JsValue>{
 crate::book_view_motion::book_view_motion_start(state(v,"motionState"),frames,duration,on_frame,state(v,"current"),motion_options(v)?)
}
fn two_frames(from:&JsValue,to:&JsValue)->R<JsValue>{
 Ok([object(&[("transform",from.clone())])?,object(&[("transform",to.clone())])?].iter().collect::<Array>().into())
}
/// `animate(frames, { duration, onFrame })`.
#[wasm_bindgen]
pub fn book_view_animate(v:&JsValue,frames:&JsValue,options:&JsValue)->R<JsValue>{
 let duration=crate::host::read(options,"duration")?;let on_frame=crate::host::read(options,"onFrame")?;
 animate_motion(v,frames.clone(),duration,on_frame)
}
/// The board's opening or closing from the current pose (`{ duration, offsetX = 0, targetPose } = {}`).
fn board_motion(v:&JsValue,options:&JsValue,default_duration:f64,opening:bool)->R<JsValue>{
 let pick=|key:&'static str|->R<JsValue>{if options.is_undefined(){Ok(JsValue::UNDEFINED)}else{crate::host::read(options,k(key))}};
 let duration=or_default(pick("duration")?,n(default_duration));
 let offset=or_default(pick("offsetX")?,n(0.0));
 let target=pick("targetPose")?;
 let origin=copy(v,&state(v,"current"))?;
 let x=crate::host::get(&target,"x");
 let x=if !absent(&x){x}else if opening{&get(&origin,"x")+&offset}else{&get(&origin,"x")-&offset};
 let tail=if opening{object(&[("x",x),("coverOpen",n(1.0))])?}else{object(&[("x",x),("coverOpen",n(0.0)),("bookmarkWithdraw",n(0.0))])?};
 let destination=spread(v,&origin,&target,&tail)?;
 animate_motion(v,two_frames(&origin,&destination)?,duration,JsValue::UNDEFINED)
}
#[wasm_bindgen]
pub fn book_view_open(v:&JsValue,options:&JsValue)->R<JsValue>{board_motion(v,options,520.0,true)}
#[wasm_bindgen]
pub fn book_view_close(v:&JsValue,options:&JsValue)->R<JsValue>{board_motion(v,options,580.0,false)}
/// `animateBookmark({ withdraw = 1, duration = 360 } = {})`: frames that only move an absent ribbon keep the
/// presented native frame.
#[wasm_bindgen]
pub fn book_view_animate_bookmark(v:&JsValue,options:&JsValue)->R<JsValue>{
 let pick=|key:&'static str|->R<JsValue>{if options.is_undefined(){Ok(JsValue::UNDEFINED)}else{crate::host::read(options,k(key))}};
 let withdraw=or_default(pick("withdraw")?,n(1.0));let duration=or_default(pick("duration")?,n(360.0));
 let origin=copy(v,&state(v,"current"))?;
 let destination=spread(v,&origin,&object(&[("bookmarkWithdraw",withdraw)])?,&JsValue::UNDEFINED)?;
 animate_motion(v,two_frames(&origin,&destination)?,duration,state(v,"bookmarkFrame"))
}
/// `animatePageTheme({ from, to = 1, duration = 720 } = {})`.
#[wasm_bindgen]
pub fn book_view_animate_theme(v:&JsValue,options:&JsValue)->R<JsValue>{
 let pick=|key:&'static str|->R<JsValue>{if options.is_undefined(){Ok(JsValue::UNDEFINED)}else{crate::host::read(options,k(key))}};
 let from=pick("from")?;let to=or_default(pick("to")?,n(1.0));let duration=or_default(pick("duration")?,n(720.0));
 let current=state(v,"current");
 let theme=if !absent(&from){from}else{let own_theme=crate::host::get(&current,"pageTheme");if !absent(&own_theme){own_theme}else{state(v,"pageTheme")}};
 let origin=spread(v,&current,&object(&[("pageTheme",theme)])?,&JsValue::UNDEFINED)?;
 let destination=spread(v,&origin,&object(&[("pageTheme",to)])?,&JsValue::UNDEFINED)?;
 animate_motion(v,two_frames(&origin,&destination)?,duration,JsValue::UNDEFINED)
}
#[wasm_bindgen]
pub fn book_view_page_theme(v:&JsValue,mix:&JsValue)->R<()>{
 let current=state(v,"current");
 if truthy(&current){draw(v,&spread(v,&current,&object(&[("pageTheme",mix.clone())])?,&JsValue::UNDEFINED)?,None)?;}
 Ok(())
}
#[wasm_bindgen]
pub fn book_view_withdraw(v:&JsValue,amount:&JsValue)->R<()>{
 let current=state(v,"current");
 if truthy(&current){draw(v,&spread(v,&current,&object(&[("bookmarkWithdraw",amount.clone())])?,&JsValue::UNDEFINED)?,None)?;}
 Ok(())
}
#[wasm_bindgen]
pub fn book_view_get_theme(v:&JsValue)->JsValue{state(v,"pageTheme")}
#[wasm_bindgen]
pub fn book_view_pose(v:&JsValue)->R<JsValue>{copy(v,&state(v,"current"))}

// ---- the page --------------------------------------------------------------------------------------------
/// `pageTheme` (0 = white stock, 1 = the reader's own theme; default 1) is where the page's colour starts:
/// the book opens and closes on white paper. `setPageSnapshot(snapshot, { pageTheme, redraw = !waitingForFirstDraw } = {})`.
#[wasm_bindgen]
pub fn book_view_page_snapshot(v:&JsValue,snapshot:&JsValue,options:&JsValue)->R<bool>{
 let (initial,redraw)=if options.is_undefined(){(JsValue::UNDEFINED,JsValue::UNDEFINED)}
  else{(crate::host::read(options,"pageTheme")?,crate::host::read(options,"redraw")?)};
 let redraw=if redraw.is_undefined(){!truthy(&state(v,"waitingForFirstDraw"))}else{truthy(&redraw)};
 if !absent(&initial){
  let value=num(&initial);
  let theme=jmax(0.0,jmin(1.0,if value==0.0||value.is_nan(){0.0}else{value}));
  put(v,"pageTheme",&n(theme))?;
  let current=state(v,"current");
  if truthy(&current){put(v,"current",&spread(v,&current,&object(&[("pageTheme",n(theme))])?,&JsValue::UNDEFINED)?)?;}
 }
 // bookView owns its one framebuffer commit. The model's invalidation must
 // not render the same page again before the explicit draw below.
 if disposed(v){return Ok(false);}
 let quiet=||object(&[("pageTheme",state(v,"pageTheme")),("redraw",JsValue::FALSE)]);
 if !truthy(&call(&user(&state(v,"model"))?,"setPageSnapshot",&[snapshot,&quiet()?])?){return Ok(false);}
 put(v,"currentSnapshot",snapshot)?;bump(v,"visualRevision")?;
 let pending=state(v,"pendingModel");
 if !absent(&pending){call(&user(&pending)?,"setPageSnapshot",&[snapshot,&quiet()?])?;}
 let data=dataset(v)?;
 let source=read(snapshot,"sourceType")?;
 let source=if truthy(&source){source}else{let engine=read(snapshot,"engine")?;if truthy(&engine){engine}else{word("reader-page")}};
 put(&data,"pageSource",&source)?;
 let location=read(snapshot,"location")?;
 let locator=crate::host::get(&location,"locator");
 let locator=if !absent(&locator){locator}else if !absent(&location){location}else{JsValue::NULL};
 put(&data,"pageLocator",&js_sys::JSON::stringify(&locator)?.into())?;
 let text=read(snapshot,"text")?;
 let text=crate::host::text_value(&if truthy(&text){text}else{word("")});
 put(&data,"pageText",&JsString::from(text).slice(0,500).into())?;
 for(key,size)in[("pageWidth","width"),("pageHeight","height")]{
  let value=read(snapshot,size)?;
  let value=if truthy(&value){value}else{read(&read(snapshot,"source")?,size)?};
  put(&data,key,&crate::host::text_value(&value))?;
 }
 let current=state(v,"current");
 if truthy(&current)&&redraw{draw(v,&current,None)?;}
 Ok(true)
}
/// Commit an already painted page before opening. False keeps the caller's
/// original draw, including interrupted warm-up and mutable legacy output.
#[wasm_bindgen]
pub fn book_view_commit_page(v:&JsValue,snapshot:&JsValue,options:&JsValue)->R<bool>{
 let target=if options.is_undefined(){JsValue::UNDEFINED}else{crate::host::read(options,"pageTheme")?};
 let target=or_default(target,state(v,"pageTheme"));
 let current=state(v,"current");
 if !truthy(snapshot)||state(v,"currentSnapshot")!=*snapshot||!truthy(&current){return Ok(false);}
 let pose=spread(v,&current,&object(&[("pageTheme",target)])?,&JsValue::UNDEFINED)?;
 let keys:Array=Array::from(&read(&env(v),"bookmarkPoseKeys")?).concat(&Array::of1(&word("bookmarkWithdraw")));
 if !truthy(&call(&env(v),"nativeFrame",&[v,&pose,&keys])?){return Ok(false);}
 // A consumer may have painted the export canvas since its last capture.
 // Retain native pixels now and materialize those pixels on the next export.
 put(v,"snapshotDirty",&JsValue::TRUE)?;
 call(&env(v),"position",&[v,&state(v,"displayedFrame")])?;
 Ok(true)
}
#[wasm_bindgen]
pub fn book_view_has_snapshot(v:&JsValue,snapshot:&JsValue)->bool{truthy(snapshot)&&state(v,"currentSnapshot")==*snapshot}
// Warm-up of a page that is not on screen yet: the textures go to the GPU
// one by one (each upload is its own slice of main-thread time), then a
// single draw links the page's programs. Opening later finds all of it done.
#[wasm_bindgen]
pub fn book_view_page_textures(v:&JsValue)->R<JsValue>{
 if disposed(v){return Ok(Array::new().into());}
 call(&user(&state(v,"model"))?,"getPageTextures",&[])
}
/// Starts linking the programs the now visible page needs; where the driver
/// links in parallel, the draw that follows finds them done.
#[wasm_bindgen]
pub fn book_view_compile_page(v:&JsValue)->JsValue{
 if disposed(v){return JsValue::UNDEFINED;}
 // A driver that cannot compile now links on the first draw.
 call(&env(v),"compilePrograms",&[&state(v,"gpu"),&state(v,"scene"),&state(v,"camera")]).unwrap_or(JsValue::UNDEFINED)
}
/// `preparePagePrograms(idle, current = () => true)`: false where the driver has no reflection (the
/// original first draw remains).
#[wasm_bindgen]
pub fn book_view_prepare_programs(v:&JsValue,idle:&JsValue,current:&JsValue)->JsValue{
 let (mut resolve,mut reject)=(JsValue::UNDEFINED,JsValue::UNDEFINED);
 let promise=Promise::new(&mut |yes,no|{resolve=yes.into();reject=no.into();});
 let start=||->R<()>{
  let current=if current.is_undefined(){read(&env(v),"always")?}else{current.clone()};
  let materials=book_view_compile_page(v);
  let attempt=||->R<JsValue>{
   let options=object(&[("idle",idle.clone()),("current",own(v,"book_view_still_current",&[&current])?)])?;
   call(&env(v),"prepareUniforms",&[&state(v,"gpu"),&materials,&options])
  };
  match attempt(){
   Ok(prepared)=>{
    let declined=own(v,"book_view_declined",&[&resolve])?;
    call(&Promise::resolve(&prepared).into(),"then",&[&resolve,&declined])?;
   }
   Err(_)=>{crate::host::call(&resolve,"resolve",&[&JsValue::FALSE])?;}
  }
  Ok(())
 };
 if let Err(error)=start(){let _=crate::host::call(&reject,"reject",&[&error]);}
 promise.into()
}
#[wasm_bindgen]
pub fn book_view_declined(_v:&JsValue,resolve:&JsValue){let _=crate::host::call(resolve,"resolve",&[&JsValue::FALSE]);}
/// `() => !disposed && current()`.
#[wasm_bindgen]
pub fn book_view_still_current(v:&JsValue,current:&JsValue)->R<JsValue>{
 if disposed(v){return Ok(JsValue::FALSE);}
 crate::host::call(current,"current",&[])
}
#[wasm_bindgen]
pub fn book_view_upload_texture(v:&JsValue,texture:&JsValue)->R<bool>{
 if disposed(v)||!Array::from(&book_view_page_textures(v)?).includes(texture,0){return Ok(false);}
 let gpu=state(v,"gpu");
 // What draw() would set first.
 put(texture,"anisotropy",&n(jmin(16.0,num(&call(&read(&gpu,"capabilities")?,"getMaxAnisotropy",&[])?))))?;
 call(&gpu,"initTexture",&[texture])?;
 Ok(true)
}
#[wasm_bindgen]
pub fn book_view_page_bounds(v:&JsValue)->R<JsValue>{
 let rect=call(&state(v,"canvas"),"getBoundingClientRect",&[])?;
 let offset=object(&[("left",read(&rect,"left")?),("top",read(&rect,"top")?)])?;
 call(&env(v),"projectPage",&[&read(&user(&state(v,"model"))?,"pageSurface")?,&state(v,"camera"),&state(v,"viewportWidth"),&state(v,"viewportHeight"),&offset])
}
/// The pose that lays the page over `{ left, top, width, height }` (null before a first pose).
fn page_pose(v:&JsValue,target:&JsValue)->R<JsValue>{
 let (left,top,width,height)=(crate::host::read(target,"left")?,crate::host::read(target,"top")?,crate::host::read(target,"width")?,crate::host::read(target,"height")?);
 let current=state(v,"current");
 if !truthy(&current){return Ok(JsValue::NULL);}
 let origin=copy(v,&current)?;let rect=call(&state(v,"canvas"),"getBoundingClientRect",&[])?;
 let plan=object(&[("viewportWidth",state(v,"viewportWidth")),("viewportHeight",state(v,"viewportHeight")),("centerX",state(v,"centerX")),
  ("centerY",state(v,"centerY")),("origin",origin),("offset",object(&[("left",read(&rect,"left")?),("top",read(&rect,"top")?)])?),
  ("target",object(&[("left",left),("top",top),("width",width),("height",height)])?)])?;
 book_view_page_zoom(&env(v),&state(v,"model"),&state(v,"camera"),&plan)
}
/// `planBookPageZoom(model, camera, { viewportWidth, viewportHeight, centerX, centerY, origin, offset = { left:0, top:0 }, target })`:
/// the handoff planned in the reader's flat plane without repainting the book. Measuring the tilted preview
/// leaves a small vertical compression in the final frame, so the page is measured in its final orientation
/// and the pose restored before the animation starts (the flattening itself stays continuous).
#[wasm_bindgen]
pub fn book_view_page_zoom(environment:&JsValue,model:&JsValue,camera:&JsValue,options:&JsValue)->R<JsValue>{
 let field=|key:&'static str|crate::host::read(options,k(key));
 let (viewport_width,viewport_height,center_x,center_y,origin)=(field("viewportWidth")?,field("viewportHeight")?,field("centerX")?,field("centerY")?,field("origin")?);
 let offset=or_default(field("offset")?,object(&[("left",n(0.0)),("top",n(0.0))])?);
 let target=field("target")?;
 let rotation=read(model,"rotation")?;let saved=call(&rotation,"clone",&[])?;
 let measured=(||->R<JsValue>{
  call(&read(model,"rotation")?,"set",&[&n(0.0),&n(0.0),&n(0.0)])?;
  call(environment,"projectPage",&[&read(&user(model)?,"pageSurface")?,camera,&viewport_width,&viewport_height,&offset])
 })();
 call(&read(model,"rotation")?,"copy",&[&saved])?;call(model,"updateMatrixWorld",&[&JsValue::TRUE])?;
 let bounds=measured?;
 if !truthy(&bounds){return Ok(JsValue::NULL);}
 let zoom=call(environment,"planZoom",&[&bounds,&target,&offset,&center_x,&center_y,&origin])?;
 if !truthy(&zoom){return Ok(JsValue::NULL);}
 let pose=object(&[("x",read(&zoom,"x")?),("y",read(&zoom,"y")?),("scale",read(&zoom,"scale")?),("angle",n(0.0)),("pitch",n(0.0)),
  ("roll",n(0.0)),("coverOpen",n(1.0)),("bookmarkWithdraw",n(1.0))])?;
 call(environment,"spread",&[&origin,&pose,&JsValue::UNDEFINED])
}
#[wasm_bindgen]
pub fn book_view_align(v:&JsValue,target:&JsValue)->R<bool>{
 let destination=page_pose(v,target)?;
 if !truthy(&destination){return Ok(false);}
 draw(v,&destination,None)?;
 Ok(true)
}
#[wasm_bindgen]
pub fn book_view_animate_page(v:&JsValue,target:&JsValue)->R<JsValue>{
 let origin=copy(v,&state(v,"current"))?;let destination=page_pose(v,target)?;
 if !truthy(&destination){
  return object(&[("finished",Promise::resolve(&JsValue::UNDEFINED).into()),("cancel",read(&env(v),"noop")?)]);
 }
 // The page's colour moves on the zoom's own clock and easing.
 let theme=read(target,"pageTheme")?;
 if !absent(&theme){put(&destination,"pageTheme",&theme)?;}
 let duration=read(target,"duration")?;
 animate_motion(v,two_frames(&origin,&destination)?,or_default_absent(duration,n(620.0)),JsValue::UNDEFINED)
}
/// `a ?? b`.
fn or_default_absent(value:JsValue,fallback:JsValue)->JsValue{if absent(&value){fallback}else{value}}

/// `dispose(removeCanvas = true)`.
#[wasm_bindgen]
pub fn book_view_dispose(v:&JsValue,remove:&JsValue)->R<()>{
 let remove_canvas=remove.is_undefined()||truthy(remove);
 crate::book_view_motion::book_view_motion_dispose(state(v,"motionState"))?;
 if !remove_canvas{capture(v)?;}
 let unregister=state(v,"unregisterSnapshot");
 if !absent(&unregister){crate::host::call(&unregister,"unregisterSnapshot",&[])?;}
 let element=read(&state(v,"gpu"),"domElement")?;
 let invalidate=state(v,"invalidatePresentation");
 call(&element,"removeEventListener",&[&word("webglcontextlost"),&invalidate])?;
 call(&element,"removeEventListener",&[&word("webglcontextrestored"),&invalidate])?;
 let external=state(v,"externalPresentation");
 if !absent(&external){let candidate=read(&external,"candidate")?;if !absent(&candidate){call(&candidate,"dispose",&[&object(&[("snapshot",JsValue::FALSE)])?])?;}}
 put(v,"externalPresentation",&JsValue::NULL)?;
 if owns_presentation(v)?{call(&read(&state(v,"gpu"),"domElement")?,"remove",&[])?;put(&slot(v)?,"owner",&JsValue::NULL)?;}
 if !remove_canvas{opacity(v,"")?;}
 put(v,"live",&JsValue::FALSE)?;put(v,"disposed",&JsValue::TRUE)?;
 let pending=state(v,"pendingModel");
 if !absent(&pending){call(&user(&pending)?,"dispose",&[])?;}
 call(&user(&state(v,"model"))?,"dispose",&[])?;
 if remove_canvas{call(&state(v,"canvas"),"remove",&[])?;}
 Ok(())
}
