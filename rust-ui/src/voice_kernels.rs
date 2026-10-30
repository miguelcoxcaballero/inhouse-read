//! The voice kernels as the synthesis worker and the Android client call them: Piper's phoneme-id bookkeeping, the finishing
//! of every chunk of audio (cleaning, page-boundary placement, tempo, rests), the Supertonic numeric plans, the ONNX duration
//! output and the Hebrew rules. The arithmetic is the voice core's own code (synth_flow.rs, pcm.rs, speech_tempo.rs,
//! supertonic_*.rs, onnx_durations.rs, hebrew.rs), called here on Rust buffers; what JavaScript kept is the browser's own
//! part: Unicode normalisation and properties, Math.log/Math.cos, the random source and the ONNX Runtime objects.
//! Numbers arrive the way the raw core received them (`Number(value)`), strings as their UTF-16 code units.
use std::cell::RefCell;
use wasm_bindgen::{prelude::*,JsCast};
use js_sys::{Array,BigInt64Array,Float32Array,Float64Array,JsString,Object,RegExp,Uint8Array,Uint32Array};
use crate::host::{absent,get,get_at,num,set};
use crate::eager::{eager,settled};

type R<T=JsValue>=Result<T,JsValue>;
const NVCC:&str="no_NO-nvcc-medium";
fn error(message:&str)->JsValue{js_sys::Error::new(message).into()}
fn n(value:f64)->JsValue{JsValue::from_f64(value)}
fn len(value:&JsValue)->f64{num(&get(value,"length"))}
/// ToNumber as a typed array store or a wasm `f64` argument applies it: like `Number(value)`, except that a BigInt or a
/// Symbol is a TypeError.
fn to_number(value:&JsValue)->R<f64>{
 if value.is_bigint(){return Err(js_sys::TypeError::new("Cannot convert a BigInt value to a number").into());}
 if value.is_symbol(){return Err(js_sys::TypeError::new("Cannot convert a Symbol value to a number").into());}
 Ok(num(value))
}
fn units(text:&JsValue)->Vec<u16>{text.unchecked_ref::<JsString>().iter().collect()}
/// `String.fromCharCode` in bounded slices: any code unit, a lone surrogate included.
fn from_units(units:&[u16])->JsString{let mut out=JsString::from("");for part in units.chunks(8192){out=out.concat(&JsString::from_char_code(part));}out}
/// `String.fromCodePoint` in bounded slices (lone surrogates stay as they are).
fn from_points(points:&[u32])->R<JsString>{let mut out=JsString::from("");for part in points.chunks(4096){out=out.concat(&JsString::from_code_point(part)?.into());}Ok(out)}
/// A typed array's element as the raw core stored it: a number, else NaN.
fn number_or_nan(value:&JsValue)->f64{value.as_f64().unwrap_or(f64::NAN)}
/// The UTF-16 code points of `units`: a surrogate pair is one, a lone surrogate is itself.
fn points(units:&[u16])->Vec<u32>{
 let mut out=Vec::with_capacity(units.len());let mut at=0;
 while at<units.len(){let first=units[at] as u32;
  if (0xd800..=0xdbff).contains(&first)&&at+1<units.len()&&(0xdc00..=0xdfff).contains(&(units[at+1] as u32)){out.push(0x10000+((first-0xd800)<<10)+(units[at+1] as u32-0xdc00));at+=2;}
  else{out.push(first);at+=1;}
 }
 out
}
fn record(pairs:&[(&str,JsValue)])->R{let o=Object::new();for (key,value) in pairs{set(&o,key,value)?;}Ok(o.into())}
/// `{...value, sample}`.
fn with_sample(value:&JsValue,sample:f64)->R{let copy=Object::assign(&Object::new(),&Object::from(if value.is_object(){value.clone()}else{Object::new().into()}));set(&copy,"sample",&n(sample))?;Ok(copy.into())}
fn status(code:i32)->R<()>{
 if code==1{return Ok(());}
 Err(error(match code{-2=>"Invalid speech tempo input",-3=>"Too many speech boundaries",-4=>"Voice core: output too small",_=>"Voice core: invalid call"}))
}
/// `raw.length + Math.ceil(sampleRate) + 16`: the room for a chunk with its rests (a broken rate has none).
fn capacity(samples:usize,sample_rate:f64)->R<usize>{
 let room=samples as f64+sample_rate.ceil()+16.0;
 if !(room.is_finite()&&room>=0.0){return Err(error("Rust core: no memory for the call"));}
 Ok(room as usize)
}
/// The ids as `Uint32Array.prototype.set` converts them.
fn ids_of(ids:&JsValue)->Vec<u32>{Uint32Array::new(ids).to_vec()}
fn id_array(ids:&[u32])->Array{Array::from(&Uint32Array::from(ids).into())}

#[wasm_bindgen]
pub fn voice_host_length_scale(base:JsValue,rate:JsValue)->R<f64>{Ok(crate::synth_flow::voice_length_scale(to_number(&base)?,num(&rate)))}
#[wasm_bindgen]
pub fn voice_host_synthesis_rate(rate:JsValue)->f64{crate::synth_flow::voice_synthesis_rate(num(&rate))}
#[wasm_bindgen]
pub fn voice_host_tempo_speed(rate:JsValue)->f64{crate::synth_flow::voice_tempo_speed(num(&rate))}

/// The float32 `scales` of one Piper run at the speaking `rate`: the config's inference values, else the model defaults.
#[wasm_bindgen]
pub fn voice_host_piper_scales(inference:JsValue,rate:JsValue)->R<Float32Array>{
 let field=|key:&str|->R<(f64,u32)>{let value=get(&inference,key);Ok((to_number(&value)?,u32::from(absent(&value))))};
 let ((noise,no_noise),(length,no_length),(width,no_width))=(field("noise_scale")?,field("length_scale")?,field("noise_w")?);
 let mut out=[0f32;3];
 status(unsafe{crate::synth_flow::voice_piper_scales(noise,no_noise,length,no_length,width,no_width,num(&rate),out.as_mut_ptr())})?;
 Ok(Float32Array::from(&out[..]))
}

/// Drops the ids a voice trained with fewer symbols does not know, with their pads.
#[wasm_bindgen]
pub fn voice_host_limit_ids(ids:JsValue,num_symbols:JsValue)->R<Array>{
 if !get(&ids,"length").is_truthy(){return Ok(Array::new());}
 let source=ids_of(&ids);let mut out=vec![0u32;source.len()];
 let written=unsafe{crate::synth_flow::voice_limit_ids(source.as_ptr(),source.len(),num(&num_symbols),out.as_mut_ptr())};
 if written<0{return Err(error("Voice core: invalid call"));}
 Ok(id_array(&out[..written as usize]))
}

/// One id sequence per '^...$' sentence of what piper_phonemize returned, the empty ones dropped.
#[wasm_bindgen]
pub fn voice_host_split_segments(ids:JsValue)->R<Array>{
 if !get(&ids,"length").is_truthy(){return Ok(Array::new());}
 let source=ids_of(&ids);let count=source.len();
 let (mut all,mut lengths)=(vec![0u32;count],vec![0u32;(count>>2)+1]);
 let segments=unsafe{crate::synth_flow::voice_split_segments(source.as_ptr(),count,all.as_mut_ptr(),lengths.as_mut_ptr())};
 if segments<0{return Err(error("Voice core: invalid call"));}
 let out=Array::new();let mut from=0usize;
 for &length in &lengths[..segments as usize]{let to=from+length as usize;out.push(&id_array(&all[from..to]));from=to;}
 Ok(out)
}

/// The finished audio of one sentence of a Piper fragment: `{pcm, marks:[{offset, sample}]}` (see synth-flow.js).
#[wasm_bindgen]
pub fn voice_host_finish_piper(raw:Vec<f32>,durations:Option<Vec<f32>>,points:JsValue,text:JsValue,options:JsValue)->R{
 let mut raw=raw;
 let sample_rate=to_number(&get(&options,"sampleRate"))?;
 let nvcc=get(&options,"model").as_string().is_some_and(|model|model==NVCC);
 let marks=len(&points) as usize;
 let room=capacity(raw.len(),sample_rate)?;
 let phonemes=(0..marks).map(|i|to_number(&get(&get_at(&points,i as u32),"phoneme"))).collect::<R<Vec<f64>>>()?;
 let config=[sample_rate,if nvcc{1.0}else{0.0},num(&get(&options,"rate")),to_number(&get(&options,"base"))?,to_number(&get(&options,"count"))?,
  if get(&options,"last").is_truthy(){1.0}else{0.0},if get(&options,"first").is_truthy(){0.0}else{1.0}];
 let text=units(&text);let durations=durations.unwrap_or_default();
 let (mut pcm,mut records,mut meta)=(vec![0f32;room],vec![0f64;marks*2],[0f64;2]);
 status(unsafe{crate::synth_flow::voice_finish_piper(raw.as_mut_ptr(),raw.len(),durations.as_ptr(),durations.len(),phonemes.as_ptr(),marks,
  text.as_ptr(),text.len(),config.as_ptr(),pcm.as_mut_ptr(),room,records.as_mut_ptr(),meta.as_mut_ptr())})?;
 let found=Array::new();
 for i in 0..meta[1] as usize{
  let offset=get(&get_at(&points,records[i*2] as u32),"offset");
  found.push(&record(&[("offset",offset),("sample",n(records[i*2+1]))])?);
 }
 record(&[("pcm",Float32Array::from(&pcm[..meta[0] as usize]).into()),("marks",found.into())])
}

/// The finished audio of one Supertonic fragment (already at its final speed), or null for a sample that is not a number.
#[wasm_bindgen]
pub fn voice_host_finish_supertonic(raw:Vec<f32>,text:JsValue,timeline:JsValue,options:JsValue)->R{
 let mut raw=raw;
 let sample_rate=to_number(&get(&options,"sampleRate"))?;let room=capacity(raw.len(),sample_rate)?;
 let text=units(&text);let marks=len(&timeline) as usize;
 let samples=(0..marks).map(|i|to_number(&get(&get_at(&timeline,i as u32),"sample"))).collect::<R<Vec<f64>>>()?;
 let config=[sample_rate,num(&get(&options,"rate"))];
 let (mut pcm,mut records,mut meta)=(vec![0f32;room],vec![0f64;marks*2],[0f64;2]);
 let code=unsafe{crate::synth_flow::voice_finish_supertonic(raw.as_mut_ptr(),raw.len(),text.as_ptr(),text.len(),samples.as_ptr(),marks,
  config.as_ptr(),pcm.as_mut_ptr(),room,records.as_mut_ptr(),meta.as_mut_ptr())};
 if code==-2{return Ok(JsValue::NULL);}
 status(code)?;
 let moved=Array::new();
 for i in 0..marks{moved.push(&with_sample(&get_at(&timeline,i as u32),records[i*2+1])?);}
 record(&[("pcm",Float32Array::from(&pcm[..meta[0] as usize]).into()),("marks",moved.into())])
}

/// Speeds a whole utterance up and carries its marks along: `{pcm, marks}`, the very same ones at normal speed.
#[wasm_bindgen]
pub fn voice_host_speed_up(pcm:JsValue,sample_rate:JsValue,rate:JsValue,marks:JsValue)->R{
 let rate=num(&rate);
 if crate::synth_flow::voice_tempo_speed(rate)==1.0||!get(&pcm,"length").is_truthy(){return record(&[("pcm",pcm),("marks",marks)]);}
 let Some(speech)=pcm.dyn_ref::<Float32Array>()else{return Err(error("Invalid speech tempo input"))};
 let speech=speech.to_vec();let found=len(&marks) as usize;
 let samples:Vec<f64>=(0..found).map(|i|{let value=get(&get_at(&marks,i as u32),"sample");
  match value.as_f64(){Some(x) if x.is_finite()&&x.fract()==0.0=>x,_=>f64::NAN}}).collect();
 let config=[to_number(&sample_rate)?,rate];
 let (mut out,mut records,mut meta)=(vec![0f32;speech.len()],vec![0f64;found*2],[0f64;2]);
 let written=unsafe{crate::synth_flow::voice_speed_up(speech.as_ptr(),speech.len(),samples.as_ptr(),found,config.as_ptr(),out.as_mut_ptr(),records.as_mut_ptr(),meta.as_mut_ptr())};
 if written<0{status(written)?;}
 let kept=Array::new();
 for i in 0..meta[0] as usize{kept.push(&with_sample(&get_at(&marks,records[i*2] as u32),records[i*2+1])?);}
 record(&[("pcm",Float32Array::from(&out[..written as usize]).into()),("marks",kept.into())])
}

// ------------------------------------------------------------------------------------------------ Supertonic plans

/// `{sampleRate, chunkSize, latentDim}` of the model's config, or the error the runtime reports.
#[wasm_bindgen]
pub fn voice_host_supertonic_config(config:JsValue,steps:JsValue)->R{
 let ae=get(&config,"ae");let ttl=get(&config,"ttl");let mut out=[0f64;4];
 let code=unsafe{crate::supertonic_runtime::supertonic_runtime_config(num(&get(&ae,"sample_rate")),num(&get(&ae,"base_chunk_size")),
  num(&get(&ttl,"chunk_compress_factor")),num(&get(&ttl,"latent_dim")),num(&get(&ttl,"chunk_compress_factor")),number_or_nan(&steps),out.as_mut_ptr())};
 if code!=0{return Err(error(if code==2{"Pasos Supertonic inválidos"}else{"Dimensiones Supertonic inválidas"}));}
 record(&[("sampleRate",n(out[0])),("chunkSize",n(out[1])),("latentDim",n(out[2]))])
}
#[wasm_bindgen]
pub fn voice_host_supertonic_seconds(predicted:JsValue,rate:JsValue)->f64{crate::supertonic_runtime::supertonic_seconds(num(&predicted),num(&rate))}
#[wasm_bindgen]
pub fn voice_host_supertonic_duration_ok(seconds:f64)->bool{crate::supertonic_runtime::supertonic_duration_ok(seconds)!=0}
#[wasm_bindgen]
pub fn voice_host_supertonic_frames(seconds:f64,sample_rate:f64,chunk:f64)->f64{crate::supertonic_runtime::supertonic_audio_frames(seconds,sample_rate,chunk)}
#[wasm_bindgen]
pub fn voice_host_supertonic_mark_sample(length:f64,before:f64,after:f64)->f64{crate::supertonic_runtime::supertonic_mark_sample(length,before,after)}

/// The model's text ids: `BigInt(indexer[point] ?? -1)` for the code points of `text`, through the host-owned table.
#[wasm_bindgen]
pub fn voice_host_supertonic_ids(text:JsValue,indexer:JsValue)->R<BigInt64Array>{
 let units=units(&text);let mut found=vec![0u32;units.len()];
 let count=unsafe{crate::supertonic_runtime::supertonic_text_points(units.as_ptr(),units.len(),found.as_mut_ptr())};
 let (mut ids,mut converted)=(Vec::with_capacity(count),Vec::new());
 for (index,&point) in found[..count].iter().enumerate(){
  let value=get_at(&indexer,point);
  match value.as_f64(){
   Some(x) if x.fract()==0.0&&x.abs()<9.2e18=>ids.push(x as i64),
   _ if absent(&value)=>ids.push(-1),
   // Anything else gets `BigInt(value)`'s own conversion or its own error, stored as the typed array stores it.
   _=>{converted.push((index,js_sys::BigInt::new(&value).map_err(JsValue::from)?));ids.push(0);}
  }
 }
 let out=BigInt64Array::from(&ids[..]);
 for (index,big) in converted{js_sys::Reflect::set(&out,&n(index as f64),&big)?;}
 Ok(out)
}

/// The boundaries of one chunk `[start, end)`, relative to its start.
#[wasm_bindgen]
pub fn voice_host_supertonic_local_marks(marks:JsValue,start:f64,end:f64)->Array{
 let values:Vec<f64>=(0..len(&marks) as u32).map(|i|number_or_nan(&get_at(&marks,i))).collect();
 let mut out=vec![0f64;values.len()];
 let count=unsafe{crate::supertonic_runtime::supertonic_local_marks(values.as_ptr(),values.len(),start,end,out.as_mut_ptr())};
 Array::from(&Float64Array::from(&out[..count]).into())
}
/// A block of uniforms (two per sample) becomes the arguments of the host's Math.log and Math.cos, in place.
#[wasm_bindgen]
pub fn voice_host_noise_plan(pairs:&mut [f64])->R<()>{
 if unsafe{crate::supertonic_runtime::supertonic_noise_plan(pairs.as_mut_ptr(),pairs.len()/2)}!=1{return Err(error("Plan de ruido inválido"));}
 Ok(())
}
/// The float32 Gaussian samples of a block whose logarithms and cosines the host resolved.
#[wasm_bindgen]
pub fn voice_host_noise_finish(pairs:&[f64])->R<Float32Array>{
 let mut out=vec![0f32;pairs.len()/2];
 if unsafe{crate::supertonic_runtime::supertonic_noise_finish(pairs.as_ptr(),out.len(),out.as_mut_ptr())}!=1{return Err(error("Ruido de voz inválido"));}
 Ok(Float32Array::from(&out[..]))
}
/// Every value a number and the shape `[1, a, b]` holding exactly that many.
#[wasm_bindgen]
pub fn voice_host_style_valid(dims:JsValue,data:&[f64])->bool{
 if !Array::is_array(&dims){return false;}
 let shape:Vec<f64>=(0..len(&dims) as u32).map(|i|number_or_nan(&get_at(&dims,i))).collect();
 unsafe{crate::supertonic_runtime::supertonic_style_valid(shape.as_ptr(),shape.len(),data.as_ptr(),data.len())!=0}
}

/// Where each chunk of one utterance starts in the joined audio (the gap after each one is part of the join).
#[wasm_bindgen]
pub struct VoicePcmJoin{handle:*mut crate::supertonic_runtime::PcmJoin}
#[wasm_bindgen]
impl VoicePcmJoin{
 pub fn append(&mut self,length:f64)->R<f64>{
  let start=unsafe{crate::supertonic_runtime::supertonic_join_append(self.handle,to_usize(length))};
  if start==-2.0{return Err(error("Audio demasiado largo"));}
  Ok(start)
 }
 #[wasm_bindgen(getter)]
 pub fn length(&self)->f64{unsafe{crate::supertonic_runtime::supertonic_join_length(self.handle) as f64}}
 pub fn dispose(&mut self){if !self.handle.is_null(){unsafe{crate::supertonic_runtime::supertonic_join_free(self.handle)};self.handle=std::ptr::null_mut();}}
}
impl Drop for VoicePcmJoin{fn drop(&mut self){self.dispose();}}
#[wasm_bindgen]
pub fn voice_host_pcm_join(sample_rate:JsValue)->R<VoicePcmJoin>{
 let handle=crate::supertonic_runtime::supertonic_join_new(num(&sample_rate));
 if handle.is_null(){return Err(error("Duración de audio fuera de rango"));}
 Ok(VoicePcmJoin{handle})
}
/// The runtime's one-utterance-at-a-time ledger and its disposal.
#[wasm_bindgen]
pub struct VoiceRuntimeState{handle:*mut crate::supertonic_runtime::RuntimeState}
#[wasm_bindgen]
impl VoiceRuntimeState{
 pub fn begin(&mut self,valid:bool,rate:JsValue)->f64{unsafe{crate::supertonic_runtime::supertonic_state_begin(self.handle,u32::from(valid),number_or_nan(&rate))}}
 pub fn finish(&mut self,token:f64){if !self.handle.is_null(){unsafe{crate::supertonic_runtime::supertonic_state_finish(self.handle,to_u32(token))}}}
 pub fn active(&self)->bool{unsafe{crate::supertonic_runtime::supertonic_state_active(self.handle)!=0}}
 pub fn close(&mut self)->bool{unsafe{crate::supertonic_runtime::supertonic_state_close(self.handle)!=0}}
 pub fn dispose(&mut self){if !self.handle.is_null(){unsafe{crate::supertonic_runtime::supertonic_state_free(self.handle)};self.handle=std::ptr::null_mut();}}
}
impl Drop for VoiceRuntimeState{fn drop(&mut self){self.dispose();}}
#[wasm_bindgen]
pub fn voice_host_runtime_state()->VoiceRuntimeState{VoiceRuntimeState{handle:crate::supertonic_runtime::supertonic_state_new()}}
/// A JavaScript number as a wasm `i32` argument receives it (ToInt32), read back unsigned.
fn to_u32(value:f64)->u32{if value.is_finite(){value.trunc().rem_euclid(4294967296.0) as u32}else{0}}
fn to_usize(value:f64)->usize{to_u32(value) as usize}

/// `<lang>text</lang>` for the model, or '' when nothing speakable is left. `text` is already NFKD-decomposed by the host.
#[wasm_bindgen]
pub fn voice_host_supertonic_normalize(text:JsValue,lang:JsValue)->R<JsString>{
 let (value,lang)=(units(&text),units(&lang));let room=value.len()*8+64;let mut out=vec![0u16;room];
 let written=unsafe{crate::supertonic_text::supertonic_normalize(value.as_ptr(),value.len(),lang.as_ptr(),lang.len(),out.as_mut_ptr(),room)};
 if written<0{return Err(error("Texto de voz inválido"));}
 Ok(from_units(&out[..written as usize]))
}
/// The chunks of at most `limit` code points of `text` (300, 120 for Korean and Japanese), each a slice of it.
#[wasm_bindgen]
pub fn voice_host_supertonic_chunks(text:JsValue,limit:usize)->R<Array>{
 let value=units(&text);let room=(value.len()>>5)+4;let mut ranges=vec![0u32;room*2];
 let found=unsafe{crate::supertonic_text::supertonic_chunks(value.as_ptr(),value.len(),limit,ranges.as_mut_ptr(),room)};
 if found<0{return Err(error("Texto de voz inválido"));}
 let text=text.unchecked_into::<JsString>();
 Ok((0..found as usize).map(|i|JsValue::from(text.slice(ranges[i*2],ranges[i*2+1]))).collect())
}

// ------------------------------------------------------------------------------------------------ Piper alignment

struct Scan(*mut crate::onnx_durations::Scan);
impl Drop for Scan{fn drop(&mut self){unsafe{crate::onnx_durations::onnx_scan_free(self.0)}}}
/// The model with VITS' phoneme durations exposed as a second output, and that output's name (null for an unknown graph).
/// The model stays in its own buffer: the scan asks for windows of it and skips the weights by their length.
#[wasm_bindgen]
pub fn voice_host_expose_durations(input:JsValue)->R{
 let bytes:Uint8Array=if input.is_instance_of::<Uint8Array>(){input.unchecked_into()}else{Uint8Array::new(&input)};
 let scan=crate::onnx_durations::onnx_scan_new(bytes.length() as f64);
 if scan.is_null(){return Err(error("Voice core: cannot scan the model"));}
 let scan=Scan(scan);let mut info=[0f64;6];
 loop{
  let step=unsafe{crate::onnx_durations::onnx_scan_step(scan.0)};
  if step==0{break;}
  if step!=1{return Err(error("Voice core: invalid model scan"));}
  unsafe{crate::onnx_durations::onnx_scan_want(scan.0,info.as_mut_ptr())};
  let (start,length)=(info[0],info[1]);
  let window=unsafe{crate::onnx_durations::onnx_scan_window(scan.0,length)};
  if window.is_null(){return Err(error("Voice core: no memory for the model scan"));}
  let target=unsafe{std::slice::from_raw_parts_mut(window,length as usize)};
  bytes.subarray(start as u32,(start+length) as u32).copy_to(target);
 }
 let mode=unsafe{crate::onnx_durations::onnx_scan_result(scan.0,info.as_mut_ptr())};
 if mode==0{return record(&[("bytes",bytes.into()),("name",JsValue::NULL)]);}
 if mode!=1&&mode!=2{return Err(error("Voice core: invalid model scan"));}
 let [begin,data,end,name_length,header_length,output_length]=info.map(|value|value as u32);
 let name=from_units(unsafe{std::slice::from_raw_parts(crate::onnx_durations::onnx_scan_name(scan.0),name_length as usize)});
 if mode==1{return record(&[("bytes",bytes.into()),("name",name.into())]);}
 let header=unsafe{std::slice::from_raw_parts(crate::onnx_durations::onnx_scan_header(scan.0),header_length as usize)};
 let output=unsafe{std::slice::from_raw_parts(crate::onnx_durations::onnx_scan_output(scan.0),output_length as usize)};
 let total=bytes.length();
 let result=Uint8Array::new_with_length(begin+header_length+end-data+output_length+total-end);
 let mut at=0;
 for part in [bytes.subarray(0,begin),Uint8Array::from(header),bytes.subarray(data,end),Uint8Array::from(output),bytes.subarray(end,total)]{
  result.set(&part,at);at+=part.length();
 }
 record(&[("bytes",result.into()),("name",name.into())])
}

/// `numbers(values)`: every entry as a number, anything else NaN.
fn numbers(values:&JsValue)->Vec<f64>{(0..len(values) as u32).map(|i|number_or_nan(&get_at(values,i))).collect()}
/// The page boundaries of an utterance as `{offset, phoneme}`: each prefix is phonemized (acoustic inference still runs once
/// for the whole sentence) and its leading phonemes that agree with the whole text's place the boundary.
#[wasm_bindgen]
pub fn voice_host_phoneme_marks(text:JsValue,marks:JsValue,ids:JsValue,phonemize:js_sys::Function)->js_sys::Promise{
 eager(async move{
  let requested=if marks.is_truthy(){numbers(&js_sys::Array::from(&js_sys::Set::new(&marks).values().into()).into())}else{Vec::new()};
  let mut offsets=vec![0f64;requested.len()];
  let found=unsafe{crate::onnx_durations::voice_mark_offsets(requested.as_ptr(),requested.len(),len(&text),offsets.as_mut_ptr())};
  if found<0{return Err(error("Voice core: invalid call"));}
  offsets.truncate(found as usize);
  let (output,whole)=(Array::new(),numbers(&ids));let text=text.unchecked_into::<JsString>();
  for offset in offsets{
   let prefix=numbers(&settled(phonemize.call1(&JsValue::UNDEFINED,&text.slice(0,offset as u32))?).await?);
   let phoneme=unsafe{crate::onnx_durations::voice_prefix_phonemes(prefix.as_ptr(),prefix.len(),whole.as_ptr(),whole.len())};
   if phoneme<0{return Err(error("Voice core: invalid call"));}
   if phoneme>0{output.push(&record(&[("offset",n(offset)),("phoneme",n(f64::from(phoneme)))])?);}
  }
  Ok(output.into())
 })
}

// ------------------------------------------------------------------------------------------------ Hebrew

thread_local!{
 static PATTERNS:RefCell<Option<[RegExp;4]>>=const{RefCell::new(None)};
}
/// TAAMIM (global), PYTHON_WHITESPACE, \p{M}, \p{Decimal_Number}: the browser's Unicode tables.
fn pattern(index:usize)->RegExp{
 PATTERNS.with(|cell|{
  cell.borrow_mut().get_or_insert_with(||[RegExp::new("[\\u0591-\\u05AF]","gu"),
   RegExp::new("[\\u0009-\\u000D\\u001C-\\u0020\\u0085\\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000]+","u"),
   RegExp::new("\\p{M}","u"),RegExp::new("\\p{Decimal_Number}","u")])[index].clone()
 })
}
fn hebrew_mark(code:u32)->bool{matches!(code,0x5b0..=0x5bd|0x5bf|0x5c1|0x5c2|0x5c4|0x5c5|0x5c7)}
/// The marks the rules look at, one bit each (rust-core/src/hebrew.rs): 05B0..05BC, rafe, shin dot, sin dot, qamats qatan.
fn mark_bit(code:u32)->u32{match code{0x5b0..=0x5bc=>1<<(code-0x5b0),0x5bf=>1<<13,0x5c1=>1<<14,0x5c2=>1<<15,0x5c7=>1<<16,_=>0}}
fn letter_of(code:u32)->JsString{JsString::from_code_point(&[code]).unwrap_or_else(|_|JsString::from(""))}
fn nfd_units(text:&JsString)->Vec<u16>{text.normalize("NFD").iter().collect()}
/// Python's `unicodedata.combining` is the canonical class, not the Mark category (CGJ has class 0): canonical reordering
/// past a class-1 or class-240 sentinel identifies every nonzero class.
fn combining(code:u32)->bool{
 if hebrew_mark(code){return true;}
 let letter=letter_of(code);
 if !pattern(2).test(&String::from(letter.clone())){return false;}
 let own:Vec<u16>=letter.iter().collect();
 nfd_units(&letter.concat(&JsString::from("\u{334}").into())).first()==Some(&0x334)
  ||nfd_units(&JsString::from("\u{345}").concat(&letter.into())).starts_with(&own)
}
const WORD_BREAK:u32=0xfffffffe;
/// The IPA of a Hebrew text with niqqud: words joined by a space, as upstream does.
#[wasm_bindgen]
pub fn voice_host_hebrew_ipa(text:JsValue)->R<JsString>{
 let source=JsString::from(crate::host::text_value(&text));
 let words=source.replace_by_pattern(&pattern(0),"").normalize("NFC").split_by_pattern(&pattern(1));
 let mut packet:Vec<u32>=Vec::new();let mut index=0;
 for word in words.iter(){
  let word=word.unchecked_into::<JsString>();
  if word.length()==0{continue;}
  if index>0{packet.extend([WORD_BREAK,0]);}
  index+=1;
  // A mark before any letter of the word belongs to nothing.
  let mut open=false;
  for code in points(&word.replace_by_pattern(&pattern(0),"").normalize("NFC").iter().collect::<Vec<u16>>()){
   if !combining(code){packet.extend([code,0]);open=true;}
   else if open{let last=packet.len()-1;packet[last]|=mark_bit(code);}
  }
 }
 let pairs=packet.len()/2;
 if pairs==0{return Ok(JsString::from(""));}
 let room=pairs*8;let mut out=vec![0u32;room];
 let count=unsafe{crate::hebrew::hebrew_ipa_words(packet.as_ptr(),pairs,out.as_mut_ptr(),room)};
 if count<0{return Err(error("Hebrew IPA: the text is too long"));}
 from_points(&out[..count as usize])
}
/// The ids of the characters of the official Nakdimon alphabet (any niqqud already in the text is ignored).
#[wasm_bindgen]
pub fn voice_host_nakdimon_ids(text:JsValue)->R<Float32Array>{
 let codes=points(&units(&crate::host::text_value(&text)));
 if codes.is_empty(){return Ok(Float32Array::new_with_length(0));}
 let decimal:Vec<u8>=codes.iter().map(|&code|u8::from(pattern(3).test(&String::from(letter_of(code))))).collect();
 let mut out=vec![0f32;codes.len()];
 let written=unsafe{crate::hebrew::nakdimon_ids(codes.as_ptr(),decimal.as_ptr(),codes.len(),out.as_mut_ptr())};
 if written<0{return Err(error("Nakdimon: invalid call"));}
 Ok(Float32Array::from(&out[..written as usize]))
}
/// Merge the model's predictions onto the ORIGINAL characters, in Nakdimon's dagesh/dot/vowel order.
#[wasm_bindgen]
pub fn voice_host_merge_niqqud(letters:JsValue,outputs:JsValue)->R<JsString>{
 let count=len(&letters) as usize;
 let codes:Vec<u32>=(0..count as u32).map(|i|{let letter=get_at(&letters,i).unchecked_into::<JsString>();number_or_nan(&letter.code_point_at(0)) as u32}).collect();
 let mut classes=[vec![0u8;count],vec![0u8;count],vec![0u8;count]];
 // N (16 niqqud classes), D (dagesh), S (shin/sin dot): each checked, then reduced to its best class, in this order.
 for (slot,(name,width)) in [("N",16usize),("D",3),("S",4)].into_iter().enumerate(){
  let tensor=get(&outputs,name);let dims=get(&tensor,"dims");let data=get(&tensor,"data");
  let is=|value:JsValue,expected:f64|value.as_f64()==Some(expected);
  let valid=tensor.is_truthy()&&get(&tensor,"type").as_string().is_some_and(|kind|kind=="float32")&&is(get(&dims,"length"),3.0)
   &&is(get_at(&dims,0),1.0)&&is(get_at(&dims,1),count as f64)&&is(get_at(&dims,2),width as f64)&&is(get(&data,"length"),(count*width) as f64);
  if !valid{return Err(error(&format!("Nakdimon {name}: invalid output shape or type")));}
  let scores=Float32Array::new(&data).to_vec();
  let code=unsafe{crate::hebrew::nakdimon_argmax(scores.as_ptr(),count,width,classes[slot].as_mut_ptr())};
  if code!=1{return Err(error(&format!("Nakdimon {name}: {}",if code==0{"non-finite output"}else{"invalid call"})));}
 }
 let mut out=vec![0u32;count*4];
 let written=unsafe{crate::hebrew::nakdimon_assemble(codes.as_ptr(),count,classes[0].as_ptr(),classes[1].as_ptr(),classes[2].as_ptr(),out.as_mut_ptr())};
 if written<0{return Err(error("Nakdimon: invalid call"));}
 from_points(&out[..written as usize])
}
/// IPA code points use the voice's table, not the fixed table in the espeak WASM program; unknown phonemes are skipped.
#[wasm_bindgen]
pub fn voice_host_ipa_ids(ipa:JsValue,id_map:JsValue)->R<Array>{
 let ids=Array::new();
 if !ipa.is_truthy(){return Ok(ids);}
 let spread=|ids:&Array,key:&str|->R<()>{let list=get(&id_map,key);for i in 0..len(&list) as u32{ids.push(&get_at(&list,i));}Ok(())};
 spread(&ids,"^")?;spread(&ids,"_")?;
 for code in points(&units(&ipa)){
  let phoneme=String::from(letter_of(code));
  if !get(&id_map,&phoneme).is_truthy(){continue;}
  spread(&ids,&phoneme)?;spread(&ids,"_")?;
 }
 spread(&ids,"$")?;
 Ok(ids)
}
