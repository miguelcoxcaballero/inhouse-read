// @vitest-environment node
import { beforeAll, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { loadRustCore } from '../../src/js/rust-core.js';
import { rustCoverColor } from '../../src/js/cover-color-wasm.js';
import { referenceCoverColorFromPixels } from './helpers/reference-cover-color.js';
import { coverColorCases, createCoverColorPixels } from '../helpers/cover-color-cases.mjs';
let core;
beforeAll(async () => {
  core = await loadRustCore({bytes:readFileSync('src/wasm/inhouse_read_core.wasm')});
  expect(typeof core.cover_dominant_style).toBe('function');
});
const linear = value => {const v=value/255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;};
it('retains exact color, shade and contrast for real sample distributions and half-rounded cluster means', () => {
  for (const sample of coverColorCases) {
    const data = createCoverColorPixels(sample);
    expect(rustCoverColor(core,data,sample.width,sample.height)).toEqual(referenceCoverColorFromPixels(data,sample.width,sample.height));
  }
  for (const samples of [[[0,0,0],[1,1,1],[255,0,0],[0,255,0]],[[90,65,48,0]]]) {
    const data=Uint8Array.from(samples.flatMap(v=>v.length===4?v:[...v,255]));
    expect(rustCoverColor(core,data,samples.length,1)).toEqual(referenceCoverColorFromPixels(data,samples.length,1));
  }
});
it('preserves contrast decisions on both sides of the nearest integer RGB boundary and all grayscale/shade rounding cases', () => {
  const threshold=Math.sqrt(1.05*(.025+.05))-.05;
  const compare=(r,g,b)=>{
    const data=Uint8Array.of(r,g,b,255);
    expect(rustCoverColor(core,data,1,1)).toEqual(referenceCoverColorFromPixels(data,1,1));
  };
  for(let value=0;value<256;value++) compare(value,value,value);
  for(let r=0;r<256;r+=7) for(let b=0;b<256;b+=7) {
    let g=0;while(g<255 && .2126*linear(r)+.7152*linear(g)+.0722*linear(b)<threshold)g++;
    compare(r,g,b);compare(r,Math.max(0,g-1),b);
  }
});
it('uses one bounded arena, retains exact bytes across memory growth and frees on traps', () => {
  const source=Uint8Array.of(123,45,67,255),expected=referenceCoverColorFromPixels(source,1,1);
  let allocated=0,freed=0,calls=0;
  const tracked={...core,alloc_f64(n){allocated++;return core.alloc_f64(n)},free_f64(p,n){freed++;core.free_f64(p,n)},
    cover_dominant_style(...args){calls++;core.memory.grow(1);return core.cover_dominant_style(...args)}};
  expect(rustCoverColor(tracked,source,1,1)).toEqual(expected);
  expect([allocated,freed,calls]).toEqual([1,1,1]);
  expect(Array.from(source)).toEqual([123,45,67,255]);
  expect(rustCoverColor({...tracked,cover_dominant_style(){throw Error('trap')}},source,1,1)).toBeNull();
  expect([allocated,freed]).toEqual([2,2]);
  expect(rustCoverColor(null,source,1,1)).toBeNull();
});
