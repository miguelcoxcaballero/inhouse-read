//! Drive uses stable file identities and metres, independent of viewport and local IDs.
use wasm_bindgen::prelude::*;
use js_sys::{Array,JSON};
use crate::cloud_host::*;

pub const KEY:&str="inhouse-read-shelf-physics-v1";
/// A passive solver may round/rest a shared pose, but must not publish that
/// recalculation as an edit. Real membership, geometry or semantic-placement
/// changes still need a fresh physical room, even for keyboard/import paths.
#[wasm_bindgen]
pub fn room_physics_passive_compatible(a:JsValue,b:JsValue)->bool{
 fn rows(value:&JsValue)->Option<(String,Vec<JsValue>)>{
  let root=JSON::parse(&value.as_string()?).ok()?;if !Array::is_array(&root){return None;}let root=Array::from(&root);
  if root.length()!=3||root.get(0).as_f64()!=Some(2.0)||!Array::is_array(&root.get(1))||!Array::is_array(&root.get(2)){return None;}
  let layout=Array::from(&root.get(1));if layout.length()!=2||layout.get(0).as_f64()!=Some(20261018.0){return None;}
  let mut rows:Vec<_>=Array::from(&root.get(2)).iter().collect();if rows.len()>10000{return None;}
  for row in &rows{if !Array::is_array(row){return None;}let row=Array::from(row);
   if ![8,9].contains(&row.length())||!row.get(0).is_string(){return None;}
   for (i,len) in [(2,4),(3,3),(4,4)]{if !Array::is_array(&row.get(i)){return None;}let v=Array::from(&row.get(i));
    if v.length()!=len||!v.iter().all(|v|v.as_f64().is_some_and(f64::is_finite)){return None;}}
  }
  rows.sort_by_key(|v|string(&Array::from(v).get(0)));Some((json(&layout.into()).ok()?,rows))
 }
 let Some((layout,a))=rows(&a)else{return false;};let Some((other,b))=rows(&b)else{return false;};if layout!=other||a.len()!=b.len(){return false;}
 a.iter().zip(b).all(|(a,b)|{let a=Array::from(a);let b=Array::from(&b);
  if a.get(0)!=b.get(0)||a.get(1)!=b.get(1)||a.get(8)!=b.get(8){return false;}
  let base_a=Array::from(&a.get(2));let base_b=Array::from(&b.get(2));
  if base_a.get(2)!=base_b.get(2)||(0..2).any(|i|(number(&base_a.get(i))-number(&base_b.get(i))).abs()>0.003){return false;}
  [3,4].iter().all(|i|Array::from(&a.get(*i)).iter().zip(Array::from(&b.get(*i)).iter()).all(|(a,b)|(number(&a)-number(&b)).abs()<0.0001))
 })
}
fn rounded(n:f64)->JsValue{((n*1e6).round()/1e6).into()}
#[wasm_bindgen]
pub fn room_physics_for_cloud(value:JsValue,books:JsValue)->JsValue{
 convert(value,books,true,true)
}
#[wasm_bindgen]
pub fn room_physics_for_device(value:JsValue,books:JsValue)->JsValue{
 convert(value,books,false,false)
}
fn convert(value:JsValue,books:JsValue,cloud:bool,shared_only:bool)->JsValue{
 let run=||->Result<JsValue,JsValue>{
  let root=JSON::parse(&value.as_string().ok_or_else(||error("Missing room"))?)?;
  if !Array::is_array(&root){return Ok(value.clone());}
  let root=Array::from(&root);
  if root.length()!=3||!Array::is_array(&root.get(2)){return Ok(value.clone());}
  // Only schema 2 is portable. Old local scenes remain local until the solver
  // has emitted their validated, settled replacement.
  if root.get(0).as_f64()!=Some(2.0){return Ok(value.clone());}
  let rows=Array::from(&root.get(2));
  for (index,row) in rows.iter().enumerate(){
   let row=Array::from(&row);let name=row.get(0);
   for book in Array::from(&books).iter(){
    let id=get(&book,"id");let drive=get(&book,"driveFileId");
    if !id.is_string()||!drive.is_string()||!drive.is_truthy(){continue;}
    let local=call(&JsValue::from_str("book:"),"concat",&[&id])?;
    let shared=call(&JsValue::from_str("book:drive:"),"concat",&[&drive])?;
    let (from,to)=if cloud{(local,shared)}else{(shared,local)};
    if name==from{row.set(0,to);break;}
   }
   if cloud&&row.length()>=8{
    let base=Array::from(&row.get(2));let size=Array::from(&row.get(3));let bay=Array::from(&row.get(4));
    if base.length()!=4||size.length()!=3||bay.length()!=4{return Ok(value.clone());}
    let (left,bottom)=(number(&bay.get(0)),number(&bay.get(2)));
    for (index,origin) in [(0,left),(1,bottom)]{base.set(index,rounded(number(&base.get(index))-origin));}
    base.set(3,1.into());
    for i in 0..3{size.set(i,rounded(number(&size.get(i))));}
    bay.set(1,rounded(number(&bay.get(1))-left));bay.set(3,rounded(number(&bay.get(3))-bottom));bay.set(0,0.into());bay.set(2,0.into());
    row.set(5,rounded(number(&row.get(5))-left));row.set(6,rounded(number(&row.get(6))-bottom));row.set(7,rounded(number(&row.get(7))));
    row.set(2,base.into());row.set(3,size.into());row.set(4,bay.into());
   }
   rows.set(index as u32,row.into());
  }
  if cloud{
   let mut sorted:Vec<JsValue>=rows.iter().filter(|row|{
    let key=string(&Array::from(row).get(0));!shared_only||!key.starts_with("book:")||key.starts_with("book:drive:")
   }).collect();
   sorted.sort_by(|a,b|{let a=Array::from(a).get(0);let b=Array::from(b).get(0);if a.lt(&b){std::cmp::Ordering::Less}else if a.gt(&b){std::cmp::Ordering::Greater}else{std::cmp::Ordering::Equal}});
   rows.set_length(0);for row in sorted{rows.push(&row);}
  }
  root.set(2,rows.into());
  if cloud{
   let layout=Array::from(&root.get(1));
   let metal=if layout.get(0).as_f64()==Some(20261018.0){layout.get(1).as_f64()==Some(1.0)}else{layout.length()%6==3&&layout.get(layout.length().saturating_sub(1)).as_f64()==Some(1.0)};
   root.set(1,Array::of2(&20261018.0.into(),&if metal{1.0.into()}else{0.0.into()}).into());
  }
  Ok(JSON::stringify(&root)?.into())
 };
 run().unwrap_or(value)
}

/// A shared pose is relative to its bay. CSS rounding can move the semantic
/// placement anchor by a fraction of a pixel without moving the physical body.
/// Retain the original register for that case; otherwise peers would restamp
/// one another's equivalent resting room after every refresh.
#[wasm_bindgen]
pub fn room_physics_equivalent(a:JsValue,b:JsValue)->bool{
 fn signature(value:&JsValue)->Result<String,JsValue>{
  let source=value.as_string().ok_or(JsValue::NULL)?;let parsed=JSON::parse(&source)?;
  if !Array::is_array(&parsed){return Ok(source);}let root=Array::from(&parsed);
  let layout=Array::from(&root.get(1));
  if root.get(0).as_f64()!=Some(2.0)||layout.length()!=2||layout.get(0).as_f64()!=Some(20261018.0){return Ok(source);}
  if !Array::is_array(&root.get(2)){return Err(JsValue::NULL);}
  for row in Array::from(&root.get(2)).iter(){
   if !Array::is_array(&row){return Err(JsValue::NULL);}let row=Array::from(&row);
   if !Array::is_array(&row.get(2)){return Err(JsValue::NULL);}let base=Array::from(&row.get(2));
   if base.length()!=4{return Err(JsValue::NULL);}set(&row.get(2),"0",&0.into());set(&row.get(2),"1",&0.into());
  }
  Ok(JSON::stringify(&parsed)?.as_string().unwrap_or_default())
 }
 a==b||signature(&a).ok().zip(signature(&b).ok()).is_some_and(|(a,b)|a==b)
}

/// Stable room revision shared by live previews and durable checkpoints.
/// Semantic pixel anchors are excluded; physical positions and geometry remain.
#[wasm_bindgen]
pub fn room_physics_revision(value:JsValue,books:JsValue)->String{
 let canonical=room_physics_for_cloud(value,books);
 let Some(encoded)=canonical.as_string()else{return String::new();};
 let Ok(parsed)=JSON::parse(&encoded)else{return String::new();};
 if !Array::is_array(&parsed){return String::new();}let root=Array::from(&parsed);
 if root.length()!=3||root.get(0).as_f64()!=Some(2.0)||!Array::is_array(&root.get(2)){return String::new();}
 for row in Array::from(&root.get(2)).iter(){
  if !Array::is_array(&row){return String::new();}let row=Array::from(&row);
  if !Array::is_array(&row.get(2)){return String::new();}
  set(&row.get(2),"0",&0.into());set(&row.get(2),"1",&0.into());
 }
 let Ok(encoded)=json(&parsed)else{return String::new();};
 let mut hash=0xcbf29ce484222325u64;
 for unit in encoded.encode_utf16(){for byte in unit.to_le_bytes(){hash^=byte as u64;hash=hash.wrapping_mul(0x100000001b3);}}
 format!("room-{hash:016x}")
}

/// Local storage uses the same physical coordinate system as the wire, while
/// retaining books that have not acquired a Drive identity yet.
#[wasm_bindgen]
pub fn room_physics_canonical(value:JsValue,books:JsValue)->JsValue{
 let canonical=convert(value,books.clone(),true,false);convert(canonical,books,false,false)
}
/// A shared room cannot delete or reposition a device-only book. Conversely,
/// unuploaded local identities must never block another device's restoration.
#[wasm_bindgen]
pub fn room_physics_with_local(value:JsValue,previous:JsValue,books:JsValue)->JsValue{
 let remote=room_physics_canonical(value.clone(),books.clone());
 let local=room_physics_canonical(previous,books.clone());
 let run=||->Option<JsValue>{
  let r=JSON::parse(&remote.as_string()?).ok()?;let l=JSON::parse(&local.as_string()?).ok()?;
  if !Array::is_array(&r)||!Array::is_array(&l){return None;}
  let r=Array::from(&r);let l=Array::from(&l);
  if r.get(0).as_f64()!=Some(2.0)||l.get(0).as_f64()!=Some(2.0)||json(&r.get(1)).ok()?!=json(&l.get(1)).ok()?||!Array::is_array(&r.get(2))||!Array::is_array(&l.get(2)){return None;}
  let rows=Array::from(&r.get(2));
  let private:std::collections::BTreeSet<String>=Array::from(&books).iter().filter(|b|!get(b,"driveFileId").is_truthy()).map(|b|format!("book:{}",string(&get(&b,"id")))).collect();
  let existing:std::collections::BTreeSet<String>=rows.iter().map(|row|string(&Array::from(&row).get(0))).collect();
  for row in Array::from(&l.get(2)).iter(){let key=string(&Array::from(&row).get(0));if private.contains(&key)&&!existing.contains(&key){rows.push(&row);}}
  r.set(2,rows.into());JSON::stringify(&r).ok().map(JsValue::from)
 };run().unwrap_or(remote)
}
