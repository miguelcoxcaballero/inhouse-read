import { expect, test } from '@playwright/test';
import { createServer } from 'vite';
import { createServer as createHttpServer } from 'node:http';
import { colorMaskBenchCases } from '../helpers/color-mask-cases.mjs';

const html=`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><script type="module">
import {loadRustCore} from '/inhouse-read/src/js/rust-core.js';
import coreUrl from '/inhouse-read/src/wasm/inhouse_read_core.wasm?url';
import {prepareColorMaskJob} from '/inhouse-read/src/js/cover-color-mask-wasm.js';
import * as original from '/inhouse-read/tests/unit/helpers/reference-relief-color.js';
import * as production from '/inhouse-read/src/js/cover-relief.js';
import {makeColorMaskImage,colorMaskSelection} from '/inhouse-read/tests/helpers/color-mask-cases.mjs';
const core=await loadRustCore();if(!core?.relief_color_mask_pixels)throw new Error('Actual compiled color-mask kernel required');
const hash=async data=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new Uint8Array(data.buffer,data.byteOffset,data.byteLength))),n=>n.toString(16).padStart(2,'0')).join('');
const drain=task=>{let step;do{step=task.next();}while(!step.done);return step.value;};
const rgb=color=>[1,3,5].map(at=>parseInt(color.slice(at,at+2),16));
const lab=color=>original.internals.rgbToOklab(...rgb(color));
const same=(a,b)=>{if(JSON.stringify(a)!==JSON.stringify(b))throw new Error('Full relief parity changed');};
const pause=()=>new Promise(resolve=>setTimeout(resolve,0));
const describe=async maps=>Object.fromEntries(await Promise.all(Object.entries(maps).map(async([key,value])=>[key,
  ArrayBuffer.isView(value)?{type:value.constructor.name,bytes:value.byteLength,sha256:await hash(value)}:value])));
const median=values=>[...values].sort((a,b)=>a-b)[Math.floor(values.length/2)];
const artifact=async()=>{const response=await fetch(coreUrl);if(!response.ok)throw new Error('WASM response failed');const bytes=new Uint8Array(await response.arrayBuffer());return {bytes:bytes.length,sha256:await hash(bytes)};};
window.observeColorMask=async(input,fullMaps)=>{
  const image=makeColorMaskImage(input),selection=colorMaskSelection(input.layers),proof=[];
  let live=0,peak=0,allocations=0,releases=0,calls=0;
  const tracked={...core,
    alloc_f64(n){const p=core.alloc_f64(n);if(p){live+=n*8;peak=Math.max(peak,live);allocations++;}return p;},
    free_f64(p,n){core.free_f64(p,n);live-=n*8;releases++;},
    relief_color_mask_pixels(...args){calls++;return core.relief_color_mask_pixels(...args);}};
  const job=drain(prepareColorMaskJob(tracked,image,original.internals.rgbToOklab));if(!job)throw new Error('Direct preparation unexpectedly fell back');
  try{for(const layer of selection.layers){const expected=drain(original.internals.colorMask(image,layer.color,layer.tolerance));
    const actual=drain(job.mask(lab(layer.color),layer.tolerance));if(!actual)throw new Error('Direct mask unexpectedly fell back');
    const sha=await hash(expected);same(await hash(actual),sha);proof.push({layer,sha256:sha});}
  }finally{job.dispose();}
  if(live!==0||allocations!==releases||calls===0)throw new Error('Prepared arena leaked or kernel unused');
  let fullProof=null,productionCalls=null;
  if(fullMaps){
    const expected=drain(original.buildMapsFromPixels(image,image,selection)),before=window.__colorMaskKernelCalls;
    const actual=drain(production.buildMapsFromPixels(image,image,selection));productionCalls=window.__colorMaskKernelCalls-before;
    const maps=await describe(expected);same(await describe(actual),maps);
    const normals=await hash(drain(original.heightToNormals(expected)));same(await hash(drain(production.heightToNormals(actual))),normals);
    const material=await hash(drain(original.composeMaterialMap(expected)));same(await hash(drain(production.composeMaterialMap(actual))),material);
    fullProof={maps,normals,material};
  }
  const run=rust=>{
    if(fullMaps){const maps=drain((rust?production:original).buildMapsFromPixels(image,image,selection));
      return maps.heightMap[0]+maps.heightMap[maps.heightMap.length-1]+maps.owners[Math.floor(maps.owners.length/2)];}
    const prepared=rust?drain(prepareColorMaskJob(core,image,original.internals.rgbToOklab)):null;if(rust&&!prepared)throw new Error('Benchmark fallback');
    let sum=0;try{for(const layer of selection.layers){const mask=drain(rust?prepared.mask(lab(layer.color),layer.tolerance):original.internals.colorMask(image,layer.color,layer.tolerance));
      sum+=mask[0]+mask[mask.length-1]+mask[Math.floor(mask.length/2)];}
    }finally{prepared?.dispose();}return sum;
  };
  const rounds=fullMaps?3:7,warmups=1,samples={javascript:[],rust:[]},orders=[],checksum=run(false);
  same(run(true),checksum);await pause();
  for(let round=0;round<rounds;round++){const order=round%2?['rust','javascript']:['javascript','rust'];orders.push(order);
    for(const kind of order){const at=performance.now(),sum=run(kind==='rust');samples[kind].push(performance.now()-at);same(sum,checksum);await pause();}}
  return {input,fullMaps,proof,fullProof,productionCalls,inputSha256:await hash(image.data),artifact:await artifact(),samples,orders,
    methodology:{rounds,warmups,chunkPixels:1024},javascriptMedianMs:median(samples.javascript),rustMedianMs:median(samples.rust),
    memory:{liveArenaBytes:live,peakLiveArenaBytes:peak,allocations,releases,calls,wasmCapacityBytes:core.memory.buffer.byteLength}};
};
window.colorMaskReady=true;
</script>`;
let vite,http,url;
test.beforeAll(async()=>{
  vite=await createServer({configFile:false,root:process.cwd(),base:'/inhouse-read/',
    optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true,hmr:false,watch:null},
    plugins:[{name:'color-mask-fixture',configureServer(server){server.middlewares.use(async(request,response,next)=>{
      if(request.url?.split('?')[0]!=='/inhouse-read/__color-mask')return next();
      try{const content=await server.transformIndexHtml('/inhouse-read/__color-mask',html);
        response.statusCode=200;response.setHeader('Content-Type','text/html');response.end(content);
      }catch(error){next(error);}
    });}}]});
  http=createHttpServer(vite.middlewares);await new Promise(resolve=>http.listen(0,'127.0.0.1',resolve));
  url='http://127.0.0.1:'+http.address().port+'/inhouse-read/__color-mask';
});
test.afterAll(async()=>{http?.closeAllConnections();if(http)await new Promise(resolve=>http.close(resolve));await vite?.close();});
test.use({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true});
test.beforeEach(async({page})=>{
  await page.addInitScript(()=>{
    window.__colorMaskKernelCalls=0;
    const observe=result=>{const instance=result.instance||result,actual=instance.exports;
      if(typeof actual?.relief_color_mask_pixels!=='function')return result;
      const exports={...actual,relief_color_mask_pixels(...args){window.__colorMaskKernelCalls++;return actual.relief_color_mask_pixels(...args);}};
      const observed=new Proxy(instance,{get(target,key){return key==='exports'?exports:Reflect.get(target,key,target);}});
      return result.instance?{...result,instance:observed}:observed;};
    for(const name of ['instantiate','instantiateStreaming'])if(typeof WebAssembly[name]==='function'){
      const native=WebAssembly[name];WebAssembly[name]=async function(...args){return observe(await Reflect.apply(native,WebAssembly,args));};
    }
  });
});
for(const fullMaps of [false,true])for(const input of colorMaskBenchCases)test(
  `Rust color masks ${fullMaps?'complete maps':'numeric preparation'} ${input.name} preserve exact outputs at CPU x4`,async({page,context},info)=>{
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    const cdp=await context.newCDPSession(page);await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
    await page.goto(url);await page.waitForFunction(()=>window.colorMaskReady);
    const result=await page.evaluate(({input,fullMaps})=>window.observeColorMask(input,fullMaps),{input,fullMaps});
    await info.attach('rust-color-mask-observation.json',{contentType:'application/json',body:Buffer.from(JSON.stringify({
      scope:'Desktop Chromium CPU x4, synthetic RGBA; full preparation/allocation/copy/free included. Complete-map cases include production ownership and physical height, normal/material hashes; timings exclude raster decode/GPU/physical phone.',
      ...result},null,2))});
    expect(errors).toEqual([]);expect(result.memory.liveArenaBytes).toBe(0);expect(result.memory.allocations).toBe(result.memory.releases);
    if(fullMaps){const eligible=input.layers>=3&&input.width*input.height>=16384;
      expect(result.productionCalls).toBe(eligible?Math.ceil(input.width*input.height/1024)*input.layers:0);}
    for(const samples of Object.values(result.samples)){expect(samples).toHaveLength(fullMaps?3:7);expect(samples.every(n=>Number.isFinite(n)&&n>=0)).toBe(true);}
  });
