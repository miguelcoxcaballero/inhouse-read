//! The application shell of app.js: theme, screens, the reader's hidden controls and their margins,
//! the shelf's deferred refreshes, the Drive picker, the sign-in notice, the prepared page's
//! invalidation and the start-up of the header. app.js keeps its module wiring, the state its other
//! hosts share and the listeners, which call in here; every DOM call is the one it made, in order.
use std::cell::RefCell;
use wasm_bindgen::{prelude::*,JsCast};
use js_sys::{Array,Function,Object,Promise,Reflect};
use crate::host::{absent,get,global,listen,method,num,read,set,set_timeout,text,truthy,Listener};
use crate::cloud_host::{self,settle,start};
type R<T=()>=Result<T,JsValue>;

fn state(host:&JsValue)->R<JsValue>{read(host,"state")}
fn element(host:&JsValue,name:&str)->R<JsValue>{read(&read(host,"els")?,name)}
fn document(host:&JsValue)->R<JsValue>{read(host,"document")}
fn body(host:&JsValue)->R<JsValue>{read(&document(host)?,"body")}
fn classes(node:&JsValue)->R<JsValue>{read(node,"classList")}
fn has_class(node:&JsValue,name:&str)->R<bool>{Ok(truthy(&method(&classes(node)?,"contains",&[&name.into()])?))}
fn attr(node:&JsValue,name:&str,value:&JsValue)->R{method(node,"setAttribute",&[&name.into(),value])?;Ok(())}
fn query(host:&JsValue,selector:&str)->R<JsValue>{method(&document(host)?,"querySelector",&[&selector.into()])}
fn by_id(host:&JsValue,id:&str)->R<JsValue>{method(&document(host)?,"getElementById",&[&id.into()])}
fn hidden(node:&JsValue)->R<bool>{Ok(truthy(&read(node,"hidden")?))}
fn options(fields:&[(&str,JsValue)])->R<JsValue>{let object=Object::new();for (key,value) in fields{Reflect::set(&object,&(*key).into(),value)?;}Ok(object.into())}
fn storage()->R<JsValue>{read(&global(),"localStorage")}
/// `document.hidden`.
fn document_hidden(host:&JsValue)->R<bool>{Ok(truthy(&read(&document(host)?,"hidden")?))}

thread_local!{
 /// `error => console.warn(label, error)` for promise rejections the app only reports; one function each.
 static WARN_PENDING:Function=warner("Estantería pendiente:");
 static WARN_REFRESH:Function=warner("No se pudo actualizar la estantería:");
 static WARN_SYNC:Function=warner("No se pudieron sincronizar los libros pendientes:");
 /// The page-lifetime listeners of the prepared page and the reader's controls.
 static LISTENERS:RefCell<Vec<Listener>>=const{RefCell::new(Vec::new())};
 /// One listener per listed Drive file, replaced with the list.
 static DRIVE_ITEMS:RefCell<Vec<Listener>>=const{RefCell::new(Vec::new())};
 /// The observer waiting for an open cover to close before the shelf refreshes.
 static FLYOUT_WAIT:RefCell<Option<(JsValue,Closure<dyn FnMut(JsValue)>)>>=const{RefCell::new(None)};
}
fn warner(label:&'static str)->Function{
 Closure::<dyn FnMut(JsValue)>::new(move|error:JsValue|web_sys::console::warn_2(&label.into(),&error)).into_js_value().unchecked_into()
}
fn catch_with(promise:&JsValue,warn:&'static std::thread::LocalKey<Function>)->R{warn.with(|warn|method(promise,"catch",&[warn]))?;Ok(())}

// ---- Theme (Inhouse Notes' pattern: data-theme on the root, persisted) ----

/// The browser chrome (PWA/Chrome toolbar) takes the header's surface colour.
fn sync_theme_color(host:&JsValue,theme:&JsValue)->R{
 let meta=query(host,r#"meta[name="theme-color"]"#)?;
 if !absent(&meta){attr(&meta,"content",&(if text(theme,"dark"){"#1c1c1c"}else{"#ffffff"}).into())?;}
 Ok(())
}
fn root(host:&JsValue)->R<JsValue>{read(&document(host)?,"documentElement")}
#[wasm_bindgen]
pub fn app_init_theme(host:&JsValue)->R{
 let saved=method(&storage()?,"getItem",&[&"inhouse-read-theme".into()])?;
 let preferred=if absent(&saved){
  let dark=truthy(&read(&method(&global(),"matchMedia",&[&"(prefers-color-scheme: dark)".into()])?,"matches")?);
  JsValue::from_str(if dark{"dark"}else{"light"})
 }else{saved};
 attr(&root(host)?,"data-theme",&preferred)?;
 sync_theme_color(host,&preferred)
}
/// The header's toggle (`toggle`) flips the theme and the settings switch follows it; the switch
/// itself (`switch`) sets the theme it shows.
#[wasm_bindgen]
pub fn app_set_theme(host:&JsValue,source:&str)->R{
 let switch=element(host,"driveThemeToggle")?;
 let next=if source=="switch"{if truthy(&read(&switch,"checked")?){"dark"}else{"light"}}
  else if text(&method(&root(host)?,"getAttribute",&[&"data-theme".into()])?,"dark"){"light"}else{"dark"};
 let next=JsValue::from_str(next);
 attr(&root(host)?,"data-theme",&next)?;
 sync_theme_color(host,&next)?;
 method(&storage()?,"setItem",&[&"inhouse-read-theme".into(),&next])?;
 method(host,"notifyCloudSettingsChanged",&[&"inhouse-read-theme".into()])?;
 if source!="switch"&&truthy(&switch){set(&switch,"checked",&text(&next,"dark").into())?;}
 Ok(())
}

// ---- Screens ----

#[wasm_bindgen]
pub fn app_show_screen(host:&JsValue,name:&JsValue)->R{
 let state=state(host)?;
 let (home,reader)=(text(name,"home"),text(name,"reader"));
 if !reader{
  method(&classes(&body(host)?)?,"remove",&[&"is-reader-focus".into()])?;
  let header=query(host,".app-header")?;
  method(&read(&header,"style")?,"removeProperty",&[&"color-scheme".into()])?;
  Reflect::delete_property(&read(&header,"dataset")?.unchecked_into(),&"readingTheme".into())?;
 }
 method(&classes(&body(host)?)?,"toggle",&[&"is-reading".into(),&reader.into()])?;
 set(&element(host,"homeScreen")?,"hidden",&(!home).into())?;
 set(&element(host,"readerScreen")?,"hidden",&(!reader).into())?;
 method(host,"setShelfWorkActive",&[&home.into()])?;
 let shelf=read(&state,"shelf")?;
 if !absent(&shelf){let present=get(&shelf,"setPresentationActive");if !absent(&present){method(&shelf,"setPresentationActive",&[&home.into()])?;}}
 if home&&truthy(&read(&state,"shelfRefreshDeferred")?)&&!truthy(&read(&state,"closingReader")?){
  catch_with(&method(host,"refreshShelf",&[])?,&WARN_PENDING)?;
 }
 if home&&!same(&read(&state,"shelfLengthStatusVersion")?,&read(&state,"lengthStatusVersion")?){app_schedule_length_refresh(host)?;}
 Ok(())
}
/// `a === b` for the shell's numbers and ids.
fn same(a:&JsValue,b:&JsValue)->bool{a==b}

/// Batch short books: rebuilding the shelf once per completed chapter or library record would
/// spend far more time drawing than counting text.
#[wasm_bindgen]
pub fn app_schedule_length_refresh(host:&JsValue)->R{
 let state=state(host)?;
 if truthy(&read(&state,"appDisposed")?)||document_hidden(host)?||!hidden(&element(host,"readerScreen")?)?||!absent(&read(&state,"lengthRefreshTimer")?){return Ok(())}
 let owner=host.clone();
 let fire=Closure::once_into_js(move|_:JsValue|->R<JsValue>{
  let state=self::state(&owner)?;
  set(&state,"lengthRefreshTimer",&JsValue::NULL)?;
  if !truthy(&read(&state,"appDisposed")?)&&!document_hidden(&owner)?&&hidden(&element(&owner,"readerScreen")?)?{
   catch_with(&method(&owner,"refreshShelf",&[])?,&WARN_REFRESH)?;
  }
  Ok(JsValue::UNDEFINED)
 });
 set(&state,"lengthRefreshTimer",&set_timeout(&fire,80.0)?)
}

/// A shelf busy with a gesture tries again shortly.
#[wasm_bindgen]
pub fn app_retry_room_refresh(host:&JsValue)->R{
 let state=state(host)?;
 if !absent(&read(&state,"roomRefreshRetry")?)||truthy(&read(&state,"appDisposed")?)||document_hidden(host)?{return Ok(())}
 let owner=host.clone();
 let fire=Closure::once_into_js(move|_:JsValue|->R<JsValue>{
  set(&self::state(&owner)?,"roomRefreshRetry",&JsValue::NULL)?;
  method(&owner,"refreshShelf",&[])
 });
 set(&state,"roomRefreshRetry",&set_timeout(&fire,150.0)?)
}

/// Re-rendering a shelf closes its current 3D cover: wait for it to close, then refresh once.
#[wasm_bindgen]
pub fn app_refresh_after_flyout(host:&JsValue)->R{
 let state=state(host)?;
 if truthy(&read(&state,"shelfRefreshQueued")?){return Ok(())}
 set(&state,"shelfRefreshQueued",&JsValue::TRUE)?;
 let owner=host.clone();
 let changed=Closure::<dyn FnMut(JsValue)>::new(move|_:JsValue|{
  let result=(||->R{
   if truthy(&query(&owner,".ihr-flyout")?){return Ok(())}
   let wait=FLYOUT_WAIT.with(|wait|wait.borrow_mut().take());
   if let Some((observer,_closure))=&wait{method(observer,"disconnect",&[])?;}
   set(&self::state(&owner)?,"shelfRefreshQueued",&JsValue::FALSE)?;
   method(&owner,"refreshShelf",&[])?;
   drop(wait);Ok(())
  })();
  if let Err(error)=result{wasm_bindgen::throw_val(error)}
 });
 let constructor=read(&global(),"MutationObserver")?.dyn_into::<Function>()?;
 let observer=Reflect::construct(&constructor,&Array::of1(changed.as_ref()))?;
 method(&observer,"observe",&[&body(host)?,&options(&[("childList",JsValue::TRUE),("subtree",JsValue::TRUE)])?])?;
 FLYOUT_WAIT.with(|wait|*wait.borrow_mut()=Some((observer,changed)));
 Ok(())
}

/// Cloud settings arrived (or another tab changed them): adopt them and refresh the room.
#[wasm_bindgen]
pub fn app_apply_cloud_settings(host:&JsValue,keys:&JsValue)->R{
 let keys=Array::from(keys);
 let mut room=false;let (mut theme,mut preferences,mut streak)=(false,false,false);
 let streak_key=read(host,"STREAK_KEY")?;
 for key in keys.iter(){
  let name=key.as_string().unwrap_or_default();
  if name.starts_with("inhouse-read-shelf-"){room=true}
  if name=="inhouse-read-theme"{theme=true}
  if name=="inhouse-read-reading-preferences"{preferences=true}
  if key==streak_key{streak=true}
 }
 if room{set(&state(host)?,"cloudRoomChanged",&JsValue::TRUE)?;}
 if theme{app_init_theme(host)?;}
 if preferences{method(&read(host,"readingExperience")?,"reloadPreferences",&[])?;}
 if streak{method(&read(host,"readingStreak")?,"reconcile",&[])?;}
 method(host,"refreshShelf",&[])?;Ok(())
}

// ---- The reader's controls ----

/// Hiding the controls only hides them: the header and the toolbar keep their margins (see
/// reading.css), so the page never repaginates or refits. The toolbar's own `hidden` attribute is
/// left to the opening and closing flights.
#[wasm_bindgen]
pub fn app_set_reader_chrome_hidden(host:&JsValue,hidden_now:&JsValue)->R{
 let screen=element(host,"readerScreen")?;
 if hidden(&screen)?||has_class(&screen,"is-preparing")?||has_class(&screen,"is-opening-from-book")?{return Ok(())}
 let focus=truthy(hidden_now);
 method(&classes(&body(host)?)?,"toggle",&[&"is-reader-focus".into(),&focus.into()])?;
 let button=element(host,"readerFocus")?;
 attr(&button,"aria-pressed",&(if focus{"true"}else{"false"}).into())?;
 attr(&button,"aria-label",&(if focus{"Mostrar controles"}else{"Ocultar controles"}).into())?;
 if focus{method(&element(host,"readerViewport")?,"focus",&[&options(&[("preventScroll",JsValue::TRUE)])?])?;}
 Ok(())
}
/// The blank margins left by hidden controls still take taps like the page does: the edges turn
/// pages and the centre brings the controls back. Their buttons are invisible and unreachable, so
/// only a tap on the margin itself lands here. Escape brings the controls back too.
#[wasm_bindgen]
pub fn app_watch_reader_controls(host:&JsValue)->R{
 let button=element(host,"readerFocus")?;
 let owner=host.clone();
 let mut listeners=vec![listen(&button,"click",None,false,move|_|app_set_reader_chrome_hidden(&owner,&JsValue::TRUE))?];
 for margin in [query(host,".app-header")?,element(host,"readerToolbar")?]{
  let (owner,node)=(host.clone(),margin.clone());
  listeners.push(listen(&margin,"click",None,false,move|event|{
   if read(&event,"target")?!=node||!has_class(&body(&owner)?,"is-reader-focus")?{return Ok(())}
   let bounds=method(&node,"getBoundingClientRect",&[])?;
   let x=num(&read(&event,"clientX")?)-num(&read(&bounds,"left")?);
   let zone=method(&owner,"classifyTapZone",&[&x.into(),&read(&bounds,"width")?])?;
   if text(&zone,"center"){return app_set_reader_chrome_hidden(&owner,&JsValue::FALSE)}
   // `(zone === ZONE.NEXT) !== reader.rtl`: anything but a boolean differs from both answers.
   let forward=match read(&read(&owner,"reader")?,"rtl")?.as_bool(){Some(rtl)=>text(&zone,"next")!=rtl,None=>true};
   method(&read(&owner,"readingExperience")?,"step",&[&(if forward{1.0}else{-1.0}).into()])?;Ok(())
  })?);
 }
 let owner=host.clone();
 listeners.push(listen(&document(host)?,"keydown",None,false,move|event|{
  if !text(&read(&event,"key")?,"Escape")||!has_class(&body(&owner)?,"is-reader-focus")?{return Ok(())}
  if truthy(&read(&read(&read(&owner,"readingExperience")?,"panel")?,"open")?){return Ok(())}
  app_set_reader_chrome_hidden(&owner,&JsValue::FALSE)?;
  method(&element(&owner,"readerFocus")?,"focus",&[&options(&[("preventScroll",JsValue::TRUE)])?])?;
  method(&event,"preventDefault",&[])?;Ok(())
 })?);
 LISTENERS.with(|all|all.borrow_mut().extend(listeners));
 Ok(())
}

/// A resized window, a rotated phone, the reading settings or the theme change the page's pixels
/// and layout: the page prepared for a lifted book no longer holds.
#[wasm_bindgen]
pub fn app_watch_prepared_pages(host:&JsValue)->R{
 let pages=read(host,"preparedPages")?;
 let invalidate=move|pages:&JsValue,reason:&str|->R{method(pages,"invalidate",&[&reason.into()])?;Ok(())};
 let p=pages.clone();
 let mut listeners=vec![listen(&global(),"resize",None,false,move|_|invalidate(&p,"resize"))?];
 let within=|event:&JsValue,selector:&str|->R<bool>{
  let target=read(event,"target")?;
  let closest=get(&target,"closest");
  if absent(&closest){return Ok(false)}
  Ok(truthy(&method(&target,"closest",&[&selector.into()])?))
 };
 // Settings can change while a lifted book still owns the hidden reader.
 let p=pages.clone();
 listeners.push(listen(&document(host)?,"change",None,false,move|event|{if within(&event,".reading-panel [data-pref]")?{invalidate(&p,"preferences")?}Ok(())})?);
 let p=pages.clone();
 listeners.push(listen(&document(host)?,"click",None,false,move|event|{
  if within(&event,".reading-panel [data-theme], .reading-panel [data-size-step], .reading-panel [data-reset]")?{invalidate(&p,"preferences")?}Ok(())
 })?);
 LISTENERS.with(|all|all.borrow_mut().extend(listeners));
 let observe=|constructor:&str,callback:Closure<dyn FnMut(JsValue)>,target:&JsValue,init:Option<JsValue>|->R{
  let constructor=read(&global(),constructor)?.dyn_into::<Function>()?;
  let observer=Reflect::construct(&constructor,&Array::of1(callback.as_ref()))?;
  match init{Some(init)=>method(&observer,"observe",&[target,&init])?,None=>method(&observer,"observe",&[target])?};
  callback.forget();Ok(())
 };
 let p=pages.clone();
 observe("MutationObserver",Closure::new(move|_:JsValue|{if let Err(error)=invalidate(&p,"theme"){wasm_bindgen::throw_val(error)}}),&root(host)?,
  Some(options(&[("attributes",JsValue::TRUE),("attributeFilter",Array::of1(&"data-theme".into()).into())])?))?;
 if get(&global(),"ResizeObserver").is_function(){
  let viewport=element(host,"readerViewport")?;
  let (node,box_key)=(viewport.clone(),RefCell::new(None::<String>));
  observe("ResizeObserver",Closure::new(move|_:JsValue|{
   let result=(||->R{
    let bounds=method(&node,"getBoundingClientRect",&[])?;
    let key=format!("{}x{}",crate::host::text_of(&read(&bounds,"width")?),crate::host::text_of(&read(&bounds,"height")?));
    let previous=box_key.replace(Some(key.clone()));
    if previous.is_some_and(|previous|previous!=key){invalidate(&pages,"viewport")?}
    Ok(())
   })();
   if let Err(error)=result{wasm_bindgen::throw_val(error)}
  }),&viewport,None)?;
 }
 Ok(())
}

// ---- Opening a file ----

/// The reader's loading state around one file: the newest load owns the controls.
#[wasm_bindgen]
pub fn app_open_file(host:JsValue,file:JsValue,options_in:JsValue)->Promise{start(async move{
 let state=state(&host)?;
 let generation=num(&read(&state,"readerLoadGeneration")?)+1.0;
 set(&state,"readerLoadGeneration",&generation.into())?;
 let loading=by_id(&host,"reader-loading")?;
 let actions=query(&host,".reader-heading-actions")?;
 let screen=element(&host,"readerScreen")?;
 set(&element(&host,"readerToolbar")?,"hidden",&JsValue::TRUE)?;
 attr(&screen,"aria-busy",&"true".into())?;
 set(&actions,"inert",&JsValue::TRUE)?;
 let options_in=if absent(&options_in){Object::new().into()}else{options_in};
 set(&loading,"hidden",&(truthy(&read(&options_in,"transition")?)||truthy(&read(&options_in,"preparing")?)).into())?;
 let result=open_file_content(&host,&file,&options_in).await;
 if num(&read(&state,"readerLoadGeneration")?)==generation{
  set(&loading,"hidden",&JsValue::TRUE)?;
  set(&actions,"inert",&JsValue::FALSE)?;
  attr(&screen,"aria-busy",&"false".into())?;
 }
 result
})}
async fn open_file_content(host:&JsValue,file:&JsValue,given:&JsValue)->R<JsValue>{
 // A failed native download must remain reportable before Rust exists.
 if let Err(cause)=settle(method(&read(host,"readingExperience")?,"ready",&[])).await{
  return Err(cloud_host::error_with_cause("No se pudo cargar el lector. Comprueba la conexión e inténtalo de nuevo.",cause));
 }
 let flag=|key:&str|->R<JsValue>{let value=read(given,key)?;Ok(if value.is_undefined(){JsValue::FALSE}else{value})};
 let chosen=options(&[("existingRecord",read(given,"existingRecord")?),("forcedId",read(given,"forcedId")?),
  ("folderFileName",read(given,"folderFileName")?),("transition",read(given,"transition")?),("preparing",flag("preparing")?),
  ("restoreRemoved",flag("restoreRemoved")?),("onImportReady",read(given,"onImportReady")?),("reuseStoredContent",flag("reuseStoredContent")?)])?;
 settle(method(host,"openFileContent",&[file,&chosen])).await
}

/// The file picker's choice: a known book reopened under its own id, or a new one kept on the device.
#[wasm_bindgen]
pub fn app_file_picked(host:JsValue)->Promise{start(async move{
 let picker=element(&host,"filePicker")?;
 let files=read(&picker,"files")?;
 let file=if absent(&files){JsValue::UNDEFINED}else{crate::host::get_at(&files,0)};
 set(&picker,"value",&"".into())?;
 if !truthy(&file){return Ok(JsValue::UNDEFINED)}
 let state=state(&host)?;
 // Reopening a known book (the fallback above): it is not saved to the folder again, only opened
 // under the same id. IndexedDB keeps the original bytes on this device otherwise.
 let options_out=if truthy(&read(&state,"pendingLocalReopenId")?){
  let forced=read(&state,"pendingLocalReopenId")?;set(&state,"pendingLocalReopenId",&JsValue::NULL)?;
  let transition=read(&state,"pendingReaderTransition")?;set(&state,"pendingReaderTransition",&JsValue::NULL)?;
  options(&[("forcedId",forced),("transition",transition)])?
 }else{options(&[("restoreRemoved",JsValue::TRUE)])?};
 if let Err(error)=settle(method(&host,"openFile",&[&file,&options_out])).await{
  method(&global(),"alert",&[&read(&error,"message")?])?;
 }
 Ok(JsValue::UNDEFINED)
})}

// ---- Google Drive ----

#[wasm_bindgen]
pub fn app_open_drive_modal(host:JsValue)->Promise{
 if let Err(error)=element(&host,"driveModal").and_then(|modal|set(&modal,"hidden",&JsValue::FALSE)){return Promise::reject(&error)}
 load_drive_files(host)
}
fn load_drive_files(host:JsValue)->Promise{start(async move{
 let status=element(&host,"driveStatus")?;let list=element(&host,"driveList")?;
 set(&status,"textContent",&"Conectando con Drive…".into())?;
 set(&list,"innerHTML",&"".into())?;
 DRIVE_ITEMS.with(|items|items.borrow_mut().clear());
 let listed=async{
  if !truthy(&method(&host,"hasDriveSession",&[])?){settle(method(&host,"requestDriveAccess",&[])).await?;}
  settle(method(&host,"loadDriveAccountProfile",&[])).await?;
  let files=Array::from(&settle(method(&host,"listAllDriveBooks",&[])).await?);
  set(&status,"textContent",&(if files.length()>0{""}else{"Sin libros en Drive."}).into())?;
  for file in files.iter(){
   let item=method(&document(&host)?,"createElement",&[&"button".into()])?;
   set(&item,"type",&"button".into())?;
   set(&item,"className",&"drive-item".into())?;
   set(&item,"textContent",&read(&file,"name")?)?;
   let (owner,chosen)=(host.clone(),file.clone());
   let listener=listen(&item,"click",None,false,move|_|{let _=open_drive_file(owner.clone(),chosen.clone());Ok(())})?;
   DRIVE_ITEMS.with(|items|items.borrow_mut().push(listener));
   method(&list,"append",&[&item])?;
  }
  let sync=method(&host,"syncLibraryToDrive",&[&options(&[("silent",JsValue::TRUE)])?])?;
  let owner=host.clone();
  let failed=Closure::once_into_js(move|error:JsValue|->R<JsValue>{
   method(&owner,"setDriveSyncStatus",&[&format!("No se pudo sincronizar: {}",crate::host::text_of(&read(&error,"message")?)).into()])?;
   WARN_SYNC.with(|warn|warn.call1(&JsValue::UNDEFINED,&error))
  });
  method(&sync,"catch",&[&failed])?;
  Ok::<(),JsValue>(())
 }.await;
 if let Err(error)=listed{
  let outdated=!absent(&error)&&text(&get(&error,"code"),"ANDROID_SHELL_OUTDATED");
  if outdated&&truthy(&settle(method(&host,"offerAvailableAndroidUpdate",&[])).await?){
   set(&element(&host,"driveModal")?,"hidden",&JsValue::TRUE)?;
  }else{
   let message=if outdated{"Drive aún no está disponible en Android. Usa la web.".to_owned()}
    else{format!("No se pudo conectar con Drive: {}",crate::host::text_of(&read(&error,"message")?))};
   set(&status,"textContent",&message.into())?;
  }
 }
 Ok(JsValue::UNDEFINED)
})}
fn open_drive_file(host:JsValue,file:JsValue)->Promise{start(async move{
 set(&element(&host,"driveModal")?,"hidden",&JsValue::TRUE)?;
 let opened=async{
  let library=read(&host,"library")?;
  let all=Array::from(&settle(method(&library,"listAll",&[])).await?);
  let id=read(&file,"id")?;
  let found=all.iter().find(|book|get(book,"driveFileId")==id);
  let record=match found{Some(record)=>record,None=>{
   let profile=read(&state(&host)?,"driveProfile")?;
   let size=num(&read(&file,"size")?);
   let checksum=read(&file,"md5Checksum")?;
   let name=read(&file,"name")?;
   let fields=options(&[("sourceType","drive".into()),("driveFileId",id.clone()),("cloudAccountId",if absent(&profile){JsValue::UNDEFINED}else{read(&profile,"id")?}),
    ("name",name.clone()),("title",method(&host,"normalizeBookTitle",&[&name])?),("mimeType",read(&file,"mimeType")?),
    ("size",(if size.is_nan()||size==0.0{0.0}else{size}).into()),("driveContentChecksum",if truthy(&checksum){checksum}else{JsValue::NULL})])?;
   settle(method(&library,"addOrTouch",&[&fields,&options(&[("restoreRemoved",JsValue::TRUE)])?])).await?
  }};
  let cloud=read(&host,"cloudSync")?;
  let local=settle(method(&cloud,"downloadForOffline",&[&record])).await?;
  if !truthy(&local){return Ok(())}
  if let Err(error)=settle(method(&cloud,"syncBookProgress",&[&read(&record,"id")?])).await{
   web_sys::console::warn_2(&"No se pudo recuperar el progreso de Drive; se abrirá la copia descargada:".into(),&error);
  }
  let latest=settle(method(&library,"get",&[&read(&record,"id")?])).await?;
  if !truthy(&latest){return Ok(())}
  let chosen=options(&[("existingRecord",latest.clone()),("forcedId",read(&latest,"id")?),("reuseStoredContent",JsValue::TRUE)])?;
  settle(method(&host,"openFile",&[&local,&chosen])).await?;Ok(())
 }.await;
 if let Err(error)=opened{
  method(&global(),"alert",&[&format!("No se pudo abrir el libro: {}",crate::host::text_of(&read(&error,"message")?)).into()])?;
 }
 Ok(JsValue::UNDEFINED)
})}

#[wasm_bindgen]
pub fn app_show_auth_notice(host:&JsValue,message:&JsValue,given:&JsValue)->R{
 let given=if absent(given){Object::new().into()}else{given.clone()};
 let (retry,pending)=(truthy(&read(&given,"retry")?),truthy(&read(&given,"pending")?));
 set(&read(host,"authMessage")?,"textContent",message)?;
 set(&read(host,"authNotice")?,"hidden",&(!truthy(message)).into())?;
 set(&read(host,"authRetry")?,"hidden",&(!retry).into())?;
 set(&read(host,"authCancel")?,"hidden",&(!pending).into())?;
 Ok(())
}

// ---- Start-up ----

/// The header as the app starts: theme, its switch, the published version and the Drive button.
#[wasm_bindgen]
pub fn app_start_shell(host:&JsValue)->R{
 app_init_theme(host)?;
 let dark=text(&method(&root(host)?,"getAttribute",&[&"data-theme".into()])?,"dark");
 set(&element(host,"driveThemeToggle")?,"checked",&dark.into())?;
 // The published version, from package.json: it changes with every release.
 set(&element(host,"appVersion")?,"textContent",&format!("Inhouse Read · v{}",crate::host::text_of(&read(host,"APP_VERSION")?)).into())?;
 let drive=element(host,"addDriveBtn")?;
 set(&drive,"disabled",&(!truthy(&method(host,"isDriveConfigured",&[])?)).into())?;
 set(&drive,"title",&(if truthy(&method(host,"isDriveConfigured",&[])?){""}else{"Drive no disponible"}).into())?;
 app_show_screen(host,&"home".into())
}
