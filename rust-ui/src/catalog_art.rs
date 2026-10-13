//! Exact static silhouettes from the original drawing functions. Browser
//! layout, colours and the studios retain their existing ownership.
use wasm_bindgen::prelude::*;
use js_sys::Float64Array;
fn plant_body(id:&str,compact:bool)->&'static str{match(id,compact){
("sansevieria",false)=>include_str!("art/plant-sansevieria-0.svg"),
("sansevieria",true)=>include_str!("art/plant-sansevieria-1.svg"),
("monstera",false)=>include_str!("art/plant-monstera-0.svg"),
("monstera",true)=>include_str!("art/plant-monstera-1.svg"),
("hedera",false)=>include_str!("art/plant-hedera-0.svg"),
("hedera",true)=>include_str!("art/plant-hedera-1.svg"),
("zamioculcas",false)=>include_str!("art/plant-zamioculcas-0.svg"),
("zamioculcas",true)=>include_str!("art/plant-zamioculcas-1.svg"),
("succulent",false)=>include_str!("art/plant-succulent-0.svg"),
("succulent",true)=>include_str!("art/plant-succulent-1.svg"),
("cactus",false)=>include_str!("art/plant-cactus-0.svg"),
("cactus",true)=>include_str!("art/plant-cactus-1.svg"),
(_,compact)=>plant_body("monstera",compact)}}
fn pot_body(id:&str,compact:bool)->&'static str{match(id,compact){
("muskot",false)=>include_str!("art/pot-muskot-0.svg"),
("muskot",true)=>include_str!("art/pot-muskot-1.svg"),
("akerbar",false)=>include_str!("art/pot-akerbar-0.svg"),
("akerbar",true)=>include_str!("art/pot-akerbar-1.svg"),
("muskotblomma",false)=>include_str!("art/pot-muskotblomma-0.svg"),
("muskotblomma",true)=>include_str!("art/pot-muskotblomma-1.svg"),
("gradvis",false)=>include_str!("art/pot-gradvis-0.svg"),
("gradvis",true)=>include_str!("art/pot-gradvis-1.svg"),
(_,compact)=>pot_body("muskot",compact)}}

fn wrap_svg(body:&str,pot:&str,pot_only:bool,compact:bool)->String{
 let viewbox=if pot_only{"42 136 76 62"}else{"0 0 160 200"};let width=if compact{"1.65"}else{"1.3"};
 format!("<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"{viewbox}\" aria-hidden=\"true\" focusable=\"false\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"{width}\" stroke-linecap=\"round\" stroke-linejoin=\"round\">{}{}</svg>",if pot_only{""}else{body},pot_body(pot,compact))
}
#[wasm_bindgen]
pub fn catalog_illustration(plant:&str,pot:&str,pot_only:bool,compact:bool)->Option<String>{
 if !pot_only&&(plant=="chamaedorea"||plant=="nephrolepis"){return None;}
 Some(wrap_svg(plant_body(plant,compact),pot,pot_only,compact))
}
fn pairs(fern:bool,compact:bool)->usize{if fern{if compact{7}else{10}}else if compact{6}else{8}}
#[wasm_bindgen]
pub fn catalog_frond_fractions(fern:bool,compact:bool)->Float64Array{
 let pairs=pairs(fern,compact);let values:Vec<f64>=(1..=pairs).map(|index|index as f64/(pairs+1)as f64).collect();Float64Array::from(values.as_slice())
}
#[wasm_bindgen]
pub fn catalog_frond_numbers(sizes:&[f64])->Option<Float64Array>{
 if sizes.len()>10||sizes.iter().any(|size|!size.is_finite()){return None;}
 let mut values=Vec::with_capacity(sizes.len()*9);for &height in sizes{let width=height*0.23;values.extend_from_slice(&[-width*0.85,-height*0.22,-width*0.75,-height*0.73,-height,width*0.66,-height*0.76,width*0.8,-height*0.24]);}
 Some(Float64Array::from(values.as_slice()))
}
#[wasm_bindgen]
pub fn catalog_frond_illustration(plant:&str,pot:&str,compact:bool,numbers:&str)->Option<String>{
 let template=match(plant,compact){
 ("chamaedorea",false)=>include_str!("art/frond-chamaedorea-0.svg"),("chamaedorea",true)=>include_str!("art/frond-chamaedorea-1.svg"),
 ("nephrolepis",false)=>include_str!("art/frond-nephrolepis-0.svg"),("nephrolepis",true)=>include_str!("art/frond-nephrolepis-1.svg"),_=>return None};
 if numbers.len()>8192{return None;}let numbers:Vec<&str>=numbers.split('\0').collect();
 if numbers.len()!=pairs(plant=="nephrolepis",compact)*9||numbers.iter().any(|number|number.parse::<f64>().map_or(true,|number|!number.is_finite())){return None;}
 let paths:Vec<String>=numbers.chunks_exact(9).map(|leaf|format!("M0 0C{} {} {} {} 0 {}C{} {} {} {} 0 0Z",leaf[0],leaf[1],leaf[2],leaf[3],leaf[4],leaf[5],leaf[6],leaf[7],leaf[8])).collect();
 let mut body=String::with_capacity(template.len()+paths.iter().map(|path|path.len()).sum::<usize>()*12);let mut remaining=template;
 while let Some(start)=remaining.find("__LEAF_"){
  body.push_str(&remaining[..start]);remaining=&remaining[start+7..];let end=remaining.find("__")?;let index:usize=remaining[..end].parse().ok()?;
  body.push_str(paths.get(index)?);remaining=&remaining[end+2..];
 }body.push_str(remaining);Some(wrap_svg(&body,pot,false,compact))
}
