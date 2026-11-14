// The two users of rust-ui/src/app_report.rs that run often: a relocation of the open book (every page turn) and
// the shelf refresh's loop over the library (every book at start-up). Two builds of the shelf module are driven
// with the same calls in interleaved rounds; medians. Node/WASM, no DOM.
// node scripts/benchmark-app-report.mjs <dir of the build before> [dir of the build now]
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const load=async dir=>{const module=await import(pathToFileURL(resolve(dir)+'/inhouse_read_shelf.js').href);module.initSync({module:readFileSync(resolve(dir)+'/inhouse_read_shelf_bg.wasm')});return module;};
const before=await load(process.argv[2]),now=await load(process.argv[3]||'src/wasm/shelf');
const median=a=>a.toSorted((x,y)=>x-y)[Math.floor(a.length/2)];
const clockNs=()=>Number(process.hrtime.bigint());
const report=(label,old,next,unit)=>console.log(`${label.padEnd(40)} before ${median(old).toFixed(3).padStart(9)} ${unit}   now ${median(next).toFixed(3).padStart(9)} ${unit}   ${(median(next)/median(old)*100).toFixed(0)} %`);
// A settled write that takes a handler and does nothing with it, so only the module's own work is timed.
const written={catch(){return written;}};
{
 const make=rust=>{
  const state={currentBookId:'book',restoringProgress:false,closingReader:false};
  const host={els:{readerProgressFill:{style:{}}},readingExperience:{relocate(){}},reader:{format:{engine:'foliate'}},
   progressWrites:{updateProgress:()=>written},warnReaderProgress(){},state};
  const relocation={fraction:.6,cfi:'epubcfi(/6/8!/4/2)',index:3,textOffset:0};
  return()=>rust.app_reader_relocate(host,relocation);
 };
 const a=make(before),b=make(now),loops=4000;
 const time=fn=>{const start=clockNs();for(let i=0;i<loops;i++)fn();return(clockNs()-start)/loops/1000;};
 for(let i=0;i<10;i++){time(a);time(b);}
 const old=[],next=[];
 for(let round=0;round<41;round++){if(round%2){next.push(time(b));old.push(time(a));}else{old.push(time(a));next.push(time(b));}}
 report('relocation of the open book',old,next,'us');
}
for(const count of [40,300]){
 const books=Array.from({length:count},(_,n)=>({id:`local:libro-${n}.epub:${1000+n}`,sourceType:'local',name:`libro-${n}.epub`,title:`Título ${n}`,author:`Autora ${n}`,addedAt:n,lastOpenedAt:null}));
 const make=rust=>{
  const shelf={isInteracting:false,update(){},queueRefresh(){}};
  const state={appDisposed:false,closingReader:false,cloudRoomChanged:false,shelf,shelfRecords:null,lengthStatusVersion:2,shelfLengthStatusVersion:2};
  const host={state,els:{readerScreen:{hidden:true}},library:{patch:async(id,patch)=>({...books.find(book=>book.id===id),...patch})},
   wordCountQueue:{ensure:()=>written},nativeImportShelfGate:{deferRefresh:()=>false},libraryHost:{},createShelf:()=>shelf,warnPreparation(){}};
  return()=>{state.shelfRecords=null;return rust.app_refresh_after_load(host,books,undefined,true);};
 };
 const a=make(before),b=make(now),loops=40;
 const time=async fn=>{const start=clockNs();for(let i=0;i<loops;i++)await fn();return(clockNs()-start)/loops/1e6;};
 for(let i=0;i<6;i++){await time(a);await time(b);}
 const old=[],next=[];
 for(let round=0;round<41;round++){if(round%2){next.push(await time(b));old.push(await time(a));}else{old.push(await time(a));next.push(await time(b));}}
 report(`shelf refresh after the read, ${count} books`,old,next,'ms');
}
