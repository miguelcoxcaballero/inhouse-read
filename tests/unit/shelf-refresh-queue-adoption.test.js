import {beforeAll,beforeEach,afterEach,it,expect,vi} from 'vitest'
import {readFileSync} from 'node:fs'
import * as ui from '../../src/wasm/ui/inhouse_read_ui.js'
import {createShelfRefreshQueue} from '../../src/js/shelf-refresh-queue.js'
import {createLegacyShelfRefreshQueue} from '../../src/js/shelf-refresh-queue-legacy.js'
const runtime=vi.hoisted(()=>({ui:null,native:0}));vi.mock('../../src/js/rust-ui.js',()=>({getRustUI:()=>runtime.ui}));
const native={...ui,RustShelfRefreshQueue:class extends ui.RustShelfRefreshQueue{constructor(...args){super(...args);runtime.native++}}}
const queues=[];const create=options=>{const q=createShelfRefreshQueue(options);queues.push(q);return q}
const tick=async()=>{for(let i=0;i<8;i++)await Promise.resolve()}
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject}}
beforeAll(()=>ui.initSync({module:readFileSync('src/wasm/ui/inhouse_read_ui_bg.wasm')}));
beforeEach(()=>{runtime.ui=null;runtime.native=0;vi.useFakeTimers()})
afterEach(async()=>{for(const q of queues.splice(0))q.dispose();await tick();expect(ui.ui_live_handles()).toBe(0);vi.useRealTimers();vi.restoreAllMocks()})
it('adopts a ready module without changing the exact two-microtask read/finish order',async()=>{
 const traces=[];
 for(const mode of ['legacy','rust']){runtime.ui=mode==='rust'?native:null;const trace=[],q=create({perform:()=>{trace.push('perform');return 7}});const promise=q.request({immediate:true});promise.then(v=>trace.push('value:'+v));trace.push('requested');for(let i=0;i<8;i++){await Promise.resolve();trace.push('turn:'+i)}await promise;traces.push(trace);q.dispose()}
 expect(traces[1]).toEqual(traces[0]);expect(runtime.native).toBe(1)
})
it('keeps a pending legacy deadline when the module arrives, then adopts the next idle request',async()=>{
 const perform=vi.fn(()=>7),q=create({perform});const p=q.request();runtime.ui=native;const second=q.request();expect(runtime.native).toBe(0);await vi.advanceTimersByTimeAsync(80);await expect(p).resolves.toBe(7);await expect(second).resolves.toBe(7);expect(runtime.native).toBe(0);await expect(q.request({immediate:true})).resolves.toBe(7);expect(runtime.native).toBe(1)
})
it('keeps a running read and all trailing requests with their original owner',async()=>{
 const first=deferred(),second=deferred(),perform=vi.fn().mockImplementationOnce(()=>first.promise).mockImplementationOnce(()=>second.promise).mockResolvedValue(3),q=create({perform});const a=q.request({immediate:true});await tick();runtime.ui=native;const b=q.request({immediate:true});expect(runtime.native).toBe(0);first.resolve(1);await expect(a).resolves.toBe(1);await tick();expect(runtime.native).toBe(0);second.resolve(2);await expect(b).resolves.toBe(2);await expect(q.request({immediate:true})).resolves.toBe(3);expect(runtime.native).toBe(1)
})
it('returns the same fresh record identity to each native caller without serializing it',async()=>{
 runtime.ui=native;const value={cover:new Blob(['cover']),file:new Blob(['book']),locator:{page:3}},perform=vi.fn(()=>value),q=create({perform}),requests=Array.from({length:50},()=>q.request());await vi.advanceTimersByTimeAsync(80);for(const result of await Promise.all(requests))expect(result).toBe(value);expect(perform).toHaveBeenCalledOnce()
})
it.each([undefined,null,false,0,''])('keeps rejection identity for %s and recovers afterward',async reason=>{
 runtime.ui=native;const perform=vi.fn().mockImplementationOnce(()=>Promise.reject(reason)).mockReturnValue(4),q=create({perform});await expect(q.request({immediate:true})).rejects.toBe(reason);await expect(q.request({immediate:true})).resolves.toBe(4)
})
it('freeing the host preserves the result of an active native read and cancels its trailing request',async()=>{
 runtime.ui=native;const first=deferred(),perform=vi.fn(()=>first.promise),q=create({perform}),a=q.request({immediate:true});await tick();const b=q.request({immediate:true});q.dispose();q.dispose();await expect(b).resolves.toBeUndefined();await expect(q.request({immediate:true})).resolves.toBeUndefined();first.resolve(8);await expect(a).resolves.toBe(8);await tick();expect(perform).toHaveBeenCalledOnce();expect(ui.ui_live_handles()).toBe(0)
})
it('can enqueue synchronously from perform without overlapping or borrowing live state',async()=>{
 runtime.ui=native;let trailing;let q;const perform=vi.fn(()=>{if(perform.mock.calls.length===1){trailing=q.request({immediate:true});return 1}return 2});q=create({perform});await expect(q.request({immediate:true})).resolves.toBe(1);await expect(trailing).resolves.toBe(2);expect(perform).toHaveBeenCalledTimes(2)
})
it('retains injected timers and opaque timer IDs on the original path',async()=>{
 runtime.ui=native;const id=Symbol('timer');let fire;const setTimer=vi.fn(callback=>{fire=callback;return id}),clearTimer=vi.fn(),q=create({perform:()=>6,setTimer,clearTimer});const p=q.request();await expect(q.request({immediate:true})).resolves.toBe(6);await expect(p).resolves.toBe(6);expect(clearTimer).toHaveBeenCalledWith(id);expect(runtime.native).toBe(0);expect(typeof fire).toBe('function')
})
it('does not adopt an incomplete or failed constructor',async()=>{
 for(const candidate of [{RustShelfRefreshQueue:class{request(){} }},{RustShelfRefreshQueue:class{constructor(){throw Error('Unavailable')}request(){}dispose(){}idle(){}}}]){runtime.ui=candidate;const q=create({perform:()=>3});await expect(q.request({immediate:true})).resolves.toBe(3)}expect(runtime.native).toBe(0)
})
it('releases every native callback after repeated complete queues',async()=>{
 runtime.ui=native;for(let i=0;i<100;i++){const q=create({perform:()=>i}),a=q.request({immediate:true}),b=q.request({immediate:true});await expect(a).resolves.toBe(i);await expect(b).resolves.toBe(i);q.dispose();await tick();expect(ui.ui_live_handles()).toBe(0)}expect(runtime.native).toBe(100)
})
it('preserves argument validation before doing any work',()=>{
 runtime.ui=native;expect(()=>create()).toThrow(new TypeError('Shelf refresh needs a perform callback'));const perform=vi.fn(),q=create({perform});expect(()=>q.request(null)).toThrow(TypeError);expect(perform).not.toHaveBeenCalled();expect(runtime.native).toBe(0)
})
