// @vitest-environment node
import { readFileSync } from 'node:fs';
import { beforeAll, expect, it, vi } from 'vitest';
const state=vi.hoisted(()=>({core:null}));
vi.mock('../../src/js/rust-core.js',async original=>({...await original(),getRustCore:()=>state.core}));
import { loadRustCore } from '../../src/js/rust-core.js';
import { rustPrepareSpeech, PCM_MAX_SAMPLES } from '../../src/js/readers/neural-voice/pcm-wasm.js';
import { prepareSpeech } from '../../src/js/readers/neural-voice/pcm.js';
import { peakNormalize, trimSilence, fadeEdges } from './helpers/reference-pcm.js';
import { pcmCases, makePCM } from '../helpers/pcm-cases.mjs';
let core;
const bytes=a=>Buffer.from(a.buffer,a.byteOffset,a.byteLength);
const exact=(a,b)=>expect(Buffer.compare(bytes(a),bytes(b))).toBe(0);
const reference=(a,rate,model)=>{peakNormalize(a,{model});return fadeEdges(trimSilence(a,rate),rate);};
beforeAll(async()=>{
  core=await loadRustCore({bytes:readFileSync(new URL('../../src/wasm/inhouse_read_core.wasm',import.meta.url))});
  expect(typeof core?.pcm_prepare).toBe('function');
});
for(const input of pcmCases)it('preserves every playable PCM byte and leaves source intact: '+input.name,()=>{
  const a=makePCM(input),b=a.slice(), rate=input.rate||22050;
  const expected=reference(a,rate,input.model);
  let calls=0,live=0;
  state.core={...core,
    alloc_f64(n){const p=core.alloc_f64(n);if(p)live+=n;return p;},
    free_f64(p,n){core.free_f64(p,n);live-=n;},
    pcm_prepare(...args){calls++;return core.pcm_prepare(...args);}};
  const actual=prepareSpeech(b,rate,{model:input.model});
  exact(actual,expected);exact(b,makePCM(input));
  expect(calls).toBe(input.count>=4096 ? 1 : 0);expect(live).toBe(0);
  expect(actual.buffer).not.toBe(core.memory.buffer);expect(actual.buffer).not.toBe(b.buffer);
});
it('recreates views after memory growth and frees exactly once',()=>{
  const a=makePCM({count:8193}),b=a.slice();let frees=0;
  const tracked={...core,pcm_prepare(...args){const status=core.pcm_prepare(...args);core.memory.grow(1);return status;},
    free_f64(p,n){frees++;core.free_f64(p,n);}};
  const expected=reference(a,24000),actual=rustPrepareSpeech(tracked,b,24000);
  exact(actual,expected);exact(b,makePCM({count:8193}));expect(frees).toBe(1);
});
it('rejects invalid buffers/rates and a source alias before allocation',()=>{
  const alloc=vi.fn(core.alloc_f64),tracked={...core,alloc_f64:alloc};
  for(const [input,rate] of [[new Float64Array(8),22050],[new Float32Array(),22050],
    [new Float32Array(PCM_MAX_SAMPLES+1),22050],[new Float32Array(20),NaN],
    [new Float32Array(20),0],[new Float32Array(20),384001],
    [new Float32Array(core.memory.buffer,0,20),22050]])expect(rustPrepareSpeech(tracked,input,rate)).toBeNull();
  expect(alloc).not.toHaveBeenCalled();
});
it('does not mutate caller data on allocation, execution or metadata failure',()=>{
  for(const mode of ['allocation','trap','status','metadata','nonfinite']){
    const a=makePCM({count:8192});if(mode==='nonfinite')a[11]=Infinity;
    const before=Buffer.from(bytes(a));let frees=0;
    const tracked={...core,alloc_f64:n=>mode==='allocation'?0:core.alloc_f64(n),
      free_f64(p,n){frees++;core.free_f64(p,n);},pcm_prepare(...args){
        if(mode==='trap')throw Error('failure');if(mode==='status')return 0;
        const status=core.pcm_prepare(...args);
        if(mode==='metadata')new Float64Array(core.memory.buffer,args[1],4)[2]=args[2]+1;
        return status;}};
    expect(rustPrepareSpeech(tracked,a,22050)).toBeNull();exact(a,before);
    expect(frees).toBe(mode==='allocation'?0:1);
  }
});
it('uses unchanged fallback for an unavailable, old or failed core',()=>{
  for(const fallback of [null,{}, {...core,pcm_prepare:()=>0}]){
    state.core=fallback;const a=makePCM({count:9000}),b=a.slice();
    exact(prepareSpeech(b,44100),reference(a,44100));exact(b,makePCM({count:9000}));
  }
});
it('covers signed zero and exact threshold values with nonzero-offset inputs',()=>{
  for(const rate of [1,125,11025,16000,22050,24000,44100,48000,384000]){
    const storage=new Float32Array(8196).fill(17),b=storage.subarray(2,8194);
    b.fill(-0);b[500]=.02;b[501]=-.02;b[3000]=1;b[4000]=.002;b[4001]=-.002;
    const before=b.slice(), a=b.slice(), expected=reference(a,rate);
    exact(rustPrepareSpeech(core,b,rate),expected);exact(b,before);
    expect(Array.from(storage.subarray(0,2))).toEqual([17,17]);expect(Array.from(storage.subarray(-2))).toEqual([17,17]);
  }
});
