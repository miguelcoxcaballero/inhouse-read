//! Reader command orchestration. Storage, format engines and DOM records retain
//! their original JavaScript identity; async continuations own only handles.
use wasm_bindgen::{prelude::*,JsCast,intern};
use wasm_bindgen_futures::JsFuture;
use js_sys::{Array,Function,Object,Promise,Reflect};
use crate::reading_places::{reading_history,reading_toggle};
fn key(name:&str)->JsValue{JsValue::from_str(intern(name))}
pub(crate) fn get(value:&JsValue,name:&str)->Result<JsValue,JsValue>{Reflect::get(value,&key(name))}
pub(crate) fn set(value:&JsValue,name:&str,next:&JsValue)->Result<(),JsValue>{Reflect::set(value,&key(name),next)?;Ok(())}
pub(crate) fn invoke(value:&JsValue,name:&str,args:&Array)->Result<JsValue,JsValue>{get(value,name)?.dyn_into::<Function>().map_err(|_|JsValue::from(js_sys::TypeError::new("Reader method is not callable")))?.apply(value,args)}
pub(crate) fn call(value:&JsValue,name:&str)->Result<JsValue,JsValue>{invoke(value,name,&Array::new())}
pub(crate) fn one(value:&JsValue,name:&str,arg:&JsValue)->Result<JsValue,JsValue>{invoke(value,name,&Array::of1(arg))}
pub(crate) fn two(value:&JsValue,name:&str,a:&JsValue,b:&JsValue)->Result<JsValue,JsValue>{invoke(value,name,&Array::of2(a,b))}
async fn wait(value:Result<JsValue,JsValue>)->Result<JsValue,JsValue>{JsFuture::from(Promise::resolve(&value?)).await}
fn active(check:&Function)->Result<bool,JsValue>{Ok(check.call0(&JsValue::UNDEFINED)?.is_truthy())}
fn error(host:&JsValue,message:&str)->Result<(),JsValue>{one(host,"error",&message.into())?;Ok(())}
fn array(value:JsValue)->Array{value.unchecked_into()}
#[wasm_bindgen]
pub async fn reader_save_places(host:JsValue,fields:Function)->Result<(),JsValue>{
 let book=get(&host,"book")?;if !book.is_truthy(){return Ok(());}
 let result=async{let id=get(&get(&host,"book")?,"id")?;let data=fields.call0(&JsValue::UNDEFINED)?;wait(two(&host,"persist",&id,&data)).await}.await;
 if result.is_err(){error(&host,"No se pudieron guardar los marcadores.")?;}Ok(())
}
#[wasm_bindgen]
pub async fn reader_jump(host:JsValue,place:JsValue,target:JsValue,current:Function,create:Function)->Result<(),JsValue>{
 call(&get(&host,"voice")?,"browse")?;error(&host,"")?;
 let origin=create.call0(&JsValue::UNDEFINED)?;
 set(&host,"history",&reading_history(array(get(&host,"history")?),origin))?;
 wait(call(&host,"savePlaces")).await?;if !active(&current)?{return Ok(());}
 call(&host,"renderPlaces")?;
 let result=async{
  let reader=get(&host,"reader")?;
  if !target.is_undefined(){wait(one(&reader,"goToTarget",&target)).await?;}
  else{wait(two(&reader,"goToLocator",&get(&place,"locator")?,&get(&place,"fraction")?)).await?;}
  if !active(&current)?{return Ok(());}
  call(&host,"relocate")?;call(&get(&host,"panel")?,"close")?;Ok::<(),JsValue>(())
 }.await;
 if result.is_err()&&active(&current)?{error(&host,"No se pudo abrir.")?;}Ok(())
}
#[wasm_bindgen]
pub async fn reader_return(host:JsValue,place:JsValue,current:Function)->Result<(),JsValue>{
 if !array(get(&host,"history")?).includes(&place,0){return Ok(());}
 call(&get(&host,"voice")?,"browse")?;
 let result=async{
  wait(two(&get(&host,"reader")?,"goToLocator",&get(&place,"locator")?,&get(&place,"fraction")?)).await?;
  if !active(&current)?{return Ok(());}
  let history=array(get(&host,"history")?);two(&history,"splice",&JsValue::from(history.index_of(&place,0)),&1.into())?;
  wait(call(&host,"savePlaces")).await?;if !active(&current)?{return Ok(());}
  call(&host,"relocate")?;call(&host,"renderPlaces")?;call(&get(&host,"panel")?,"close")?;Ok::<(),JsValue>(())
 }.await;
 if result.is_err()&&active(&current)?{error(&host,"No se pudo volver.")?;}Ok(())
}
#[wasm_bindgen]
pub async fn reader_bookmark(host:JsValue,create:Function)->Result<(),JsValue>{
 let bookmarks=reading_toggle(array(get(&host,"bookmarks")?),get(&host,"location")?,create)?;
 set(&host,"bookmarks",&bookmarks)?;wait(call(&host,"savePlaces")).await?;
 call(&host,"renderPlaces")?;one(&host,"showPlaceTab",&"bookmarks".into())?;Ok(())
}
#[wasm_bindgen]
pub async fn reader_quote(host:JsValue,create:Function,clean:Function)->Result<(),JsValue>{
 let selected=call(&get(&host,"reader")?,"getSelection")?;
 let selected=if selected.is_truthy(){selected}else{get(&host,"selectedQuoteSelection")?};
 let text=if selected.is_string(){selected.clone()}else if selected.is_null()||selected.is_undefined(){JsValue::UNDEFINED}else{get(&selected,"text")?};
 if !text.is_truthy(){return error(&host,"Selecciona un texto primero.");}
 let locator=if selected.is_string(){get(&get(&host,"location")?,"locator")?}else{get(&selected,"locator")?};
 let quote=create.call2(&JsValue::UNDEFINED,&text,&locator)?;
 let records=Array::of1(&quote);for record in array(get(&host,"quotes")?).iter(){records.push(&record);}
 set(&host,"quotes",&clean.call1(&JsValue::UNDEFINED,&records)?)?;
 one(&get(&host,"reader")?,"addQuoteAnnotation",&quote)?;set(&host,"selectedQuoteSelection",&JsValue::NULL)?;
 wait(call(&host,"savePlaces")).await?;call(&host,"renderPlaces")?;one(&host,"showPlaceTab",&"quotes".into())?;Ok(())
}
#[wasm_bindgen]
pub async fn reader_search(host:JsValue,query:JsValue,activate:Function)->Result<(),JsValue>{
 one(&get(&host,"lists")?,"clearSearch",&"Buscando…".into())?;
 let result=async{
  let results=wait(one(&get(&host,"reader")?,"search",&query)).await?;
  set(&host,"searchActive",&JsValue::from(get(&results,"length")?.as_f64().unwrap_or(0.0)>0.0))?;
  two(&get(&host,"lists")?,"renderSearch",&results,&activate)?;Ok::<(),JsValue>(())
 }.await;
 if result.is_err(){let status=one(&get(&host,"panel")?,"querySelector",&"[data-search-status]".into())?;set(&status,"textContent",&"No se pudo buscar.".into())?;}Ok(())
}
#[wasm_bindgen]
pub fn reader_search_activate(host:JsValue,result:JsValue)->Result<(),JsValue>{
 set(&host,"keepSearchHits",&JsValue::TRUE)?;
 let value=get(&result,"fraction")?;
 let fraction=if value.is_null()||value.is_undefined(){get(&get(&host,"location")?,"fraction")?}else{value};
 let target=Object::new();set(&target,"fraction",&fraction)?;set(&target,"locator",&get(&result,"locator")?)?;
 one(&host,"jump",&target.into())?;Ok(())
}
#[wasm_bindgen]
pub fn reader_end_search(host:JsValue)->Result<(),JsValue>{
 if !get(&host,"searchActive")?.is_truthy(){return Ok(());}
 set(&host,"searchActive",&JsValue::FALSE)?;set(&host,"keepSearchHits",&JsValue::FALSE)?;
 let reader=get(&host,"reader")?;let clear=get(&reader,"clearSearch")?;
 if !clear.is_null()&&!clear.is_undefined(){clear.dyn_into::<Function>().map_err(|_|JsValue::from(js_sys::TypeError::new("clearSearch is not callable")))?.call0(&reader)?;}
 one(&get(&host,"lists")?,"clearSearch",&"".into())?;Ok(())
}
