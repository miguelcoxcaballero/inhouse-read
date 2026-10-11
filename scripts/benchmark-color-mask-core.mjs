// Numeric membership cost only, including full preparation, owned outputs,
// all boundary copies and release. Not a physical-phone/full-map timing.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { cpus } from 'node:os';
import { prepareColorMaskJob } from '../src/js/cover-color-mask-wasm.js';
import { colorMaskBenchCases, makeColorMaskImage, colorMaskSelection } from '../tests/helpers/color-mask-cases.mjs';
const source=await readFile(new URL('../tests/unit/helpers/reference-relief-color.js',import.meta.url),'utf8');
const coefficients=source.slice(source.indexOf('const LINEAR_RGB ='),source.indexOf('function colorName('));
const classifier=source.slice(source.indexOf('function* colorMask('),source.indexOf('/** Up to ten distinct supported colors'));
assert.ok(coefficients.includes('Math.cbrt')&&classifier.includes('function* colorMask('));
const {rgbToOklab,colorMask,rgbOf}=new Function(`const clamp=(value,low,high)=>Math.min(high,Math.max(low,value));
const smoothstep=(a,b,x)=>{const t=clamp((x-a)/(b-a),0,1);return t*t*(3-2*t);};
${coefficients}\n${classifier}\nreturn {rgbToOklab,colorMask,rgbOf};`)();
const bytes=await readFile(new URL('../src/wasm/inhouse_read_core.wasm',import.meta.url));
const at=performance.now(),{instance}=await WebAssembly.instantiate(bytes),core=instance.exports,initializationMs=performance.now()-at;
assert.equal(typeof core.relief_color_mask_pixels,'function');
const hash=data=>createHash('sha256').update(new Uint8Array(data.buffer,data.byteOffset,data.byteLength)).digest('hex');
const drain=task=>{let step;do{step=task.next();}while(!step.done);return step.value;};
const median=values=>[...values].sort((a,b)=>a-b)[Math.floor(values.length/2)];
const rounds=9,warmups=2,measurements=[];
for(const input of colorMaskBenchCases){
  const image=makeColorMaskImage(input),selection=colorMaskSelection(input.layers),proof=[];
  let live=0,peak=0,allocations=0,releases=0,calls=0;
  const tracked={...core,
    alloc_f64(n){const p=core.alloc_f64(n);if(p){live+=n*8;peak=Math.max(peak,live);allocations++;}return p;},
    free_f64(p,n){core.free_f64(p,n);live-=n*8;releases++;},
    relief_color_mask_pixels(...args){calls++;return core.relief_color_mask_pixels(...args);}};
  const proofJob=drain(prepareColorMaskJob(tracked,image,rgbToOklab));assert.ok(proofJob,'Direct preparation must not fall back');
  try{for(const layer of selection.layers){const expected=drain(colorMask(image,layer.color,layer.tolerance));
    const actual=drain(proofJob.mask(rgbToOklab(...rgbOf(layer.color)),layer.tolerance));assert.ok(actual);
    assert.equal(hash(actual),hash(expected));proof.push({layer,sha256:hash(actual)});
  }}finally{proofJob.dispose();}
  assert.equal(live,0);assert.equal(allocations,releases);assert.ok(calls>0);
  const run=rust=>{const job=rust?drain(prepareColorMaskJob(core,image,rgbToOklab)):null;if(rust)assert.ok(job);
    let checksum=0;try{for(const layer of selection.layers){const mask=drain(rust?job.mask(rgbToOklab(...rgbOf(layer.color)),layer.tolerance):colorMask(image,layer.color,layer.tolerance));
      checksum+=mask[0]+mask[mask.length-1]+mask[Math.floor(mask.length/2)];}
    }finally{job?.dispose();}return checksum;};
  const checksum=run(false),samples={javascript:[],rust:[]},orders=[];
  for(let i=0;i<warmups;i++){assert.equal(run(false),checksum);assert.equal(run(true),checksum);}
  for(let round=0;round<rounds;round++){const order=round%2?['rust','javascript']:['javascript','rust'];orders.push(order);
    for(const kind of order){const start=performance.now(),actual=run(kind==='rust');samples[kind].push(performance.now()-start);assert.equal(actual,checksum);}}
  measurements.push({input,proof,inputSha256:hash(image.data),orders,samples,javascriptMedianMs:median(samples.javascript),rustMedianMs:median(samples.rust),
    memory:{liveArenaBytes:live,peakLiveArenaBytes:peak,allocations,releases,calls,wasmCapacityBytes:core.memory.buffer.byteLength}});
}
const report={generatedAt:new Date().toISOString(),environment:{node:process.version,platform:process.platform,cpu:cpus()[0]?.model},
  artifact:{bytes:bytes.length,sha256:hash(bytes)},initializationMs,referenceSha256:createHash('sha256').update(source).digest('hex'),
  scope:'Desktop numeric membership including browser-equivalent JS Math.cbrt preparation, all copies, actual Rust classify, allocation/free. Synthetic pixels. No image decode, full maps, GPU or physical phone performance.',
  methodology:{warmups,rounds,alternating:true,chunkPixels:1024},measurements};
const json=JSON.stringify(report,null,2)+'\n';if(process.argv[2])await writeFile(process.argv[2],json,{flag:'wx'});process.stdout.write(json);
