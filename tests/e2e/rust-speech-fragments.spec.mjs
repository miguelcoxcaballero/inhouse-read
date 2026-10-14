import {test,expect} from '@playwright/test';
import {createServer} from 'vite';
import {createServer as createHttpServer} from 'node:http';
const html=`<!doctype html><script type="module">
import {loadRustCore} from '/inhouse-read/src/js/rust-core.js';
import {speechSentences,planSpeech} from '/inhouse-read/src/js/readers/speech-text.js';
import * as reference from '/inhouse-read/tests/unit/helpers/reference-speech-text.js';
const core=await loadRustCore();if(!core?.speech_fragments)throw Error('Compiled speech kernel required');
import {loadRustUI} from '/inhouse-read/src/js/rust-ui.js';if(!await loadRustUI())throw Error('Compiled reader UI required');
window.checkSpeech=()=>{
 const sample='Título\\u2029Dijo: «Voy.» Un texto con informa-\\ntion, notas [12], espacios  extra y emojis 😀.\\u2029La oración continúa en la página siguiente sin interrumpir el audio.\\n';
 const times=[],proof=[];
 for(const kind of ['short','long'])for(const length of [1000,16000,128000]){
  const source=kind==='short'?sample:('Una oración larga, con palabras y cláusulas que deben seguir completas al escuchar el libro, '.repeat(8)+'termina aquí. ');
  const raw=source.repeat(Math.ceil(length/source.length)).slice(0,length),options={footnotes:false,pageBreaks:[59,137,357],opening:true};
  const expected=reference.speechSentences(raw),before=window.speechStats.calls,actual=speechSentences(raw);
  if(JSON.stringify(actual)!==JSON.stringify(expected))throw Error('Sentence/fragment mismatch');
  if(JSON.stringify(planSpeech(raw,options))!==JSON.stringify(reference.planSpeech(raw,options)))throw Error('Sentence/page mark mismatch');
  proof.push({kind,length,calls:window.speechStats.calls-before,sentences:actual.length});
  const js=()=>reference.speechSentences(raw),rust=()=>speechSentences(raw),samples={js:[],rust:[]};
  for(let i=0;i<4;i++){js();rust();}
  for(let r=0;r<9;r++)for(const kind of r%2?['rust','js']:['js','rust']){
   const start=performance.now();for(let i=0;i<8;i++)(kind==='js'?js:rust)();samples[kind].push((performance.now()-start)/8);
  }
  const median=a=>[...a].sort((a,b)=>a-b)[4];times.push({kind,length,js:median(samples.js),rust:median(samples.rust),samples});
 }
 return {proof,times,memory:{...window.speechStats}};
};
</script>`;
let vite,http,url;
test.beforeAll(async()=>{
 vite=await createServer({configFile:false,root:process.cwd(),base:'/inhouse-read/',optimizeDeps:{noDiscovery:true},server:{middlewareMode:true,hmr:false,watch:null},
 plugins:[{name:'speech-fixture',configureServer(server){server.middlewares.use(async(req,res,next)=>{
  if(req.url?.split('?')[0]!=='/inhouse-read/__speech')return next();
  try{res.setHeader('Content-Type','text/html');res.end(await server.transformIndexHtml('/inhouse-read/__speech',html));}catch(e){next(e);}
 });}}]});
 http=createHttpServer(vite.middlewares);await new Promise(r=>http.listen(0,'127.0.0.1',r));url='http://127.0.0.1:'+http.address().port+'/inhouse-read/__speech';
});
test.afterAll(async()=>{http?.closeAllConnections();if(http)await new Promise(r=>http.close(r));await vite?.close();});
test('compiled narration fragments preserves text, UTF-16 maps, page marks and arena ownership',async({page},info)=>{
 test.setTimeout(90_000);
 await page.addInitScript(()=>{
  const stats=window.speechStats={calls:0,live:0,peak:0};
  for(const name of ['instantiate','instantiateStreaming'])if(WebAssembly[name]){
   const original=WebAssembly[name];WebAssembly[name]=async function(...args){
    const result=await original.apply(WebAssembly,args),instance=result.instance||result,core=instance.exports;if(!core.speech_sentences)return result;
    const exports={...core,speech_sentences(...args){stats.calls++;return core.speech_sentences(...args);}};
    return result.instance?{...result,instance:{exports}}:{exports};
   };
  }
 });
 await page.setViewportSize({width:390,height:844});const cdp=await page.context().newCDPSession(page);await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
 await page.goto(url);await page.waitForFunction(()=>window.checkSpeech);const result=await page.evaluate(()=>window.checkSpeech());
 // One call of the reader UI module per direct request: the sentence splitter and the fragments are entirely Rust in that module (the shared
 // numeric core keeps the kernel for its own callers and tests; the text side of the product no longer has a JavaScript implementation).
 expect(result.proof).toHaveLength(6);for(const entry of result.proof)expect(entry.calls).toBe(1);expect(result.memory.live).toBe(0);
 await info.attach('speech-fragmentation-parity-and-timing',{body:JSON.stringify(result),contentType:'application/json'});
 console.log(JSON.stringify(result.times.map(({samples,...entry})=>entry)));
});
