import {describe,it,expect} from 'vitest';
import {supertonicRuntimeConfig,supertonicTextIds,supertonicLocalMarks,supertonicNoise,createSupertonicPcmJoin,createSupertonicState,supertonicStyleValid} from '../../src/js/readers/neural-voice/supertonic-plan.js';
import {loadedRustVoiceCore} from '../../src/js/rust-voice-core.js';

const config={ae:{sample_rate:24000,base_chunk_size:512},ttl:{chunk_compress_factor:6,latent_dim:24}};
function rng(seed=42){return()=>((seed=Math.imul(seed,1664525)+1013904223>>>0)/4294967296);}
function referenceNoise(n,random){const out=new Float32Array(n);for(let i=0;i<n;i++)out[i]=Math.sqrt(-2*Math.log(Math.max(.0001,random())))*Math.cos(2*Math.PI*random());return out;}

describe('Supertonic native numeric plans',()=>{
 it('serializes jobs and ignores stale completion while closing idempotently',()=>{
  const state=createSupertonicState();
  try{
   expect(state.begin(false,1)).toBe(-3);expect(state.begin(true,'1')).toBe(-3);
   const first=state.begin(true,1);expect(first).toBeGreaterThan(0);expect(state.begin(true,1)).toBe(-2);
   state.finish(first);const second=state.begin(true,2);expect(second).toBeGreaterThan(first);
   state.finish(first);expect(state.begin(true,1)).toBe(-2);
   expect(state.active()).toBe(true);expect(state.close()).toBe(true);expect(state.active()).toBe(false);
   expect(state.close()).toBe(false);state.finish(second);expect(state.begin(true,1)).toBe(-1);
  }finally{state.dispose();state.dispose();}
  expect(state.active()).toBe(false);expect(state.begin(true,1)).toBe(-1);expect(state.close()).toBe(false);
 });
 it('validates tensor dimensions and numeric data without changing Float32 values',()=>{
  expect(supertonicStyleValid([1,1,2],[.1,.2])).toBe(true);
  for(const dims of [[1,2],[2,1,2],[1,0,2],[1,1.2,2],[1,NaN,2],[1,'1',2]])expect(supertonicStyleValid(dims,[.1,.2])).toBe(false);
  for(const data of [[1],[1,NaN],[1,Infinity],[1,'2'],null])expect(supertonicStyleValid([1,1,2],data)).toBe(false);
 });
 it('keeps all seeded Gaussian samples bit-identical across block boundaries',()=>{
  for(const n of [0,1,255,256,257,3072,65537])expect(supertonicNoise(n,rng())).toEqual(referenceNoise(n,rng()));
 });
 it('keeps zero, negatives, extreme uniforms and NaN semantics',()=>{
  const values=[0,-1,-0,.00001,.0001,.5,1,Infinity,NaN];
  const make=()=>{let i=0;return()=>values[i++%values.length];};
  expect(supertonicNoise(513,make())).toEqual(referenceNoise(513,make()));
 });
 it('survives RNG reentrancy which grows native memory, without changing the stream',()=>{
  const core=loadedRustVoiceCore();let i=0;const random=rng();
  expect(supertonicNoise(600,()=>{if(++i===37)core.memory.grow(1);return random();})).toEqual(referenceNoise(600,rng()));
  expect(()=>supertonicNoise(2,()=>1n)).toThrow(TypeError);
  expect(supertonicNoise(2,rng())).toEqual(referenceNoise(2,rng()));
 });
 it('converts UTF-16 exactly, including lone surrogates and indexer growth',()=>{
  const core=loadedRustVoiceCore();const indexer=new Proxy([],{get(_,key){if(key==='128512')core.memory.grow(1);return BigInt(key)*19n;}});
  const text='a😀\ud800z\udc00𝄞';
  expect(supertonicTextIds(text,indexer)).toEqual(BigInt64Array.from(Array.from(text),c=>BigInt(c.codePointAt(0))*19n));
  expect(supertonicTextIds('',[])).toEqual(new BigInt64Array());
  expect(supertonicTextIds('abc',[])).toEqual(BigInt64Array.of(-1n,-1n,-1n));
 });
 it('matches numeric-only interior marks across many chunk intervals',()=>{
  const marks=[-1,0,1,1.2,2,8,9,10,NaN,Infinity,'2',null,undefined,new Number(3)];
  for(let start=-2;start<12;start++)for(let end=start;end<15;end++)expect(supertonicLocalMarks(marks,start,end)).toEqual(marks.filter(n=>Number.isInteger(n)&&n>start&&n<end).map(n=>n-start));
 });
 it('keeps config product validation and strict denoising-step validation',()=>{
  expect(supertonicRuntimeConfig(config,6)).toEqual({sampleRate:24000,chunkSize:3072,latentDim:144});
  for(const steps of [undefined,NaN,1,17,2.2,'6',null])expect(()=>supertonicRuntimeConfig(config,steps)).toThrow('Pasos');
  for(const rate of [7999,96001,NaN,8000.5])expect(()=>supertonicRuntimeConfig({...config,ae:{...config.ae,sample_rate:rate}},6)).toThrow('Dimensiones');
 });
 it('plans exact silent gaps and zero-length chunks without allocating PCM gaps',()=>{
  for(const rate of [8000,22050,24000,44100,96000]){
   const join=createSupertonicPcmJoin(rate);let length=0,count=0;
   try{for(const n of [0,10,0,999,20,0,1]){
    const expected=n?length+(count?Math.floor(rate*.15):0):-1;
    expect(join.append(n)).toBe(expected);if(n){length=expected+n;count++;}expect(join.length).toBe(length);
   }}finally{join.dispose();join.dispose();}
  }
 });
 it('bounds scratch memory over repeated audio jobs and frees aborted calls',()=>{
  const core=loadedRustVoiceCore();supertonicNoise(1000,rng());const before=core.memory.buffer.byteLength;
  for(let i=0;i<500;i++){const join=createSupertonicPcmJoin(24000);join.append(3000);join.dispose();supertonicNoise(512,rng(i));}
  expect(core.memory.buffer.byteLength).toBeLessThanOrEqual(before+65536);
 });
});
