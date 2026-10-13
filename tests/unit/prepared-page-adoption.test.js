import {beforeAll,beforeEach,afterEach,it,expect,vi} from 'vitest'
import {readFileSync} from 'node:fs'
import * as ui from '../../src/wasm/ui/inhouse_read_ui.js'
import {createPreparedPageCache,createStageGate,pageKeyMismatch} from '../../src/js/prepared-page.js'
import {notifyRustUIReady} from '../../src/js/rust-ui-readiness.js'
import {createLegacyPreparedPageCache,legacyPageKeyMismatch,createStageGate as referenceStageGate} from './helpers/reference-prepared-page.js'
// The prepared page has no JavaScript twin any more: before the module arrives nothing was ever
// prepared, so every query is empty; preparation begins only once the Rust cache exists.
const runtime=vi.hoisted(()=>({ui:null,native:0,load:null}));
vi.mock('../../src/js/rust-ui.js',()=>({getRustUI:()=>runtime.ui,loadRustUI:()=>runtime.load?runtime.load():Promise.resolve(runtime.ui)}));
const native={...ui,RustPreparedPageCache:class extends ui.RustPreparedPageCache{constructor(...args){super(...args);runtime.native++}}};
const caches=[],gates=[],create=()=>{const cache=createPreparedPageCache();caches.push(cache);return cache};
const key=overrides=>({bookId:'book',epoch:3,locator:null,fraction:.5,location:{page:2},viewport:{left:0,top:20,width:390,height:800},pixelRatio:2,preferences:'paper',theme:'light',filter:'none',...overrides});
const page=()=>({source:{pixels:new Uint8Array([1,2,3])},displayBounds:{left:10,top:30,width:200,height:400}});
const tick=async()=>{for(let i=0;i<10;i++)await Promise.resolve()};
beforeAll(()=>ui.initSync({module:readFileSync('src/wasm/ui/inhouse_read_ui_bg.wasm')}));let gateMade=false;beforeEach(()=>{runtime.ui=null;runtime.native=0;runtime.load=null;gateMade=false});
// A stage gate hands its promise handlers to the host for good (the shipped Rust behaviour); caches must release everything.
afterEach(()=>{for(const cache of caches.splice(0))cache.destroy();for(const gate of gates.splice(0))gate.destroy();if(!gateMade)expect(ui.ui_live_handles()).toBe(0)});
it('holds nothing before the module exists, ignores invalidations and refuses to begin work',()=>{
 const cache=create();expect(cache.isReady()).toBe(false);expect(cache.peek()).toBeNull();expect(cache.take(key())).toBeNull();expect(cache.has('book')).toBe(false);expect(cache.has(undefined)).toBe(true);expect(cache.lastDiscard).toBeNull();expect(cache.isCurrent({bookId:'book',generation:1})).toBe(false);expect(cache.store({bookId:'book',generation:1},key(),page())).toBe(false)
 cache.invalidate('resize');cache.invalidate();cache.invalidateBook('book','removed');expect(cache.lastDiscard).toBeNull()
 expect(()=>cache.begin('book')).toThrow('módulo Rust');expect(runtime.native).toBe(0)
});
it('adopts the module the moment it arrives, with an empty cache that begins fresh work',()=>{
 const cache=create();runtime.ui=native;notifyRustUIReady(native);expect(cache.isReady()).toBe(true);expect(runtime.native).toBe(1)
 const ticket=cache.begin('book'),snapshot=page();expect(cache.isCurrent(ticket)).toBe(true);expect(cache.store(ticket,key(),snapshot)).toBe(true);expect(cache.take(key())).toBe(snapshot);expect(cache.take(key())).toBeNull()
 notifyRustUIReady(native);expect(runtime.native).toBe(1)
});
it('adopts immediately when the module is already loaded',()=>{
 runtime.ui=native;const cache=create();expect(cache.isReady()).toBe(true);expect(runtime.native).toBe(1)
});
it('whenReady resolves true once the pending module lands and false when it never does',async()=>{
 const cache=create(),landed=cache.whenReady();runtime.ui=native;notifyRustUIReady(native);await expect(landed).resolves.toBe(true)
 const late=create();runtime.ui=null;runtime.load=()=>Promise.resolve(null);caches.push(late);
 const other=createPreparedPageCache();caches.push(other);await expect(other.whenReady()).resolves.toBe(false)
 runtime.ui=native;runtime.load=()=>Promise.resolve(native);const third=create();await expect(third.whenReady()).resolves.toBe(true);expect(third.isReady()).toBe(true)
});
it('rebases only the destination while preserving the bitmap, symbols and additional fields',()=>{
 runtime.ui=native;const cache=create(),snapshot=page(),symbol=Symbol('destination'),extra={flag:true};snapshot.displayBounds[symbol]=extra;snapshot.displayBounds.extra=extra;const original=snapshot.displayBounds,source=snapshot.source;cache.store(cache.begin('book'),key(),snapshot);expect(cache.take(key({viewport:{left:30,top:15,width:390,height:800}}))).toBe(snapshot);expect(snapshot.source).toBe(source);expect(snapshot.displayBounds).not.toBe(original);expect(snapshot.displayBounds[symbol]).toBe(extra);expect(snapshot.displayBounds.extra).toBe(extra);expect(snapshot.displayBounds.left).toBe(40);expect(snapshot.displayBounds.top).toBe(25)
});
it('retains the original invalidateBook delegation to an overridden invalidate method',()=>{
 runtime.ui=native;const cache=create();cache.begin('book');const invalidate=vi.spyOn(cache,'invalidate');cache.invalidateBook('other');expect(invalidate).not.toHaveBeenCalled();cache.invalidateBook('book');expect(invalidate).toHaveBeenCalledExactlyOnceWith('book-changed')
});
it('releases the bitmap and every native reference on destruction',()=>{
 runtime.ui=native;const cache=create(),snapshot=page();cache.store(cache.begin('book'),key(),snapshot);cache.destroy();expect(ui.ui_live_handles()).toBe(0);expect(cache.peek()).toBeNull();expect(cache.isReady()).toBe(false);expect(runtime.native).toBe(1)
});
it('never adopts a late module after destruction',()=>{
 const cache=create();cache.destroy();runtime.ui=native;notifyRustUIReady(native);expect(runtime.native).toBe(0);expect(cache.isReady()).toBe(false)
});
it('keeps compatibility semantics for absent book IDs and default reasons against the frozen reference',()=>{
 for(const mode of ['reference','rust']){runtime.ui=mode==='rust'?native:null;const cache=mode==='rust'?create():createLegacyPreparedPageCache();expect(cache.has(undefined)).toBe(true);const ticket=cache.begin(undefined);cache.invalidateBook(undefined);expect(cache.isCurrent(ticket)).toBe(false);cache.store(cache.begin('book'),key(),page());cache.invalidate(undefined);expect(cache.lastDiscard).toBe('invalidated')}
});
it('treats a failed or incomplete native constructor as unusable instead of preparing something else',async()=>{
 for(const candidate of [{RustPreparedPageCache:()=>{}},{RustPreparedPageCache:class{constructor(){throw Error('Unavailable')}begin(){}isCurrent(){}store(){}take(){}has(){}peek(){}invalidate(){}ownsBook(){}}}]){runtime.ui=candidate;const cache=create();expect(cache.isReady()).toBe(false);await expect(cache.whenReady()).resolves.toBe(false);expect(()=>cache.begin('book')).toThrow('módulo Rust');expect(cache.take(key())).toBeNull();cache.invalidate('resize')}expect(runtime.native).toBe(0)
});
it('preserves mismatch priority, coercion and JSON errors across the actual module',()=>{
 runtime.ui=native;for(const change of [{bookId:'other'},{epoch:4},{fraction:'0.5'}, {fraction:NaN},{locator:{a:1}}, {location:{page:3}},{viewport:{left:0,top:20,width:NaN,height:800}},{pixelRatio:1},{preferences:'other'},{theme:'dark'},{filter:'sepia'}])expect(pageKeyMismatch(key(),key(change))).toBe(legacyPageKeyMismatch(key(),key(change)));
 const circular={};circular.self=circular;expect(()=>pageKeyMismatch(key({locator:circular}),key())).toThrow(TypeError);expect(()=>pageKeyMismatch(key({fraction:Symbol('fraction')}),key())).toThrow(TypeError)
});
it('fails clearly, not silently, when the key comparison is asked of a missing module',()=>{
 for(const candidate of [null,{},{prepared_page_mismatch:1}]){runtime.ui=candidate;expect(()=>pageKeyMismatch(key(),key())).toThrow('módulo Rust')}
});
it('releases native key, snapshot and callback references after repeated complete lifetimes',()=>{
 runtime.ui=native;for(let i=0;i<200;i++){const cache=create(),snapshot=page(),ticket=cache.begin('book');cache.store(ticket,key(),snapshot);expect(cache.take(key())).toBe(snapshot);cache.destroy();expect(ui.ui_live_handles()).toBe(0)}expect(runtime.native).toBe(200)
});
it.each(['frozen','getter-only'])('keeps the original assignment error for a %s snapshot',kind=>{
 for(const mode of ['reference','rust']){runtime.ui=mode==='rust'?native:null;const cache=mode==='rust'?create():createLegacyPreparedPageCache(),snapshot=page();if(kind==='frozen')Object.freeze(snapshot);else{const bounds=snapshot.displayBounds;Object.defineProperty(snapshot,'displayBounds',{get:()=>bounds})}cache.store(cache.begin('book'),key(),snapshot);expect(()=>cache.take(key({viewport:{left:30,top:15,width:390,height:800}}))).toThrow(TypeError);expect(cache.peek()).toBeNull()}
});
// ---- stage gate ----
const gateOf=(settled,options)=>{gateMade=true;const gate=createStageGate(settled,options);gates.push(gate);return gate};
it('a gate made before the module waits for it, then behaves like the original gate',async()=>{
 const events=[],resolveUi={};runtime.load=()=>new Promise(resolve=>{resolveUi.resolve=resolve});
 const gate=gateOf(Promise.resolve(true),{idle:()=>{events.push('idle');return Promise.resolve()}}),result=gate.wait();result.then(value=>events.push('go:'+value));await tick();expect(events).toEqual([])
 runtime.ui=native;resolveUi.resolve(native);await result;expect(events).toEqual(['idle','go:true'])
});
it('keeps an open request made before the module arrived and honours it afterwards',async()=>{
 const never=new Promise(()=>{}),resolveUi={};runtime.load=()=>new Promise(resolve=>{resolveUi.resolve=resolve});
 const gate=gateOf(never,{idle:()=>never});gate.release('open');gate.release('dismissed');const result=gate.wait();runtime.ui=native;resolveUi.resolve(native);expect(await result).toBe(true)
 const closed=gateOf(never,{idle:()=>never});closed.release('dismissed');closed.release('open');const other=closed.wait();resolveUi.resolve(native);expect(await other).toBe(false)
});
it('skips the work, like a dismissed selection, when the module never comes or cannot construct',async()=>{
 const never=new Promise(()=>{});runtime.load=()=>Promise.resolve(null);expect(await gateOf(never,{idle:()=>never}).wait()).toBe(false)
 for(const candidate of [{RustStageGate:class{}},{RustStageGate:class{constructor(){throw Error('Unavailable')}wait(){}release(){}}}]){runtime.ui=candidate;const gate=gateOf(never,{idle:()=>never});gate.release('open');expect(await gate.wait()).toBe(false)}
});
it('does not start work for a gate destroyed while the module was pending',async()=>{
 const resolveUi={},idle=vi.fn();runtime.load=()=>new Promise(resolve=>{resolveUi.resolve=resolve});
 const gate=gateOf(Promise.resolve(true),{idle}),result=gate.wait();gate.destroy();runtime.ui=native;resolveUi.resolve(native);expect(await result).toBe(false);expect(idle).not.toHaveBeenCalled()
});
it('matches the original gate microtask order when the module is already loaded',async()=>{
 const trace=async factory=>{const events=[],gate=factory(true,{idle:()=>{events.push('idle');return undefined}}),result=gate.wait();result.then(value=>events.push('done:'+value));for(let turn=0;turn<12;turn++){await Promise.resolve();events.push('turn:'+turn)}gate.destroy?.();return events};
 runtime.ui=native;expect(await trace(gateOf)).toEqual(await trace(referenceStageGate))
});
