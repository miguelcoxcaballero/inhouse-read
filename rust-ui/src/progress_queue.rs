//! Per-book persistence queues: pending positions coalesce, settings are barriers.
//! JavaScript retains database operations and records; no serialized book copies.
use std::{cell::RefCell,collections::VecDeque,rc::Rc};
use wasm_bindgen::{prelude::*,JsCast};
use wasm_bindgen_futures::{spawn_local,JsFuture};
use js_sys::{Array,Function,Map,Object,Promise,Reflect};
use crate::host;
/// Who writes: three functions of the caller, or the library itself (see the constructor).
enum Store{Functions(Function,Function),Library(JsValue)}
/// `{...fields}` onto `target`: every own enumerable property, string keys then symbols, each read
/// once and written as plain data. The engine's own copy does exactly that except for an own
/// `__proto__`, which it would hand to the prototype setter: such an object is copied key by key.
fn spread(target:&Object,fields:&JsValue)->Result<(),JsValue>{
 if fields.is_null_or_undefined(){return Ok(())}
 let source=host::boxed(fields);
 if !source.unchecked_ref::<Object>().has_own_property(&JsValue::from_str("__proto__")){Object::assign(target,source.unchecked_ref());return Ok(())}
 for key in Reflect::own_keys(&source)?.iter(){
  let found=Reflect::get_own_property_descriptor(source.unchecked_ref(),&key)?;
  if found.is_undefined()||!host::flag(&found,"enumerable"){continue}
  let entry=Object::new();
  host::set(&entry,"value",&Reflect::get(&source,&key)?)?;
  for name in ["writable","enumerable","configurable"]{host::set(&entry,name,&JsValue::TRUE)?;}
  Reflect::define_property(target,&key,&entry)?;
 }
 Ok(())
}
/// What a settings write stores: the fields, and the time and the unsent mark of a change of the
/// reading itself (anything but the look of the book on the shelf).
fn stamped(fields:&JsValue)->Result<JsValue,JsValue>{
 let record=Object::new();spread(&record,fields)?;
 let keys:JsValue=Object::keys(fields.unchecked_ref()).into();
 let look=(0..host::number(&keys,"length") as u32).any(|index|host::get_at(&keys,index).as_string().is_some_and(|key|["spine","cover","shelf","pageEdge"].iter().any(|prefix|key.starts_with(prefix))));
 if !look{
  // Written after the copy, as the two spread properties were: a field of the same name keeps its place.
  host::set(&record,"progressUpdatedAt",&JsValue::from_f64(js_sys::Date::now()))?;
  host::set(&record,"progressDirty",&JsValue::TRUE)?;
 }
 Ok(record.into())
}
enum Update{Position(JsValue,JsValue),Settings(JsValue)}
struct Task{update:RefCell<Update>,promise:Promise,resolve:Function,reject:Function}
struct Entry{id:JsValue,pending:RefCell<VecDeque<Rc<Task>>>,latest:RefCell<JsValue>}
struct Slots{entries:Vec<Option<Rc<Entry>>>,free:Vec<usize>}
struct Core{ids:Map,slots:RefCell<Slots>,store:Store,saved:Function}
#[wasm_bindgen]
pub struct RustReadingProgressQueue{core:Rc<Core>}
async fn settle(value:Result<JsValue,JsValue>)->Result<JsValue,JsValue>{JsFuture::from(Promise::resolve(&value?)).await}
impl Core{
 fn find(&self,id:&JsValue)->Option<(usize,Rc<Entry>)>{
  let slot=self.ids.get(id).as_f64()? as usize;
  self.slots.borrow().entries.get(slot)?.clone().map(|entry|(slot,entry))
 }
 fn enqueue(self:&Rc<Self>,id:JsValue,update:Update)->Promise{
  let (slot,entry,fresh)=if let Some((slot,entry))=self.find(&id){(slot,entry,false)}else{
   let entry=Rc::new(Entry{id:id.clone(),pending:RefCell::new(VecDeque::new()),latest:RefCell::new(JsValue::UNDEFINED)});
   let mut slots=self.slots.borrow_mut();let slot=slots.free.pop().unwrap_or(slots.entries.len());
   if slot==slots.entries.len(){slots.entries.push(Some(entry.clone()));}else{slots.entries[slot]=Some(entry.clone());}
   self.ids.set(&id,&JsValue::from_f64(slot as f64));(slot,entry,true)
  };
  if let Update::Position(fraction,locator)=&update{
   if let Some(tail)=entry.pending.borrow().back(){
    let mut previous=tail.update.borrow_mut();
    if let Update::Position(old_fraction,old_locator)=&mut *previous{
     *old_fraction=fraction.clone();*old_locator=locator.clone();return tail.promise.clone();
    }
   }
  }
  let mut callbacks=None;let promise=Promise::new(&mut |resolve,reject|{callbacks=Some((resolve,reject));});
  let (resolve,reject)=callbacks.expect("Promise executor runs synchronously");
  entry.pending.borrow_mut().push_back(Rc::new(Task{update:RefCell::new(update),promise:promise.clone(),resolve,reject}));
  *entry.latest.borrow_mut()=promise.clone().into();
  if fresh{let core=self.clone();spawn_local(async move{core.drain(slot,entry).await;});}
  promise
 }
 async fn drain(self:Rc<Self>,slot:usize,entry:Rc<Entry>){
  loop{
   let task=entry.pending.borrow_mut().pop_front();let Some(task)=task else{break};
   // Release borrows before external code: storage/onSaved may enqueue more work.
   let args=match &*task.update.borrow(){Update::Position(f,l)=>(true,f.clone(),l.clone()),Update::Settings(f)=>(false,f.clone(),JsValue::UNDEFINED)};
   let write=match &self.store{
    Store::Functions(position,settings)=>if args.0{position.call3(&JsValue::UNDEFINED,&entry.id,&args.1,&args.2)}else{settings.call2(&JsValue::UNDEFINED,&entry.id,&args.1)},
    Store::Library(library)=>if args.0{host::method(library,"updateProgress",&[&entry.id,&args.1,&args.2])}else{stamped(&args.1).and_then(|record|host::method(library,"patch",&[&entry.id,&record]))},
   };
   let result=match settle(write).await{
    Ok(record)=>match settle(self.saved.call3(&JsValue::UNDEFINED,&record,&entry.id,&if args.0{Array::of3(&"progressFraction".into(),&"locator".into(),&"progressUpdatedAt".into()).into()}else{Object::keys(args.1.unchecked_ref()).into()})).await{Ok(_)=>Ok(record),Err(error)=>Err(error)},Err(error)=>Err(error)
   };
   match result{Ok(record)=>{let _=task.resolve.call1(&JsValue::UNDEFINED,&record);},Err(error)=>{let _=task.reject.call1(&JsValue::UNDEFINED,&error);}}
  }
  if self.find(&entry.id).is_some_and(|(_,current)|Rc::ptr_eq(&entry,&current)){
   self.ids.delete(&entry.id);let mut slots=self.slots.borrow_mut();slots.entries[slot]=None;slots.free.push(slot);
  }
 }
}
#[wasm_bindgen]
impl RustReadingProgressQueue{
 /// `new RustReadingProgressQueue(library, onSaved)` is the app's queue: positions go to
 /// `library.updateProgress`, settings to `library.patch` with their stamp, and the caller's fields are
 /// copied when they are queued. `new RustReadingProgressQueue(position, settings, onSaved)`, with
 /// three functions, leaves the writing and the copying to the caller.
 #[wasm_bindgen(constructor)]
 pub fn new(first:JsValue,second:JsValue,third:JsValue)->Result<RustReadingProgressQueue,JsValue>{
  let function=|value:JsValue|value.dyn_into::<Function>().map_err(|_|JsValue::from(js_sys::TypeError::new("Reading progress needs its callbacks")));
  Ok(if first.is_function(){Self::over(Store::Functions(function(first)?,function(second)?),function(third)?)}else{Self::over(Store::Library(first),function(second)?)})
 }
 #[wasm_bindgen(js_name=updateProgress)]
 pub fn update_progress(&self,id:JsValue,fraction:JsValue,locator:JsValue)->Promise{self.core.enqueue(id,Update::Position(fraction,locator))}
 pub fn patch(&self,id:JsValue,fields:JsValue)->Result<Promise,JsValue>{
  let fields=if matches!(self.core.store,Store::Library(_)){let copy=Object::new();spread(&copy,&fields)?;copy.into()}else{fields};
  Ok(self.core.enqueue(id,Update::Settings(fields)))
 }
 pub fn get(&self,id:JsValue)->JsValue{self.core.find(&id).map(|(_,entry)|entry.latest.borrow().clone()).unwrap_or(JsValue::UNDEFINED)}
}
impl RustReadingProgressQueue{
 fn over(store:Store,saved:Function)->Self{Self{core:Rc::new(Core{ids:Map::new(),slots:RefCell::new(Slots{entries:Vec::new(),free:Vec::new()}),store,saved})}}
}
// Pending saves own Core until drained even if the host releases its handle.
