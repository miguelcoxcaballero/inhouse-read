//! The live part of the voice catalogue: the record of a neural voice, the voice chosen for a language, and the
//! Spanish names of languages and regions. The frozen JavaScript original is tests/unit/helpers/reference-voice-catalog.js.
//! Language tags are normalised by the page (`normalize` callback: the tag is needed before this module loads);
//! locale collation and Intl display names are the browser's and come in as callbacks.
use wasm_bindgen::{prelude::*,JsCast};
use js_sys::{Array,Function,Object,Reflect,Set};
use crate::reader_actions::{get as property,set};

#[wasm_bindgen]
extern "C"{
 #[wasm_bindgen(catch,js_name=Number)]fn number(value:&JsValue)->Result<f64,JsValue>;
 #[wasm_bindgen(catch,js_name=String)]fn string(value:&JsValue)->Result<String,JsValue>;
}
/// Above any system voice (Android tops out near 650 with every marker), so an installed neural voice is the default pick.
const NEURAL_SCORE:f64=900.0;
const LANGUAGES:&[(&str,&str)]=&[("es","Español"),("en","Inglés"),("fr","Francés"),("de","Alemán"),("it","Italiano"),("pt","Portugués"),("ca","Catalán"),("gl","Gallego"),("eu","Euskera"),("nl","Neerlandés"),("ru","Ruso"),("ja","Japonés"),("zh","Chino"),("ko","Coreano"),("pl","Polaco"),("uk","Ucraniano"),("tr","Turco"),("sv","Sueco"),("da","Danés"),("nb","Noruego"),("fi","Finés"),("cs","Checo"),("el","Griego"),("hu","Húngaro"),("ro","Rumano"),("ar","Árabe"),("vi","Vietnamita"),("hi","Hindi"),("he","Hebreo"),("th","Tailandés")];
const REGIONS:&[(&str,&str)]=&[("ES","España"),("US","EE. UU."),("GB","Reino Unido"),("MX","México"),("AR","Argentina"),("CO","Colombia"),("CL","Chile"),("FR","Francia"),("DE","Alemania"),("IT","Italia"),("PT","Portugal"),("BR","Brasil"),("CA","Canadá"),("AU","Australia"),("IN","India"),("IE","Irlanda"),("CH","Suiza"),("AT","Austria"),("BE","Bélgica"),("CN","China"),("JO","Jordania"),("SA","Arabia Saudí"),("UA","Ucrania"),("RU","Rusia"),("NL","Países Bajos"),("PL","Polonia"),("TR","Turquía"),("SE","Suecia"),("DK","Dinamarca"),("NO","Noruega"),("FI","Finlandia"),("CZ","Chequia"),("GR","Grecia"),("HU","Hungría"),("RO","Rumanía"),("VN","Vietnam")];

/// `'Español'` for the base `es`, from the table or else from the browser's own names.
#[wasm_bindgen]
pub fn catalog_base_language_name(base:&str,host:&Function)->Result<String,JsValue>{
 if base.is_empty(){return Ok(String::new())}
 if let Some((_,name))=LANGUAGES.iter().find(|(key,_)|*key==base){return Ok((*name).into())}
 Ok(host.call2(&JsValue::UNDEFINED,&base.into(),&"language".into())?.as_string().unwrap_or_default())
}
/// `'México'` for the region `MX`; empty when the tag has no region.
#[wasm_bindgen]
pub fn catalog_region_name(region:&str,host:&Function)->Result<String,JsValue>{
 if region.is_empty(){return Ok(String::new())}
 if let Some((_,name))=REGIONS.iter().find(|(key,_)|*key==region){return Ok((*name).into())}
 Ok(host.call2(&JsValue::UNDEFINED,&region.into(),&"region".into())?.as_string().unwrap_or_default())
}
/// `'Español (México)'`.
#[wasm_bindgen]
pub fn catalog_language_name(base:&str,region:&str,host:&Function)->Result<String,JsValue>{
 let name=catalog_base_language_name(base,host)?;
 if name.is_empty(){return Ok(name)}
 let place=catalog_region_name(region,host)?;
 Ok(if place.is_empty(){name}else{format!("{name} ({place})")})
}

fn truthy(value:&JsValue)->bool{value.is_truthy()}
/// `value[key]` as JavaScript reads it: a primitive has no such property, null and undefined throw.
fn get(value:&JsValue,key:&str)->Result<JsValue,JsValue>{
 if value.is_null()||value.is_undefined(){return Err(js_sys::TypeError::new(&format!("Cannot read properties of {} (reading '{key}')",if value.is_null(){"null"}else{"undefined"})).into())}
 if value.is_object()||value.is_function(){property(value,key)}else{Ok(JsValue::UNDEFINED)}
}
/// `value || fallback`, the JavaScript way.
fn or(value:JsValue,fallback:impl FnOnce()->Result<JsValue,JsValue>)->Result<JsValue,JsValue>{if truthy(&value){Ok(value)}else{fallback()}}
fn tag(normalize:&Function,value:&JsValue)->Result<String,JsValue>{Ok(normalize.call1(&JsValue::UNDEFINED,value)?.as_string().unwrap_or_default())}
fn base_of(tag:&str)->&str{tag.split('-').next().unwrap_or("")}
fn region_of(tag:&str)->&str{tag.split('-').nth(1).unwrap_or("")}
fn is_neural_id(value:&JsValue)->bool{
 let Some(id)=value.as_string()else{return false};
 if id.starts_with("piper:"){return true}
 let b=id.as_bytes();
 // supertonic3:<F|M><1-5>:<xx>
 b.len()==17&&id.starts_with("supertonic3:")&&matches!(b[12],b'F'|b'M')&&(b'1'..=b'5').contains(&b[13])&&b[14]==b':'&&b[15].is_ascii_lowercase()&&b[16].is_ascii_lowercase()
}

/// A catalogue entry ({id, lang, name, quality, sizeMB, speaker, recommended...}) as a voice of the picker; null when it is
/// not one of ours. `installed` is a Set (or any iterable) of the ids downloaded so far.
#[wasm_bindgen]
pub fn catalog_neural_voice(entry:JsValue,installed:JsValue,normalize:Function)->Result<JsValue,JsValue>{
 if !truthy(&entry)||!entry.is_object(){return Ok(JsValue::NULL)}
 let id=get(&entry,"id")?;
 if !is_neural_id(&id){return Ok(JsValue::NULL)}
 // A shared multilingual model names the accent it speaks in `dialect`.
 let wanted=or(get(&entry,"dialect")?,||get(&entry,"lang"))?;
 let lang=tag(&normalize,&wanted)?;
 if lang.is_empty(){return Ok(JsValue::NULL)}
 let have:Set=if installed.is_instance_of::<Set>(){installed.unchecked_into()}else{Set::new(&or(installed,||Ok(Array::new().into()))?)};
 let result=Object::new();
 let id=get(&entry,"id")?;
 set(&result,"id",&id)?;
 let name=or(get(&entry,"name")?,||or(get(&entry,"piperId")?,||get(&entry,"id")))?;
 set(&result,"name",&string(&name)?.into())?;
 set(&result,"lang",&lang.as_str().into())?;
 set(&result,"base",&base_of(&lang).into())?;
 set(&result,"region",&region_of(&lang).into())?;
 set(&result,"quality",&JsValue::NULL)?;set(&result,"latency",&JsValue::NULL)?;set(&result,"network",&JsValue::FALSE)?;
 set(&result,"installed",&have.has(&get(&entry,"id")?).into())?;
 set(&result,"features",&Array::new())?;set(&result,"isDefault",&JsValue::FALSE)?;set(&result,"native",&JsValue::FALSE)?;set(&result,"label",&"".into())?;
 set(&result,"neural",&JsValue::TRUE)?;
 set(&result,"tier",&(if get(&entry,"quality")?==JsValue::from_str("high"){"high"}else{"medium"}).into())?;
 for (key,source) in [("sizeMB","sizeMB"),("speaker","speaker")]{
  let value=number(&get(&entry,source)?)?;
  set(&result,key,&(if value.is_nan()||value==0.0{0.0}else{value}).into())?;
 }
 set(&result,"recommended",&(get(&entry,"recommended")?==JsValue::TRUE).into())?;
 set(&result,"sharedPack",&(get(&entry,"sharedPack")?==JsValue::TRUE).into())?;
 let upgrade=number(&get(&entry,"upgradeBytes")?)?;
 set(&result,"upgradeBytes",&(if upgrade.is_nan()||upgrade==0.0{0.0}else{upgrade}).into())?;
 set(&result,"modelKey",&or(get(&entry,"modelKey")?,||or(get(&entry,"piperId")?,||get(&entry,"id")))?)?;
 set(&result,"runtime",&get(&entry,"runtime")?)?;
 set(&result,"licenseUrl",&get(&entry,"licenseUrl")?)?;
 set(&result,"licenseName",&get(&entry,"licenseName")?)?;
 Ok(result.into())
}

fn installed_voices(list:&Array)->Result<Vec<JsValue>,JsValue>{
 let mut found=Vec::new();
 for index in 0..list.length(){
  if !Reflect::has(list,&index.into())?{continue}
  let voice=list.get(index);
  if truthy(&get(&voice,"installed")?){found.push(voice)}
 }
 Ok(found)
}
fn answer(voice:&JsValue,id:&JsValue,language:&JsValue)->Result<JsValue,JsValue>{
 let result=Object::new();
 set(&result,"voice",voice)?;set(&result,"voiceId",id)?;set(&result,"language",language)?;
 Ok(result.into())
}

/// The voice and language for one utterance among installed neural voices. An explicit choice wins, except with the multilingual
/// option on and a chunk in another language: then that language gets its best voice (own region first). `voiceId` is ''
/// when nothing matches. Undefined when the list holds a voice that is not a neural record (the catalogue never does).
#[wasm_bindgen]
pub fn catalog_resolve_voice(voices:JsValue,options:JsValue,normalize:Function,compare:Function)->Result<JsValue,JsValue>{
 let option=|key:&str,fallback:JsValue|->Result<JsValue,JsValue>{if options.is_undefined(){return Ok(fallback)}let value=get(&options,key)?;Ok(if value.is_undefined(){fallback}else{value})};
 let voice_id=option("voiceId","".into())?;let language=option("language","".into())?;
 let multilingual=option("multilingual",JsValue::FALSE)?;let device=option("deviceLang","".into())?;
 let list:Array=if Array::is_array(&voices){voices.unchecked_into()}else{Array::new()};
 let usable=installed_voices(&list)?;
 let base_of_language=|value:&JsValue|->Result<String,JsValue>{Ok(base_of(&tag(&normalize,value)?).to_string())};
 let mut chosen=JsValue::UNDEFINED;
 if truthy(&voice_id){for voice in &usable{if get(voice,"id")?==voice_id{chosen=voice.clone();break}}}
 if truthy(&chosen)&&(!truthy(&multilingual)||get(&chosen,"base")?==JsValue::from_str(&base_of_language(&language)?)){
  return answer(&chosen,&get(&chosen,"id")?,&get(&chosen,"lang")?);
 }
 // An id we cannot see in the list (old bridge, list not loaded yet) is still passed through when there is nothing to choose from.
 if truthy(&voice_id)&&!truthy(&chosen)&&list.length()==0&&!truthy(&multilingual){return answer(&JsValue::NULL,&voice_id,&language)}
 let wanted=tag(&normalize,&language)?;let (base,region)=(base_of(&wanted),region_of(&wanted));
 let device_tag=tag(&normalize,&device)?;
 let device_region=if base_of(&device_tag)==base{region_of(&device_tag)}else{""};
 let mut best:Option<(JsValue,f64,JsValue)>=None;
 for voice in &usable{
  if get(voice,"base")?!=JsValue::from_str(base){continue}
  if !truthy(&get(voice,"neural")?){return Ok(JsValue::UNDEFINED)}
  let own=get(voice,"region")?;
  let bonus=if !region.is_empty()&&own==JsValue::from_str(region){150.0}else if region.is_empty()&&!device_region.is_empty()&&own==JsValue::from_str(device_region){25.0}else{0.0};
  let score=NEURAL_SCORE+(if get(voice,"tier")?==JsValue::from_str("high"){10.0}else{0.0})+(if truthy(&get(voice,"recommended")?){5.0}else{0.0})+bonus;
  let id=get(voice,"id")?;
  let better=match &best{
   None=>true,
   Some((_,top,top_id))=>{
    // `scoreVoice(b) + bonus(b) - scoreVoice(a) - bonus(a) || a.id.localeCompare(b.id)` with a = this voice, b = the best so far.
    let by_score=top-score;
    if by_score!=0.0{by_score<0.0}else{compare.call2(&JsValue::UNDEFINED,&id,top_id)?.as_f64().unwrap_or(0.0)<0.0}
   }
  };
  if better{best=Some((voice.clone(),score,id))}
 }
 match best{
  Some((voice,_,_))=>answer(&voice,&get(&voice,"id")?,&get(&voice,"lang")?),
  None=>answer(&JsValue::NULL,&"".into(),&language),
 }
}
