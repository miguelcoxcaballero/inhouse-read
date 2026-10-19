//! Plant appearance and inspection lifecycle. Numeric descriptions and state
//! transitions live here; the host only binds Three objects and callbacks.
use wasm_bindgen::prelude::*;
use js_sys::{Array,Float64Array,JsString,Object,Promise,Set,Uint16Array};
use crate::host::*;
type R<T>=Result<T,JsValue>;
fn obj(fields:&[(&str,JsValue)])->R<JsValue>{let value=Object::new();for(key,item)in fields{set(value.as_ref(),key,item)?;}Ok(value.into())}
fn v(n:f64)->JsValue{n.into()}
fn s(text:&str)->JsValue{text.into()}
fn list(values:&[f64])->JsValue{Float64Array::from(values).into()}
fn or(value:JsValue,other:JsValue)->JsValue{if truthy(&value){value}else{other}}
fn variant(value:&JsValue)->R<String>{
 let value=or(value.clone(),s("leafy"));let lower=JsString::from(method(&global(),"String",&[&value])?).to_lower_case();let name=lower.as_string().unwrap_or_default();
 Ok(if name.contains("cactus"){"cactus"}else if name.contains("monstera"){"monstera"}else if name=="upright"||name.contains("sansevieria"){"upright"}else if name.contains("succulent")||name.contains("suculenta"){"succulent"}else if name.contains("chamaedorea")||name=="palm"{"palm"}else if name.contains("nephrolepis")||name=="fern"{"fern"}else if name.contains("hedera")||name=="ivy"{"ivy"}else if name.contains("zamioculcas")||name=="zz"{"zz"}else{"leafy"}.into())
}
fn seed_units(seed:&JsValue)->R<Vec<u16>>{let text=JsString::from(method(&global(),"String",&[seed])?);Ok((0..text.length()).map(|i|text.char_code_at(i) as u16).collect())}
fn rgb(hex:&str)->[f64;3]{let n=u32::from_str_radix(hex.strip_prefix('#').unwrap_or(hex),16).unwrap_or(0);[((n>>16)&255)as f64/255.0,((n>>8)&255)as f64/255.0,(n&255)as f64/255.0]}
fn hash(x:u32,y:u32,seed:u32)->f64{let mut h=x.wrapping_mul(0x27d4eb2d)^y.wrapping_mul(0x165667b1)^seed.wrapping_mul(0x9e3779b1);h=(h^(h>>15)).wrapping_mul(0x85ebca6b);h=(h^(h>>13)).wrapping_mul(0xc2b2ae35);(h^(h>>16))as f64/4294967296.0}
fn descriptor(key:String,width:f64,height:f64,repeat:bool,family:f64,kind:f64,config:Option<&[f64]>)->R<JsValue>{
 let spec=obj(&[("family",v(family)),("kind",v(kind))])?;if let Some(config)=config{set(&spec,"config",&list(config))?;}
 obj(&[("key",s(&key)),("width",v(width)),("height",v(height)),("repeat",repeat.into()),("spec",spec)])
}
#[wasm_bindgen]
pub fn plant_leaf_surface(variant:&str,level:f64)->R<JsValue>{
 let key=format!("leaf:{variant}:{}",number_string(level));
 if variant=="upright"{return descriptor(key,128.0*level,256.0*level,false,3.0,3.0,Some(&[0.0;5]));}
 let color=match variant{"zz"=>"#2f5324","fern"=>"#4a7a2c","succulent"=>"#6a8a80","ivy"=>"#2a4c23","palm"=>"#3d6c2a","monstera"=>"#2f6128",_=>"#36672c"};
 let mut config=rgb(color).to_vec();let text=JsString::from(variant);config.extend([hash(text.length(),3,11)*std::f64::consts::PI*2.0,text.char_code_at(0)]);
 descriptor(key,128.0*level,128.0*level,false,3.0,if variant=="ivy"{1.0}else if variant=="succulent"{2.0}else{0.0},Some(&config))
}
#[wasm_bindgen]
pub fn plant_pot_key(pot:&JsValue,color:&str,clay:&str,level:f64)->String{format!("pot:{}:{}:{}",text_of(pot),if truthy(pot){color}else{clay},number_string(level))}
#[wasm_bindgen]
pub fn plant_pot_surface(pot:&JsValue,model:&str,color:&str,clay:&str,level:f64)->R<JsValue>{
 let key=plant_pot_key(pot,color,clay,level);let mut config=rgb(if truthy(pot){color}else{clay}).to_vec();let (family,kind)=match model{
  "muskot"|"gradvis"=>{config=rgb(color).to_vec();config.extend(rgb(if model=="muskot"{"#cfbea3"}else{"#c7a291"}));config.extend(if model=="muskot"{[0.24,0.0022,0.55,17.0]}else{[0.42,0.004,0.0,29.0]});(0.0,0.0)},
  "akerbar"=>{config=rgb(color).to_vec();config.push(41.0);(1.0,1.0)},
  _=>{config.push(53.0);(1.0,0.0)}
 };
 descriptor(key,128.0*level,256.0*level,true,family,kind,Some(&config))
}
#[wasm_bindgen]
pub fn plant_soil_surface(kind:&str,level:f64)->R<JsValue>{descriptor(format!("soil:{kind}:{}",number_string(level)),128.0*level,128.0*level,false,2.0,if kind=="grit"{1.0}else{0.0},None)}
#[wasm_bindgen]
pub fn plant_finish_material(model:&str)->R<JsValue>{match model{
 "muskot"=>obj(&[("clearcoat",v(0.42)),("clearcoatRoughness",v(0.16)),("bumpScale",v(0.55))]),
 "gradvis"=>obj(&[("clearcoat",v(0.2)),("clearcoatRoughness",v(0.42)),("bumpScale",v(0.45))]),
 "akerbar"=>obj(&[("metalness",v(0.85)),("bumpScale",v(0.3))]),_=>obj(&[("bumpScale",v(0.4))])
}}
#[wasm_bindgen]
pub fn plant_leaf_material(variant:&str,width:f64)->R<JsValue>{obj(&[
 ("color",v(16777215.0)),("vertexColors",JsValue::TRUE),("bumpScale",v(width*if variant=="succulent"{0.00035}else{0.0012})),
 ("sheen",v(if variant=="succulent"{0.25}else if variant=="ivy"{0.0}else{0.08})),("sheenColor",s("#acc394")),("sheenRoughness",v(0.85)),
 ("alphaTest",v(0.0)),("alphaToCoverage",JsValue::FALSE),("specularIntensity",v(if variant=="ivy"{0.1}else{0.6})),
 ("roughness",v(match variant{"zz"=>0.55,"ivy"=>0.66,"succulent"=>0.88,_=>0.85})),("metalness",v(0.0)),
 ("clearcoat",v(match variant{"zz"=>0.32,"ivy"=>0.1,"succulent"=>0.035,_=>0.12})),("clearcoatRoughness",v(if variant=="ivy"{0.3}else{0.48}))])}
#[wasm_bindgen]
pub fn plant_appearance(entry:&JsValue,geometry:&JsValue,pot_color:&JsValue,persist:bool)->R<JsValue>{
 let catalog=get(geometry,"catalogPlant");let pot=get(geometry,"potId");let real=get(geometry,"real");let unit=num(&get(geometry,"unit"));let height=get(geometry,"height");
 let catalog_variant=get(&catalog,"variant");let name=variant(&if truthy(&catalog_variant){catalog_variant}else{read(entry,"variant")?})?;
 let first=read(entry,"seed")?;let seed=if !absent(&first){first}else{
  let key=read(entry,"key")?;if !absent(&key){key}else{let node=read(entry,"node")?;let id=if absent(&node){JsValue::UNDEFINED}else{read(&read(&node,"dataset")?,"objectId")?};if absent(&id){s(&name)}else{id}}
 };
 let units=seed_units(&seed)?;let skip=if truthy(&pot){1}else{2};let drawn=crate::plant_random(&units,skip);
 let clay=if truthy(&pot){text_of(&get(pot_color,"hex"))}else{["#a97958","#b18b6c","#bcad94","#826d60"][(drawn[0]*4.0).floor() as usize].into()};
 let width=num(&get(&real,"canopy"))*unit;let radius=num(&get(&real,"potDiameter"))/2.0*unit;let pot_height=num(&get(&real,"potHeight"))*unit;
 let detailed=truthy(&catalog)||truthy(&pot)||["palm","fern","ivy","zz"].contains(&name.as_str());
 let soil=if name=="cactus"||name=="succulent"{"grit"}else{"peat"};
 let bake_key=if persist{let values=Array::new();values.push(&read(&catalog,"id")?);values.push(&s(&name));values.push(&pot);values.push(&method(&global(),"String",&[&seed])?);values.push(&height);js_sys::JSON::stringify(values.as_ref())?.into()}else{JsValue::NULL};
 obj(&[("variant",s(&name)),("seed",method(&global(),"String",&[&seed])?),("units",Uint16Array::from(units.as_slice()).into()),("skip",v(skip as f64)),("quality",v(if truthy(&read(entry,"inspectionResolution")?){2.0}else{1.0})),("width",v(width)),("radius",v(radius)),("potHeight",v(pot_height)),("detailed",detailed.into()),("clayColor",s(&clay)),("soilKind",s(soil)),("bakeKey",bake_key),("offset",v(drawn[if truthy(&pot){0}else{1}])),("repeat",v(jmax(1.0,js_round(std::f64::consts::PI*4.0*radius*(0.6-0.07)/pot_height))))])
}
#[wasm_bindgen]
pub fn plant_surface_keys(pot_key:&str,detailed:bool,variant:&str,soil:&str)->Set{let keys=Set::new(&JsValue::UNDEFINED);keys.add(&s(pot_key));if detailed{keys.add(&s(&format!("leaf:{variant}:1")));}keys.add(&s(&format!("soil:{soil}:1")));keys}
#[wasm_bindgen]
pub fn plant_extra_materials(baked:&JsValue,variant:&str)->u32{
 if !truthy(baked){return if variant=="cactus"{3}else{0};}
 let mut bits=0;for object in Array::from(&get(&get(baked,"bake"),"objects")).iter(){match get(&object,"role").as_string().as_deref(){Some("green")=>bits|=1,Some("needles")=>bits|=2,_=>{}}}bits
}

// All state is GC-owned. Every callback binding simply calls one native action.
#[wasm_bindgen]
pub fn plant_lifecycle_state(pot_color:&JsValue,textures:&JsValue,materials:&JsValue,geometries:&JsValue)->R<JsValue>{obj(&[("disposed",JsValue::FALSE),("pendingQuality",JsValue::NULL),("potColor",pot_color.clone()),("textures",textures.clone()),("materials",materials.clone()),("geometries",geometries.clone())])}
#[wasm_bindgen]
pub fn plant_own_maps(state:&JsValue,maps:&JsValue)->R<JsValue>{for texture in Object::values(&maps.clone().unchecked_into()).iter(){method(&read(state,"textures")?,"add",&[&texture])?;}Ok(maps.clone())}
fn host(state:&JsValue)->R<JsValue>{read(state,"host")}
fn userdata(state:&JsValue)->R<JsValue>{read(&read(&host(state)?,"group")?,"userData")}
#[wasm_bindgen]
pub fn plant_refresh(state:&JsValue)->R<()>{if !truthy(&read(state,"disposed")?){method_opt(&userdata(state)?,"invalidate",&[])?;}Ok(())}
fn replace_maps(state:&JsValue,material:&JsValue,maps:&JsValue)->R<()>{
 let previous=[read(material,"map")?,read(material,"bumpMap")?];let textures=read(state,"textures")?;
 for (key,before) in ["map","data"].iter().zip(previous.iter()){
  let after=read(maps,key)?;
  for property in ["offset","repeat","center","matrix"]{method(&read(&after,property)?,"copy",&[&read(before,property)?])?;}
  for property in ["rotation","matrixAutoUpdate","wrapS","wrapT","magFilter","minFilter","anisotropy","channel","flipY","premultiplyAlpha","unpackAlignment"]{set(&after,property,&read(before,property)?)?;}
  method(&textures,"add",&[&after])?;
 }
 set(material,"map",&read(maps,"map")?)?;set(material,"roughnessMap",&read(maps,"data")?)?;set(material,"bumpMap",&read(maps,"data")?)?;
 for before in previous{method(&textures,"delete",&[&before])?;method(&before,"dispose",&[])?;}Ok(())
}
fn dispose_maps(prepared:&Array)->R<()>{for item in prepared.iter(){for map in Object::values(&read(&item,"maps")?.unchecked_into()).iter(){method(&map,"dispose",&[])?;}}Ok(())}
#[wasm_bindgen]
pub fn plant_quality_dispose(state:&JsValue,plan:&JsValue)->R<()>{
 if truthy(&read(plan,"released")?){return Ok(());}set(plan,"released",&JsValue::TRUE)?;dispose_maps(&read(plan,"prepared")?.unchecked_into())?;
 if read(state,"pendingQuality")?==*plan{set(state,"pendingQuality",&JsValue::NULL)?;}Ok(())
}
fn cancel_quality(state:&JsValue)->R<()>{let pending=read(state,"pendingQuality")?;if !absent(&pending){plant_quality_dispose(state,&pending)?;}Ok(())}
#[wasm_bindgen]
pub fn plant_quality_ready(state:&JsValue,plan:&JsValue)->R<bool>{let ready=!truthy(&read(state,"disposed")?)&&!truthy(&read(plan,"released")?)&&read(state,"pendingQuality")?==*plan;set(plan,"ready",&ready.into())?;Ok(ready)}
#[wasm_bindgen]
pub fn plant_quality_apply(state:&JsValue,plan:&JsValue)->R<bool>{
 if truthy(&read(state,"disposed")?)||truthy(&read(plan,"released")?)||!truthy(&read(plan,"ready")?)||read(state,"pendingQuality")?!=*plan{return Ok(false);}
 for item in Array::from(&read(plan,"prepared")?).iter(){replace_maps(state,&read(&item,"material")?,&read(&item,"maps")?)?;}
 set(&userdata(state)?,"inspectionResolution",&or(read(plan,"resolution")?,v(0.0)))?;set(plan,"released",&JsValue::TRUE)?;set(state,"pendingQuality",&JsValue::NULL)?;Ok(true)
}
#[wasm_bindgen]
pub fn plant_prepare_quality(state:&JsValue,resolution:&JsValue)->R<JsValue>{
 cancel_quality(state)?;let host=host(state)?;let disposed=truthy(&read(state,"disposed")?);let prepared=Array::new();
 if !disposed{
  let result=(||->R<()>{for binding in Array::from(&read(&host,"surfaceBindings")?).iter(){let maps=method(&binding,"create",&[&v(if truthy(resolution){2.0}else{1.0})])?;prepared.push(&obj(&[("material",read(&binding,"material")?),("maps",maps)])?);}Ok(())})();
  if let Err(error)=result{dispose_maps(&prepared)?;return Err(error);}
 }
 let plan=obj(&[("prepared",prepared.into()),("released",disposed.into()),("ready",JsValue::FALSE),("resolution",resolution.clone())])?;
 let public=method(&host,"makePlan",&[&plan])?;
 if disposed{set(&public,"ready",Promise::resolve(&JsValue::FALSE).as_ref())?;}else{
  set(state,"pendingQuality",&plan)?;let callback=method(&host,"readyPlan",&[&plan])?;let ready=method(&method(&host,"surfacesReady",&[])?,"then",&[&callback])?;set(&public,"ready",&ready)?;
 }Ok(public)
}
#[wasm_bindgen]
pub fn plant_update_pot_color(state:&JsValue,color_id:&JsValue)->R<bool>{
 let host=host(state)?;let pot=read(&host,"potId")?;if truthy(&read(state,"disposed")?)||!truthy(&pot){return Ok(false);}
 let next=method(&host,"getPotColor",&[&pot,color_id])?;if read(&next,"id")?==read(&read(state,"potColor")?,"id")?{return Ok(true);}
 let maps=method(&host,"potSurface",&[&v(if truthy(&read(&userdata(state)?,"inspectionResolution")?){2.0}else{1.0}),&read(&host,"refresh")?,&next])?;
 cancel_quality(state)?;replace_maps(state,&read(&host,"clay")?,&maps)?;set(state,"potColor",&next)?;set(&userdata(state)?,"potColorId",&read(&next,"id")?)?;
 let entry=read(&host,"shelfEntry")?;if truthy(&entry)&&truthy(&method(&host,"bakeCurrent",&[])?) {set(&entry,"surfaces",&method(&host,"levelOneSurfaces",&[])?)?;method(&host,"scheduleShelfBakeWrite",&[])?;}
 plant_refresh(state)?;Ok(true)
}
#[wasm_bindgen]
pub fn plant_dispose(state:&JsValue)->R<()>{
 if truthy(&read(state,"disposed")?){return Ok(());}set(state,"disposed",&JsValue::TRUE)?;cancel_quality(state)?;
 for key in ["geometries","materials","textures"]{for item in js_sys::try_iter(&read(state,key)?)?.unwrap(){method(&item?,"dispose",&[])?;}}Ok(())
}
#[wasm_bindgen]
pub fn plant_dispose_unused(state:&JsValue,materials:&Array)->R<()>{for material in materials.iter(){if !truthy(&method(&read(state,"materials")?,"has",&[&material])?){method(&material,"dispose",&[])?;}}Ok(())}
