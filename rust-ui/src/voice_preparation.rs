//! Speech preparation caches preserve source identity and cancellation generations.
//! Browser/source callbacks stay in the host adapter to avoid cross-heap cycles.
use wasm_bindgen::{prelude::*,JsCast};
use wasm_bindgen_futures::{future_to_promise,JsFuture};
use js_sys::{Array,Function,Object,Promise,JSON,Reflect,RegExp};
use crate::reader_actions::{get,set,call,one,two};
use crate::voice_join::spread;
fn absent(v:&JsValue)->bool{v.is_null()||v.is_undefined()}
fn optional(v:&JsValue,key:&str)->Result<JsValue,JsValue>{if absent(v){Ok(JsValue::UNDEFINED)}else{get(v,key)}}
fn maybe(v:&JsValue,key:&str,args:&Array)->Result<JsValue,JsValue>{let method=optional(v,key)?;if absent(&method){Ok(JsValue::UNDEFINED)}else{method.dyn_into::<Function>().map_err(|_|JsValue::from(js_sys::TypeError::new("Speech preparation method is not callable")))?.apply(v,args)}}
async fn wait(v:Result<JsValue,JsValue>)->Result<JsValue,JsValue>{JsFuture::from(Promise::resolve(&v?)).await}
fn clear(v:&JsValue)->Result<(),JsValue>{maybe(v,"clear",&Array::new())?;Ok(())}
fn object(values:&[(&str,JsValue)])->Result<Object,JsValue>{let v=Object::new();for(k,x)in values{set(&v,k,x)?;}Ok(v)}
fn encoded(v:&JsValue)->Result<JsValue,JsValue>{Ok(JSON::stringify(v)?.into())}
#[wasm_bindgen]
extern "C"{
 #[wasm_bindgen(catch,js_name=Number)]fn number(v:&JsValue)->Result<f64,JsValue>;
 #[wasm_bindgen(catch,js_name=Object)]fn boxed(v:&JsValue)->Result<JsValue,JsValue>;
}
fn source_plan(host:&JsValue,source:JsValue,opening:bool,plan:&Function,first:&Function)->Result<JsValue,JsValue>{
 let options=get(host,"options")?;let text=get(&source,"text")?;
 let from=if get(host,"completeOpening")?.is_truthy()&&opening{first.apply(&JsValue::UNDEFINED,&Array::of4(&text,&get(&source,"start")?,&get(&source,"previousText")?,&options))?}else{let start=get(&source,"start")?;if start.is_truthy(){start}else{0.into()}};
 let args=object(&[("footnotes",get(&options,"footnotes")?),("skipHeaders",get(&options,"skipHeaders")?),("opening",opening.into()),("pageBreaks",get(&source,"pageBreaks")?),("headerRanges",get(&source,"headerRanges")?)])?;
 let items=plan.call3(&JsValue::UNDEFINED,&text,&args,&from)?;
 Ok(object(&[("source",source),("items",items)])?.into())
}
fn finish(host:JsValue,source:JsValue,opening:bool,plan:Function,first:Function)->Result<Promise,JsValue>{
 if source.is_truthy(){return Ok(Promise::resolve(&source_plan(&host,source,opening,&plan,&first)?));}
 let pending=call(&get(&host,"reader")?,"getSpeechText");
 Ok(future_to_promise(async move{
  let text=one(&host,"prepareText",&wait(pending).await?)?;
  let text=two(&boxed(&text)?,"replace",&RegExp::new("\\s+","g").into(),&" ".into())?;
  let text=call(&boxed(&text)?,"trim")?;
  let list:Array=plan.call2(&JsValue::UNDEFINED,&text,&object(&[("opening",opening.into())])?.into())?.unchecked_into();
  let items=Array::new_with_length(list.length());
  for i in 0..list.length(){if Reflect::has(&list,&i.into())?{items.set(i,object(&[("text",get(&list.get(i),"text")?)])?.into());}}
  Ok(object(&[("source",source),("items",items.into())])?.into())
 }))
}
#[wasm_bindgen]
pub fn voice_prepare(host:JsValue,source:JsValue,opening:bool,plan:Function,first:Function)->Result<Promise,JsValue>{
 if !source.is_undefined(){return finish(host,source,opening,plan,first);}
 let options=if get(&host,"completeOpening")?.is_truthy()&&opening{object(&[("visible",JsValue::TRUE),("completeSentences",JsValue::TRUE)])?.into()}else{JsValue::UNDEFINED};
 let pending=maybe(&get(&host,"reader")?,"getSpeechSource",&Array::of1(&options))?;
 if !pending.is_truthy(){return finish(host,JsValue::NULL,opening,plan,first);}
 Ok(future_to_promise(async move{let source=wait(Ok(pending)).await?;JsFuture::from(finish(host,source,opening,plan,first)?).await}))
}
fn opening_key(host:&JsValue)->Result<JsValue,JsValue>{
 let options=get(host,"options")?;let parts=Array::of4(&get(&get(host,"reader")?,"location")?,&get(&options,"footnotes")?,&get(&options,"skipHeaders")?,&get(host,"openingLayout")?);
 parts.push(&get(host,"completeOpening")?.is_truthy().into());encoded(&parts)
}
#[wasm_bindgen]
pub fn voice_prepare_opening(host:JsValue)->Result<Promise,JsValue>{
 let generation=get(&host,"generation")?;let key=opening_key(&host)?;let mut pending=get(&host,"openingPlan")?;
 if !pending.is_truthy()||get(&pending,"key")?!=key{pending=object(&[("key",key.clone()),("promise",two(&host,"prepare",&JsValue::UNDEFINED,&JsValue::TRUE)?)])?.into();set(&host,"openingPlan",&pending)?;}
 let promise=get(&pending,"promise");
 Ok(future_to_promise(async move{
  let result=async{
   let plan=wait(promise).await?;
   if !get(&host,"browsing")?.is_truthy()&&get(&host,"state")?==JsValue::from_str("loading")&&get(&host,"generation")?==generation&&opening_key(&host)?!=key{return call(&host,"prepareOpening");}
   if !one(&host,"pagePlanValid",&plan)?.is_truthy(){if get(&host,"openingPlan")?==pending{set(&host,"openingPlan",&JsValue::NULL)?;}return two(&host,"prepare",&JsValue::UNDEFINED,&JsValue::TRUE);}
   Ok(plan)
  }.await;
  if result.is_err()&&get(&host,"openingPlan")?==pending{set(&host,"openingPlan",&JsValue::NULL)?;}result
 }))
}
fn idle(host:&JsValue)->Result<bool,JsValue>{let state=get(host,"state")?;Ok(state==JsValue::from_str("stopped")||state==JsValue::from_str("paused"))}
fn settings(host:&JsValue)->Result<JsValue,JsValue>{encoded(&Array::of4(&get(host,"voice")?,&get(host,"rate")?,&get(host,"languageOverride")?,&get(host,"options")?))}
fn location(host:&JsValue)->Result<JsValue,JsValue>{encoded(&get(&get(host,"reader")?,"location")?)}
fn playback(host:&JsValue,items:JsValue,active:&Function,generation:&JsValue,loc:&JsValue,prefs:&JsValue,engine:&Function)->Result<JsValue,JsValue>{
 if !active.call0(&JsValue::UNDEFINED)?.is_truthy()||get(host,"generation")?!=*generation||location(host)?!=*loc||settings(host)?!=*prefs||!idle(host)?||!get(&items,"length")?.is_truthy(){return Ok(JsValue::FALSE);}
 let first=Reflect::get_u32(&items,0)?;let voice=get(&one(host,"voiceFor",&get(&first,"text")?)?,"voice")?;
 if !optional(&voice,"neural")?.is_truthy(){return Ok(JsValue::FALSE);}
 let next:Array=two(&items,"slice",&1.into(),&2.into())?.unchecked_into();let upcoming=Array::new();
 for i in 0..next.length(){if Reflect::has(&next,&i.into())?{let item=next.get(i);if optional(&get(&one(host,"voiceFor",&get(&item,"text")?)?,"voice")?,"id")?==get(&voice,"id")?{upcoming.push(&one(host,"audioItem",&item)?);}}}
 let args=object(&[("text",get(&first,"text")?),("voiceId",get(&voice,"id")?),("rate",get(host,"rate")?),("upcoming",upcoming.into())])?;
 let marks=get(&first,"marks")?;if optional(&marks,"length")?.is_truthy(){let marks:Array=marks.unchecked_into();let offsets=Array::new_with_length(marks.length());for i in 0..marks.length(){if Reflect::has(&marks,&i.into())?{offsets.set(i,get(&marks.get(i),"offset")?);}}set(&args,"marks",&offsets)?;}
 maybe(&engine.call0(&JsValue::UNDEFINED)?,"prime",&Array::of1(&args))
}
#[wasm_bindgen]
pub fn voice_prepare_playback(host:JsValue,active:Function,engine:Function)->Result<Promise,JsValue>{
 if !idle(&host)?||get(&host,"resumeNextPage")?.is_truthy()||call(&host,"restartFromVisiblePage")?.is_truthy(){return Ok(Promise::resolve(&JsValue::FALSE));}
 let generation=get(&host,"generation")?;let loc=location(&host)?;let prefs=settings(&host)?;
 let prepared:Result<(bool,JsValue),JsValue>=(||{
  if get(&host,"state")?==JsValue::from_str("paused")&&get(&get(&host,"chunks")?,"length")?.is_truthy()&&!get(&host,"resumeNextPage")?.is_truthy(){
   let index=get(&host,"index")?;let texts:Array=one(&get(&host,"chunks")?,"slice",&index)?.unchecked_into();let items=Array::new_with_length(texts.length());
   for i in 0..texts.length(){if Reflect::has(&texts,&i.into())?{let item=Reflect::get_f64(&get(&host,"items")?,number(&index)?+i as f64)?;items.set(i,if item.is_truthy(){item}else{object(&[("text",texts.get(i))])?.into()});}}
   Ok((false,playback(&host,items.into(),&active,&generation,&loc,&prefs,&engine)?))
  }else{Ok((true,call(&host,"prepareOpening")?))}
 })();
 Ok(future_to_promise(async move{
  let result=async{let(needs_plan,pending)=prepared?;let value=wait(Ok(pending)).await?;
   if needs_plan{wait(playback(&host,get(&value,"items")?,&active,&generation,&loc,&prefs,&engine)).await}else{Ok(value)}
  }.await;
  Ok(result.ok().filter(JsValue::is_truthy).unwrap_or(JsValue::FALSE))
 }))
}
#[wasm_bindgen]
pub fn voice_next_active(host:JsValue,generation:JsValue)->Result<bool,JsValue>{let state=get(&host,"state")?;Ok(get(&host,"generation")?==generation&&(state==JsValue::from_str("playing")||state==JsValue::from_str("loading")))}
#[wasm_bindgen]
pub fn voice_prepare_next(host:JsValue,generation:JsValue,make_active:Function)->Result<Promise,JsValue>{
 if !get(&get(&host,"reader")?,"getNextSpeechSource")?.is_function(){return Ok(Promise::resolve(&JsValue::UNDEFINED));}
 let request=object(&[("generation",generation.clone())])?;set(&host,"preparingPage",&request)?;
 let args=object(&[("isActive",make_active.call2(&JsValue::UNDEFINED,&host,&generation)?)])?;
 // A source can throw synchronously before returning its promise. Retry such
 // AbortErrors in the same turn, as the original async method does.
 let first=(||{for retry in 0..=2{
  match one(&get(&host,"reader")?,"getNextSpeechSource",&args){
   Ok(value)=>return Ok(Some((retry,value))),
   Err(error)=>{if !voice_next_active(host.clone(),generation.clone())?{return Ok(None);}
    if get(&error,"name")?!=JsValue::from_str("AbortError")||retry==2{return Err(error);}}
  }
 }Ok(None)})();
 let (start,first)=match first{Ok(Some(value))=>value,result=>{
  if get(&host,"preparingPage")?==JsValue::from(request){set(&host,"preparingPage",&JsValue::NULL)?;}
  return match result{Ok(None)=>Ok(Promise::resolve(&JsValue::UNDEFINED)),Err(error)=>Err(error),_=>unreachable!()};
 }};
 Ok(future_to_promise(async move{
  let mut source=JsValue::UNDEFINED;let mut pending=Some(Ok(first));
  let result=async{
   for retry in start..=2{
    let result=async{
     source=wait(pending.take().unwrap_or_else(||one(&get(&host,"reader")?,"getNextSpeechSource",&args))).await?;
     if !voice_next_active(host.clone(),generation.clone())?{clear(&source)?;return Ok(Some(JsValue::UNDEFINED));}
     if absent(&source){return Ok(Some(source.clone()));}
     let plan=wait(one(&host,"prepare",&source)).await?;
     if !voice_next_active(host.clone(),generation.clone())?{clear(&source)?;return Ok(Some(JsValue::UNDEFINED));}
     if one(&host,"pagePlanValid",&plan)?.is_truthy(){return Ok(Some(plan));}
     clear(&source)?;source=JsValue::NULL;
     if retry==2{return Err(js_sys::Error::new("La página preparada sigue cambiando.").into());}Ok(None)
    }.await;
    match result{Ok(Some(value))=>return Ok(value),Ok(None)=>(),Err(error)=>{
     clear(&source)?;source=JsValue::NULL;if !voice_next_active(host.clone(),generation.clone())?{return Ok(JsValue::UNDEFINED);}
     if get(&error,"name")?!=JsValue::from_str("AbortError")||retry==2{return Err(error);}
    }}
   }Ok(JsValue::UNDEFINED)
  }.await;
  let result=match result{Ok(v)=>Ok(v),Err(e)=>{match clear(&source){Ok(())=>Err(e),Err(e)=>Err(e)}}};
  if get(&host,"preparingPage")?==JsValue::from(request){set(&host,"preparingPage",&JsValue::NULL)?;}result
 }))
}
#[wasm_bindgen]
pub fn voice_refresh_breaks(host:JsValue,engine:Function)->Result<Promise,JsValue>{
 let source=get(&host,"source")?;let generation=get(&host,"generation")?;let index=get(&host,"index")?;
 if get(&host,"state")?!=JsValue::from_str("playing")||!optional(&source,"measurePageBreaks")?.is_function(){return Ok(Promise::resolve(&JsValue::FALSE));}
 let pending=call(&source,"measurePageBreaks");
 Ok(future_to_promise(async move{
  let breaks=match wait(pending).await{Ok(v)=>v,Err(_)=>return Ok(JsValue::FALSE)};
  let valid=||->Result<bool,JsValue>{Ok(get(&host,"state")?==JsValue::from_str("playing")&&get(&host,"generation")?==generation&&get(&host,"source")?==source&&get(&host,"index")?==index)};
  if !Array::is_array(&breaks)||!valid()?{return Ok(JsValue::FALSE);}
  let current=Reflect::get(&get(&host,"items")?,&index)?;if !current.is_truthy(){return Ok(JsValue::FALSE);}
  let known=get(&source,"pageBreaks")?;let known=if known.is_truthy(){known}else{Array::new().into()};
  let equal=if get(&known,"length")?==get(&breaks,"length")?{let mut equal=true;let known:Array=known.unchecked_into();for i in 0..known.length(){if Reflect::has(&known,&i.into())?&&known.get(i)!=Reflect::get_u32(&breaks,i)?{equal=false;break;}}equal}else{false};
  if equal{return Ok(JsValue::FALSE);}
  set(&source,"pageBreaks",&breaks)?;let args=spread(&source)?;set(&args,"start",&get(&current,"end")?)?;
  let plan=wait(one(&host,"prepare",&args)).await?;let rest:Array=get(&plan,"items")?.unchecked_into();let mapped=Array::new_with_length(rest.length());
  for i in 0..rest.length(){if Reflect::has(&rest,&i.into())?{let item=rest.get(i);let sentence=get(&current,"sentence")?;
   if number(&get(&item,"start")?)?<number(&get(&sentence,"end")?)?&&number(&get(&get(&item,"sentence")?,"start")?)?>=number(&get(&sentence,"start")?)?{let copy=spread(&item)?;set(&copy,"sentence",&sentence)?;mapped.set(i,copy.into());}else{mapped.set(i,item);}
  }}
  if !valid()?{return Ok(JsValue::FALSE);}
  let kept=two(&get(&host,"items")?,"slice",&0.into(),&(number(&index)?+1.0).into())?;
  let items=Array::new();for list in [kept,JsValue::from(mapped)]{for value in js_sys::try_iter(&list)?.ok_or_else(||JsValue::from(js_sys::TypeError::new("Speech items are not iterable")))?{items.push(&value?);}}
  set(&host,"items",&items)?;let chunks=Array::new();for item in items.iter(){chunks.push(&get(&item,"text")?);}set(&host,"chunks",&chunks)?;
  let voice=get(&one(&host,"voiceFor",&Reflect::get(&chunks,&index)?)?,"voice")?;
  if voice.is_truthy(){let upcoming=one(&host,"upcomingFor",&voice)?;let args=object(&[("id",get(&host,"utteranceId")?),("voiceId",get(&voice,"id")?),("rate",get(&host,"rate")?),("upcoming",get(&upcoming,"upcoming")?),("deferAfter",get(&upcoming,"deferAfter")?)])?;maybe(&engine.call0(&JsValue::UNDEFINED)?,"extendUpcoming",&Array::of1(&args))?;}
  Ok(JsValue::TRUE)
 }))
}
