// @vitest-environment node
import {readFileSync} from 'node:fs';
import {afterEach,expect,it,vi} from 'vitest';
const bytes=readFileSync('src/wasm/inhouse_read_core.wasm');
const html=readFileSync('index.html','utf8');
const script=html.match(/<script>([^<]*__inhouseRustReady[^<]*)<\/script>/)[1];
const run=new Function('window','document','fetch','WebAssembly',script);
const document={getElementById:()=>({href:'https://example.test/inhouse-read/assets/core.wasm'})};
afterEach(()=>{delete globalThis.__inhouseRustReady;vi.unstubAllGlobals();vi.restoreAllMocks();});
function prepare(fetcher,wasm=WebAssembly){const page={};run(page,document,fetcher,wasm);return page.__inhouseRustReady;}
it('starts the hashed core without an app import and adopts its only streaming instance',async()=>{
 vi.resetModules();const fetcher=vi.fn(async()=>new Response(bytes,{headers:{'content-type':'application/wasm'}}));
 const ready=prepare(fetcher);expect(fetcher).toHaveBeenCalledWith(document.getElementById().href);
 vi.stubGlobal('__inhouseRustReady',ready);vi.stubGlobal('fetch',fetcher);
 const {loadRustCore,getRustCore}=await import('../../src/js/rust-core.js');
 const pending=loadRustCore();expect(loadRustCore()).toBe(pending);const core=await pending;
 expect(core).toBe((await ready).instance.exports);expect(getRustCore()).toBe(core);expect(fetcher).toHaveBeenCalledOnce();
 expect(globalThis.__inhouseRustReady).toBeUndefined();
});
it('keeps the generic-MIME and no-streaming paths usable',async()=>{
 for(const wasm of [WebAssembly,{instantiate:WebAssembly.instantiate.bind(WebAssembly)}])for(const type of ['application/octet-stream','application/wasm; charset=binary']){
  const ready=prepare(async()=>new Response(bytes,{headers:{'content-type':type}}),wasm);
  expect((await ready).instance.exports.core_abi_version()).toBe(1);
 }
});
it('does not leave unhandled promises on HTTP, corrupt bytes or offline failures',async()=>{
 for(const fetcher of [async()=>new Response('',{status:404}),async()=>new Response('bad'),async()=>{throw Error('offline');}])expect(await prepare(fetcher)).toBeNull();
});
it('skips unsupported hosts and catches a synchronous fetch failure',()=>{
 const fetcher=vi.fn(),page={};run(page,document,fetcher,undefined);expect(page.__inhouseRustReady).toBeUndefined();expect(fetcher).not.toHaveBeenCalled();
 expect(prepare(()=>{throw Error('fetch');})).toBeUndefined();
});
it('does not fetch again immediately after a failed early request; bounded recovery remains possible',async()=>{
 vi.resetModules();vi.stubGlobal('__inhouseRustReady',Promise.resolve(null));
 const fetcher=vi.fn(async()=>new Response(bytes));vi.stubGlobal('fetch',fetcher);const clock=vi.spyOn(Date,'now').mockReturnValue(1000);
 const {loadRustCore,getRustCore}=await import('../../src/js/rust-core.js');
 expect(await loadRustCore()).toBeNull();expect(getRustCore()).toBeNull();expect(fetcher).not.toHaveBeenCalled();
 clock.mockReturnValue(30999);expect(await loadRustCore()).toBeNull();expect(fetcher).not.toHaveBeenCalled();
 clock.mockReturnValue(31000);expect((await loadRustCore()).core_abi_version()).toBe(1);expect(fetcher).toHaveBeenCalledOnce();
});
it('validates an early instance through the same ABI checks',async()=>{
 vi.resetModules();vi.stubGlobal('__inhouseRustReady',Promise.resolve({instance:{exports:{core_abi_version:()=>9}}}));
 const {loadRustCore,getRustCore}=await import('../../src/js/rust-core.js');expect(await loadRustCore()).toBeNull();expect(getRustCore()).toBeNull();
});
it('keeps explicit byte callers independent of an early request',async()=>{
 vi.resetModules();const early=new Promise(()=>{});vi.stubGlobal('__inhouseRustReady',early);
 const {loadRustCore}=await import('../../src/js/rust-core.js');expect((await loadRustCore({bytes})).core_abi_version()).toBe(1);
 expect(globalThis.__inhouseRustReady).toBe(early);
});
it('adopts in the first boot module without waiting for it before reading books',()=>{
 const boot=readFileSync('src/js/shelf-boot.js','utf8');
 expect(boot).toContain('void loadRustCore()');expect(boot).not.toContain('await loadRustCore()');
 expect(html.indexOf('id="ihr-rust-core"')).toBeLessThan(html.indexOf('src="/src/js/app.js"'));
});
