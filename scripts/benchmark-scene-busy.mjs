// What the scene asks its view before scheduling or deferring a frame: five getters in a row (three
// in hasOngoingMotion) against the one `busy` read. At rest every getter answers false, so the
// former chain made all its crossings. Node/WASM. Interleaved rounds, medians.
// node scripts/benchmark-scene-busy.mjs
import {readFileSync} from 'node:fs';
import {performance} from 'node:perf_hooks';
const rust=await import('../src/wasm/shelf/inhouse_read_shelf.js');
rust.initSync({module:readFileSync(new URL('../src/wasm/shelf/inhouse_read_shelf_bg.wasm',import.meta.url))});
const s=new rust.RustScene(600,900,600,250,false,false,0);
const median=a=>a.toSorted((x,y)=>x-y)[Math.floor(a.length/2)];
let sink=0;const olds=[],news=[],olds3=[],news3=[],count=200000;
for(let round=0;round<25;round++){
 let t=performance.now();for(let i=0;i<count;i++)if(s.turning||s.reordering||s.trashEasing||s.moving||s.hasDrop)sink++;olds.push((performance.now()-t)/count*1e6);
 t=performance.now();for(let i=0;i<count;i++)if(s.busy)sink++;news.push((performance.now()-t)/count*1e6);
 t=performance.now();for(let i=0;i<count;i++)if(s.turning||s.reordering||s.trashEasing)sink++;olds3.push((performance.now()-t)/count*1e6);
 t=performance.now();for(let i=0;i<count;i++)if(s.busy&7)sink++;news3.push((performance.now()-t)/count*1e6);
}
console.log(`five getters at rest: ${median(olds).toFixed(1)} -> ${median(news).toFixed(1)} ns; three: ${median(olds3).toFixed(1)} -> ${median(news3).toFixed(1)} ns (${sink})`);
