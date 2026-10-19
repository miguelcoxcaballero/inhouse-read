// End-to-end bridge comparison: same Rust geometry, former JS bitmap sampling vs native bulk sampling.
// CPU-only Node benchmark; does not measure rendering, mobile thermals or whole-app speed.
import { readFileSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { createBindingRelief, rustBindingBuffers } from '../src/js/binding-wasm.js';
const { instance:{ exports:core } } = await WebAssembly.instantiate(readFileSync(new URL('../src/wasm/inhouse_read_core.wasm', import.meta.url)));
const pixels = Uint8ClampedArray.from({length:256*1024*4},(_,index)=>index%4===3?((index>>>2)*73+(index>>>10)*29)%256:117);
const callback=(u,v)=>pixels[(Math.min(1023,Math.floor((1-v)*1024))*256+Math.min(255,Math.floor(u*256)))*4+3]/255;
const native=createBindingRelief(core,pixels);
const bytes=a=>Buffer.from(a.buffer,a.byteOffset,a.byteLength);
const cases=[];
for(const [name,segments,rows] of [['overview',16,384],['shelf',32,96],['detail',96,384]]){
  const run=sample=>rustBindingBuffers(core,132,200,40,segments,sample,rows);
  const actual=run(native),expected=run(callback);
  for(const key of ['positions','normals','uvs','indices']) assert.deepEqual(bytes(actual[key]),bytes(expected[key]));
  for(let i=0;i<30;i++){run(callback);run(native);}
  const samples={callback:[],native:[]};
  for(let i=0;i<31;i++)for(const kind of i%2?['native','callback']:['callback','native']){
    const start=performance.now();
    for(let j=0;j<10;j++)run(kind==='native'?native:callback);
    samples[kind].push((performance.now()-start)/10);
  }
  const median=xs=>xs.toSorted((a,b)=>a-b)[Math.floor(xs.length/2)];
  const previousMs=median(samples.callback),nativeMs=median(samples.native);
  cases.push({name,segments,rows,exactBytes:true,previousMs,nativeMs,speedup:previousMs/nativeMs});
}
const report={node:process.version,scope:'CPU geometry bridge only; full allocation, bitmap copy, kernels and owned output copies included. Resolution and geometry unchanged.',warmups:30,alternatingRounds:31,repetitions:10,cases};
if(process.argv[2])writeFileSync(process.argv[2],JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
