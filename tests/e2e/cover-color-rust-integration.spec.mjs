import { expect, test } from '@playwright/test';
import { createServer } from 'vite';
import { createServer as createHttpServer } from 'node:http';

// Real HTTP ES modules, PNG decode/canvas extraction and actual compiled WASM.
// The only instrumentation passes each kernel call through unchanged.
const html = `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><script type="module">
import { analyzeCoverAppearance, coverColorFromPixels } from '/inhouse-read/src/js/cover-appearance.js';
import { getRustCore, loadRustCore } from '/inhouse-read/src/js/rust-core.js';
import coreUrl from '/inhouse-read/src/wasm/inhouse_read_core.wasm?url';
import { referenceCoverColorFromPixels } from '/inhouse-read/tests/unit/helpers/reference-cover-color.js';
import { createCoverColorPixels } from '/inhouse-read/tests/helpers/cover-color-cases.mjs';
const hash = async data => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',data)),n=>n.toString(16).padStart(2,'0')).join('');
const sample = async kind => {
  const width=192,height=288,data=createCoverColorPixels({width,height,kind});
  const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
  canvas.getContext('2d').putImageData(new ImageData(data,width,height),0,0);
  const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
  const url=URL.createObjectURL(blob),image=new Image();image.src=url;await image.decode();
  const extracted=document.createElement('canvas');extracted.width=width;extracted.height=height;
  const context=extracted.getContext('2d',{willReadFrequently:true});context.drawImage(image,0,0,width,height);
  const decoded=context.getImageData(0,0,width,height).data;
  return {url,decoded,width,height,expected:{...referenceCoverColorFromPixels(decoded,width,height),aspectRatio:width/height,source:'cover'}};
};
window.warmCoverCore = async()=>{
  const core=await loadRustCore();
  if(!core?.cover_dominant_style)throw new Error('Real cover-color WASM kernel unavailable');
  // Import caching is real production module loading, not a substituted adapter.
  // Numeric helpers are statically imported; extraction awaits the native core.
  await Promise.all([
    import('/inhouse-read/src/js/cover-color-wasm.js'),
    import('/inhouse-read/src/js/rust-core.js'),
    import('/inhouse-read/src/js/font-glyph-wasm.js')
  ]);
};
window.exerciseColdCover = async()=>{
  const item=await sample('split');
  try {
    const before=window.__realCoverKernelCalls.length;
    const actual=await analyzeCoverAppearance(item.url,'Two Ink Cover',{matchFont:false});
    return {actual,expected:item.expected,coreAvailable:!!getRustCore(),calls:window.__realCoverKernelCalls.length-before};
  } finally {URL.revokeObjectURL(item.url);}
};
window.exerciseReadyCover = async()=>{
  const observations=[];
  for(const kind of ['split','noise','gradient','mixed-alpha']) {
    const item=await sample(kind);
    try {
      // The first decode may overlap lazy bridge import. It must still match.
      const first=await analyzeCoverAppearance(item.url,'Cover '+kind,{matchFont:false});
      await import('/inhouse-read/src/js/cover-color-wasm.js');
      await import('/inhouse-read/src/js/rust-core.js');
      const before=window.__realCoverKernelCalls.length;
      const actual=await analyzeCoverAppearance(item.url,'Cover '+kind,{matchFont:false});
      const calls=window.__realCoverKernelCalls.slice(before);
      const pureBefore=window.__realCoverKernelCalls.length;
      const pure=coverColorFromPixels(item.decoded,item.width,item.height);
      observations.push({kind,first,actual,expected:item.expected,pure,
        expectedPure:referenceCoverColorFromPixels(item.decoded,item.width,item.height),
        calls,pureCalls:window.__realCoverKernelCalls.length-pureBefore});
    } finally {URL.revokeObjectURL(item.url);}
  }
  const response=await fetch(coreUrl);if(!response.ok)throw new Error('Actual WASM artifact fetch failed');
  const bytes=new Uint8Array(await response.arrayBuffer()),module=await WebAssembly.compile(bytes);
  return {observations,artifact:{bytes:bytes.length,sha256:await hash(bytes),imports:WebAssembly.Module.imports(module)},
    instrumentedInstances:window.__realCoverKernelInstances};
};
window.coverIntegrationReady=true;
</script>`;
let vite, http, url;
test.beforeAll(async()=>{
  vite=await createServer({configFile:false,root:process.cwd(),base:'/inhouse-read/',
    optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true,hmr:false,watch:null},
    plugins:[{name:'cover-color-integration',configureServer(server){server.middlewares.use(async(request,response,next)=>{
      if(request.url?.split('?')[0]!=='/inhouse-read/__cover-color-integration')return next();
      try{const content=await server.transformIndexHtml('/inhouse-read/__cover-color-integration',html);
        response.statusCode=200;response.setHeader('Content-Type','text/html');response.end(content);
      }catch(error){next(error);}
    });}}]});
  http=createHttpServer(vite.middlewares);await new Promise(resolve=>http.listen(0,'127.0.0.1',resolve));
  url='http://127.0.0.1:'+http.address().port+'/inhouse-read/__cover-color-integration';
});
test.afterAll(async()=>{http?.closeAllConnections();if(http)await new Promise(resolve=>http.close(resolve));await vite?.close();});
test.use({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true});
test.beforeEach(async({page})=>{
  await page.addInitScript(()=>{
    window.__realCoverKernelCalls=[];window.__realCoverKernelInstances=0;
    const observe=result=>{
      const instance=result.instance||result,actual=instance.exports;
      if(typeof actual?.cover_dominant_style!=='function')return result;
      window.__realCoverKernelInstances++;
      const exports={...actual,cover_dominant_style(...args){
        const value=actual.cover_dominant_style(...args);
        const style=String.fromCharCode(...new Uint8Array(actual.memory.buffer,args[2],21));
        window.__realCoverKernelCalls.push({sampleCount:args[1],style});
        return value;
      }};
      const observed=new Proxy(instance,{get(target,key){return key==='exports'?exports:Reflect.get(target,key,target);}});
      return result.instance?{...result,instance:observed}:observed;
    };
    for(const name of ['instantiate','instantiateStreaming'])if(typeof WebAssembly[name]==='function'){
      const original=WebAssembly[name];
      WebAssembly[name]=async function(...args){return observe(await Reflect.apply(original,WebAssembly,args));};
    }
  });
});
function assertReady(result){
  expect(result.instrumentedInstances).toBe(1);expect(result.artifact.imports).toEqual([]);
  expect(result.artifact.sha256).toMatch(/^[a-f0-9]{64}$/);expect(result.artifact.bytes).toBeGreaterThan(0);
  expect(result.observations).toHaveLength(4);
  for(const record of result.observations){
    expect(record.first).toEqual(record.expected);expect(record.actual).toEqual(record.expected);
    expect(record.pure).toEqual(record.expectedPure);expect(record.pureCalls).toBe(1);
    expect(record.calls).toHaveLength(1);expect(record.calls[0].sampleCount).toBe(39*58);
    expect(record.calls[0].style).toMatch(/^(#[0-9a-f]{6}){3}$/);
  }
}
test('real URL cover analyzer invokes the actual Rust kernel and preserves decoded-image colors',async({page},info)=>{
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(url);await page.waitForFunction(()=>window.coverIntegrationReady);
  await page.evaluate(()=>window.warmCoverCore());
  const result=await page.evaluate(()=>window.exerciseReadyCover());
  await info.attach('production-cover-rust-proof.json',{contentType:'application/json',body:Buffer.from(JSON.stringify(result,null,2))});
  assertReady(result);expect(errors).toEqual([]);
});
test('a delayed glyph module keeps the page responsive and resumes native extraction',async({page},info)=>{
  let release,started;
  const held=new Promise(resolve=>{release=resolve}),requested=new Promise(resolve=>{started=resolve});
  await page.route('**/src/js/font-glyph-wasm.js*',async route=>{started();await held;await route.continue()});
  try{
    await page.goto(url,{waitUntil:'commit'});await requested;
    const pending=await page.evaluate(async()=>{
      await new Promise(requestAnimationFrame);
      return {ready:!!window.coverIntegrationReady,calls:window.__realCoverKernelCalls.length};
    });
    expect(pending).toEqual({ready:false,calls:0});
    release();await page.waitForFunction(()=>window.coverIntegrationReady);
    await page.evaluate(()=>window.warmCoverCore());
    const ready=await page.evaluate(()=>window.exerciseReadyCover());
    await info.attach('delayed-cover-glyph-proof.json',{contentType:'application/json',body:Buffer.from(JSON.stringify({pending,ready},null,2))});
    assertReady(ready);
  }finally{release();}
});
test('a delayed WASM download keeps the page responsive and resumes exact native extraction',async({page},info)=>{
  let release,started;
  const held=new Promise(resolve=>{release=resolve}),requested=new Promise(resolve=>{started=resolve});
  await page.route('**/src/wasm/inhouse_read_core.wasm',async route=>{started();await held;await route.continue()});
  try{
    await page.goto(url);await page.waitForFunction(()=>window.coverIntegrationReady);
    await page.evaluate(()=>{window.coldFinished=false;window.coldPromise=window.exerciseColdCover().then(result=>{window.coldFinished=true;return result;});});
    await requested;
    const pending=await page.evaluate(async()=>{await new Promise(requestAnimationFrame);return {finished:window.coldFinished,calls:window.__realCoverKernelCalls.length};});
    expect(pending).toEqual({finished:false,calls:0});
    release();const cold=await page.evaluate(()=>window.coldPromise);
    expect(cold.actual).toEqual(cold.expected);expect(cold.coreAvailable).toBe(true);expect(cold.calls).toBe(1);
    const ready=await page.evaluate(()=>window.exerciseReadyCover());
    await info.attach('nonblocking-cover-rust-proof.json',{contentType:'application/json',body:Buffer.from(JSON.stringify({cold,ready},null,2))});
    assertReady(ready);
  }finally{release();}
});
