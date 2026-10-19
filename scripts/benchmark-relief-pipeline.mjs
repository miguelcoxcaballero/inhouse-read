// Full scoped bridge timing: uploads, Rust passes and final owned output copies.
// This does not measure GPU rendering, startup or physical-device temperature.
import {readFileSync,writeFileSync} from 'node:fs';
import {performance} from 'node:perf_hooks';
import assert from 'node:assert/strict';
import {wasmRenderRelief,wasmHeightToNormals,wasmComposeReliefLayers,wasmReliefRgbaPlanes} from '../src/js/cover-relief-wasm.js';
import {mapsFor,layers} from '../tests/helpers/cover-relief-reference.mjs';
const wasm=readFileSync(new URL('../src/wasm/inhouse_read_core.wasm',import.meta.url));
const previousWasm=process.argv[3]?readFileSync(process.argv[3]):wasm;
const instantiate=async(bytes=wasm)=> (await WebAssembly.instantiate(bytes)).instance.exports;
const drain=task=>{for(;;){const step=task.next();if(step.done)return step.value;}};
const bytes=a=>Buffer.from(a.buffer,a.byteOffset,a.byteLength);
const cases=[];
for(const pattern of ['coating','noise'])for(const [width,height]of [[128,193],[288,384],[512,512]])for(const compose of [false,true]){
 const core=await instantiate(),previousCore=await instantiate(previousWasm),maps=mapsFor(width,height),unit=.6/255/(2*(200/Math.max(width,height)));
 if(pattern==='coating')for(let i=0;i<width*height;i++){
  const x=i%width,y=Math.floor(i/width),edge=Math.min(x%36,35-x%36,y%64,63-y%64),owner=1+Math.floor(x/36)%10;
  maps.owners[i]=owner;maps.baseMask[i]=edge<2?0:255;maps.baseHeight[i]=edge<2?0:128*Math.min(1,(edge-2)/4);
  const strength=layers[owner-1].strength;maps.mask[i]=strength>0?maps.baseMask[i]:0;
  maps.gloss[i]=Math.round(maps.baseMask[i]*strength);maps.heightMap[i]=Math.round(maps.baseHeight[i]*strength);maps.foil[i]=0;
 }
 const before=()=>{
  const pixels=compose?drain(wasmComposeReliefLayers(previousCore,maps,layers)):maps;
  const normal=drain(wasmHeightToNormals(previousCore,pixels,unit,{selectionAlpha:true}));
  return{normal,pixels,...(compose?{}:wasmReliefRgbaPlanes(previousCore,pixels))};
 };
 const after=()=>drain(wasmRenderRelief(core,maps,unit,{selectionAlpha:true,rgba:!compose,...(compose?{layers}:{})}));
 const expected=before(),actual=after();
 for(const key of compose?['normal']:['normal','height','foil','gloss'])assert.deepEqual(bytes(actual[key]),bytes(expected[key]));
 for(const key of ['heightMap','mask','gloss','foil'])assert.deepEqual(bytes(actual.pixels[key]),bytes(expected.pixels[key]));
 for(let i=0;i<12;i++){before();after();}
 const capacityBefore=core.memory.buffer.byteLength,samples={before:[],after:[]};
 for(let i=0;i<21;i++)for(const [name,run]of i%2?[['after',after],['before',before]]:[['before',before],['after',after]]){
  const start=performance.now();for(let n=0;n<5;n++)run();samples[name].push((performance.now()-start)/5);
 }
 const median=xs=>xs.toSorted((a,b)=>a-b)[10],previousMs=median(samples.before),nativeMs=median(samples.after);
 assert.equal(core.memory.buffer.byteLength,capacityBefore,'Repeated bakes must not grow native capacity after warmup');
 cases.push({pattern,width,height,compose,previousCapacity:previousCore.memory.buffer.byteLength,exactBytes:true,previousMs,nativeMs,speedup:previousMs/nativeMs,capacityBefore,capacityAfter:core.memory.buffer.byteLength,samples});
}
const report={runtime:process.version,previousArtifact:process.argv[3]||'same core legacy bridge',scope:'CPU bridge only; inputs, native passes, final copies and disposal included; no image-quality changes.',cases};
if(process.argv[2])writeFileSync(process.argv[2],JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
