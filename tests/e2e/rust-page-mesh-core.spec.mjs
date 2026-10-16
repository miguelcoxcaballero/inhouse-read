import { expect, test } from '@playwright/test';
import { createServer } from 'vite';
import { createServer as createHttpServer } from 'node:http';
import { paperMeshCases } from '../helpers/page-mesh-cases.mjs';

const html = `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><script type="module">
import { loadRustCore } from '/inhouse-read/src/js/rust-core.js';
import coreUrl from '/inhouse-read/src/wasm/inhouse_read_core.wasm?url';
import { rustPageBlockBuffers, rustLeafStackBuffers } from '/inhouse-read/src/js/page-mesh-wasm.js';
import { pageBlockGeometry, leafStackGeometry } from '/inhouse-read/src/js/book-model.js';
import { referencePageBlockGeometry, referenceLeafStackGeometry } from '/inhouse-read/tests/unit/helpers/reference-page-mesh.js';
const core = await loadRustCore();
if (!core?.page_block_mesh || !core?.leaf_stack_mesh) throw new Error('Actual compiled paper kernels required');
const hash = async array => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',
  new Uint8Array(array.buffer, array.byteOffset, array.byteLength))), n => n.toString(16).padStart(2,'0')).join('');
const describe = async geometry => ({ groups:geometry.groups, fields:Object.fromEntries(await Promise.all(
  Object.entries({...geometry.attributes,index:geometry.index}).map(async ([name,field]) => [name,
    { sha256:await hash(field.array), bytes:field.array.byteLength, type:field.array.constructor.name,
      itemSize:field.itemSize, normalized:field.normalized, version:field.version }])))});
const equal = (a,b) => { if (JSON.stringify(a)!==JSON.stringify(b)) throw new Error('Paper mesh parity changed'); };
window.observePaperMesh = async input => {
  const args = [input.width,input.height,input.depth,input.options], block = input.kind === 'block';
  const js = () => (block ? referencePageBlockGeometry : referenceLeafStackGeometry)(...args);
  const rust = () => (block ? pageBlockGeometry : leafStackGeometry)(...args);
  const expected = js(), actual = rust();
  let reference,production;
  try { reference=await describe(expected);production=await describe(actual);equal(reference,production); }
  finally { expected.dispose();actual.dispose(); }
  let calls=0,live=0,peak=0,allocations=0,releases=0;
  const tracked={...core,
    alloc_f64(n){const p=core.alloc_f64(n);if(p){live+=n*8;peak=Math.max(peak,live);allocations++;}return p;},
    free_f64(p,n){core.free_f64(p,n);live-=n*8;releases++;},
    page_block_finish(...args){calls++;return core.page_block_finish(...args);},
    leaf_stack_finish(...args){calls++;return core.leaf_stack_finish(...args);}};
  const buffers=(block?rustPageBlockBuffers:rustLeafStackBuffers)(tracked,...args);
  if(!buffers || calls!==1 || live!==0 || allocations!==releases)throw new Error('Actual Rust execution/release required');
  for(const [key,name] of [['positions','position'],['normals','normal'],['uvs','uv'],['colors','color'],['indices','index']]) {
    if(buffers[key].buffer===core.memory.buffer)throw new Error('Scratch array escaped');
    equal(await hash(buffers[key]),reference.fields[name].sha256);
  }
  equal(buffers.groups,reference.groups);
  const repetitions=64,warmups=3,rounds=10,samples={javascript:[],rust:[]},orders=[];
  const run=build=>{let sum=0;for(let i=0;i<repetitions;i++){const g=build();sum+=g.attributes.position.array[0]+g.index.array[g.index.count-1];g.dispose();}return sum;};
  const checksum=run(js),pause=()=>new Promise(resolve=>setTimeout(resolve,0));
  for(let i=0;i<warmups;i++){equal(run(js),checksum);equal(run(rust),checksum);await pause();}
  for(let round=0;round<rounds;round++) {
    const order=round%2?['rust','javascript']:['javascript','rust'];orders.push(order);
    for(const kind of order){const start=performance.now(),sum=run(kind==='rust'?rust:js);samples[kind].push(performance.now()-start);equal(sum,checksum);await pause();}
  }
  const last=rust();try{equal(await describe(last),reference);}finally{last.dispose();}
  const response=await fetch(coreUrl);if(!response.ok)throw new Error('WASM response failed');
  const bytes=new Uint8Array(await response.arrayBuffer());
  const median=values=>[...values].sort((a,b)=>a-b)[Math.floor(values.length/2)];
  return {input,reference,production,artifact:{bytes:bytes.length,sha256:await hash(bytes)},samples,orders,
    methodology:{repetitions,warmups,rounds},javascriptPerGeometryMedianMs:median(samples.javascript)/repetitions,
    rustPerGeometryMedianMs:median(samples.rust)/repetitions,
    memory:{calls,liveArenaBytes:live,peakLiveArenaBytes:peak,allocations,releases,wasmCapacityBytes:core.memory.buffer.byteLength}};
};
window.paperMeshReady=true;
</script>`;
let vite, http, url;
test.beforeAll(async () => {
  vite = await createServer({ configFile:false, root:process.cwd(), base:'/inhouse-read/',
    optimizeDeps:{ noDiscovery:true, include:[] }, server:{ middlewareMode:true, hmr:false, watch:null },
    plugins:[{ name:'paper-mesh-fixture', configureServer(server) { server.middlewares.use(async (request,response,next) => {
      if (request.url?.split('?')[0] !== '/inhouse-read/__paper-mesh') return next();
      try { const content=await server.transformIndexHtml('/inhouse-read/__paper-mesh',html);
        response.statusCode=200;response.setHeader('Content-Type','text/html');response.end(content);
      } catch(error) { next(error); }
    }); } }] });
  http=createHttpServer(vite.middlewares);await new Promise(resolve=>http.listen(0,'127.0.0.1',resolve));
  url='http://127.0.0.1:'+http.address().port+'/inhouse-read/__paper-mesh';
});
test.afterAll(async()=>{http?.closeAllConnections();if(http)await new Promise(resolve=>http.close(resolve));await vite?.close();});
test.use({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true});
for(const input of paperMeshCases)test(
  `Rust paper mesh preserves exact ${input.name} at mobile viewport and CPU x4`,async({page,context},info)=>{
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    const cdp=await context.newCDPSession(page);await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
    await page.goto(url);await page.waitForFunction(()=>window.paperMeshReady);
    const result=await page.evaluate(input=>window.observePaperMesh(input),input);
    await info.attach('rust-paper-mesh-observation.json',{contentType:'application/json',body:Buffer.from(JSON.stringify({
      scope:'Desktop Chromium CPU x4; includes coefficients, copies, allocation/free and Three geometry. No GPU, physical phone or whole-app measurement.',
      ...result},null,2))});
    expect(errors).toEqual([]);expect(result.production).toEqual(result.reference);expect(result.memory.calls).toBe(1);
    expect(result.memory.liveArenaBytes).toBe(0);expect(result.memory.allocations).toBe(result.memory.releases);
    for(const samples of Object.values(result.samples)){expect(samples).toHaveLength(10);expect(samples.every(n=>Number.isFinite(n)&&n>=0)).toBe(true);}
  });
