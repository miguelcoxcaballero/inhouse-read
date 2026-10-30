// The buttons' retained style history (rust-ui/src/scene_projection.rs), reset when the entries
// change. The whole-scene entry frame (scene-entry-frame.js) projects and hits through it.
export function createSceneProjectionFrame(rust) {
 const native=new rust.RustSceneProjectionFrame();
 let entries=null,disposed=false;
 return {native,prepare(next){
  if(disposed)throw new Error('Scene projection frame has been disposed');
  if(entries!==next){native.reset_entries(next.length);entries=next;}
 },free(){
  if(disposed)return;native.free();disposed=true;entries=null;
 }};
}
