// The reading-progress queue (every relocation of the open book saves its place through it; a
// setting of the open book or a recoloured cover goes through `patch`). Three queues, interleaved
// rounds, medians. Node/WASM, no DOM, a library that answers at once:
//  - the frozen JavaScript queue (tests/unit/helpers/reference-reading-progress-queue.js), which the
//    app used until the reader's module was in;
//  - what the app used from then on, i.e. for every book that was read: the previous
//    src/js/reading-progress-queue.js (copied below) over RustReadingProgressQueue of the UI build;
//  - the app's queue now: RustReadingProgressQueue over the library itself, of the shelf build.
// node scripts/benchmark-progress-queue.mjs <dir of the UI build before> [dir of the shelf build]
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createLegacyReadingProgressQueue} from '../tests/unit/helpers/reference-reading-progress-queue.js';
const load=async(dir,name)=>{const module=await import(pathToFileURL(resolve(dir)+`/inhouse_read_${name}.js`).href);module.initSync({module:readFileSync(resolve(dir)+`/inhouse_read_${name}_bg.wasm`)});return module;};
const ui=await load(process.argv[2],'ui'),rust=await load(process.argv[3]||'src/wasm/shelf','shelf');
const production=(library,{onSaved=()=>{}}={})=>{let queue;const use=()=>queue||=new rust.RustReadingProgressQueue(library,onSaved);
 return{updateProgress:(id,fraction,locator)=>use().updateProgress(id,fraction,locator),patch:(id,fields)=>use().patch(id,fields),get:id=>use().get(id)};};
// src/js/reading-progress-queue.js as it was, with the module's queue adopted (the legacy owner never used).
function previous(library,{onSaved=()=>{}}={}){
 const owners=new Map(),observed=new WeakSet()
 let native
 const ownerFor=id=>{
  const owner=owners.get(id)
  if(owner)return owner
  const Native=ui.RustReadingProgressQueue
  if(Native&&!native)native=new Native(
   (id,fraction,locator)=>library.updateProgress(id,fraction,locator),
   (id,fields)=>library.patch(id,{...fields,...(Object.keys(fields).some(k=>/^(spine|cover|shelf|pageEdge)/.test(k))?{}:{progressUpdatedAt:Date.now(),progressDirty:true})}),onSaved)
  const next=native;owners.set(id,next);return next
 }
 const observe=(id,owner,promise)=>{
  if(!observed.has(promise)){
   observed.add(promise)
   const settled=()=>{if(owners.get(id)===owner&&owner.get(id)===undefined)owners.delete(id)}
   promise.then(settled,settled)
  }
  return promise
 }
 return {
  updateProgress(id,fraction,locator){const owner=ownerFor(id);return observe(id,owner,owner.updateProgress(id,fraction,locator))},
  patch(id,fields){const owner=ownerFor(id);return observe(id,owner,owner.patch(id,owner===native?{...fields}:fields))},
  get(id){const owner=owners.get(id),promise=owner?.get(id);if(promise===undefined)owners.delete(id);return promise}
 }
}
const median=a=>a.toSorted((x,y)=>x-y)[Math.floor(a.length/2)];
const clockNs=()=>Number(process.hrtime.bigint());
const record={id:'book'},library={updateProgress:()=>record,patch:()=>record},locator={kind:'cfi',value:'epubcfi(/6/8!/4/2)',textOffset:12};
const fields={readingTheme:'night',fontSize:18,returnLocation:locator},look={spineColor:'#445566',coverTilt:.2};
const cases={
 'a saved position, awaited':async queue=>{await queue.updateProgress('book',.5,locator);},
 '100 positions in one task, awaited':async queue=>{let last;for(let i=0;i<100;i++)last=queue.updateProgress('book',i/100,locator);await last;},
 'asking for a position (no wait)':null,
 'a reading setting, awaited':async queue=>{await queue.patch('book',fields);},
 'a cover colour, awaited':async queue=>{await queue.patch('book',look);},
};
for(const [label,run] of Object.entries(cases)){
 const queues=[createLegacyReadingProgressQueue(library),previous(library),production(library)],loops=label.startsWith('100')?200:2000;
 const time=run?async queue=>{const start=clockNs();for(let i=0;i<loops;i++)await run(queue);return(clockNs()-start)/loops/1000;}
  // The synchronous part alone: what a page turn pays before it goes on (the write itself follows in a microtask).
  :async queue=>{let total=0;for(let i=0;i<loops;i++){const start=clockNs();const pending=queue.updateProgress('book',.5,locator);total+=clockNs()-start;await pending;}return total/loops/1000;};
 for(let i=0;i<6;i++)for(const queue of queues)await time(queue);
 const times=[[],[],[]];
 for(let round=0;round<41;round++)for(let turn=0;turn<3;turn++){const which=(turn+round)%3;times[which].push(await time(queues[which]));}
 const [frozen,before,now]=times.map(median);
 console.log(`${label.padEnd(36)} frozen JS ${frozen.toFixed(3).padStart(7)} us   before (JS + Rust) ${before.toFixed(3).padStart(7)} us   now ${now.toFixed(3).padStart(7)} us   ${(now/before*100).toFixed(0)} % of before`);
}
