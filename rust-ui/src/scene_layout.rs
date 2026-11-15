//! The frame's layout, read once by the host while the page's layout is still clean (the stage's
//! place, the scroller's clip, the window and the visual viewport) and kept here for the frame: the
//! camera's scroll follows from it, and the bin's and the booklet's buttons are placed from it
//! without the host packing the same rectangles again for each. `trashFrame` and `catalogFrame`
//! (scene_frame.rs) remain the arithmetic, guarded against the frozen JavaScript.
use wasm_bindgen::prelude::*;
use crate::scene_view::RustScene;

#[wasm_bindgen]
impl RustScene{
 /// The frame's layout: the canvas' top, the stage's `left, top`, the scroller's clip `left, top,
 /// right, bottom`, the window's `width, height` and the visual viewport's bottom (whatever the
 /// host holds when the scene has no bin). Returns the camera's scroll (`scrollOf`).
 #[wasm_bindgen(js_name=frameLayout)]
 #[allow(clippy::too_many_arguments)]
 pub fn frame_layout(&mut self,canvas_top:f64,stage_left:f64,stage_top:f64,clip_left:f64,clip_top:f64,clip_right:f64,clip_bottom:f64,
  inner_width:f64,inner_height:f64,visual_bottom:f64)->f64{
  let scroll=self.scroll_of(canvas_top,stage_top);
  self.layout=[stage_left,stage_top,clip_left,clip_top,clip_right,clip_bottom,inner_width,inner_height,visual_bottom,scroll];
  scroll
 }
 /// `trashFrame` in the frame's layout, for the rectangle given or, given none, the one of the
 /// box the host last took (`binBox`).
 #[wasm_bindgen(js_name=trashPlaced)]
 pub fn trash_placed(&self,rect:&[f64],out:&mut [f64]){
  let layout=self.layout;
  let rect=if rect.is_empty(){&self.bin_rect[..]}else{rect};
  self.trash_frame(rect,layout[9],layout[0],layout[1],&layout[2..6],layout[6],layout[7],layout[8],out);
 }
 /// `catalogFrame` in the frame's layout. The face's text is built and handed over only when one
 /// of its four numbers is not the one it was last built from (`undefined` otherwise: the host
 /// keeps the text it holds).
 #[wasm_bindgen(js_name=catalogPlaced)]
 pub fn catalog_placed(&mut self,bounds_box:&[f64],matrix:&[f64],cover:&[f64],out:&mut [f64])->Option<String>{
  let layout=self.layout;
  let Some(face)=self.catalog_numbers(bounds_box,matrix,cover,layout[9],&layout[0..2],&layout[2..6],&layout[6..8],out)
   else{self.face_key=None;return Some(String::new())};
  let key=face.map(f64::to_bits);
  if self.face_key==Some(key){return None;}
  self.face_key=Some(key);
  Some(crate::scene_frame::catalog_face(face))
 }
}
