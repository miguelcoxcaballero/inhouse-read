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
describe('complete production palette integration',()=>{
  for(const input of reliefPaletteCases)it(input.name,()=>{
    const image=makeReliefPaletteImage(input),before=image.data.slice(),expected=drainPalette(original(image));let jobs=0;
    runtime.core={...core,relief_palette_new(n){jobs++;return core.relief_palette_new(n);}};
    exact(drainPalette(analyzePixels(image)),expected);assert.deepStrictEqual(image.data,before);
    // Every size takes the native palette now (the old small-image JavaScript bypass is gone).
    expect(jobs).toBe(1);
  });
  it('reports a clear error, and leaks nothing, for unavailable, older and trapped cores',()=>{
    const image=makeReliefPaletteImage(reliefPaletteCases[4]);
    for(const [candidate,message] of [[null,/módulo numérico/],[{...core,relief_palette_new:undefined},/núcleo de relieve/],[{...core,relief_palette_pixels(){throw Error('trap');}},/núcleo de relieve/]]){
      let live=0,jobs=0;
      runtime.core=candidate&&{...candidate,alloc_f64(n){const p=core.alloc_f64(n);if(p)live+=n;return p;},free_f64(p,n){core.free_f64(p,n);live-=n;},
        relief_palette_new(n){const p=(candidate.relief_palette_new??(()=>0))(n);if(p)jobs++;return p;},relief_palette_free(p){core.relief_palette_free(p);jobs--;}};
      expect(()=>drainPalette(analyzePixels(image))).toThrow(message);expect(live).toBe(0);expect(jobs).toBe(0);
    }
  });
  it('closes the palette job when the outer analysis is cancelled at a yield',()=>{
    const image=makeReliefPaletteImage(reliefPaletteCases[5]);
    for(const stop of [1,10,54,60,100,200]){
      let live=0;
      runtime.core={...core,relief_palette_new(n){const p=core.relief_palette_new(n);if(p)live++;return p;},
        relief_palette_free(p){core.relief_palette_free(p);live--;}};
      const task=analyzePixels(image);for(let i=0;i<stop;i++)if(task.next().done)break;
      task.return();expect(live).toBe(0);
    }
  });
});
