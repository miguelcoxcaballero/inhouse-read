//! Small client-side runtime ledger shared by web Worker and native ONNX hosts.
//! No inference/model/PCM buffers enter this state. Host handles stay outside.
use std::collections::HashSet;

pub struct Client {
 seq:f64, generation:f64, calls:HashSet<u64>, jobs:HashSet<u64>,
 key:Vec<u16>, loaded:Vec<u16>, has_loaded:bool, preparing:Vec<u16>, has_preparation:bool,
}
#[no_mangle]
pub extern "C" fn voice_client_new(seq:f64,generation:f64)->*mut Client {
 Box::into_raw(Box::new(Client {seq,generation,calls:HashSet::new(),jobs:HashSet::new(),key:Vec::new(),loaded:Vec::new(),has_loaded:false,preparing:Vec::new(),has_preparation:false}))
}
#[no_mangle]
pub unsafe extern "C" fn voice_client_free(client:*mut Client){if !client.is_null(){drop(Box::from_raw(client));}}
#[no_mangle]
pub unsafe extern "C" fn voice_client_field(client:*const Client,field:u32)->f64{
 let Some(client)=client.as_ref()else{return f64::NAN};
 match field{0=>client.seq,1=>client.generation,2=>client.calls.len()as f64,3=>client.jobs.len()as f64,_=>f64::NAN}
}
#[no_mangle]
pub unsafe extern "C" fn voice_client_current(client:*const Client,generation:f64)->u32{
 client.as_ref().is_some_and(|state|state.generation==generation)as u32
}
#[no_mangle]
pub unsafe extern "C" fn voice_client_reset(client:*mut Client){
 if let Some(state)=client.as_mut(){state.generation+=1.0;state.calls.clear();state.jobs.clear();state.loaded.clear();state.has_loaded=false;state.preparing.clear();state.has_preparation=false;}
}
#[no_mangle]
pub unsafe extern "C" fn voice_client_next(client:*mut Client,kind:u32)->f64{
 let Some(state)=client.as_mut()else{return f64::NAN};state.seq+=1.0;
 if kind==1{state.calls.insert(state.seq.to_bits());}else{state.jobs.insert(state.seq.to_bits());}state.seq
}
#[no_mangle]
pub unsafe extern "C" fn voice_client_active(client:*const Client,id:f64,generation:f64)->u32{
 client.as_ref().is_some_and(|state|state.generation==generation&&state.jobs.contains(&id.to_bits()))as u32
}
#[no_mangle]
pub unsafe extern "C" fn voice_client_cancel(client:*mut Client,id:f64)->u32{
 client.as_mut().is_some_and(|state|state.jobs.remove(&id.to_bits()))as u32
}
#[no_mangle]
pub unsafe extern "C" fn voice_client_key_buffer(client:*mut Client,length:usize)->*mut u16{
 let Some(state)=client.as_mut()else{return std::ptr::null_mut()};
 if length>1_048_576{return std::ptr::null_mut()};state.key.resize(length,0);state.key.as_mut_ptr()
}
fn supertonic(key:&[u16])->bool{key.iter().copied().eq("supertonic3".encode_utf16())}
// 0 model matches; 1 runtime family needs replacement; 2 install model;
// 3 clear the runtime's owned calls/jobs/model, retaining sequence/generation;
// 5 same pending preparation, 6 begin preparation, 7 finish, 8 idle cache hit.
#[no_mangle]
pub unsafe extern "C" fn voice_client_model(client:*mut Client,operation:u32)->u32{
 let Some(state)=client.as_mut()else{return 0};
 match operation{
  0=>(state.has_loaded&&state.loaded==state.key)as u32,
  1=>(state.has_loaded&&supertonic(&state.loaded)!=supertonic(&state.key))as u32,
  2=>{state.loaded.clone_from(&state.key);state.has_loaded=true;1},
  3=>{state.loaded.clear();state.has_loaded=false;state.calls.clear();state.jobs.clear();1},
  4=>supertonic(&state.key)as u32,
  5=>(state.has_preparation&&state.preparing==state.key)as u32,
  6=>{state.preparing.clone_from(&state.key);state.has_preparation=true;1},
  7=>{state.preparing.clear();state.has_preparation=false;1},
  8=>(!state.has_preparation&&state.has_loaded&&state.loaded==state.key)as u32,
  _=>0,
 }
}
fn integer(value:f64)->bool{value.is_finite()&&value.fract()==0.0}
// Input kind: unknown 0, stage 1, error 2, plan 3, chunk 4, end 5.
// Action: ignore 0, resolve call 1, reject call 2, plan 3, chunk 4, end 5,
//         fail job 6, passive diagnostic 7. Settlement happens exactly once.
#[no_mangle]
pub unsafe extern "C" fn voice_client_message(client:*mut Client,kind:u32,id:f64,domain:f64,stage:f64,part:f64)->u32{
 let Some(state)=client.as_mut()else{return 0};
 if kind==1{return (matches!(domain,1.0|2.0|3.0)&&integer(stage)&&(1.0..=7.0).contains(&stage)
  &&integer(id)&&id.abs()<=9_007_199_254_740_991.0&&integer(part)&&part>=0.0)as u32*7;}
 let id=id.to_bits();
 if state.calls.remove(&id){return if kind==2{2}else{1};}
 if !state.jobs.contains(&id){return 0;}
 match kind{3=>3,4=>4,5=>{state.jobs.remove(&id);5},2=>{state.jobs.remove(&id);6},_=>0}
}
