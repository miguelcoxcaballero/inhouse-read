import {it, expect} from 'vitest';
import * as reference from './helpers/reference-app-reader-preparation.js';
import {rustShelf} from './helpers/rust-shelf-ready.js';

const scope=(env,fn)=>new Function('env',`with(env){return (${fn.toString()})}`)(env);
const flush=async()=>{for(let n=0;n<30;n++)await Promise.resolve()};
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return{promise,resolve,reject}};
function fixture(native, options={}, module=rustShelf) {
 const events=[], state={preparationGeneration:4,requestedPreparationId:null,activePreparedBookId:null,currentBookId:'book',readerPreparationQueue:Promise.resolve(),restoringProgress:false,pageGate:null,shelf:null};
 const record={id:'book',locator:{kind:'pdf-page',value:3},progressFraction:.3};
 const book={id:'book',sourceType:options.source||'local',name:'book.pdf',content:options.noContent?null:new Blob(['book'],{type:'application/pdf'})};
 const snapshot={sourceType:'pdf-canvas',id:'snapshot'},bounds={left:2,top:3,width:400,height:700};
 const gateWait=options.pendingGate?deferred():null,fileWait=options.pendingFile?deferred():null,snapshotWait=options.pendingSnapshot?deferred():null;
 let stored=null, ticket=0;
 const interrupt=key=>{if(options.supersedeAt===key)state.preparationGeneration++};
 const env={...{window,document},book,library:{async get(id){events.push(['get',id]);interrupt('get');return options.missingRecord?null:record}},
  preparedBooks:new Map(),progressWrites:new Map(),
  needsDriveDownload:()=>!!options.download,hasDriveSession:()=>!options.signedOut,
  cloudSync:{downloadForOffline(b){events.push(['download',b.id]);if(options.downloadThrow)throw Error('download');return fileWait?.promise||(options.downloadError?Promise.reject(Error('download')):Promise.resolve(new File(['remote'],'remote.pdf')))}},
  async openFile(file,settings){events.push(['open',file.name,file.type,file.size,settings]);interrupt('open');if(options.openError)throw Error('open');return !options.notOpened},
  reader:{epoch:7,location:{fraction:.3,locator:record.locator},async goToLocator(...args){events.push(['restore',...args,state.restoringProgress]);interrupt('restore');if(options.restoreError)throw Error('restore')},async getPageSnapshot(settings){events.push(['snapshot',settings]);interrupt('snapshot');if(options.snapshotError)throw Error('snapshot');if(options.resize)bounds.width++;if(options.preferencesChange)env.readingExperience.preferences.fontSize++;return snapshotWait?.promise||(options.noSnapshot?null:snapshot)}},
  readingExperience:{preferences:{fontSize:18}},els:{readerViewport:{getBoundingClientRect:()=>({...bounds})}},
  getComputedStyle:()=>({filter:'none'}),markTiming:name=>events.push(['timing',name]),
  console:{warn:(label,error)=>events.push(['warning',label,error.message])},
  idleSlice:async()=>{},createStageGate(settled){events.push(['gate',settled]);return{async wait(){events.push(['wait']);return gateWait?.promise??!options.dismissed},release(reason){events.push(['release',reason]);gateWait?.resolve(reason==='open')}}},
  preparedPages:{invalidate(reason){events.push(['invalidate',reason]);stored=null;ticket++},isReady:()=>!options.cachePending,async whenReady(){events.push(['cache-ready']);return !options.cacheUnavailable},begin(id){events.push(['begin',id]);return++ticket},isCurrent:t=>t===ticket&&!options.staleTicket,store(t,key,page){events.push(['store',t,key,page]);if(options.storeRejected)return false;stored=page;return true},take(key){events.push(['take',key]);const page=stored;stored=null;return page}},
  pageKeyMismatch(a,b){events.push(['compare']);return a.viewport.width!==b.viewport.width||a.preferences!==b.preferences||!!options.mismatch}
 };
 if(options.progressPending)env.progressWrites.set('book',Promise.reject(Error('progress')));
 state.shelf=options.noShelf?null:{async prepareOpeningPage(id,page,idle){events.push(['warm',id,page,typeof idle]);if(options.warmError)throw Error('warm')}};
 for(const key of Object.keys(state))Object.defineProperty(env,key,{get:()=>state[key],set:value=>state[key]=value,configurable:true});
 const host={...env,state,ignorePreparationError:()=>{},warnPagePreparation:error=>env.console.warn('No se pudo preparar la página guardada de antemano:',error),
  createStageGate:settled=>env.createStageGate(settled),
  preparationRunner:(b,g,gate,files)=>()=>module.app_run_preparation(host,b,g,gate,files),
  reprepareRunner:(b,g,gate)=>ready=>module.app_reprepare_page(host,b,g,gate,ready)};
 const names={prepareBookOpen:'app_prepare_book',openPageGate:'app_open_page_gate',releasePageGate:'app_release_page_gate',supersedePreparation:'app_supersede_preparation',dismissPreparedPage:'app_dismiss_prepared_page',pageKeyFor:'app_page_key',restoreAndSnapshot:'app_restore_and_snapshot',preparePageStage:'app_prepare_page_stage',openingPageSnapshot:'app_opening_page_snapshot'};
 for(const[key,exported]of Object.entries(names))env[key]=native?(...args)=>module[exported](host,...args):scope(env,reference[key]);
 if(native)env.prepareBookOpen=(b,{settled}={})=>module.app_prepare_book(host,b,settled);
 return {env,host,state,events,book,record,snapshot,gateWait,fileWait,snapshotWait,
  summary:()=>({events:[...events],generation:state.preparationGeneration,requested:state.requestedPreparationId,active:state.activePreparedBookId,restoring:state.restoringProgress,prepared:[...env.preparedBooks.keys()]})};
}
async function run(native,options={}){
 const f=fixture(native,options);let value,error,syncError,task;
 try{task=f.env.prepareBookOpen(f.book,{settled:'settled'})}catch(e){syncError=e.message}
 const started=f.summary();try{value=await task}catch(e){error=e.message}
 await f.state.readerPreparationQueue;await flush();return{started,finished:f.summary(),value,error,syncError};
}

for(const options of [{},{source:'drive'},{source:'other'}, {noContent:true}, {noContent:true,download:true,source:'drive'},
 {noContent:true,download:true,signedOut:true},{noContent:true,download:true,downloadError:true},{noContent:true,download:true,downloadThrow:true},
 {progressPending:true},{missingRecord:true},{notOpened:true},{openError:true},
 ...['get','open','restore','snapshot'].map(supersedeAt=>({supersedeAt})),
 {dismissed:true},{cachePending:true},{cachePending:true,cacheUnavailable:true},{noSnapshot:true},{staleTicket:true},
 {resize:true},{preferencesChange:true},{mismatch:true},{storeRejected:true},{restoreError:true},{snapshotError:true},{warmError:true},{noShelf:true}])
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
 const run=async native=>{const f=fixture(native);f.env.openPageGate('book','settled');f.env.releasePageGate('open','other');f.env.releasePageGate('open','book');f.env.releasePageGate('dismissed');const page=await f.env.openingPageSnapshot('book',f.record);return{...f.summary(),page}};
 expect(await run(true)).toEqual(await run(false));
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
