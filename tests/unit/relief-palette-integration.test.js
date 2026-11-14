import {beforeAll,afterEach,describe,it,expect,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const runtime=vi.hoisted(()=>({core:null}));
vi.mock('../../src/js/rust-core.js',()=>({getRustCore:()=>runtime.core,loadRustCore:async()=>runtime.core,loadedRustCore:()=>runtime.core,requireRustCore:async()=>runtime.core}));
import {analyzePixels} from '../../src/js/cover-relief.js';
import {needRustShelf} from '../../src/js/rust-shelf.js';
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
// Jobs of the analysis are counted by the shelf module itself: one is made per pass, and every one made is freed.
const shelf=needRustShelf();
describe('complete production palette integration',()=>{
  for(const input of reliefPaletteCases)it(input.name,()=>{
    const image=makeReliefPaletteImage(input),before=image.data.slice(),expected=drainPalette(original(image)),made=shelf.relief_jobs_made();
    exact(drainPalette(analyzePixels(image)),expected);assert.deepStrictEqual(image.data,before);
    // Every size takes the native analysis (the old small-image JavaScript bypass is gone), and the job is gone after it.
    expect(shelf.relief_jobs_made()-made).toBe(1);expect(shelf.relief_jobs_live()).toBe(0);
  });
  it('reports a clear error, and leaks nothing, for rasters the job cannot take',()=>{
    const made=shelf.relief_jobs_made();
    for(const image of [{width:513,height:512,data:new Uint8ClampedArray(513*512*4)},{width:4,height:4,data:new Float32Array(64)}])
      expect(()=>drainPalette(analyzePixels(image))).toThrow(/núcleo de relieve|RGBA/);
    for(const image of [null,{},{width:0,height:1,data:new Uint8Array(0)},{width:1,height:1,data:new Uint8Array(3)}])expect(()=>drainPalette(analyzePixels(image))).toThrow(/RGBA/);
    expect(shelf.relief_jobs_made()).toBe(made);expect(shelf.relief_jobs_live()).toBe(0);
  });
  it('closes the analysis job when the outer analysis is cancelled at a yield',()=>{
    const image=makeReliefPaletteImage(reliefPaletteCases[5]);
    for(const stop of [1,10,54,60,100,200]){
      const task=analyzePixels(image);let done=false;for(let i=0;i<stop&&!done;i++)done=task.next().done;
      expect(shelf.relief_jobs_live()).toBe(done?0:1);task.return();expect(shelf.relief_jobs_live()).toBe(0);
    }
  });
});
