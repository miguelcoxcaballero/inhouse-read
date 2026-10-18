//! Pure direct-room protocol. Browser RTC/crypto objects remain JS-owned;
//! this object stores only bounded data and can be freed on every account switch.
use std::collections::{BTreeMap,BTreeSet,VecDeque};
use wasm_bindgen::prelude::*;
use js_sys::{Array,JSON,Object};
use crate::cloud_host::*;
const MAX_PACKET:usize=2*1024*1024;
const MAX_PEERS:usize=8;
#[derive(Default)]struct Peer{file:String,modified:String,read:f64,started:f64,retry:f64,status:u8,nonce:String,failures:u32,sdp:String}
#[wasm_bindgen]pub struct RustLiveRoom{account:String,own:String,peers:BTreeMap<String,Peer>,seen:VecDeque<String>,last_key:String,last_packet:String,motion_sequence:u64,motion_seen:BTreeMap<String,f64>}
fn identity(value:&str)->bool{!value.is_empty()&&value.len()<=128&&value.bytes().all(|b|b.is_ascii_alphanumeric()||b==b'-'||b==b'_')}
fn pairs(value:&JsValue)->JsValue{
 let result=Array::new();let source=if value.is_object(){value.clone()}else{object(&[])};
 let keys=Object::keys(source.unchecked_ref());keys.sort();
 for key in keys.iter(){result.push(&Array::of2(&key,&get(&source,&string(&key))));}result.into()
}
fn snapshot_key(snapshot:&JsValue)->Result<String,JsValue>{
 let mut books:Vec<JsValue>=Array::from(&get(snapshot,"books")).iter().collect();books.sort_by_key(|b|string(&get(b,"driveFileId")));
 let rows=Array::new();for b in books{rows.push(&Array::of2(&get(&b,"driveFileId"),&pairs(&get(&b,"fields"))));}
 json(&Array::of2(&rows,&pairs(&get(snapshot,"settings"))).into())
}
fn registers(value:&JsValue,max:u32)->bool{
 if !value.is_object()||Array::is_array(value){return false;}
 let keys=Object::keys(value.unchecked_ref());if keys.length()>max{return false;}
 keys.iter().all(|key|{let name=string(&key);let e=get(value,&name);
 !["__proto__","prototype","constructor"].contains(&name.as_str())&&e.is_object()&&get(&e,"at").as_f64().is_some_and(|n|n.is_finite()&&n>=0.0)&&get(&e,"device").as_string().is_some_and(|s|!s.is_empty()&&s.len()<=256)&&has_own(&e,"value")})
}
fn valid_snapshot(snapshot:&JsValue)->bool{
 if get(snapshot,"schemaVersion").as_f64()!=Some(1.0)||!Array::is_array(&get(snapshot,"books")){return false;}
 let books=Array::from(&get(snapshot,"books"));if books.length()>10000||!registers(&get(snapshot,"settings"),32){return false;}
 books.iter().all(|book|{
  let id=get(&book,"driveFileId");let fields=get(&book,"fields");
  id.is_string()&&identity(&string(&id))&&!["__proto__","prototype","constructor"].contains(&string(&id).as_str())&&registers(&fields,64)
 })
}
#[wasm_bindgen]
impl RustLiveRoom{
 #[wasm_bindgen(constructor)]pub fn new(account:String,own:String)->Result<RustLiveRoom,JsValue>{
  if account.is_empty()||account.len()>256||!identity(&own){return Err(error("Invalid live identity"));}
  Ok(Self{account,own,peers:BTreeMap::new(),seen:VecDeque::new(),last_key:String::new(),last_packet:String::new(),motion_sequence:0,motion_seen:BTreeMap::new()})
 }
 pub fn observe(&mut self,files:JsValue,now:f64)->JsValue{
  let actions=Array::new();
  let stale:Vec<String>=self.peers.iter().filter(|(_,p)|p.status!=2&&js_sys::Date::parse(&p.modified)<now-90000.0).map(|(id,_)|id.clone()).collect();
  for id in stale{self.peers.remove(&id);actions.push(&Array::of3(&"close".into(),&id.into(),&JsValue::NULL));}
  // Old per-session mailboxes stay in Drive. Never let the first 64 stale
  // files hide the active phone/browser further down a paginated listing.
  let mut files:Vec<_>=Array::from(&files).iter().collect();
  files.sort_by(|a,b|js_sys::Date::parse(&string(&get(b,"modifiedTime"))).total_cmp(&js_sys::Date::parse(&string(&get(a,"modifiedTime")))));
  let mut discovered=BTreeSet::new();
  for file in files{
   let name=string(&get(&file,"name"));let Some(peer)=name.strip_prefix("live-v1-").and_then(|n|n.strip_suffix(".json"))else{continue;};
   if peer==self.own||!identity(peer){continue;}
   let modified=string(&get(&file,"modifiedTime"));let at=js_sys::Date::parse(&modified);
   if !at.is_finite()||at<now-90000.0||at>now+120000.0{continue;}
   if !discovered.insert(peer.to_owned()){continue;}
   if !self.peers.contains_key(peer)&&self.peers.len()>=MAX_PEERS{continue;}
   let p=self.peers.entry(peer.to_owned()).or_insert_with(||Peer{started:now,..Peer::default()});p.file=string(&get(&file,"id"));
   if p.modified!=modified||p.read<0.0{p.modified=modified;actions.push(&Array::of3(&"read".into(),&peer.into(),&p.file.clone().into()));p.read=now;}
   if self.own.as_str()<peer&&(p.status==0||p.status==3&&now>=p.retry){p.status=1;p.started=now;actions.push(&Array::of3(&"offer".into(),&peer.into(),&p.file.clone().into()));}
  }
  actions.into()
 }
 pub fn pending(&mut self,now:f64)->JsValue{
  let actions=Array::new();
  for(peer,p)in &mut self.peers{
   if p.status==1&&now-p.started>12000.0{p.status=3;p.failures=p.failures.saturating_add(1);p.retry=now+(1000.0*2f64.powi(p.failures.min(4) as i32)).min(15000.0);actions.push(&Array::of3(&"close".into(),&peer.as_str().into(),&p.file.as_str().into()));}
   else if p.status<2&&now-p.started<=12000.0&&now-p.read>=300.0{p.read=now;actions.push(&Array::of3(&"read".into(),&peer.as_str().into(),&p.file.as_str().into()));}
  }actions.into()
 }
 pub fn readFailed(&mut self,peer:String){if let Some(p)=self.peers.get_mut(&peer){p.read=-1.0;}}
 pub fn forgetSnapshot(&mut self,id:String){self.seen.retain(|known|known!=&id);}
 pub fn receiveStateRelay(&mut self,peer:String,envelope:JsValue)->JsValue{
  if !self.peers.contains_key(&peer){return JsValue::NULL;}
  let Some(encoded)=get(&envelope,"packet").as_string().filter(|s|s.len()<=MAX_PACKET)else{return JsValue::NULL;};
  let Ok(packet)=JSON::parse(&encoded)else{return JsValue::NULL;};
  if string(&get(&packet,"from"))!=peer{return JsValue::NULL;}
  // Registers carry their own monotonic versions. A returning device may
  // legitimately need an old checkpoint; it cannot overwrite newer fields.
  self.receive(encoded)
 }
 pub fn beginOffer(&mut self,peer:String,nonce:String,now:f64)->bool{
  if self.own>=peer||!identity(&nonce)||nonce.len()<16{return false;}let Some(p)=self.peers.get_mut(&peer)else{return false;};
  p.nonce=nonce;p.status=1;p.started=now;true
 }
 pub fn signal(&mut self,peer:String,payload:JsValue,now:f64)->JsValue{
  if string(&get(&payload,"account"))!=self.account||string(&get(&payload,"from"))!=peer||string(&get(&payload,"to"))!=self.own{return JsValue::NULL;}
  let kind=string(&get(&payload,"type"));let nonce=string(&get(&payload,"nonce"));let sdp=string(&get(&payload,"sdp"));let at=number(&get(&payload,"at"));
  if !identity(&nonce)||nonce.len()<16||!sdp.starts_with("v=0")||sdp.len()>32000||!at.is_finite()||(now-at).abs()>120000.0{return JsValue::NULL;}
  let Some(p)=self.peers.get_mut(&peer)else{return JsValue::NULL;};
  if kind=="offer"&&self.own>peer{
   if p.nonce==nonce&&p.status!=3{if p.sdp==sdp{return JsValue::NULL;}p.sdp=sdp;return payload;}p.nonce=nonce;p.sdp=sdp;p.status=1;p.started=now;return payload;
  }
  if kind=="answer"&&self.own<peer&&(p.status==1||p.status==2)&&p.nonce==nonce{if p.sdp==sdp{return JsValue::NULL;}p.sdp=sdp;return payload;}
  JsValue::NULL
 }
 pub fn connected(&mut self,peer:String){if let Some(p)=self.peers.get_mut(&peer){p.status=2;p.failures=0;}}
 pub fn failed(&mut self,peer:String,now:f64){if let Some(p)=self.peers.get_mut(&peer){p.status=3;p.failures=p.failures.saturating_add(1);p.retry=now+(1000.0*2f64.powi(p.failures.min(4) as i32)).min(15000.0);}}
 #[wasm_bindgen(getter)]pub fn connectedCount(&self)->usize{self.peers.values().filter(|p|p.status==2).count()}
 #[wasm_bindgen(getter)]pub fn peerCount(&self)->usize{self.peers.len()}
 pub fn receiveRelay(&mut self,peer:String,envelope:JsValue,now:f64)->JsValue{
  let at=get(&envelope,"at").as_f64().unwrap_or(f64::NAN);
  if !now.is_finite()||!at.is_finite()||(now-at).abs()>6000.0||!self.peers.contains_key(&peer){return JsValue::NULL;}
  let Some(encoded)=get(&envelope,"packet").as_string().filter(|s|s.len()<=98304)else{return JsValue::NULL;};
  let Ok(packet)=JSON::parse(&encoded)else{return JsValue::NULL;};
  if string(&get(&packet,"from"))!=peer{return JsValue::NULL;}
  self.receiveMotion(encoded)
 }
 pub fn publish(&mut self,snapshot:JsValue,id:String)->Result<JsValue,JsValue>{
  if !valid_snapshot(&snapshot)||!identity(&id){return Ok(JsValue::NULL);}
  let key=snapshot_key(&snapshot)?;let packet=object(&[("v",1.into()),("account",self.account.clone().into()),("from",self.own.clone().into()),("id",id.into()),("snapshot",snapshot)]);
  let encoded=JSON::stringify(&packet)?.as_string().unwrap_or_default();if encoded.len()>MAX_PACKET{return Ok(JsValue::NULL);}
  self.last_packet=encoded.clone();if key==self.last_key{return Ok(JsValue::NULL);}self.last_key=key;Ok(encoded.into())
 }
 #[wasm_bindgen(getter)]pub fn latest(&self)->String{self.last_packet.clone()}
 pub fn publishMotion(&mut self,frame:JsValue)->Result<JsValue,JsValue>{
  if !crate::room_motion::valid(&frame){return Ok(JsValue::NULL);}
  self.motion_sequence=self.motion_sequence.wrapping_add(1).max(number(&get(&frame,"sequence")) as u64);set(&frame,"sequence",&(self.motion_sequence as f64).into());
  set(&frame,"v",&1.into());set(&frame,"t",&"room-motion".into());set(&frame,"account",&self.account.clone().into());set(&frame,"from",&self.own.clone().into());
  let encoded=json(&frame)?;Ok(if encoded.len()<=98304{encoded.into()}else{JsValue::NULL})
 }
 pub fn receiveMotion(&mut self,encoded:String)->JsValue{
  if encoded.len()>98304{return JsValue::NULL;}let Ok(packet)=JSON::parse(&encoded)else{return JsValue::NULL;};
  if get(&packet,"v").as_f64()!=Some(1.0)||string(&get(&packet,"t"))!="room-motion"||string(&get(&packet,"account"))!=self.account{return JsValue::NULL;}
  let source=string(&get(&packet,"from"));if source==self.own||!identity(&source)||!crate::room_motion::valid(&packet){return JsValue::NULL;}
  let sequence=number(&get(&packet,"sequence"));if self.motion_seen.get(&source).is_some_and(|n|*n>=sequence){return JsValue::NULL;}
  if self.motion_seen.len()>=128&&!self.motion_seen.contains_key(&source){if let Some(first)=self.motion_seen.keys().next().cloned(){self.motion_seen.remove(&first);}}
  self.motion_seen.insert(source,sequence);packet
 }
 pub fn receive(&mut self,encoded:String)->JsValue{
  if encoded.len()>MAX_PACKET{return JsValue::NULL;}let Ok(packet)=JSON::parse(&encoded)else{return JsValue::NULL;};
  if get(&packet,"v").as_f64()!=Some(1.0)||string(&get(&packet,"account"))!=self.account{return JsValue::NULL;}
  let source=string(&get(&packet,"from"));let id=string(&get(&packet,"id"));
  if source==self.own||!identity(&source)||!identity(&id){return JsValue::NULL;}
  if self.seen.contains(&id){return object(&[("id",id.into()),("duplicate",JsValue::TRUE)]);}
  let snapshot=get(&packet,"snapshot");if !valid_snapshot(&snapshot){return JsValue::NULL;}
  let Ok(key)=snapshot_key(&snapshot)else{return JsValue::NULL;};self.last_key=key;
  self.seen.push_back(id.clone());if self.seen.len()>128{self.seen.pop_front();}
  object(&[("id",id.into()),("snapshot",snapshot)])
 }
}
