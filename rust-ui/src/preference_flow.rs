//! Preference orchestration retains the existing JS records and engine APIs.
use wasm_bindgen::{prelude::*,JsCast};
use js_sys::{Array,Function,Object,Promise};
use wasm_bindgen_futures::{JsFuture,future_to_promise};
use crate::reader_actions::{get,set,call,one,invoke};
fn options(p:&JsValue)->Result<JsValue,JsValue>{
 let out=Object::new();for name in ["footnotes","multilingual","skipHeaders"]{set(&out,name,&get(p,name)?)?;}Ok(out.into())
}
fn optional(host:&JsValue,name:&str)->Result<(),JsValue>{
 if host.is_null()||host.is_undefined(){return Ok(());}
 let method=get(host,name)?;if method.is_null()||method.is_undefined(){return Ok(());}
 method.dyn_into::<Function>().map_err(|_|JsValue::from(js_sys::TypeError::new("Preference method is not callable")))?.call0(host)?;Ok(())
}
fn optional_host(host:&JsValue,name:&str)->Result<(),JsValue>{
 if !host.is_null()&&!host.is_undefined(){call(host,name)?;}Ok(())
}
#[wasm_bindgen]
pub fn reader_set_preference(host:JsValue,key:String,value:JsValue,restart:bool,normalize:Function,notify:Function)->Result<(),JsValue>{
 let audio=matches!(key.as_str(),"rate"|"voice"|"voiceLang"|"footnotes"|"multilingual"|"skipHeaders");
 if !audio{call(&get(&host,"voice")?,"stop")?;}
 // Object spread and computed own-property semantics remain in normalize.
 let preferences=normalize.call3(&JsValue::UNDEFINED,&get(&host,"preferences")?,&key.clone().into(),&value)?;
 set(&host,"preferences",&preferences)?;one(&host,"applyPreferences",&(!audio).into())?;notify.call0(&JsValue::UNDEFINED)?;
 let voice=get(&host,"voice")?;set(&voice,"options",&options(&get(&host,"preferences")?)?)?;
 if matches!(key.as_str(),"rate"|"voice"|"voiceLang"){optional(&voice,"retryNeural")?;if restart{optional(&voice,"restart")?;}}
 if audio{optional_host(&get(&host,"neuralPicker")?,"warmUp")?;}Ok(())
}
#[wasm_bindgen]
pub fn reader_apply_preferences(host:JsValue,update_book:bool,themes:JsValue,store:Function)->Result<Promise,JsValue>{
 let p=get(&host,"preferences")?;
 let _=store.call1(&JsValue::UNDEFINED,&p);
 let theme=js_sys::Reflect::get(&themes,&get(&p,"theme")?)?;
 let reader=get(&host,"reader")?;let format=get(&reader,"format")?;
 let pdf=!format.is_null()&&!format.is_undefined()&&get(&format,"engine")?==JsValue::from_str("pdf");
 invoke(&get(&host,"view")?,"applyPreferences",&Array::of3(&p,&theme,&pdf.into()))?;
 let voice=get(&host,"voice")?;
 for (source,target) in [("rate","rate"),("voice","voice"),("voiceLang","languageOverride")]{set(&voice,target,&get(&p,source)?)?;}
 optional_host(&get(&host,"neuralPicker")?,"render")?;set(&voice,"options",&options(&p)?)?;
 call(&host,"updateMiniPlayer")?;
 if !update_book{return Ok(Promise::resolve(&JsValue::UNDEFINED));}
 // UI and engine invocation happen before returning, as in the original async
 // JS method. Only the completion of the engine promise is scheduled later.
 let pending=match one(&get(&host,"reader")?,"applyPreferences",&p){
  Ok(value)=>Promise::resolve(&value),
  Err(_)=>{one(&host,"error",&"No se pudo aplicar.".into())?;return Ok(Promise::resolve(&JsValue::UNDEFINED));}
 };
 Ok(future_to_promise(async move{
  let result=JsFuture::from(pending).await;
  if result.is_err(){one(&host,"error",&"No se pudo aplicar.".into())?;}
  Ok(JsValue::UNDEFINED)
 }))
}
