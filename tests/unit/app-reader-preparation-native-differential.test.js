import {it, expect, vi} from 'vitest';
import * as reference from './helpers/reference-app-reader-preparation.js';
import {rustShelf} from './helpers/rust-shelf-ready.js';
import {createLegacyPreparedPageCache,legacyPageKeyMismatch,createStageGate as frozenStageGate} from './helpers/reference-prepared-page.js';
// The prepared page and its gate are part of the flows now (rust-ui/src/prepared_page.rs, stage_gate.rs): the frozen
// flows get the frozen JavaScript cache and gate, and what the cache holds at the end is compared with the
// application's record (state.preparedPage).
const EMPTY={generation:0,entry:null,lastBookId:null,lastDiscard:null};

const scope=(env,fn)=>new Function('env',`with(env){return (${fn.toString()})}`)(env);
const flush=async()=>{for(let n=0;n<30;n++)await Promise.resolve()};
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return{promise,resolve,reject}};
function fixture(native, options={}, module=rustShelf) {
 const events=[], state={preparationGeneration:4,requestedPreparationId:null,activePreparedBookId:null,currentBookId:'book',readerPreparationQueue:Promise.resolve(),restoringProgress:false,pageGate:null,shelf:null};
 const record={id:'book',locator:{kind:'pdf-page',value:3},progressFraction:.3};
 const book={id:'book',sourceType:options.source||'local',name:'book.pdf',content:options.noContent?null:new Blob(['book'],{type:'application/pdf'})};
 const snapshot={sourceType:'pdf-canvas',id:'snapshot'},bounds={left:2,top:3,width:400,height:700};
 const fileWait=options.pendingFile?deferred():null,snapshotWait=options.pendingSnapshot?deferred():null;
 const cache=createLegacyPreparedPageCache();
 const interrupt=key=>{if(options.supersedeAt===key)state.preparationGeneration++;if(options.invalidateAt===key){if(native)module.prepared_page('invalidate',state.preparedPage,'resize');else cache.invalidate('resize')}};
 const env={...{window,document},book,library:{async get(id){events.push(['get',id]);interrupt('get');return options.missingRecord?null:record}},
  preparedBooks:new Map(),progressWrites:new Map(),
  needsDriveDownload:()=>!!options.download,hasDriveSession:()=>!options.signedOut,
  cloudSync:{downloadForOffline(b){events.push(['download',b.id]);if(options.downloadThrow)throw Error('download');return fileWait?.promise||(options.downloadError?Promise.reject(Error('download')):Promise.resolve(new File(['remote'],'remote.pdf')))}},
  async openFile(file,settings){events.push(['open',file.name,file.type,file.size,settings]);interrupt('open');if(options.openError)throw Error('open');return !options.notOpened},
  reader:{epoch:7,location:{fraction:.3,locator:record.locator},async goToLocator(...args){events.push(['restore',...args,state.restoringProgress]);interrupt('restore');if(options.restoreError)throw Error('restore')},async getPageSnapshot(settings){events.push(['snapshot',settings]);interrupt('snapshot');if(options.snapshotError)throw Error('snapshot');if(options.resize)bounds.width++;if(options.preferencesChange)env.readingExperience.preferences.fontSize++;return snapshotWait?.promise||(options.noSnapshot?null:snapshot)}},
  readingExperience:{preferences:{fontSize:18}},els:{readerViewport:{getBoundingClientRect:()=>({...bounds})}},
  getComputedStyle:()=>({filter:'none'}),markTiming:name=>events.push(['timing',name]),
  console:{warn:(label,error)=>events.push(['warning',label,error.message])},
  idleSlice:async()=>{events.push(['idle'])},createStageGate:(settled,settings)=>frozenStageGate(settled,settings),
  preparedPages:{...cache,isReady:()=>true,whenReady:async()=>true,get lastDiscard(){return cache.lastDiscard}},
  pageKeyMismatch:legacyPageKeyMismatch
 };
 if(options.progressPending)env.progressWrites.set('book',Promise.reject(Error('progress')));
 state.shelf=options.noShelf?null:{async prepareOpeningPage(id,page,idle){events.push(['warm',id,page,typeof idle]);if(options.warmError)throw Error('warm')}};
 for(const key of Object.keys(state))Object.defineProperty(env,key,{get:()=>state[key],set:value=>state[key]=value,configurable:true});
// The module reports to the page's console itself (rust-ui/src/app_report.rs): it is heard through this fixture's.
 vi.spyOn(console,'warn').mockImplementation((...args)=>env.console.warn(...args));
 const host={...env,state,ignorePreparationError:()=>{},warnPagePreparation:error=>env.console.warn('No se pudo preparar la página guardada de antemano:',error),
  later:(name,take,...head)=>(...tail)=>module[name](...head,...tail.slice(0,take))};
 const names={prepareBookOpen:'app_prepare_book',openPageGate:'app_open_page_gate',releasePageGate:'app_release_page_gate',supersedePreparation:'app_supersede_preparation',dismissPreparedPage:'app_dismiss_prepared_page',pageKeyFor:'app_page_key',restoreAndSnapshot:'app_restore_and_snapshot',preparePageStage:'app_prepare_page_stage',openingPageSnapshot:'app_opening_page_snapshot'};
 for(const[key,exported]of Object.entries(names))env[key]=native?(...args)=>module[exported](host,...args):scope(env,reference[key]);
 if(native)env.prepareBookOpen=(b,{settled}={})=>module.app_prepare_book(host,b,settled);
 return {env,host,state,events,book,record,snapshot,bounds,fileWait,snapshotWait,
  waitGate:()=>native?module.prepared_page('wait',state.pageGate.gate):state.pageGate.gate.wait(),
  summary:()=>({events:[...events],cache:native?{...(state.preparedPage??EMPTY)}:cache.transferState(),generation:state.preparationGeneration,requested:state.requestedPreparationId,active:state.activePreparedBookId,restoring:state.restoringProgress,prepared:[...env.preparedBooks.keys()]})};
}
async function run(native,options={}){
 const f=fixture(native,options);let value,error,syncError,task;
 try{task=f.env.prepareBookOpen(f.book,{settled:options.settledRejects?Promise.reject(Error('cancelled')):'settled' in options?options.settled:'settled'})}catch(e){syncError=e.message}
 const started=f.summary();try{value=await task}catch(e){error=e.message}
 await f.state.readerPreparationQueue;await flush();return{started,finished:f.summary(),value,error,syncError};
}

for(const options of [{},{source:'drive'},{source:'other'}, {noContent:true}, {noContent:true,download:true,source:'drive'},
 {noContent:true,download:true,signedOut:true},{noContent:true,download:true,downloadError:true},{noContent:true,download:true,downloadThrow:true},
 {progressPending:true},{missingRecord:true},{notOpened:true},{openError:true},
 ...['get','open','restore','snapshot'].map(supersedeAt=>({supersedeAt})),
 {settled:false},{settled:0},{settled:undefined},{settled:null},{settledRejects:true},{noSnapshot:true},
 ...['get','restore','snapshot'].map(invalidateAt=>({invalidateAt})),
 {resize:true},{preferencesChange:true},{restoreError:true},{snapshotError:true},{warmError:true},{noShelf:true}])
 it(`matches selection preparation and cancellation ${JSON.stringify(options)}`,async()=>{
  expect(await run(true,options)).toEqual(await run(false,options));
 });

it('reprepares the same selected engine without downloading or opening it again',async()=>{
 const run=async native=>{const f=fixture(native);await f.env.prepareBookOpen(f.book);f.env.dismissPreparedPage();await f.env.prepareBookOpen(f.book,{settled:true});const page=await f.env.openingPageSnapshot('book',f.record);return{...f.summary(),page}};
 expect(await run(true)).toEqual(await run(false));
});

it('serializes two selections and cancels stale files before replacing the shared engine',async()=>{
 const run=async native=>{const f=fixture(native,{noContent:true,download:true,pendingFile:true});const a=f.env.prepareBookOpen(f.book);f.book={id:'second',sourceType:'local',content:new Blob(['next']),name:'next.pdf'};const b=f.env.prepareBookOpen(f.book);f.fileWait.resolve(new File(['old'],'old.pdf'));await Promise.all([a,b]);return f.summary()};
 expect(await run(true)).toEqual(await run(false));
});

it('dismisses a waiting page without consuming or opening a stale snapshot',async()=>{
 const run=async native=>{const f=fixture(native,{pendingSnapshot:true});const task=f.env.prepareBookOpen(f.book);await flush();f.env.supersedePreparation('new-selection');f.snapshotWait.resolve(f.snapshot);await task;return f.summary()};
 expect(await run(true)).toEqual(await run(false));
});

it('only releases the matching stage gate and preserves fallback snapshot restoration',async()=>{
 const run=async native=>{
  const f=fixture(native),never=new Promise(()=>{}),waiting=()=>Promise.race([f.waitGate(),flush().then(()=>'waiting')]);
  f.env.openPageGate('book',never);const first=state=>state.pageGate.gate;const gate=first(f.state);f.env.releasePageGate('open','other');const other=await waiting();
  f.env.releasePageGate('open','book');const opened=await waiting();f.env.releasePageGate('dismissed');const again=await waiting();
  f.env.openPageGate('second',never);const replaced=f.state.pageGate.gate!==gate&&f.state.pageGate.bookId==='second';f.env.releasePageGate('dismissed');const dismissed=await waiting();
  f.env.openPageGate('third',never);f.env.releasePageGate('open');const any=await waiting();
  const page=await f.env.openingPageSnapshot('book',f.record);return{...f.summary(),page,other,opened,again,replaced,dismissed,any}};
 const native=await run(true);expect(native).toEqual(await run(false));expect([native.other,native.opened,native.again,native.replaced,native.dismissed,native.any]).toEqual(['waiting',true,true,true,false,true]);
});

it('hands the prepared page to the opening exactly once, and only while its key holds',async()=>{
 const run=async(native,change)=>{const f=fixture(native);f.snapshot.displayBounds={top:9,left:4,width:300,height:500};await f.env.prepareBookOpen(f.book,{settled:true});const held=f.summary().cache.entry?.snapshot;change?.(f);
  const first=await f.env.openingPageSnapshot('book',f.record),reused=f.events.filter(e=>e[1]==='page-reused').length,second=await f.env.openingPageSnapshot('book',f.record);return{...f.summary(),held,first,second,reused}};
 const moved=f=>{f.bounds.left+=7;f.bounds.top-=2};
 for(const change of [null,moved,f=>{f.bounds.width+=2},f=>{f.env.readingExperience.preferences.fontSize++},f=>{f.env.reader.epoch++},f=>{f.record.progressFraction=.4}]){
  const native=await run(true,change);expect(native).toEqual(await run(false,change));expect(native.held).toBe(native.first);expect(native.reused).toBe(!change||change===moved?1:0);expect(native.cache.entry).toBeNull();
  // A page whose viewport only moved lands where the viewport is now.
  expect(native.first.displayBounds).toEqual(change===moved?{top:7,left:11,width:300,height:500}:{top:9,left:4,width:300,height:500});expect(Object.keys(native.first.displayBounds)).toEqual(['top','left','width','height'])}
});

it('preserves viewport, theme, UTF-16 identity and nullish saved-location cache keys',()=>{
 const a=fixture(true),b=fixture(false);
 for(const id of ['book','🕯️書\ud800',null,0])for(const record of [null,undefined,{}, {locator:null,progressFraction:NaN},{locator:0,progressFraction:.7}])
  expect(a.env.pageKeyFor(id,record)).toEqual(b.env.pageKeyFor(id,record));
});

it('releases native handles after successful, superseded and failed preparations',async()=>{
 await run(true);const before=rustShelf.shelf_live_handles(),callbacks=rustShelf.shelf_pending_callbacks();
 for(let n=0;n<60;n++)await run(true,[{}, {openError:true},{restoreError:true},{supersedeAt:'get'},{warmError:true}][n%5]);
 await flush();expect(rustShelf.shelf_live_handles()).toBe(before);expect(rustShelf.shelf_pending_callbacks()).toBe(callbacks);
});

it('supports the reader UI module without requiring a second Shelf download',async()=>{
 const {rustUI}=await import('./helpers/rust-ui-ready.js');const f=fixture(true,{},rustUI);
 expect(await f.env.prepareBookOpen(f.book)).toBe(true);expect(f.events.some(e=>e[0]==='warm')).toBe(true);
});
