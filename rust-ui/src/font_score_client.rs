//! The client of the font-score Worker (formerly the body of src/js/font-score-client.js). One module
//! Worker, created on first use and shared by every caller; one job at a time and one request in flight.
//! A job's start-up waits 3 s at most and each score 2 s. A reply that is not the exact current one is
//! ignored and a malformed one closes the Worker. An idle Worker is released after 30 s and `pagehide`
//! releases it at once. Every failure settles the waiting promise first, so a caller always gets an
//! answer: a score, a rejection, or `null` from `font_score_open`, after which it scores on the main
//! thread as before. The host only creates the Worker and names the page's event target.
use std::cell::{Cell,RefCell};
use std::rc::{Rc,Weak};
use wasm_bindgen::{prelude::*,JsCast};
use wasm_bindgen_futures::JsFuture;
use js_sys::{Array,Function,Object,Promise};
use crate::host::{absent,clear_timeout,get,global,method,read,set,set_timeout,text};
use crate::cloud_host::start;
type R<T=()>=Result<T,JsValue>;

const STARTUP_TIMEOUT_MS:f64=3_000.0;
const SCORE_TIMEOUT_MS:f64=2_000.0;
const IDLE_RELEASE_MS:f64=30_000.0;

#[derive(Clone,Copy,PartialEq)]
enum Kind{Begin,Score,Scores}
impl Kind{fn name(self)->&'static str{match self{Kind::Begin=>"begin",Kind::Score=>"score",Kind::Scores=>"scores"}}}

/// The one request in flight: its kind, job and id, its timeout, how to settle it and, for a batch, how
/// many scores it must bring back.
struct Pending{kind:Kind,job:f64,id:f64,timer:JsValue,resolve:Function,reject:Function,count:JsValue}

struct Client{
 worker:JsValue,events:JsValue,me:Weak<Client>,
 pending:RefCell<Option<Pending>>,active:Cell<Option<f64>>,idle:RefCell<JsValue>,sequence:Cell<f64>,disposed:Cell<bool>,
 pagehide:RefCell<JsValue>,
}

thread_local!{
 /// The Worker every caller shares while it lives.
 static SHARED:RefCell<Option<Rc<Client>>>=const{RefCell::new(None)};
 static NEXT_JOB:Cell<f64>=const{Cell::new(0.0)};
}

fn error(message:&str)->JsValue{js_sys::Error::new(message).into()}
fn rejected(message:&str)->Promise{Promise::reject(&error(message))}
fn object(fields:&[(&str,&JsValue)])->R<JsValue>{let value:JsValue=Object::new().into();for (key,field) in fields{set(&value,key,field)?;}Ok(value)}
/// `target[name]?.(...args)` with `target` as `this`.
fn call_present(target:&JsValue,name:&str,args:&[&JsValue])->R{
 let function=read(target,name)?;
 if absent(&function){return Ok(())}
 let function:&Function=function.dyn_ref().ok_or_else(||JsValue::from(js_sys::TypeError::new(&format!("{name} is not a function"))))?;
 function.apply(target,&args.iter().copied().collect::<Array>())?;Ok(())
}
/// `setTimeout(() => client.dispose(error), delay)`; the callback holds the client weakly.
fn dispose_later(client:&Rc<Client>,delay:f64,message:Option<&'static str>)->R<JsValue>{
 let weak=Rc::downgrade(client);
 let callback=Closure::once_into_js(move||->R{if let Some(client)=weak.upgrade(){client.dispose(message.map(error))?;}Ok(())});
 set_timeout(&callback,delay)
}

impl Client{
 fn create(factory:&JsValue,events:&JsValue)->R<Rc<Client>>{
  let factory:&Function=factory.dyn_ref().ok_or_else(||JsValue::from(js_sys::TypeError::new("factory is not a function")))?;
  let worker=factory.call0(&JsValue::UNDEFINED)?;
  let client=Rc::new_cyclic(|me|Client{worker:worker.clone(),events:events.clone(),me:me.clone(),
   pending:RefCell::new(None),active:Cell::new(None),idle:RefCell::new(JsValue::from_f64(0.0)),sequence:Cell::new(0.0),disposed:Cell::new(false),
   pagehide:RefCell::new(JsValue::UNDEFINED)});
  let weak=Rc::downgrade(&client);
  let onmessage=Closure::<dyn FnMut(JsValue)->R>::new(move|event:JsValue|match weak.upgrade(){Some(client)=>client.message(&event),None=>Ok(())}).into_js_value();
  let weak=Rc::downgrade(&client);
  let onerror=Closure::<dyn FnMut(JsValue)->R>::new(move|event:JsValue|{
   call_present(&event,"preventDefault",&[])?;
   match weak.upgrade(){Some(client)=>client.dispose(Some(error("Font score worker failed"))),None=>Ok(())}
  }).into_js_value();
  let weak=Rc::downgrade(&client);
  let onmessageerror=Closure::<dyn FnMut(JsValue)->R>::new(move|_event:JsValue|match weak.upgrade(){Some(client)=>client.dispose(Some(error("Font score worker message failed"))),None=>Ok(())}).into_js_value();
  set(&worker,"onmessage",&onmessage)?;
  set(&worker,"onerror",&onerror)?;
  set(&worker,"onmessageerror",&onmessageerror)?;
  let weak=Rc::downgrade(&client);
  let pagehide=Closure::<dyn FnMut(JsValue)->R>::new(move|_event:JsValue|match weak.upgrade(){Some(client)=>client.dispose(None),None=>Ok(())}).into_js_value();
  *client.pagehide.borrow_mut()=pagehide.clone();
  if !absent(events){call_present(events,"addEventListener",&[&"pagehide".into(),&pagehide])?;}
  Ok(client)
 }
 fn rc(&self)->Rc<Client>{self.me.upgrade().expect("a client is alive while it runs")}
 fn busy(&self)->bool{self.active.get().is_some()}
 fn live_job(&self,job:f64)->bool{!self.disposed.get()&&self.active.get()==Some(job)}

 /// Closes the Worker once: the waiting promise is rejected with `error` ("closed" by default), the page
 /// listener and the Worker's handlers are removed and the Worker is terminated, whatever it throws.
 fn dispose(&self,error_value:Option<JsValue>)->R{
  if self.disposed.get(){return Ok(())}
  self.disposed.set(true);
  clear_timeout(&self.idle.borrow())?;
  SHARED.with(|shared|{let mut shared=shared.borrow_mut();if shared.as_ref().is_some_and(|client|std::ptr::eq(Rc::as_ptr(client),self)){*shared=None;}});
  let waiting=self.pending.borrow_mut().take();
  if let Some(waiting)=waiting{
   clear_timeout(&waiting.timer)?;
   waiting.reject.call1(&JsValue::UNDEFINED,&error_value.unwrap_or_else(||error("Font score worker closed")))?;
  }
  if !absent(&self.events){call_present(&self.events,"removeEventListener",&[&"pagehide".into(),&self.pagehide.borrow()])?;}
  for handler in ["onmessageerror","onerror","onmessage"]{set(&self.worker,handler,&JsValue::NULL)?;}
  // Closing must never block promise settlement.
  let _=method(&self.worker,"terminate",&[]);
  Ok(())
 }

 /// Posts `{ ...payload, type, job, request }` and waits for its exact reply, bounded by the kind's timeout.
 fn request(&self,kind:Kind,job:f64,payload:&JsValue)->Promise{
  let client=self.rc();
  Promise::new(&mut|resolve:Function,reject:Function|{
   if client.disposed.get()||client.pending.borrow().is_some(){let _=reject.call1(&JsValue::UNDEFINED,&error("Font score worker unavailable"));return}
   let id=client.sequence.get()+1.0;client.sequence.set(id);
   let timer=dispose_later(&client,if kind==Kind::Begin{STARTUP_TIMEOUT_MS}else{SCORE_TIMEOUT_MS},Some("Font score worker did not reply")).unwrap_or(JsValue::UNDEFINED);
   let count=get(&get(payload,"masks"),"length");
   *client.pending.borrow_mut()=Some(Pending{kind,job,id,timer,resolve,reject,count});
   let posted=(||->R{
    let message:JsValue=Object::new().into();
    method(&get(&global(),"Object"),"assign",&[&message,payload])?;
    set(&message,"type",&kind.name().into())?;set(&message,"job",&job.into())?;set(&message,"request",&id.into())?;
    method(&client.worker,"postMessage",&[&message])?;Ok(())
   })();
   if let Err(failure)=posted{let _=client.dispose(Some(failure));}
  })
 }

 /// The Worker's reply: only the exact current job and request settle the waiting promise, and only with
 /// the value its kind must carry (`accepted: true`, one finite score, or exactly as many finite scores).
 fn message(&self,event:&JsValue)->R{
  let data=read(event,"data")?;
  let matched=match self.pending.borrow().as_ref(){
   None=>None,
   Some(waiting)=>(get(&data,"job")==JsValue::from_f64(waiting.job)&&get(&data,"request")==JsValue::from_f64(waiting.id)).then(||(waiting.kind,waiting.count.clone())),
  };
  let Some((kind,count))=matched else{return Ok(())};
  let finite=|value:&JsValue|value.as_f64().is_some_and(f64::is_finite);
  let invalid=!text(&read(&data,"type")?,kind.name())||match kind{
   Kind::Begin=>read(&data,"accepted")?!=JsValue::TRUE,
   Kind::Scores=>{
    let scores=read(&data,"scores")?;
    !Array::is_array(&scores)||read(&scores,"length")?!=count||scores.unchecked_ref::<Array>().some(&mut|score|!finite(&score))
   }
   Kind::Score=>!finite(&read(&data,"score")?),
  };
  if invalid{return self.dispose(Some(error("Invalid font score worker reply")))}
  let Some(waiting)=self.pending.borrow_mut().take() else{return Ok(())};
  clear_timeout(&waiting.timer)?;
  let value=match kind{Kind::Scores=>read(&data,"scores")?,Kind::Score=>read(&data,"score")?,Kind::Begin=>JsValue::TRUE};
  waiting.resolve.call1(&JsValue::UNDEFINED,&value)?;Ok(())
 }

 /// Starts job `job` on the Worker with the cover's `context`; resolves to its handle once the Worker
 /// has accepted the image.
 fn begin(&self,context:JsValue,job:f64)->Promise{
  let client=self.rc();
  start(async move{
   if client.disposed.get()||client.busy(){return Err(error("Font score worker unavailable"))}
   clear_timeout(&client.idle.borrow())?;
   client.active.set(Some(job));
   JsFuture::from(client.request(Kind::Begin,job,&context)).await?;
   job_handle(&client,job)
  })
 }

 /// The handle's `close()`: a job whose request is still in flight closes the Worker; otherwise the Worker
 /// clears the job and is released after 30 s unless another job starts.
 fn close_job(&self,job:f64)->R{
  if !self.live_job(job){return Ok(())}
  if self.pending.borrow().as_ref().is_some_and(|waiting|waiting.job==job){return self.dispose(Some(error("Font score job cancelled")))}
  self.active.set(None);
  let ended=object(&[("type",&"end".into()),("job",&job.into())])?;
  if method(&self.worker,"postMessage",&[&ended]).is_err(){return self.dispose(None)}
  *self.idle.borrow_mut()=dispose_later(&self.rc(),IDLE_RELEASE_MS,None)?;
  Ok(())
 }
}

/// `{ score(mask), scoreMany(masks), close() }` of one job; every call after `close()` is refused.
fn job_handle(client:&Rc<Client>,job:f64)->R<JsValue>{
 let closed=Rc::new(Cell::new(false));
 let (owner,shut)=(client.clone(),closed.clone());
 let score=Closure::<dyn FnMut(JsValue)->Promise>::new(move|mask:JsValue|{
  if shut.get()||!owner.live_job(job){return rejected("Inactive font score job")}
  match object(&[("mask",&mask)]){Ok(payload)=>owner.request(Kind::Score,job,&payload),Err(failure)=>Promise::reject(&failure)}
 }).into_js_value();
 let (owner,shut)=(client.clone(),closed.clone());
 let score_many=Closure::<dyn FnMut(JsValue)->Promise>::new(move|masks:JsValue|{
  if shut.get()||!owner.live_job(job){return rejected("Inactive font score job")}
  if !Array::is_array(&masks)||get(&masks,"length").as_f64().is_some_and(|length|length>24.0){return rejected("Invalid font score batch")}
  match object(&[("masks",&masks)]){Ok(payload)=>owner.request(Kind::Scores,job,&payload),Err(failure)=>Promise::reject(&failure)}
 }).into_js_value();
 let (owner,shut)=(client.clone(),closed);
 let close=Closure::<dyn FnMut()->R>::new(move||{
  if shut.get(){return Ok(())}
  shut.set(true);
  owner.close_job(job)
 }).into_js_value();
 object(&[("score",&score),("scoreMany",&score_many),("close",&close)])
}

/// `openFontScoreJob(context, { factory, events })` of src/js/font-score-client.js: the job's handle, or
/// `null` while another job holds the shared Worker or when the Worker cannot start (the caller then
/// scores on the main thread). `core_module` is called once for the core module handed to the Worker.
#[wasm_bindgen]
pub fn font_score_open(context:JsValue,factory:JsValue,events:JsValue,core_module:JsValue)->Promise{
 start(async move{
  if SHARED.with(|shared|shared.borrow().as_ref().is_some_and(|client|client.busy())){return Ok(JsValue::NULL)}
  let mut client=SHARED.with(|shared|shared.borrow().clone());
  let begun:R<Promise>=(||{
   let current=match client.clone(){Some(current)=>current,None=>{
    let created=Client::create(&factory,&events)?;
    SHARED.with(|shared|*shared.borrow_mut()=Some(created.clone()));
    client=Some(created.clone());created
   }};
   let payload:JsValue=Object::new().into();
   method(&get(&global(),"Object"),"assign",&[&payload,&context])?;
   let module=core_module.dyn_ref::<Function>().ok_or_else(||JsValue::from(js_sys::TypeError::new("core_module is not a function")))?.call0(&JsValue::UNDEFINED)?;
   set(&payload,"module",&module)?;
   let job=NEXT_JOB.with(|next|{next.set(next.get()+1.0);next.get()});
   Ok(current.begin(payload,job))
  })();
  let result=match begun{Ok(promise)=>JsFuture::from(promise).await,Err(failure)=>Err(failure)};
  match result{
   Ok(handle)=>Ok(handle),
   Err(_)=>{if let Some(client)=client{client.dispose(None)?;}Ok(JsValue::NULL)}
  }
 })
}
