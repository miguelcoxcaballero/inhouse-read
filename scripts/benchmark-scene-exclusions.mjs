// The rectangles a plant's foliage takes no taps in, once per frame with a plant in view.
// `previous` is the frozen JavaScript of 1.7.333 (tests/unit/helpers/reference-foliage-areas.js):
// a scan of every entry's object and a copy of each rectangle into the foliage arena. `current`:
// RustSceneEntryFrame#exclusions reads both arenas in one call. The arena's rectangles are
// asserted equal first. Node/WASM, no DOM. Interleaved rounds, medians.
// node scripts/benchmark-scene-exclusions.mjs
import {readFileSync} from 'node:fs';
import {performance} from 'node:perf_hooks';
import assert from 'node:assert/strict';
import * as rust from '../src/wasm/shelf/inhouse_read_shelf.js';
import {createFoliageFrame} from '../src/js/foliage-frame.js';
import {createSceneEntryFrame,ENTRY_OUTPUT,ENTRY_STATE,HIT_INPUT,HIT_OUTPUT} from '../src/js/scene-entry-frame.js';
import {exclusionRects,prepareAreas} from '../tests/unit/helpers/reference-foliage-areas.js';
rust.initSync({module:readFileSync(new URL('../src/wasm/shelf/inhouse_read_shelf_bg.wasm',import.meta.url))});
const median=a=>a.toSorted((x,y)=>x-y)[Math.floor(a.length/2)],results=[];
for(const count of [40,120,300])for(const turned of [false,true]){
 const entryFrame=createSceneEntryFrame(rust),old=createFoliageFrame(rust),now=createFoliageFrame(rust);
 const entries=Array.from({length:count},()=>({row:-1}));
 entryFrame.bind(entries,false);entryFrame.refresh();
 const {state,output,hitInput,hitOutput}=entryFrame;
 for(let i=0;i<count;i++){
  const entry=entries[i],plant=i%10===3,away=i%17===5,visible=i%7!==6;
  entry.kind=plant?'plant':i%13===4?'lamp':'book';entry.model={visible};entry.flags={away,dragging:false,lifted:false,pressed:false};
  entry.rect={left:i*9,right:i*9+8,top:20+i%3*200,bottom:200+i%3*200,width:8,height:180,closest:1};
  entry.hitRect={left:i*9-18,right:i*9+26,top:20+i%3*200,bottom:200+i%3*200,width:44,height:180,closest:1};
  state[i*ENTRY_STATE]=plant?1:entry.kind==='lamp'?2:0;state[i*ENTRY_STATE+2]=away?1:0;
  ['left','right','top','bottom','width','height','closest'].forEach((key,at)=>{output[i*ENTRY_OUTPUT+58+at]=entry.rect[key];hitOutput[i*HIT_OUTPUT+1+at]=entry.hitRect[key];});
  hitInput[i*HIT_INPUT]=1|(visible?64:0);
 }
 const progress=turned?1:0;
 const previous=()=>prepareAreas(old,exclusionRects(entries,progress));
 const current=()=>entryFrame.exclusions(now.native,progress>.04);
 previous();current();
 const view=frame=>[...new Float64Array(frame.native.memory().buffer,frame.native.input_ptr(),frame.native.count*4)];
 assert.deepEqual(view(now),view(old));assert.ok(now.native.count>count/2);
 const loops=2000;
 const time=run=>{const start=performance.now();for(let i=0;i<loops;i++)run();return(performance.now()-start)/loops*1000;};
 for(let i=0;i<5;i++){time(previous);time(current);}
 const a=[],b=[];
 for(let round=0;round<21;round++){if(round%2){b.push(time(current));a.push(time(previous));}else{a.push(time(previous));b.push(time(current));}}
 results.push({entries:count,view:turned?'turned':'frontal',javascriptUs:+median(a).toFixed(3),rustUs:+median(b).toFixed(3),speedup:+(median(a)/median(b)).toFixed(2)});
 entryFrame.free();old.free();now.free();
}
console.log(JSON.stringify({date:new Date().toISOString(),scope:'the foliage\'s exclusion rectangles per frame, Node/WASM',results},null,1));
