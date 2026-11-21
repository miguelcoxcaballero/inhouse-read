//! Exact static silhouettes from the original drawing functions. Browser
//! layout, colours and the studios retain their existing ownership.
use wasm_bindgen::prelude::*;
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
// The leaf heights of each frond, `Math.sin(i / (pairs + 1) * Math.PI) ** .7 * (fern ? 15 : 23)` for i in 1..=pairs,
// as the browser's Math rounds them (V8's fdlibm sin and pow), kept bit for bit: the drawing prints every digit.
// Order: palm, palm compact, fern, fern compact.
const FRONDS:[&[u64];4]=[
 &[0x4025b4eaf8022af8,0x4030e14e688da796,0x4034cc03c17201f6,0x4036c13d7049fda0,0x4036c13d7049fda0,0x4034cc03c17201f7,0x4030e14e688da797,0x4025b4eaf8022afb],
 &[0x4029a3db93d7f8e3,0x40335c2de69174f5,0x403698451c8f6d49,0x403698451c8f6d49,0x40335c2de69174f6,0x4029a3db93d7f8e4],
 &[0x4018b827cddaef05,0x4023816979b901d0,0x4028a8daabb89aa6,0x402c1352f8b0140c,0x402dc932373d58f4,0x402dc932373d58f5,0x402c1352f8b0140c,0x4028a8daabb89aa7,0x4023816979b901cf,0x4018b827cddaef0c],
 &[0x401ea122c6f30909,0x4027899b1a6ad8a0,0x402c61f14db11290,0x402e000000000000,0x402c61f14db11290,0x4027899b1a6ad8a1,0x401ea122c6f3090b]];
fn frond_illustration(plant:&str,pot:&str,compact:bool)->Option<String>{
 let fern=plant=="nephrolepis";
 let template=match(plant,compact){
 ("chamaedorea",false)=>include_str!("art/frond-chamaedorea-0.svg"),("chamaedorea",true)=>include_str!("art/frond-chamaedorea-1.svg"),
 ("nephrolepis",false)=>include_str!("art/frond-nephrolepis-0.svg"),("nephrolepis",true)=>include_str!("art/frond-nephrolepis-1.svg"),_=>return None};
 let sizes=FRONDS[fern as usize*2+compact as usize];debug_assert_eq!(sizes.len(),pairs(fern,compact));
 // A finite f64 of these magnitudes prints with the same shortest digits in Rust and in JavaScript's String(number).
 let paths:Vec<String>=sizes.iter().map(|bits|{let height=f64::from_bits(*bits);let width=height*0.23;
  format!("M0 0C{} {} {} {} 0 {}C{} {} {} {} 0 0Z",-width*0.85,-height*0.22,-width*0.75,-height*0.73,-height,width*0.66,-height*0.76,width*0.8,-height*0.24)}).collect();
 let mut body=String::with_capacity(template.len()+paths.iter().map(|path|path.len()).sum::<usize>()*12);let mut remaining=template;
 while let Some(start)=remaining.find("__LEAF_"){
  body.push_str(&remaining[..start]);remaining=&remaining[start+7..];let end=remaining.find("__")?;let index:usize=remaining[..end].parse().ok()?;
  body.push_str(paths.get(index)?);remaining=&remaining[end+2..];
 }body.push_str(remaining);Some(wrap_svg(&body,pot,false,compact))
}
const PLANTS:[&str;8]=["sansevieria","monstera","chamaedorea","nephrolepis","hedera","zamioculcas","succulent","cactus"];
const POTS:[&str;4]=["muskot","akerbar","muskotblomma","gradvis"];
/// A catalogue drawing (moved from src/js/plant-catalog-art.js): an unknown plant is the monstera and an unknown or
/// absent pot the MUSKOT; ferns are drawn frond by frond, every other plant from its silhouette.
pub fn plant_illustration(plant:&JsValue,pot:&JsValue,pot_only:bool,compact:bool)->Option<String>{
 let plant=plant.as_string().filter(|id|PLANTS.contains(&id.as_str())).unwrap_or_else(||"monstera".into());
 let pot=pot.as_string().filter(|id|POTS.contains(&id.as_str())).unwrap_or_else(||"muskot".into());
 if !pot_only&&(plant=="chamaedorea"||plant=="nephrolepis"){frond_illustration(&plant,&pot,compact)}
 else{catalog_illustration(&plant,&pot,pot_only,compact)}
}
/// The same drawing for the differential tests.
#[wasm_bindgen]
pub fn catalog_plant_illustration(plant:JsValue,pot:JsValue,pot_only:bool,compact:bool)->Option<String>{plant_illustration(&plant,&pot,pot_only,compact)}
