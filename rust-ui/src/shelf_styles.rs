//! Batch the deterministic physical spine properties, with no DOM or book
//! objects retained. Host coercion and the original palette identities stay
//! outside this kernel. Four finite numbers are returned for every seed.
use wasm_bindgen::prelude::*;
const MAX_BOOKS:usize=4096;
const MAX_PACKET:usize=1_048_576;
fn hash(text:&str)->u32{
 let mut value=0x811c9dc5_u32;
 for unit in text.encode_utf16(){value=(value^(unit as u32)).wrapping_mul(0x01000193);}
 value
}
fn salted(mut value:u32,suffix:&[u8])->u32{
 for unit in suffix{value=(value^(*unit as u32)).wrapping_mul(0x01000193);}
 value
}
#[wasm_bindgen]
pub fn shelf_spine_styles(seeds:&str,pages:&[f64],config:&[f64])->Option<Vec<f64>>{
 if seeds.len()>MAX_PACKET||pages.len()>MAX_BOOKS||config.len()!=8{return None;}
 if config.iter().any(|value|!value.is_finite())||pages.iter().any(|value|!value.is_finite()||*value<0.0){return None;}
 let (min_width,max_width,min_height,max_height)=(config[0],config[1],config[2],config[3]);
 if min_width<0.0||max_width<min_width||min_height<0.0||max_height<min_height{return None;}
 let (paper,binding,palettes,textures)=(config[4],config[5],config[6],config[7]);
 if palettes<1.0||textures<1.0||palettes>65535.0||textures>65535.0||palettes.fract()!=0.0||textures.fract()!=0.0{return None;}
 if pages.is_empty(){return if seeds.is_empty(){Some(Vec::new())}else{None};}
 let names:Vec<_>=seeds.split('\0').collect();if names.len()!=pages.len(){return None;}
 let mut result=Vec::with_capacity(pages.len()*4);
 let low=40.0_f64.sqrt();let high=900.0_f64.sqrt();
 for (seed,page) in names.iter().zip(pages){
  let hashed=hash(seed);
  let palette=((salted(hashed,b"::palette") as f64)/4294967296.0*palettes).floor();
  let texture=((salted(hashed,b"::texture") as f64)/4294967296.0*textures).floor();
  let width=if paper>0.0{binding+page*paper}else{
   let ratio=if *page>0.0{((page.sqrt()-low)/(high-low)).clamp(0.0,1.0)}else{0.0};
   min_width+(max_width-min_width)*ratio
  };
  let width=width.clamp(min_width,max_width);
  let width=if paper!=0.0{(width*100.0).round()/100.0}else{width.round()};
  let height=min_height+(max_height-min_height)*(salted(hashed,b"::height") as f64/4294967296.0);
  result.extend_from_slice(&[palette,width,(height*1000.0).round()/1000.0,texture]);
 }
 Some(result)
}
