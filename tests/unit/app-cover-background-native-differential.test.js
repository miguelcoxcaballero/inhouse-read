// @vitest-environment node
import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {rustShelf} from './helpers/rust-shelf-ready.js';
import {extractCoverInBackground as reference} from './helpers/reference-app-cover-background.js';
const source=readFileSync('src/js/app.js','utf8'),start=source.indexOf('function extractCoverInBackground('),actual=source.slice(start,source.indexOf('\nconst coverBackgroundHost',start));
const scope=(env,fn)=>new Function('env',`with(env){return (${typeof fn==='string'?fn:fn.toString()})}`)(env);
const flush=async()=>{for(let n=0;n<40;n++)await Promise.resolve()};
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return{promise,resolve,reject}};
function fixture(native,options={},module=rustShelf){
 const events=[],state={appDisposed:!!options.disposed,closingReader:!!options.closing,currentBookId:options.otherBook?'other':'book:📖:\ud800'},cover={old:true},blob=options.noBlob?null:{size:options.emptyBlob?0:2048};
 const record={id:'book:📖:\ud800',format:options.format||'PDF',cover:options.existingCover?cover:null,contentRevision:options.noRevision?null:'revision'};
 if(options.coverReadFail){let reads=0;Object.defineProperty(record,'cover',{get(){if(++reads===options.coverReadFail)throw Error('cover-getter');return cover}});}
 const coverWait=options.pendingCover?deferred():null,bitmapWait=options.pendingBitmap?deferred():null,patchWait=options.pendingPatch?deferred():null;
 const fail=at=>{if(options.fail===at)throw Error(at)};
 const mutate=at=>{
  if(options.cancelAt===at)state.currentBookId='other';if(options.disposeAt===at)state.appDisposed=true;if(options.epochAt===at)env.reader.epoch++;
  if(options.abortAt===at)env.coverUpgrades.get(record.id)?.controller.abort();
  if(options.closeAt===at){state.closingReader=true;if(options.retained)env.coverUpgrades.get(record.id).retainedOnClose=true;if(options.returned)state.currentBookId=null;}
 };
 const bitmap={width:options.width??500,height:options.height??700,close(){events.push(['bitmap-close']);fail('bitmap-close')}};
 const env={...state,Date:{now:()=>777},console:{warn:(label,error)=>{events.push(['warning',label,error?.message??error]);fail('warning')}},coverUpgrades:new Map(),
  reader:{epoch:4,getCoverBlob(settings){events.push(['fetch',{retainOnClose:settings.retainOnClose,signal:settings.signal===env.coverUpgrades.get(record.id)?.controller.signal}]);mutate('fetch');fail('fetch-sync');return coverWait?.promise??(options.fail==='fetch'?Promise.reject(Error('fetch')):Promise.resolve(blob))}},
  library:{async patch(id,fields,settings){events.push(['patch',id,fields.cover===blob,fields.coverUpdatedAt]);mutate('patch');fail('patch');let latest={cover:options.latestCover?{}:null,contentRevision:options.latestRevision?'other':'revision'};let allowed=settings.ifCurrent(latest);events.push(['guard',allowed]);if(patchWait){await patchWait.promise;allowed=settings.ifCurrent(latest);events.push(['recheck',allowed]);}return allowed?{id}:null}},
  createImageBitmap:options.noBitmap?undefined:async value=>{events.push(['decode',value===cover]);mutate('decode');fail('decode');if(bitmapWait)await bitmapWait.promise;return bitmap},
  refreshShelf(){events.push(['refresh']);fail('refresh')},scheduleLibraryBackup(){events.push(['backup']);fail('backup')}
 };
 for(const key of Object.keys(state))Object.defineProperty(env,key,{get:()=>state[key],set:v=>state[key]=v,configurable:true});
 const host={reader:env.reader,coverUpgrades:env.coverUpgrades,library:env.library,refreshShelf:env.refreshShelf,scheduleLibraryBackup:env.scheduleLibraryBackup,global:{createImageBitmap:env.createImageBitmap},console:env.console,now:()=>env.Date.now(),state,
  measureSmallCover:bitmap=>module.app_cover_bitmap_small(bitmap),coverBitmapFailed:()=>module.app_cover_bitmap_failed(),
  coverPatchGuard:flight=>latest=>module.app_cover_patch_allowed(host,flight,latest),
  coverFlowCallbacks:flight=>({fetch:needed=>module.app_cover_fetch(host,flight,needed),persist:value=>module.app_cover_persist(host,flight,value),updated:value=>module.app_cover_updated(host,flight,value),failed:error=>module.app_cover_failed(host,flight,error),finish:()=>module.app_cover_finished(host,flight)})};
 env.bookDataModule=()=>module;env.coverBackgroundHost=host;
 const use=scope(env,native?actual:reference);const cached=Promise.resolve('cached');if(options.cached||options.oldEpoch)env.coverUpgrades.set(record.id,{epoch:options.oldEpoch?3:4,promise:cached});
 return{env,host,state,record,blob,coverWait,bitmapWait,patchWait,cached,open:()=>use(record),entry:()=>env.coverUpgrades.get(record.id),
  summary:()=>({events:[...events],state:{...state},epoch:env.reader.epoch,covers:[...env.coverUpgrades].map(([id,entry])=>({id,epoch:entry.epoch,first:entry.firstCover,retained:entry.retainedOnClose,aborted:entry.controller?.signal.aborted,hasPromise:!!entry.promise}))})};
}
async function run(native,options={}){
 const f=fixture(native,options);let task,value,error,syncError;try{task=f.open()}catch(e){syncError=e.message}const started=f.summary();try{value=await task}catch(e){error=e.message}await flush();return{started,finished:f.summary(),value,error,syncError};
}
for(const options of [{},{existingCover:true},{existingCover:true,width:900},{existingCover:true,height:800},{existingCover:true,format:'EPUB'},{existingCover:true,noBitmap:true},
 {format:'EPUB'},{cached:true},{oldEpoch:true},{closing:true},{otherBook:true},{disposed:true},{noBlob:true},{emptyBlob:true},
 {coverReadFail:1},{coverReadFail:2},{coverReadFail:3},{latestCover:true},{latestRevision:true},{latestRevision:true,noRevision:true},
 ...['decode','fetch-sync','fetch','patch','refresh','backup'].map(fail=>({fail,existingCover:fail==='decode'})),
 {fail:'bitmap-close',existingCover:true},
 ...['decode','fetch','patch'].map(cancelAt=>({cancelAt,existingCover:cancelAt==='decode'})),
 ...['decode','fetch','patch'].map(disposeAt=>({disposeAt,existingCover:disposeAt==='decode'})),
 ...['decode','fetch','patch'].map(epochAt=>({epochAt,existingCover:epochAt==='decode'})),
 {abortAt:'fetch'},{abortAt:'fetch',fail:'fetch'},
 {closeAt:'fetch'},{closeAt:'fetch',retained:true},{closeAt:'fetch',retained:true,returned:true}])
 it(`matches the complete background cover flow ${JSON.stringify(options)}`,async()=>expect(await run(true,options)).toEqual(await run(false,options)));
it('returns the very same pending or cached promise for repeated calls in an epoch',async()=>{
 for(const cached of [false,true]){
  const f=fixture(true,{pendingCover:!cached,cached});const a=f.open(),b=f.open();expect(b).toBe(a);if(cached)expect(a).toBe(f.cached);else{await flush();f.coverWait.resolve(f.blob);}await a;
 }
});
it('does not persist or refresh after the selection changes during decoding',async()=>{
 const f=fixture(true,{existingCover:true,pendingBitmap:true});const task=f.open();f.state.currentBookId='other';f.bitmapWait.resolve();await task;expect(f.summary().events.some(e=>e[0]==='fetch')).toBe(false);expect(f.summary().covers).toEqual([]);
});
it('a first cover finishes after closing only when its retained entry allows it',async()=>{
 for(const retained of [false,true]){
  const run=async native=>{const f=fixture(native,{pendingCover:true});const task=f.open();await flush();f.state.closingReader=true;f.state.currentBookId=null;f.env.reader.epoch++;f.entry().retainedOnClose=retained;f.coverWait.resolve(f.blob);await task;return f.summary()};expect(await run(true)).toEqual(await run(false));
 }
});
it('rechecks the actual revision before an asynchronous patch commits',async()=>{
 const run=async native=>{const f=fixture(native,{pendingPatch:true});const task=f.open();await flush();f.state.currentBookId='other';f.patchWait.resolve();await task;return f.summary()};expect(await run(true)).toEqual(await run(false));
});
it('a completed older job cannot delete a newer epoch entry',async()=>{
 const run=async native=>{const f=fixture(native,{pendingCover:true});const task=f.open();await flush();f.env.coverUpgrades.set(f.record.id,{epoch:9,promise:Promise.resolve()});f.coverWait.resolve(f.blob);await task;return f.summary()};expect(await run(true)).toEqual(await run(false));
});
it('keeps no native entry/promise cycle even while a browser task never settles',async()=>{
 const f=fixture(true,{pendingCover:true});const before=rustShelf.shelf_live_handles(),callbacks=rustShelf.shelf_pending_callbacks();f.open();await flush();expect(rustShelf.shelf_live_handles()).toBe(before);expect(rustShelf.shelf_pending_callbacks()).toBe(callbacks);f.entry().controller.abort();f.env.coverUpgrades.delete(f.record.id);expect(rustShelf.shelf_live_handles()).toBe(before);
});
it('supports the UI-only reader without waiting for Shelf',async()=>{
 const{rustUI}=await import('./helpers/rust-ui-ready.js');const f=fixture(true,{},rustUI);await f.open();expect(f.summary().events.some(e=>e[0]==='refresh')).toBe(true);
});
it('releases native handles after repeated completed, cancelled and failed jobs',async()=>{
 await run(true);const before=rustShelf.shelf_live_handles(),callbacks=rustShelf.shelf_pending_callbacks();for(let n=0;n<60;n++)await run(true,[{}, {fail:'fetch'},{cancelAt:'fetch'},{existingCover:true}][n%4]);await flush();expect(rustShelf.shelf_live_handles()).toBe(before);expect(rustShelf.shelf_pending_callbacks()).toBe(callbacks);
});
