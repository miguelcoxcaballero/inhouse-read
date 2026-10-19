// Three and DOM remain host-owned. A scene arena keeps input buffers and the
// numeric style history, so wasm-bindgen does not allocate/copy each projection.
export function createSceneProjectionFrame(rust) {
 const native=new rust.RustSceneProjectionFrame(),memory=native.memory();
 const projectAt=native.projection_ptr(),hitAt=native.hit_ptr();
 const projection=new Float64Array(44),hitOutput=new Float64Array(49);
 let entries=null,buffer=null,projectInput,hitInput,projectResult,hitResult,disposed=false;
 function refresh(){
  if(disposed)throw new Error('Scene projection frame has been disposed');
  if(buffer===memory.buffer)return;
  buffer=memory.buffer;projectInput=new Float64Array(buffer,projectAt,44);hitInput=new Float64Array(buffer,hitAt,49);
  projectResult=new Float64Array(buffer,projectAt+30*8,14);hitResult=new Float64Array(buffer,hitAt+33*8,16);
 }
 function prepare(next){
  if(disposed)throw new Error('Scene projection frame has been disposed');
  if(entries!==next){native.reset_entries(next.length);entries=next;}refresh();
 }
 function project(scene,entry,kind,flags,drop,insertion,matrix){
  refresh();const v=projectInput;
  v[0]=kind;v[1]=flags;v[2]=drop?1:0;v[3]=insertion?1:0;v[4]=entry.model?1:0;v[5]=entry.overview?1:0;
  v[6]=drop?.complete?1:0;v[7]=insertion?.overlayCanvas?1:0;v.set(entry.box,8);v.set(matrix.elements,14);
  native.project(scene);refresh();projection.set(projectResult,30);
 }
 function hit(scene,index,kind,undershelf,bits,disabled,rect,box,matrix,reset,freshCover){
  refresh();const v=hitInput;
  v[0]=kind;v[1]=undershelf?1:0;v[2]=bits;v[3]=disabled?1:0;
  v[4]=rect.left;v[5]=rect.right;v[6]=rect.top;v[7]=rect.bottom;v[8]=rect.width;v[9]=rect.height;v[10]=rect.closest;
  v.set(box,11);v.set(matrix.elements,17);
  const dirty=native.hit(scene,index,reset,freshCover);refresh();hitOutput.set(hitResult,33);return dirty;
 }
 return {prepare,project,hit,projection,hitOutput,free(){
  if(disposed)return;native.free();disposed=true;entries=buffer=projectInput=hitInput=projectResult=hitResult=null;
 }};
}
