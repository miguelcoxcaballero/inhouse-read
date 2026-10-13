import {beforeAll,beforeEach,afterEach,it,expect,vi} from 'vitest'
import {readFileSync} from 'node:fs'
import * as ui from '../../src/wasm/ui/inhouse_read_ui.js'
import {createPreparedPageCache,pageKeyMismatch} from '../../src/js/prepared-page.js'
import {createLegacyPreparedPageCache,legacyPageKeyMismatch} from '../../src/js/prepared-page-legacy.js'
const runtime=vi.hoisted(()=>({ui:null,native:0}));vi.mock('../../src/js/rust-ui.js',()=>({getRustUI:()=>runtime.ui}));
const native={...ui,RustPreparedPageCache:class extends ui.RustPreparedPageCache{constructor(...args){super(...args);runtime.native++}}};
const caches=[],create=()=>{const cache=createPreparedPageCache();caches.push(cache);return cache};
const key=overrides=>({bookId:'book',epoch:3,locator:null,fraction:.5,location:{page:2},viewport:{left:0,top:20,width:390,height:800},pixelRatio:2,preferences:'paper',theme:'light',filter:'none',...overrides});
const page=()=>({source:{pixels:new Uint8Array([1,2,3])},displayBounds:{left:10,top:30,width:200,height:400}});
beforeAll(()=>ui.initSync({module:readFileSync('src/wasm/ui/inhouse_read_ui_bg.wasm')}));beforeEach(()=>{runtime.ui=null;runtime.native=0});
afterEach(()=>{for(const cache of caches.splice(0))cache.destroy();expect(ui.ui_live_handles()).toBe(0)});
it('transfers a legacy ticket and stored bitmap without beginning work again',()=>{
 const cache=create(),ticket=cache.begin('book'),snapshot=page();expect(cache.store(ticket,key(),snapshot)).toBe(true);runtime.ui=native;expect(cache.isCurrent(ticket)).toBe(true);expect(cache.peek()).toBe(snapshot);expect(cache.take(key())).toBe(snapshot);expect(cache.take(key())).toBeNull();expect(runtime.native).toBe(1)
});
it('can adopt while the preparation is still pending and accept its original ticket',()=>{
 const cache=create(),ticket=cache.begin('book'),snapshot=page();runtime.ui=native;expect(cache.isCurrent(ticket)).toBe(true);expect(cache.store(ticket,key(),snapshot)).toBe(true);expect(cache.take(key())).toBe(snapshot);expect(runtime.native).toBe(1)
});
it('preserves invalidated tickets and the last discard through late adoption',()=>{
 const cache=create(),ticket=cache.begin('book');cache.store(ticket,key(),page());cache.invalidate('resize');runtime.ui=native;expect(cache.isCurrent(ticket)).toBe(false);expect(cache.store(ticket,key(),page())).toBe(false);expect(cache.peek()).toBeNull();expect(cache.lastDiscard).toBe('resize')
});
it('rebases only the destination while preserving the bitmap, symbols and additional fields',()=>{
 const cache=create(),snapshot=page(),symbol=Symbol('destination'),extra={flag:true};snapshot.displayBounds[symbol]=extra;snapshot.displayBounds.extra=extra;const original=snapshot.displayBounds,source=snapshot.source;cache.store(cache.begin('book'),key(),snapshot);runtime.ui=native;expect(cache.take(key({viewport:{left:30,top:15,width:390,height:800}}))).toBe(snapshot);expect(snapshot.source).toBe(source);expect(snapshot.displayBounds).not.toBe(original);expect(snapshot.displayBounds[symbol]).toBe(extra);expect(snapshot.displayBounds.extra).toBe(extra);expect(snapshot.displayBounds.left).toBe(40);expect(snapshot.displayBounds.top).toBe(25)
});
it('retains the original invalidateBook delegation to an overridden invalidate method',()=>{
 runtime.ui=native;const cache=create();cache.begin('book');const invalidate=vi.spyOn(cache,'invalidate');cache.invalidateBook('other');expect(invalidate).not.toHaveBeenCalled();cache.invalidateBook('book');expect(invalidate).toHaveBeenCalledExactlyOnceWith('book-changed')
});
it('does not retain the earlier bitmap in the compatibility owner after adoption',()=>{
 const cache=create(),snapshot=page();cache.store(cache.begin('book'),key(),snapshot);runtime.ui=native;expect(cache.take(key())).toBe(snapshot);cache.destroy();expect(ui.ui_live_handles()).toBe(0);expect(cache.peek()).toBeNull();expect(runtime.native).toBe(1)
});
it('keeps compatibility semantics for absent book IDs and default reasons',()=>{
 for(const mode of ['legacy','rust']){runtime.ui=mode==='rust'?native:null;const cache=create();expect(cache.has(undefined)).toBe(true);const ticket=cache.begin(undefined);cache.invalidateBook(undefined);expect(cache.isCurrent(ticket)).toBe(false);cache.store(cache.begin('book'),key(),page());cache.invalidate(undefined);expect(cache.lastDiscard).toBe('invalidated')}
});
it('keeps the previous owner when a native constructor fails or is incomplete',()=>{
 for(const candidate of [{RustPreparedPageCache:()=>{}},{RustPreparedPageCache:class{constructor(){throw Error('Unavailable')}begin(){}isCurrent(){}store(){}take(){}has(){}peek(){}invalidate(){}ownsBook(){}}}]){const cache=create(),snapshot=page();cache.store(cache.begin('book'),key(),snapshot);runtime.ui=candidate;expect(cache.take(key())).toBe(snapshot);cache.destroy()}expect(runtime.native).toBe(0)
});
it('preserves mismatch priority, coercion and JSON errors across the actual module',()=>{
 runtime.ui=native;for(const change of [{bookId:'other'},{epoch:4},{fraction:'0.5'}, {fraction:NaN},{locator:{a:1}}, {location:{page:3}},{viewport:{left:0,top:20,width:NaN,height:800}},{pixelRatio:1},{preferences:'other'},{theme:'dark'},{filter:'sepia'}])expect(pageKeyMismatch(key(),key(change))).toBe(legacyPageKeyMismatch(key(),key(change)));
 const circular={};circular.self=circular;expect(()=>pageKeyMismatch(key({locator:circular}),key())).toThrow(TypeError);expect(()=>pageKeyMismatch(key({fraction:Symbol('fraction')}),key())).toThrow(TypeError)
});
it('releases native key, snapshot and callback references after repeated complete lifetimes',()=>{
 runtime.ui=native;for(let i=0;i<200;i++){const cache=create(),snapshot=page(),ticket=cache.begin('book');cache.store(ticket,key(),snapshot);expect(cache.take(key())).toBe(snapshot);cache.destroy();expect(ui.ui_live_handles()).toBe(0)}expect(runtime.native).toBe(200)
});
it.each(['frozen','getter-only'])('keeps the original assignment error for a %s snapshot',kind=>{
 for(const mode of ['legacy','rust']){runtime.ui=mode==='rust'?native:null;const cache=create(),snapshot=page();if(kind==='frozen')Object.freeze(snapshot);else{const bounds=snapshot.displayBounds;Object.defineProperty(snapshot,'displayBounds',{get:()=>bounds})}cache.store(cache.begin('book'),key(),snapshot);expect(()=>cache.take(key({viewport:{left:30,top:15,width:390,height:800}}))).toThrow(TypeError);expect(cache.peek()).toBeNull()}
});
