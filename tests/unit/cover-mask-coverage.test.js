// @vitest-environment node
import {readFileSync} from 'node:fs';
import {beforeAll,afterEach,it,expect,vi} from 'vitest';
const state=vi.hoisted(()=>({core:null}));
vi.mock('../../src/js/rust-core.js',()=>({getRustCore:()=>state.core,loadRustCore:async()=>state.core}));
import {prepareColorMaskJob,countPreparedMaskPixels} from './helpers/reference-color-mask-bridge.js';
import {analyzePixels} from '../../src/js/cover-relief.js';
import {analyzePixels as frozenAnalysis,internals} from './helpers/reference-relief-color.js';
import {colorMaskCases,colorMaskPalette,makeColorMaskImage} from '../helpers/color-mask-cases.mjs';
let core;
beforeAll(async()=>{core=(await WebAssembly.instantiate(readFileSync('src/wasm/inhouse_read_core.wasm'))).instance.exports;expect(typeof core.relief_color_mask_count).toBe('function');state.core=core;});
afterEach(()=>{state.core=core;});
function drain(task){let yields=0;for(;;){const next=task.next();if(next.done)return {value:next.value,yields};yields++;}}
const lab=color=>internals.rgbToOklab(...[1,3,5].map(at=>parseInt(color.slice(at,at+2),16)));
const positive=mask=>mask.reduce((sum,value)=>sum+(value>0?1:0),0);
for(const input of colorMaskCases)it(`counts exactly the rounded membership for ${input.name}`,()=>{
 const image=makeColorMaskImage(input),counted=vi.fn(core.relief_color_mask_count),free=vi.fn(core.free_f64);
 const job=drain(prepareColorMaskJob({...core,relief_color_mask_count:counted,free_f64:free},image,internals.rgbToOklab)).value;
 try{for(const color of colorMaskPalette)for(const tolerance of [1,5.4,6,12]){
  const actual=drain(job.mask(lab(color),tolerance,true)),original=drain(job.mask(lab(color),tolerance));
  expect(Buffer.compare(Buffer.from(actual.value.buffer),Buffer.from(original.value.buffer))).toBe(0);expect(actual.yields).toBe(original.yields);
  const coverage=drain(countPreparedMaskPixels(actual.value));expect(coverage.value).toBe(positive(original.value));expect(coverage.yields).toBe(Math.floor(actual.value.length/4096));
  // The cached result is single-use; later edits are counted from current pixels.
  actual.value.fill(0);expect(drain(countPreparedMaskPixels(actual.value)).value).toBe(0);
 }}finally{job.dispose();}
 expect(counted).toHaveBeenCalled();expect(free).toHaveBeenCalledOnce();
});
// The count is taken inside the analysis job now (it has no export of its own to spy on): the production proposals,
// with every mask and coverage, equal the frozen original's. The safe points are those of the job's own chunks.
for(const input of [colorMaskCases[1],colorMaskCases[2],colorMaskCases[4],colorMaskCases[6]])it(`keeps full proposal bytes for ${input.name}`,()=>{
 const image=makeColorMaskImage(input);const original=drain(frozenAnalysis(image));
 const actual=drain(analyzePixels(image));
 expect(actual.value).toEqual(original.value);expect(actual.yields).toBeGreaterThanOrEqual(Math.floor(image.width*image.height/1024));
});
it('counts plain, short and missing-native masks with the original comparisons and pauses',()=>{
 for(const size of [0,1,4095,4096,4097,8192]){const mask=Float32Array.from({length:size},(_,i)=>[0,-0,NaN,Infinity,-Infinity,-1,1,1e-44][i%8]);const result=drain(countPreparedMaskPixels(mask));expect(result.value).toBe(positive(mask));expect(result.yields).toBe(Math.floor(size/4096));}
 const image=makeColorMaskImage(colorMaskCases[1]),job=drain(prepareColorMaskJob({...core,relief_color_mask_count:undefined},image,internals.rgbToOklab)).value;
 try{const mask=drain(job.mask(lab('#2f6b4f'),6,true)).value;expect(drain(countPreparedMaskPixels(mask)).value).toBe(positive(mask));}finally{job.dispose();}
});
it('survives interleaved growth and cancellation at counted mask and coverage pauses',()=>{
 const image=makeColorMaskImage(colorMaskCases[2]),free=vi.fn(core.free_f64),engine={...core,free_f64:free};
 let job=drain(prepareColorMaskJob(engine,image,internals.rgbToOklab)).value,task=job.mask(lab('#2f6b4f'),6,true);
 expect(task.next().done).toBe(false);core.memory.grow(1);const result=drain(task).value;expect(drain(countPreparedMaskPixels(result)).value).toBe(positive(result));job.dispose();expect(free).toHaveBeenCalledOnce();
 free.mockClear();job=drain(prepareColorMaskJob(engine,image,internals.rgbToOklab)).value;task=job.mask(lab('#2f6b4f'),6,true);task.next();task.return();expect(free).toHaveBeenCalledOnce();expect(drain(job.mask(lab('#2f6b4f'),6,true)).value).toBeNull();
});
it('rejects bad ranges without writes and counts rounded values including non-finite Lab',()=>{
 const count=8,length=40,p=core.alloc_f64(length);expect(p).toBeGreaterThan(0);
 try{
  const labs=new Float64Array(core.memory.buffer,p,count*3),alpha=new Uint8Array(core.memory.buffer,p+count*24,count),out=new Float32Array(core.memory.buffer,p+count*24+8,count);
  alpha.fill(255);labs.fill(0);labs[3]=NaN;labs[6]=Infinity;alpha[3]=127;alpha[4]=128;
  expect(core.relief_color_mask_count(p,p+count*24,p+count*24+8,count,0,count,0,0,0,6)).toBe(6);expect(positive(out)).toBe(5);
  for(const [n,from,to,tolerance] of [[0,0,0,6],[count,2,1,6],[count,0,9,6],[count,0,count,0],[count,0,count,NaN]]){out.fill(17);expect(core.relief_color_mask_count(p,p+count*24,p+count*24+8,n,from,to,0,0,0,tolerance)).toBe(0);expect([...out]).toEqual(new Array(count).fill(17));}
 }finally{core.free_f64(p,length);}
});
