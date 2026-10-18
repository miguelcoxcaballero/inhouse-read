//! Bounded room-packet framing. Uint8Array buffers remain browser-owned: Rust
//! keeps handles and returns views, without copying outgoing bytes through WASM.
use wasm_bindgen::prelude::*;
use js_sys::{ArrayBuffer,JSON,Uint8Array};
use crate::cloud_host::{get,error};
const LIMIT:u32=2*1024*1024;
const CHUNK:u32=16000;
fn byte_view(data:JsValue)->Option<Uint8Array>{
 if !ArrayBuffer::is_view(&data)||get(&data,"BYTES_PER_ELEMENT").as_f64()!=Some(1.0){return None;}
 if data.is_instance_of::<Uint8Array>(){return Some(data.unchecked_into());}
 // TextEncoder/bridges may return a byte view from another JavaScript realm.
 // Rebind its exact byte window; the underlying ArrayBuffer is shared.
 Some(Uint8Array::new_with_byte_offset_and_length(&get(&data,"buffer"),get(&data,"byteOffset").as_f64()? as u32,get(&data,"byteLength").as_f64()? as u32))
}
struct Sending{data:Uint8Array,offset:u32,header:bool}
struct Receiving{data:Uint8Array,offset:u32}
#[wasm_bindgen]
pub struct RustRoomPacketStream{queued:Option<Uint8Array>,sending:Option<Sending>,receiving:Option<Receiving>}
impl RustRoomPacketStream{
 fn accept(&mut self,data:JsValue)->Result<JsValue,JsValue>{
  if let Some(header)=data.as_string(){
   if header.len()>128{return Err(error("Invalid live packet header"));}
   let header=JSON::parse(&header)?;let size=get(&header,"size").as_f64().unwrap_or(f64::NAN);
   if get(&header,"v").as_f64()!=Some(1.0)||!size.is_finite()||size.fract()!=0.0||size<1.0||size>LIMIT as f64||self.receiving.is_some(){return Err(error("Invalid live packet header"));}
   self.receiving=Some(Receiving{data:Uint8Array::new_with_length(size as u32),offset:0});return Ok(JsValue::UNDEFINED);
  }
  let Some(part)=byte_view(data)else{return Err(error("Invalid live packet bytes"));};
  let Some(receiving)=self.receiving.as_mut()else{return Err(error("Missing live packet header"));};
  let size=part.length();if size==0||size>CHUNK||size>receiving.data.length()-receiving.offset{return Err(error("Invalid live packet chunk"));}
  receiving.data.set(&part,receiving.offset);receiving.offset+=size;
  if receiving.offset==receiving.data.length(){return Ok(self.receiving.take().unwrap().data.into());}Ok(JsValue::UNDEFINED)
 }
}
#[wasm_bindgen]
impl RustRoomPacketStream{
 #[wasm_bindgen(constructor)]pub fn new()->Self{Self{queued:None,sending:None,receiving:None}}
 /// Keep a single pending complete packet behind the in-flight one.
 pub fn queue(&mut self,data:JsValue)->bool{
  let Some(data)=byte_view(data)else{return false;};
  if data.length()==0||data.length()>LIMIT{return false;}self.queued=Some(data);true
 }
 /// The host reads RTC.bufferedAmount before asking for the next wire part.
 pub fn next(&mut self)->JsValue{
  if self.sending.is_none(){let Some(data)=self.queued.take()else{return JsValue::UNDEFINED;};self.sending=Some(Sending{data,offset:0,header:false});}
  let sending=self.sending.as_mut().unwrap();
  if !sending.header{sending.header=true;return format!("{{\"v\":1,\"size\":{}}}",sending.data.length()).into();}
  let end=(sending.offset+CHUNK).min(sending.data.length());let part=sending.data.subarray(sending.offset,end);sending.offset=end;
  if end==sending.data.length(){self.sending=None;}part.into()
 }
 pub fn receive(&mut self,data:JsValue)->Result<JsValue,JsValue>{
  let result=self.accept(data);if result.is_err(){self.receiving=None;}result
 }
 pub fn clear(&mut self){self.queued=None;self.sending=None;self.receiving=None;}
}
