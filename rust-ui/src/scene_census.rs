//! What the host holds of every entry: the host writes three numbers per entry (columns 85-87 of
//! the entry arena) whenever they may have changed, and one call per frame answers what the frame formerly asked
//! entry by entry in JavaScript: the diagnostics' counts (`scene_counts`, rebuilt only when a
//! number differs), the shadow casters' signature (`scene_casters`), whether a quality map is
//! still loading, whether a returning book is painted on the overlay or by the native layer,
//! whether anything flies, lands or previews, and whether a book is lifted or pressed. The
//! room's painted-away books (column 88) and the quality hold's deadline live here too, and so
//! do the canvas' diagnostics that follow from the census: `show` writes only those whose number
//! differs from the one written last.
use wasm_bindgen::prelude::*;
use crate::scene_view::RustScene;
use super::{RustSceneEntryFrame,STATE,HOSTED,PAINTED_AWAY};

/// Column 85's bits (512, a completed drop, is read by the pose call only).
const MODEL:u32=1;const VISIBLE:u32=2;const PENDING:u32=4;const OVERVIEW:u32=8;const INSERTION:u32=16;
const DROP:u32=32;const OVERLAY:u32=64;const NATIVE:u32=128;const LOADING:u32=256;

#[wasm_bindgen]
impl RustSceneEntryFrame{
 /// Returns `counts changed | loading << 1 | overlay insertion << 2 | native insertion << 3 |
 /// busy << 4 | touched << 5`; the numbers are at `census_ptr`: the casters' signature, then
 /// `scene_counts`' eight.
 pub fn census(&mut self,trash_visible:bool)->u32{
  let count=self.state.len()/STATE;
  if self.counted.len()!=count*5{self.counted.clear();self.counted.resize(count*5,0.0);self.count_dirty=true;}
  let (mut summary,mut casters,mut changed)=(0u32,i32::from(trash_visible),self.count_dirty);
  for (row,counted) in self.state.chunks_exact(STATE).zip(self.counted.chunks_exact_mut(5)){
   let held=row[HOSTED] as u32;
   if held&LOADING!=0{summary|=2;}
   if held&OVERLAY!=0{summary|=4;}
   if held&NATIVE!=0{summary|=8;}
   if held&(INSERTION|DROP)!=0||row[9]!=0.0||row[20]!=0.0{summary|=16;}
   if (row[5]!=0.0&&!row[5].is_nan())||(row[2] as u32)&8!=0{summary|=32;}
   if held&VISIBLE!=0{casters=super::super::caster(casters,row[HOSTED+2]);}
   let next=[row[0],f64::from(held&VISIBLE!=0),f64::from(held&PENDING!=0),f64::from(held&OVERVIEW!=0),row[HOSTED+1]];
   for (slot,value) in counted.iter_mut().zip(next){if slot.to_bits()!=value.to_bits(){*slot=value;changed=true;}}
  }
  self.loading=summary&2!=0;
  self.census[0]=f64::from(casters);
  if changed{self.count_dirty=false;self.resolutions=super::super::scene_counts(&self.counted,&mut self.census[1..]);self.shown_last[9]=FRESH;summary|=1;}
  summary
 }
 pub fn census_ptr(&self)->usize{self.census.as_ptr() as usize}
 /// The room was painted: the books it was painted without (away, their model hidden, neither
 /// returning nor flying to the bin) are remembered until the next painted room.
 pub fn painted(&mut self){
  for row in self.state.chunks_exact_mut(STATE){
   let held=row[HOSTED] as u32;
   row[PAINTED_AWAY]=f64::from((row[2] as u32)&1!=0&&held&(MODEL|VISIBLE|INSERTION|DROP)==MODEL);
  }
 }
 /// `scene_quality_hold` over the last census.
 pub fn quality_hold(&mut self,scene:&RustScene,eligible:bool,now:f64)->f64{
  crate::scene_quality::hold(&mut self.paint_deadline,eligible,self.loading,scene,now)
 }
 /// The canvas' data attributes, for `show`.
 pub fn shows(&mut self,dataset:js_sys::Object){
  self.dataset=Some(dataset);self.shown_last=[FRESH;19];self.shown_text.clear();
  self.shown_keys=KEYS.iter().map(|key|JsValue::from_str(key)).collect();
 }
 /// The host's numbers for `show`: the lit lamps, the lamps casting a shadow, the renderer's
 /// geometries and textures, whether the overview image is ready, the pixel ratio and the
 /// cabinet's meshes.
 pub fn shown_ptr(&self)->usize{self.shown.as_ptr() as usize}
 /// A painted frame's diagnostics, in the order the scene always wrote them: `part` 0 from the
 /// plants to the textures, 1 from the overview image to the plants' geometry (the host writes
 /// the programs between them). Each reaches the canvas only when it differs from the one this
 /// wrote last; a number or a boolean is handed over as it is, since the canvas' data keeps
 /// `String(value)` of whatever it is given, and no text is built here for it.
 pub fn show(&mut self,part:u32){
  let Some(dataset)=&self.dataset else{return};
  let (c,s)=(&self.census,&self.shown);
  let values=[c[1],c[2],c[3],s[0],s[0],s[1],2700.0,c[4],c[6],0.0,s[2],s[3],f64::from(s[4]!=0.0),s[5],c[5],c[7],1024.0,s[6],0.0];
  for index in if part==0{0..12}else{12..19}{
   let bits=(values[index]+0.0).to_bits();
   if self.shown_last[index]==bits{continue;}
   self.shown_last[index]=bits;
   let value=match index{
    9=>{if self.shown_text==self.resolutions{continue;}self.shown_text.clone_from(&self.resolutions);JsValue::from_str(&self.resolutions)}
    12=>JsValue::from_bool(values[12]!=0.0),
    18=>JsValue::from_str("catalog-3d"),
    _=>JsValue::from_f64(values[index]+0.0)};
   let _=js_sys::Reflect::set(dataset,&self.shown_keys[index],&value);
  }
 }
}
/// No number written yet (no shown value has these bits).
const FRESH:u64=u64::MAX;
const KEYS:[&str;19]=["activePlants","highResolutionPlants","activeLamps","lampLightCount","activeLampLights","lampShadowCount","lampLightTemperature",
 "overviewBooks","highResolutionBooks","bookTextureResolutions","sceneGeometries","sceneTextures",
 "inspectionOverviewReady","pixelRatio","detailedBooks","bookQualityPending","shadowMapSize","furnitureMeshes","plantGeometry"];
