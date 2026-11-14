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
//!
//! Each host member is a typed import, so a call is one crossing with its numbers as numbers; the globals
//! (`Image`, `document`, the timers, `performance`) are looked up by name at every call, as they were.
//! One thing is deliberately not here: the raster of a mask (`fontMask`, about twenty canvas calls, 144 masks
//! a cover) stays one host call, because driving a canvas call by call from here measured slower.
use std::cell::{Cell,RefCell};
use std::rc::Rc;
use wasm_bindgen::{intern,prelude::*,JsCast};
use js_sys::{Array,Function,JsString,Object,Promise};
use crate::host::{absent,global,jmax,jmin,js_round,num,text_value,truthy};
type R<T=()>=Result<T,JsValue>;

#[wasm_bindgen]
extern "C"{
 #[wasm_bindgen(js_name=setTimeout,catch)]fn set_timeout(callback:&JsValue,delay:f64)->R<JsValue>;
 #[wasm_bindgen(js_name=clearTimeout,catch)]fn clear_timeout(id:&JsValue)->R<()>;
 #[wasm_bindgen(js_name=clearTimeout,catch)]fn clear_timeout_number(id:f64)->R<()>;
 #[wasm_bindgen(js_namespace=performance,js_name=now,catch)]fn clock()->R<f64>;
 #[wasm_bindgen(js_namespace=Promise,js_name=allSettled,catch)]fn all_settled(list:&JsValue)->R<JsValue>;
 #[wasm_bindgen(js_namespace=Promise,js_name=race,catch)]fn race(list:&JsValue)->R<JsValue>;
 #[wasm_bindgen(js_namespace=Object,js_name=assign,catch)]fn assign(target:&JsValue,source:&JsValue)->R<JsValue>;

 /// Whatever the page hands over or answers with (the host table, an image, a canvas, a context, a mask, a
 /// promise): only the members the analyser uses. A throwing member comes back as the error it threw.
 type Duck;
 #[wasm_bindgen(constructor,js_class="Image",catch)]fn image()->R<Duck>;
 // The global object.
 #[wasm_bindgen(method,getter,js_name=Image)]fn image_class(this:&Duck)->JsValue;
 #[wasm_bindgen(method,getter)]fn document(this:&Duck)->JsValue;
 // The host table of cover-appearance.js.
 #[wasm_bindgen(method,catch)]fn core(this:&Duck)->R<JsValue>;
 #[wasm_bindgen(method,catch,js_name=requireCore)]fn require_core(this:&Duck)->R<JsValue>;
 #[wasm_bindgen(method,catch)]fn ready(this:&Duck)->R<JsValue>;
 #[wasm_bindgen(method,catch)]fn color(this:&Duck,core:&JsValue,pixels:&JsValue,width:f64,height:f64)->R<JsValue>;
 /// `fontMask(title, before, after, plan, width, rows, wraps, surface)`: the mask, or `null` without one that fits.
 #[wasm_bindgen(method,catch)]fn mask(this:&Duck,title:&JsValue,before:&JsValue,after:&JsValue,plan:&JsValue,width:f64,rows:&JsValue,wraps:&JsValue,surface:&JsValue)->R<JsValue>;
 #[wasm_bindgen(method,getter,catch)]fn canvas(this:&Duck)->R<JsValue>;
 #[wasm_bindgen(method,catch)]fn prepare(this:&Duck,core:&JsValue,pixels:&JsValue,width:f64,height:f64,edges:bool)->R<JsValue>;
 #[wasm_bindgen(method,catch)]fn scorer(this:&Duck,core:&JsValue,context:&JsValue)->R<JsValue>;
 #[wasm_bindgen(method,catch)]fn wraps(this:&Duck,core:&JsValue)->R<JsValue>;
 #[wasm_bindgen(method,catch)]fn plan(this:&Duck,core:&JsValue,title:&JsValue,width:f64)->R<JsValue>;
 #[wasm_bindgen(method,catch)]fn max(this:&Duck,core:&JsValue,scores:&JsValue)->R<JsValue>;
 #[wasm_bindgen(method,catch)]fn select(this:&Duck,core:&JsValue,scores:&JsValue)->R<JsValue>;
 #[wasm_bindgen(method,catch)]fn open(this:&Duck,context:&JsValue)->R<JsValue>;
 #[wasm_bindgen(method,catch)]fn slices(this:&Duck,task:&JsValue)->R<JsValue>;
 #[wasm_bindgen(method,catch,js_name=yieldToMain)]fn yield_to_main(this:&Duck)->R<JsValue>;
 #[wasm_bindgen(method,getter)]fn noop(this:&Duck)->JsValue;
 #[wasm_bindgen(method,getter,catch)]fn turn(this:&Duck)->R<JsValue>;
 #[wasm_bindgen(method,setter,catch,js_name=turn)]fn set_turn(this:&Duck,value:&JsValue)->R<()>;
 #[wasm_bindgen(method,getter,js_name=fonts)]fn font_loads(this:&Duck)->JsValue;
 #[wasm_bindgen(method,setter,catch,js_name=fonts)]fn set_font_loads(this:&Duck,value:&JsValue)->R<()>;
 // Options and promises.
 #[wasm_bindgen(method,getter,catch,js_name=matchFont)]fn match_font(this:&Duck)->R<JsValue>;
 #[wasm_bindgen(method,getter,catch,js_name=image)]fn given_image(this:&Duck)->R<JsValue>;
 #[wasm_bindgen(method)]fn then(this:&Duck,fulfilled:&JsValue,rejected:&JsValue);
 /// `function.bind(context, ticket)`.
 #[wasm_bindgen(method)]fn bind(this:&Duck,context:&JsValue,ticket:u32)->JsValue;
 /// `image.decode.bind(image)`.
 #[wasm_bindgen(method,catch,js_name=bind)]fn bound_to(this:&Duck,context:&JsValue)->R<JsValue>;
 #[wasm_bindgen(method,catch,js_name=then)]fn then_run(this:&Duck,fulfilled:&JsValue)->R<JsValue>;
 #[wasm_bindgen(method,catch,js_name=catch)]fn otherwise(this:&Duck,rejected:&JsValue)->R<JsValue>;
 // An image.
 #[wasm_bindgen(method,setter,catch,js_name=decoding)]fn set_decoding(this:&Duck,value:&str)->R<()>;
 #[wasm_bindgen(method,setter,catch,js_name=src)]fn set_src(this:&Duck,value:&JsValue)->R<()>;
 #[wasm_bindgen(method,setter,catch,js_name=onload)]fn set_onload(this:&Duck,value:&JsValue)->R<()>;
 #[wasm_bindgen(method,setter,catch,js_name=onerror)]fn set_onerror(this:&Duck,value:&JsValue)->R<()>;
 #[wasm_bindgen(method,getter,catch,js_name=decode)]fn decoder(this:&Duck)->R<JsValue>;
 #[wasm_bindgen(method,catch)]fn decode(this:&Duck)->R<JsValue>;
 #[wasm_bindgen(method,getter,catch,js_name=naturalWidth)]fn natural_width(this:&Duck)->R<JsValue>;
 #[wasm_bindgen(method,getter,catch,js_name=naturalHeight)]fn natural_height(this:&Duck)->R<JsValue>;
 // The document, a canvas and its context.
 #[wasm_bindgen(method,catch,js_name=createElement)]fn create_element(this:&Duck,tag:&str)->R<JsValue>;
 #[wasm_bindgen(method,getter,catch,js_name=fonts)]fn font_faces(this:&Duck)->R<JsValue>;
 #[wasm_bindgen(method,getter,catch,js_name=load)]fn loader(this:&Duck)->R<JsValue>;
 #[wasm_bindgen(method,catch)]fn load(this:&Duck,font:&str)->R<JsValue>;
 #[wasm_bindgen(method,catch,js_name=load)]fn load_for(this:&Duck,font:&str,text:&JsValue)->R<JsValue>;
 #[wasm_bindgen(method,getter,catch)]fn height(this:&Duck)->R<JsValue>;
 #[wasm_bindgen(method,setter,catch,js_name=width)]fn set_width(this:&Duck,value:f64)->R<()>;
 #[wasm_bindgen(method,setter,catch,js_name=height)]fn set_height(this:&Duck,value:f64)->R<()>;
 #[wasm_bindgen(method,catch,js_name=getContext)]fn get_context(this:&Duck,kind:&str)->R<JsValue>;
 #[wasm_bindgen(method,catch,js_name=getContext)]fn get_context_with(this:&Duck,kind:&str,options:&JsValue)->R<JsValue>;
 #[wasm_bindgen(method,setter,js_name=willReadFrequently)]fn set_will_read_frequently(this:&Duck,value:bool);
 #[wasm_bindgen(method,catch,js_name=drawImage)]fn draw_image(this:&Duck,image:&JsValue,x:f64,y:f64,width:f64,height:f64)->R<()>;
 #[wasm_bindgen(method,catch,js_name=getImageData)]fn get_image_data(this:&Duck,x:f64,y:f64,width:f64,height:f64)->R<JsValue>;
 #[wasm_bindgen(method,getter,catch)]fn data(this:&Duck)->R<JsValue>;
 // The core's bridges' objects: prepared planes, the wrap cache, the scorers.
 #[wasm_bindgen(method,getter,catch)]fn gray(this:&Duck)->R<JsValue>;
 #[wasm_bindgen(method,getter,catch)]fn near(this:&Duck)->R<JsValue>;
 #[wasm_bindgen(method,getter,catch)]fn busy(this:&Duck)->R<JsValue>;
 #[wasm_bindgen(method,catch)]fn dispose(this:&Duck)->R<JsValue>;
 #[wasm_bindgen(method,catch,js_name=scoreMany)]fn score_many(this:&Duck,masks:&JsValue)->R<JsValue>;
 #[wasm_bindgen(method,catch)]fn close(this:&Duck)->R<JsValue>;
 #[wasm_bindgen(method,catch)]fn steps(this:&Duck,mask:&JsValue)->R<JsValue>;
 // The records the analyser answers with or hands to the scorers: a setter on a fresh object defines the key.
 #[wasm_bindgen(method,setter,js_name=aspectRatio)]fn set_aspect_ratio(this:&Duck,value:&JsValue);
 #[wasm_bindgen(method,setter,js_name=source)]fn set_source(this:&Duck,value:&str);
 #[wasm_bindgen(method,setter,js_name=fontFamily)]fn set_font_family(this:&Duck,value:&str);
 #[wasm_bindgen(method,setter,js_name=fontCanvasFamily)]fn set_font_canvas_family(this:&Duck,value:&str);
 #[wasm_bindgen(method,setter,js_name=fontFallback)]fn set_font_fallback(this:&Duck,value:&str);
 #[wasm_bindgen(method,setter,js_name=fontWeight)]fn set_font_weight(this:&Duck,value:f64);
 #[wasm_bindgen(method,setter,js_name=gray)]fn set_gray(this:&Duck,value:&JsValue);
 #[wasm_bindgen(method,setter,js_name=near)]fn set_near(this:&Duck,value:&JsValue);
 #[wasm_bindgen(method,setter,js_name=rows)]fn set_rows(this:&Duck,value:&JsValue);
}
/// The typed view of a host value; nothing is checked, a missing member fails where it is used.
fn duck(value:&JsValue)->&Duck{value.unchecked_ref()}

/// family, weight, fallback: the order is the tie-break of the search.
const FONTS:[(&str,f64,&str,&str);6]=[
 ("Playfair Display",700.0,"Georgia, serif","700"),("Lora",700.0,"Georgia, serif","700"),("Cormorant Garamond",700.0,"Georgia, serif","700"),
 ("DM Sans",600.0,"Arial, sans-serif","600"),("Montserrat",700.0,"Arial, sans-serif","700"),("Oswald",600.0,"Arial Narrow, sans-serif","600")];
// The search is a few hundred million operations: masks are rastered in slices short enough that
// scrolling and the animation loop keep their frames.
const SLICE_MS:f64=2.0;
const SLOW:&str="La portada tardó demasiado";

fn error(message:&str)->JsValue{js_sys::Error::new(message).into()}
fn undefined()->JsValue{JsValue::UNDEFINED}
fn number(value:f64)->JsValue{JsValue::from_f64(value)}
fn page()->JsValue{global()}
/// `document.createElement('canvas')`, with `document` looked up now.
fn new_canvas()->R<JsValue>{
 let document=duck(&page()).document();
 if absent(&document){return Err(js_sys::ReferenceError::new("document is not defined").into())}
 duck(&document).create_element(intern("canvas"))
}
/// `canvas.getContext('2d', { willReadFrequently: true })`: getImageData on a GPU-backed canvas forces a readback.
fn cpu_context(canvas:&JsValue)->R<JsValue>{
 let options:JsValue=Object::new().into();
 duck(&options).set_will_read_frequently(true);
 duck(canvas).get_context_with(intern("2d"),&options)
}

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

/// A callback JavaScript owns: it runs once at most and is collected with the function itself.
/// (`Closure::once_into_js` would keep one that is never called, and a handle to it, for the life of the page.)
fn js_owned<T:?Sized+wasm_bindgen::closure::WasmClosure>(closure:Closure<T>)->JsValue{closure.into_js_value()}

type Next=Box<dyn FnOnce(R<JsValue>)>;
thread_local!{
 /// What runs when a promise settles or a timer fires, by ticket. A ticket is taken by whichever comes first
 /// and a late call finds nothing, so every reaction is one of two functions the module makes once, bound to
 /// the ticket by the engine: making a Rust callback per `await` costs more than the await itself.
 static WAITING:RefCell<(u32,std::collections::HashMap<u32,Next>)>=RefCell::new((0,std::collections::HashMap::new()));
 static REACTIONS:(JsValue,JsValue)=(reaction(true),reaction(false));
}
fn reaction(fulfilled:bool)->JsValue{
 js_owned(Closure::<dyn Fn(u32,JsValue)>::new(move|ticket:u32,value:JsValue|{
  let next=WAITING.with(|waiting|waiting.borrow_mut().1.remove(&ticket));
  if let Some(next)=next{next(if fulfilled{Ok(value)}else{Err(value)});}
 }))
}
fn ticket(next:Next)->u32{
 WAITING.with(|waiting|{
  let mut waiting=waiting.borrow_mut();
  waiting.0=waiting.0.wrapping_add(1);
  let ticket=waiting.0;
  waiting.1.insert(ticket,next);
  ticket
 })
}
fn forget(ticket:u32){let dropped=WAITING.with(|waiting|waiting.borrow_mut().1.remove(&ticket));drop(dropped);}
/// `promise.then(value => next(Ok(value)), reason => next(Err(reason)))`. The derived promise always fulfils,
/// so nothing is left unhandled.
fn settled(promise:&JsValue,next:impl FnOnce(R<JsValue>)+'static){react(promise,Box::new(next))}
fn react(promise:&JsValue,next:Next){
 let ticket=ticket(next);
 REACTIONS.with(|(fulfilled,rejected)|{
  duck(promise).then(&duck(fulfilled).bind(&JsValue::UNDEFINED,ticket),&duck(rejected).bind(&JsValue::UNDEFINED,ticket));
 });
}
/// One `await value`.
fn wait(value:&JsValue,next:impl FnOnce(R<JsValue>)+'static){settled(&Promise::resolve(value),next)}

/// What cover-appearance.js hands over: the core's bridges, the slice driver, the Worker client, and the
/// two values the module keeps between analyses (`turn`, the search queue; `fonts`, the font loads).
#[derive(Clone)]
struct Host(JsValue);
impl std::ops::Deref for Host{type Target=Duck;fn deref(&self)->&Duck{duck(&self.0)}}

/// `coverAspectRatio(width, height)`.
fn aspect_ratio(width:&JsValue,height:&JsValue)->JsValue{
 let ratio=num(width)/num(height);
 if !ratio.is_finite()||ratio<=0.0{return JsValue::NULL}
 number(jmin(2.5,jmax(0.25,ratio)))
}
/// `String(value).trim().length`.
fn trimmed_length(value:&JsValue)->u32{text_value(value).unchecked_into::<JsString>().trim().length()}
/// `new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; })`.
fn loaded(image:&JsValue)->Promise{
 Promise::new(&mut|resolve,reject|{
  // A setter that throws rejects the promise, as it did inside the executor.
  if let Err(failure)=duck(image).set_onload(&resolve).and_then(|_|duck(image).set_onerror(&reject)){let _=reject.call1(&JsValue::UNDEFINED,&failure);}
 })
}
/// `setTimeout(() => reject(new Error(SLOW)), delay)` for a wait that `settle` may end first. Whichever comes
/// first takes the settlers, so neither a cleared timer nor a decode that never ends keeps them.
/// A browser's timer id is a number and is kept as one, so a decode that never ends holds no handle at all.
struct Timeout{id:Result<f64,JsValue>,ticket:u32,settlers:Rc<RefCell<Option<(Function,Function)>>>}
impl Timeout{
 fn start(resolve:&Function,reject:&Function,delay:f64)->R<Timeout>{
  let settlers=Rc::new(RefCell::new(Some((resolve.clone(),reject.clone()))));
  let fired=settlers.clone();
  let ticket=ticket(Box::new(move|_|{
   let waiting=fired.borrow_mut().take();
   if let Some((_,reject))=waiting{let _=reject.call1(&JsValue::UNDEFINED,&error(SLOW));}
  }));
  let started=REACTIONS.with(|(fire,_)|set_timeout(&duck(fire).bind(&JsValue::UNDEFINED,ticket),delay));
  match started{
   Ok(id)=>Ok(Timeout{id:id.as_f64().ok_or(id),ticket,settlers}),
   Err(failure)=>{forget(ticket);Err(failure)}
  }
 }
 /// `clearTimeout(timer)`, then the wait's outcome if the timer has not already rejected it.
 fn settle(&self,outcome:R<JsValue>)->R{
  let waiting=self.settlers.borrow_mut().take();
  self.stop()?;
  if let Some((resolve,reject))=waiting{let _=match outcome{Ok(value)=>resolve.call1(&JsValue::UNDEFINED,&value),Err(reason)=>reject.call1(&JsValue::UNDEFINED,&reason)};}
  Ok(())
 }
 fn clear(&self)->R{self.settlers.borrow_mut().take();self.stop()}
 fn stop(&self)->R{forget(self.ticket);match &self.id{Ok(id)=>clear_timeout_number(*id),Err(id)=>clear_timeout(id)}}
}
/// `new Image()` with `decoding = 'async'` and its source.
fn new_image(url:&JsValue)->R<JsValue>{
 let image:JsValue=Duck::image()?.into();
 duck(&image).set_decoding(intern("async"))?;
 duck(&image).set_src(url)?;
 Ok(image)
}

/// `readCoverAspectRatio(url)`: only the decoded dimensions, 1.5 s at most.
#[wasm_bindgen]
pub fn cover_aspect_read(url:JsValue)->Promise{
 let done=Deferred::new();
 let promise=done.promise.clone();
 if !truthy(&url)||duck(&page()).image_class().is_undefined(){done.resolve(&JsValue::NULL);return promise}
 let image=match new_image(&url){Ok(image)=>image,Err(failure)=>{done.reject(&failure);return promise}};
 let timeout:Rc<RefCell<Option<Timeout>>>=Rc::new(RefCell::new(None));
 let raced=(||->R<JsValue>{
  let first:JsValue=if duck(&image).decoder()?.is_function(){duck(&image).decode()?}else{loaded(&image).into()};
  let timer=timeout.clone();
  let second=Promise::new(&mut|resolve,reject|match Timeout::start(&resolve,&reject,1500.0){
   Ok(started)=>*timer.borrow_mut()=Some(started),
   Err(failure)=>{let _=reject.call1(&JsValue::UNDEFINED,&failure);}
  });
  race(&Array::of2(&first,&second))
 })();
 // `finally { clearTimeout(timeout) }` runs before the answer leaves, whatever it is.
 let finish=move|outcome:R<JsValue>|{
  let value=outcome.and_then(|_|Ok(aspect_ratio(&duck(&image).natural_width()?,&duck(&image).natural_height()?))).unwrap_or(JsValue::NULL);
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
   let chosen=duck(&options).match_font()?;
   (chosen.is_undefined()||truthy(&chosen),duck(&options).given_image()?)
  };
  let page=page();
  if !truthy(&url)||duck(&page).image_class().is_undefined()||duck(&page).document().is_undefined(){return Ok(None)}
  let host=Host(host);
  let core_ready=host.require_core()?;
  // Start compilation alongside decode; observe failures even if decoding fails.
  duck(&core_ready).otherwise(&host.noop())?;
  let given=truthy(&decoded);
  let image=if given{duck(&decoded).set_decoding(intern("async"))?;decoded}else{new_image(&url)?};
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
  let decoder=duck(&image).decoder()?;
  let decoding:Promise=if decoder.is_function(){
   let delay=if self.match_font{3000.0}else{1200.0};
   Promise::new(&mut|resolve,reject|{
    let begun=(||->R{
     let timer=Timeout::start(&resolve,&reject,delay)?;
     // `Promise.resolve().then(() => image.decode())`
     let decoded=duck(&Promise::resolve(&JsValue::UNDEFINED)).then_run(&duck(&decoder).bound_to(&image)?)?;
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
 /// `{ aspectRatio, source: 'cover' }` after whatever `record` already holds.
 fn dimensions(&self,record:JsValue)->JsValue{
  duck(&record).set_aspect_ratio(&self.aspect.borrow());
  duck(&record).set_source(intern("cover"));
  record
 }
 /// The decoded image drawn at 192 x 288 at most and read back.
 fn sample(self:&Rc<Self>)->R{
  let image=duck(&self.image);
  let (natural_width,natural_height)=(image.natural_width()?,image.natural_height()?);
  if !truthy(&natural_width)||!truthy(&natural_height){self.done.resolve(&JsValue::NULL);return Ok(())}
  *self.aspect.borrow_mut()=aspect_ratio(&natural_width,&natural_height);
  let (natural_width,natural_height)=(num(&natural_width),num(&natural_height));
  let scale=jmin(jmin(1.0,192.0/natural_width),288.0/natural_height);
  let (width,height)=(jmax(1.0,js_round(natural_width*scale)),jmax(1.0,js_round(natural_height*scale)));
  self.width.set(width);self.height.set(height);
  let canvas=new_canvas()?;
  duck(&canvas).set_width(width)?;duck(&canvas).set_height(height)?;
  let context=cpu_context(&canvas)?;
  if !truthy(&context){self.done.resolve(&self.dimensions(Object::new().into()));return Ok(())}
  duck(&context).draw_image(&self.image,0.0,0.0,width,height)?;
  // Cross-origin images can still supply their decoded dimensions even when browser security
  // prevents sampling their pixels.
  let pixels=match duck(&context).get_image_data(0.0,0.0,width,height).and_then(|image|duck(&image).data()){
   Ok(pixels)=>pixels,
   Err(_)=>{self.done.resolve(&self.dimensions(Object::new().into()));return Ok(())}
  };
  *self.pixels.borrow_mut()=pixels;
  self.then(&self.core_ready,|analysis,core|{
   *analysis.core.borrow_mut()=core;
   analysis.then(&analysis.host.ready()?,|analysis,_|analysis.colour());
   Ok(())
  });
  Ok(())
 }
 /// `{ ...color }`.
 fn record(&self)->R<JsValue>{let value:JsValue=Object::new().into();assign(&value,&self.color.borrow())?;Ok(value)}
 fn colour(self:&Rc<Self>)->R{
  let (pixels,width,height)=(self.pixels.borrow().clone(),self.width.get(),self.height.get());
  // `coverColorFromPixels(pixels, width, height)`
  let color=if !truthy(&pixels)||!width.is_finite()||!height.is_finite()||width<1.0||height<1.0{JsValue::NULL}else{
   let style=self.host.color(&self.host.core()?,&pixels,width,height)?;
   if !truthy(&style){return Err(error("Invalid cover pixels"))}
   style
  };
  *self.color.borrow_mut()=color;
  if !self.match_font{self.done.resolve(&self.dimensions(self.record()?));return Ok(())}
  // Font loading is already required. Let the numeric module finish loading during that wait.
  self.then(&candidate_fonts(&self.host,&self.title)?,|analysis,_|analysis.search());
  Ok(())
 }
 fn search(self:&Rc<Self>)->R{
  let (width,height,title)=(self.width.get(),self.height.get(),self.title.clone());
  let include_edges=truthy(&title)&&trimmed_length(&title)>=3&&width>=48.0&&(height*0.82).floor()>=48.0;
  let prepared=self.host.prepare(&self.core.borrow(),&self.pixels.borrow(),width,height,include_edges)?;
  if !truthy(&prepared){return Err(error("Invalid cover preparation"))}
  let (gray,near)=(duck(&prepared).gray()?,duck(&prepared).near()?);
  *self.prepared.borrow_mut()=prepared;
  // One cover at a time, so a whole shelf of new books does not pile up long tasks.
  let host=self.host.clone();
  let search=js_owned(Closure::<dyn FnMut(JsValue)->JsValue>::once(move|_:JsValue|match_title_font(host,gray,width,height,title,near).into()));
  let turn=duck(&self.host.turn()?).then_run(&search)?;
  self.host.set_turn(&duck(&turn).otherwise(&self.host.noop())?)?;
  self.then(&turn,|analysis,found|{
   let index=match found.as_f64(){Some(index) if index>=0.0&&index<6.0&&index.fract()==0.0=>index as usize,
    _=>if truthy(&duck(&analysis.prepared.borrow()).busy()?){3}else{0}};
   let (family,weight,fallback,_)=FONTS[index];
   let record=analysis.record()?;
   let fields=duck(&record);
   fields.set_font_family(family);fields.set_font_canvas_family(family);
   fields.set_font_fallback(fallback);fields.set_font_weight(weight);
   analysis.done.resolve(&analysis.dimensions(record));
   Ok(())
  });
  Ok(())
 }
}

/// `${weight} 20px "${family}"`.
fn face(index:usize)->String{let (family,_,_,weight)=FONTS[index];format!("{weight} 20px \"{family}\"")}
/// `loadCandidateFonts(text)`: the six faces once per page, plus the unicode subsets the lettering needs.
fn candidate_fonts(host:&Host,text:&JsValue)->R<JsValue>{
 let fonts=||{
  let document=duck(&page()).document();
  if absent(&document){return Err(js_sys::TypeError::new("Cannot read properties of undefined (reading 'fonts')").into())}
  duck(&document).font_faces()
 };
 let available=fonts()?;
 if absent(&available)||!truthy(&duck(&available).loader()?){return Ok(Promise::resolve(&JsValue::UNDEFINED).into())}
 if !truthy(&host.font_loads()){
  let loads=Array::new();
  for index in 0..FONTS.len(){loads.push(&duck(&fonts()?).load(&face(index))?);}
  host.set_font_loads(&all_settled(&loads)?)?;
 }
 let task=host.font_loads();
 // The default Latin face already covers ASCII/Latin-1.
 if !truthy(text)||!text_value(text).unchecked_into::<JsString>().iter().any(|unit|unit>0xff){return Ok(task)}
 let loads=Array::of1(&task);
 for index in 0..FONTS.len(){loads.push(&duck(&fonts()?).load_for(&face(index),&text_value(text))?);}
 all_settled(&loads)
}

/// One title search between its awaits: the cover's planes, the plans, the Worker job and the main-thread scorer.
struct Search{host:Host,done:Rc<Deferred>,gray:JsValue,near:JsValue,width:f64,height:f64,title:JsValue,
 rows:RefCell<JsValue>,plans:RefCell<Array>,plan_count:Cell<u32>,worker:RefCell<JsValue>,local:RefCell<JsValue>,scores:Array}

/// `matchTitleFont(...)`: the index of the best family, or `null` when nothing can be matched.
fn match_title_font(host:Host,gray:JsValue,width:f64,height:f64,title:JsValue,near:JsValue)->Promise{
 let done=Deferred::new();
 let promise=done.promise.clone();
 let search=Rc::new(Search{host,done,gray,near,width,height,title,rows:RefCell::new(undefined()),plans:RefCell::new(Array::new()),plan_count:Cell::new(0),
  worker:RefCell::new(JsValue::NULL),local:RefCell::new(JsValue::NULL),scores:Array::new()});
 match search.host.ready(){
  Ok(ready)=>{let search=search.clone();wait(&ready,move|outcome|if let Err(failure)=outcome.and_then(|_|search.open()){search.done.reject(&failure);})}
  Err(failure)=>search.done.reject(&failure),
 }
 promise
}
impl Search{
 /// `{ gray, near, width, height, rows }`.
 fn context(&self)->JsValue{
  let context:JsValue=Object::new().into();
  let fields=duck(&context);
  fields.set_gray(&self.gray);fields.set_near(&self.near);
  let _=fields.set_width(self.width);let _=fields.set_height(self.height);
  fields.set_rows(&self.rows.borrow());
  context
 }
 fn open(self:&Rc<Self>)->R{
  let title=&self.title;
  if !truthy(title)||trimmed_length(title)<3||duck(&page()).document().is_undefined(){self.done.resolve(&JsValue::NULL);return Ok(())}
  let core=self.host.core()?;
  let plans=self.host.plan(&core,title,self.width)?;
  if !Array::is_array(&plans){return Err(js_sys::TypeError::new("plans is not iterable").into())}
  let plans:Array=plans.unchecked_into();
  self.plan_count.set(plans.length());
  *self.plans.borrow_mut()=plans;
  let work=new_canvas()?;
  duck(&work).set_width(self.width)?;duck(&work).set_height((self.height*0.82).floor())?;
  let context=duck(&work).get_context(intern("2d"))?;
  let rows=duck(&work).height()?;
  if !truthy(&context)||self.width<48.0||num(&rows)<48.0{self.done.resolve(&JsValue::NULL);return Ok(())}
  *self.rows.borrow_mut()=rows;
  let search=self.clone();
  wait(&self.host.open(&self.context())?,move|outcome|match outcome{
   Ok(job)=>{*search.worker.borrow_mut()=job;search.family(0)}
   Err(failure)=>search.done.reject(&failure),
  });
  Ok(())
 }
 /// `finally { workerJob?.close(); localScorer?.dispose(); }`, then the answer.
 fn close(&self,outcome:R<JsValue>){
  let closed=(||->R{
   let worker=self.worker.borrow().clone();
   if !absent(&worker){duck(&worker).close()?;}
   let local=self.local.borrow().clone();
   if !absent(&local){duck(&local).dispose()?;}
   Ok(())
  })();
  self.done.settle(closed.and(outcome).and_then(|_|{
   let best=num(&self.host.select(&self.host.core()?,&self.scores)?);
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
   match duck(&worker).score_many(&masks){
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
    duck(&worker).close()?;
    *self.worker.borrow_mut()=JsValue::NULL;
   }
   // Keep the original masks intact for a failed/unavailable Worker.
   if absent(&self.local.borrow()){
    let scorer=self.host.scorer(&self.host.core()?,&self.context())?;
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
    let steps=duck(&search.local.borrow()).steps(&masks.get(index))?;
    search.host.slices(&steps)
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
/// One family's rasters (`scoreFamily` driven by `runRemoteFamily`). The family owns one CPU-backed raster
/// surface; masks are copied before they are handed over, so later plans reuse it. The raster itself is the
/// host's `fontMask`: a mask is about twenty canvas calls, which cost more from here than the mask's own work.
struct Family{search:Rc<Search>,done:Rc<Deferred>,title:JsValue,before:JsValue,after:JsValue,masks:Array,wraps:RefCell<JsValue>,surface:JsValue,
 at:Cell<u32>,step:RefCell<Step>,slice_start:Cell<f64>,finished:Cell<bool>}
impl Family{
 fn run(search:&Rc<Search>,index:usize)->Promise{
  let done=Deferred::new();
  let promise=done.promise.clone();
  // `${weight} ${size}px "${family}", ${fallback}` around the plan's size.
  let (family,_,fallback,weight)=FONTS[index];
  let family=Rc::new(Family{search:search.clone(),done,title:text_value(&search.title),before:format!("{weight} ").into(),after:format!("px \"{family}\", {fallback}").into(),
   masks:Array::new(),wraps:RefCell::new(JsValue::NULL),surface:Object::new().into(),at:Cell::new(0),step:RefCell::new(Step::Done),slice_start:Cell::new(0.0),finished:Cell::new(true)});
  // The generator starts outside the driver's `try`: a wrap cache that cannot be made has nothing to release.
  let started=(||->R{
   family.slice_start.set(clock()?);
   *family.wraps.borrow_mut()=search.host.wraps(&search.host.core()?)?;
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
  duck(&self.wraps.borrow()).dispose()?;
  let canvas=duck(&self.surface).canvas()?;
  if truthy(&canvas){duck(&canvas).set_width(0.0)?;duck(&canvas).set_height(0.0)?;}
  Ok(())
 }
 /// The top of the plan loop: the bare yield before plan `at`, or the end of the generator.
 fn arrive(&self)->R<Step>{
  if self.at.get()<self.search.plan_count.get(){return Ok(Step::Bare)}
  self.release()?;
  Ok(Step::Done)
 }
 /// `task.next(0)`: the mask of plan `at` when it has lines and fits the cover, otherwise on to the next plan.
 fn next(&self)->R<Step>{
  let bare=matches!(*self.step.borrow(),Step::Bare);
  if bare{
   let search=&self.search;
   let plan=search.plans.borrow().get(self.at.get());
   let mask=search.host.mask(&self.title,&self.before,&self.after,&plan,search.width,&search.rows.borrow(),&self.wraps.borrow(),&self.surface)?;
   if truthy(&mask){return Ok(Step::Mask(mask))}
  }
  self.at.set(self.at.get()+1);
  self.arrive()
 }
 /// `runRemoteFamily`'s loop from the step just reached (`resumed`: straight after a slice's yield).
 fn advance(self:&Rc<Self>,reached:R,mut resumed:bool){
  let run=reached.and_then(|_|loop{
   if !resumed{
    match &*self.step.borrow(){Step::Done=>break Ok(false),Step::Mask(mask)=>{self.masks.push(mask);}Step::Bare=>{}}
    if clock()?-self.slice_start.get()>=SLICE_MS{
     // A message event queues behind whatever else is waiting (input, timers).
     let yielded=self.search.host.yield_to_main()?;
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
   Ok(false)=>match self.search.host.core(){
    Ok(core)=>{
     let family=self.clone();
     wait(&self.search.score_masks(self.masks.clone()),move|outcome|{
      match outcome.and_then(|scores|family.search.host.max(&core,&scores)){Ok(best)=>family.done.resolve(&best),Err(failure)=>family.fail(failure)}
     });
    }
    Err(failure)=>self.fail(failure),
   },
   Err(failure)=>self.fail(failure),
  }
 }
 /// A failure anywhere releases the generator (`task.return()`) before it leaves.
 fn fail(&self,failure:JsValue){
  match self.release(){Ok(())=>self.done.reject(&failure),Err(later)=>self.done.reject(&later)}
 }
}
