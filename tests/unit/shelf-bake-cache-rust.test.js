// @vitest-environment node
import {afterEach,expect,it,vi} from 'vitest';
const runtime=vi.hoisted(()=>({ready:true}));
vi.mock('../../src/js/rust-shelf.js',async()=>{
 const real=await (await import('./helpers/rust-shelf-real.js')).rustShelfMock();
 return {...real,getRustShelf:()=>runtime.ready?real.needRustShelf():null,needRustShelf:()=>{if(!runtime.ready)throw Error('WASM not ready');return real.needRustShelf();}};
});
let modules=[];
afterEach(async()=>{runtime.ready=true;for(const module of modules)await module.startShelfBakes(null);modules=[];vi.useRealTimers();vi.restoreAllMocks();});
async function fresh(){vi.resetModules();const current=await import('../../src/js/shelf-bake-cache.js'),reference=await import('./helpers/reference-shelf-bake-cache.js');modules.push(current,reference);return {current,reference};}
const version=label=>`${label}|${globalThis.navigator?.userAgent??''}`;
const paint=()=>({width:1,height:1,pigment:new Uint8Array([1,2,3,4]),data:new Uint8Array([5,6,7,8])});
function database(value=null,{defer=false}={}){
 const store={value,opens:0,closes:0,writes:[],pending:[]};
 const db={close:()=>{store.closes++;},transaction:()=>{
  const tx={objectStore:()=>({get:()=>{const req={};const done=()=>{req.result=store.value;req.onsuccess?.();};if(defer)store.pending.push(done);else queueMicrotask(done);return req;},put:next=>{store.value=next;store.writes.push(next);queueMicrotask(()=>tx.oncomplete?.());}})};return tx;
 }};
 store.factory={open:()=>{store.opens++;const req={};queueMicrotask(()=>{req.result=db;req.onsuccess?.();});return req;}};
 return store;
}
it('opens and completes IndexedDB before WASM is ready, then adopts without another read',async()=>{
 const {current}=await fresh();runtime.ready=false;
 const db=database({version:version('early'),models:[['first',{},['soil']]],surfaces:[['soil',paint()]]});
 await current.startShelfBakes('early',db.factory);expect(db.opens).toBe(1);await current.shelfBakesSettled(1);
 runtime.ready=true;expect(current.loadedShelfBakes().models[0][0]).toBe('first');expect(current.savedSurface('soil',1,1)).toBe(db.value.surfaces[0][1]);expect(db.opens).toBe(1);
});
it('matches the frozen cache for stale records, filtered entries, duplicate keys and one-shot byte validation',async()=>{
 const {current,reference}=await fresh();
 for(const raw of [null,{}, {version:'old',models:[],surfaces:[]},{version:version('parity'),models:null,surfaces:[]},
  {version:version('parity'),models:[null,['valid',{mesh:true},['z','a']],['bad',{},{}],[3,{},[]]],surfaces:[null,['first',paint()],['first',paint()],['missing',null],['bad',{}],[3,paint()]]}]){
  await current.startShelfBakes('parity',database(raw).factory);await reference.startShelfBakes('parity',database(raw).factory);
  expect(current.loadedShelfBakes()).toEqual(reference.loadedShelfBakes());
  for(const args of [['first',2,1],['first',1,1],['bad',1,1],['missing',1,1]])expect(current.savedSurface(...args)).toEqual(reference.savedSurface(...args));
 }
 for(const value of [paint(),{...paint(),data:new Uint8ClampedArray(4)},{...paint(),pigment:new Uint8Array(3)},{...paint(),width:'1'}]){
  const raw={version:version('bytes'),models:[],surfaces:[['p',value]]};
  await current.startShelfBakes('bytes',database(raw).factory);await reference.startShelfBakes('bytes',database(raw).factory);
  expect(current.savedSurface('p',1,1)).toEqual(reference.savedSurface('p',1,1));expect(current.savedSurface('p',1,1)).toBeNull();
 }
});
it('keeps a late previous read from replacing or settling a newer session and closes its connection',async()=>{
 const {current}=await fresh();const old=database({version:version('old'),models:[['old',{},[]]],surfaces:[]},{defer:true});
 const reading=current.startShelfBakes('old',old.factory);await Promise.resolve();await Promise.resolve();
 const next=database({version:version('new'),models:[['new',{},[]]],surfaces:[]});await current.startShelfBakes('new',next.factory);
 for(const done of old.pending)done();await reading;
 expect(current.loadedShelfBakes().models[0][0]).toBe('new');expect(old.closes).toBe(1);
});
it('deduplicates equivalent Unicode model/surface signatures without repainting or changing collection order',async()=>{
 vi.useFakeTimers();const {current,reference}=await fresh();const modelKeys=['z','é','\ue000','😀','𐀀','a','\ufffd','\ud800','\udc00'];
 const models=modelKeys.map(key=>[key,{keep:key},['soil','leaf','pot']]),surfaces=modelKeys.map(key=>[key,paint()]);
 const raw={version:version('signature'),models,surfaces};const db=database(raw),refdb=database(raw);
 await current.startShelfBakes('signature',db.factory);await reference.startShelfBakes('signature',refdb.factory);
 current.loadedShelfBakes();reference.loadedShelfBakes();
 const next={models:[...models].reverse().map(([key,model,keys])=>[key,model,[...keys].reverse()]),surfaces:[...surfaces].reverse()};
 const source={settled:()=>Promise.resolve(),collect:()=>next};current.addShelfBakeSource(source);reference.addShelfBakeSource(source);
 current.scheduleShelfBakeWrite();reference.scheduleShelfBakeWrite();await vi.advanceTimersByTimeAsync(2050);
 expect(db.writes).toHaveLength(0);expect(refdb.writes).toHaveLength(0);
 next.surfaces.push(['new',paint()]);current.scheduleShelfBakeWrite();reference.scheduleShelfBakeWrite();await vi.advanceTimersByTimeAsync(2050);
 expect(db.writes).toEqual(refdb.writes);expect(db.writes).toHaveLength(1);
});
it('coalesces pending source waits and cancels stale idle work even when restarted with the same build',async()=>{
 vi.useFakeTimers();const {current}=await fresh();const db=database();await current.startShelfBakes('schedule',db.factory);
 let finish;const pending=new Promise(resolve=>{finish=resolve;});const collect=vi.fn(()=>({models:[],surfaces:[['p',paint()]]}));
 current.addShelfBakeSource({settled:()=>pending,collect});
 current.scheduleShelfBakeWrite();await vi.advanceTimersByTimeAsync(2000);current.scheduleShelfBakeWrite();finish();await vi.advanceTimersByTimeAsync(100);
 expect(collect).not.toHaveBeenCalled();await vi.advanceTimersByTimeAsync(1950);expect(collect).toHaveBeenCalledTimes(1);expect(db.writes).toHaveLength(1);
 current.scheduleShelfBakeWrite();await vi.advanceTimersByTimeAsync(2000);await current.startShelfBakes('schedule',db.factory);await vi.advanceTimersByTimeAsync(100);
 expect(collect).toHaveBeenCalledTimes(1);expect(db.writes).toHaveLength(1);
});
it('ignores disabled and failed browser writes and preserves source property descriptors as ordinary saved data',async()=>{
 const {current,reference}=await fresh();const db=database(),refdb=database();
 await current.startShelfBakes(null,db.factory);expect(await current.saveShelfBakes({models:[],surfaces:[]})).toBe(false);expect(db.opens).toBe(0);
 await current.startShelfBakes('write',db.factory);await reference.startShelfBakes('write',refdb.factory);
 const symbol=Symbol('kept'),value={models:[],surfaces:[],get label(){return 'label'},[symbol]:7};Object.defineProperty(value,'__proto__',{value:{own:true},enumerable:true});Object.defineProperty(value,'hidden',{value:4});
 expect(await current.saveShelfBakes(value)).toBe(true);expect(await reference.saveShelfBakes(value)).toBe(true);
 expect(Object.getOwnPropertyDescriptors(db.value)).toEqual(Object.getOwnPropertyDescriptors(refdb.value));expect(Object.getPrototypeOf(db.value)).toBe(Object.prototype);
 await current.startShelfBakes('failure',{open:()=>{throw Error('private mode');}});expect(current.loadedShelfBakes()).toBeNull();expect(await current.saveShelfBakes(value)).toBe(false);
});
it('releases native handles on corrupt accessors and string conversion errors',async()=>{
 const {current}=await fresh();const shelf=(await import('../../src/js/rust-shelf.js')).needRustShelf();
 const bad={toString(){throw Error('broken version')}};await current.startShelfBakes(bad,database().factory);
 const before=shelf.shelf_live_handles();for(let n=0;n<20;n++)expect(()=>current.shelfBakesEnabled()).toThrow('broken version');expect(shelf.shelf_live_handles()).toBe(before);
 const raw={version:version('handles'),get models(){throw Error('broken record')}};await current.startShelfBakes('handles',database(raw).factory);current.shelfBakesEnabled();
 const initialized=shelf.shelf_live_handles();for(let n=0;n<20;n++)expect(()=>current.loadedShelfBakes()).toThrow('broken record');expect(shelf.shelf_live_handles()).toBe(initialized);
});
it('keeps strict surface dimensions, including nonnumeric requests, and catches failed save accessors without leaks',async()=>{
 const {current,reference}=await fresh();const raw={version:version('strict'),models:[],surfaces:[['p',paint()]]};
 for(const [width,height] of [['1',1],[1,'1'],[NaN,1],[1,Infinity],[1,1]]){
  await current.startShelfBakes('strict',database(raw).factory);await reference.startShelfBakes('strict',database(raw).factory);
  expect(current.savedSurface('p',width,height)).toEqual(reference.savedSurface('p',width,height));
 }
 const shelf=(await import('../../src/js/rust-shelf.js')).needRustShelf();current.shelfBakesEnabled();const before=shelf.shelf_live_handles();
 for(let n=0;n<20;n++)expect(await current.saveShelfBakes({get models(){throw Error('broken accessor')}})).toBe(false);
 expect(shelf.shelf_live_handles()).toBe(before);
});
it('cancels browser idle callbacks on restart and never collects rejected surface queues',async()=>{
 vi.useFakeTimers();const {current}=await fresh();const callbacks=new Map();let count=0;
 const idle=globalThis.requestIdleCallback,cancel=globalThis.cancelIdleCallback;
 globalThis.requestIdleCallback=fn=>{callbacks.set(++count,fn);return count;};globalThis.cancelIdleCallback=id=>callbacks.delete(id);
 try{
  const db=database();await current.startShelfBakes('idle',db.factory);const collect=vi.fn(()=>({models:[],surfaces:[]}));
  current.addShelfBakeSource({settled:()=>Promise.resolve(),collect});current.scheduleShelfBakeWrite();await vi.advanceTimersByTimeAsync(2000);
  expect(callbacks.size).toBe(1);await current.startShelfBakes('idle',db.factory);expect(callbacks.size).toBe(0);expect(collect).not.toHaveBeenCalled();
  current.addShelfBakeSource({settled:()=>Promise.reject(Error('paint cancelled')),collect});current.scheduleShelfBakeWrite();await vi.advanceTimersByTimeAsync(2100);
  expect(callbacks.size).toBe(0);expect(collect).not.toHaveBeenCalled();expect(db.writes).toHaveLength(0);
 }finally{globalThis.requestIdleCallback=idle;globalThis.cancelIdleCallback=cancel;}
});
it('drops discarded byte records and clears retained surface handles when a native cache session closes',async()=>{
 const shelf=(await import('../../src/js/rust-shelf.js')).needRustShelf();const good=paint();
 const session={buildVersion:'drop',factory:{},userAgent:'test',active:true,ready:true,sources:new Set(),raw:{version:'drop|test',models:[],surfaces:[['good',good],['bad',null]]}};
 const before=shelf.shelf_live_handles();expect(shelf.shelf_bake_record(session).surfaces).toEqual([['good',good]]);expect(session.raw).toBeNull();expect(session.policy.surfaces.size).toBe(1);
 session.active=false;shelf.shelf_bake_cancel({},session);expect(session.policy.record).toBeNull();expect(session.policy.surfaces.size).toBe(0);expect(shelf.shelf_live_handles()).toBe(before);
});
it('preserves exact UTF-16 versions without replacing isolated surrogate code units',async()=>{
 const {current,reference}=await fresh();const label='cache:\ud800';const raw={version:version(label),models:[['\udc00',{},[]]],surfaces:[]};
 await current.startShelfBakes(label,database(raw).factory);await reference.startShelfBakes(label,database(raw).factory);expect(current.loadedShelfBakes()).toEqual(reference.loadedShelfBakes());expect(current.loadedShelfBakes().models[0][0]).toBe('\udc00');
});
it('shares an opening browser connection across concurrent reads and writes and closes it once',async()=>{
 const {current}=await fresh(),db=database();
 const reading=current.startShelfBakes('concurrent',db.factory),first=current.saveShelfBakes({models:[],surfaces:[]}),second=current.saveShelfBakes({models:[],surfaces:[['p',paint()]]});
 expect(db.opens).toBe(1);expect(await Promise.all([reading,first,second])).toEqual([undefined,true,true]);expect(db.opens).toBe(1);
 await current.startShelfBakes(null);expect(db.closes).toBe(1);
});
