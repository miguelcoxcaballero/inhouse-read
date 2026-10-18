//! Reconciles IndexedDB with the user's "inhouse read" Drive folder: uploads, offline copies,
//! the reading-state merge (the newer side wins, a dirty local locator wins a tie) and the
//! discovery pass. Records, Drive calls and the title/length helpers stay behind host callbacks.
//! `host`: `{library, onStatus, onChange, getDriveProfile, listAllDriveBooks, uploadDriveFile,
//! downloadDriveFile, readDriveProgress, writeDriveProgress, spineCustomization, normalizeBookTitle,
//! cleanPlaces, cleanQuotes, driveBookLength, wordCountFromDrive, clearBookLength, newContentRevision}`.
use std::{cell::{Cell,RefCell},rc::Rc};
use wasm_bindgen::prelude::*;
use js_sys::{Array,Map,Promise,RegExp,Set};
use crate::cloud_host::*;

type Guard=Closure<dyn FnMut(JsValue)->Result<JsValue,JsValue>>;

struct Core{
 host:JsValue,library:JsValue,profile:RefCell<JsValue>,sync_task:RefCell<Option<Promise>>,
 uploads:Map,downloads:Map,progress_timers:Map,progress_syncs:Map,book_generations:Map,
 timers:Rc<Timers>,generation:Cell<f64>,
}

/// Same reading state on both records: what the progress merge must not overwrite.
fn same_progress(host:&JsValue,a:&JsValue,b:&JsValue)->Result<bool,JsValue>{
 if get(a,"driveFileId")!=get(b,"driveFileId")||get(a,"cloudAccountId")!=get(b,"cloudAccountId"){return Ok(false);}
 if get(a,"shelfVisualId")!=get(b,"shelfVisualId"){return Ok(false);}
 if number_or_zero(&get(a,"progressUpdatedAt"))!=number_or_zero(&get(b,"progressUpdatedAt")){return Ok(false);}
 if get(a,"progressDirty").is_truthy()!=get(b,"progressDirty").is_truthy(){return Ok(false);}
 if number(&get(a,"progressFraction"))!=number(&get(b,"progressFraction")){return Ok(false);}
 if json(&get(a,"locator"))?!=json(&get(b,"locator"))?{return Ok(false);}
 let hundred=JsValue::from_f64(100.0);
 let places=|record:&JsValue,key:&str,limit:Option<&JsValue>|->Result<Option<String>,JsValue>{
  let list=get(record,key);
  stringify(&match limit{Some(limit)=>call(host,"cleanPlaces",&[&list,limit])?,None=>call(host,"cleanPlaces",&[&list])?})
 };
 if places(a,"readingHistory",None)?!=places(b,"readingHistory",None)?{return Ok(false);}
 if places(a,"bookmarks",Some(&hundred))?!=places(b,"bookmarks",Some(&hundred))?{return Ok(false);}
 let quotes=|record:&JsValue|->Result<Option<String>,JsValue>{stringify(&call(host,"cleanQuotes",&[&get(record,"quotes")])?)};
 if quotes(a)?!=quotes(b)?{return Ok(false);}
 let spine=|record:&JsValue|->Result<Option<String>,JsValue>{stringify(&call(host,"spineCustomization",&[record])?)};
 if spine(a)?!=spine(b)?{return Ok(false);}
 if get(a,"contentRevision")!=get(b,"contentRevision")||get(a,"lengthDirty").is_truthy()!=get(b,"lengthDirty").is_truthy(){return Ok(false);}
 let length=|record:&JsValue|->Result<Option<String>,JsValue>{stringify(&call(host,"driveBookLength",&[record])?)};
 Ok(length(a)?==length(b)?)
}

impl Core{
 fn book_generation(&self,id:&JsValue)->f64{let value=self.book_generations.get(id);if value.is_truthy(){number(&value)}else{0.0}}
 fn is_current(&self,id:&JsValue,book_generation:f64,generation:f64)->bool{generation==self.generation.get()&&book_generation==self.book_generation(id)}
 fn status(&self,message:&str,syncing:bool)->Result<(),JsValue>{
  if syncing{call(&self.host,"onStatus",&[&message.into(),&JsValue::TRUE])?;}else{call(&self.host,"onStatus",&[&message.into()])?;}Ok(())
 }
 fn changed(&self,record:Option<&JsValue>)->Result<(),JsValue>{
  match record{Some(record)=>call(&self.host,"onChange",&[record])?,None=>call(&self.host,"onChange",&[])?};Ok(())
 }
 /// The `ifCurrent` guard handed to `library.patch`: still this account, this book, and `against` unchanged.
 fn guard(self:&Rc<Self>,id:&JsValue,book_generation:f64,generation:f64,against:&JsValue)->(Guard,JsValue){
  let (core,id,against)=(self.clone(),id.clone(),against.clone());
  let closure:Guard=Closure::wrap(Box::new(move|current:JsValue|->Result<JsValue,JsValue>{
   Ok(JsValue::from_bool(core.is_current(&id,book_generation,generation)&&same_progress(&core.host,&current,&against)?))
  }));
  let options=object(&[("ifCurrent",closure.as_ref().clone())]);(closure,options)
 }
 async fn account(self:&Rc<Self>)->Result<JsValue,JsValue>{
  let generation=self.generation.get();
  let mut profile=self.profile.borrow().clone();
  if !profile.is_truthy(){profile=settle(call(&self.host,"getDriveProfile",&[])).await?;}
  let id=get(&profile,"id");
  if !id.is_truthy(){return Err(error("No se pudo identificar la cuenta de Google."));}
  if generation==self.generation.get()&&!self.profile.borrow().is_truthy(){*self.profile.borrow_mut()=profile;}
  Ok(id)
 }

 async fn upload_book(self:Rc<Self>,book:JsValue)->Result<JsValue,JsValue>{
  let id=read(&book,"id")?;
  if self.uploads.has(&id){return Ok(self.uploads.get(&id));}
  let (generation,book_generation)=(self.generation.get(),self.book_generation(&id));
  let task=start(self.clone().upload_task(book,id.clone(),generation,book_generation));
  self.uploads.set(&id,&task);
  let result=settle(Ok(task.clone().into())).await;
  if self.uploads.get(&id)==JsValue::from(task){self.uploads.delete(&id);}
  result
 }
 async fn upload_task(self:Rc<Self>,book:JsValue,id:JsValue,generation:f64,book_generation:f64)->Result<JsValue,JsValue>{
  let account_id=self.account().await?;
  if !self.is_current(&id,book_generation,generation)||settle(call(&self.library,"isRemovedFromShelf",&[&book])).await?.is_truthy(){return Ok(JsValue::NULL);}
  let record=or(settle(call(&self.library,"get",&[&id])).await?,book);
  if !self.is_current(&id,book_generation,generation){return Ok(JsValue::NULL);}
  let linked=get(&record,"cloudAccountId");
  if linked.is_truthy()&&linked!=account_id{return Err(error("Este libro está vinculado a otra cuenta de Google."));}
  if get(&record,"driveFileId").is_truthy(){return Ok(record);}
  let content=get(&record,"content");
  if !content.is_truthy(){return Err(error("Falta la copia local del libro. Vuelve a importarlo."));}
  let name=or(or(get(&record,"name"),get(&record,"title")),"libro".into());
  let kind=or(or(get(&record,"mimeType"),get(&content,"type")),"application/octet-stream".into());
  let file=construct("File",&[&Array::of1(&content).into(),&name,&object(&[("type",kind)])])?;
  let uploaded=settle(call(&self.host,"uploadDriveFile",&[&file])).await?;
  if !self.is_current(&id,book_generation,generation){
   settle(call(&self.library,"rememberRemovedDriveLink",&[&record,&get(&uploaded,"id"),&account_id])).await?;
   return Ok(JsValue::NULL);
  }
  let checksum=or(get(&uploaded,"md5Checksum"),JsValue::NULL);
  let updated=settle(call(&self.library,"patch",&[&get(&record,"id"),&object(&[
   ("driveFileId",get(&uploaded,"id")),("driveFileName",get(&uploaded,"name")),
   ("driveContentChecksum",checksum.clone()),("contentDriveChecksum",checksum),
   ("cloudAccountId",account_id),("sourceType","local".into())])])).await?;
  if updated.is_truthy(){self.changed(Some(&updated))?;}
  Ok(updated)
 }

 async fn download_for_offline(self:Rc<Self>,book:JsValue)->Result<JsValue,JsValue>{
  let id=read(&book,"id")?;
  if self.downloads.has(&id){return Ok(self.downloads.get(&id));}
  let (generation,book_generation)=(self.generation.get(),self.book_generation(&id));
  let task=start(self.clone().download_task(book,id.clone(),generation,book_generation));
  self.downloads.set(&id,&task);
  let result=settle(Ok(task.clone().into())).await;
  if self.downloads.get(&id)==JsValue::from(task){self.downloads.delete(&id);}
  result
 }
 async fn download_task(self:Rc<Self>,book:JsValue,id:JsValue,generation:f64,book_generation:f64)->Result<JsValue,JsValue>{
  if settle(call(&self.library,"isRemovedFromShelf",&[&book])).await?.is_truthy(){return Ok(JsValue::NULL);}
  let record=or(settle(call(&self.library,"get",&[&id])).await?,book);
  if !self.is_current(&id,book_generation,generation){return Ok(JsValue::NULL);}
  let content=get(&record,"content");
  let name=or(get(&record,"name"),get(&record,"title"));
  if content.is_truthy(){
   let name=or(name,"libro".into());let kind=or(get(&record,"mimeType"),get(&content,"type"));
   return construct("File",&[&Array::of1(&content).into(),&name,&object(&[("type",kind)])]);
  }
  let account_id=self.account().await?;
  if !self.is_current(&id,book_generation,generation){return Ok(JsValue::NULL);}
  let linked=get(&record,"cloudAccountId");
  if linked.is_truthy()&&linked!=account_id{return Err(error("Conecta la cuenta de Google de este libro."));}
  let file=settle(call(&self.host,"downloadDriveFile",&[&get(&record,"driveFileId"),&object(&[("name",name),("mimeType",get(&record,"mimeType"))])])).await?;
  if !self.is_current(&id,book_generation,generation){return Ok(JsValue::NULL);}
  let saved=async{
   let fields=object(&[("content",construct("Blob",&[&Array::of1(&file).into(),&object(&[("type",get(&file,"type"))])])?),("cloudAccountId",account_id)]);
   assign(&fields,&call(&self.host,"clearBookLength",&[])?)?;
   set(&fields,"contentRevision",&call(&self.host,"newContentRevision",&[])?);
   set(&fields,"contentDriveChecksum",&or(get(&record,"driveContentChecksum"),JsValue::NULL));
   settle(call(&self.library,"patch",&[&get(&record,"id"),&fields])).await
  }.await;
  let saved=match saved{
   Ok(saved)=>saved,
   Err(cause)=>{
    let failure=error_with_cause("No se pudo guardar el libro descargado en este dispositivo. Libera espacio y vuelve a intentarlo.",cause);
    set(&failure,"code",&"LOCAL_BOOK_STORAGE_FAILED".into());return Err(failure);
   }
  };
  if !saved.is_truthy()||!self.is_current(&id,book_generation,generation){return Ok(JsValue::NULL);}
  self.changed(None)?;
  Ok(file)
 }

 fn schedule_progress(self:&Rc<Self>,book_id:JsValue)->Result<(),JsValue>{
  if !book_id.is_truthy(){return Ok(());}
  self.clear_progress_timer(&book_id);
  let core=self.clone();let id=book_id.clone();
  let seq=self.timers.start(1800.0,move||{
   core.progress_timers.delete(&id);
   let promise=core.clone().sync_book_progress(id.clone());
   let report=core.clone();
   let handler=Closure::once_into_js(move|failure:JsValue|{
    if let Err(error)=report.status(&format!("Progreso pendiente: {}",message(&failure)),false){wasm_bindgen::throw_val(error);}
   });
   let _=call(&promise,"catch",&[&handler]);
  });
  self.progress_timers.set(&book_id,&JsValue::from_f64(seq as f64));Ok(())
 }
 fn clear_progress_timer(&self,book_id:&JsValue){
  let seq=self.progress_timers.get(book_id);
  if let Some(seq)=seq.as_f64(){self.timers.clear(seq as u32);}
 }

 fn sync_book_progress(self:Rc<Self>,book_or_id:JsValue)->Promise{
  start(async move{
   let id=if book_or_id.is_string(){book_or_id}else{get(&book_or_id,"id")};
   if !id.is_truthy(){return Ok(JsValue::UNDEFINED);}
   let previous=self.progress_syncs.get(&id);
   let (generation,book_generation)=(self.generation.get(),self.book_generation(&id));
   let core=self.clone();let key=id.clone();
   let task=start(async move{
    // `(previous || Promise.resolve()).catch(() => {}).then(...)`: a failure of the previous run never blocks this one.
    let _=if previous.is_truthy(){settle(Ok(previous)).await}else{tick().await.map(|_|JsValue::UNDEFINED)};
    core.sync_once(key,generation,book_generation).await
   });
   self.progress_syncs.set(&id,&task);
   let result=settle(Ok(task.clone().into())).await;
   if self.progress_syncs.get(&id)==JsValue::from(task){self.progress_syncs.delete(&id);}
   result
  })
 }

 async fn sync_once(self:Rc<Self>,id:JsValue,generation:f64,book_generation:f64)->Result<JsValue,JsValue>{
  let current=||self.is_current(&id,book_generation,generation);
  if !current(){return Ok(JsValue::UNDEFINED);}
  let mut record=settle(call(&self.library,"get",&[&id])).await?;
  if !get(&record,"driveFileId").is_truthy(){return Ok(JsValue::UNDEFINED);}
  let account_id=self.account().await?;
  if !current(){return Ok(JsValue::UNDEFINED);}
  let linked=get(&record,"cloudAccountId");
  if linked.is_truthy()&&linked!=account_id{return Ok(JsValue::UNDEFINED);}
  let drive_file_id=get(&record,"driveFileId");
  let remote=settle(call(&self.host,"readDriveProgress",&[&drive_file_id])).await?;
  if !current(){return Ok(JsValue::UNDEFINED);}
  // A close, bookmark or page turn may have saved while the network waited. Compare the remote
  // timestamp with that committed local state, not the record captured before the request.
  record=settle(call(&self.library,"get",&[&id])).await?;
  if !record.is_truthy()||get(&record,"driveFileId")!=drive_file_id||!current(){return Ok(JsValue::UNDEFINED);}
  let remote_length=get(&remote,"bookLength");
  let cloud_length=call(&self.host,"wordCountFromDrive",&[&record,&remote_length])?;
  if cloud_length.is_truthy(){
   let (guard,options)=self.guard(&id,book_generation,generation,&record);
   let saved=settle(call(&self.library,"patch",&[&id,&cloud_length,&options])).await?;drop(guard);
   if !saved.is_truthy(){if current(){self.schedule_progress(id.clone())?;}return Ok(JsValue::UNDEFINED);}
   record=saved;self.changed(None)?;
  }
  let book_length=call(&self.host,"driveBookLength",&[&record])?;
  let length_needs_upload=book_length.is_truthy()&&json(&book_length)?!=json(&remote_length)?;
  let local_updated_at=number_or_zero(&get(&record,"progressUpdatedAt"));
  let remote_updated_at=number_or_zero(&get(&remote,"updatedAt"));
  let local_has_progress=get(&record,"progressDirty").is_truthy()||number(&get(&record,"progressFraction"))>0.0||!nullish(&get(&record,"locator"));

  // Equal millisecond timestamps are possible when two reading updates land in the same frame.
  // Keep a dirty local locator on a tie; otherwise a stale remote value can erase the newest page.
  if remote.is_truthy()&&(!local_has_progress||remote_updated_at>local_updated_at||(remote_updated_at==local_updated_at&&!get(&record,"progressDirty").is_truthy())){
   let fields=object(&[("progressFraction",get(&remote,"fraction")),("locator",get(&remote,"locator"))]);
   // A library manifest owns appearance and placement field by field. The
   // older per-book reading file has only a reading timestamp: importing its
   // appearance on a progress tie silently undoes a newly received shelf move.
   if !get(&record,"shelfVisualId").is_string(){assign(&fields,&call(&self.host,"spineCustomization",&[&get(&remote,"appearance")])?)?;}
   for (key,limit) in [("readingHistory",None),("bookmarks",Some(100.0))]{
    let list=get(&remote,key);
    if Array::is_array(&list){
     let cleaned=match limit{Some(limit)=>call(&self.host,"cleanPlaces",&[&list,&JsValue::from_f64(limit)])?,None=>call(&self.host,"cleanPlaces",&[&list])?};
     set(&fields,key,&cleaned);
    }
   }
   let quotes=get(&remote,"quotes");
   if Array::is_array(&quotes){set(&fields,"quotes",&call(&self.host,"cleanQuotes",&[&quotes])?);}
   set(&fields,"progressUpdatedAt",&remote_updated_at.into());set(&fields,"progressDirty",&JsValue::FALSE);
   set(&fields,"progressStateFileId",&get(&remote,"stateFileId"));
   let (guard,options)=self.guard(&id,book_generation,generation,&record);
   let updated=settle(call(&self.library,"patch",&[&get(&record,"id"),&fields,&options])).await?;drop(guard);
   if updated.is_truthy(){self.changed(Some(&updated))?;}else if current(){self.schedule_progress(id.clone())?;}
   // Length is content metadata, independent of which device's locator won.
   // Preserve the winning remote progress while publishing a local count.
   if updated.is_truthy()&&length_needs_upload&&current(){
    let published=object(&[]);assign(&published,&remote)?;set(&published,"bookLength",&book_length);
    let uploaded=settle(call(&self.host,"writeDriveProgress",&[&drive_file_id,&published,&get(&remote,"stateFileId")])).await?;
    if !current(){return Ok(JsValue::UNDEFINED);}
    let (guard,options)=self.guard(&id,book_generation,generation,&updated);
    let tail=object(&[("lengthDirty",JsValue::FALSE),("progressStateFileId",get(&uploaded,"id"))]);
    settle(call(&self.library,"patch",&[&id,&tail,&options])).await?;drop(guard);
   }
   return Ok(JsValue::UNDEFINED);
  }
  if !local_has_progress&&!book_length.is_truthy(){return Ok(JsValue::UNDEFINED);}
  let history=call(&self.host,"cleanPlaces",&[&get(&record,"readingHistory")])?;
  let bookmarks=call(&self.host,"cleanPlaces",&[&get(&record,"bookmarks"),&JsValue::from_f64(100.0)])?;
  let quotes=call(&self.host,"cleanQuotes",&[&get(&record,"quotes")])?;
  let appearance=call(&self.host,"spineCustomization",&[&record])?;
  let updated_at=if local_updated_at!=0.0{local_updated_at}else{js_sys::Date::now()};
  let snapshot=object(&[("fraction",get(&record,"progressFraction")),("locator",get(&record,"locator")),("appearance",appearance),
   ("bookLength",book_length),("readingHistory",history),("bookmarks",bookmarks),("quotes",quotes),("updatedAt",updated_at.into())]);
  let state_file=or(get(&remote,"stateFileId"),get(&record,"progressStateFileId"));
  let uploaded=settle(call(&self.host,"writeDriveProgress",&[&get(&record,"driveFileId"),&snapshot,&state_file])).await?;
  if !current(){return Ok(JsValue::UNDEFINED);}
  let latest=settle(call(&self.library,"get",&[&get(&record,"id")])).await?;
  if !latest.is_truthy()||!current(){return Ok(JsValue::UNDEFINED);}
  let unchanged=self.matches_snapshot(&latest,&snapshot,local_updated_at)?;
  let tail=object(&[]);
  if unchanged{set(&tail,"progressDirty",&JsValue::FALSE);set(&tail,"progressUpdatedAt",&get(&snapshot,"updatedAt"));set(&tail,"lengthDirty",&JsValue::FALSE);}
  set(&tail,"progressStateFileId",&get(&uploaded,"id"));
  let (guard,options)=self.guard(&id,book_generation,generation,&latest);
  let updated=settle(call(&self.library,"patch",&[&get(&record,"id"),&tail,&options])).await?;drop(guard);
  if !updated.is_truthy()&&current(){self.schedule_progress(id.clone())?;}
  Ok(JsValue::UNDEFINED)
 }
 /// The record still holds exactly the state that was just published.
 fn matches_snapshot(&self,latest:&JsValue,snapshot:&JsValue,local_updated_at:f64)->Result<bool,JsValue>{
  if number_or_zero(&get(latest,"progressUpdatedAt"))!=local_updated_at||number(&get(latest,"progressFraction"))!=number(&get(snapshot,"fraction")){return Ok(false);}
  if json(&get(latest,"locator"))?!=json(&get(snapshot,"locator"))?{return Ok(false);}
  let hundred=JsValue::from_f64(100.0);
  if stringify(&call(&self.host,"cleanPlaces",&[&get(latest,"readingHistory")])?)?!=stringify(&get(snapshot,"readingHistory"))?{return Ok(false);}
  if stringify(&call(&self.host,"cleanPlaces",&[&get(latest,"bookmarks"),&hundred])?)?!=stringify(&get(snapshot,"bookmarks"))?{return Ok(false);}
  if stringify(&call(&self.host,"cleanQuotes",&[&get(latest,"quotes")])?)?!=stringify(&get(snapshot,"quotes"))?{return Ok(false);}
  if stringify(&call(&self.host,"spineCustomization",&[latest])?)?!=stringify(&get(snapshot,"appearance"))?{return Ok(false);}
  Ok(stringify(&call(&self.host,"driveBookLength",&[latest])?)?==stringify(&get(snapshot,"bookLength"))?)
 }

 async fn do_sync(self:Rc<Self>)->Result<JsValue,JsValue>{
  let generation=self.generation.get();
  let account_id=self.account().await?;
  if generation!=self.generation.get(){return Ok(JsValue::UNDEFINED);}
  self.status("Buscando libros en Google Drive…",true)?;
  let remote_books=Array::from(&settle(call(&self.host,"listAllDriveBooks",&[])).await?);
  let local_books=Array::from(&settle(call(&self.library,"listAll",&[])).await?);
  let by_drive_id=Map::new();
  for book in local_books.iter(){
   let linked=get(&book,"cloudAccountId");
   if get(&book,"driveFileId").is_truthy()&&(!linked.is_truthy()||linked==account_id){by_drive_id.set(&get(&book,"driveFileId"),&book);}
  }
  let linked_books=Array::new();
  let extension=RegExp::new(r"\.(pdf|epub|mobi|azw|azw3|fb2|cbz)$","i");

  for remote in remote_books.iter(){
   if generation!=self.generation.get(){return Ok(JsValue::UNDEFINED);}
   let size=number_or_zero(&get(&remote,"size"));
   let source=object(&[("driveFileId",get(&remote,"id")),("cloudAccountId",account_id.clone()),("name",get(&remote,"name")),("size",size.into())]);
   if settle(call(&self.library,"isRemovedFromShelf",&[&source])).await?.is_truthy(){continue;}
   let mut record=by_drive_id.get(&get(&remote,"id"));
   if !record.is_truthy(){
    let name=get(&remote,"name");
    let matched=call(&name,"match",&[&extension])?;
    let format=if nullish(&matched){String::new()}else{string(&call(&get(&matched,"1"),"toUpperCase",&[])?)};
    let entry=object(&[("sourceType","drive".into()),("driveFileId",get(&remote,"id")),("driveFileName",name.clone()),
     ("cloudAccountId",account_id.clone()),("name",name.clone()),("title",call(&self.host,"normalizeBookTitle",&[&name])?),
     ("mimeType",get(&remote,"mimeType")),("size",size.into()),("sizeBytes",size.into()),
     ("driveContentChecksum",or(get(&remote,"md5Checksum"),JsValue::NULL)),("format",format.into())]);
    record=settle(call(&self.library,"addOrTouch",&[&entry])).await?;
    if !record.is_truthy(){continue;}
    self.changed(None)?;
   }else if !get(&record,"cloudAccountId").is_truthy(){
    record=settle(call(&self.library,"patch",&[&get(&record,"id"),&object(&[("cloudAccountId",account_id.clone())])])).await?;
   }
   let checksum=get(&remote,"md5Checksum");
   if record.is_truthy()&&checksum.is_truthy()&&get(&record,"driveContentChecksum")!=checksum{
    record=settle(call(&self.library,"patch",&[&get(&record,"id"),&object(&[("driveContentChecksum",checksum)])])).await?;
   }
   if record.is_truthy(){linked_books.push(&record);}
  }

  let remote_ids=Set::new(&JsValue::UNDEFINED);
  for remote in remote_books.iter(){remote_ids.add(&get(&remote,"id"));}
  // Discovery and login are read-only for local book bytes. Only the cover's explicit upload
  // action may create a Drive copy or link a local record.
  let errors=Array::new();
  // Include legacy linked records whose file was moved outside the app's Drive folder. Retain every
  // available original on this device, serially in the background; no caller's opening/return
  // animation awaits sync().
  let linked_ids=Set::new(&JsValue::UNDEFINED);
  for record in linked_books.iter(){linked_ids.add(&get(&record,"id"));}
  for record in by_drive_id.values(){
   let record=record?;
   if !linked_ids.has(&get(&record,"id")){linked_books.push(&record);}
  }
  let mut downloaded=0;
  for record in linked_books.iter(){
   if generation!=self.generation.get(){return Ok(JsValue::UNDEFINED);}
   if get(&record,"content").is_truthy(){continue;}
   let label=string(&or(or(get(&record,"title"),get(&record,"name")),"libro".into()));
   self.status(&format!("Guardando {label} en este dispositivo…"),true)?;
   match settle(Ok(self.clone().download_promise(record.clone()).into())).await{
    Ok(done)=>{if done.is_truthy(){downloaded+=1;}},
    Err(failure)=>{errors.push(&format!("{}: {}",string(&or(get(&record,"title"),get(&record,"name"))),message(&failure)).into());}
   };
  }
  for record in linked_books.iter(){
   if generation!=self.generation.get(){return Ok(JsValue::UNDEFINED);}
   if let Err(failure)=settle(Ok(self.clone().sync_book_progress(get(&record,"id")).into())).await{
    errors.push(&format!("{}: {}",string(&or(get(&record,"title"),get(&record,"name"))),message(&failure)).into());
   }
  }
  let books=remote_ids.size();
  self.status(&if errors.length()>0{format!("Sincronización incompleta: {}",string(&errors.get(0)))}
   else{format!("Sincronizado · {books} {}",if books==1{"libro"}else{"libros"})},false)?;
  self.changed(None)?;
  Ok(object(&[("books",books.into()),("uploaded",0.into()),("downloaded",downloaded.into()),("errors",errors.into())]))
 }
 fn download_promise(self:Rc<Self>,book:JsValue)->Promise{start(async move{self.download_for_offline(book).await})}
}

#[wasm_bindgen]
pub struct RustCloudSync{core:Rc<Core>}
#[wasm_bindgen]
impl RustCloudSync{
 #[wasm_bindgen(constructor)]
 pub fn new(host:JsValue,profile:JsValue)->RustCloudSync{
  let library=get(&host,"library");
  RustCloudSync{core:Rc::new(Core{host,library,profile:RefCell::new(profile),sync_task:RefCell::new(None),
   uploads:Map::new(),downloads:Map::new(),progress_timers:Map::new(),progress_syncs:Map::new(),book_generations:Map::new(),
   timers:Rc::new(Timers::default()),generation:Cell::new(0.0)})}
 }
 #[wasm_bindgen(js_name=setProfile)]
 pub fn set_profile(&self,profile:JsValue){*self.core.profile.borrow_mut()=profile;}
 /// Forget the app's copy, without deleting or trashing the Drive file.
 #[wasm_bindgen(js_name=removeFromShelf)]
 pub fn remove_from_shelf(&self,book:JsValue,options:JsValue)->Promise{
  let core=self.core.clone();
  start(async move{
   let id=get(&book,"id");
   if !id.is_truthy(){return Ok(JsValue::NULL);}
   core.book_generations.set(&id,&JsValue::from_f64(core.book_generation(&id)+1.0));
   core.clear_progress_timer(&id);
   core.progress_timers.delete(&id);
   core.uploads.delete(&id);core.downloads.delete(&id);core.progress_syncs.delete(&id);
   settle(call(&core.library,"removeFromShelf",&[&book,&options])).await
  })
 }
 pub fn reset(&self){
  let core=&self.core;
  core.generation.set(core.generation.get()+1.0);
  *core.profile.borrow_mut()=JsValue::NULL;
  core.timers.clear_all();core.progress_timers.clear();
  *core.sync_task.borrow_mut()=None;
  core.uploads.clear();core.downloads.clear();core.progress_syncs.clear();
 }
 #[wasm_bindgen(js_name=uploadBook)]
 pub fn upload_book(&self,book:JsValue)->Promise{let core=self.core.clone();start(async move{core.upload_book(book).await})}
 #[wasm_bindgen(js_name=downloadForOffline)]
 pub fn download_for_offline(&self,book:JsValue)->Promise{let core=self.core.clone();start(async move{core.download_for_offline(book).await})}
 #[wasm_bindgen(js_name=scheduleProgress)]
 pub fn schedule_progress(&self,book_id:JsValue)->Result<(),JsValue>{self.core.schedule_progress(book_id)}
 #[wasm_bindgen(js_name=flushProgress)]
 pub fn flush_progress(&self,book_id:JsValue)->Promise{
  self.core.clear_progress_timer(&book_id);self.core.progress_timers.delete(&book_id);
  self.core.clone().sync_book_progress(book_id)
 }
 #[wasm_bindgen(js_name=syncBookProgress)]
 pub fn sync_book_progress(&self,book_or_id:JsValue)->Promise{self.core.clone().sync_book_progress(book_or_id)}
 pub fn sync(&self)->Promise{
  if let Some(task)=self.core.sync_task.borrow().as_ref(){return task.clone();}
  let core=self.core.clone();
  let run=start(core.clone().do_sync());
  let owner=core.clone();
  // `.finally(() => { if (this.#syncTask === task) this.#syncTask = null })`
  let cell:Rc<RefCell<Option<Promise>>>=Rc::new(RefCell::new(None));let own=cell.clone();
  let release=Closure::once_into_js(move||{
   let mine=own.borrow().clone();
   let current=owner.sync_task.borrow().clone();
   if let (Some(mine),Some(current))=(mine,current){if JsValue::from(mine)==JsValue::from(current){*owner.sync_task.borrow_mut()=None;}}
  });
  let task:Promise=call(&run,"finally",&[&release]).expect("Promise.prototype.finally exists").into();
  *cell.borrow_mut()=Some(task.clone());
  *core.sync_task.borrow_mut()=Some(task.clone());
  task
 }
}
