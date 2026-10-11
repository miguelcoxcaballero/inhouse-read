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
    expect(jobs).toBe(input.width*input.height>=4096?1:0);
  });
  it('falls back completely for unavailable, older and trapped cores',()=>{
    const image=makeReliefPaletteImage(reliefPaletteCases[4]),expected=drainPalette(original(image));
    for(const candidate of [null,{...core,relief_palette_new:undefined},{...core,relief_palette_pixels(){throw Error('trap');}}]){
      runtime.core=candidate;exact(drainPalette(analyzePixels(image)),expected);
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
