//! Root account and cover actions. Futures preserve the synchronous gesture prefix,
//! upload ownership and finally cleanup; library/Drive/DOM objects stay host handles.
use wasm_bindgen::prelude::*;
use js_sys::{Array, Object, Promise};
use crate::host::{read,get,method,set,truthy,absent,num,jmax};
use crate::cloud_host::{self,settle,start,object,string,error};
type R<T=()> = Result<T,JsValue>;
fn state(host:&JsValue)->R<JsValue>{read(host,"state")}
fn member(host:&JsValue,name:&str,method_name:&str,args:&[&JsValue])->R<JsValue>{method(&read(host,name)?,method_name,args)}
fn status(host:&JsValue,message:impl Into<JsValue>)->R{method(host,"setDriveSyncStatus",&[&message.into()])?;Ok(())}
fn notice(host:&JsValue,message:impl Into<JsValue>,options:JsValue)->R{method(host,"showAuthNotice",&[&message.into(),&options])?;Ok(())}
fn class_has(element:&JsValue,class:&str)->R<bool>{Ok(truthy(&member(element,"classList","contains",&[&class.into()])?))}
fn attr(element:&JsValue,name:&str,value:&str)->R{method(element,"setAttribute",&[&name.into(),&value.into()])?;Ok(())}
fn element(host:&JsValue,name:&str)->R<JsValue>{read(&read(host,"els")?,name)}
fn reset_account(host:&JsValue)->R{
 member(host,"liveRoom","pause",&[])?;member(host,"libraryBackup","reset",&[])?;member(host,"cloudSync","reset",&[])?;Ok(())
}

#[wasm_bindgen]
pub fn app_drive_upload(host:JsValue,book:JsValue)->Promise{start(async move{
 let state=state(&host)?;set(&state,"driveUploadsInFlight",&(num(&read(&state,"driveUploadsInFlight")?)+1.0).into())?;
 let result=async{
  let updated=settle(member(&host,"cloudSync","uploadBook",&[&book])).await?;
  if !truthy(&updated){return Ok(JsValue::NULL);}
  // Background progress must not hold the cover open behind a network request.
  let progress=member(&host,"cloudSync","flushProgress",&[&read(&updated,"id")?])?;
  method(&progress,"catch",&[&read(&host,"uploadProgressFailure")?])?;
  status(&host,"Guardado en Google Drive")?;Ok(updated)
 }.await;
 let count=jmax(0.0,num(&read(&state,"driveUploadsInFlight")?)-1.0);
 set(&state,"driveUploadsInFlight",&count.into())?;
 if count==0.0{let screen=element(&host,"driveUploadScreen")?;set(&screen,"hidden",&JsValue::TRUE)?;attr(&screen,"aria-busy","false")?;}
 result
})}
fn cover_label(button:&JsValue,labels:&Array,long:&str,short:&str)->R{
 for label in labels.iter(){set(&label,"textContent",&if class_has(&label,"ihr-btn__label--short")?{short}else{long}.into())?;}
 attr(button,"aria-label",long)?;if class_has(button,"ihr-btn--icon")?{set(button,"title",&long.into())?;}Ok(())
}
fn restore_label(button:&JsValue,labels:&Array,originals:&Array,aria:&JsValue)->R{
 for (index,label) in labels.iter().enumerate(){set(&label,"textContent",&originals.get(index as u32))?;}
 if truthy(aria){method(button,"setAttribute",&[&"aria-label".into(),aria])?;}else{method(button,"removeAttribute",&[&"aria-label".into()])?;}
 if truthy(aria)&&class_has(button,"ihr-btn--icon")?{set(button,"title",aria)?;}Ok(())
}
fn saved_button(host:&JsValue,button:&JsValue)->R{
 let document=read(host,"document")?;let saved=method(&document,"createElement",&[&"span".into()])?;
 set(&saved,"className",&"ihr-btn ihr-btn--quiet ihr-btn--icon ihr-flyout__cloud-saved".into())?;
 attr(&saved,"role","status")?;attr(&saved,"aria-label","Guardado en Google Drive")?;
 set(&saved,"title",&"Guardado en Google Drive".into())?;
 let icon=method(button,"querySelector",&[&"svg".into()])?;
 if !absent(&icon){method(&saved,"append",&[&method(&icon,"cloneNode",&[&JsValue::TRUE])?])?;}
 let check=method(&document,"createElement",&[&"span".into()])?;
 set(&check,"className",&"ihr-flyout__cloud-check".into())?;attr(&check,"aria-hidden","true")?;
 set(&check,"innerHTML",&read(host,"savedCheckMarkup")?)?;
 method(&saved,"append",&[&check])?;method(button,"replaceWith",&[&saved])?;Ok(())
}
#[wasm_bindgen]
pub fn app_drive_cover_action(host:JsValue,action:JsValue,book:JsValue,button:JsValue)->Promise{start(async move{
 set(&button,"disabled",&JsValue::TRUE)?;
 let labels=if class_has(&button,"ihr-btn--icon")?{Array::new()}else{
  let found=Array::from(&method(&button,"querySelectorAll",&[&"span".into()])?);
  if found.length()>0{Array::from(&method(&button,"querySelectorAll",&[&"span".into()])?)}else{Array::of1(&button)}
 };
 let originals=Array::new();for label in labels.iter(){originals.push(&read(&label,"textContent")?);}
 let aria=method(&button,"getAttribute",&[&"aria-label".into()])?;
 let offline=action==JsValue::from_str("offline");
 cover_label(&button,&labels,if offline{"Descargando…"}else{"Guardando…"},if offline{"Offline…"}else{"Drive…"})?;
 attr(&button,"aria-busy","true")?;
 let result: R<bool>=async{
  if offline{
   if truthy(&read(&book,"content")?){cover_label(&button,&labels,"Disponible offline","Offline")?;return Ok(true);}
   if !truthy(&method(&host,"hasDriveSession",&[])?) {settle(method(&host,"requestDriveAccess",&[])).await?;}
   if truthy(&read(&book,"driveFileId")?){settle(member(&host,"cloudSync","downloadForOffline",&[&book])).await?;}
   else{return Err(error("Este libro ya tiene su copia en el dispositivo."));}
   cover_label(&button,&labels,"Disponible offline","Offline")?;return Ok(true);
  }else if action==JsValue::from_str("drive"){
   if !truthy(&method(&host,"hasDriveSession",&[])?) {return Err(error("Conecta tu cuenta de Google para subir este libro."));}
   let updated=settle(Ok(app_drive_upload(host.clone(),book.clone()).into())).await?;
   if !truthy(&updated){return Ok(false);}
   cloud_host::assign(&book,&updated)?;saved_button(&host,&button)?;return Ok(true);
  }
  Ok(false)
 }.await;
 let (saved,result)=match result{
  Ok(saved)=>(saved,Ok(JsValue::UNDEFINED)),
  Err(failure)=>(false,async{
   restore_label(&button,&labels,&originals,&aria)?;
   settle(Ok(app_drive_report_error(host.clone(),failure).into())).await?;Ok(JsValue::UNDEFINED)
  }.await)
 };
 set(&button,"disabled",&saved.into())?;method(&button,"removeAttribute",&[&"aria-busy".into()])?;result
})}

#[wasm_bindgen]
pub fn app_drive_load_profile(host:JsValue)->Promise{start(async move{
 let state=state(&host)?;
 if !truthy(&method(&host,"hasDriveSession",&[])?) {
  set(&state,"driveProfile",&JsValue::NULL)?;member(&host,"cloudSync","reset",&[])?;
  member(&host,"liveRoom","pause",&[])?;member(&host,"libraryBackup","reset",&[])?;
  member(&host,"profileView","visibility",&[&JsValue::FALSE])?;member(&host,"profileView","localAccount",&[])?;
  return Ok(JsValue::NULL);
 }
 member(&host,"profileView","visibility",&[&JsValue::TRUE])?;
 let previous=get(&read(&state,"driveProfile")?,"id");
 match settle(method(&host,"getDriveProfile",&[])).await{
  Ok(profile)=>set(&state,"driveProfile",&profile)?,
  Err(failure)=>{
   member(&host,"console","warn",&[&"No se pudo cargar el perfil de Google:".into(),&failure])?;
   if !truthy(&method(&host,"hasDriveSession",&[])?) {return settle(Ok(app_drive_load_profile(host.clone()).into())).await;}
   set(&state,"driveProfile",&method(&host,"getRememberedDriveProfile",&[])?)?;
   if !truthy(&get(&read(&state,"driveProfile")?,"id")){return Err(error("No se pudo identificar la cuenta de Google. Vuelve a conectar."));}
   status(&host,format!("Perfil guardado · {}",string(&read(&failure,"message")?)))?;
  }
 }
 let profile=read(&state,"driveProfile")?;
 if truthy(&previous)&&previous!=get(&profile,"id"){reset_account(&host)?;}
 member(&host,"cloudSync","setProfile",&[&profile])?;member(&host,"profileView","account",&[&profile])?;
 read(&state,"driveProfile")
})}
#[wasm_bindgen]
pub fn app_drive_sync(host:JsValue,options:JsValue)->Promise{start(async move{
 let options=if options.is_undefined(){Object::new().into()}else{options};
 let silent=truthy(&read(&options,"silent")?);let poll=truthy(&read(&options,"poll")?);
 if !truthy(&method(&host,"hasDriveSession",&[])?) {
  if silent{
   if !truthy(&method(&host,"isAndroidShell",&[])?)||!truthy(&method(&host,"getRememberedDriveProfile",&[])?) {return Ok(JsValue::UNDEFINED);}
   if settle(method(&host,"requestDriveAccess",&[&object(&[("interactive",JsValue::FALSE)])])).await.is_err(){return Ok(JsValue::UNDEFINED);}
  }else{settle(method(&host,"requestDriveAccess",&[])).await?;}
 }
 let known=read(&state(&host)?,"driveProfile")?;
 let profile=if truthy(&known){known}else{settle(Ok(app_drive_load_profile(host.clone()).into())).await?};
 if !truthy(&profile){if silent{return Ok(JsValue::UNDEFINED);}return Err(error("Sesión caducada. Pulsa Conectar."));}
 if !poll{if let Err(failure)=settle(method(&host,"restoreLegacyBookBytes",&[&read(&host,"library")?])).await{
  member(&host,"console","warn",&[&"No se pudieron recuperar libros antiguos de la carpeta local:".into(),&failure])?;
 }}
 settle(member(&host,"libraryBackup",if poll{"poll"}else{"sync"},&[&read(&profile,"id")?])).await
})}
#[wasm_bindgen]
pub fn app_drive_report_error(host:JsValue,failure:JsValue)->Promise{start(async move{
 if get(&failure,"code")==JsValue::from_str("ANDROID_SHELL_OUTDATED"){
  if truthy(&settle(method(&host,"offerAvailableAndroidUpdate",&[])).await?){return Ok(JsValue::UNDEFINED);}
  notice(&host,"Actualiza la app para conectar Drive.",object(&[("retry",JsValue::TRUE)]))?;
 }else{
  let message=read(&failure,"message")?;
  let message=if message==JsValue::from_str("Conexión cancelada."){String::new()}else{format!("No se pudo conectar. {}",string(&message))};
  notice(&host,message,object(&[("retry",JsValue::TRUE)]))?;
 }
 Ok(JsValue::UNDEFINED)
})}
#[wasm_bindgen]
pub fn app_drive_connect(host:JsValue)->Promise{start(async move{
 method(&host,"closeProfileMenu",&[])?;let button=element(&host,"driveConnectBtn")?;set(&button,"disabled",&JsValue::TRUE)?;
 notice(&host,"Completa el acceso en Google.",object(&[("pending",JsValue::TRUE)]))?;
 let result=async{
  settle(method(&host,"requestDriveAccess",&[])).await?;
  notice(&host,"",JsValue::UNDEFINED)?;
  settle(Ok(app_drive_sync(host.clone(),JsValue::UNDEFINED).into())).await?;Ok(JsValue::UNDEFINED)
 }.await;
 let result=match result{Ok(value)=>Ok(value),Err(failure)=>settle(Ok(app_drive_report_error(host.clone(),failure).into())).await};
 set(&button,"disabled",&JsValue::FALSE)?;result
})}

#[wasm_bindgen]
pub fn app_drive_cancel(host:&JsValue)->R{
 method(host,"cancelDriveConnection",&[])?;notice(host,"",JsValue::UNDEFINED)
}
#[wasm_bindgen]
pub fn app_drive_auth_event(host:JsValue,detail:JsValue)->R{
 if truthy(&read(&detail,"connected")?){
  notice(&host,"",JsValue::UNDEFINED)?;
  let task=app_drive_sync(host.clone(),JsValue::UNDEFINED);
  method(&task,"catch",&[&read(&host,"authFailure")?])?;
 }else{let failure=read(&detail,"error")?;if truthy(&failure){notice(&host,failure,object(&[("retry",JsValue::TRUE)]))?;}}
 Ok(())
}
#[wasm_bindgen]
pub fn app_drive_manual_sync(host:JsValue)->Promise{start(async move{
 let button=element(&host,"driveSyncBtn")?;set(&button,"disabled",&JsValue::TRUE)?;
 let result=match settle(Ok(app_drive_sync(host.clone(),JsValue::UNDEFINED).into())).await{
  Ok(_)=>Ok(()),Err(failure)=>(||->R{status(&host,format!("No se pudo sincronizar: {}",string(&read(&failure,"message")?)))})()
 };
 set(&button,"disabled",&JsValue::FALSE)?;result?;Ok(JsValue::UNDEFINED)
})}
#[wasm_bindgen]
pub fn app_drive_sign_out(host:JsValue)->R{
 method(&host,"signOutDrive",&[])?;member(&host,"cloudSync","reset",&[])?;
 member(&host,"liveRoom","pause",&[])?;member(&host,"libraryBackup","reset",&[])?;
 set(&state(&host)?,"driveProfile",&JsValue::NULL)?;method(&host,"closeProfileMenu",&[])?;
 let _=app_drive_load_profile(host.clone());notice(&host,"",JsValue::UNDEFINED)?;
 attr(&element(&host,"driveProfileBtn")?,"aria-expanded","false")?;
 method(&host,"refreshShelf",&[])?;Ok(())
}
#[wasm_bindgen]
pub fn app_drive_resume(host:JsValue,options:JsValue)->R{
 let options=if options.is_undefined(){Object::new().into()}else{options};
 let poll=read(&options,"poll")?;let poll=if poll.is_undefined(){JsValue::FALSE}else{poll};
 member(&host,"liveRoom","resume",&[])?;
 if !truthy(&method(&host,"online",&[])?)||(!truthy(&method(&host,"hasDriveSession",&[])?)&&!truthy(&method(&host,"getRememberedDriveProfile",&[])?) ) {return Ok(());}
 let task=app_drive_sync(host.clone(),object(&[("silent",JsValue::TRUE),("poll",poll)]));
 let pending=method(&task,"then",&[&read(&host,"resumeReady")?])?;
 method(&pending,"catch",&[&read(&host,"resumeFailure")?])?;Ok(())
}
// Callback functions that may never run remain JS-owned, so a successful
// Promise cannot retain a Rust once-closure and its entire app host forever.
#[wasm_bindgen]
pub fn app_drive_upload_progress_failure(host:&JsValue,failure:JsValue)->R{
 status(host,format!("Progreso pendiente: {}",string(&read(&failure,"message")?)))
}
#[wasm_bindgen]
pub fn app_drive_resume_ready(host:&JsValue)->R<JsValue>{
 if truthy(&read(&state(host)?,"cloudRoomChanged")?){method(host,"refreshShelf",&[])}else{Ok(JsValue::UNDEFINED)}
}
#[wasm_bindgen]
pub fn app_drive_resume_failure(host:&JsValue,failure:JsValue)->R{
 status(host,format!("Sincronización pendiente: {}",string(&read(&failure,"message")?)))
}
