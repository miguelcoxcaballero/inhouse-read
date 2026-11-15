//! The bin as the view keeps it from the moment it is placed (`scene_position_trash`): its
//! footprint, its place, the floor under it, its radius and its height. The host formerly packed
//! the footprint and the place for the view's fit and the shadow's bounds (twice per frame until
//! 1.7.339) and, in every frame, the seventeen numbers of the bin's diagnostics, two of them
//! points it had three move into the world (bookshelf-scene.js `packBin` and `updateTrash`).
use wasm_bindgen::prelude::*;
use crate::jsmath::{Box3,Mat4};
use crate::scene_view::RustScene;

impl RustScene{
 /// The bin's box where it stands: the one given (`min, max, place`, as the host packed it), or
 /// the view's own when none is given.
 pub(crate) fn bin_box(&self,given:&[f64])->Option<Box3>{
  let held;
  let trash=if given.len()>=9{given}else{held=self.bin?;&held[..9]};
  let mut bin=Box3{min:[trash[0],trash[1],trash[2]],max:[trash[3],trash[4],trash[5]]};
  for axis in 0..3{bin.min[axis]+=trash[6+axis];bin.max[axis]+=trash[6+axis];}
  Some(bin)
 }
}
#[wasm_bindgen]
impl RustScene{
 // `trashShown` for the bin the view holds, in the room of its last fit: the bin's place, its
 // unit scale and upright turn, its foot and the floor under it, both also in the world
 // (`Object3D#localToWorld`: the point under the room's world matrix), its radius and height.
 #[wasm_bindgen(js_name=binShown)]
 pub fn bin_shown(&mut self,visible:bool,in_frame:bool){
  let Some(bin)=self.bin else{return};
  let (x,y,z,floor_y,room)=(bin[6],bin[7],bin[8],bin[9],Mat4(self.room));
  let foot_y=y+bin[1]*1.0;
  let (foot,floor)=(room.apply([x,foot_y,z]),room.apply([x,floor_y,z]));
  self.trash_shown(&[x,y,z,1.0,0.0,0.0,0.0,foot_y,floor_y,foot[0],foot[1],foot[2],floor[0],floor[1],floor[2],bin[10],bin[11]],visible,in_frame);
 }
}
