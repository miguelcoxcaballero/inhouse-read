import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
// Host rendering is stubbed; this measures cache preflight/dispatch, not GPU performance.
const root=fileURLToPath(new URL('..',import.meta.url));
const threeUrl=pathToFileURL(root+'/node_modules/three/build/three.module.js').href;
globalThis.__cacheCore=(await WebAssembly.instantiate(readFileSync(root+'/src/wasm/inhouse_read_core.wasm'))).instance.exports;
const data=source=>'data:text/javascript;base64,'+Buffer.from(source).toString('base64');
const policy=data(readFileSync(root+'/src/js/native-frame-policy.js','utf8').replace("import { loadedRustCore } from './rust-core.js';",'const loadedRustCore=()=>globalThis.__cacheCore;'));
function source(text){return text.replace("'three'", JSON.stringify(threeUrl))
 .replace("import { configureNativeRendererSize } from './native-renderer-size.js';",'const configureNativeRendererSize=()=>{};')
 .replace("import { prepareProgramUniforms } from './gpu-programs.js';",'const prepareProgramUniforms=()=>{};')
 .replace("'./native-frame-policy.js'",JSON.stringify(policy));}
function renderer(){return {domElement:{width:780,height:1688,addEventListener(){},removeEventListener(){}},capabilities:{maxTextureSize:4096},
 shadowMap:{enabled:false},getContext:()=>({drawingBufferWidth:780,drawingBufferHeight:1688}),copyFramebufferToTexture(){},
 setRenderTarget(){},setViewport(){},getScissorTest:()=>false,getScissor(){},getClearColor(){},getClearAlpha:()=>0,
 setScissorTest(){},setClearColor(){},clear(){},render(){},setScissor(){}};}
const oldText=execFileSync('git',['show',`${process.argv[2]||'423ce4ba'}:src/js/native-room-cache.js`],{cwd:root,encoding:'utf8'});
const old=(await import(data(source(oldText)))).createNativeFramebufferCache(renderer());
const current=(await import(data(source(readFileSync(root+'/src/js/native-room-cache.js','utf8'))))).createNativeFramebufferCache(renderer());
function task(cache){const frame=cache.capture(1,{width:390,height:844,ratio:2,x:0,y:0}),layers=[{frame},{frame,x:10,y:30,scale:.5},{frame,x:.25,y:18.3,clip:{left:0,top:0,right:380,bottom:800}}];return ()=>cache.compose(frame,layers);}
const jobs=[task(old),task(current)],samples=[[],[]],iterations=20000;
for(const job of jobs)for(let i=0;i<10000;i++)job();
for(let round=0;round<9;round++)for(const index of round%2?[1,0]:[0,1]){const start=performance.now();for(let i=0;i<iterations;i++)jobs[index]();samples[index].push(performance.now()-start);}
console.log(JSON.stringify({iterations,baselineMedianMs:samples[0].sort((a,b)=>a-b)[4],rustMedianMs:samples[1].sort((a,b)=>a-b)[4],samples},null,2));old.dispose();current.dispose();
