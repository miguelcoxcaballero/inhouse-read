//! Advance audible text while keeping manual browsing and detached pages separate.
use wasm_bindgen::{prelude::*,JsCast};
use wasm_bindgen_futures::{future_to_promise,JsFuture};
use js_sys::{Array,Function,Object,Promise,JSON};
use crate::reader_actions::{get,set,call,one};
fn absent(v:&JsValue)->bool{v.is_null()||v.is_undefined()}
fn optional(v:&JsValue,key:&str)->Result<JsValue,JsValue>{if absent(v){Ok(JsValue::UNDEFINED)}else{get(v,key)}}
fn clear(v:&JsValue)->Result<(),JsValue>{let method=optional(v,"clear")?;if !absent(&method){method.dyn_into::<Function>().map_err(|_|JsValue::from(js_sys::TypeError::new("Page clear is not callable")))?.call0(v)?;}Ok(())}
async fn wait(v:Result<JsValue,JsValue>)->Result<JsValue,JsValue>{JsFuture::from(Promise::resolve(&v?)).await}
fn location(host:&JsValue)->Result<JsValue,JsValue>{Ok(JSON::stringify(&get(&get(host,"reader")?,"location")?)?.into())}
fn finished(host:&JsValue)->Result<JsValue,JsValue>{call(host,"stop")?;one(host,"notify",&"Final del libro.".into())?;Ok(JsValue::UNDEFINED)}
fn stage(diagnostic:&JsValue,value:&str)->Result<(),JsValue>{set(diagnostic,"stage",&value.into())}
#[wasm_bindgen]
extern "C"{#[wasm_bindgen(catch,js_name=Number)]fn number(v:&JsValue)->Result<f64,JsValue>;}
#[wasm_bindgen]
pub fn voice_advance_active(host:JsValue,generation:JsValue)->Result<bool,JsValue>{Ok(get(&host,"generation")?==generation&&get(&host,"state")?==JsValue::from_str("playing"))}
enum Start{Ahead{ahead:JsValue,request:JsValue,pending:Result<JsValue,JsValue>},Next(Result<JsValue,JsValue>),Turn{previous:JsValue,pending:Result<JsValue,JsValue>}}
fn turn(host:&JsValue,diagnostic:&JsValue,args:&JsValue)->Result<(JsValue,Result<JsValue,JsValue>),JsValue>{let previous=location(host)?;stage(diagnostic,"next-turn")?;Ok((previous,one(&get(host,"reader")?,"next",args)))}
fn finalize(host:&JsValue,generation:&JsValue,diagnostic:&JsValue,result:Result<JsValue,JsValue>)->Result<JsValue,JsValue>{
 let result=match result{Ok(v)=>Ok(v),Err(_)=>{if get(host,"generation")?==*generation{one(host,"fail",&"No se pudo pasar de página.".into()).map(|_|JsValue::UNDEFINED)}else{Ok(JsValue::UNDEFINED)}}};
 if get(host,"diagnosticAdvance")?==*diagnostic{set(host,"diagnosticAdvance",&JsValue::NULL)?;}result
}
#[wasm_bindgen]
pub fn voice_advance(host:JsValue,make_active:Function,sleep:Function)->Result<Promise,JsValue>{
 if get(&host,"state")?!=JsValue::from_str("playing"){return Ok(Promise::resolve(&JsValue::UNDEFINED));}
 let index=number(&get(&host,"index")?)?+1.0;set(&host,"index",&index.into())?;
 if index<number(&get(&get(&host,"chunks")?,"length")?)?{return Ok(Promise::resolve(&call(&host,"speakCurrent")?));}
 let generation=get(&host,"generation")?;let diagnostic=Object::new();set(&diagnostic,"generation",&generation)?;stage(&diagnostic,"prepare-next")?;set(&host,"diagnosticAdvance",&diagnostic)?;
 let begin=(||{
  if get(&get(&host,"reader")?,"getNextSpeechSource")?.is_function(){
   let ahead=get(&host,"aheadPage")?;
   if ahead.is_truthy(){
    set(&host,"aheadPage",&JsValue::NULL)?;let request=Object::new();set(&request,"generation",&generation)?;set(&host,"preparingPage",&request)?;
    let pending=get(&ahead,"promise");
    if let Err(error)=pending{if get(&host,"preparingPage")?==JsValue::from(request){set(&host,"preparingPage",&JsValue::NULL)?;}return Err(error);}
    return Ok((Start::Ahead{ahead,request:request.into(),pending},JsValue::UNDEFINED));
   }
   return Ok((Start::Next(Ok(one(&host,"prepareNext",&generation)?)),JsValue::UNDEFINED));
  }
  let args=Object::new();set(&args,"source",&JsValue::TRUE)?;set(&args,"isActive",&make_active.call2(&JsValue::UNDEFINED,&host,&generation)?)?;
  let(previous,pending)=turn(&host,&diagnostic,&args)?;Ok((Start::Turn{previous,pending:Ok(pending?)},args.into()))
 })();
 let(start,args)=match begin{Ok(v)=>v,Err(error)=>return Ok(Promise::resolve(&finalize(&host,&generation,&diagnostic,Err(error))?))};
 Ok(future_to_promise(async move{
  let result=async{
   let mut first_turn=None;let mut args=args;
   let next=match start{
    Start::Turn{previous,pending}=>{first_turn=Some((previous,pending));None},
    Start::Next(pending)=>Some(wait(pending).await?),
    Start::Ahead{ahead,request,pending}=>{
     let result=async{
      let mut next=wait(pending).await?;let error=get(&ahead,"error")?;
      if error.is_truthy(){if get(&error,"name")?!=JsValue::from_str("AbortError")||!voice_advance_active(host.clone(),generation.clone())?{return Err(error);}next=wait(one(&host,"prepareNext",&generation)).await?;}
      Ok(next)
     }.await;
     if get(&host,"preparingPage")?==request{set(&host,"preparingPage",&JsValue::NULL)?;}
     let mut next=result?;
     if next.is_undefined()&&voice_advance_active(host.clone(),generation.clone())?{next=wait(one(&host,"prepareNext",&generation)).await?;}
     Some(next)
    }
   };
   if let Some(mut next)=next{
    if !voice_advance_active(host.clone(),generation.clone())?{clear(&optional(&next,"source")?)?;return Ok(JsValue::UNDEFINED);}
    if !one(&host,"pagePlanValid",&next)?.is_truthy(){let method=get(&host,"revalidateNext")?.dyn_into::<Function>().map_err(|_|JsValue::from(js_sys::TypeError::new("Page validation is not callable")))?;next=wait(method.call2(&host,&next,&generation)).await?;}
    if !voice_advance_active(host.clone(),generation.clone())?{clear(&optional(&next,"source")?)?;return Ok(JsValue::UNDEFINED);}
    if next.is_null(){return finished(&host);}
    if !next.is_undefined(){one(&host,"adopt",&next)?;if !get(&get(&host,"chunks")?,"length")?.is_truthy(){set(&host,"index",&(-1).into())?;return call(&host,"advance");}return call(&host,"speakCurrent");}
    let options=Object::new();set(&options,"source",&JsValue::TRUE)?;set(&options,"isActive",&make_active.call2(&JsValue::UNDEFINED,&host,&generation)?)?;args=options.into();
   }
   for _ in 0..12{
    let(previous,pending)=if let Some(first)=first_turn.take(){first}else{turn(&host,&diagnostic,&args)?};
    wait(pending).await?;if !voice_advance_active(host.clone(),generation.clone())?{return Ok(JsValue::UNDEFINED);}
    for _ in 0..2{
     if location(&host)?!=previous{break;}
     stage(&diagnostic,"retry-wait")?;wait(sleep.call1(&JsValue::UNDEFINED,&200.into())).await?;
     if !voice_advance_active(host.clone(),generation.clone())?{return Ok(JsValue::UNDEFINED);}
     stage(&diagnostic,"retry-turn")?;wait(one(&get(&host,"reader")?,"next",&args)).await?;
     if !voice_advance_active(host.clone(),generation.clone())?{return Ok(JsValue::UNDEFINED);}
    }
    if location(&host)?==previous{return finished(&host);}
    stage(&diagnostic,"prepare-source")?;let plan=wait(call(&host,"prepare")).await?;
    if !voice_advance_active(host.clone(),generation.clone())?{return Ok(JsValue::UNDEFINED);}
    one(&host,"adopt",&plan)?;if get(&get(&host,"chunks")?,"length")?.is_truthy(){return call(&host,"speakCurrent");}
   }
   one(&host,"fail",&"Página siguiente sin texto legible.".into())?;Ok(JsValue::UNDEFINED)
  }.await;
  finalize(&host,&generation,&diagnostic,result)
 }))
}
