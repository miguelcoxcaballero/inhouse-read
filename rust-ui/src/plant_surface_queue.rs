//! Surface and saved-model policies. The browser owns texture objects and idle
//! scheduling; Rust decides row budgets, completion, retries, sharing and LRU.
//! State contains ordinary JS handles so callbacks may safely reenter it: no
//! RefCell or wasm-bindgen mutable borrow crosses a painter or redraw callback.
use wasm_bindgen::prelude::*;
use js_sys::{Array,Map,Object,Promise,Set,Uint8Array};
use crate::host::*;
type R<T> = Result<T,JsValue>;
const ERROR:&str="Las texturas de la planta no se pudieron calcular. Recarga la página.";
fn val(value:f64)->JsValue{value.into()}
fn obj(values:&[(&str,JsValue)])->R<JsValue>{let object=Object::new();for (key,value) in values{set(object.as_ref(),key,value)?;}Ok(object.into())}
fn map(state:&JsValue,name:&str)->Map{get(state,name).unchecked_into()}
fn array(state:&JsValue,name:&str)->Array{get(state,name).unchecked_into()}
fn items(value:&JsValue)->R<Array>{Ok(Array::from(value))}

#[wasm_bindgen]
pub fn plant_surface_state()->R<JsValue>{obj(&[("surfaces",Map::new().into()),("queue",Array::new().into()),("settled",Array::new().into()),("redraws",Set::new(&JsValue::UNDEFINED).into()),("shelfBakes",Map::new().into()),("savedModels",JsValue::NULL)])}

fn paint_rows(host:&JsValue,job:&JsValue,end:f64)->R<()>{
 let spec=read(job,"spec")?;
 let family=num(&read(&spec,"family")?);
 let index=if family==0.0{0}else if family==1.0{1}else if family==2.0{2}else{3};
 let painter=get_at(&read(host,"painters")?,index);
 let result=call(&painter,"plant painter",&[job,&val(end-num(&read(job,"row")?))])?;
 if !truthy(&result){return Err(js_sys::Error::new(ERROR).into());}Ok(())
}

#[wasm_bindgen]
pub fn plant_surface_pump(state:&JsValue,host:&JsValue,deadline:&JsValue)->R<()>{
 if truthy(&method(host,"defer",&[])?){method(host,"schedule",&[])?;return Ok(());}
 let until=clock()?+jmin(16.0,jmax(5.0,num(&method(deadline,"timeRemaining",&[])?)-1.0));
 let queue=array(state,"queue");let surfaces=map(state,"surfaces");let redraws:Set=read(state,"redraws")?.unchecked_into();
 for chunk in 0..48{
  if queue.length()==0 || (chunk>0 && !(clock()?<until)){break;}
  let job=queue.get(0);let height=num(&read(&job,"height")?);
  let end=jmin(height,num(&read(&job,"row")?)+4.0);
  match paint_rows(host,&job,end){
   Ok(())=>set(&job,"row",&val(end))?,
   Err(error)=>{method(host,"warn",&[&error])?;set(&job,"row",&val(height))?;set(&job,"failed",&JsValue::TRUE)?;}
  }
  if num(&read(&job,"row")?)<height{continue;}
  queue.shift();let base=read(&job,"base")?;let key=read(&job,"key")?;
  if truthy(&get(&job,"failed"))&&surfaces.get(&key)==base{surfaces.delete(&key);}
  // Exactly one shared image upload; disposed clones have already left this list.
  set(&read(&read(&base,"data")?,"source")?,"needsUpdate",&JsValue::TRUE)?;
  set(&read(&read(&base,"map")?,"source")?,"needsUpdate",&JsValue::TRUE)?;
  for texture in array(&base,"clones").iter(){set(&texture,"version",&val(num(&read(&texture,"version")?)+1.0))?;}
  for refresh in array(&base,"waiting").iter(){redraws.add(&refresh);}
  set(&base,"clones",&JsValue::NULL)?;set(&base,"waiting",&JsValue::NULL)?;
 }
 if queue.length()>0{method(host,"schedule",&[])?;return Ok(());}
 // Set iteration is live, as in the original: callback additions keep their order.
 for refresh in js_sys::try_iter(redraws.as_ref())?.unwrap(){call(&refresh?,"refresh",&[])?;}
 redraws.clear();
 let settled=array(state,"settled");let pending=method(&settled,"splice",&[&val(0.0)])?;let pending:Array=pending.unchecked_into();
 for resolve in pending.iter(){call(&resolve,"resolve",&[])?;}
 Ok(())
}

#[wasm_bindgen]
pub fn plant_surface_ready(state:&JsValue)->Promise{
 if array(state,"queue").length()==0{return Promise::resolve(&JsValue::UNDEFINED);}
 Promise::new(&mut |resolve,_|{array(state,"settled").push(resolve.as_ref());})
}

#[wasm_bindgen]
pub fn plant_surface_release(base:&JsValue,texture:&JsValue)->R<()>{
 let clones=get(base,"clones");
 if !absent(&clones){let index=num(&method(&clones,"indexOf",&[texture])?);if index>=0.0{method(&clones,"splice",&[&val(index),&val(1.0)])?;}}
 Ok(())
}

fn clone_texture(host:&JsValue,base:&JsValue,name:&str)->R<JsValue>{
 let original=read(base,name)?;let source=read(&original,"source")?;let version=read(&source,"version")?;
 let copy=method(&original,"clone",&[])?;set(&read(&copy,"source")?,"version",&version)?;
 let clones=read(base,"clones")?;
 if !absent(&clones){array(base,"clones").push(&copy);method(host,"watchDispose",&[base,&copy])?;}
 Ok(copy)
}

#[wasm_bindgen]
pub fn plant_surface(state:&JsValue,host:&JsValue,key:&JsValue,width:u32,height:u32,repeat:bool,spec:&JsValue,refresh:&JsValue)->R<JsValue>{
 let surfaces=map(state,"surfaces");let mut base=surfaces.get(key);
 let saved=if truthy(&base){JsValue::NULL}else{method(host,"savedSurface",&[key,&val(width as f64),&val(height as f64)])?};
 if truthy(&saved){
  let pigment=read(&saved,"pigment")?;let data=read(&saved,"data")?;
  base=new_base(host,&pigment,&data,width,height,repeat,false)?;surfaces.set(key,&base);
 }else if !truthy(&base){
  let pigment:JsValue=Uint8Array::new_with_length(width*height*4).into();let data:JsValue=Uint8Array::new_with_length(width*height*4).into();
  if !truthy(&method(host,"lattice",&[spec,&val(width as f64),&val(height as f64),&repeat.into(),&pigment,&data])?){return Err(js_sys::Error::new(ERROR).into());}
  base=new_base(host,&pigment,&data,width,height,repeat,true)?;surfaces.set(key,&base);
  let queue=array(state,"queue");queue.push(&obj(&[("base",base.clone()),("key",key.clone()),("width",val(width as f64)),("height",val(height as f64)),("row",val(0.0)),("spec",spec.clone()),("pigment",pigment),("data",data)])?);
  if queue.length()==1{method(host,"schedule",&[])?;}
 }
 if truthy(refresh)&&!absent(&get(&base,"waiting")){array(&base,"waiting").push(refresh);}
 let image=clone_texture(host,&base,"map")?;let data=clone_texture(host,&base,"data")?;
 obj(&[("map",image),("data",data)])
}
fn new_base(host:&JsValue,pigment:&JsValue,data:&JsValue,width:u32,height:u32,repeat:bool,pending:bool)->R<JsValue>{
 let texture=|bytes:&JsValue,color:bool|method(host,"texture",&[bytes,&val(width as f64),&val(height as f64),&color.into(),&repeat.into()]);
 obj(&[("map",texture(pigment,true)?),("data",texture(data,false)?),("clones",if pending{Array::new().into()}else{JsValue::NULL}),("waiting",if pending{Array::new().into()}else{JsValue::NULL})])
}

#[wasm_bindgen]
pub fn plant_bake_get(state:&JsValue,host:&JsValue,key:&JsValue)->R<JsValue>{
 let entry=map(state,"shelfBakes").get(key);if truthy(&entry){return Ok(entry);}
 let mut saved=get(state,"savedModels");
 if !truthy(&saved){let record=method(host,"loadedShelfBakes",&[])?;if truthy(&record){let models=Map::new();for item in array(&record,"models").iter(){models.set(&get_at(&item,0),&item);}saved=models.into();set(state,"savedModels",&saved)?;}}
 if absent(&saved){return Ok(JsValue::NULL);}
 let models:Map=saved.unchecked_into();let item=models.get(key);models.delete(key);
 let bake=get_at(&item,1);
 if truthy(&item)&&plant_valid_bake(&bake){obj(&[("bake",bake),("surfaces",JsValue::NULL)])}else{Ok(JsValue::NULL)}
}
#[wasm_bindgen]
pub fn plant_bake_remember(state:&JsValue,host:&JsValue,key:&JsValue,entry:&JsValue)->R<()>{
 let bakes=map(state,"shelfBakes");bakes.delete(key);bakes.set(key,entry);
 while bakes.size()>12{let first=bakes.keys().next()?.value();bakes.delete(&first);}
 method(host,"scheduleShelfBakeWrite",&[])?;Ok(())
}
#[wasm_bindgen]
pub fn plant_bake_current(state:&JsValue,key:&JsValue,entry:&JsValue)->bool{map(state,"shelfBakes").get(key)==*entry}
#[wasm_bindgen]
pub fn plant_bake_record(state:&JsValue)->R<JsValue>{
 let models=Array::new();let painted=Map::new();let surfaces=map(state,"surfaces");
 for item in js_sys::try_iter(map(state,"shelfBakes").as_ref())?.unwrap(){
  let item=item?;let key=get_at(&item,0);let entry=get_at(&item,1);let keys=items(&read(&entry,"surfaces")?)?;
  let model=Array::new();model.push(&key);model.push(&read(&entry,"bake")?);model.push(&keys);models.push(&model);
  for key in keys.iter(){let base=surfaces.get(&key);if truthy(&base)&&!truthy(&get(&base,"clones"))&&!painted.has(&key){
   let image=read(&read(&base,"map")?,"image")?;let data=read(&read(&base,"data")?,"image")?;
   painted.set(&key,&obj(&[("width",read(&image,"width")?),("height",read(&image,"height")?),("pigment",read(&image,"data")?),("data",read(&data,"data")?)])?);
  }}
 }
 obj(&[("models",models.into()),("surfaces",Array::from(painted.as_ref()).into())])
}
fn finite_array(value:&JsValue,length:u32)->bool{Array::is_array(value)&&{let a:Array=value.clone().unchecked_into();a.length()==length&&a.iter().all(|v|finite(&v))}}
fn integer(value:&JsValue)->bool{value.as_f64().is_some_and(|v|v.is_finite()&&v.fract()==0.0)}
fn typed_name(value:&JsValue)->String{
 let prototype=get(&get(&global(),"Object"),"prototype");let to_string=get(&prototype,"toString");
 method(&to_string,"call",&[value]).ok().map(|v|text_of(&v)).unwrap_or_default()
}
#[wasm_bindgen]
pub fn plant_valid_bake(bake:&JsValue)->bool{
 let parts=get(bake,"parts");let objects=get(bake,"objects");if !Array::is_array(&parts)||!Array::is_array(&objects){return false;}
 let all:Array=objects.unchecked_into();
 all.iter().all(|object|{
  let kind=get(&object,"kind");let kind=kind.as_string().unwrap_or_default();
  if !["mesh","lines","group"].contains(&kind.as_str())||get(&object,"name").as_string().is_none()||!finite_array(&get(&object,"position"),3)||!finite_array(&get(&object,"scale"),3)||!finite_array(&get(&object,"quaternion"),4)||!integer(&get(&object,"place")){return false;}
  let rotation=get(&object,"rotation");if !Array::is_array(&rotation){return false;}let rotation:Array=rotation.unchecked_into();if !finite_array(&rotation.slice(0,3).into(),3){return false;}
  let parent=get(&object,"parent");if parent.as_f64()!=Some(-1.0)&&!text(&get(&get(&all,&text_of(&parent)),"kind"),"group"){return false;}
  if kind=="group"{return true;}
  if !["clay","soil","leaf","stem","mineral","green","needles"].contains(&text_of(&get(&object,"role")).as_str()){return false;}
  let geometry=get(&object,"geometry");let attributes=get(&geometry,"attributes");let position=get(&attributes,"position");if !truthy(&position){return false;}
  let count=num(&get(&get_at(&position,0),"length"))/num(&get_at(&position,1));if !count.is_finite()||count.fract()!=0.0{return false;}
  let Ok(entries)=method(&get(&global(),"Object"),"values",&[&attributes])else{return false;};
  for attribute in Array::from(&entries).iter(){let data=get_at(&attribute,0);let size=get_at(&attribute,1);let name=typed_name(&data);
   if !["[object Float32Array]","[object Int8Array]","[object Int16Array]","[object Int32Array]","[object UInt8Array]","[object UInt16Array]","[object UInt32Array]"].contains(&name.as_str())||!integer(&size)||num(&size)<=0.0||num(&get(&data,"length"))!=count*num(&size){return false;}
  }
  let index=get(&geometry,"index");if !index.is_null()&&!["[object Uint16Array]","[object Uint32Array]"].contains(&typed_name(&index).as_str()){return false;}
  let bounds=get(&geometry,"box");Array::is_array(&get(&geometry,"groups"))&&(bounds.is_null()||Array::is_array(&bounds)&&num(&get(&bounds,"length"))==6.0)
 })
}
