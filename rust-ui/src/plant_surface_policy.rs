//! Plant appearance and inspection lifecycle. Numeric descriptions and state
//! transitions live here; the host only binds Three objects and callbacks.
use wasm_bindgen::prelude::*;
use js_sys::{Array,Float64Array,JsString,Object,Promise,Set,Uint16Array};
use crate::host::*;
use crate::plant_recipe::{g,r,Thing};
type R<T>=Result<T,JsValue>;
fn obj(fields:&[(&str,JsValue)])->R<JsValue>{let value=Object::new();for(key,item)in fields{set(value.as_ref(),key,item)?;}Ok(value.into())}
fn v(n:f64)->JsValue{n.into()}
fn s(text:&str)->JsValue{text.into()}
fn list(values:&[f64])->JsValue{Float64Array::from(values).into()}
fn or(value:JsValue,other:JsValue)->JsValue{if truthy(&value){value}else{other}}
fn variant(value:&JsValue)->R<String>{
 let value=or(value.clone(),s("leafy"));
 // An ASCII string lowers the same here as in the engine; anything else is the engine's `String(value).toLowerCase()`.
 let name=match value.as_string(){Some(text) if text.is_ascii()=>text.to_ascii_lowercase(),
  _=>JsString::from(method(&global(),"String",&[&value])?).to_lower_case().as_string().unwrap_or_default()};
 Ok(if name.contains("cactus"){"cactus"}else if name.contains("monstera"){"monstera"}else if name=="upright"||name.contains("sansevieria"){"upright"}else if name.contains("succulent")||name.contains("suculenta"){"succulent"}else if name.contains("chamaedorea")||name=="palm"{"palm"}else if name.contains("nephrolepis")||name=="fern"{"fern"}else if name.contains("hedera")||name=="ivy"{"ivy"}else if name.contains("zamioculcas")||name=="zz"{"zz"}else{"leafy"}.into())
}
fn seed_units(seed:&JsValue)->R<Vec<u16>>{let text=JsString::from(method(&global(),"String",&[seed])?);Ok((0..text.length()).map(|i|text.char_code_at(i) as u16).collect())}
fn rgb(hex:&str)->[f64;3]{let n=u32::from_str_radix(hex.strip_prefix('#').unwrap_or(hex),16).unwrap_or(0);[((n>>16)&255)as f64/255.0,((n>>8)&255)as f64/255.0,(n&255)as f64/255.0]}
fn hash(x:u32,y:u32,seed:u32)->f64{let mut h=x.wrapping_mul(0x27d4eb2d)^y.wrapping_mul(0x165667b1)^seed.wrapping_mul(0x9e3779b1);h=(h^(h>>15)).wrapping_mul(0x85ebca6b);h=(h^(h>>13)).wrapping_mul(0xc2b2ae35);(h^(h>>16))as f64/4294967296.0}
/// A surface as the paint queue wants it: its key, raster size and what to paint.
pub struct Surface{pub key:String,pub width:f64,pub height:f64,pub repeat:bool,pub family:f64,pub kind:f64,pub config:Option<Vec<f64>>}
fn descriptor(plan:Surface)->R<JsValue>{
 let spec=obj(&[("family",v(plan.family)),("kind",v(plan.kind))])?;if let Some(config)=&plan.config{set(&spec,"config",&list(config))?;}
 obj(&[("key",s(&plan.key)),("width",v(plan.width)),("height",v(plan.height)),("repeat",plan.repeat.into()),("spec",spec)])
}
/// `String(level)`: a whole level prints as its digits; anything else as the engine prints it.
fn level_text(level:f64)->String{if level.fract()==0.0&&level.abs()<1e15{format!("{}",level as i64)}else{number_string(level)}}
pub fn leaf_plan(variant:&str,level:f64)->Surface{
 let key=format!("leaf:{variant}:{}",level_text(level));
 let plan=|width:f64,height:f64,kind:f64,config:Vec<f64>|Surface{key:key.clone(),width,height,repeat:false,family:3.0,kind,config:Some(config)};
 if variant=="upright"{return plan(128.0*level,256.0*level,3.0,vec![0.0;5]);}
 let color=match variant{"zz"=>"#2f5324","fern"=>"#4a7a2c","succulent"=>"#6a8a80","ivy"=>"#2a4c23","palm"=>"#3d6c2a","monstera"=>"#2f6128",_=>"#36672c"};
 // `variant.length` and `variant.charCodeAt(0)` (NaN for an empty name), in UTF-16 units.
 let units:Vec<u16>=variant.encode_utf16().collect();let mut config=rgb(color).to_vec();
 config.extend([hash(units.len() as u32,3,11)*std::f64::consts::PI*2.0,units.first().map_or(f64::NAN,|unit|f64::from(*unit))]);
 plan(128.0*level,128.0*level,if variant=="ivy"{1.0}else if variant=="succulent"{2.0}else{0.0},config)
}
#[wasm_bindgen]
pub fn plant_leaf_surface(variant:&str,level:f64)->R<JsValue>{descriptor(leaf_plan(variant,level))}
/// `pot:${pot}:${pot ? color : clay}:${level}`.
pub fn pot_key_text(pot:&JsValue,color:&str,clay:&str,level:f64)->String{
 let name=pot.as_string().unwrap_or_else(||text_of(pot));
 format!("pot:{name}:{}:{}",if truthy(pot){color}else{clay},level_text(level))
}
#[wasm_bindgen]
pub fn plant_pot_key(pot:&JsValue,color:&str,clay:&str,level:f64)->String{pot_key_text(pot,color,clay,level)}
pub fn pot_plan(pot:&JsValue,model:&str,color:&str,clay:&str,level:f64)->Surface{
 let key=pot_key_text(pot,color,clay,level);let mut config=rgb(if truthy(pot){color}else{clay}).to_vec();let (family,kind)=match model{
  "muskot"|"gradvis"=>{config=rgb(color).to_vec();config.extend(rgb(if model=="muskot"{"#cfbea3"}else{"#c7a291"}));config.extend(if model=="muskot"{[0.24,0.0022,0.55,17.0]}else{[0.42,0.004,0.0,29.0]});(0.0,0.0)},
  "akerbar"=>{config=rgb(color).to_vec();config.push(41.0);(1.0,1.0)},
  _=>{config.push(53.0);(1.0,0.0)}
 };
 Surface{key,width:128.0*level,height:256.0*level,repeat:true,family,kind,config:Some(config)}
}
#[wasm_bindgen]
pub fn plant_pot_surface(pot:&JsValue,model:&str,color:&str,clay:&str,level:f64)->R<JsValue>{descriptor(pot_plan(pot,model,color,clay,level))}
pub fn soil_plan(kind:&str,level:f64)->Surface{Surface{key:format!("soil:{kind}:{}",level_text(level)),width:128.0*level,height:128.0*level,repeat:false,family:2.0,kind:if kind=="grit"{1.0}else{0.0},config:None}}
#[wasm_bindgen]
pub fn plant_soil_surface(kind:&str,level:f64)->R<JsValue>{descriptor(soil_plan(kind,level))}
/// The pot material's finish: what it overrides in the clay material, and its bump scale.
pub struct Finish{pub clearcoat:Option<f64>,pub clearcoat_roughness:Option<f64>,pub metalness:Option<f64>,pub bump_scale:f64}
pub fn finish_plan(model:&str)->Finish{match model{
 "muskot"=>Finish{clearcoat:Some(0.42),clearcoat_roughness:Some(0.16),metalness:None,bump_scale:0.55},
 "gradvis"=>Finish{clearcoat:Some(0.2),clearcoat_roughness:Some(0.42),metalness:None,bump_scale:0.45},
 "akerbar"=>Finish{clearcoat:None,clearcoat_roughness:None,metalness:Some(0.85),bump_scale:0.3},
 _=>Finish{clearcoat:None,clearcoat_roughness:None,metalness:None,bump_scale:0.4}
}}
/// What of the leaf material depends on the plant.
pub struct LeafLook{pub bump_scale:f64,pub sheen:f64,pub specular:f64,pub roughness:f64,pub clearcoat:f64,pub clearcoat_roughness:f64}
pub fn leaf_look(variant:&str,width:f64)->LeafLook{LeafLook{
 bump_scale:width*if variant=="succulent"{0.00035}else{0.0012},sheen:if variant=="succulent"{0.25}else if variant=="ivy"{0.0}else{0.08},
 specular:if variant=="ivy"{0.1}else{0.6},roughness:match variant{"zz"=>0.55,"ivy"=>0.66,"succulent"=>0.88,_=>0.85},
 clearcoat:match variant{"zz"=>0.32,"ivy"=>0.1,"succulent"=>0.035,_=>0.12},clearcoat_roughness:if variant=="ivy"{0.3}else{0.48}}}
#[wasm_bindgen]
pub fn plant_leaf_material(variant:&str,width:f64)->R<JsValue>{let look=leaf_look(variant,width);obj(&[
 ("color",v(16777215.0)),("vertexColors",JsValue::TRUE),("bumpScale",v(look.bump_scale)),
 ("sheen",v(look.sheen)),("sheenColor",s("#acc394")),("sheenRoughness",v(0.85)),
 ("alphaTest",v(0.0)),("alphaToCoverage",JsValue::FALSE),("specularIntensity",v(look.specular)),
 ("roughness",v(look.roughness)),("metalness",v(0.0)),
 ("clearcoat",v(look.clearcoat)),("clearcoatRoughness",v(look.clearcoat_roughness))])}
/// A plant's appearance: its catalogue variant, the seed its shapes are drawn from, its sizes in scene units.
pub struct Appearance{pub variant:String,pub seed:JsValue,pub units:Vec<u16>,pub skip:u32,pub quality:f64,pub width:f64,pub radius:f64,pub pot_height:f64,
 pub detailed:bool,pub clay:String,pub clay_value:JsValue,pub soil:&'static str,pub bake_key:JsValue,pub offset:f64,pub repeat:f64}
pub fn appearance(entry:&JsValue,geometry:&JsValue,pot_color:&JsValue,persist:bool)->R<Appearance>{
 let catalog=g(geometry,Thing::catalog_plant);let pot=g(geometry,Thing::pot_id);let real=g(geometry,Thing::real);let unit=num(&g(geometry,Thing::unit));let height=g(geometry,Thing::height);
 let catalog_variant=g(&catalog,Thing::variant);let name=variant(&if truthy(&catalog_variant){catalog_variant}else{r(entry,"variant",Thing::variant)?})?;
 let first=r(entry,"seed",Thing::seed)?;let seed=if !absent(&first){first}else{
  let key=r(entry,"key",Thing::key)?;if !absent(&key){key}else{let node=r(entry,"node",Thing::node)?;let id=if absent(&node){JsValue::UNDEFINED}else{r(&r(&node,"dataset",Thing::dataset)?,"objectId",Thing::object_id)?};if absent(&id){s(&name)}else{id}}
 };
 // A seed that is already a string is its own `String(seed)`; its UTF-16 units are read here unless it may
 // hold a lone surrogate (which a Rust string cannot), in which case the engine is asked unit by unit.
 let text_of_seed=||if seed.is_string(){Ok(seed.clone())}else{method(&global(),"String",&[&seed])};
 let units=match seed.as_string().filter(|text|!text.contains('\u{fffd}')){Some(text)=>text.encode_utf16().collect(),None=>seed_units(&seed)?};
 let skip=if truthy(&pot){1}else{2};let drawn=crate::plant_random(&units,skip);
 let (clay,clay_value)=if truthy(&pot){
  let hex=g(pot_color,Thing::hex);
  match hex.as_string(){Some(text) if !text.contains('\u{fffd}')=>(text,hex),_=>{let text=text_of(&hex);let value=s(&text);(text,value)}}
 }else{let text=["#a97958","#b18b6c","#bcad94","#826d60"][(drawn[0]*4.0).floor() as usize];(text.into(),s(text))};
 let width=num(&g(&real,Thing::canopy))*unit;let radius=num(&g(&real,Thing::pot_diameter))/2.0*unit;let pot_height=num(&g(&real,Thing::pot_height))*unit;
 let detailed=truthy(&catalog)||truthy(&pot)||["palm","fern","ivy","zz"].contains(&name.as_str());
 let soil=if name=="cactus"||name=="succulent"{"grit"}else{"peat"};
 let bake_key=if persist{let values=Array::new();values.push(&r(&catalog,"id",Thing::id)?);values.push(&s(&name));values.push(&pot);values.push(&text_of_seed()?);values.push(&height);js_sys::JSON::stringify(values.as_ref())?.into()}else{JsValue::NULL};
 let seed_text=text_of_seed()?;
 let quality=if truthy(&r(entry,"inspectionResolution",Thing::inspection_resolution)?){2.0}else{1.0};
 Ok(Appearance{variant:name,seed:seed_text,units,skip,quality,width,radius,pot_height,detailed,clay,clay_value,soil,bake_key,
  offset:drawn[if truthy(&pot){0}else{1}],repeat:jmax(1.0,js_round(std::f64::consts::PI*4.0*radius*(0.6-0.07)/pot_height))})
}
#[wasm_bindgen]
pub fn plant_appearance(entry:&JsValue,geometry:&JsValue,pot_color:&JsValue,persist:bool)->R<JsValue>{
 let look=appearance(entry,geometry,pot_color,persist)?;
 obj(&[("variant",s(&look.variant)),("seed",look.seed),("units",Uint16Array::from(look.units.as_slice()).into()),("skip",v(look.skip as f64)),("quality",v(look.quality)),("width",v(look.width)),("radius",v(look.radius)),("potHeight",v(look.pot_height)),("detailed",look.detailed.into()),("clayColor",look.clay_value),("soilKind",s(look.soil)),("bakeKey",look.bake_key),("offset",v(look.offset)),("repeat",v(look.repeat))])
}
#[wasm_bindgen]
pub fn plant_surface_keys(pot_key:&str,detailed:bool,variant:&str,soil:&str)->Set{let keys=Set::new(&JsValue::UNDEFINED);keys.add(&s(pot_key));if detailed{keys.add(&s(&format!("leaf:{variant}:1")));}keys.add(&s(&format!("soil:{soil}:1")));keys}

// All state is GC-owned. Every callback binding simply calls one native action.
#[wasm_bindgen]
pub fn plant_lifecycle_state(pot_color:&JsValue,textures:&JsValue,materials:&JsValue,geometries:&JsValue)->R<JsValue>{obj(&[("disposed",JsValue::FALSE),("pendingQuality",JsValue::NULL),("potColor",pot_color.clone()),("textures",textures.clone()),("materials",materials.clone()),("geometries",geometries.clone())])}
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
