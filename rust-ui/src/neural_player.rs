//! Playback of synthesised chunks: a gapless Web Audio queue whose clock is the audio clock, and the Android AudioTrack
//! sink, whose clock is the rendered-frame receipt. A unit is one spoken fragment of one or more chunks; the player
//! reports its audible 'start' and 'end' and the page marks inside it. The state stays on the JavaScript player object
//! (units, wires, clock), the closures the browser calls back belong to the host.
use wasm_bindgen::{prelude::*,JsCast};
use js_sys::{Array,Object,Number,Float32Array};
use crate::host::{get,read,set,num,absent,method,jmax,jmin};

type R<T=JsValue>=Result<T,JsValue>;
fn st(v:&str)->JsValue{JsValue::from_str(v)}
fn n(v:f64)->JsValue{JsValue::from_f64(v)}
fn t(v:&JsValue)->bool{v.is_truthy()}
fn arr(v:&JsValue)->Array{v.clone().unchecked_into()}
fn truth(v:bool)->JsValue{JsValue::from_bool(v)}
fn error(message:&str)->JsValue{js_sys::Error::new(message).into()}

const LEAD:f64=0.03;       // seconds between "now" and the first sample of an idle queue (room to schedule it)
const EPSILON:f64=0.004;   // tolerance when comparing audio-clock times
const MIN_POLL:f64=0.025;

// ---------------------------------------------------------------- Web Audio
fn gapless_context(p:&JsValue)->R{method(p,"getContext",&[])}
#[wasm_bindgen]
pub fn gapless_now(p:JsValue)->R<f64>{let time=get(&gapless_context(&p)?,"currentTime");Ok(if absent(&time){0.0}else{num(&time)})}
/// Time between a sample being rendered and being heard (speaker/Bluetooth pipeline); Bluetooth can lag by more than half a second.
#[wasm_bindgen]
pub fn gapless_latency(p:JsValue)->R<f64>{
 let ctx=gapless_context(&p)?;
 let out=num(&get(&ctx,"outputLatency"));let base=num(&get(&ctx,"baseLatency"));
 let value=if out!=0.0&&!out.is_nan(){out}else if base!=0.0&&!base.is_nan(){base}else{0.0};
 Ok(jmin(0.8,jmax(0.0,value)))
}
/// Seconds of audio scheduled but not yet played.
#[wasm_bindgen]
pub fn gapless_buffered(p:JsValue)->R<f64>{Ok(if t(&read(&p,"scheduled")?){jmax(0.0,num(&read(&p,"nextTime")?)-gapless_now(p.clone())?)}else{0.0})}
/// Everything scheduled has been rendered (the queue ran dry): whatever arrives next starts a new silence-broken stretch.
#[wasm_bindgen]
pub fn gapless_drained(p:JsValue)->R<bool>{Ok(t(&read(&p,"scheduled")?)&&num(&read(&p,"nextTime")?)<=gapless_now(p.clone())?+EPSILON)}
/// The unit being heard now, or null.
#[wasm_bindgen]
pub fn player_playing(p:JsValue)->R{
 for entry in js_sys::try_iter(&read(&p,"units")?)?.ok_or_else(||JsValue::from(js_sys::TypeError::new("units is not iterable")))?{
  let pair=arr(&entry?);let unit=pair.get(1);
  if t(&read(&unit,"started")?)&&!t(&read(&unit,"ended")?){return Ok(pair.get(0));}
 }
 Ok(JsValue::NULL)
}
/// Runs `task` when the audio clock (plus the output latency) reaches `time`; a timer only wakes us up, the clock decides.
fn when(p:&JsValue,u:&JsValue,time:f64,task:&JsValue)->R<()>{
 let slot=Object::new();
 let wait=jmax(0.0,time+gapless_latency(p.clone())?-gapless_now(p.clone())?)*1000.0;
 let handle=method(p,"_wake",&[u,&n(time),task,&slot,&n(wait)])?;
 method(&read(u,"timers")?,"add",&[&handle])?;Ok(())
}
#[wasm_bindgen]
pub fn gapless_arm(p:JsValue,u:JsValue,time:f64,task:JsValue,slot:JsValue)->R<()>{
 let remaining=time+gapless_latency(p.clone())?-gapless_now(p.clone())?;
 let timers=read(&u,"timers")?;
 method(&timers,"delete",&[&read(&slot,"handle")?])?;
 if remaining<=EPSILON{return run(&p,&task);}
 let handle=method(&p,"_wake",&[&u,&n(time),&task,&slot,&n(jmax(MIN_POLL,remaining)*1000.0)])?;
 method(&timers,"add",&[&handle])?;Ok(())
}
fn run(p:&JsValue,task:&JsValue)->R<()>{
 let unit=read(task,"unit")?;
 match string_of(&read(task,"kind")?).as_str(){
  "start"=>{set(&read(task,"u")?,"started",&JsValue::TRUE)?;method(p,"onStart",&[&unit])?;}
  "mark"=>{method(p,"onMark",&[&unit,&read(task,"offset")?])?;}
  _=>{set(&read(task,"u")?,"ended",&JsValue::TRUE)?;method(&read(p,"units")?,"delete",&[&unit])?;method(p,"onEnd",&[&unit])?;}
 }
 Ok(())
}
fn string_of(v:&JsValue)->String{v.as_string().unwrap_or_default()}
fn task(kind:&str,u:&JsValue,unit:&JsValue,offset:&JsValue)->R{
 let task=Object::new();set(&task,"kind",&st(kind))?;set(&task,"u",u)?;set(&task,"unit",unit)?;set(&task,"offset",offset)?;Ok(task.into())
}
/// Queues a chunk of unit `unit` right after what is already scheduled; `last` marks the unit's final chunk (its 'end' is armed then).
/// Returns the audio-clock time the chunk starts at.
#[wasm_bindgen]
pub fn gapless_schedule(p:JsValue,unit:JsValue,pcm:JsValue,sample_rate:JsValue,options:JsValue)->R{
 let (last,marks)=if options.is_undefined(){(JsValue::FALSE,JsValue::UNDEFINED)}else{(read(&options,"last")?,read(&options,"marks")?)};
 let ctx=gapless_context(&p)?;
 if !t(&ctx){return Err(error("no AudioContext"));}
 let length=num(&read(&pcm,"length")?);
 let buffer=method(&ctx,"createBuffer",&[&n(1.0),&n(jmax(1.0,length)),&sample_rate])?;
 method(&buffer,"copyToChannel",&[&if length!=0.0{pcm.clone()}else{Float32Array::new_with_length(1).into()},&n(0.0)])?;
 let source=method(&ctx,"createBufferSource",&[])?;
 set(&source,"buffer",&buffer)?;
 method(&source,"connect",&[&read(&ctx,"destination")?])?;
 let start=jmax(num(&read(&p,"nextTime")?),num(&read(&ctx,"currentTime")?)+LEAD);
 let end=start+num(&read(&buffer,"duration")?);
 set(&source,"onended",&method(&p,"_released",&[&source])?)?;
 method(&source,"start",&[&n(start)])?;
 set(&p,"nextTime",&n(end))?;set(&p,"scheduled",&JsValue::TRUE)?;
 let units=read(&p,"units")?;let mut u=method(&units,"get",&[&unit])?;
 if !t(&u){
  u=Object::new().into();
  for (name,value) in [("sources",Array::new().into()),("start",n(start)),("end",n(end)),("complete",JsValue::FALSE),("started",JsValue::FALSE),("ended",JsValue::FALSE),("timers",js_sys::Set::new(&JsValue::UNDEFINED).into())]{set(&u,name,&value)?;}
  method(&units,"set",&[&unit,&u])?;
  when(&p,&u,start,&task("start",&u,&unit,&JsValue::UNDEFINED)?)?;
 }
 let piece=Object::new();set(&piece,"source",&source)?;set(&piece,"start",&n(start))?;set(&piece,"end",&n(end))?;
 method(&read(&u,"sources")?,"push",&[&piece])?;set(&u,"end",&n(end))?;
 if !marks.is_undefined(){
  let rate=num(&sample_rate);
  for mark in js_sys::try_iter(&marks)?.ok_or_else(||JsValue::from(js_sys::TypeError::new("marks is not iterable")))?{
   let mark=mark?;let sample=read(&mark,"sample")?;
   if Number::is_integer(&sample)&&num(&sample)>=0.0&&num(&sample)<length{
    when(&p,&u,start+num(&sample)/rate,&task("mark",&u,&unit,&read(&mark,"offset")?)?)?;
   }
  }
 }
 if t(&last){set(&u,"complete",&JsValue::TRUE)?;when(&p,&u,end,&task("end",&u,&unit,&JsValue::UNDEFINED)?)?;}
 Ok(n(start))
}
fn drop_unit(p:&JsValue,u:&JsValue)->R<()>{
 let timers=read(u,"timers")?;
 for timer in js_sys::try_iter(&timers)?.ok_or_else(||JsValue::from(js_sys::TypeError::new("timers is not iterable")))?{method(p,"clearTimer",&[&timer?])?;}
 method(&timers,"clear",&[])?;
 let sources=arr(&read(u,"sources")?);
 for i in 0..sources.length(){
  let source=read(&sources.get(i),"source")?;
  let _=(||->R<()>{set(&source,"onended",&JsValue::NULL)?;method(&source,"stop",&[])?;Ok(())})();
  let _=method(&source,"disconnect",&[]);
 }
 Ok(())
}
/// Silences everything at once and forgets it: no 'start'/'done' will fire for what was queued.
#[wasm_bindgen]
pub fn gapless_stop_all(p:JsValue)->R<()>{
 let units=read(&p,"units")?;
 for entry in js_sys::try_iter(&units)?.ok_or_else(||JsValue::from(js_sys::TypeError::new("units is not iterable")))?{drop_unit(&p,&arr(&entry?).get(1))?;}
 method(&units,"clear",&[])?;set(&p,"nextTime",&n(0.0))?;set(&p,"scheduled",&JsValue::FALSE)
}
/// Drops the units after `unit` (the reader changed what comes next) and makes the queue end where `unit` ends.
#[wasm_bindgen]
pub fn player_truncate_after(p:JsValue,unit:JsValue)->R<()>{
 let units=read(&p,"units")?;
 for entry in Array::from(&units).iter(){
  let pair=arr(&entry);let number=pair.get(0);
  if num(&number)>num(&unit){drop_unit(&p,&pair.get(1))?;method(&units,"delete",&[&number])?;}
 }
 let ends=Array::from(&method(&units,"values",&[])?);
 if ends.length()>0{
  let mut latest=num(&read(&ends.get(0),"end")?);
  for i in 1..ends.length(){latest=jmax(latest,num(&read(&ends.get(i),"end")?));}
  set(&p,"nextTime",&n(latest))?;
 }
 Ok(())
}
/// Is it safe to start talking now? `ready` are the durations (s) of the chunks in hand, `pending` the predicted durations of
/// the chunks still being computed, `rtf` the compute seconds per audio second.
#[wasm_bindgen]
pub fn player_safe_to_start(ready:Vec<f64>,pending:Vec<f64>,rtf:f64,slack:f64)->bool{crate::neural_engine::safe_to_start(&ready,&pending,rtf,slack)}

// ---------------------------------------------------------------- Android AudioTrack
/// Mono Float32 as little-endian bytes in a binary string, ready for `encode` (btoa); non-finite samples are refused.
#[wasm_bindgen]
pub fn native_encode_pcm(pcm:Float32Array,encode:JsValue)->R{
 let mut units:Vec<u16>=Vec::with_capacity(pcm.length() as usize*4);
 for sample in pcm.to_vec(){
  if !sample.is_finite(){return Err(error("invalid PCM"));}
  for byte in sample.to_le_bytes(){units.push(byte as u16);}
 }
 crate::host::call(&encode,"encode",&[&JsValue::from_str(&String::from_utf16_lossy(&units))])
}
fn native_now(p:&JsValue,audio:&JsValue)->R<f64>{
 let state=crate::host::call(&read(audio,"nativeAudio")?,"nativeAudio",&[])?;
 if !t(&state)||read(&state,"session")?!=read(p,"session")?{return Ok(0.0);}
 let clock=(||->R<f64>{
  let clock=js_sys::JSON::parse(&string_of(&method(&read(&state,"bridge")?,"getState",&[])?))?;
  let played=read(&clock,"playedSeconds")?;
  Ok(if read(&clock,"session")?==read(p,"session")?&&read(&clock,"epoch")?==read(p,"epoch")?&&Number::is_finite(&played){jmax(0.0,num(&played))}else{0.0})
 })();
 Ok(clock.unwrap_or(0.0))
}
#[wasm_bindgen]
pub fn native_clock(p:JsValue,audio:JsValue)->R<f64>{native_now(&p,&audio)}
#[wasm_bindgen]
pub fn native_buffered(p:JsValue,audio:JsValue)->R<f64>{Ok(if t(&read(&p,"scheduled")?){jmax(0.0,num(&read(&p,"nextTime")?)-native_now(&p,&audio)?)}else{0.0})}
#[wasm_bindgen]
pub fn native_drained(p:JsValue,audio:JsValue)->R<bool>{Ok(t(&read(&p,"scheduled")?)&&num(&read(&p,"nextTime")?)<=native_now(&p,&audio)?+0.004)}
/// The bridge's receipts: 'start' and 'done' of each wire, in the epoch and session this player owns.
#[wasm_bindgen]
pub fn native_event(p:JsValue,event:JsValue,audio:JsValue)->R<()>{
 let detail=read(&event,"detail")?;
 if !t(&detail){return Ok(());}
 let mut session=read(&p,"session")?;
 if !t(&session){session=get(&crate::host::call(&read(&audio,"nativeAudio")?,"nativeAudio",&[])?,"session");}
 if read(&detail,"session")?!=session{return Ok(());}
 let epoch=read(&detail,"epoch")?;
 if !absent(&epoch)&&epoch!=read(&p,"epoch")?{return Ok(());}
 let wires=read(&p,"wires")?;let wire=method(&wires,"get",&[&read(&detail,"unit")?])?;
 let unit=method(&read(&p,"units")?,"get",&[&get(&wire,"id")])?;
 let kind=read(&detail,"type")?;
 if kind==st("error"){
  if num(&read(&detail,"unit")?)>=0.0&&!t(&unit){return Ok(());}
  let reason=read(&detail,"reason")?;
  method(&p,"onError",&[&if t(&reason){reason}else{st("native-playback")}])?;return Ok(());
 }
 if !t(&unit){return Ok(());}
 if kind==st("start")&&!t(&read(&wire,"started")?){
  set(&wire,"started",&JsValue::TRUE)?;
  if !t(&read(&unit,"started")?){set(&unit,"started",&JsValue::TRUE)?;method(&p,"onStart",&[&read(&wire,"id")?])?;}
  let mark=read(&wire,"mark")?;
  if Number::is_integer(&mark){method(&p,"onMark",&[&read(&wire,"id")?,&mark])?;}
 }
 if kind==st("done")&&t(&read(&unit,"started")?)&&!t(&read(&unit,"ended")?){
  method(&wires,"delete",&[&read(&detail,"unit")?])?;
  if t(&read(&wire,"final")?){
   set(&unit,"ended",&JsValue::TRUE)?;method(&read(&p,"units")?,"delete",&[&read(&wire,"id")?])?;method(&p,"onEnd",&[&read(&wire,"id")?])?;
  }
 }
 Ok(())
}
fn reset_clock(p:&JsValue)->R<()>{
 for key in ["units","wires","wireEnds"]{method(&read(p,key)?,"clear",&[])?;}
 set(p,"nextTime",&n(0.0))?;set(p,"scheduled",&JsValue::FALSE)
}
#[wasm_bindgen]
pub fn native_schedule(p:JsValue,id:JsValue,pcm:JsValue,sample_rate:JsValue,options:JsValue,audio:JsValue)->R{
 let (last,marks)=if options.is_undefined(){(JsValue::FALSE,JsValue::UNDEFINED)}else{(read(&options,"last")?,read(&options,"marks")?)};
 let state=crate::host::call(&read(&audio,"nativeAudio")?,"nativeAudio",&[])?;
 let rate=num(&sample_rate);
 if !t(&state)||!pcm.is_instance_of::<Float32Array>()||num(&read(&pcm,"length")?)==0.0||!Number::is_integer(&sample_rate)||rate<8000.0||rate>96000.0{return Err(error("invalid native audio"));}
 // Reject the complete buffer before enqueueing any slice or changing the playback clock; a corrupt later slice must not leave a partial utterance.
 let samples:Float32Array=pcm.clone().unchecked_into();let length=samples.length();
 for sample in samples.to_vec(){if !sample.is_finite(){return Err(error("invalid PCM"));}}
 if read(&p,"session")?!=read(&state,"session")?{
  reset_clock(&p)?;set(&p,"session",&read(&state,"session")?)?;
  let epoch=method(&p,"_nextEpoch",&[])?;set(&p,"epoch",&epoch)?;
  method(&read(&state,"bridge")?,"reset",&[&read(&state,"session")?,&epoch])?;
 }
 let start=jmax(num(&read(&p,"nextTime")?),native_now(&p,&audio)?);let end=start+length as f64/rate;
 let units=read(&p,"units")?;let mut unit=method(&units,"get",&[&id])?;
 if !t(&unit){
  unit=Object::new().into();
  for (name,value) in [("start",n(start)),("end",n(end)),("started",JsValue::FALSE),("ended",JsValue::FALSE)]{set(&unit,name,&value)?;}
  method(&units,"set",&[&id,&unit])?;
 }
 set(&unit,"end",&n(end))?;set(&unit,"complete",&last)?;
 set(&p,"nextTime",&n(end))?;set(&p,"scheduled",&JsValue::TRUE)?;
 // Register before crossing the bridge: a sink may synchronously report a start/error. Cancellation must never lose that first authentic event.
 let mut valid:Vec<(f64,JsValue)>=Vec::new();
 if !marks.is_undefined(){
  for mark in Array::from(&marks).iter(){
   let sample=read(&mark,"sample")?;
   if Number::is_integer(&sample)&&num(&sample)>=0.0&&num(&sample)<length as f64{valid.push((num(&sample),mark));}
  }
 }
 valid.sort_by(|a,b|a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal));
 let mut cuts:Vec<f64>=vec![0.0];
 for (sample,_) in &valid{if !cuts.contains(sample){cuts.push(*sample);}}
 if !cuts.contains(&(length as f64)){cuts.push(length as f64);}
 let encode=method(&p,"_encoder",&[])?;
 for part in 1..cuts.len(){
  let current=read(&p,"units")?;
  if !t(&method(&current,"has",&[&id])?)||read(&p,"session")?!=read(&state,"session")?{break;}
  let sequence=jmax(num(&read(&p,"wireSequence")?)+1.0,num(&id));set(&p,"wireSequence",&n(sequence))?;
  let marker=valid.iter().find(|(sample,_)|*sample==cuts[part-1]).map(|(_,mark)|mark.clone());
  let wire=Object::new();set(&wire,"id",&id)?;set(&wire,"mark",&match marker{Some(mark)=>read(&mark,"offset")?,None=>JsValue::UNDEFINED})?;
  set(&wire,"final",&truth(t(&last)&&part==cuts.len()-1))?;
  method(&read(&p,"wires")?,"set",&[&n(sequence),&wire])?;
  set(&unit,"lastWire",&n(sequence))?;
  let ends=read(&p,"wireEnds")?;method(&ends,"set",&[&id,&n(sequence)])?;
  while num(&read(&ends,"size")?)>64.0{let first=read(&method(&method(&ends,"keys",&[])?,"next",&[])?,"value")?;method(&ends,"delete",&[&first])?;}
  let slice=method(&pcm,"subarray",&[&n(cuts[part-1]),&n(cuts[part])])?;
  let encoded=native_encode_pcm(slice.unchecked_into(),encode.clone())?;
  // Contiguous slices of ONE waveform. No new synthesis, padding or fade: AudioTrack's rendered start receipt is the boundary, also screen-off.
  method(&read(&state,"bridge")?,"enqueue",&[&read(&state,"session")?,&read(&p,"epoch")?,&n(sequence),&encoded,&sample_rate,&JsValue::TRUE])?;
 }
 Ok(n(start))
}
#[wasm_bindgen]
pub fn native_stop_all(p:JsValue,options:JsValue,audio:JsValue)->R<()>{
 let (keep,pause)=if options.is_undefined(){(false,false)}else{(t(&read(&options,"keepSession")?),t(&read(&options,"pause")?))};
 reset_clock(&p)?;
 let epoch=method(&p,"_nextEpoch",&[])?;set(&p,"epoch",&epoch)?;
 let state=crate::host::call(&read(&audio,"nativeAudio")?,"nativeAudio",&[])?;
 if keep&&t(&state){method(&read(&state,"bridge")?,"reset",&[&read(&state,"session")?,&epoch])?;}
 else if pause{crate::host::call(&read(&audio,"pauseNativeAudio")?,"pauseNativeAudio",&[])?;}
 else{crate::host::call(&read(&audio,"stopNativeAudio")?,"stopNativeAudio",&[])?;}
 if !keep{set(&p,"session",&JsValue::NULL)?;}
 Ok(())
}
#[wasm_bindgen]
pub fn native_truncate_after(p:JsValue,id:JsValue,audio:JsValue)->R<()>{
 let units=read(&p,"units")?;
 let own=get(&method(&units,"get",&[&id])?,"lastWire");
 let last=if absent(&own){method(&read(&p,"wireEnds")?,"get",&[&id])?}else{own};
 for entry in Array::from(&units).iter(){let number=arr(&entry).get(0);if num(&number)>num(&id){method(&units,"delete",&[&number])?;}}
 let wires=read(&p,"wires")?;
 for entry in Array::from(&wires).iter(){let pair=arr(&entry);if num(&read(&pair.get(1),"id")?)>num(&id){method(&wires,"delete",&[&pair.get(0)])?;}}
 let ends=Array::from(&method(&units,"values",&[])?);
 if ends.length()>0{
  let mut latest=num(&read(&ends.get(0),"end")?);
  for i in 1..ends.length(){latest=jmax(latest,num(&read(&ends.get(i),"end")?));}
  set(&p,"nextTime",&n(latest))?;
 }
 let state=crate::host::call(&read(&audio,"nativeAudio")?,"nativeAudio",&[])?;
 if t(&state)&&read(&state,"session")?==read(&p,"session")?&&!absent(&last){
  method(&read(&state,"bridge")?,"truncateAfter",&[&read(&state,"session")?,&read(&p,"epoch")?,&last])?;
 }
 Ok(())
}
