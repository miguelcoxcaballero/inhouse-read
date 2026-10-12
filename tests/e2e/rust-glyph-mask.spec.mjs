import {test,expect} from '@playwright/test';
import {createServer} from 'vite';
import {createServer as createHttpServer} from 'node:http';
const html=`<!doctype html><link rel="stylesheet" href="/src/css/fonts.css"><script type="module">
import {loadRustCore} from '/inhouse-read/src/js/rust-core.js';
import {rustGlyphMask} from '/inhouse-read/src/js/font-glyph-wasm.js';
import {analyzeCoverAppearance} from '/inhouse-read/src/js/cover-appearance.js';
import {glyphMask as reference,analyzeCoverAppearance as originalAnalyze} from '/inhouse-read/tests/unit/helpers/reference-cover-appearance.js';
const core=await loadRustCore();if(!core?.font_glyph_mask)throw Error('Actual glyph core required');
const cases=[];
for(const family of ['Playfair Display','Lora','Cormorant Garamond','DM Sans','Montserrat','Oswald']){
 const loaded=await document.fonts.load('700 48px "'+family+'"');if(!loaded.length)throw Error('Bundled font missing: '+family);
 for(const [width,height,size] of [[80,66,12],[192,176,32],[384,352,64]]){
  const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.font='700 '+size+'px "'+family+'"';ctx.fillStyle='#fff';ctx.textBaseline='top';
  for(const [index,text] of ['Immune','A journey','into life'].entries())ctx.fillText(text,2,3+index*size*1.08,width-4);
  cases.push({family,width,height,raw:ctx.getImageData(0,0,width,height).data});
 }
}
const same=(a,b)=>{if(a===null||b===null){if(a!==b)throw Error('Empty differs');return;}for(const key of ['width','height','area'])if(a[key]!==b[key])throw Error(key);for(const key of ['mask','perimeter','foreground','background']){if(a[key].length!==b[key].length)throw Error(key+' length');for(let i=0;i<a[key].length;i++)if(a[key][i]!==b[key][i])throw Error(key+' at '+i);}};
window.checkProductionGlyphs=async()=>{
 const canvas=document.createElement('canvas');canvas.width=360;canvas.height=540;const ctx=canvas.getContext('2d');
 ctx.fillStyle='#2f6b4f';ctx.fillRect(0,0,360,540);ctx.fillStyle='#fffaf0';ctx.font='700 42px "Playfair Display"';ctx.textAlign='center';ctx.fillText('The Garden',180,110,330);
 const url=canvas.toDataURL('image/png'),before=window.glyphCalls;
 const actual=await analyzeCoverAppearance(url,'The Garden'),calls=window.glyphCalls-before,expected=await originalAnalyze(url,'The Garden');
 return {actual,expected,calls};
};
window.checkGlyphs=()=>{
 const results=[];for(const entry of cases){const{raw,width,height}=entry;const run=kind=>kind==='rust'?rustGlyphMask(core,raw,width,height,384):reference(raw,width,height,384);same(run('rust'),run('js'));for(let i=0;i<10;i++){run('js');run('rust');}
 const before=core.memory.buffer.byteLength,timings={js:[],rust:[]};for(let round=0;round<9;round++)for(const kind of round%2?['rust','js']:['js','rust']){const start=performance.now();for(let i=0;i<20;i++)run(kind);timings[kind].push((performance.now()-start)/20);}
 const median=a=>[...a].sort((a,b)=>a-b)[4];results.push({family:entry.family,width,height,js:median(timings.js),rust:median(timings.rust),timings,capacityBefore:before,capacityAfter:core.memory.buffer.byteLength});}return results;
};
</script>`;
let vite,http,url;
test.beforeAll(async()=>{
 vite=await createServer({configFile:false,root:process.cwd(),base:'/inhouse-read/',optimizeDeps:{noDiscovery:true},server:{middlewareMode:true,hmr:false,watch:null},plugins:[{name:'glyph-fixture',configureServer(server){server.middlewares.use(async(req,res,next)=>{if(req.url?.split('?')[0]!=='/inhouse-read/__glyph')return next();try{res.setHeader('Content-Type','text/html');res.end(await server.transformIndexHtml('/inhouse-read/__glyph',html));}catch(e){next(e);}});}}]});
 http=createHttpServer(vite.middlewares);await new Promise(r=>http.listen(0,'127.0.0.1',r));url='http://127.0.0.1:'+http.address().port+'/inhouse-read/__glyph';
});
test.afterAll(async()=>{http?.closeAllConnections();if(http)await new Promise(r=>http.close(r));await vite?.close();});
test('actual Rust glyph cropping keeps every font mask and sample',async({page},testInfo)=>{
 test.setTimeout(120000);page.on('pageerror',error=>console.error(error.message));const cdp=await page.context().newCDPSession(page);await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});await page.goto(url);await page.waitForFunction(()=>typeof window.checkGlyphs==='function',null,{timeout:15000});const result=await page.evaluate(()=>window.checkGlyphs());expect(result).toHaveLength(18);for(const row of result)expect(row.capacityAfter).toBe(row.capacityBefore);console.log(JSON.stringify(result));await testInfo.attach('glyph-cost',{body:JSON.stringify(result,null,2),contentType:'application/json'});
});

test('complete cover analysis invokes the real glyph kernel and keeps the same chosen font',async({page},testInfo)=>{
 test.setTimeout(120000);const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.addInitScript(()=>{window.glyphCalls=0;for(const name of ['instantiate','instantiateStreaming'])if(WebAssembly[name]){const original=WebAssembly[name].bind(WebAssembly);WebAssembly[name]=async(...args)=>{const result=await original(...args),instance=result.instance||result,actual=instance.exports;if(!actual.font_glyph_mask)return result;const exports={...actual,font_glyph_mask(...args){window.glyphCalls++;return actual.font_glyph_mask(...args);}};return result.instance?{module:result.module,instance:{exports}}:{exports};};}});
 await page.goto(url);await page.waitForFunction(()=>typeof window.checkProductionGlyphs==='function',null,{timeout:15000});const result=await page.evaluate(()=>window.checkProductionGlyphs());expect(result.calls).toBeGreaterThan(0);expect(result.actual).not.toBeNull();expect(result.actual).toEqual(result.expected);expect(errors).toEqual([]);await testInfo.attach('production-glyph-call',{body:JSON.stringify(result,null,2),contentType:'application/json'});
});
