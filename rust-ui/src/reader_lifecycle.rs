//! Book preparation and reader lifecycle. Effects before the first await stay
//! synchronous; browser records, engines and book bytes retain their identity.
use wasm_bindgen::{prelude::*,JsCast};
use wasm_bindgen_futures::{future_to_promise,JsFuture};
use js_sys::{Array,Function,JsString,Promise};
use web_sys::{Element,HtmlElement,FocusOptions};
use crate::reader_actions::{get,set,call,one,invoke};
#[wasm_bindgen]
extern "C"{
 #[wasm_bindgen(catch,js_name=String)]fn string(value:&JsValue)->Result<JsString,JsValue>;
 #[wasm_bindgen(catch,js_namespace=Object,js_name=assign)]fn assign(target:&JsValue,source:&JsValue)->Result<JsValue,JsValue>;
}
fn absent(value:&JsValue)->bool{value.is_null()||value.is_undefined()}
fn optional(host:&JsValue,name:&str)->Result<(),JsValue>{
 if absent(host){return Ok(());}let method=get(host,name)?;
 if !absent(&method){method.dyn_into::<Function>().map_err(|_|JsValue::from(js_sys::TypeError::new("Reader method is not callable")))?.call0(host)?;}Ok(())
}
fn describe(host:&JsValue,record:&JsValue,description:&Function,mini:bool)->Result<(),JsValue>{
 let values:Array=description.call1(&JsValue::UNDEFINED,record)?.dyn_into()?;
 values.push(&mini.into());invoke(&get(host,"view")?,"setDocumentInfo",&values)?;Ok(())
}
#[wasm_bindgen]
pub fn reader_refresh_names(host:JsValue,id:JsValue,fields:JsValue,description:Function)->Result<(),JsValue>{
 let book=get(&host,"book")?;
 if !book.is_truthy()||string(&get(&book,"id")?)?!=string(&id)?{return Ok(());}
 assign(&get(&host,"book")?,&fields)?;
 describe(&host,&get(&host,"book")?,&description,true)
}
#[wasm_bindgen]
pub fn reader_open(host:JsValue,record:JsValue,clean_places:Function,clean_quotes:Function,description:Function)->Result<Promise,JsValue>{
 call(&host,"cancelNavigation")?;set(&host,"book",&record)?;
 set(&host,"history",&clean_places.call1(&JsValue::UNDEFINED,&get(&record,"readingHistory")?)?)?;
 set(&host,"bookmarks",&clean_places.call2(&JsValue::UNDEFINED,&get(&record,"bookmarks")?,&100.into())?)?;
 set(&host,"quotes",&clean_quotes.call1(&JsValue::UNDEFINED,&get(&record,"quotes")?)?)?;
 describe(&host,&record,&description,false)?;
 let format=get(&get(&host,"reader")?,"format")?;
 let pdf=!absent(&format)&&get(&format,"engine")?==JsValue::from_str("pdf");
 let count=get(&get(&host,"reader")?,"pageCount")?;let count=if count.is_truthy(){count}else{1.into()};
 invoke(&get(&host,"view")?,"configureFormat",&Array::of2(&pdf.into(),&count))?;
 // Plain reading must not load a neural model or synthesize a preview.
 // Opening the audio panel / pressing Play owns voice preparation instead.
 call(&host,"renderPlaces")?;call(&host,"renderToc")?;
 let pending=Promise::resolve(&call(&host,"applyPreferences")?);
 Ok(future_to_promise(async move{
  JsFuture::from(pending).await?;call(&host,"relocate")?;
  let quotes:Array=get(&host,"quotes")?.unchecked_into();for quote in quotes.iter(){one(&get(&host,"reader")?,"addQuoteAnnotation",&quote)?;}
  Ok(JsValue::UNDEFINED)
 }))
}
#[wasm_bindgen]
pub fn reader_close_voice(host:JsValue,engine:Function)->Result<(),JsValue>{
 optional(&get(&host,"neuralPicker")?,"cancelWarm")?;call(&get(&host,"voice")?,"stop")?;
 let _=engine.call0(&JsValue::UNDEFINED).and_then(|engine|optional(&engine,"release"));Ok(())
}
#[wasm_bindgen]
pub fn reader_reset(host:JsValue)->Result<(),JsValue>{
 optional(&get(&host,"neuralPicker")?,"cancelWarm")?;call(&host,"cancelNavigation")?;
 call(&get(&host,"voice")?,"stop")?;set(&host,"keepSearchHits",&JsValue::FALSE)?;call(&host,"endSearch")?;
 call(&get(&host,"panel")?,"close")?;set(&host,"book",&JsValue::NULL)?;
 set(&get(&host,"returnButton")?,"hidden",&JsValue::TRUE)?;call(&host,"syncReturnLayout")?;
 let screen:Element=get(&host,"screen")?.dyn_into()?;screen.class_list().remove_1("reader-kids-mode")?;
 let panel:Element=get(&host,"panel")?.dyn_into()?;let kids=panel.query_selector("[data-kids]")?.ok_or_else(||JsValue::from_str("Missing kids control"))?;
 kids.set_attribute("aria-pressed","false")?;kids.set_attribute("aria-label","Activar modo infantil")?;Ok(())
}
#[wasm_bindgen]
pub fn reader_show(host:JsValue,tab:JsValue)->Result<(),JsValue>{
 let screen:Element=get(&host,"screen")?.dyn_into()?;
 if screen.get_attribute("aria-busy").as_deref()==Some("true"){return Ok(());}
 one(&host,"showTab",&tab)?;
 if tab==JsValue::from_str("audio"){call(&host,"populateVoices")?;call(&get(&host,"neuralPicker")?,"refresh")?;}
 let panel=get(&host,"panel")?;if !get(&panel,"open")?.is_truthy(){call(&panel,"showModal")?;}
 call(&host,"updateMiniPlayer")?;call(&host,"resizePanel")?;
 let panel:Element=get(&host,"panel")?.dyn_into()?;let button=panel.query_selector("[data-close]")?.ok_or_else(||JsValue::from_str("Missing close control"))?;
 let options=FocusOptions::new();options.set_prevent_scroll(true);button.unchecked_ref::<HtmlElement>().focus_with_options(&options)?;Ok(())
}
