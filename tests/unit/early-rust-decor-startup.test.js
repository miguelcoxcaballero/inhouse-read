// @vitest-environment node
import {readFileSync} from 'node:fs';
import {afterEach,expect,it,vi} from 'vitest';
const bytes=readFileSync('src/wasm/inhouse_read_decor.wasm');
const html=readFileSync('index.html','utf8');
const script=html.match(/<script>([^<]*__inhouseDecorReady[^<]*)<\/script>/)[1];
const run=new Function('window','document','fetch','WebAssembly',script);
const document={getElementById:()=>({href:'https://example.test/inhouse-read/assets/core.wasm'})};
afterEach(()=>{delete globalThis.__inhouseDecorReady;vi.unstubAllGlobals();vi.restoreAllMocks();});
function prepare(fetcher,wasm=WebAssembly){const page={};run(page,document,fetcher,wasm);return page.__inhouseDecorReady;}
it('starts the hashed core without an app import and adopts its only streaming instance',async()=>{
 vi.resetModules();const fetcher=vi.fn(async()=>new Response(bytes,{headers:{'content-type':'application/wasm'}}));
 const ready=prepare(fetcher);expect(fetcher).toHaveBeenCalledWith(document.getElementById().href);
 vi.stubGlobal('__inhouseDecorReady',ready);vi.stubGlobal('fetch',fetcher);
 const {loadRustDecorCore,getRustDecorCore}=await import('../../src/js/rust-decor-core.js');
 const pending=loadRustDecorCore();expect(loadRustDecorCore()).toBe(pending);const core=await pending;
 expect(core).toBe((await ready).instance.exports);expect(getRustDecorCore()).toBe(core);expect(fetcher).toHaveBeenCalledOnce();
 expect(globalThis.__inhouseDecorReady).toBeUndefined();
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
 const fetcher=vi.fn(),page={};run(page,document,fetcher,undefined);expect(page.__inhouseDecorReady).toBeUndefined();expect(fetcher).not.toHaveBeenCalled();
 expect(prepare(()=>{throw Error('fetch');})).toBeUndefined();
});
it('does not fetch again immediately after a failed early request; bounded recovery remains possible',async()=>{
 vi.resetModules();vi.stubGlobal('__inhouseDecorReady',Promise.resolve(null));
 const fetcher=vi.fn(async()=>new Response(bytes));vi.stubGlobal('fetch',fetcher);const clock=vi.spyOn(Date,'now').mockReturnValue(1000);
 const {loadRustDecorCore,getRustDecorCore}=await import('../../src/js/rust-decor-core.js');
 expect(await loadRustDecorCore()).toBeNull();expect(getRustDecorCore()).toBeNull();expect(fetcher).not.toHaveBeenCalled();
 clock.mockReturnValue(30999);expect(await loadRustDecorCore()).toBeNull();expect(fetcher).not.toHaveBeenCalled();
 clock.mockReturnValue(31000);expect((await loadRustDecorCore()).core_abi_version()).toBe(1);expect(fetcher).toHaveBeenCalledOnce();
});
it('validates an early instance through the same ABI checks',async()=>{
 vi.resetModules();vi.stubGlobal('__inhouseDecorReady',Promise.resolve({instance:{exports:{core_abi_version:()=>9}}}));
 const {loadRustDecorCore,getRustDecorCore}=await import('../../src/js/rust-decor-core.js');expect(await loadRustDecorCore()).toBeNull();expect(getRustDecorCore()).toBeNull();
});
it('keeps explicit byte callers independent of an early request',async()=>{
 vi.resetModules();const early=new Promise(()=>{});vi.stubGlobal('__inhouseDecorReady',early);
 const {loadRustDecorCore}=await import('../../src/js/rust-decor-core.js');expect((await loadRustDecorCore({bytes})).core_abi_version()).toBe(1);
 expect(globalThis.__inhouseDecorReady).toBe(early);
});
it('adopts in the first boot module without waiting for it before reading books',()=>{
 const boot=readFileSync('src/js/shelf-boot.js','utf8');
 expect(boot).toContain('void loadRustDecorCore()');expect(boot).not.toContain('await loadRustDecorCore()');
 expect(html.indexOf('id="ihr-rust-decor"')).toBeLessThan(html.indexOf('src="/src/js/app.js"'));
});
