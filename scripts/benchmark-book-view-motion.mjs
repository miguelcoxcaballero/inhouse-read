// CPU-only scheduler comparison; no Three, draw, pose computation or GPU work.
import{readFileSync}from'node:fs';
import * as native from'../src/wasm/shelf/inhouse_read_shelf.js';
import{referenceBookViewMotion}from'../tests/unit/helpers/reference-book-view-motion.js';
native.initSync({module:readFileSync(new URL('../src/wasm/shelf/inhouse_read_shelf_bg.wasm',import.meta.url))});
let next,id=0;globalThis.requestAnimationFrame=fn=>{next=fn;return++id;};globalThis.cancelAnimationFrame=()=>{};
const pose={x:0,y:0,scale:1,angle:0},frames=[{transform:pose},{transform:pose}],options={direct:false};
const host={createSampler:()=>({start(){},step:()=>.5,sample:()=>pose,dispose(){}}),draw(){},noop(){},position(){},measure(){},
 tick:native.book_view_motion_tick,cancel:native.book_view_motion_cancel,release:native.book_view_motion_release};
function run(isNative){
 const state=isNative?native.book_view_motion_state(host):referenceBookViewMotion(host);
 const animation=isNative?native.book_view_motion_start(state,frames,100000,null,null,options):state.start(frames,{duration:100000},null,options);
 for(let i=0;i<1000;i++)next();const start=performance.now();for(let i=0;i<20000;i++)next();const elapsed=(performance.now()-start)/20;
 animation.cancel();if(isNative)native.book_view_motion_dispose(state);else state.dispose();return elapsed;
}
for(let i=0;i<3;i++)console.log(JSON.stringify({unit:'microseconds/tick',original:run(false),rust:run(true)}));
