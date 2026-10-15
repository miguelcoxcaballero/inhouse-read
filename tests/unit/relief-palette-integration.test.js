import {beforeAll,afterEach,describe,it,expect,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const runtime=vi.hoisted(()=>({core:null}));
vi.mock('../../src/js/rust-core.js',()=>({getRustCore:()=>runtime.core,loadRustCore:async()=>runtime.core}));
import {analyzePixels} from '../../src/js/cover-relief.js';
import {analyzePixels as original} from './helpers/reference-relief-palette.js';
import {reliefPaletteCases,makeReliefPaletteImage,drainPalette} from '../helpers/relief-palette-cases.mjs';
let core;
beforeAll(async()=>{core=(await WebAssembly.instantiate(readFileSync('src/wasm/inhouse_read_core.wasm'))).instance.exports;runtime.core=core;});
afterEach(()=>{runtime.core=core;});
function exact(a,b){
  assert.equal(a.candidates,a.chosen);assert.equal(b.candidates,b.chosen);
  const fields=value=>({...value,chosen:undefined,candidates:undefined});assert.deepStrictEqual(fields(a),fields(b));
  assert.equal(a.chosen.length,b.chosen.length);
  for(let i=0;i<a.chosen.length;i++){
    const {mask:am,...av}=a.chosen[i],{mask:bm,...bv}=b.chosen[i];assert.deepStrictEqual(av,bv);
    assert.equal(am.constructor,bm.constructor);assert.equal(am.length,bm.length);
    assert.equal(Buffer.compare(Buffer.from(am.buffer,am.byteOffset,am.byteLength),Buffer.from(bm.buffer,bm.byteOffset,bm.byteLength)),0);
  }
}
// Jobs of the analysis are counted at the export boundary: one is made, and every one made is freed.
function tracked(extra={}){
  const state={jobs:0,live:0,arenas:0,steps:0};
  state.core={...core,
    alloc_f64(n){const p=core.alloc_f64(n);if(p)state.arenas+=n;return p;},free_f64(p,n){core.free_f64(p,n);state.arenas-=n;},
    relief_analysis_new(...args){const job=core.relief_analysis_new(...args);if(job){state.jobs++;state.live++;}return job;},
    relief_job_free(job){core.relief_job_free(job);if(job)state.live--;},
    relief_job_step(job){state.steps++;return core.relief_job_step(job);},...extra};
  return state;
}
describe('complete production palette integration',()=>{
  for(const input of reliefPaletteCases)it(input.name,()=>{
    const image=makeReliefPaletteImage(input),before=image.data.slice(),expected=drainPalette(original(image)),state=tracked();
    runtime.core=state.core;
    exact(drainPalette(analyzePixels(image)),expected);assert.deepStrictEqual(image.data,before);
    // Every size takes the native analysis (the old small-image JavaScript bypass is gone), and the job is gone after it.
    expect(state.jobs).toBe(1);expect(state.live).toBe(0);expect(state.arenas).toBe(0);expect(state.steps).toBeGreaterThan(0);
  });
  it('reports a clear error, and leaks nothing, for unavailable, older and trapped cores',()=>{
    const image=makeReliefPaletteImage(reliefPaletteCases[4]);
    for(const [override,message] of [[null,/módulo numérico/],[{relief_analysis_new:undefined},/núcleo de relieve/],
      [{relief_job_step(){throw Error('trap');}},/trap/],[{relief_job_step(){return -1;}},/núcleo de relieve/]]){
      const state=tracked(override||{});
      runtime.core=override?state.core:null;
      expect(()=>drainPalette(analyzePixels(image))).toThrow(message);expect(state.arenas).toBe(0);expect(state.live).toBe(0);
    }
  });
  it('closes the analysis job when the outer analysis is cancelled at a yield',()=>{
    const image=makeReliefPaletteImage(reliefPaletteCases[5]);
    for(const stop of [1,10,54,60,100,200]){
      const state=tracked();runtime.core=state.core;
      const task=analyzePixels(image);for(let i=0;i<stop;i++)if(task.next().done)break;
      task.return();expect(state.live).toBe(0);expect(state.arenas).toBe(0);
    }
  });
});
