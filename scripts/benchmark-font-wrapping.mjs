import {chromium} from '@playwright/test';
import {createServer} from 'vite';
const html=`<!doctype html><meta charset="utf-8"><script type="module">
import {createRustFontWrapCache} from '/inhouse-read/src/js/font-policy-wasm.js';
import {requireRustCore} from '/inhouse-read/src/js/rust-core.js';
window.measure=async()=>{
 const core=await requireRustCore(),c=document.createElement('canvas').getContext('2d'),title='The curious case of the quiet garden and the little golden book';
 let count=0;const context={measureText(text){count++;return c.measureText(text);}};
 const reference=(value,maxWidth)=>{const words=value.trim().split(/\\s+/).filter(Boolean),lines=[];let line='';for(const word of words){const candidate=line?line+' '+word:word;if(line&&context.measureText(candidate).width>maxWidth){lines.push(line);line=word;}else line=candidate;}if(line)lines.push(line);return lines.slice(0,4);};
 function family(native){const cache=native?createRustFontWrapCache(core):null,results=[];try{for(let upper=0;upper<2;upper++)for(let align=0;align<3;align++)for(let i=0;i<4;i++){c.font='bold '+[11,16,22,29][i]+'px Georgia';const text=upper?title.toLocaleUpperCase():title;results.push(native?cache.lines(context,text,190,upper*4+i):reference(text,190));}return results;}finally{cache?.dispose();}}
 const expected=family(false),actual=family(true);if(JSON.stringify(expected)!==JSON.stringify(actual))throw Error('Different lines');
 const measurements=[];
 for(let round=0;round<7;round++){const sample={};for(const native of (round%2?[true,false]:[false,true])){count=0;let t=performance.now();for(let i=0;i<100;i++)family(native);sample[native?'rust':'previous']={ms:performance.now()-t,measurements:count};}measurements.push(sample);}
 return {scope:'Chromium Canvas wrapping, 100 families × 24 requests; excludes glyph raster/scoring and full application',byteEqual:true,samples:measurements};
};</script>`;
const server=await createServer({configFile:false,root:process.cwd(),base:'/inhouse-read/',optimizeDeps:{noDiscovery:true,include:[]},server:{host:'127.0.0.1',port:0},plugins:[{name:'font-wrap-benchmark',configureServer(server){server.middlewares.use((req,res,next)=>{if(req.url?.split('?')[0]!=='/inhouse-read/__wrap')return next();res.setHeader('Content-Type','text/html');res.end(html);});}}]});
let browser;
try{await server.listen();const address=server.httpServer.address();browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--disable-gpu']});const page=await browser.newPage();await page.goto('http://127.0.0.1:'+address.port+'/inhouse-read/__wrap');await page.waitForFunction(()=>window.measure);console.log(JSON.stringify(await page.evaluate(()=>window.measure()),null,2));}
finally{await browser?.close();await server.close();}
