//! The cover analyser's orchestration (formerly the body of src/js/cover-appearance.js): image decode with
//! its 3000/1200/1500 ms bounds, the 192 x 288 sample, the binding colour, the candidate fonts, the
//! single-flight title-font search (one cover at a time, six families, masks rastered in 2 ms slices, a
//! family's masks scored by the Worker or, when it fails, by the main-thread scorer) and the final record.
//!
//! Every `async` function of the original is one promise here and every `await` one
//! `Promise.resolve(value).then(...)`, in the same order, so a caller sees its answers on the same
//! microtask as before (tests/unit/cover-appearance-orchestration-differential.test.js runs both against
//! a frozen copy). The numeric kernels stay where they were: the host hands over the core's bridges, the
//! slice driver and the Worker client, and keeps the two values the module owned (`turn`, `fonts`).
use std::cell::{Cell,RefCell};
use std::rc::Rc;
use wasm_bindgen::{prelude::*,JsCast};
use js_sys::{Array,Function,JsString,Object,Promise};
use crate::host::{absent,call,clear_timeout,clock,construct,get,get_at,global,jmax,jmin,js_round,method,num,number_string,read,set,set_timeout,text_value,truthy};
type R<T=()>=Result<T,JsValue>;

/// family, weight, fallback: the order is the tie-break of the search.
const FONTS:[(&str,f64,&str);6]=[
 ("Playfair Display",700.0,"Georgia, serif"),("Lora",700.0,"Georgia, serif"),("Cormorant Garamond",700.0,"Georgia, serif"),
 ("DM Sans",600.0,"Arial, sans-serif"),("Montserrat",700.0,"Arial, sans-serif"),("Oswald",600.0,"Arial Narrow, sans-serif")];
// The search is a few hundred million operations: masks are rastered in slices short enough that
// scrolling and the animation loop keep their frames.
const SLICE_MS:f64=2.0;
const SLOW:&str="La portada tardó demasiado";

fn error(message:&str)->JsValue{js_sys::Error::new(message).into()}
fn undefined()->JsValue{JsValue::UNDEFINED}
fn number(value:f64)->JsValue{JsValue::from_f64(value)}
fn document()->JsValue{get(&global(),"document")}
fn object(fields:&[(&str,&JsValue)])->R<JsValue>{let value:JsValue=Object::new().into();for (key,field) in fields{set(&value,key,field)?;}Ok(value)}

/// The promise of one `async` function and its two settlers.
struct Deferred{promise:Promise,resolve:Function,reject:Function}
impl Deferred{
 fn new()->Rc<Deferred>{
  let mut settlers=None;
  let promise=Promise::new(&mut|resolve,reject|{settlers=Some((resolve,reject));});
  let (resolve,reject)=settlers.expect("Promise executors run synchronously");
  Rc::new(Deferred{promise,resolve,reject})
 }
 fn resolve(&self,value:&JsValue){let _=self.resolve.call1(&JsValue::UNDEFINED,value);}
 fn reject(&self,reason:&JsValue){let _=self.reject.call1(&JsValue::UNDEFINED,reason);}
 fn settle(&self,result:R<JsValue>){match result{Ok(value)=>self.resolve(&value),Err(reason)=>self.reject(&reason)}}
}

/// A callback JavaScript owns: it runs once at most and gives up what it captured when it runs; one that is
/// never called (a cleared timer, the other reaction of a pair) is collected with the function itself.
/// `Closure::once_into_js` would keep such a callback, and a handle to it, for the life of the page.
fn js_owned<T:?Sized+wasm_bindgen::closure::WasmClosure>(closure:Closure<T>)->JsValue{closure.into_js_value()}
/// `promise.then(value => next(Ok(value)), reason => next(Err(reason)))`. The reaction that runs takes the
/// continuation and everything it holds; its twin keeps nothing and goes with the promise, as does the pair
/// of a promise that never settles. The derived promise always fulfils, so nothing is left unhandled.
fn settled(promise:&Promise,next:impl FnOnce(R<JsValue>)+'static){react(promise,Box::new(next))}
fn react(promise:&Promise,next:Box<dyn FnOnce(R<JsValue>)>){
 let next=Rc::new(RefCell::new(Some(next)));
 let reaction=|fulfilled:bool|{
  let next=next.clone();
  js_owned(Closure::<dyn FnMut(JsValue)>::once(move|value:JsValue|{
   let work=next.borrow_mut().take();
   if let Some(work)=work{work(if fulfilled{Ok(value)}else{Err(value)});}
  }))
 };
 let _=method(promise,"then",&[&reaction(true),&reaction(false)]);
}
/// One `await value`.
fn wait(value:&JsValue,next:impl FnOnce(R<JsValue>)+'static){settled(&Promise::resolve(value),next)}

/// What cover-appearance.js hands over: the core's bridges, the slice driver, the Worker client, and the
/// two values the module keeps between analyses (`turn`, the search queue; `fonts`, the font loads).
#[derive(Clone)]
struct Host(JsValue);
impl Host{
 fn run(&self,name:&str,args:&[&JsValue])->R<JsValue>{call(&get(&self.0,name),name,args)}
 /// `loadedRustCore()`.
 fn core(&self)->R<JsValue>{self.run("core",&[])}
 /// `shelfWorkReady()`.
 fn ready(&self)->R<JsValue>{self.run("ready",&[])}
}

/// `coverAspectRatio(width, height)`.
fn aspect_ratio(width:&JsValue,height:&JsValue)->JsValue{
 let ratio=num(width)/num(height);
 if !ratio.is_finite()||ratio<=0.0{return JsValue::NULL}
 number(jmin(2.5,jmax(0.25,ratio)))
}
/// `String(value).trim().length`.
fn trimmed_length(value:&JsValue)->u32{text_value(value).unchecked_into::<JsString>().trim().length()}
fn font(index:usize,size:&str)->String{let (family,weight,_)=FONTS[index];format!("{weight} {size}px \"{family}\"")}
/// `new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; })`.
fn loaded(image:&JsValue)->Promise{
 Promise::new(&mut|resolve,reject|{
  // A setter that throws rejects the promise, as it did inside the executor.
  if let Err(failure)=set(image,"onload",&resolve).and_then(|_|set(image,"onerror",&reject)){let _=reject.call1(&JsValue::UNDEFINED,&failure);}
 })
}
/// `setTimeout(() => reject(new Error(SLOW)), delay)` for a wait that `settle` may end first. Whichever comes
/// first takes the settlers, so neither a cleared timer nor a decode that never ends keeps them.
/// A browser's timer id is a number and is kept as one, so a decode that never ends holds no handle at all.
struct Timeout{id:Result<f64,JsValue>,settlers:Rc<RefCell<Option<(Function,Function)>>>}
impl Timeout{
 fn start(resolve:&Function,reject:&Function,delay:f64)->R<Timeout>{
  let settlers=Rc::new(RefCell::new(Some((resolve.clone(),reject.clone()))));
  let fired=settlers.clone();
  let id=set_timeout(&js_owned(Closure::<dyn FnMut()>::once(move||{
   let waiting=fired.borrow_mut().take();
   if let Some((_,reject))=waiting{let _=reject.call1(&JsValue::UNDEFINED,&error(SLOW));}
  })),delay)?;
  Ok(Timeout{id:id.as_f64().ok_or(id),settlers})
 }
 /// `clearTimeout(timer)`, then the wait's outcome if the timer has not already rejected it.
 fn settle(&self,outcome:R<JsValue>)->R{
  let waiting=self.settlers.borrow_mut().take();
  self.stop()?;
  if let Some((resolve,reject))=waiting{let _=match outcome{Ok(value)=>resolve.call1(&JsValue::UNDEFINED,&value),Err(reason)=>reject.call1(&JsValue::UNDEFINED,&reason)};}
  Ok(())
 }
 fn clear(&self)->R{self.settlers.borrow_mut().take();self.stop()}
 fn stop(&self)->R{match &self.id{Ok(number)=>clear_timeout(&JsValue::from_f64(*number)),Err(id)=>clear_timeout(id)}}
}

/// `readCoverAspectRatio(url)`: only the decoded dimensions, 1.5 s at most.
#[wasm_bindgen]
pub fn cover_aspect_read(url:JsValue)->Promise{
 let done=Deferred::new();
 let promise=done.promise.clone();
 let started=(||->R<Option<JsValue>>{
  if !truthy(&url)||get(&global(),"Image").is_undefined(){return Ok(None)}
  let image=construct("Image",&[])?;
  set(&image,"decoding",&"async".into())?;
  set(&image,"src",&url)?;
  Ok(Some(image))
 })();
 let image=match started{Ok(Some(image))=>image,Ok(None)=>{done.resolve(&JsValue::NULL);return promise}Err(failure)=>{done.reject(&failure);return promise}};
 let timeout:Rc<RefCell<Option<Timeout>>>=Rc::new(RefCell::new(None));
 let raced=(||->R<JsValue>{
  let first:JsValue=if get(&image,"decode").is_function(){method(&image,"decode",&[])?}else{loaded(&image).into()};
  let timer=timeout.clone();
  let second=Promise::new(&mut|resolve,reject|match Timeout::start(&resolve,&reject,1500.0){
   Ok(started)=>*timer.borrow_mut()=Some(started),
   Err(failure)=>{let _=reject.call1(&JsValue::UNDEFINED,&failure);}
  });
  method(&get(&global(),"Promise"),"race",&[&Array::of2(&first,&second)])
 })();
 // `finally { clearTimeout(timeout) }` runs before the answer leaves, whatever it is.
 let finish=move|outcome:R<JsValue>|{
  let value=match outcome{Ok(_)=>aspect_ratio(&get(&image,"naturalWidth"),&get(&image,"naturalHeight")),Err(_)=>JsValue::NULL};
  let cleared=match timeout.borrow_mut().take(){Some(timeout)=>timeout.clear(),None=>clear_timeout(&JsValue::UNDEFINED)};
  match cleared{Ok(())=>done.resolve(&value),Err(failure)=>done.reject(&failure)}
 };
 match raced{Ok(race)=>wait(&race,finish),Err(failure)=>finish(Err(failure))}
 promise
}

/// One analysis between its awaits.
struct Analysis{host:Host,done:Rc<Deferred>,title:JsValue,match_font:bool,image:JsValue,core_ready:JsValue,
 aspect:RefCell<JsValue>,pixels:RefCell<JsValue>,width:Cell<f64>,height:Cell<f64>,core:RefCell<JsValue>,color:RefCell<JsValue>,prepared:RefCell<JsValue>}

/// `analyzeCoverAppearance(url, title, options)`: `null` for a missing or unsafe image, the aspect ratio
/// alone when the pixels cannot be read, otherwise the binding colour and, with `matchFont`, the lettering.
#[wasm_bindgen]
pub fn cover_appearance_analyze(host:JsValue,url:JsValue,title:JsValue,options:JsValue)->Promise{
 let done=Deferred::new();
 let promise=done.promise.clone();
 // Up to the first `try` a failure rejects, as in the original.
 let started=(||->R<Option<(Rc<Analysis>,bool)>>{
  // `{ matchFont = true, image } = {}`
  let (match_font,decoded)=if options.is_undefined(){(true,undefined())}else{
   let chosen=read(&options,"matchFont")?;
   (chosen.is_undefined()||truthy(&chosen),read(&options,"image")?)
  };
  if !truthy(&url)||get(&global(),"Image").is_undefined()||get(&global(),"document").is_undefined(){return Ok(None)}
  let host=Host(host);
  let core_ready=host.run("requireCore",&[])?;
  // Start compilation alongside decode; observe failures even if decoding fails.
  method(&core_ready,"catch",&[&get(&host.0,"noop")])?;
  let given=truthy(&decoded);
  let image=if given{decoded}else{construct("Image",&[])?};
  set(&image,"decoding",&"async".into())?;
  if !given{set(&image,"src",&url)?;}
  Ok(Some((Rc::new(Analysis{host,done:done.clone(),title,match_font,image,core_ready,aspect:RefCell::new(undefined()),pixels:RefCell::new(undefined()),
   width:Cell::new(0.0),height:Cell::new(0.0),core:RefCell::new(undefined()),color:RefCell::new(undefined()),prepared:RefCell::new(undefined())}),given)))
 })();
 match started{
  Ok(Some((analysis,given)))=>analysis.attempt(|analysis|analysis.decode(given)),
  Ok(None)=>done.resolve(&JsValue::NULL),
  Err(failure)=>done.reject(&failure),
 }
 promise
}

impl Analysis{
 /// The body's `try { ... } catch { return null }`: canvas may be unavailable in a WebView.
 fn attempt(self:&Rc<Self>,step:impl FnOnce(&Rc<Self>)->R){if step(self).is_err(){self.done.resolve(&JsValue::NULL);}}
 /// `await value`, then `step` inside the same `try`.
 fn then(self:&Rc<Self>,value:&JsValue,step:impl FnOnce(&Rc<Self>,JsValue)->R+'static){
  let analysis=self.clone();
  wait(value,move|outcome|analysis.attempt(|analysis|step(analysis,outcome?)));
 }
 fn decode(self:&Rc<Self>,given:bool)->R{
  if given{return self.sample()}
  let image=self.image.clone();
  let decoding:Promise=if get(&image,"decode").is_function(){
   let delay=if self.match_font{3000.0}else{1200.0};
   Promise::new(&mut|resolve,reject|{
    let begun=(||->R{
     let timer=Timeout::start(&resolve,&reject,delay)?;
     let source=image.clone();
     let decode=js_owned(Closure::<dyn FnMut(JsValue)->R<JsValue>>::once(move|_:JsValue|method(&source,"decode",&[])));
     let decoded:Promise=method(&Promise::resolve(&JsValue::UNDEFINED),"then",&[&decode])?.unchecked_into();
     // A timer that cannot be cleared leaves the wait as it is, as the reaction's own failure did.
     settled(&decoded,move|outcome|{let _=timer.settle(outcome);});
     Ok(())
    })();
    if let Err(failure)=begun{let _=reject.call1(&JsValue::UNDEFINED,&failure);}
   })
  }else{loaded(&image)};
  self.then(&decoding,|analysis,_|analysis.sample());
  Ok(())
 }
 /// The decoded image drawn at 192 x 288 at most and read back.
 fn sample(self:&Rc<Self>)->R{
  let (natural_width,natural_height)=(get(&self.image,"naturalWidth"),get(&self.image,"naturalHeight"));
  if !truthy(&natural_width)||!truthy(&natural_height){self.done.resolve(&JsValue::NULL);return Ok(())}
  let aspect=aspect_ratio(&natural_width,&natural_height);
  *self.aspect.borrow_mut()=aspect.clone();
  let (natural_width,natural_height)=(num(&natural_width),num(&natural_height));
  let scale=jmin(jmin(1.0,192.0/natural_width),288.0/natural_height);
  let (width,height)=(jmax(1.0,js_round(natural_width*scale)),jmax(1.0,js_round(natural_height*scale)));
  self.width.set(width);self.height.set(height);
  let canvas=method(&document(),"createElement",&[&"canvas".into()])?;
  set(&canvas,"width",&number(width))?;set(&canvas,"height",&number(height))?;
  let context=method(&canvas,"getContext",&[&"2d".into(),&object(&[("willReadFrequently",&JsValue::TRUE)])?])?;
  let dimensions=||object(&[("aspectRatio",&aspect),("source",&"cover".into())]);
  if !truthy(&context){self.done.resolve(&dimensions()?);return Ok(())}
  method(&context,"drawImage",&[&self.image,&number(0.0),&number(0.0),&number(width),&number(height)])?;
  // Cross-origin images can still supply their decoded dimensions even when browser security
  // prevents sampling their pixels.
  let pixels=match method(&context,"getImageData",&[&number(0.0),&number(0.0),&number(width),&number(height)]).and_then(|image|read(&image,"data")){
   Ok(pixels)=>pixels,
   Err(_)=>{self.done.resolve(&dimensions()?);return Ok(())}
  };
  *self.pixels.borrow_mut()=pixels;
  self.then(&self.core_ready,|analysis,core|{
   *analysis.core.borrow_mut()=core;
   analysis.then(&analysis.host.ready()?,|analysis,_|analysis.colour());
   Ok(())
  });
  Ok(())
 }
 /// `{ ...color, ...fields }`.
 fn record(&self,fields:&[(&str,&JsValue)])->R<JsValue>{
  let value:JsValue=Object::new().into();
  method(&get(&global(),"Object"),"assign",&[&value,&self.color.borrow()])?;
  for (key,field) in fields{set(&value,key,field)?;}
  Ok(value)
 }
 fn colour(self:&Rc<Self>)->R{
  let (pixels,width,height)=(self.pixels.borrow().clone(),self.width.get(),self.height.get());
  // `coverColorFromPixels(pixels, width, height)`
  let color=if !truthy(&pixels)||!width.is_finite()||!height.is_finite()||width<1.0||height<1.0{JsValue::NULL}else{
   let style=self.host.run("color",&[&self.host.core()?,&pixels,&number(width),&number(height)])?;
   if !truthy(&style){return Err(error("Invalid cover pixels"))}
   style
  };
  *self.color.borrow_mut()=color;
  if !self.match_font{
   self.done.resolve(&self.record(&[("aspectRatio",&self.aspect.borrow()),("source",&"cover".into())])?);
   return Ok(())
  }
  // Font loading is already required. Let the numeric module finish loading during that wait.
  self.then(&candidate_fonts(&self.host,&self.title)?,|analysis,_|analysis.search());
  Ok(())
 }
 fn search(self:&Rc<Self>)->R{
  let (width,height,title)=(self.width.get(),self.height.get(),self.title.clone());
  let include_edges=truthy(&title)&&trimmed_length(&title)>=3&&width>=48.0&&(height*0.82).floor()>=48.0;
  let prepared=self.host.run("prepare",&[&self.core.borrow(),&self.pixels.borrow(),&number(width),&number(height),&JsValue::from_bool(include_edges)])?;
  if !truthy(&prepared){return Err(error("Invalid cover preparation"))}
  let (gray,near)=(read(&prepared,"gray")?,read(&prepared,"near")?);
  *self.prepared.borrow_mut()=prepared;
  // One cover at a time, so a whole shelf of new books does not pile up long tasks.
  let host=self.host.clone();
  let search=js_owned(Closure::<dyn FnMut(JsValue)->JsValue>::once(move|_:JsValue|match_title_font(host,gray,width,height,title,near).into()));
  let turn=method(&read(&self.host.0,"turn")?,"then",&[&search])?;
  set(&self.host.0,"turn",&method(&turn,"catch",&[&get(&self.host.0,"noop")])?)?;
  self.then(&turn,|analysis,found|{
   let index=match found.as_f64(){Some(index) if index>=0.0&&index<6.0&&index.fract()==0.0=>index as usize,
    _=>if truthy(&read(&analysis.prepared.borrow(),"busy")?){3}else{0}};
   let (family,weight,fallback)=FONTS[index];
   let family=JsValue::from_str(family);
   analysis.done.resolve(&analysis.record(&[("fontFamily",&family),("fontCanvasFamily",&family),("fontFallback",&fallback.into()),
    ("fontWeight",&number(weight)),("aspectRatio",&analysis.aspect.borrow()),("source",&"cover".into())])?);
   Ok(())
  });
  Ok(())
 }
}

/// `loadCandidateFonts(text)`: the six faces once per page, plus the unicode subsets the lettering needs.
fn candidate_fonts(host:&Host,text:&JsValue)->R<JsValue>{
 let fonts=||read(&document(),"fonts");
 let load=|arguments:&[&JsValue]|method(&fonts()?,"load",arguments);
 let available=fonts()?;
 if absent(&available)||!truthy(&read(&available,"load")?){return Ok(Promise::resolve(&JsValue::UNDEFINED).into())}
 let all_settled=|loads:&Array|method(&get(&global(),"Promise"),"allSettled",&[loads]);
 if !truthy(&get(&host.0,"fonts")){
  let loads=Array::new();
  for index in 0..FONTS.len(){loads.push(&load(&[&font(index,"20").into()])?);}
  set(&host.0,"fonts",&all_settled(&loads)?)?;
 }
 let task=get(&host.0,"fonts");
 // The default Latin face already covers ASCII/Latin-1.
 if !truthy(text)||!text_value(text).unchecked_into::<JsString>().iter().any(|unit|unit>0xff){return Ok(task)}
 let loads=Array::of1(&task);
 for index in 0..FONTS.len(){loads.push(&load(&[&font(index,"20").into(),&text_value(text)])?);}
 all_settled(&loads)
}

/// One title search between its awaits: the cover's planes, the plans, the Worker job and the main-thread scorer.
struct Search{host:Host,done:Rc<Deferred>,gray:JsValue,near:JsValue,width:f64,height:f64,title:JsValue,
 rows:RefCell<JsValue>,plans:RefCell<Vec<[f64;8]>>,worker:RefCell<JsValue>,local:RefCell<JsValue>,scores:Array}

/// `matchTitleFont(...)`: the index of the best family, or `null` when nothing can be matched.
fn match_title_font(host:Host,gray:JsValue,width:f64,height:f64,title:JsValue,near:JsValue)->Promise{
 let done=Deferred::new();
 let promise=done.promise.clone();
 let search=Rc::new(Search{host,done,gray,near,width,height,title,rows:RefCell::new(undefined()),plans:RefCell::new(Vec::new()),
  worker:RefCell::new(JsValue::NULL),local:RefCell::new(JsValue::NULL),scores:Array::new()});
 match search.host.ready(){
  Ok(ready)=>{let search=search.clone();wait(&ready,move|outcome|if let Err(failure)=outcome.and_then(|_|search.open()){search.done.reject(&failure);})}
  Err(failure)=>search.done.reject(&failure),
 }
 promise
}
impl Search{
 fn context(&self)->R<JsValue>{object(&[("gray",&self.gray),("near",&self.near),("width",&number(self.width)),("height",&number(self.height)),("rows",&self.rows.borrow())])}
 fn open(self:&Rc<Self>)->R{
  let title=&self.title;
  if !truthy(title)||trimmed_length(title)<3||get(&global(),"document").is_undefined(){self.done.resolve(&JsValue::NULL);return Ok(())}
  let core=self.host.core()?;
  let plans=self.host.run("plan",&[&core,title,&number(self.width)])?;
  *self.plans.borrow_mut()=Array::from(&plans).iter().map(|plan|{let mut values=[0.0;8];for (index,value) in values.iter_mut().enumerate(){*value=num(&get_at(&plan,index as u32));}values}).collect();
  let work=method(&document(),"createElement",&[&"canvas".into()])?;
  set(&work,"width",&number(self.width))?;set(&work,"height",&number((self.height*0.82).floor()))?;
  let context=method(&work,"getContext",&[&"2d".into()])?;
  let rows=read(&work,"height")?;
  if !truthy(&context)||self.width<48.0||num(&rows)<48.0{self.done.resolve(&JsValue::NULL);return Ok(())}
  *self.rows.borrow_mut()=rows;
  let search=self.clone();
  wait(&self.host.run("open",&[&self.context()?])?,move|outcome|match outcome{
   Ok(job)=>{*search.worker.borrow_mut()=job;search.family(0)}
   Err(failure)=>search.done.reject(&failure),
  });
  Ok(())
 }
 /// `finally { workerJob?.close(); localScorer?.dispose(); }`, then the answer.
 fn close(&self,outcome:R<JsValue>){
  let closed=(||->R{
   let worker=self.worker.borrow().clone();
   if !absent(&worker){method(&worker,"close",&[])?;}
   let local=self.local.borrow().clone();
   if !absent(&local){method(&local,"dispose",&[])?;}
   Ok(())
  })();
  self.done.settle(closed.and(outcome).and_then(|_|{
   let best=num(&self.host.run("select",&[&self.host.core()?,&self.scores])?);
   Ok(if best<0.0{JsValue::NULL}else{number(best)})
  }));
 }
 fn family(self:&Rc<Self>,index:usize){
  if index==FONTS.len(){return self.close(Ok(undefined()))}
  let ready=match self.host.ready(){Ok(ready)=>ready,Err(failure)=>return self.close(Err(failure))};
  let search=self.clone();
  wait(&ready,move|outcome|match outcome{
   Ok(_)=>{
    let scored=Family::run(&search,index);
    wait(&scored,move|outcome|match outcome{
     Ok(score)=>{search.scores.push(&score);search.family(index+1)}
     Err(failure)=>search.close(Err(failure)),
    })
   }
   Err(failure)=>search.close(Err(failure)),
  });
 }
 /// `scoreMasks(masks)`: the Worker's batch, or after its first failure the main-thread scorer on the same masks.
 fn score_masks(self:&Rc<Self>,masks:Array)->Promise{
  let done=Deferred::new();
  let promise=done.promise.clone();
  let worker=self.worker.borrow().clone();
  if truthy(&worker){
   match method(&worker,"scoreMany",&[&masks]){
    Ok(scores)=>{
     let search=self.clone();
     wait(&scores,move|outcome|match outcome{Ok(scores)=>done.resolve(&scores),Err(_)=>search.score_locally(masks,done,true)});
    }
    Err(_)=>self.score_locally(masks,done,true),
   }
  }else{self.score_locally(masks,done,false)}
  promise
 }
 fn score_locally(self:&Rc<Self>,masks:Array,done:Rc<Deferred>,failed:bool){
  let prepared=(||->R{
   if failed{
    let worker=self.worker.borrow().clone();
    method(&worker,"close",&[])?;
    *self.worker.borrow_mut()=JsValue::NULL;
   }
   // Keep the original masks intact for a failed/unavailable Worker.
   if absent(&self.local.borrow()){
    let scorer=self.host.run("scorer",&[&self.host.core()?,&self.context()?])?;
    *self.local.borrow_mut()=scorer;
   }
   Ok(())
  })();
  match prepared{Ok(())=>self.score_next(masks,Array::new(),0,done),Err(failure)=>done.reject(&failure)}
 }
 fn score_next(self:&Rc<Self>,masks:Array,scores:Array,index:u32,done:Rc<Deferred>){
  if index>=masks.length(){return done.resolve(&scores)}
  let ready=match self.host.ready(){Ok(ready)=>ready,Err(failure)=>return done.reject(&failure)};
  let search=self.clone();
  wait(&ready,move|outcome|{
   let sliced=outcome.and_then(|_|{
    let steps=method(&search.local.borrow(),"steps",&[&masks.get(index)])?;
    search.host.run("slices",&[&steps])
   });
   match sliced{
    Ok(sliced)=>wait(&sliced,move|outcome|match outcome{
     Ok(score)=>{scores.push(&score);search.score_next(masks,scores,index+1,done)}
     Err(failure)=>done.reject(&failure),
    }),
    Err(failure)=>done.reject(&failure),
   }
  });
 }
}

/// Where the family's raster generator stands: before the mask of plan `at`, or just after handing one over.
enum Step{Bare,Mask(JsValue),Done}
/// One family's rasters (`scoreFamily` driven by `runRemoteFamily`). The family owns one CPU-backed
/// raster surface; masks are copied before they are handed over, so later plans reuse it.
struct Family{search:Rc<Search>,done:Rc<Deferred>,index:usize,title:JsValue,masks:Array,wraps:RefCell<JsValue>,canvas:RefCell<JsValue>,context:RefCell<JsValue>,
 at:Cell<usize>,step:RefCell<Step>,slice_start:Cell<f64>,finished:Cell<bool>}
impl Family{
 fn run(search:&Rc<Search>,index:usize)->Promise{
  let done=Deferred::new();
  let promise=done.promise.clone();
  let family=Rc::new(Family{search:search.clone(),done,index,title:text_value(&search.title),masks:Array::new(),wraps:RefCell::new(JsValue::NULL),
   canvas:RefCell::new(JsValue::NULL),context:RefCell::new(JsValue::NULL),at:Cell::new(0),step:RefCell::new(Step::Done),slice_start:Cell::new(0.0),finished:Cell::new(true)});
  // The generator starts outside the driver's `try`: a wrap cache that cannot be made has nothing to release.
  let started=(||->R{
   family.slice_start.set(clock()?);
   let host=&search.host;
   *family.wraps.borrow_mut()=host.run("wraps",&[&host.core()?])?;
   family.finished.set(false);
   Ok(())
  })();
  if let Err(failure)=started{family.done.reject(&failure);return promise}
  let first=family.arrive();
  family.advance(first.map(|step|{*family.step.borrow_mut()=step;}),false);
  promise
 }
 /// The generator's `finally`: the wrap cache and the raster surface are released once.
 fn release(&self)->R{
  if self.finished.replace(true){return Ok(())}
  method(&self.wraps.borrow(),"dispose",&[])?;
  let canvas=self.canvas.borrow().clone();
  if truthy(&canvas){set(&canvas,"width",&number(0.0))?;set(&canvas,"height",&number(0.0))?;}
  *self.canvas.borrow_mut()=JsValue::NULL;*self.context.borrow_mut()=JsValue::NULL;
  Ok(())
 }
 /// The top of the plan loop: the bare yield before plan `at`, or the end of the generator.
 fn arrive(&self)->R<Step>{
  if self.at.get()<self.search.plans.borrow().len(){return Ok(Step::Bare)}
  self.release()?;
  Ok(Step::Done)
 }
 /// `task.next(0)`.
 fn next(&self)->R<Step>{
  let bare=matches!(*self.step.borrow(),Step::Bare);
  if bare{
   let plan=self.search.plans.borrow()[self.at.get()];
   if let Some(mask)=self.mask(&plan)?{
    let core=self.search.host.core()?;
    if truthy(&method(&core,"font_mask_fits",&[&read(&mask,"width")?,&read(&mask,"height")?,&number(self.search.width),&self.search.rows.borrow()])?){return Ok(Step::Mask(mask))}
   }
  }
  self.at.set(self.at.get()+1);
  self.arrive()
 }
 /// `fontMask(...)`: the title in this family, wrapped by the plan and rastered on the family's surface.
 fn mask(&self,plan:&[f64;8])->R<Option<JsValue>>{
  let [upper,alignment,size,canvas_height,x,line_height,line_width,key]=*plan;
  let width=number(self.search.width);
  if !truthy(&self.canvas.borrow()){let canvas=method(&document(),"createElement",&[&"canvas".into()])?;*self.canvas.borrow_mut()=canvas;}
  let canvas=self.canvas.borrow().clone();
  if read(&canvas,"width")?!=width{set(&canvas,"width",&width)?;}
  if read(&canvas,"height")?!=number(canvas_height){set(&canvas,"height",&number(canvas_height))?;}
  if !truthy(&self.context.borrow()){
   let context=method(&canvas,"getContext",&[&"2d".into(),&object(&[("willReadFrequently",&JsValue::TRUE)])?])?;
   *self.context.borrow_mut()=context;
  }
  let context=self.context.borrow().clone();
  if !truthy(&context){return Ok(None)}
  let zero=number(0.0);
  method(&context,"clearRect",&[&zero,&zero,&read(&canvas,"width")?,&read(&canvas,"height")?])?;
  let (family,weight,fallback)=FONTS[self.index];
  set(&context,"font",&format!("{weight} {}px \"{family}\", {fallback}",number_string(size)).into())?;
  set(&context,"textAlign",&match alignment{a if a==0.0=>"center".into(),a if a==1.0=>"left".into(),a if a==2.0=>"right".into(),_=>undefined()})?;
  set(&context,"textBaseline",&"top".into())?;
  set(&context,"fillStyle",&"#fff".into())?;
  let text=if upper!=0.0&&!upper.is_nan(){method(&self.title,"toLocaleUpperCase",&[])?}else{self.title.clone()};
  let lines=method(&self.wraps.borrow(),"lines",&[&context,&text,&number(line_width),&number(key)])?;
  if !truthy(&read(&lines,"length")?){return Ok(None)}
  for (index,line) in Array::from(&lines).iter().enumerate(){
   method(&context,"fillText",&[&line,&number(x),&number(3.0+index as f64*line_height),&number(line_width)])?;
  }
  let raw=read(&method(&context,"getImageData",&[&zero,&zero,&width,&read(&canvas,"height")?])?,"data")?;
  let host=&self.search.host;
  let mask=host.run("glyph",&[&host.core()?,&raw,&width,&read(&canvas,"height")?,&width])?;
  if mask.is_undefined(){return Err(error("Invalid glyph raster"))}
  Ok(truthy(&mask).then_some(mask))
 }
 /// `runRemoteFamily`'s loop from the step just reached (`resumed`: straight after a slice's yield).
 fn advance(self:&Rc<Self>,reached:R,mut resumed:bool){
  let run=reached.and_then(|_|loop{
   if !resumed{
    let mask=match &*self.step.borrow(){Step::Done=>break Ok(false),Step::Mask(mask)=>Some(mask.clone()),Step::Bare=>None};
    if let Some(mask)=mask{self.masks.push(&mask);}
    if clock()?-self.slice_start.get()>=SLICE_MS{
     // A message event queues behind whatever else is waiting (input, timers).
     let yielded=self.search.host.run("yieldToMain",&[])?;
     let family=self.clone();
     wait(&yielded,move|outcome|match outcome.and_then(|_|family.search.host.ready()){
      Ok(ready)=>{
       let resumed=family.clone();
       wait(&ready,move|outcome|resumed.advance(outcome.and_then(|_|{resumed.slice_start.set(clock()?);Ok(())}),true));
      }
      Err(failure)=>family.fail(failure),
     });
     break Ok(true)
    }
   }
   resumed=false;
   let step=self.next()?;
   *self.step.borrow_mut()=step;
  });
  match run{
   Ok(true)=>{}
   // Scores only select a maximum; they never alter which glyphs are sampled.
   Ok(false)=>{
    match self.search.host.core(){
     Ok(core)=>{
      let family=self.clone();
      wait(&self.search.score_masks(self.masks.clone()),move|outcome|{
       match outcome.and_then(|scores|family.search.host.run("max",&[&core,&scores])){Ok(best)=>family.done.resolve(&best),Err(failure)=>family.fail(failure)}
      });
     }
     Err(failure)=>self.fail(failure),
    }
   }
   Err(failure)=>self.fail(failure),
  }
 }
 /// A failure anywhere releases the generator (`task.return()`) before it leaves.
 fn fail(&self,failure:JsValue){
  match self.release(){Ok(())=>self.done.reject(&failure),Err(later)=>self.done.reject(&later)}
 }
}
