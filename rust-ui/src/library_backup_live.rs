//! Direct room delivery shares the durable field registers. Local capture never
//! waits for Drive; concurrent checkpoint writes merge in one IDB transaction.
use super::*;
use js_sys::Set;
pub(super) fn checkpoint_snapshot(value:&JsValue,device:&JsValue)->JsValue{
 let books=Array::new();for(id,fields)in entries(&get(value,"books")){books.push(&object(&[("driveFileId",id.into()),("fields",fields)]));}
 object(&[("schemaVersion",1.into()),("deviceId",device.clone()),("books",books.into()),("settings",get(value,"settings"))])
}
fn snapshot_checkpoint(value:&JsValue)->JsValue{
 let books=blank();for row in Array::from(&get(value,"books")).iter(){let id=get(&row,"driveFileId");if id.is_string()&&id.is_truthy()&&!UNSAFE.contains(&string(&id).as_str()){merge_fields(&slot(&books,&string(&id)),&get(&row,"fields"));}}
 object(&[("books",books),("settings",get(value,"settings"))])
}
#[wasm_bindgen]
pub fn library_merge_checkpoint(a:JsValue,b:JsValue)->JsValue{
 let books=blank();let settings=blank();
 for source in [a,b]{let source_books=get(&source,"books");for(id,fields)in entries(&if source_books.is_truthy(){source_books}else{blank()}){if !UNSAFE.contains(&id.as_str()){merge_fields(&slot(&books,&id),&fields);}}merge_fields(&settings,&get(&source,"settings"));}
 object(&[("books",books),("settings",settings)])
}
impl Core{
 pub(super) fn hot_merge(&self,books:&JsValue,settings:&JsValue){
  if let Some(hot)=self.hot.borrow().as_ref(){for(id,fields)in entries(&get(hot,"books")){merge_fields(&slot(books,&id),&fields);}merge_fields(settings,&get(hot,"settings"));}
 }
 pub(super) fn room_previous(&self,id:&str,field:&str,old:JsValue)->JsValue{
  let hot=self.hot.borrow();let recent=hot.as_ref().map(|h|get(&get(&get(h,"books"),id),field)).unwrap_or(JsValue::UNDEFINED);
  if recent.is_truthy()&&newer(&recent,&old){recent}else{old}
 }
 pub(super) fn room_changed_after(&self,id:&str,field:&str,revision:u64)->bool{
  self.room_fields.borrow().get(&(id.to_owned(),field.to_owned())).is_some_and(|n|*n>revision)
 }
 fn live_allowed(&self,account:&JsValue)->bool{account.is_truthy()&&self.live_account.borrow().as_ref()==Some(account)}
 pub(super) fn snapshot_ready(&self,account:&JsValue,snapshot:&JsValue)->Result<(),JsValue>{
  if get(&self.host,"onSnapshot").is_function(){call(&self.host,"onSnapshot",&[account,&self.device,snapshot])?;}Ok(())
 }
 fn drain_live(self:Rc<Self>,account:JsValue)->Promise{
  if self.dirty_books.size()>0||self.dirty_settings.size()>0||self.live_inbox.borrow().is_none(){return Promise::resolve(&JsValue::UNDEFINED);}
  if let Some(task)=self.live_task.borrow().clone(){
   let core=self.clone();let generation=core.generation.get();let again=Closure::once_into_js(move||->JsValue{if core.guard(generation).is_ok(){core.drain_live(account).into()}else{JsValue::UNDEFINED}});
   return call(&task,"then",&[&again]).expect("Promise.then").into();
  }
  let incoming=self.live_inbox.borrow_mut().take();let core=self.clone();let generation=self.generation.get();
  let task=start(async move{core.run_sync(account,generation,incoming).await});
  let owner=self.clone();let saved_generation=generation;
  let release=Closure::once_into_js(move||{if owner.guard(saved_generation).is_ok(){*owner.live_task.borrow_mut()=None;}});
  let task:Promise=call(&task,"finally",&[&release]).expect("Promise.finally").into();
  *self.live_task.borrow_mut()=Some(task.clone());task
 }
 async fn capture_room(self:Rc<Self>,account:JsValue,generation:f64)->Result<JsValue,JsValue>{
  if !self.live_allowed(&account){return Ok(JsValue::UNDEFINED);}
  let revision=self.room_revision.get();let key=format!("{}:{}",string(&self.device),string(&account));
  let tasks=Array::of3(&call(&self.host,"readBackupCheckpoint",&[&key.clone().into()])?,&call(&self.library,"listAll",&[])?,&call(&self.library,"listRemoved",&[])?);
  let ready=Array::from(&settle(Ok(Promise::all(&tasks).into())).await?);self.guard(generation)?;
  if revision!=self.room_revision.get(){return Ok(JsValue::UNDEFINED);}
  let current=library_merge_checkpoint(ready.get(0),self.hot.borrow().clone().unwrap_or_else(blank));
  let books=get(&current,"books");let settings=get(&current,"settings");let records=Array::from(&ready.get(1));
  let pending=self.live_inbox.borrow().clone().unwrap_or_else(blank);
  let next=self.local_sequence.get().wrapping_add(1);self.local_sequence.set(next);
  for book in records.iter(){
   let id=get(&book,"driveFileId");let linked=get(&book,"cloudAccountId");
   if !id.is_string()||!id.is_truthy()||linked.is_truthy()&&linked!=account{continue;}
   let dirty=self.dirty_books.get(&get(&book,"id"));if !dirty.is_object(){continue;}
   let dirty:Set=dirty.unchecked_into();let target=slot(&books,&string(&id));let values=self.metadata(&book)?;set(&values,"visible",&JsValue::TRUE);
   for(field,value)in entries(&values){
    if !dirty.has(&field.clone().into()){continue;}
    let old=get(&target,&field);if old.is_truthy()&&json(&get(&old,"value"))?==json(&value)?{continue;}
    let remote=get(&get(&get(&pending,"books"),&string(&id)),&field);let previous=if remote.is_truthy()&&newer(&remote,&old){remote}else{old};
    let entry=self.stamp(&previous,&value,&JsValue::UNDEFINED)?;set(&target,&field,&entry);
    self.room_fields.borrow_mut().insert((string(&id),field),next);
   }
  }
  for removal in Array::from(&ready.get(2)).iter(){
   if !self.dirty_books.has(&get(&removal,"id"))||get(&removal,"cloudAccountId")!=account{continue;}
   let id=get(&removal,"driveFileId");if !id.is_string()||!id.is_truthy(){continue;}
   let target=slot(&books,&string(&id));let entry=self.stamp(&get(&target,"visible"),&JsValue::FALSE,&get(&removal,"removedAt"))?;
   set(&target,"visible",&entry);self.room_fields.borrow_mut().insert((string(&id),"visible".into()),next);
  }
  let touched=self.parse_stored(CHANGES_KEY);
  for setting in &self.settings{
   if !self.dirty_settings.has(&setting.as_str().into()){continue;}
   let value=call(&self.storage,"getItem",&[&setting.as_str().into()])?;if value.is_null(){continue;}
   let value=if setting==crate::room_physics_sync::KEY{crate::room_physics_sync::room_physics_for_cloud(value,records.clone().into())}else{value};
   let old=get(&settings,setting);if old.is_truthy()&&json(&get(&old,"value"))?==json(&value)?{continue;}
   let remote=get(&get(&pending,"settings"),setting);let previous=if remote.is_truthy()&&newer(&remote,&old){remote}else{old};
   let entry=self.setting_stamp(setting,&previous,&value,&get(&touched,setting))?;set(&settings,setting,&entry);
  }
  *self.hot.borrow_mut()=Some(current.clone());
  let saved=settle(call(&self.host,"mergeBackupCheckpoint",&[&key.into(),&current])).await?;self.guard(generation)?;
  let hot=self.hot.borrow().clone().unwrap_or_else(blank);*self.hot.borrow_mut()=Some(library_merge_checkpoint(hot,saved.clone()));
  if revision!=self.room_revision.get(){return Ok(JsValue::UNDEFINED);}
  self.dirty_books.clear();self.dirty_settings.clear();let snapshot=checkpoint_snapshot(&saved,&self.device);
  self.snapshot_ready(&account,&snapshot)?;Ok(snapshot)
 }
}
#[wasm_bindgen]
impl RustLibraryBackup{
 pub fn markBookChanged(&self,account:JsValue,id:JsValue,fields:JsValue)->bool{
  if !self.core.live_allowed(&account)||!id.is_string(){return false;}
  let found=self.core.dirty_books.get(&id);let set:Set=if found.is_object(){found.unchecked_into()}else{Set::new(&JsValue::UNDEFINED)};
  for field in Array::from(&fields).iter(){let name=string(&field);if field.is_string()&&(name.starts_with("spine")||["shelfPosition","shelfOrder","shelfVisualId","title","author","name","visible","coverAppearance","coverAppearanceKey","coverUpdatedAt","coverFinish","coverRelief"].contains(&name.as_str())){set.add(&field);}}
  if set.size()==0{return false;}
  self.core.dirty_books.set(&id,set.as_ref());self.core.room_revision.set(self.core.room_revision.get().wrapping_add(1));true
 }
 pub fn markSettingChanged(&self,account:JsValue,key:String)->bool{
  if !self.core.live_allowed(&account)||!self.core.settings.contains(&key){return false;}
  self.core.dirty_settings.add(&key.into());self.core.room_revision.set(self.core.room_revision.get().wrapping_add(1));true
 }
 pub fn captureRoom(&self,account:JsValue)->Promise{let core=self.core.clone();let generation=core.generation.get();start(async move{core.capture_room(account,generation).await})}
 pub fn drainLive(&self,account:JsValue)->Promise{self.core.clone().drain_live(account)}
 pub fn receiveSnapshot(&self,account:JsValue,snapshot:JsValue)->Promise{
  if !self.core.live_allowed(&account)||get(&snapshot,"schemaVersion").as_f64()!=Some(1.0)||!Array::is_array(&get(&snapshot,"books"))||Array::from(&get(&snapshot,"books")).length()>10000{return Promise::reject(&error("Invalid live room"));}
  let current=self.core.live_inbox.borrow().clone().unwrap_or_else(blank);let merged=library_merge_checkpoint(current,snapshot_checkpoint(&snapshot));
  let next=self.core.local_sequence.get().wrapping_add(1);self.core.local_sequence.set(next);
  for(id,fields)in entries(&get(&merged,"books")){for(field,_)in entries(&fields){self.core.room_fields.borrow_mut().insert((id.clone(),field),next);}}
  let hot=self.core.hot.borrow().clone().unwrap_or_else(blank);*self.core.hot.borrow_mut()=Some(library_merge_checkpoint(hot,merged.clone()));
  *self.core.live_inbox.borrow_mut()=Some(merged);*self.core.revision.borrow_mut()=None;self.core.clone().drain_live(account)
 }
}
