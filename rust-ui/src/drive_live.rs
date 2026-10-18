//! Private-account rendezvous, following Notes' confirmed AES key property.
//! OAuth stays in DriveClient; no token is returned to the peer transport.
use super::*;
const KEY:&str="ihr_live_key_v1";
impl Core{
 async fn live_context(self:Rc<Self>)->Result<JsValue,JsValue>{
  let generation=self.generation.get();let folder=self.clone().state_folder_id().await?;self.require(generation)?;
  let url=format!("{DRIVE_FILES_URL}/{}?fields=id,properties",encode_uri_component(&folder));
  let metadata=self.json(&url,&object(&[]),generation).await?;let mut key=get(&get(&metadata,"properties"),KEY);
  let valid=RegExp::new("^[A-Za-z0-9_-]{43}$","");let created=!valid.test(&string(&key));
  if created{
   let bytes=Uint8Array::new(&call(&self.host,"randomBytes",&[&32.into()])?);let candidate=base64_url(&bytes.to_vec());
   self.json(&url,&object(&[("method","PATCH".into()),("headers",object(&[("Content-Type","application/json".into())])),("body",json_text(&object(&[("properties",object(&[(KEY,candidate.into())]))]))?.into())]),generation).await?;
   let confirmed=self.json(&url,&object(&[]),generation).await?;key=get(&get(&confirmed,"properties"),KEY);
   if !valid.test(&string(&key)){return Err(error("No se pudo confirmar la conexión directa."));}
  }
  Ok(object(&[("folderId",folder),("key",key),("confirm",JsValue::from_bool(created))]))
 }
 async fn read_live(self:Rc<Self>,id:JsValue)->Result<JsValue,JsValue>{
  let generation=self.generation.get();let value=self.json(&format!("{DRIVE_FILES_URL}/{}?alt=media",encode_uri_component(&id)),&object(&[]),generation).await?;
  if get(&value,"v").as_f64()!=Some(1.0)||!get(&value,"signals").is_object()||json_text(&value)?.len()>256000{return Err(error("Invalid rendezvous"));}Ok(value)
 }
 async fn read_live_state(self:Rc<Self>,id:JsValue)->Result<JsValue,JsValue>{
  let generation=self.generation.get();
  let value=self.json(&format!("{DRIVE_FILES_URL}/{}?alt=media",encode_uri_component(&id)),&object(&[]),generation).await?;
  if get(&value,"v").as_f64()!=Some(1.0)||!get(&value,"data").is_string()||json_text(&value)?.len()>2900000{return Err(error("Invalid live state"));}Ok(value)
 }
 async fn write_live_state(self:Rc<Self>,peer:String,payload:JsValue,id:JsValue)->Result<JsValue,JsValue>{
  if !RegExp::new("^[A-Za-z0-9_-]{8,128}$","").test(&peer)||get(&payload,"v").as_f64()!=Some(1.0)||get(&payload,"peer").as_string().as_deref()!=Some(peer.as_str()){return Err(error("Invalid live state identity"));}
  let text=json_text(&payload)?;if text.len()>2900000{return Err(error("Live state too large"));}
  let generation=self.generation.get();let folder=self.clone().state_folder_id().await?;self.require(generation)?;
  let file=construct("File",&[&Array::of1(&text.into()).into(),&format!("live-state-v1-{peer}.json").into(),&object(&[("type","application/json".into())])])?;
  self.upload(file,object(&[("driveFileId",id),("parentId",folder)]),generation).await
 }
 async fn write_live(self:Rc<Self>,peer:String,payload:JsValue,id:JsValue)->Result<JsValue,JsValue>{
  if !RegExp::new("^[A-Za-z0-9_-]{8,128}$","").test(&peer)||get(&payload,"v").as_f64()!=Some(1.0)||get(&payload,"peer").as_string().as_deref()!=Some(peer.as_str()){return Err(error("Invalid rendezvous identity"));}
  let text=json_text(&payload)?;if text.len()>256000{return Err(error("Rendezvous too large"));}
  let generation=self.generation.get();let folder=self.clone().state_folder_id().await?;self.require(generation)?;
  let file=construct("File",&[&Array::of1(&text.into()).into(),&format!("live-v1-{peer}.json").into(),&object(&[("type","application/json".into())])])?;
  self.upload(file,object(&[("driveFileId",id),("parentId",folder),("appProperties",object(&[("ihrKind","live-v1".into())]))]),generation).await
 }
}
#[wasm_bindgen]
impl RustDriveClient{
 #[wasm_bindgen(js_name=readDriveLiveState)]pub fn read_drive_live_state(&self,id:JsValue)->Promise{let core=self.core.clone();start(async move{core.read_live_state(id).await})}
 #[wasm_bindgen(js_name=writeDriveLiveState)]pub fn write_drive_live_state(&self,peer:String,payload:JsValue,id:JsValue)->Promise{let core=self.core.clone();start(async move{core.write_live_state(peer,payload,id).await})}

 #[wasm_bindgen(js_name=getDriveLiveContext)]pub fn get_drive_live_context(&self)->Promise{let core=self.core.clone();start(async move{core.live_context().await})}
 #[wasm_bindgen(js_name=readDriveLiveMailbox)]pub fn read_drive_live_mailbox(&self,id:JsValue)->Promise{let core=self.core.clone();start(async move{core.read_live(id).await})}
 #[wasm_bindgen(js_name=writeDriveLiveMailbox)]pub fn write_drive_live_mailbox(&self,peer:String,payload:JsValue,id:JsValue)->Promise{let core=self.core.clone();start(async move{core.write_live(peer,payload,id).await})}
}
