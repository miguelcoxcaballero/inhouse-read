//! The natural-voice engine: look-ahead synthesis, gapless hand-off, the buffering gate, downloads and idle release.
//! The state stays in the plain JavaScript objects the engine host exposes (run, entries, stats, cache), because the
//! reader and the diagnostics read them; every decision is made here. Timer, handler and event closures belong to the host.
use wasm_bindgen::{prelude::*,JsCast};
use js_sys::{Array,Object,Number};
use crate::host::{get,read,set,num,absent,method,jmin};

type R<T=JsValue>=Result<T,JsValue>;
#[wasm_bindgen]
extern "C"{
 #[wasm_bindgen(js_name=String)]fn string(v:&JsValue)->String;
 /// `String(value)` without leaving UTF-16: lone surrogates of a book survive in the cache key.
 #[wasm_bindgen(js_name=String)]fn js_text(v:&JsValue)->JsValue;
}
fn join(parts:&[&JsValue])->R{
 let list=Array::new();for part in parts{list.push(&js_text(part));}
 method(&list,"join",&[&JsValue::from_str("")])
}

fn st(v:&str)->JsValue{JsValue::from_str(v)}
fn n(v:f64)->JsValue{JsValue::from_f64(v)}
fn t(v:&JsValue)->bool{v.is_truthy()}
fn arr(v:&JsValue)->Array{v.clone().unchecked_into()}
fn no_options()->JsValue{Object::new().into()}
fn now()->f64{
 let perf=get(&crate::host::global(),"performance");
 if let Ok(Some(value))=crate::host::method_opt(&perf,"now",&[]){if !absent(&value){return num(&value);}}
 js_sys::Date::now()
}
fn limit(e:&JsValue,key:&str)->R<f64>{Ok(num(&read(&read(e,"limits")?,key)?))}
fn clamp_rate(rate:&JsValue)->f64{let r=num(rate);let r=if r.is_nan()||r==0.0{1.0}else{r};jmin(3.0,crate::host::jmax(0.5,r))}
fn find_voice(voices:&JsValue,id:&JsValue)->R{
 let list=arr(voices);
 for i in 0..list.length(){let voice=list.get(i);if read(&voice,"id")?==*id{return Ok(voice);}}
 Ok(JsValue::NULL)
}
fn bump(o:&JsValue,key:&str)->R<()>{set(o,key,&n(num(&read(o,key)?)+1.0))}
fn every_ended(run:&JsValue)->R<bool>{
 let entries=arr(&read(run,"entries")?);
 for i in 0..entries.length(){if !t(&read(&entries.get(i),"ended")?){return Ok(false);}}
 Ok(true)
}

/// `typeof env.Worker === 'function' && typeof env.WebAssembly === 'object' && !!(AudioContext || webkitAudioContext || native bridge) && !!env.caches`.
#[wasm_bindgen]
pub fn neural_supported(env:JsValue,native_bridge:JsValue)->R<bool>{
 if !read(&env,"Worker")?.is_function()||read(&env,"WebAssembly")?.js_typeof()!=st("object"){return Ok(false);}
 let audio=t(&read(&env,"AudioContext")?)||t(&read(&env,"webkitAudioContext")?)||t(&crate::host::call(&native_bridge,"nativePcmBridge",&[&env])?);
 Ok(audio&&t(&read(&env,"caches")?))
}

// ---------------------------------------------------------------- the fragment cache (map, samples and limits live on the cache object)
#[wasm_bindgen]
pub fn neural_cache_get(cache:JsValue,key:JsValue)->R{
 let map=read(&cache,"map")?;let hit=method(&map,"get",&[&key])?;
 if !t(&hit){return Ok(JsValue::NULL);}
 method(&map,"delete",&[&key])?;method(&map,"set",&[&key,&hit])?;read(&hit,"chunks")
}
#[wasm_bindgen]
pub fn neural_cache_put(cache:JsValue,key:JsValue,chunks:JsValue)->R<()>{
 method(&cache,"delete",&[&key])?;
 let list=arr(&chunks);let mut samples=0.0;
 for i in 0..list.length(){samples+=num(&read(&read(&list.get(i),"pcm")?,"length")?);}
 let max_samples=num(&read(&cache,"maxSamples")?);
 if samples>max_samples{return Ok(());}
 let entry=Object::new();set(&entry,"chunks",&chunks)?;set(&entry,"samples",&n(samples))?;
 let map=read(&cache,"map")?;method(&map,"set",&[&key,&entry])?;
 set(&cache,"samples",&n(num(&read(&cache,"samples")?)+samples))?;
 loop{
  let size=num(&read(&map,"size")?);
  if !(size>num(&read(&cache,"maxEntries")?)||num(&read(&cache,"samples")?)>max_samples){break;}
  let first=read(&method(&method(&map,"keys",&[])?,"next",&[])?,"value")?;
  method(&cache,"delete",&[&first])?;
 }
 Ok(())
}
#[wasm_bindgen]
pub fn neural_cache_delete(cache:JsValue,key:JsValue)->R<()>{
 let map=read(&cache,"map")?;let hit=method(&map,"get",&[&key])?;
 if t(&hit){set(&cache,"samples",&n(num(&read(&cache,"samples")?)-num(&read(&hit,"samples")?)))?;method(&map,"delete",&[&key])?;}
 Ok(())
}
#[wasm_bindgen]
pub fn neural_cache_clear(cache:JsValue)->R<()>{method(&read(&cache,"map")?,"clear",&[])?;set(&cache,"samples",&n(0.0))}

// ---------------------------------------------------------------- small shared pieces
fn dispatch(e:&JsValue,kind:&str)->R<()>{let event=web_sys::Event::new(kind)?;method(e,"dispatchEvent",&[&event])?;Ok(())}
fn set_status(e:&JsValue,status:&str)->R<()>{
 if read(e,"_status")?==st(status){return Ok(());}
 set(e,"_status",&st(status))?;dispatch(e,"status")
}
fn changed(e:&JsValue)->R<()>{dispatch(e,"change")}
fn clear_timer(e:&JsValue,id:&JsValue)->R<()>{method(e,"clearTimer",&[id])?;Ok(())}
fn arm(e:&JsValue,run:&JsValue,kind:&str,ms:f64)->R{method(e,"_arm",&[run,&st(kind),&n(ms)])}
/// The host reports to the reader through 'inhouse-tts' on the environment, one microtask later.
fn emit(e:&JsValue,kind:&str,id:&JsValue,reason:&JsValue,offset:&JsValue)->R<()>{
 if absent(id){return Ok(());}
 let detail=Object::new();set(&detail,"type",&st(kind))?;set(&detail,"id",id)?;
 if t(reason){set(&detail,"reason",reason)?;}
 if Number::is_integer(offset){set(&detail,"offset",offset)?;}
 method(e,"_emit",&[&detail])?;Ok(())
}
fn emit_plain(e:&JsValue,kind:&str,id:&JsValue,reason:&str)->R<()>{emit(e,kind,id,&st(reason),&JsValue::UNDEFINED)}

fn clear_idle(e:&JsValue)->R<()>{clear_timer(e,&read(e,"idleTimer")?)?;set(e,"idleTimer",&JsValue::NULL)}
fn arm_idle(e:&JsValue)->R<()>{
 clear_idle(e)?;
 let timer=arm(e,&JsValue::UNDEFINED,"idle",limit(e,"idleMs")?)?;set(e,"idleTimer",&timer)
}
fn teardown(e:&JsValue)->R<()>{
 clear_idle(e)?;
 let client=read(e,"client")?;if !absent(&client){method(&client,"dispose",&[])?;}
 set(e,"client",&JsValue::NULL)?;set(e,"preparingModel",&JsValue::NULL)?;
 let run=read(e,"run")?;if t(&run){set(&run,"prepared",&JsValue::NULL)?;}
 Ok(())
}
fn hard_stop(e:&JsValue,playback:&JsValue)->R<()>{
 let run=read(e,"run")?;set(e,"run",&JsValue::NULL)?;set(e,"currentId",&JsValue::NULL)?;
 if t(&run){
  let job=get(&run,"job");if !absent(&job){method(&job,"cancel",&[])?;}
  for key in ["holdTimer","pumpTimer","feedTimer"]{clear_timer(e,&read(&run,key)?)?;set(&run,key,&JsValue::NULL)?;}
 }
 method(&read(e,"player")?,"stopAll",&[playback])?;
 set_status(e,"idle")
}

/// A run is a continuous stretch of reading with one voice and rate; its entries are the fragments, in reading order.
fn matches(entry:&JsValue,value:&JsValue)->R<bool>{
 let plain=value.is_string();
 let text=if plain{value.clone()}else{get(value,"text")};
 let marks=if plain{Array::new().into()}else{let marks=get(value,"marks");if t(&marks){marks}else{Array::new().into()}};
 if get(entry,"text")!=text{return Ok(false);}
 let own=read(entry,"marks")?;let own=if t(&own){own}else{Array::new().into()};
 Ok(js_sys::JSON::stringify(&own)?.as_string()==js_sys::JSON::stringify(&marks)?.as_string())
}
fn new_entry(e:&JsValue,run:&JsValue,value:&JsValue,deferred:bool)->R{
 let plain=value.is_string();
 let text=if plain{value.clone()}else{read(value,"text")?};
 let marks=if plain{Array::new().into()}else{let marks=read(value,"marks")?;if t(&marks){marks}else{Array::new().into()}};
 let voice=read(run,"voice")?;
 let profile=if read(&voice,"runtime")?==st("supertonic3"){join(&[&read(&voice,"style")?,&st(":"),&read(&voice,"lang")?])?}else{read(&voice,"speaker")?};
 let seq=num(&read(e,"unitSeq")?)+1.0;set(e,"unitSeq",&n(seq))?;
 let mut key=join(&[&read(&voice,"piperId")?,&st("#"),&profile,&st("|"),&read(run,"rate")?,&st("|"),&text])?;
 let entry=Object::new();
 for (name,value) in [("n",n(seq)),("text",text),("key",key.clone()),("deferred",JsValue::from_bool(deferred)),("id",JsValue::NULL),("state",st("queued")),("chunks",Array::new().into()),("scheduled",n(0.0)),("total",JsValue::NULL),("counts",JsValue::NULL),("started",JsValue::FALSE),("ended",JsValue::FALSE),("error",JsValue::NULL)]{set(&entry,name,&value)?;}
 set(&entry,"marks",&marks)?;
 if num(&read(&marks,"length")?)>0.0{key=join(&[&key,&st("|marks:"),&method(&marks,"join",&[&st(",")])?])?;set(&entry,"key",&key)?;}
 let cached=method(&read(e,"cache")?,"get",&[&key])?;
 if t(&cached){
  set(&entry,"chunks",&method(&cached,"slice",&[])?)?;set(&entry,"total",&read(&cached,"length")?)?;set(&entry,"state",&st("done"))?;
  bump(&read(e,"stats")?,"cacheHits")?;
 }
 method(&read(run,"entries")?,"push",&[&entry])?;
 Ok(entry.into())
}
fn new_run(voice:&JsValue,rate:f64,preview:bool)->R{
 let run=Object::new();
 set(&run,"voice",voice)?;set(&run,"rate",&n(rate))?;
 if preview{set(&run,"preview",&JsValue::TRUE)?;}
 for (name,value) in [("entries",Array::new().into()),("gateOpen",JsValue::FALSE),("buffered",JsValue::FALSE),("prepared",JsValue::NULL),("job",JsValue::NULL),("heldSince",JsValue::NULL),("holdTimer",JsValue::NULL),("pumpTimer",JsValue::NULL),("feedTimer",JsValue::NULL),("rtf",n(0.0)),("rtfN",n(0.0)),("spi",n(0.0)),("t0",n(now())),("firstAudio",JsValue::FALSE)]{set(&run,name,&value)?;}
 Ok(run.into())
}
fn adopt(e:&JsValue,run:&JsValue,head:&JsValue,id:&JsValue,upcoming:&Array,fresh:bool,defer_after:f64,announce:bool)->R<()>{
 if t(&read(head,"deferred")?){
  if read(head,"state")?==st("done"){bump(&read(e,"stats")?,"prefetchHits")?;}
  set(run,"gateOpen",&JsValue::FALSE)?;set(run,"heldSince",&JsValue::NULL)?;
 }
 set(head,"deferred",&JsValue::FALSE)?;set(head,"id",id)?;set(e,"currentId",id)?;
 let later=|index:u32|(index as f64)>=defer_after;
 if !fresh{
  let kept=Array::new();let entries=arr(&read(run,"entries")?);
  for i in 0..entries.length(){let entry=entries.get(i);if !t(&read(&entry,"ended")?)||entry==*head{kept.push(&entry);}}
  set(run,"entries",&kept)?;
  let at=kept.index_of(head,0);
  let after=arr(&method(&kept,"slice",&[&n((at+1) as f64)])?);
  let mut keep=0u32;
  while keep<after.length()&&keep<upcoming.length()&&matches(&after.get(keep),&upcoming.get(keep))?{keep+=1;}
  for index in 0..keep{set(&after.get(index),"deferred",&JsValue::from_bool(later(index)))?;}
  let dropped=arr(&method(&after,"slice",&[&n(keep as f64)])?);
  if dropped.length()>0{
   for i in 0..dropped.length(){
    if read(&dropped.get(i),"state")?==st("synth"){let job=get(run,"job");if !absent(&job){method(&job,"cancel",&[])?;}set(run,"job",&JsValue::NULL)?;}
   }
   kept.set_length((at+1) as u32+keep);
   let last=kept.get(kept.length()-1);
   method(&read(e,"player")?,"truncateAfter",&[&read(&last,"n")?])?;
  }
  for index in keep..upcoming.length(){new_entry(e,run,&upcoming.get(index),later(index))?;}
 }else{
  for index in 0..upcoming.length(){new_entry(e,run,&upcoming.get(index),later(index))?;}
 }
 // Whatever already happened to the adopted fragment is reported now, as if it had been live.
 let error=read(head,"error")?;
 if t(&error){emit(e,"error",id,&error,&JsValue::UNDEFINED)?;hard_stop(e,&no_options())?;return Ok(());}
 if announce&&t(&read(head,"started")?){emit(e,"start",id,&JsValue::UNDEFINED,&JsValue::UNDEFINED)?;}
 let mark=read(head,"mark")?;
 if announce&&Number::is_integer(&mark){emit(e,"boundary",id,&JsValue::NULL,&mark)?;}
 if announce&&t(&read(head,"ended")?){emit(e,"done",id,&JsValue::UNDEFINED,&JsValue::UNDEFINED)?;}
 Ok(())
}
fn defer_of(value:&JsValue)->f64{if value.is_undefined(){f64::INFINITY}else{num(value)}}
fn clip(list:&JsValue,max:f64)->R<Array>{Ok(arr(&method(list,"slice",&[&n(0.0),&n(max)])?))}

// ---------------------------------------------------------------- scheduling
fn held_seconds(entries:&Array,end:u32)->R<f64>{
 let mut seconds=0.0;
 for index in 0..end{
  let entry=entries.get(index);let chunks=arr(&read(&entry,"chunks")?);let mut i=num(&read(&entry,"scheduled")?);
  while i<chunks.length() as f64{seconds+=num(&read(&chunks.get(i as u32),"dur")?);i+=1.0;}
 }
 Ok(seconds)
}
fn pump(e:&JsValue)->R<()>{
 let run=read(e,"run")?;
 if !t(&run)||t(&read(&run,"job")?){return Ok(());}
 let entries=arr(&read(&run,"entries")?);
 for i in 0..entries.length(){if t(&read(&entries.get(i),"error")?){return Ok(());}}
 let mut at=None;
 for i in 0..entries.length(){if read(&entries.get(i),"state")?==st("queued"){at=Some(i);break;}}
 let Some(at)=at else{return Ok(())};
 let entry=entries.get(at);
 // Later cached sentences cannot play across this missing sentence: only the prefix before it can justify delaying it.
 let mut ahead=0.0;
 for i in 0..at{let before=entries.get(i);if !t(&read(&before,"started")?)&&read(&before,"state")?!=st("queued"){ahead+=1.0;}}
 let waiting=held_seconds(&entries,at)?+num(&method(&read(e,"player")?,"buffered",&[])?);
 let lookahead=limit(e,"lookaheadSec")?;
 if ahead>0.0&&waiting>=lookahead{
  // enough audio is queued: look again when playback has eaten into it
  clear_timer(e,&read(&run,"pumpTimer")?)?;
  set(&run,"pumpTimer",&JsValue::NULL)?;
  // Silent preparation consumes no audio. Play invokes pump again; polling
  // this unchanged reserve only wakes an idle phone without making progress.
  if t(&get(&run,"preview")){return Ok(());}
  let timer=arm(e,&run,"pump",(waiting-lookahead+0.25)*1000.0)?;
  set(&run,"pumpTimer",&timer)?;return Ok(());
 }
 if ahead>=limit(e,"maxAhead")?{return Ok(());}
 let prepared=read(&run,"prepared")?;
 if !t(&prepared){method(e,"_prepare",&[&run])?;return Ok(());}
 if prepared==st("pending"){return Ok(());}
 set(&entry,"state",&st("synth"))?;set(&run,"segStart",&n(now()))?;
 let voice=read(&run,"voice")?;let request=Object::new();
 let (spoken,marks,pairs)=crate::speech_numbers::prepare(&read(&entry,"text")?,&read(&voice,"lang")?,&read(&entry,"marks")?)?;
 set(&entry,"speechOffsetPairs",&pairs)?;
 set(&request,"text",&spoken)?;set(&request,"rate",&read(&run,"rate")?)?;set(&request,"speaker",&read(&voice,"speaker")?)?;
 if t(&read(&marks,"length")?){set(&request,"marks",&marks)?;}
 if read(&voice,"runtime")?==st("supertonic3"){set(&request,"lang",&read(&voice,"lang")?)?;set(&request,"style",&read(&voice,"style")?)?;}
 let handlers=method(e,"_handlers",&[&run,&entry])?;
 let job=method(&read(e,"client")?,"synth",&[&request,&handlers])?;
 set(&run,"job",&job)
}
fn finish(e:&JsValue,entry:&JsValue)->R<()>{
 if read(entry,"state")?==st("done"){return Ok(());}
 set(entry,"state",&st("done"))?;
 let chunks=arr(&read(entry,"chunks")?);set(entry,"total",&n(chunks.length() as f64))?;
 if chunks.length()>0&&t(&read(&chunks.get(chunks.length()-1),"last")?){method(&read(e,"cache")?,"put",&[&read(entry,"key")?,&chunks])?;}
 Ok(())
}
fn fail_entry(e:&JsValue,run:&JsValue,entry:&JsValue,code:&str)->R<()>{
 if read(e,"run")?!=*run{return Ok(());}
 set(entry,"error",&st(code))?;set(entry,"state",&st("done"))?;
 if code=="synth-failed"{teardown(e)?;} // a worker that failed is not asked again: the next fragment gets a fresh one
 let id=read(entry,"id")?;
 if !absent(&id){hard_stop(e,&no_options())?;return emit_plain(e,"error",&id,code);}
 feed(e,run) // earlier fragments keep playing; the error is reported when the reader asks for this one
}
fn buffer_slow(e:&JsValue)->R<()>{
 let run=read(e,"run")?;
 if !t(&run)||t(&read(&run,"buffered")?){return Ok(());}
 set(&run,"buffered",&JsValue::TRUE)?;bump(&read(e,"stats")?,"tooSlow")?;set(e,"underrunTimes",&Array::new())?;set_status(e,"buffering")
}
fn underrun(e:&JsValue)->R<()>{
 let at=now();bump(&read(e,"stats")?,"underruns")?;
 let window=limit(e,"underrunWindowMs")?;let recent=Array::new();let times=arr(&read(e,"underrunTimes")?);
 for i in 0..times.length(){let time=times.get(i);if at-num(&time)<window{recent.push(&time);}}
 recent.push(&n(at));set(e,"underrunTimes",&recent)?;set(e,"cleanStreak",&n(0.0))?;set_status(e,"buffering")?;
 if recent.length() as f64>=limit(e,"underrunLimit")?{buffer_slow(e)?;}
 Ok(())
}
/// Is it safe to start talking? Every chunk still being computed must finish (within the slack) before the audio in front of it runs out.
pub(crate) fn safe_to_start(ready:&[f64],pending:&[f64],rtf:f64,slack:f64)->bool{
 let mut have=0.0;for d in ready{have+=d;}
 let mut spent=0.0;
 for d in pending{spent+=rtf*d;if spent>have+slack{return false;}have+=d;}
 true
}
/// May we start (or restart after a stall) playing what is in hand?
fn gate_opens(e:&JsValue,run:&JsValue)->R<bool>{
 let entries=arr(&read(run,"entries")?);
 // Future inference must not hold an already complete current fragment.
 for i in 0..entries.length(){
  let entry=entries.get(i);
  if !t(&read(&entry,"ended")?)&&num(&read(&entry,"scheduled")?)<num(&read(&read(&entry,"chunks")?,"length")?){
   if read(&entry,"state")?==st("done")&&!t(&read(&entry,"deferred")?){return Ok(true);}
   break;
  }
 }
 let mut ready=Vec::new();let mut incomplete=JsValue::NULL;
 for i in 0..entries.length(){
  let entry=entries.get(i);
  if t(&read(&entry,"ended")?){continue;}
  if t(&read(&entry,"deferred")?){break;}
  if t(&read(&entry,"error")?){break;}
  let chunks=arr(&read(&entry,"chunks")?);let mut c=num(&read(&entry,"scheduled")?);
  while c<chunks.length() as f64{ready.push(num(&read(&chunks.get(c as u32),"dur")?));c+=1.0;}
  let total=read(&entry,"total")?;
  if absent(&total)||(chunks.length() as f64)<num(&total){incomplete=entry;break;}
 }
 if ready.is_empty(){return Ok(false);}
 if t(&read(run,"buffered")?){return Ok(true);}
 let rate=num(&read(run,"rate")?);
 let mut pending=Vec::new();
 if !absent(&incomplete)&&t(&read(&incomplete,"counts")?){
  let spi=num(&read(run,"spi")?);let spi=if spi!=0.0&&!spi.is_nan(){spi}else{0.03/rate};
  let counts=arr(&read(&incomplete,"counts")?);let mut c=read(&read(&incomplete,"chunks")?,"length")?.as_f64().unwrap_or(0.0);
  while c<counts.length() as f64{pending.push(num(&counts.get(c as u32))*spi);c+=1.0;}
 }
 let held=read(run,"heldSince")?;
 if !absent(&held)&&now()-num(&held)>=limit(e,"maxHoldMs")?{return Ok(true);}
 let rtf=if t(&read(run,"rtfN")?){num(&read(run,"rtf")?)}else{limit(e,"rtfPrior")?};
 Ok(safe_to_start(&ready,&pending,rtf,0.3))
}
fn arm_hold(e:&JsValue,run:&JsValue)->R<()>{
 set_status(e,"buffering")?;clear_timer(e,&read(run,"holdTimer")?)?;
 let wait=crate::host::jmax(50.0,limit(e,"maxHoldMs")?-(now()-num(&read(run,"heldSince")?)));
 let timer=arm(e,run,"hold",wait)?;set(run,"holdTimer",&timer)
}
/// Hands every chunk in hand to the player, in reading order; holds back while the gate says the voice would stall.
fn feed(e:&JsValue,run:&JsValue)->R<()>{
 if read(e,"run")?!=*run{return Ok(());}
 let entries=arr(&read(run,"entries")?);let player=read(e,"player")?;
 let mut index=0;
 while index<entries.length(){
  let entry=entries.get(index);index+=1;
  if t(&read(&entry,"error")?){return Ok(());}
  if t(&read(&entry,"deferred")?){return Ok(());}
  if t(&read(run,"buffered")?)&&read(&entry,"state")?!=st("done"){return set_status(e,"buffering");}
  loop{
   let scheduled=num(&read(&entry,"scheduled")?);let chunks=arr(&read(&entry,"chunks")?);
   if !(scheduled<chunks.length() as f64){break;}
   // Bound delivery to the native queue as well as synthesis: keep the exact PCM in the cache until the rendered clock frees room.
   let waiting=if t(&read(e,"nativePlayer")?){num(&method(&player,"buffered",&[])?)}else{0.0};
   if waiting>0.0&&waiting+num(&read(&chunks.get(scheduled as u32),"dur")?)>limit(e,"lookaheadSec")?{
    clear_timer(e,&read(run,"feedTimer")?)?;
    let timer=arm(e,run,"feed",1000.0)?;set(run,"feedTimer",&timer)?;return Ok(());
   }
   if t(&read(run,"gateOpen")?)&&t(&method(&player,"drained",&[])?){
    set(run,"gateOpen",&JsValue::FALSE)?;underrun(e)?;
    if read(e,"run")?!=*run{return Ok(());}
   }
   if !t(&read(run,"gateOpen")?){
    if absent(&read(run,"heldSince")?){set(run,"heldSince",&n(now()))?;}
    if !gate_opens(e,run)?{arm_hold(e,run)?;return Ok(());}
    set(run,"gateOpen",&JsValue::TRUE)?;set(run,"heldSince",&JsValue::NULL)?;
    clear_timer(e,&read(run,"holdTimer")?)?;set(run,"holdTimer",&JsValue::NULL)?;
   }
   let chunks=arr(&read(&entry,"chunks")?);let at=num(&read(&entry,"scheduled")?);set(&entry,"scheduled",&n(at+1.0))?;
   let chunk=chunks.get(at as u32);
   let sent=(||->R{
    let options=Object::new();set(&options,"last",&JsValue::from_bool(t(&read(&chunk,"last")?)))?;set(&options,"marks",&read(&chunk,"marks")?)?;
    method(&player,"schedule",&[&read(&entry,"n")?,&read(&chunk,"pcm")?,&read(&chunk,"sampleRate")?,&options])
   })();
   if sent.is_err(){fail_entry(e,run,&entry,"native-playback-failed")?;return Ok(());}
   if read(e,"run")?!=*run{return Ok(());}
  }
  let total=read(&entry,"total")?;
  if absent(&total)||num(&read(&entry,"scheduled")?)<num(&total){return Ok(());}
 }
 Ok(())
}
fn entry_of(e:&JsValue,unit:&JsValue)->R{
 let run=read(e,"run")?;if absent(&run){return Ok(JsValue::UNDEFINED);}
 let entries=arr(&read(&run,"entries")?);
 for i in 0..entries.length(){let entry=entries.get(i);if read(&entry,"n")?==*unit{return Ok(entry);}}
 Ok(JsValue::UNDEFINED)
}

// ---------------------------------------------------------------- host callbacks
#[wasm_bindgen]
pub fn neural_fire(e:JsValue,run:JsValue,kind:String,timer:JsValue)->R<()>{
 match kind.as_str(){
  "pump"=>{if read(&run,"pumpTimer")?==timer{set(&run,"pumpTimer",&JsValue::NULL)?;}pump(&e)}
  "feed"=>{if read(&run,"feedTimer")?==timer{set(&run,"feedTimer",&JsValue::NULL)?;}feed(&e,&run)}
  "hold"=>{if read(&run,"holdTimer")?==timer{set(&run,"holdTimer",&JsValue::NULL)?;}feed(&e,&run)}
  _=>{
   set(&e,"idleTimer",&JsValue::NULL)?;
   if t(&get(&read(&e,"run")?,"preview")){hard_stop(&e,&no_options())?;}
   let run=read(&e,"run")?;
   if t(&run)&&!every_ended(&run)?{return arm_idle(&e);}
   teardown(&e)
  }
 }
}
#[wasm_bindgen]
pub fn neural_job_plan(entry:JsValue,counts:JsValue)->R<()>{set(&entry,"counts",&counts)?;set(&entry,"total",&read(&counts,"length")?)}
#[wasm_bindgen]
pub fn neural_job_chunk(e:JsValue,run:JsValue,entry:JsValue,chunk:JsValue)->R<()>{
 let index=read(&chunk,"index")?;let last=read(&chunk,"last")?;let pcm=read(&chunk,"pcm")?;let rate=read(&chunk,"sampleRate")?;let ms=read(&chunk,"ms")?;
 let marks=read(&chunk,"marks")?;let marks=if marks.is_undefined(){Array::new().into()}else{marks};
 let marks=crate::speech_numbers::restore_marks(&marks,&get(&entry,"speechOffsetPairs"))?;
 if read(&e,"run")?!=run{return Ok(());}
 set(&run,"segStart",&n(now()))?;
 let dur=num(&read(&pcm,"length")?)/num(&rate);
 let counts=read(&entry,"counts")?;
 let ids=if absent(&counts){0.0}else{let ids=num(&read(&counts,&string(&index))?);if ids.is_nan(){0.0}else{ids}};
 if ids!=0.0&&dur>0.2{
  let spi=num(&read(&run,"spi")?);
  set(&run,"spi",&n(if spi!=0.0&&!spi.is_nan(){spi*0.5+(dur/ids)*0.5}else{dur/ids}))?;
 }
 let ms=num(&ms);
 if ms>0.0&&dur>0.2{
  let rtf=jmin(ms/1000.0/dur,limit(&e,"maxRtfSample")?);
  let seen=t(&read(&run,"rtfN")?);
  let smoothed=if seen{num(&read(&run,"rtf")?)*0.6+rtf*0.4}else{rtf};
  set(&run,"rtf",&n(smoothed))?;bump(&run,"rtfN")?;set(&read(&e,"stats")?,"rtf",&n(smoothed))?;
 }
 let record=Object::new();
 for (name,value) in [("pcm",pcm),("sampleRate",rate),("dur",n(dur)),("last",last.clone()),("marks",marks)]{set(&record,name,&value)?;}
 method(&read(&entry,"chunks")?,"push",&[&record])?;
 if t(&last){finish(&e,&entry)?;}
 if num(&read(&run,"rtfN")?)>=limit(&e,"minRtfSamples")?&&num(&read(&run,"rtf")?)>limit(&e,"slowRtf")?{buffer_slow(&e)?;}
 feed(&e,&run)?;pump(&e)
}
#[wasm_bindgen]
pub fn neural_job_end(e:JsValue,run:JsValue,entry:JsValue)->R<()>{
 if read(&e,"run")?!=run{return Ok(());}
 set(&run,"job",&JsValue::NULL)?;finish(&e,&entry)?;pump(&e)
}
#[wasm_bindgen]
pub fn neural_job_error(e:JsValue,run:JsValue,entry:JsValue,error:JsValue)->R<()>{
 if read(&e,"run")?!=run{return Ok(());}
 set(&run,"job",&JsValue::NULL)?;
 fail_entry(&e,&run,&entry,if read(&error,"code")?==st("init-failed"){"init-failed"}else{"synth-failed"})
}
#[wasm_bindgen]
pub fn neural_unit_mark(e:JsValue,unit:JsValue,offset:JsValue)->R<()>{
 let entry=entry_of(&e,&unit)?;
 if absent(&entry)||!t(&method(&read(&entry,"marks")?,"includes",&[&offset])?){return Ok(());}
 set(&entry,"mark",&offset)?;
 let id=read(&entry,"id")?;
 if !absent(&id){emit(&e,"boundary",&id,&JsValue::NULL,&offset)?;}
 Ok(())
}
#[wasm_bindgen]
pub fn neural_unit_started(e:JsValue,unit:JsValue)->R<()>{
 let run=read(&e,"run")?;let entry=entry_of(&e,&unit)?;
 if absent(&entry){return Ok(());}
 set(&entry,"started",&JsValue::TRUE)?;
 if !t(&read(&run,"firstAudio")?){set(&run,"firstAudio",&JsValue::TRUE)?;set(&read(&e,"stats")?,"firstAudioMs",&n(now()-num(&read(&run,"t0")?)))?;}
 set_status(&e,"speaking")?;
 let id=read(&entry,"id")?;
 if !absent(&id){emit(&e,"start",&id,&JsValue::UNDEFINED,&JsValue::UNDEFINED)?;}
 feed(&e,&run)?;pump(&e)
}
#[wasm_bindgen]
pub fn neural_unit_ended(e:JsValue,unit:JsValue)->R<()>{
 let run=read(&e,"run")?;let entry=entry_of(&e,&unit)?;
 if absent(&entry){return Ok(());}
 set(&entry,"ended",&JsValue::TRUE)?;
 let streak=num(&read(&e,"cleanStreak")?)+1.0;set(&e,"cleanStreak",&n(streak))?;
 if streak>=limit(&e,"cleanFragments")?{set(&e,"underrunTimes",&Array::new())?;}
 let id=read(&entry,"id")?;
 if !absent(&id){emit(&e,"done",&id,&JsValue::UNDEFINED,&JsValue::UNDEFINED)?;}
 set(&entry,"chunks",&Array::new())?; // the cache keeps its own reference for replays
 feed(&e,&run)?;pump(&e)?;
 if every_ended(&run)?&&!t(&read(&run,"job")?){set_status(&e,"idle")?;arm_idle(&e)?;}
 Ok(())
}
#[wasm_bindgen]
pub fn neural_player_error(e:JsValue,reason:JsValue)->R<()>{
 let id=read(&e,"currentId")?;hard_stop(&e,&no_options())?;emit(&e,"error",&id,&reason,&JsValue::UNDEFINED)
}
/// The system can take the audio away (a call, Bluetooth switching, the OS suspending the page): that is 'interrupted'.
#[wasm_bindgen]
pub fn neural_watch(e:JsValue,ctx:JsValue)->R<()>{
 if !t(&ctx)||ctx==read(&e,"watched")?{return Ok(());}
 set(&e,"watched",&ctx)?;set(&e,"sawRunning",&JsValue::from_bool(read(&ctx,"state")?==st("running")))?;
 method(&e,"_listen",&[&ctx])?;Ok(())
}
#[wasm_bindgen]
pub fn neural_state_change(e:JsValue,ctx:JsValue)->R<()>{
 if ctx!=read(&e,"watched")?{return Ok(());}
 let state=read(&ctx,"state")?;
 if state==st("running"){set(&e,"sawRunning",&JsValue::TRUE)?;return Ok(());}
 if !t(&read(&e,"run")?)||(state==st("suspended")&&!t(&read(&e,"sawRunning")?)){return Ok(());}
 let id=read(&e,"currentId")?;hard_stop(&e,&no_options())?;emit(&e,"interrupted",&id,&JsValue::UNDEFINED,&JsValue::UNDEFINED)
}

// ---------------------------------------------------------------- the worker
fn refresh_style_session(e:&JsValue,voice:&JsValue)->R<()>{
 // Expanding an installed pack does not interrupt its current audiobook; a newly downloaded profile replaces a legacy three-style worker.
 if read(voice,"runtime")?!=st("supertonic3"){return Ok(());}
 let client=read(e,"client")?;
 if absent(&client)||get(&client,"loaded")!=read(voice,"piperId")?{return Ok(());}
 let config=get(&client,"config");
 if get(&config,"runtime")!=st("supertonic3"){return Ok(());}
 let styles=get(&config,"styles");
 if !t(&get(&styles,&string(&read(voice,"style")?))){teardown(e)?;}
 Ok(())
}
/// Starts preparing the worker for a run: returns [promise, started, cold] (the host awaits the promise).
#[wasm_bindgen]
pub fn neural_prepare_begin(e:JsValue,run:JsValue)->R{
 set(&run,"prepared",&st("pending"))?;set_status(&e,"loading")?;
 let started=now();
 refresh_style_session(&e,&read(&run,"voice")?)?;
 let client=read(&e,"client")?;
 let cold=absent(&client)||!t(&get(&client,"alive"));
 let client=if t(&client){client}else{let made=method(&e,"createClient",&[])?;set(&e,"client",&made)?;made};
 let promise=method(&client,"prepare",&[&read(&read(&run,"voice")?,"piperId")?])?;
 Ok(Array::of3(&promise,&n(started),&JsValue::from_bool(cold)).into())
}
#[wasm_bindgen]
pub fn neural_prepare_ready(e:JsValue,run:JsValue,started:f64,cold:bool)->R<()>{
 if cold{set(&e,"coldMs",&n(crate::host::jmax(1500.0,now()-started)))?;}
 if read(&e,"run")?!=run{return Ok(());}
 set(&run,"prepared",&st("ready"))?;
 if t(&get(&run,"preview"))&&absent(&read(&e,"idleTimer")?){arm_idle(&e)?;}
 set_status(&e,"buffering")?;pump(&e)
}
#[wasm_bindgen]
pub fn neural_prepare_failed(e:JsValue,run:JsValue)->R<()>{
 if read(&e,"run")?!=run{return Ok(());}
 let id=read(&e,"currentId")?;hard_stop(&e,&no_options())?;teardown(&e)?;emit_plain(&e,"error",&id,"init-failed")
}
/// A jump cannot cancel the segment the worker is computing: its answer is waited for. That wait is predicted from the
/// plan and compared with what rebuilding the worker costs (a cold start, measured the first time).
fn worth_rebuilding(e:&JsValue,run:&JsValue)->R<bool>{
 if !t(run)||!t(&read(run,"job")?){return Ok(false);}
 let client=read(e,"client")?;
 if absent(&client)||!t(&get(&client,"alive")){return Ok(false);}
 let entries=arr(&read(run,"entries")?);let mut found=JsValue::UNDEFINED;
 for i in 0..entries.length(){let entry=entries.get(i);if read(&entry,"state")?==st("synth"){found=entry;break;}}
 if absent(&found){return Ok(false);}
 let counts=read(&found,"counts")?;
 if absent(&counts){return Ok(false);}
 let ids=num(&read(&counts,&string(&read(&read(&found,"chunks")?,"length")?))?);
 if ids==0.0||ids.is_nan(){return Ok(false);}
 let rtf=if t(&read(run,"rtfN")?){num(&read(run,"rtf")?)}else{limit(e,"rtfPrior")?};
 let spi=num(&read(run,"spi")?);let spi=if spi!=0.0&&!spi.is_nan(){spi}else{0.03/num(&read(run,"rate")?)};
 let remaining=ids*spi*rtf*1000.0-(now()-num(&read(run,"segStart")?));
 let cold=num(&read(e,"coldMs")?);
 Ok(remaining>if cold!=0.0&&!cold.is_nan(){cold}else{limit(e,"coldStartMs")?})
}
fn select_preview_voice(e:&JsValue,voice:&JsValue)->R<()>{
 // Selecting another model must not queue behind an obsolete silent inference; profiles in the same pack keep the shared session.
 let run=read(e,"run")?;
 let previous=if t(&run)&&t(&read(&run,"preview")?){read(&run,"voice")?}else{JsValue::NULL};
 if t(&previous)&&read(&previous,"id")?!=read(voice,"id")?{hard_stop(e,&no_options())?;}
 let mut model=get(&previous,"piperId");
 if !t(&model){model=read(e,"preparingModel")?;}
 if !t(&model){model=get(&read(e,"client")?,"loaded");}
 if t(&model)&&model!=read(voice,"piperId")?{teardown(e)?;}
 set(e,"preparingModel",&read(voice,"piperId")?)
}

// ---------------------------------------------------------------- the public surface
#[wasm_bindgen]
pub fn neural_diagnostic_state(e:JsValue)->R{
 let run=read(&e,"run")?;let entries=if t(&run){arr(&read(&run,"entries")?)}else{Array::new()};
 let current=read(&e,"currentId")?;let status=read(&e,"_status")?;
 let (mut queued,mut synth,mut done,mut started,mut ended,mut deferred,mut scheduled,mut available,mut unit)=(0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,JsValue::NULL);
 let mut found=false;
 for i in 0..entries.length(){
  let entry=entries.get(i);let state=read(&entry,"state")?;
  if state==st("queued"){queued+=1.0;}
  if state==st("synth"){synth+=1.0;}
  if state==st("done"){done+=1.0;}
  if t(&read(&entry,"started")?){started+=1.0;}
  if t(&read(&entry,"ended")?){ended+=1.0;}
  if t(&read(&entry,"deferred")?){deferred+=1.0;}
  if !found&&read(&entry,"id")?==current{found=true;let number=read(&entry,"n")?;unit=if absent(&number){JsValue::NULL}else{number};}
  scheduled+=num(&read(&entry,"scheduled")?);available+=num(&read(&read(&entry,"chunks")?,"length")?);
 }
 let prepared=get(&run,"prepared");
 let timers=Object::new();
 for (name,present) in [("pump",!absent(&get(&run,"pumpTimer"))),("feed",!absent(&get(&run,"feedTimer"))),("hold",!absent(&get(&run,"holdTimer"))),("idle",!absent(&read(&e,"idleTimer")?))]{set(&timers,name,&JsValue::from_bool(present))?;}
 let out=Object::new();
 for (name,value) in [("loaded",JsValue::TRUE),("moduleLoading",JsValue::FALSE),("queuedRequests",n(0.0)),("status",status),("run",JsValue::from_bool(t(&run))),
  ("job",JsValue::from_bool(t(&get(&run,"job")))),("prepared",st(if prepared==st("pending"){"pending"}else if prepared==st("ready"){"ready"}else{"none"})),
  ("workerAlive",JsValue::from_bool(t(&get(&read(&e,"client")?,"alive")))),("currentUnit",unit),("entryCount",n(entries.length() as f64)),
  ("queued",n(queued)),("synth",n(synth)),("done",n(done)),("started",n(started)),("ended",n(ended)),("deferred",n(deferred)),
  ("gateOpen",JsValue::from_bool(t(&get(&run,"gateOpen")))),("buffered",JsValue::from_bool(t(&get(&run,"buffered")))),
  ("scheduledChunks",n(scheduled)),("availableChunks",n(available)),("timers",timers.into())]{set(&out,name,&value)?;}
 Ok(out.into())
}
/// Compares the listing with the installed set: the new Set when it differs, otherwise undefined.
#[wasm_bindgen]
pub fn neural_list(e:JsValue)->R{
 let store=read(&e,"store")?;let voices=read(&e,"voices")?;
 let listing=read(&store,"listVoices")?;
 let out=Array::new();
 if t(&listing){out.push(&method(&store,"listVoices",&[&voices])?);out.push(&JsValue::FALSE);}
 else{out.push(&method(&store,"list",&[])?);out.push(&JsValue::TRUE);}
 Ok(out.into())
}
#[wasm_bindgen]
pub fn neural_listed(e:JsValue,value:JsValue,legacy:bool)->R{
 if !legacy{return Ok(value);}
 let ids=js_sys::Set::new(&JsValue::UNDEFINED);let voices=arr(&read(&e,"voices")?);
 for i in 0..voices.length(){let voice=voices.get(i);if t(&method(&value,"has",&[&read(&voice,"piperId")?])?){ids.add(&read(&voice,"id")?);}}
 Ok(ids.into())
}
#[wasm_bindgen]
pub fn neural_installed_changed(e:JsValue,next:JsValue)->R<()>{
 let current=read(&e,"_installed")?;
 if num(&read(&next,"size")?)==num(&read(&current,"size")?){
  let mut same=true;
  for value in js_sys::try_iter(&next)?.ok_or_else(||JsValue::from(js_sys::TypeError::new("not iterable")))?{if !t(&method(&current,"has",&[&value?])?){same=false;break;}}
  if same{return Ok(());}
 }
 set(&e,"_installed",&next)?;changed(&e)
}
/// Everything of install() before the download starts: undefined when nothing is to be done, a promise when the model is
/// already being fetched, else [voice, siblings, abort controller] for the host to run the download.
#[wasm_bindgen]
pub fn neural_install_begin(e:JsValue,id:JsValue,signal:JsValue)->R{
 let voice=find_voice(&read(&e,"voices")?,&id)?;
 if !t(&voice)||!t(&read(&e,"supported")?){
  let error=js_sys::Error::new("unsupported");set(&error,"code",&st("unsupported"))?;return Err(error.into());
 }
 let piper=read(&voice,"piperId")?;
 let siblings=arr(&method(&read(&e,"models")?,"get",&[&piper])?);
 let installed=read(&e,"_installed")?;let mut all=true;
 for i in 0..siblings.length(){if !t(&method(&installed,"has",&[&read(&siblings.get(i),"id")?])?){all=false;break;}}
 if all&&!t(&method(&read(&e,"_downloads")?,"has",&[&id])?){return Ok(JsValue::UNDEFINED);}
 let installing=read(&e,"installing")?;
 if t(&method(&installing,"has",&[&piper])?){return method(&installing,"get",&[&piper]);}
 publish(&e,&siblings,&download_entry("downloading",0.0,0.0,0.0))?;
 // The download is shared by the speakers of one model, so cancel(id) of any of them aborts it (not only the caller's signal).
 let ctor:js_sys::Function=get(&crate::host::global(),"AbortController").dyn_into().map_err(|_|JsValue::from(js_sys::TypeError::new("AbortController is not a constructor")))?;
 let abort=js_sys::Reflect::construct(&ctor,&Array::new())?;
 if t(&get(&signal,"aborted")){method(&abort,"abort",&[])?;}
 else if !absent(&signal){
  let once=Object::new();set(&once,"once",&JsValue::TRUE)?;
  crate::host::method_opt(&signal,"addEventListener",&[&st("abort"),&method(&e,"_aborter",&[&abort])?,&once])?;
 }
 method(&read(&e,"aborts")?,"set",&[&piper,&abort])?;
 Ok(Array::of3(&voice,&siblings,&abort).into())
}
fn download_entry(state:&str,fraction:f64,received:f64,total:f64)->JsValue{
 let entry=Object::new();
 for (name,value) in [("state",st(state)),("fraction",n(fraction)),("received",n(received)),("total",n(total))]{let _=set(&entry,name,&value);}
 entry.into()
}
fn publish(e:&JsValue,siblings:&Array,entry:&JsValue)->R<()>{
 let downloads=read(e,"_downloads")?;
 for i in 0..siblings.length(){method(&downloads,"set",&[&read(&siblings.get(i),"id")?,entry])?;}
 changed(e)
}
/// Progress is published at most every 120 ms ('change' on every network chunk would flood the picker); the host keeps the last time.
#[wasm_bindgen]
pub fn neural_install_progress(e:JsValue,siblings:JsValue,last:f64,progress:JsValue)->R<f64>{
 let received=read(&progress,"received")?;let total=read(&progress,"total")?;let fraction=read(&progress,"fraction")?;
 let at=now();
 if at-last<120.0&&num(&fraction)<1.0{return Ok(last);}
 publish(&e,&arr(&siblings),&{let entry=Object::new();for (name,value) in [("state",st("downloading")),("fraction",fraction),("received",received),("total",total)]{set(&entry,name,&value)?;}JsValue::from(entry)})?;
 Ok(at)
}
#[wasm_bindgen]
pub fn neural_install_done(e:JsValue,siblings:JsValue)->R<()>{
 let list=arr(&siblings);let installed=read(&e,"_installed")?;let downloads=read(&e,"_downloads")?;
 for i in 0..list.length(){let id=read(&list.get(i),"id")?;method(&installed,"add",&[&id])?;method(&downloads,"delete",&[&id])?;}
 changed(&e)
}
/// Publishes the failure and returns the error to throw (the store's own when it has a code).
#[wasm_bindgen]
pub fn neural_install_failed(e:JsValue,siblings:JsValue,error:JsValue,store_error:JsValue)->R{
 let code=read(&error,"code")?;let aborted=code==st("aborted");
 let list=arr(&siblings);let downloads=read(&e,"_downloads")?;
 for i in 0..list.length(){
  let id=read(&list.get(i),"id")?;
  if aborted{method(&downloads,"delete",&[&id])?;}
  else{
   let entry=Object::new();
   for (name,value) in [("state",st("error")),("fraction",n(0.0)),("received",n(0.0)),("total",n(0.0)),("error",read(&error,"message")?),("code",code.clone())]{set(&entry,name,&value)?;}
   method(&downloads,"set",&[&id,&entry])?;
  }
 }
 changed(&e)?;
 if t(&code){Ok(error)}else{crate::host::call(&store_error,"storeError",&[&st("http"),&read(&error,"message")?,&error])}
}
#[wasm_bindgen]
pub fn neural_install_finally(e:JsValue,piper:JsValue,abort:JsValue)->R<()>{
 method(&read(&e,"installing")?,"delete",&[&piper])?;
 let aborts=read(&e,"aborts")?;
 if method(&aborts,"get",&[&piper])?==abort{method(&aborts,"delete",&[&piper])?;}
 Ok(())
}
/// Aborts the download of the model this voice belongs to (whichever of its speakers asked for it).
#[wasm_bindgen]
pub fn neural_cancel(e:JsValue,id:JsValue)->R<()>{
 let voice=find_voice(&read(&e,"voices")?,&id)?;
 if t(&voice){let abort=method(&read(&e,"aborts")?,"get",&[&read(&voice,"piperId")?])?;if !absent(&abort){method(&abort,"abort",&[])?;}}
 Ok(())
}
/// The synchronous part of remove(): the voice (or undefined) whose files the host now deletes.
#[wasm_bindgen]
pub fn neural_remove_begin(e:JsValue,id:JsValue)->R{
 let voice=find_voice(&read(&e,"voices")?,&id)?;
 if !t(&voice){return Ok(JsValue::UNDEFINED);}
 let piper=read(&voice,"piperId")?;let run=read(&e,"run")?;
 if get(&get(&run,"voice"),"piperId")==piper&&!absent(&run){
  // A voice being read cannot be answered any more: stop() fires no event, so say it for the current fragment.
  let current=read(&e,"currentId")?;method(&e,"stop",&[])?;emit_plain(&e,"error",&current,"not-installed")?;
 }
 if get(&read(&e,"client")?,"loaded")==piper&&!t(&read(&e,"run")?){teardown(&e)?;}
 Ok(voice)
}
#[wasm_bindgen]
pub fn neural_remove_end(e:JsValue,voice:JsValue)->R<()>{
 let piper=read(&voice,"piperId")?;
 let siblings=arr(&method(&read(&e,"models")?,"get",&[&piper])?);
 let installed=read(&e,"_installed")?;let downloads=read(&e,"_downloads")?;
 for i in 0..siblings.length(){let id=read(&siblings.get(i),"id")?;method(&installed,"delete",&[&id])?;method(&downloads,"delete",&[&id])?;}
 let cache=read(&e,"cache")?;let keys=Array::from(&method(&read(&cache,"map")?,"keys",&[])?);
 let prefix=join(&[&piper,&st("#")])?;
 for i in 0..keys.length(){let key=keys.get(i);if t(&method(&key,"startsWith",&[&prefix])?){method(&cache,"delete",&[&key])?;}}
 changed(&e)
}
/// Everything of warmUp() before the worker is asked: the voice to warm, or undefined when nothing should be started.
#[wasm_bindgen]
pub fn neural_warm_begin(e:JsValue,voice_id:JsValue)->R{
 let voice=find_voice(&read(&e,"voices")?,&voice_id)?;
 if !t(&voice)||!t(&method(&read(&e,"_installed")?,"has",&[&read(&voice,"id")?])?)||!t(&read(&e,"supported")?){return Ok(JsValue::UNDEFINED);}
 let run=read(&e,"run")?;
 if t(&run)&&!t(&read(&run,"preview")?){return Ok(JsValue::UNDEFINED);} // never interrupt audible reading
 select_preview_voice(&e,&voice)?;clear_idle(&e)?;refresh_style_session(&e,&voice)?;
 Ok(voice)
}
/// `client ||= this.client = createClient()`
#[wasm_bindgen]
pub fn neural_client(e:JsValue)->R{
 let client=read(&e,"client")?;
 if t(&client){return Ok(client);}
 let made=method(&e,"createClient",&[])?;set(&e,"client",&made)?;Ok(made)
}
#[wasm_bindgen]
pub fn neural_warm_done(e:JsValue,client:JsValue)->R<bool>{
 if read(&e,"client")?!=client{return Ok(false);}
 let run=read(&e,"run")?;
 if !t(&run)||t(&get(&run,"preview")){arm_idle(&e)?;}
 Ok(true)
}
#[wasm_bindgen]
pub fn neural_warm_failed(e:JsValue,client:JsValue)->R<bool>{
 if read(&e,"client")?==client&&!t(&read(&e,"run")?){teardown(&e)?;}
 Ok(false)
}
/// Prepares a bounded opening reserve silently; Play adopts even in-flight synthesis.
#[wasm_bindgen]
pub fn neural_prime(e:JsValue,request:JsValue)->R<bool>{
 let text=read(&request,"text")?;let voice_id=read(&request,"voiceId")?;let rate=read(&request,"rate")?;
 let upcoming=read(&request,"upcoming")?;let upcoming=if upcoming.is_undefined(){Array::new().into()}else{upcoming};
 let marks=read(&request,"marks")?;let marks=if marks.is_undefined(){Array::new().into()}else{marks};
 let voice=find_voice(&read(&e,"voices")?,&voice_id)?;
 if !t(&text)||!t(&voice)||!t(&method(&read(&e,"_installed")?,"has",&[&read(&voice,"id")?])?)||!t(&read(&e,"supported")?){return Ok(false);}
 let run=read(&e,"run")?;
 if t(&run)&&!t(&read(&run,"preview")?){return Ok(false);}
 let rate=clamp_rate(&rate);
 let value=Object::new();set(&value,"text",&text)?;set(&value,"marks",&marks)?;
 if t(&run)&&read(&read(&run,"voice")?,"id")?==read(&voice,"id")?&&num(&read(&run,"rate")?)==rate{
  let first=get(&read(&run,"entries")?,"0");
  if matches(&first,&value)?{return Ok(true);}
 }
 select_preview_voice(&e,&voice)?;
 if t(&read(&e,"run")?){hard_stop(&e,&no_options())?;}
 clear_idle(&e)?;
 let run=new_run(&voice,rate,true)?;set(&e,"run",&run)?;
 new_entry(&e,&run,&value,true)?;
 let more=clip(&upcoming,(limit(&e,"maxAhead")?-1.0).max(0.0).min(limit(&e,"maxUpcoming")?))?;
 for i in 0..more.length(){new_entry(&e,&run,&more.get(i),true)?;}
 arm_idle(&e)?;pump(&e)?;Ok(true)
}
#[wasm_bindgen]
pub fn neural_speak(e:JsValue,request:JsValue)->R<()>{
 let text=read(&request,"text")?;let voice_id=read(&request,"voiceId")?;let rate=read(&request,"rate")?;let id=read(&request,"id")?;
 let upcoming=read(&request,"upcoming")?;let upcoming=if upcoming.is_undefined(){Array::new().into()}else{upcoming};
 let defer_after=defer_of(&read(&request,"deferAfter")?);
 let marks=read(&request,"marks")?;let marks=if marks.is_undefined(){Array::new().into()}else{marks};
 clear_idle(&e)?;
 let voice=find_voice(&read(&e,"voices")?,&voice_id)?;
 if !t(&voice)||!t(&method(&read(&e,"_installed")?,"has",&[&read(&voice,"id")?])?){hard_stop(&e,&no_options())?;return emit_plain(&e,"error",&id,"not-installed");}
 let audio=read(&e,"audio")?;
 if !t(&method(&audio,"context",&[])?)&&!t(&method(&audio,"unlock",&[])?){hard_stop(&e,&no_options())?;return emit_plain(&e,"error",&id,"init-failed");}
 neural_watch(e.clone(),method(&audio,"context",&[])?)?;
 let rate=clamp_rate(&rate);
 let upcoming_texts=clip(&if t(&upcoming){upcoming}else{Array::new().into()},limit(&e,"maxUpcoming")?)?;
 let current=read(&e,"run")?;
 if t(&get(&current,"preview"))&&read(&read(&current,"voice")?,"id")?!=read(&voice,"id")?{select_preview_voice(&e,&voice)?;}
 let mut run=read(&e,"run")?;
 let value=Object::new();set(&value,"text",&text)?;set(&value,"marks",&marks)?;
 let mut head=JsValue::NULL;
 if t(&run)&&read(&read(&run,"voice")?,"id")?==read(&voice,"id")?&&num(&read(&run,"rate")?)==rate{
  let entries=arr(&read(&run,"entries")?);
  for i in 0..entries.length(){let entry=entries.get(i);if absent(&read(&entry,"id")?){head=entry;break;}}
 }
 if t(&head)&&matches(&head,&value)?{
  if t(&read(&run,"preview")?){set(&run,"preview",&JsValue::FALSE)?;set(&run,"t0",&n(now()))?;}
  adopt(&e,&run,&head,&id,&upcoming_texts,false,defer_after,true)?;
 }else{
  // A page read to its end hands over to a fresh run: the hiccup it may have had is history. A restart in mid-page keeps its record.
  if t(&run)&&num(&read(&read(&run,"entries")?,"length")?)>0.0&&every_ended(&run)?{set(&e,"underrunTimes",&Array::new())?;}
  let rebuild=worth_rebuilding(&e,&run)?;
  let keep=Object::new();set(&keep,"keepSession",&JsValue::TRUE)?;
  hard_stop(&e,&keep)?;
  if rebuild{teardown(&e)?;}
  run=new_run(&voice,rate,false)?;set(&e,"run",&run)?;
  let entry=new_entry(&e,&run,&value,false)?;
  adopt(&e,&run,&entry,&id,&upcoming_texts,true,defer_after,true)?;
  set_status(&e,"buffering")?;
 }
 feed(&e,&run)?;pump(&e)
}
/// Append a prepared page while this fragment plays, without restarting it. Deferred PCM is computed/cached but cannot
/// reach the audio player until the reader adopts its fragment with an actual speak() call.
#[wasm_bindgen]
pub fn neural_extend_upcoming(e:JsValue,request:JsValue)->R<bool>{
 let id=read(&request,"id")?;let voice_id=read(&request,"voiceId")?;let rate=read(&request,"rate")?;
 let upcoming=read(&request,"upcoming")?;let upcoming=if upcoming.is_undefined(){Array::new().into()}else{upcoming};
 let defer_after=defer_of(&read(&request,"deferAfter")?);
 let run=read(&e,"run")?;
 if !t(&run)||read(&e,"currentId")?!=id||read(&read(&run,"voice")?,"id")?!=voice_id||num(&read(&run,"rate")?)!=clamp_rate(&rate){return Ok(false);}
 let entries=arr(&read(&run,"entries")?);let mut current=JsValue::UNDEFINED;
 for i in 0..entries.length(){let entry=entries.get(i);if read(&entry,"id")?==id{current=entry;break;}}
 if !t(&current)||t(&read(&current,"ended")?){return Ok(false);}
 adopt(&e,&run,&current,&id,&clip(&upcoming,limit(&e,"maxUpcoming")?)?,false,defer_after,false)?;
 feed(&e,&run)?;pump(&e)?;Ok(true)
}
#[wasm_bindgen]
pub fn neural_stop(e:JsValue)->R<()>{hard_stop(&e,&no_options())?;arm_idle(&e)}
#[wasm_bindgen]
pub fn neural_pause(e:JsValue)->R<()>{
 let options=Object::new();set(&options,"pause",&JsValue::TRUE)?;hard_stop(&e,&options)?;arm_idle(&e)
}
/// Cancel a changed voice/rate without tearing down the native foreground session.
#[wasm_bindgen]
pub fn neural_cancel_current(e:JsValue)->R<()>{
 let options=Object::new();set(&options,"keepSession",&JsValue::TRUE)?;hard_stop(&e,&options)?;arm_idle(&e)
}
/// Release only on an explicit book close. Ordinary stop/pause retain their cache.
#[wasm_bindgen]
pub fn neural_release(e:JsValue)->R<()>{
 let stopped=hard_stop(&e,&no_options());
 clear_idle(&e)?;
 let client=read(&e,"client")?;set(&e,"client",&JsValue::NULL)?;
 neural_cache_clear(read(&e,"cache")?)?;
 if !absent(&client){let _=method(&client,"dispose",&[]);}
 stopped
}
#[wasm_bindgen]
pub fn neural_unlock(e:JsValue,options:JsValue,native_bridge:JsValue)->R<()>{
 let playback=if options.is_undefined(){true}else{let value=read(&options,"playback")?;value.is_undefined()||t(&value)};
 if playback||!t(&crate::host::call(&native_bridge,"nativePcmBridge",&[&read(&e,"env")?])?){method(&read(&e,"audio")?,"unlock",&[])?;}
 Ok(())
}
