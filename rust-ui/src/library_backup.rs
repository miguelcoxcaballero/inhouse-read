//! Field-level last-write-wins registers, in a separate manifest per device. An empty installation
//! contributes no deletions. Explicit removals are retained as tombstones, and edits to different
//! books/fields survive concurrent syncs. Records, Drive, the checkpoint store and localStorage stay
//! behind host callbacks.
//! `host`: `{library, cloud, storage, onSettings, onChange, onStatus, withLock, randomUUID,
//! settings, readDriveLibrarySnapshots, writeDriveLibrarySnapshot, uploadDriveCover, downloadDriveFile,
//! readBackupCheckpoint, saveBackupCheckpoint, spineCustomization}`.
use std::{cell::{Cell,RefCell},rc::Rc};
use wasm_bindgen::prelude::*;
use js_sys::{Array,Map,Object,Promise,Set};
use std::collections::BTreeMap;
#[path="library_backup_live.rs"]mod live;
use crate::cloud_host::*;

const META:[&str;23]=["name","title","author","format","mimeType","size","sizeBytes","pageCount","shelfOrder","addedAt","lastOpenedAt","shelfVisualId",
 "coverAppearance","coverAppearanceKey","coverUpdatedAt","driveContentChecksum",
 "progressFraction","locator","progressUpdatedAt","readingHistory","bookmarks","quotes","bookLength"];
const DEVICE_KEY:&str="inhouse-read-backup-device";
const CHANGES_KEY:&str="inhouse-read-backup-settings-changes";
const UNSAFE:[&str;3]=["__proto__","constructor","prototype"];

struct Core{
 host:JsValue,library:JsValue,cloud:JsValue,storage:JsValue,device:JsValue,settings:Vec<String>,
 generation:Cell<f64>,task:RefCell<Option<Promise>>,revision:RefCell<Option<(JsValue,JsValue)>>,
 live_task:RefCell<Option<Promise>>,hot:RefCell<Option<JsValue>>,live_inbox:RefCell<Option<JsValue>>,live_account:RefCell<Option<JsValue>>,
 dirty_books:Map,dirty_settings:Set,room_revision:Cell<u64>,local_sequence:Cell<u64>,room_fields:RefCell<BTreeMap<(String,String),u64>>,
}

fn blank()->JsValue{Object::new().into()}
fn slot(target:&JsValue,key:&str)->JsValue{
 // `target[key] ||= {}`
 let existing=get(target,key);if existing.is_truthy(){return existing;}
 let created=blank();set(target,key,&created);created
}
/// `a` supersedes `b`: later, or the same instant from the greater device id (UTF-16 order).
fn newer(a:&JsValue,b:&JsValue)->bool{
 if !b.is_truthy(){return true;}
 let (at_a,at_b)=(get(a,"at"),get(b,"at"));
 at_a.gt(&at_b)||(at_a==at_b&&get(a,"device").gt(&get(b,"device")))
}
fn merge_fields(target:&JsValue,source:&JsValue){
 let source=if source.is_truthy(){source.clone()}else{blank()};
 for (field,entry) in entries(&source){
  if UNSAFE.contains(&field.as_str()){continue;}
  if !entry.is_truthy()||!get(&entry,"at").as_f64().is_some_and(f64::is_finite)||!get(&entry,"device").is_string()||!has_own(&entry,"value"){continue;}
  if newer(&entry,&get(target,&field)){set(target,&field,&entry);}
 }
}

impl Core{
 fn guard(&self,generation:f64)->Result<(),JsValue>{
  if generation!=self.generation.get(){Err(error("La cuenta de Google ha cambiado."))}else{Ok(())}
 }
 fn cloud(&self,name:&str,args:&[&JsValue])->Result<JsValue,JsValue>{call(&self.cloud,name,args)}
 fn status(&self,message:&str,syncing:bool)->Result<(),JsValue>{
  if syncing{call(&self.host,"onStatus",&[&message.into(),&JsValue::TRUE])?;}else{call(&self.host,"onStatus",&[&message.into()])?;}Ok(())
 }
 /// The fields the backup keeps for a book, plus the cover appearance.
 fn metadata(&self,book:&JsValue)->Result<JsValue,JsValue>{
  let result=blank();assign(&result,&call(&self.host,"spineCustomization",&[book])?)?;
  for key in META{let value=get(book,key);if !value.is_undefined(){set(&result,key,&value);}}
  let length=crate::length_metadata::length_drive_metadata(book.clone())?;
  if length.is_truthy(){set(&result,"bookLength",&length);}
  if !get(&result,"shelfVisualId").is_string()||!get(&result,"shelfVisualId").is_truthy(){
   delete(&result,"shelfVisualId");if get(book,"id").is_string()&&get(book,"id").is_truthy(){set(&result,"shelfVisualId",&get(book,"id"));}
  }
  Ok(result)
 }
 /// `JSON.parse(storage.getItem(key)) ?? fallback`, the fallback on any failure.
 fn parse_stored(&self,key:&str)->JsValue{
  let read=||->Result<JsValue,JsValue>{parse(&call(&self.storage,"getItem",&[&key.into()])?)};
  match read(){Ok(value) if !nullish(&value)=>value,_=>blank()}
 }
 /// A new register, or `old` when it already holds this value.
 fn stamp(&self,old:&JsValue,value:&JsValue,at:&JsValue)->Result<JsValue,JsValue>{
  if old.is_truthy()&&json(&get(old,"value"))?==json(value)?{return Ok(old.clone());}
  let at=if at.is_undefined(){js_sys::Date::now().into()}else{at.clone()};let at=&at;
  let previous=get(old,"at");let floor=(if previous.is_truthy(){number(&previous)}else{0.0})+1.0;
  Ok(object(&[("value",value.clone()),("at",js_sys::Math::max(number(at),floor).into()),("device",self.device.clone())]))
 }

 fn setting_stamp(&self,key:&str,old:&JsValue,value:&JsValue,at:&JsValue)->Result<JsValue,JsValue>{
  if key==crate::room_physics_sync::KEY&&old.is_truthy()&&crate::room_physics_sync::room_physics_equivalent(get(old,"value"),value.clone()){return Ok(old.clone());}
  self.stamp(old,value,at)
 }
 fn sync(self:Rc<Self>,account_id:JsValue)->Promise{
  *self.live_account.borrow_mut()=Some(account_id.clone());
  let task=self.live_task.borrow().clone().or_else(||self.task.borrow().clone());
  if let Some(task)=task{
   let generation=self.generation.get();let core=self.clone();
   let again=Closure::once_into_js(move||->JsValue{if generation==core.generation.get(){core.sync(account_id).into()}else{JsValue::UNDEFINED}});
   return call(&task,"then",&[&again]).expect("Promise.prototype.then exists").into();
  }
  let generation=self.generation.get();
  let core=self.clone();let account=account_id.clone();
  let run=Closure::once_into_js(move||->Result<JsValue,JsValue>{core.guard(generation)?;Ok(core.clone().run(account,generation).into())});
  let locked=call(&self.host,"withLock",&[&format!("inhouse-read-drive:{}",string(&account_id)).into(),&run]);
  let locked=match locked{Ok(value)=>value,Err(error)=>return Promise::reject(&error)};
  let cell:Rc<RefCell<Option<Promise>>>=Rc::new(RefCell::new(None));let own=cell.clone();let owner=self.clone();
  let release=Closure::once_into_js(move||{
   let (mine,current)=(own.borrow().clone(),owner.task.borrow().clone());
   if let (Some(mine),Some(current))=(mine,current){if JsValue::from(mine)==JsValue::from(current){*owner.task.borrow_mut()=None;}}
  });
  let task:Promise=match call(&Promise::resolve(&locked),"finally",&[&release]){Ok(value)=>value.into(),Err(error)=>return Promise::reject(&error)};
  *cell.borrow_mut()=Some(task.clone());*self.task.borrow_mut()=Some(task.clone());task
 }

 fn run(self:Rc<Self>,account_id:JsValue,generation:f64)->Promise{start(async move{self.run_sync(account_id,generation,None).await})}
 async fn run_sync(self:Rc<Self>,account_id:JsValue,generation:f64,incoming:Option<JsValue>)->Result<JsValue,JsValue>{
  if !account_id.is_truthy(){return Err(error("Conecta tu cuenta de Google para guardar la biblioteca."));}
  let observed_sequence=self.local_sequence.get();
  let key=format!("{}:{}",string(&self.device),string(&account_id));
  let baseline=settle(call(&self.host,"readBackupCheckpoint",&[&key.clone().into()])).await?;self.guard(generation)?;
  self.status("Sincronizando biblioteca y estantería…",true)?;
  // Failure here must abort: never publish an empty replacement after a failed read.
  // Per-device manifests also preserve the originals in Drive.
  let live=incoming.is_some();
  let snapshots=if let Some(incoming)=incoming{
   let merged=live::library_merge_checkpoint(baseline.clone(),incoming);
   Array::of1(&live::checkpoint_snapshot(&merged,&self.device))
  }else{Array::from(&settle(call(&self.host,"readDriveLibrarySnapshots",&[])).await?)};self.guard(generation)?;
  let merged_books=blank();let merged_settings=blank();
  for snapshot in snapshots.iter(){
   for book in Array::from(&read(&snapshot,"books")?).iter(){
    let id=get(&book,"driveFileId");
    if !id.is_string()||!id.is_truthy()||UNSAFE.contains(&string(&id).as_str()){continue;}
    merge_fields(&slot(&merged_books,&string(&id)),&get(&book,"fields"));
   }
   let own_settings=get(&snapshot,"settings");
   for setting in &self.settings{
    let entry=get(&own_settings,setting);
    merge_fields(&merged_settings,&if entry.is_truthy(){object(&[(setting.as_str(),entry)])}else{blank()});
   }
  }
  self.hot_merge(&merged_books,&merged_settings);
  let mut uploaded=0;
  let errors=Array::new();
  let observed=Map::new();
  let mut records=Array::from(&settle(call(&self.library,"listAll",&[])).await?);self.guard(generation)?;
  for mut book in records.iter(){
   let linked=get(&book,"cloudAccountId");
   if linked.is_truthy()&&linked!=account_id{continue;}
   if !get(&book,"driveFileId").is_truthy(){
    if live{continue;}
    if !get(&book,"content").is_truthy(){
     errors.push(&format!("{}: falta el archivo original en este dispositivo",string(&or(get(&book,"title"),get(&book,"name")))).into());continue;
    }
    let attempt=settle(self.cloud("uploadBook",&[&book])).await;
    match attempt{
     Ok(next)=>{self.guard(generation)?;if !next.is_truthy(){continue;}book=next;uploaded+=1;},
     Err(failure)=>{self.guard(generation)?;errors.push(&get(&failure,"message"));continue;}
    }
   }
   let id=get(&book,"driveFileId");let id_key=string(&id);
   let old=or(get(&get(&baseline,"books"),&id_key),blank());
   let local=blank();
   // Cover bytes are separate binary files, never Blob -> JSON ({}), nor device-specific blob: URLs.
   // Reuse the file while the committed cover revision is unchanged; download retries do not re-upload the image.
   let mut cover=get(&get(&old,"cover"),"value");
   let book_cover=get(&book,"cover");
   let revision=or(get(&book,"coverUpdatedAt"),0.into());
   if get(&book_cover,"size").is_truthy()&&(!cover.is_truthy()||get(&cover,"revision")!=revision){
    let upload=async{
     let name=format!("cover-{}-{}",id_key,string(&call(&self.host,"randomUUID",&[])?));
     let saved=settle(call(&self.host,"uploadDriveCover",&[&book_cover,&name.into()])).await?;self.guard(generation)?;
     Ok::<JsValue,JsValue>(object(&[("fileId",get(&saved,"id")),("revision",revision.clone()),("type",get(&book_cover,"type"))]))
    }.await;
    cover=match upload{
     Ok(created)=>created,
     Err(failure)=>{self.guard(generation)?;return Err(error_with_cause(&format!("No se pudo guardar la portada: {}",message(&failure)),failure));}
    };
   }
   let values=self.metadata(&book)?;
   set(&values,"visible",&JsValue::TRUE);
   if cover.is_truthy(){set(&values,"cover",&cover);}
   observed.set(&id,&self.metadata(&book)?);
   for (field,value) in entries(&values){
    if live{continue;}
    let previous=self.room_previous(&id_key,&field,get(&old,&field));
    let at=if previous.is_truthy(){js_sys::Date::now().into()}else{
     let stamped=number_or_zero(&or(get(&book,"progressUpdatedAt"),get(&book,"addedAt")));
     if stamped!=0.0{stamped.into()}else{js_sys::Date::now().into()}
    };
    set(&local,&field,&if self.room_changed_after(&id_key,&field,observed_sequence){previous}else{self.stamp(&previous,&value,&at)?});
   }
   merge_fields(&slot(&merged_books,&id_key),&local);
  }
  let removals=Array::from(&settle(call(&self.library,"listRemoved",&[])).await?);self.guard(generation)?;
  for removal in removals.iter().filter(|_|!live){
   let drive_id=get(&removal,"driveFileId");
   if drive_id.is_truthy()&&get(&removal,"cloudAccountId")==account_id{
    let before=get(&get(&get(&baseline,"books"),&string(&drive_id)),"visible");
    let register=self.stamp(&before,&JsValue::FALSE,&get(&removal,"removedAt"))?;
    merge_fields(&slot(&merged_books,&string(&drive_id)),&object(&[("visible",register)]));
   }
  }
  let touched=self.parse_stored(CHANGES_KEY);
  records=Array::from(&settle(call(&self.library,"listAll",&[])).await?);self.guard(generation)?;
  for setting in &self.settings{
   if live{continue;}
   let value=call(&self.storage,"getItem",&[&setting.as_str().into()])?;
   if value.is_null(){continue;}
   let value=if setting==crate::room_physics_sync::KEY{crate::room_physics_sync::room_physics_for_cloud(value,records.clone().into())}else{value};
   // Default plants/view created during boot must not replace a saved room.
   let old=get(&get(&baseline,"settings"),setting);
   if !old.is_truthy()&&!get(&touched,setting).is_truthy()&&get(&merged_settings,setting).is_truthy(){continue;}
   let at=if get(&touched,setting).is_truthy(){get(&touched,setting)}else if old.is_truthy(){js_sys::Date::now().into()}else{0.into()};
   let entry=self.setting_stamp(setting,&old,&value,&at)?;
   merge_fields(&merged_settings,&object(&[(setting.as_str(),entry)]));
  }
  records=Array::from(&settle(call(&self.library,"listAll",&[])).await?);self.guard(generation)?;
  let by_drive=Map::new();
  for record in records.iter(){
   let linked=get(&record,"cloudAccountId");
   if !linked.is_truthy()||linked==account_id{by_drive.set(&get(&record,"driveFileId"),&record);}
  }
  self.hot_merge(&merged_books,&merged_settings);
  let applied_books=blank();let applied_settings=blank();
  for (id,fields) in entries(&merged_books){
   self.guard(generation)?;
   let mut book=by_drive.get(&id.clone().into());
   let removed=Array::from(&settle(call(&self.library,"listRemoved",&[])).await?);
   let removal=removed.iter().find(|candidate|get(candidate,"driveFileId").as_string().as_deref()==Some(id.as_str())&&get(candidate,"cloudAccountId")==account_id);
   self.guard(generation)?;
   if let Some(removal)=&removal{
    if get(removal,"removedAt").gt(&or(get(&get(&fields,"visible"),"at"),0.into())){
     set(&fields,"visible",&object(&[("value",JsValue::FALSE),("at",get(removal,"removedAt")),("device",self.device.clone())]));
    }
   }
   if get(&get(&fields,"visible"),"value")==JsValue::FALSE{
    let options=object(&[("removedAt",get(&get(&fields,"visible"),"at"))]);
    if book.is_truthy(){settle(self.cloud("removeFromShelf",&[&book,&options])).await?;}
    else{
     let source=object(&[("id",format!("drive:{id}").into()),("driveFileId",id.clone().into()),("cloudAccountId",account_id.clone())]);
     settle(call(&self.library,"removeFromShelf",&[&source,&options])).await?;
    }
    self.guard(generation)?;set(&applied_books,&id,&fields);continue;
   }
   let raw=Array::new();
   for (field,register) in entries(&fields){raw.push(&Array::of2(&field.into(),&get(&register,"value")));}
   let values=self.metadata(&Object::from_entries(&raw)?.into())?;
   // This revision describes the image bytes, not just a metadata field.
   // Commit it only together with the downloaded Blob below.
   delete(&values,"coverUpdatedAt");
   let book_length=get(&values,"bookLength");delete(&values,"bookLength");
   if get(&values,"size").is_undefined()&&get(&book_length,"byteLength").as_f64().is_some(){set(&values,"size",&get(&book_length,"byteLength"));}
   // Never restore local IDs/handles/contentRevision from another device.
   // A remote book without bytes must take the Drive download path.
   if !book.is_truthy(){
    let entry=object(&[]);assign(&entry,&values)?;
    set(&entry,"sourceType",&"drive".into());set(&entry,"driveFileId",&id.clone().into());set(&entry,"cloudAccountId",&account_id);
    book=settle(call(&self.library,"addOrTouch",&[&entry,&object(&[("restoreRemoved",JsValue::TRUE)])])).await?;
    self.guard(generation)?;
    if book.is_truthy(){
     let tail=object(&[]);
     let opened=get(&values,"lastOpenedAt");if !nullish(&opened){set(&tail,"lastOpenedAt",&opened);}
     let added=get(&values,"addedAt");if !nullish(&added){set(&tail,"addedAt",&added);}
     book=settle(call(&self.library,"patch",&[&get(&book,"id"),&tail])).await?;
    }
    self.guard(generation)?;
   }else{
    let patch=object(&[]);
    let current=self.metadata(&book)?;
    for (field,value) in entries(&values){
     if observed.has(&id.clone().into())&&json(&get(&current,&field))?!=json(&get(&observed.get(&id.clone().into()),&field))?{continue;}
     if json(&get(&current,&field))?!=json(&value)?||(field=="shelfVisualId"&&get(&book,&field)!=value){set(&patch,&field,&value);}
    }
    if Object::keys(patch.unchecked_ref::<Object>()).length()>0{
     let still=current.clone();let core=self.clone();
     let guard:Closure<dyn FnMut(JsValue)->Result<JsValue,JsValue>>=Closure::wrap(Box::new(move|latest:JsValue|->Result<JsValue,JsValue>{
      // A local edit made while Drive was loading must win next time.
      Ok(JsValue::from_bool(core.guard(generation).is_ok()&&json(&core.metadata(&latest)?)?==json(&still)?))
     }));
     let saved=settle(call(&self.library,"patch",&[&get(&book,"id"),&patch,&object(&[("ifCurrent",guard.as_ref().clone())])])).await?;drop(guard);
     self.guard(generation)?;if !saved.is_truthy(){continue;}
     book=saved;
    }
   }
   let count=crate::length_metadata::length_count_from_drive(book.clone(),book_length.clone())?;
   if count.is_truthy(){
    let core=self.clone();let expected=book_length.clone();
    let guard:Closure<dyn FnMut(JsValue)->Result<JsValue,JsValue>>=Closure::wrap(Box::new(move|latest:JsValue|->Result<JsValue,JsValue>{
     Ok(JsValue::from_bool(core.guard(generation).is_ok()&&crate::length_metadata::length_count_from_drive(latest,expected.clone())?.is_truthy()))
    }));
    let saved=settle(call(&self.library,"patch",&[&get(&book,"id"),&count,&object(&[("ifCurrent",guard.as_ref().clone())])])).await?;drop(guard);self.guard(generation)?;
    book=if saved.is_truthy(){saved}else{settle(call(&self.library,"get",&[&get(&book,"id")])).await?};self.guard(generation)?;if !book.is_truthy(){continue;}
   }
   let cover=get(&get(&fields,"cover"),"value");
   let locally_changed=observed.has(&id.clone().into())&&read(&book,"coverUpdatedAt")?!=get(&observed.get(&id.clone().into()),"coverUpdatedAt");
   if !locally_changed&&get(&cover,"fileId").is_truthy()&&(!read(&book,"cover")?.is_truthy()||read(&book,"coverUpdatedAt")?!=get(&cover,"revision")){
    let download=async{
     let blob=settle(call(&self.host,"downloadDriveFile",&[&get(&cover,"fileId"),&object(&[("mimeType",get(&cover,"type"))])])).await?;self.guard(generation)?;
     let (core,book_now)=(self.clone(),book.clone());
     let guard:Closure<dyn FnMut(JsValue)->Result<JsValue,JsValue>>=Closure::wrap(Box::new(move|latest:JsValue|->Result<JsValue,JsValue>{
      Ok(JsValue::from_bool(core.guard(generation).is_ok()&&get(&latest,"coverUpdatedAt")==get(&book_now,"coverUpdatedAt")
       &&get(&get(&latest,"cover"),"size")==get(&get(&book_now,"cover"),"size")))
     }));
     let saved=settle(call(&self.library,"patch",&[&get(&book,"id"),&object(&[("cover",blob),("coverUpdatedAt",get(&cover,"revision"))]),&object(&[("ifCurrent",guard.as_ref().clone())])])).await?;drop(guard);
     self.guard(generation)?;
     Ok::<bool,JsValue>(saved.is_truthy())
    }.await;
    match download{
     Ok(true)=>{},
     Ok(false)=>continue,
     Err(failure)=>{self.guard(generation)?;return Err(error_with_cause(&format!("No se pudo recuperar la portada: {}",message(&failure)),failure));}
    }
   }
   set(&applied_books,&id,&fields);
  }
  let room_records=if self.settings.iter().any(|s|s==crate::room_physics_sync::KEY){settle(call(&self.library,"listAll",&[])).await?}else{records.into()};
  self.guard(generation)?;
  let changed_settings=Array::new();
  for setting in &self.settings{
   let entry=get(&merged_settings,setting);
   if !entry.is_truthy()||!get(&entry,"value").is_string(){continue;}
   // Re-check edits that happened while an image was downloading.
   let latest_touched=or(get(&self.parse_stored(CHANGES_KEY),setting),0.into());
   if latest_touched.gt(&or(get(&touched,setting),0.into())){continue;}
   let value=if setting==crate::room_physics_sync::KEY{crate::room_physics_sync::room_physics_for_device(get(&entry,"value"),room_records.clone())}else{get(&entry,"value")};
   let current=call(&self.storage,"getItem",&[&setting.as_str().into()])?;
   let unchanged=if setting==crate::room_physics_sync::KEY{crate::room_physics_sync::room_physics_equivalent(crate::room_physics_sync::room_physics_for_cloud(current.clone(),room_records.clone()),get(&entry,"value"))}else{current==value};
   if !unchanged{
    call(&self.storage,"setItem",&[&setting.as_str().into(),&value])?;changed_settings.push(&setting.as_str().into());
   }
   set(&applied_settings,setting,&entry);
  }
  self.guard(generation)?;
  let checkpoint=object(&[("books",applied_books),("settings",applied_settings)]);
  let hot=self.hot.borrow().clone();let checkpoint=if let Some(hot)=hot{live::library_merge_checkpoint(checkpoint,hot)}else{checkpoint};
  let save=if self.hot.borrow().is_some()||live{"mergeBackupCheckpoint"}else{"saveBackupCheckpoint"};
  settle(call(&self.host,save,&[&key.into(),&checkpoint])).await?;self.guard(generation)?;
  if changed_settings.length()>0{call(&self.host,"onSettings",&[changed_settings.as_ref()])?;}
  call(&self.host,"onChange",&[])?;
  let mut own=JsValue::UNDEFINED;
  for snapshot in snapshots.iter(){if get(&snapshot,"deviceId")==self.device{own=snapshot;}}
  self.hot_merge(&merged_books,&merged_settings);
  let books=Array::new();
  for (drive_file_id,fields) in entries(&merged_books){books.push(&object(&[("driveFileId",drive_file_id.into()),("fields",fields)]));}
  let snapshot=object(&[("schemaVersion",1.into()),("deviceId",self.device.clone()),("books",books.into()),("settings",merged_settings)]);
  self.snapshot_ready(&account_id,&snapshot)?;
  if live{if get(&self.host,"onLiveApplied").is_function(){call(&self.host,"onLiveApplied",&[])?;}return Ok(object(&[("uploaded",0.into()),("errors",errors.into())]));}
  if json(&get(&own,"books"))?!=json(&get(&snapshot,"books"))?||json(&get(&own,"settings"))?!=json(&get(&snapshot,"settings"))?{
   settle(call(&self.host,"writeDriveLibrarySnapshot",&[&snapshot,&get(&own,"stateFileId")])).await?;self.guard(generation)?;
  }
  let result=settle(self.cloud("sync",&[])).await?;self.guard(generation)?;
  let reported=get(&result,"errors");
  if reported.is_truthy(){for item in Array::from(&reported).iter(){errors.push(&item);}}
  self.status(&if errors.length()>0{format!("Sincronización pendiente: {}",string(&errors.get(0)))}else{"Biblioteca y estantería guardadas en Google Drive".to_owned()},false)?;
  let output=object(&[]);assign(&output,&result)?;
  set(&output,"uploaded",&uploaded.into());set(&output,"errors",&errors.into());
  Ok(output)
 }
}

#[wasm_bindgen]
pub struct RustLibraryBackup{core:Rc<Core>}
#[wasm_bindgen]
impl RustLibraryBackup{
 #[wasm_bindgen(constructor)]
 pub fn new(host:JsValue)->Result<RustLibraryBackup,JsValue>{
  let storage=get(&host,"storage");
  let saved=call(&storage,"getItem",&[&DEVICE_KEY.into()])?;
  let device=if saved.is_truthy(){saved}else{call(&host,"randomUUID",&[])?};
  call(&storage,"setItem",&[&DEVICE_KEY.into(),&device])?;
  let settings=Array::from(&get(&host,"settings")).iter().map(|name|string(&name)).collect();
  Ok(RustLibraryBackup{core:Rc::new(Core{library:get(&host,"library"),cloud:get(&host,"cloud"),storage,device,settings,host,generation:Cell::new(0.0),task:RefCell::new(None),revision:RefCell::new(None),live_task:RefCell::new(None),hot:RefCell::new(None),live_inbox:RefCell::new(None),live_account:RefCell::new(None),dirty_books:Map::new(),dirty_settings:Set::new(&JsValue::UNDEFINED),room_revision:Cell::new(0),local_sequence:Cell::new(0),room_fields:RefCell::new(BTreeMap::new())})})
 }
 #[wasm_bindgen(getter)] pub fn device(&self)->JsValue{self.core.device.clone()}
 #[wasm_bindgen(getter)] pub fn task(&self)->JsValue{self.core.task.borrow().clone().map(JsValue::from).unwrap_or(JsValue::NULL)}
 pub fn reset(&self){self.core.generation.set(self.core.generation.get()+1.0);*self.core.task.borrow_mut()=None;*self.core.revision.borrow_mut()=None;*self.core.live_task.borrow_mut()=None;*self.core.hot.borrow_mut()=None;*self.core.live_inbox.borrow_mut()=None;*self.core.live_account.borrow_mut()=None;self.core.dirty_books.clear();self.core.dirty_settings.clear();self.core.room_fields.borrow_mut().clear();}
 pub fn sync(&self,account_id:JsValue)->Promise{let changed=self.core.live_account.borrow().as_ref().is_some_and(|a|*a!=account_id);if changed{self.reset();}*self.core.live_account.borrow_mut()=Some(account_id.clone());*self.core.revision.borrow_mut()=None;self.core.clone().sync(account_id)}
 /// One small metadata request per visible poll. Unchanged rooms never read
 /// book bytes, decode covers, restart physics or wake the renderer.
 pub fn poll(&self,account_id:JsValue)->Promise{
  let changed=self.core.live_account.borrow().as_ref().is_some_and(|a|*a!=account_id);if changed{self.reset();}
  let core=self.core.clone();let generation=core.generation.get();
  start(async move{
   if !account_id.is_truthy(){return Ok(JsValue::UNDEFINED);}
   let task=core.task.borrow().clone();if let Some(task)=task{return settle(Ok(task.into())).await;}
   let revision=settle(call(&core.host,"readDriveLibraryRevision",&[])).await?;core.guard(generation)?;
   if core.revision.borrow().as_ref().is_some_and(|(account,old)|*account==account_id&&*old==revision){return Ok(JsValue::UNDEFINED);}
   let result=settle(Ok(core.clone().sync(account_id.clone()).into())).await?;core.guard(generation)?;
   let errors=get(&result,"errors");
   if !Array::is_array(&errors)||Array::from(&errors).length()==0{*core.revision.borrow_mut()=Some((account_id,revision));}
   Ok(result)
  })
 }
}
