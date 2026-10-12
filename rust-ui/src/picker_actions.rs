//! User-requested voice downloads, selection, cancellation and shared removal.
//! Browser promises remain with the host; no download begins without a user action.
use wasm_bindgen::{prelude::*,JsCast};
use js_sys::{Array,Function,Object,Promise};
use crate::reader_actions::{get,set,call,one,two,invoke};
fn absent(v:&JsValue)->bool{v.is_null()||v.is_undefined()}
fn optional(v:&JsValue,k:&str)->Result<JsValue,JsValue>{if absent(v){Ok(JsValue::UNDEFINED)}else{get(v,k)}}
fn maybe(v:&JsValue,k:&str,args:&Array)->Result<JsValue,JsValue>{let f=optional(v,k)?;if absent(&f){Ok(JsValue::UNDEFINED)}else{f.dyn_into::<Function>().map_err(|_|JsValue::from(js_sys::TypeError::new("Voice action is not callable")))?.apply(v,args)}}
fn object(values:&[(&str,JsValue)])->Result<Object,JsValue>{let v=Object::new();for(k,x)in values{set(&v,k,x)?;}Ok(v)}
fn find(list:&Array,id:&JsValue)->Result<JsValue,JsValue>{for v in list.iter(){if get(&v,"id")?==*id{return Ok(v);}}Ok(JsValue::UNDEFINED)}
fn list(f:&Function)->Result<Array,JsValue>{f.call0(&JsValue::UNDEFINED)?.dyn_into().map_err(|_|JsValue::from(js_sys::TypeError::new("Voice list is not an array")))}
fn text(v:&JsValue)->Result<String,JsValue>{Ok(string(v)?.as_string().unwrap_or_default())}
fn announce(host:&JsValue,message:String)->Result<(),JsValue>{one(host,"announce",&message.into())?;Ok(())}
fn unlock(engine:&JsValue){let _=object(&[("playback",JsValue::FALSE)]).and_then(|v|maybe(engine,"unlock",&Array::of1(&v)).map(|_|()));}
#[wasm_bindgen]extern "C"{#[wasm_bindgen(catch,js_name=String)]fn string(v:&JsValue)->Result<JsValue,JsValue>;}
#[wasm_bindgen]
pub fn picker_click(host:JsValue,event:JsValue)->Result<(),JsValue>{
 let target=maybe(&get(&event,"target")?,"closest",&Array::of1(&"[data-neural-action]".into()))?;
 if !target.is_truthy(){return Ok(());}let data=get(&target,"dataset")?;let action=get(&data,"neuralAction")?;let id=get(&data,"neuralId")?;
 for name in ["install","cancel","use","remove"]{if action==JsValue::from_str(name){one(&host,name,&id)?;return Ok(());}}
 if action==JsValue::from_str("dismiss"){call(&host,"dismiss")?;}Ok(())
}
#[wasm_bindgen]
pub fn picker_cancel(host:JsValue,id:JsValue,engine:Function)->Result<(),JsValue>{
 maybe(&one(&get(&host,"tasks")?,"get",&id)?,"abort",&Array::new())?;
 let _=engine.call0(&JsValue::UNDEFINED).and_then(|e|maybe(&e,"cancel",&Array::of1(&id)));Ok(())
}
#[wasm_bindgen]
pub fn picker_voice_name(id:JsValue,voices:Function)->Result<JsValue,JsValue>{let name=optional(&find(&list(&voices)?,&id)?,"name")?;Ok(if name.is_truthy(){name}else{"natural".into()})}
#[wasm_bindgen]
pub fn picker_install_begin(host:JsValue,id:JsValue,engine:Function,valid:Function,controller:Function)->Result<JsValue,JsValue>{
 let engine=engine.call0(&JsValue::UNDEFINED)?;
 if !engine.is_truthy()||one(&get(&host,"tasks")?,"has",&id)?.is_truthy()||!valid.call1(&JsValue::UNDEFINED,&id)?.is_truthy(){return Ok(JsValue::NULL);}
 unlock(&engine);let controller=controller.call0(&JsValue::UNDEFINED)?;let name=one(&host,"voiceName",&id)?;
 two(&get(&host,"tasks")?,"set",&id,&controller)?;one(&get(&host,"errors")?,"delete",&id)?;
 announce(&host,format!("Descargando {}.",text(&name)?))?;
 let task=match object(&[("signal",get(&controller,"signal")?)]).and_then(|options|two(&engine,"install",&id,&options.into())){Ok(v)=>v,Err(e)=>Promise::reject(&e).into()};
 call(&host,"render")?;Ok(object(&[("controller",controller),("name",name),("task",task)])?.into())
}
#[wasm_bindgen]
pub fn picker_install_done(host:JsValue,id:JsValue,context:JsValue,declared:Function,base:Function,voices:Function)->Result<(),JsValue>{
 one(&get(&host,"tasks")?,"delete",&id)?;let owner=get(&host,"host")?;
 let declared=declared.call1(&JsValue::UNDEFINED,&get(&owner,"reader")?)?;
 let language=base.call1(&JsValue::UNDEFINED,&optional(&find(&list(&voices)?,&id)?,"lang")?)?;
 let picked=get(&get(&owner,"preferences")?,"voiceLang")?;
 let here=if picked.is_truthy(){language==picked}else{!declared.is_truthy()||language==base.call1(&JsValue::UNDEFINED,&declared)?};
 announce(&host,format!("Voz {} instalada{}.",text(&get(&context,"name")?)?,if here{" y seleccionada"}else{""}))?;
 if here{invoke(&owner,"setPreference",&Array::of3(&"voice".into(),&id,&object(&[("restart",JsValue::FALSE)])?.into()))?;}
 call(&owner,"populateVoices")?;Ok(())
}
#[wasm_bindgen]
pub fn picker_install_error(host:JsValue,id:JsValue,context:JsValue,error:JsValue,messages:JsValue)->Result<(),JsValue>{
 one(&get(&host,"tasks")?,"delete",&id)?;
 if optional(&error,"code")?==JsValue::from_str("aborted")||get(&get(&get(&context,"controller")?,"signal")?,"aborted")?.is_truthy(){announce(&host,"Descarga cancelada.".into())?;}
 else{let code=optional(&error,"code")?;let message=js_sys::Reflect::get(&messages,&code)?;let message=if message.is_truthy(){message}else{get(&messages,"default")?};two(&get(&host,"errors")?,"set",&id,&message)?;announce(&host,format!("No se pudo descargar {}. {}",text(&get(&context,"name")?)?,text(&message)?))?;}
 call(&host,"render")?;Ok(())
}
#[wasm_bindgen]
pub fn picker_use(host:JsValue,id:JsValue,engine:Function)->Result<(),JsValue>{
 if let Ok(engine)=engine.call0(&JsValue::UNDEFINED){unlock(&engine);}
 let owner=get(&host,"host")?;two(&owner,"setPreference",&"voice".into(),&id)?;
 announce(&host,format!("Voz {} seleccionada.",text(&one(&host,"voiceName",&id)?)?))?;call(&owner,"populateVoices")?;Ok(())
}
#[wasm_bindgen]
pub fn picker_remove_begin(host:JsValue,id:JsValue,engine:Function,voices:Function)->Result<JsValue,JsValue>{
 let engine=engine.call0(&JsValue::UNDEFINED)?;let name=one(&host,"voiceName",&id)?;if !engine.is_truthy(){return Ok(JsValue::NULL);}
 let voices=list(&voices)?;let voice=find(&voices,&id)?;let shared=optional(&voice,"sharedPack")?.is_truthy();
 let removed=if shared{let found=Array::new();for candidate in voices.iter(){if get(&candidate,"modelKey")?==get(&voice,"modelKey")?{found.push(&get(&candidate,"id")?);}}found}else{Array::of1(&id)};
 let owner=get(&host,"host")?;
 if removed.includes(&get(&get(&owner,"preferences")?,"voice")?,0){invoke(&owner,"setPreference",&Array::of3(&"voice".into(),&"".into(),&object(&[("restart",JsValue::FALSE)])?.into()))?;}
 for removed in removed.iter(){maybe(&get(&owner,"voice")?,"voiceRemoved",&Array::of1(&removed))?;}
 Ok(object(&[("engine",engine),("name",name),("voice",voice)])?.into())
}
#[wasm_bindgen]
pub fn picker_remove_done(host:JsValue,id:JsValue,context:JsValue)->Result<(),JsValue>{
 one(&get(&host,"errors")?,"delete",&id)?;
 let message=if optional(&get(&context,"voice")?,"sharedPack")?.is_truthy(){"Paquete compartido Supertonic quitado.".into()}else{format!("Voz {} quitada.",text(&get(&context,"name")?)?)};
 announce(&host,message)?;call(&get(&host,"host")?,"populateVoices")?;Ok(())
}
