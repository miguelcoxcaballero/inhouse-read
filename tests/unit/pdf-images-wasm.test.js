// @vitest-environment node
import {readFileSync} from 'node:fs';
import {beforeAll,afterEach,expect,it,vi} from 'vitest';
const state=vi.hoisted(()=>({core:null}));
vi.mock('../../src/js/rust-core.js',()=>({getRustCore:()=>state.core}));
import {rustPDFImageRects} from '../../src/js/readers/pdf-images-wasm.js';
import {pdfImageRects} from '../../src/js/readers/pdf-image-bounds.js';
import {pdfImageRects as reference} from './helpers/reference-pdf-images.js';
let core;
beforeAll(async()=>{core=(await WebAssembly.instantiate(readFileSync('src/wasm/inhouse_read_core.wasm'))).instance.exports;expect(typeof core.pdf_image_rects).toBe('function');state.core=core;});
afterEach(()=>{state.core=core;});
const box=(x,y,w,h)=>[x,y,x+w,y,x,y+h];
const fixtures={
 isolated:Array.from({length:80},(_,i)=>box(i%8/8,Math.floor(i/8)/10,.05,.04)).reverse().flat(),
 overlapping:Array.from({length:80},(_,i)=>box(i/200,i/200,.1,.1)).flat(),
 bridge:[0,0,.1,0,0,.3,.2,.1,.3,.1,.2,.2,.05,.2,.25,.2,.05,.4],
 rotated:[.3,.2,.5,.4,.2,.3],
 outside:[...box(-.1,-.3,.4,.5),...box(.9,.9,.8,.5),...box(3,3,1,1)],
 touching:[...box(0,0,.5,.5),...box(.5,0,.5,.5),...box(0,.5,1,.5)],
 malformed:[NaN,0,0,0,0,0,Infinity,0,0,0,0,0,0,0,0,0,0,0,...box(.2,.2,.1,.1)],
 precision:[-0,-0,.1+1e-12,0,0,.1-1e-12],
 invalidType:['0',0,.2,0,0,.2,...box(.3,.3,.2,.2)],
 trailing:[...box(0,0,.5,.5),1,2,3]
};
for(const [name,input] of Object.entries(fixtures))it(`retains ${name} composite bounds exactly`,()=>{
 expect(rustPDFImageRects(input,1024,2048)).toEqual(reference(input,1024,2048));
 expect(pdfImageRects(input,1024,2048)).toEqual(reference(input,1024,2048));
});
it('matches two hundred rotated, clipped and layered pages without mutating coordinates',()=>{
 let seed=75471;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
 for(let trial=0;trial<200;trial++){
  const input=Array.from({length:1+trial%120},()=>{const x=random()*1.4-.2,y=random()*1.4-.2;return[x,y,x+random()*.1,y+random()*.1,x-random()*.1,y+random()*.1];}).flat();
  const value=trial%2?new Float32Array(input):input,copy=Array.from(value);
  expect(rustPDFImageRects(value,400,800)).toEqual(reference(value,400,800));expect(Array.from(value)).toEqual(copy);
 }
});
it('keeps two thousand disconnected photos in physical reading order',()=>{
 const input=Array.from({length:2000},(_,i)=>box(0,i/2000,.5,.5/2000)).reverse().flat();
 const rects=rustPDFImageRects(input,100,4000);expect(rects).toEqual(reference(input,100,4000));expect(rects).toHaveLength(2000);
});
it('handles empty pages and unsupported dimensions through the original implementation',()=>{
 expect(rustPDFImageRects([],100,200)).toEqual([]);
 for(const dims of [[0,1],[-1,1],[1,NaN],[Infinity,1]]){
  expect(rustPDFImageRects(fixtures.touching,...dims)).toBeUndefined();expect(pdfImageRects(fixtures.touching,...dims)).toEqual(reference(fixtures.touching,...dims));
 }
});
it('returns owned objects even when memory grows during and after the native call',()=>{
 const free=vi.fn(core.free_f64);state.core={...core,free_f64:free,pdf_image_rects(...args){core.memory.grow(1);return core.pdf_image_rects(...args);}};
 const value=rustPDFImageRects(fixtures.overlapping,400,800);core.memory.grow(1);expect(value).toEqual(reference(fixtures.overlapping,400,800));expect(free).toHaveBeenCalledOnce();
});
it('keeps missing, old and failing cores on the original algorithm',()=>{
 for(const engine of [null,{}, {...core,alloc_f64:()=>0},{...core,pdf_image_rects:()=>0xffffffff},{...core,pdf_image_rects:()=>{throw Error('trap');}}]){
  state.core=engine;expect(pdfImageRects(fixtures.overlapping,100,200)).toEqual(reference(fixtures.overlapping,100,200));
 }
});
it('rejects malformed native bounds and always frees the temporary allocation',()=>{
 const free=vi.fn(core.free_f64);state.core={...core,free_f64:free,pdf_image_rects(_p,_n,_w,_h,out){new Float64Array(core.memory.buffer,out,4).set([0,0,Infinity,20]);return 1;}};
 expect(rustPDFImageRects(fixtures.overlapping,100,200)).toBeUndefined();expect(free).toHaveBeenCalledOnce();
});
