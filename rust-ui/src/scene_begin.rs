//! How a frame of the scene begins and what its painted room leaves behind, each as one call: the
//! turn between the views and a reorder's release advance together, the bin's lid with its view,
//! the shadow's refit is taken, and the view the room was painted in is kept here for the modal
//! gate. The host formerly asked the view for each of these states one property at a time
//! (bookshelf-scene.js draw, updateTrash and canDeferModalPaint, 1.7.334).
use wasm_bindgen::prelude::*;
use crate::scene_view::RustScene;

#[wasm_bindgen]
impl RustScene{
 /// The frame's first step. 1: the view was turning, and this step's scroll is `turnScroll`;
 /// 2: a reorder was easing, and what is left of each item's offset is `reorderLeft`; 4: that
 /// reorder ended with this step; 8: the view now rests at the diagonal's end.
 #[wasm_bindgen(js_name=beginFrame)]
 pub fn begin_frame(&mut self,now:f64)->u32{
  let mut begun=0;
  if let Some(scroll)=self.step_turn(now){begun|=1;self.begun[0]=scroll;}
  if let Some(left)=self.step_reorder(now){begun|=2;self.begun[1]=left;if !self.reordering(){begun|=4;}}
  if self.progress==1.0{begun|=8;}
  begun
 }
 #[wasm_bindgen(getter,js_name=turnScroll)]pub fn turn_scroll(&self)->f64{self.begun[0]}
 #[wasm_bindgen(getter,js_name=reorderLeft)]pub fn reorder_left(&self)->f64{self.begun[1]}
 /// The bin's frame begins: a view that does not show it closes it (1), then its lid's ease
 /// advances (2 while it still moves). The lid's opening is `trashOpenness`. 4: the box on screen
 /// of the bin the view holds has to be taken again (`scene_bin.rs`).
 #[wasm_bindgen(js_name=trashBegin)]
 pub fn trash_begin(&mut self,now:f64,reduced:bool)->u32{
  let hidden=self.trash_view_hidden();
  if hidden{self.trash_reset();}
  let moving=self.trash_step(now,reduced);
  u32::from(hidden)|u32::from(moving)<<1|u32::from(self.bin_moved())<<2
 }
 /// Whether this frame fits the shadow again: asked for and the fingers have left the view,
 /// which then asks for it no longer.
 #[wasm_bindgen(js_name=takeRefit)]
 pub fn take_refit(&mut self)->bool{
  let moving=self.moving();
  let refit=self.shadow_refit_value()&&!moving;
  if !moving{self.set_shadow_refit(false);}
  refit
 }
 /// The room was painted in this view (its turn, zoom and pan).
 #[wasm_bindgen(js_name=keepPainted)]
 pub fn keep_painted(&mut self){self.painted=Some([self.progress,self.zoom,self.pan_x(),self.pan_y()]);}
 /// Whether the view is still the one the room was last painted in.
 #[wasm_bindgen(js_name=paintedSame)]
 pub fn painted_same(&self)->bool{self.painted==Some([self.progress,self.zoom,self.pan_x(),self.pan_y()])}
}
