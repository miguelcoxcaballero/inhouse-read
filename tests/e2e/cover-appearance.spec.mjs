import { test, expect } from '@playwright/test'
import { createServer } from 'vite'
import { createServer as createHttpServer } from 'node:http'

// Production is an ESM graph backed by compiled Rust; only the frozen numerical
// reference remains self-contained. Use the app's actual local font assets.
const html = `<!doctype html><script type="module">
import '/inhouse-read/src/css/fonts.css';
import { analyzeCoverAppearance } from '/inhouse-read/src/js/cover-appearance.js';
import { analyzeCoverAppearance as reference } from '/inhouse-read/tests/unit/helpers/reference-cover-appearance.js';
import { requireRustCore, getRustCoreModule } from '/inhouse-read/src/js/rust-core.js';
await requireRustCore();
window.checkCoverAppearance = async () => {
  const results = [];
  const counted = async work => {
    const create = document.createElement;
    let canvases = 0;
    document.createElement = function(tag,...args) { if (String(tag).toLowerCase() === 'canvas') canvases++; return create.call(this,tag,...args); };
    try { return { value:await work(), canvases }; }
    finally { document.createElement = create; }
  };
  for (const sample of [
    { family:'Oswald', weight:600, title:'A Visual Match' },
    { family:'Playfair Display', weight:700, title:'The Quiet Garden' }
  ]) {
    const fonts = await document.fonts.load(sample.weight+' 42px "'+sample.family+'"');
    if (!fonts.length) throw Error('Production font was not loaded: '+sample.family);
    const canvas = document.createElement('canvas');canvas.width = 360;canvas.height = 540;
    const context = canvas.getContext('2d');
    context.fillStyle = '#2f6b4f';context.fillRect(0,0,canvas.width,canvas.height);
    context.fillStyle = '#fffaf0';context.textAlign = 'center';context.textBaseline = 'middle';
    context.font = sample.weight+' 42px "'+sample.family+'", serif';
    context.fillText(sample.title,180,150);
    const image = canvas.toDataURL('image/png');
    const expected = await counted(() => reference(image,sample.title));
    const actual = await counted(() => analyzeCoverAppearance(image,sample.title));
    results.push({sample,actual:actual.value,expected:expected.value,canvases:{actual:actual.canvases,reference:expected.canvases}});
  }
  return { results, compiledRust:getRustCoreModule() instanceof WebAssembly.Module };
};
</script>`
let vite, http, url

test.beforeAll(async () => {
  vite = await createServer({ configFile:false,root:process.cwd(),base:'/inhouse-read/',
    optimizeDeps:{noDiscovery:true},server:{middlewareMode:true,hmr:false,watch:null},
    plugins:[{name:'cover-appearance-esm-fixture',configureServer(server){server.middlewares.use(async(request,response,next)=>{
      if(request.url?.split('?')[0]!=='/inhouse-read/__cover-appearance')return next()
      try{response.setHeader('Content-Type','text/html');response.end(await server.transformIndexHtml('/inhouse-read/__cover-appearance',html))}
      catch(error){next(error)}
    })}}] })
  http=createHttpServer(vite.middlewares)
  await new Promise(resolve=>http.listen(0,'127.0.0.1',resolve))
  url='http://127.0.0.1:'+http.address().port+'/inhouse-read/__cover-appearance'
})
test.afterAll(async()=>{http?.closeAllConnections();if(http)await new Promise(resolve=>http.close(resolve));await vite?.close()})

test('portada rasterizada: detecta el color dominante y empareja la tipografía del título', async ({ page },info) => {
  const errors=[];page.on('pageerror',error=>errors.push(error.message))
  await page.goto(url)
  await page.waitForFunction(()=>typeof window.checkCoverAppearance==='function')
  const result=await page.evaluate(()=>window.checkCoverAppearance())
  expect(result.compiledRust).toBe(true)
  expect(result.results).toHaveLength(2)
  const supportedFamilies=['Playfair Display','Lora','Cormorant Garamond','DM Sans','Montserrat','Oswald']
  for(const {actual,expected,canvases} of result.results){
    expect(actual).toEqual(expected)
    expect(actual).toMatchObject({color:'#2f6b4f',ink:'#fffaf0',source:'cover'})
    expect(supportedFamilies).toContain(actual.fontFamily)
    expect(actual.fontCanvasFamily).toBe(actual.fontFamily)
    expect(canvases.actual).toBeLessThanOrEqual(8)
    expect(canvases.actual).toBeLessThan(canvases.reference)
  }
  console.log('COVER_RASTER_CANVASES',JSON.stringify(result.results.map(({sample,canvases})=>({title:sample.title,...canvases}))))
  expect(errors).toEqual([])
  await info.attach('cover-appearance-esm-parity',{body:JSON.stringify(result,null,2),contentType:'application/json'})
})
