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
impl RustScene{
 /// Whether the bin's box on screen has to be taken again: its lid's opening, the room's world
 /// matrix or the bin's place is not, bit for bit, what it was at the previous frame of the bin
 /// (the host compared these, with the bin's constant turn and scale, in every frame:
 /// bookshelf-scene.js `binStands`, 1.7.339). A view that holds no bin never says so.
 pub(crate) fn bin_moved(&mut self)->bool{
  let Some(bin)=self.bin else{return false};
  let (seen,mut moved)=(&mut self.bin_seen,false);
  let mut see=|at:usize,value:f64|{let bits=value.to_bits();if seen[at]!=bits{seen[at]=bits;moved=true;}};
  see(0,self.trash_openness);
  if let Some(room)=&self.room{for (at,value) in room.iter().enumerate(){see(1+at,*value);}}
  for at in 0..3{see(17+at,bin[6+at]);}
  moved
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
  let (x,y,z,floor_y,room)=(bin[6],bin[7],bin[8],bin[9],Mat4(self.room.unwrap_or([f64::NAN;16])));
  let foot_y=y+bin[1]*1.0;
  let (foot,floor)=(room.apply([x,foot_y,z]),room.apply([x,floor_y,z]));
  self.trash_shown(&[x,y,z,1.0,0.0,0.0,0.0,foot_y,floor_y,foot[0],foot[1],foot[2],floor[0],floor[1],floor[2],bin[10],bin[11]],visible,in_frame);
 }
}
