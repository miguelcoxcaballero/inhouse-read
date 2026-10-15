// @vitest-environment node
import {readFileSync} from 'node:fs';
import {beforeAll,afterEach,it,expect,vi} from 'vitest';
import assert from 'node:assert/strict';
const state=vi.hoisted(()=>({core:null}));
vi.mock('../../src/js/rust-core.js',()=>({getRustCore:()=>state.core,loadRustCore:async()=>state.core}));
import {rustReliefPalette} from './helpers/reference-palette-bridge.js';
import {analyzePixels} from '../../src/js/cover-relief.js';
import {seedOf,internals} from './helpers/reference-relief-color.js';
import {reliefPaletteCases,makeReliefPaletteImage} from '../helpers/relief-palette-cases.mjs';
let core;
beforeAll(async()=>{core=(await WebAssembly.instantiate(readFileSync('src/wasm/inhouse_read_core.wasm'))).instance.exports;expect(typeof core.relief_cover_seed).toBe('function');state.core=core;});
afterEach(()=>{state.core=core;});
function drain(task){let yields=0;for(;;){const step=task.next();if(step.done)return {value:step.value,yields};yields++;}}
it('preserves every sample across 3831 shapes, unaligned input and source bytes',()=>{
 let cases=0;
 const check=(width,height)=>{const data=new Uint8Array(width*height*4);for(let i=0;i<data.length;i++)data[i]=(Math.imul(i+width*751+height*17,48271)>>>7)&255;
  const n=Math.ceil(data.length/8)+1,p=core.alloc_f64(n);expect(p).toBeGreaterThan(0);
  try{new Uint8Array(core.memory.buffer,p+1,data.length).set(data);expect(core.relief_cover_seed(p+1,width,height)).toBe(seedOf({data,width,height}));assert.deepStrictEqual(new Uint8Array(core.memory.buffer,p+1,data.length),data);cases++;}finally{core.free_f64(p,n);}
 };
 for(let w=1;w<=51;w++)for(let h=1;h<=75;h++)check(w,h);
 for(const [w,h] of [[171,256],[216,288],[341,512],[512,512],[262144,1],[1,262144]])check(w,h);
 expect(cases).toBe(3831);
 for(const args of [[0,1,1],[1,0,1],[1,1,0],[1,513,512],[1,0xffffffff,0xffffffff]])expect(core.relief_cover_seed(...args)).toBe(-1);
});
for(const input of reliefPaletteCases)it('keeps complete palette, proposals and pauses: '+input.name,()=>{
 const image=makeReliefPaletteImage(input),before=image.data.slice();
 const expected=drain(rustReliefPalette(core,image,internals.rgbToOklab)),actual=drain(rustReliefPalette(core,image,internals.rgbToOklab,true));
 const {seed,...palette}=actual.value;assert.deepStrictEqual({value:palette,yields:actual.yields},expected);expect(seed).toBe(seedOf(image));assert.deepStrictEqual(image.data,before);
 const plain=drain(analyzePixels(image)),seeded=drain(analyzePixels(image,true));assert.deepStrictEqual(seeded,plain);
});
it('keeps the generic palette shape; the production analysis carries the seed of its raster and rejects the whole analysis when the job is unavailable or rejected',()=>{
 // The seed is computed inside the analysis job now. There is no JavaScript seed fallback: a rejected job is a
 // clear error, never a second path.
 const image=makeReliefPaletteImage(reliefPaletteCases[4]),expected=drain(analyzePixels(image));expect(expected.value.seed).toBe(seedOf(image));
 const call=vi.fn(core.relief_cover_seed);const ordinary=drain(rustReliefPalette({...core,relief_cover_seed:call},image,internals.rgbToOklab));expect(Object.keys(ordinary.value)).toEqual(['bins','opaque','colors']);expect(call).not.toHaveBeenCalled();
 for(const [replacement,message] of [[undefined,/núcleo de relieve/],[()=>-1,/núcleo de relieve/],[()=>{throw new WebAssembly.RuntimeError('job trap');},/job trap/]]){state.core={...core,relief_job_step:replacement};expect(()=>drain(analyzePixels(image,true))).toThrow(message);}
 state.core={...core,relief_analysis_new:undefined};expect(()=>drain(analyzePixels(image,true))).toThrow(/núcleo de relieve/);
});
it('owns no extra allocation and retains arena validity across memory growth and cancellation',()=>{
 const image=makeReliefPaletteImage(reliefPaletteCases[4]);let live=0,jobs=0,seeds=0;
 const tracked={...core,alloc_f64(n){const p=core.alloc_f64(n);if(p)live+=n;return p;},free_f64(p,n){core.free_f64(p,n);live-=n;},relief_palette_new(n){const p=core.relief_palette_new(n);if(p)jobs++;return p;},relief_palette_free(p){core.relief_palette_free(p);jobs--;},relief_cover_seed(...args){seeds++;return core.relief_cover_seed(...args);}};
 const task=rustReliefPalette(tracked,image,internals.rgbToOklab,true);expect(task.next().done).toBe(false);core.memory.grow(1);const actual=drain(task).value;
 expect(actual.seed).toBe(seedOf(image));expect(seeds).toBe(1);expect(live).toBe(0);expect(jobs).toBe(0);
 for(const stop of [1,5,20]){const pending=rustReliefPalette(tracked,image,internals.rgbToOklab,true);for(let i=0;i<stop;i++)if(pending.next().done)break;pending.return();expect(live).toBe(0);expect(jobs).toBe(0);}
});
