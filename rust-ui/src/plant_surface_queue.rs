//! Surface and saved-model policies. The browser owns texture objects and idle
//! scheduling; Rust decides row budgets, completion, retries, sharing and LRU.
//! State contains ordinary JS handles so callbacks may safely reenter it: no
//! RefCell or wasm-bindgen mutable borrow crosses a painter or redraw callback.
use wasm_bindgen::prelude::*;
use js_sys::{Array,Map,Object,Promise,Set,Uint8Array};
use crate::host::*;
use crate::plant_recipe::{fresh,g,object_tag,p,r,thing,Plain,Thing};
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

fn clone_texture(host:&JsValue,base:&JsValue,name:&str,texture:fn(&Thing)->R<JsValue>)->R<JsValue>{
 let original=r(base,name,texture)?;let version=r(&r(&original,"source",Thing::source)?,"version",Thing::version)?;
 let copy=thing(&original).clone_object()?;thing(&r(&copy,"source",Thing::source)?).set_version(&version)?;
 let clones=r(base,"clones",Thing::clones)?;
 if !absent(&clones){clones.unchecked_ref::<Array>().push(&copy);thing(host).watch_dispose(base,&copy)?;}
 Ok(copy)
}

/// A surface's two textures (pigment map, data map) for one more user: shared images, painted once. `spec` is
/// only asked for when the surface has to be painted.
#[allow(clippy::too_many_arguments)]
pub fn surface_maps(state:&JsValue,host:&JsValue,key:&JsValue,width:u32,height:u32,repeat:bool,spec:&dyn Fn()->JsValue,refresh:&JsValue)->R<(JsValue,JsValue)>{
 let surfaces:Map=g(state,Thing::surfaces).unchecked_into();let mut base=surfaces.get(key);
 let saved=if truthy(&base){JsValue::NULL}else{thing(host).saved_surface(key,width as f64,height as f64)?};
 if truthy(&saved){
  let pigment=r(&saved,"pigment",Thing::pigment)?;let data=r(&saved,"data",Thing::data)?;
  base=new_base(host,&pigment,&data,width,height,repeat,false)?;surfaces.set(key,&base);
 }else if !truthy(&base){
  let pigment:JsValue=Uint8Array::new_with_length(width*height*4).into();let data:JsValue=Uint8Array::new_with_length(width*height*4).into();
  let spec=spec();
  if !truthy(&thing(host).lattice(&spec,width as f64,height as f64,repeat,&pigment,&data)?){return Err(js_sys::Error::new(ERROR).into());}
  base=new_base(host,&pigment,&data,width,height,repeat,true)?;surfaces.set(key,&base);
  let queue:Array=g(state,Thing::queue).unchecked_into();
  let job=fresh();job.set_base(&base);job.set_key(key);job.set_width(width as f64);job.set_height(height as f64);job.set_row(0.0);job.set_spec(&spec);job.set_pigment(&pigment);job.set_data(&data);
  queue.push(job.as_ref());
  if queue.length()==1{thing(host).schedule()?;}
 }
 if truthy(refresh){let waiting=g(&base,Thing::waiting);if !absent(&waiting){waiting.unchecked_ref::<Array>().push(refresh);}}
 let image=clone_texture(host,&base,"map",Thing::map)?;let data=clone_texture(host,&base,"data",Thing::data)?;
 Ok((image,data))
}
#[wasm_bindgen]
pub fn plant_surface(state:&JsValue,host:&JsValue,key:&JsValue,width:u32,height:u32,repeat:bool,spec:&JsValue,refresh:&JsValue)->R<JsValue>{
 let (image,data)=surface_maps(state,host,key,width,height,repeat,&||spec.clone(),refresh)?;
 obj(&[("map",image),("data",data)])
}
fn new_base(host:&JsValue,pigment:&JsValue,data:&JsValue,width:u32,height:u32,repeat:bool,pending:bool)->R<JsValue>{
 let texture=|bytes:&JsValue,color:bool|thing(host).texture(bytes,width as f64,height as f64,color,repeat);
 let base=fresh();base.set_map(&texture(pigment,true)?);base.set_data(&texture(data,false)?);
 base.set_clones(&if pending{Array::new().into()}else{JsValue::NULL});base.set_waiting(&if pending{Array::new().into()}else{JsValue::NULL});
 Ok(base.into())
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
/// `Array.isArray(value) && value.length === length && value.every(Number.isFinite)`, the engine testing the numbers.
fn finite_array(value:&JsValue,length:u32)->bool{Array::is_array(value)&&{let a:&Array=value.unchecked_ref();a.length()==length&&crate::plant_recipe::every_finite(a)}}
fn integer(value:&JsValue)->bool{value.as_f64().is_some_and(|v|v.is_finite()&&v.fract()==0.0)}
/// The names a bake may use, as JavaScript values: a name read from a record is looked up in them by the engine
/// (`KINDS.includes(kind)`, as the original did) instead of being copied into the module to be compared here.
struct BakeNames{kinds:Array,group:JsValue,roles:Array,attributes:Array,indices:Array}
fn names(list:&[&str])->Array{list.iter().map(|name|JsValue::from_str(name)).collect()}
thread_local!{static BAKE_NAMES:BakeNames=BakeNames{kinds:names(&["mesh","lines","group"]),group:JsValue::from_str("group"),
 roles:names(&["clay","soil","leaf","stem","mineral","green","needles"]),
 // `/^(Float32|U?Int(8|16|32))Array$/` and `/^Uint(16|32)Array$/` over `Object.prototype.toString.call(value).slice(8, -1)`.
 attributes:names(&["[object Float32Array]","[object Int8Array]","[object Int16Array]","[object Int32Array]","[object UInt8Array]","[object UInt16Array]","[object UInt32Array]"]),
 indices:names(&["[object Uint16Array]","[object Uint32Array]"])};}
/// `Object.prototype.toString.call(value)`: typed arrays read back from IndexedDB may come from another realm.
fn typed_name(value:&JsValue)->JsValue{object_tag(value).unwrap_or(JsValue::UNDEFINED)}
/// Whether a bake read back from disk can be used: every object's kind, name, transform, place and parent, and for
/// a mesh or lines its role and geometry arrays. Read through declared accessors: this runs once per kept plant
/// at start-up, over every object of its bake.
#[wasm_bindgen]
pub fn plant_valid_bake(bake:&JsValue)->bool{
 let parts=p(bake,Plain::parts);let objects=p(bake,Plain::objects);if !Array::is_array(&parts)||!Array::is_array(&objects){return false;}
 let all:Array=objects.unchecked_into();
 BAKE_NAMES.with(|known|all.iter().all(|object|{
  let kind=p(&object,Plain::kind);
  if !known.kinds.includes(&kind,0)||!p(&object,Plain::name).is_string()||!finite_array(&p(&object,Plain::position),3)||!finite_array(&p(&object,Plain::scale),3)||!finite_array(&p(&object,Plain::quaternion),4)||!integer(&p(&object,Plain::place)){return false;}
  let rotation=p(&object,Plain::rotation);if !Array::is_array(&rotation){return false;}let rotation:Array=rotation.unchecked_into();if !finite_array(&rotation.slice(0,3).into(),3){return false;}
  let parent=p(&object,Plain::parent);
  if parent.as_f64()!=Some(-1.0){
   // `all[parent]`: a number is its own property key.
   let owner=if parent.as_f64().is_some(){js_sys::Reflect::get(all.as_ref(),&parent).unwrap_or(JsValue::UNDEFINED)}else{get(&all,&text_of(&parent))};
   if p(&owner,Plain::kind)!=known.group{return false;}
  }
  if kind==known.group{return true;}
  // The role must be one of the seven strings themselves (the original's `ROLES.includes(role)`).
  if !known.roles.includes(&p(&object,Plain::role),0){return false;}
  let geometry=p(&object,Plain::geometry);let attributes=p(&geometry,Plain::attributes);let position=p(&attributes,Plain::position);if !truthy(&position){return false;}
  let count=num(&p(&get_at(&position,0),Plain::length))/num(&get_at(&position,1));if !count.is_finite()||count.fract()!=0.0{return false;}
  for attribute in Object::values(attributes.unchecked_ref()).iter(){let data=get_at(&attribute,0);let size=get_at(&attribute,1);
   if !known.attributes.includes(&typed_name(&data),0)||!integer(&size)||num(&size)<=0.0||num(&p(&data,Plain::length))!=count*num(&size){return false;}
  }
  let index=p(&geometry,Plain::index);if !index.is_null()&&!known.indices.includes(&typed_name(&index),0){return false;}
  let bounds=p(&geometry,Plain::bounds);Array::is_array(&p(&geometry,Plain::groups))&&(bounds.is_null()||Array::is_array(&bounds)&&bounds.unchecked_ref::<Array>().length()==6)
 }))
}
