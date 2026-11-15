// Three things a frame asked through adapters until 1.8.1, against what the scene does now.
// 1. The shared room's keys and bays: the adapter (tests/unit/helpers/scene-motion-frame.js)
//    compared the entries' array and wrote every bay through a view in every frame; the scene now
//    tells them once per layout (register, identify, RustSceneMotionFrame#bays) and a frame only
//    tests a flag. Both a steady frame and a layout's first frame are timed.
// 2. A plant's foliage pose: the adapter (helpers/foliage-frame.js) copied twenty-six numbers into
//    the state's view; RustSceneEntryFrame#foliagePose takes the rectangle from the entry arena.
// 3. The stage's pixel origin: the core module through shelf-pixel-origin.js' type check, or the
//    view's own method in the shelf module.
// Node/WASM, no DOM or GPU. Interleaved rounds, medians.
// node scripts/benchmark-scene-told.mjs [dir with the current shelf build]
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {performance} from 'node:perf_hooks';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createSceneMotionFrame} from '../tests/unit/helpers/scene-motion-frame.js';
import {createFoliageFrame} from '../tests/unit/helpers/foliage-frame.js';
const dir=resolve(process.argv[2]||'src/wasm/shelf');
const rust=await import(pathToFileURL(dir+'/inhouse_read_shelf.js').href);
rust.initSync({module:readFileSync(dir+'/inhouse_read_shelf_bg.wasm')});
const median=a=>a.toSorted((x,y)=>x-y)[Math.floor(a.length/2)];
const compare=(label,before,after,loops,unit='us')=>{
 const run=work=>{const start=performance.now();for(let i=0;i<loops;i++)work(i);return (performance.now()-start)/loops*1000;};
 for(let i=0;i<3;i++){run(before);run(after);}
 const x=[],y=[];
 for(let round=0;round<21;round++){x.push(run(before));y.push(run(after));}
 console.log(`${label}: ${median(x).toFixed(4)} -> ${median(y).toFixed(4)} ${unit}`);
};
// bookshelf-scene.js `packRows` and `motionKey`.
function packRows(rows){
 const packed=new Float64Array(rows.length*7);
 for(let index=0;index<rows.length;index++){
  const {top,bottom,left,right,ceiling,padding}=rows[index],at=index*7;
  packed[at]=Number(top);packed[at+1]=Number(bottom);packed[at+2]=Number(left);packed[at+3]=Number(right);
  packed[at+4]=Number(ceiling??top);packed[at+5]=Number(padding);
  packed[at+6]=(left!==undefined?1:0)|(right!==undefined?2:0)|(ceiling!=null?4:0)|(padding!==undefined?8:0);
 }
 return packed;
}
const motionKey=entry=>entry.kind==='plant'||entry.kind==='lamp'?entry.key:entry.book?.driveFileId?`book:drive:${entry.book.driveFileId}`:null;
const rows=Array.from({length:5},(_,index)=>({top:20+index*220,bottom:220+index*220,left:index%2?300:0,right:index%2?600:300}));
for(const count of [40,120,300]){
 const make=()=>Array.from({length:count},(_,index)=>index%9===0?{kind:'plant',key:`plant:${index}`,shelf:index%5}:{book:{driveFileId:`d${index}`},shelf:index%5});
 const lists=[make(),make()];
 const host=createSceneMotionFrame(rust,motionKey),native=new rust.RustSceneMotionFrame(),names=[null],numbers=new Map();
 let stale=true,entries=lists[0];
 const tell=()=>{
  stale=false;
  const keys=entries.map(motionKey);
  native.register(keys,Float64Array.from(entries,entry=>entry.shelf||0));
  native.identify(Uint32Array.from(keys,key=>{
   if(typeof key!=='string'||!key)return 0;
   let number=numbers.get(key);
   if(number===undefined){number=names.length;names.push(key);numbers.set(key,number);}
   return number;
  }));
  native.bays(packRows(rows),600,1000);
 };
 host.prepare(entries,rows,600,1000);tell();
 assert.deepEqual([...new Float64Array(native.memory().buffer,native.rows_ptr(),15)],[...new Float64Array(host.native.memory().buffer,host.native.rows_ptr(),15)]);
 compare(`shared keys and bays, a steady frame (${count} entries)`,()=>host.prepare(entries,rows,600,1000),()=>{if(stale)tell();},200000);
 compare(`shared keys and bays, a layout's first frame (${count} entries)`,i=>host.prepare(lists[i&1],rows,600,1000),i=>{entries=lists[i&1];stale=true;if(stale)tell();},2000);
 host.free();native.free();
}
{
 const host=createFoliageFrame(rust),state=host.createState(),after=new rust.RustFoliageState(),entries=new rust.RustSceneEntryFrame();
 entries.resize(8);
 const model=new THREE.Object3D(),turn=new THREE.Quaternion().setFromEuler(new THREE.Euler(.1,-.6,0)),rect={left:40,right:190,top:10,bottom:230,width:150,height:220};
 model.position.set(120,-400,10);model.updateMatrix();
 new Float64Array(entries.memory().buffer,entries.output_ptr()+8*(3*70+58),6).set([rect.left,rect.right,rect.top,rect.bottom,rect.width,rect.height]);
 let posed=null;
 const before=()=>state.pose(model,turn,rect);
 const leaf=new Float64Array(entries.memory().buffer,entries.shown_ptr()+56,16);
 const now=()=>{leaf.set(model.matrix.elements);if(entries.foliagePose(after,3,turn.x,turn.y,turn.z,turn.w,posed!==model))posed=model;};
 assert.equal(before(),true);now();assert.equal(posed,model);assert.equal(before(),false);
 compare('a plant\'s foliage pose, a frame at rest',before,now,200000);
 let tick=0;
 compare('a plant\'s foliage pose, a frame that moves it',()=>{model.matrix.elements[12]=++tick;before();},()=>{model.matrix.elements[12]=++tick;now();},200000);
 host.free();after.free();entries.free();
}
{
 const core=(await WebAssembly.instantiate(readFileSync('src/wasm/inhouse_read_core.wasm'),{})).instance.exports;
 // shelf-pixel-origin.js, as the scene imported it.
 const shelfPixelOffset=(top,width,height,ratio)=>{
  if(![top,width,height,ratio].every(Number.isFinite))return 0;
  if(typeof core?.shelf_pixel_offset!=='function')throw new Error('The shelf origin needs the Rust core');
  return core.shelf_pixel_offset(top,width,height,ratio);
 };
 const view=new rust.RustScene(390,1200,390,250,false,false,0);
 for(const top of [61,132,61.5,-3.75,100.25])assert.ok(Object.is(view.pixelOffset(top,784,1.5),shelfPixelOffset(top,390,784,1.5)));
 compare('the stage\'s pixel origin, an aligned top',()=>shelfPixelOffset(132,390,784,1.5),()=>view.pixelOffset(132,784,1.5),500000);
 compare('the stage\'s pixel origin, a top that is searched',i=>shelfPixelOffset(61+(i&3),390,784,1.5),i=>view.pixelOffset(61+(i&3),784,1.5),500000);
 view.free();
}
