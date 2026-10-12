// @vitest-environment node
import {readFileSync} from 'node:fs';
import {beforeAll,afterEach,expect,it,vi} from 'vitest';
const state=vi.hoisted(()=>({core:null}));
vi.mock('../../src/js/rust-core.js',()=>({getRustCore:()=>state.core}));
import {rustPDFImagePaths} from '../../src/js/readers/pdf-images-wasm.js';
import {paintPDFTheme} from '../../src/js/readers/pdf-page-theme.js';
import {referenceImagePaths,referencePaintTheme} from './helpers/reference-pdf-image-paths.js';
let core;
beforeAll(async()=>{core=(await WebAssembly.instantiate(readFileSync('src/wasm/inhouse_read_core.wasm'))).instance.exports;state.core=core;expect(typeof core.pdf_image_paths).toBe('function');});
afterEach(()=>{state.core=core;});
const coordinates=count=>Array.from({length:count},(_,i)=>{const x=(i%7)/7-.2,y=i/count-.1;return i%2?[x,y,x+.11,y+.03,x-.04,y+.15]:[x,y,x-.04,y+.15,x+.11,y+.03];}).flat();
const exact=(actual,expected)=>{expect(actual).toBeInstanceOf(Float64Array);expect(Buffer.compare(Buffer.from(actual.buffer,actual.byteOffset,actual.byteLength),Buffer.from(expected.buffer,expected.byteOffset,expected.byteLength))).toBe(0);};
for(const count of [0,1,7,8,32,513,32768])it(`preserves every ordered coordinate for ${count} rotated/mirrored images`,()=>{
 const input=coordinates(count);
 for(const source of [input,Float32Array.from(input),Float64Array.from(input)])for(const [w,h] of [[1,1],[393,845],[1920.5,1080.25]]){
  const before=Array.from(source);exact(rustPDFImagePaths(source,w,h),referenceImagePaths(source,w,h));expect(Array.from(source)).toEqual(before);
 }
});
it('skips nonnumbers and nonfinite sextets, retains degenerates and ignores trailing values',()=>{
 const input=[NaN,0,0,1,1,0,Infinity,0,0,0,0,1,'0',0,0,1,1,0,null,0,0,1,1,0,0,0,0,0,0,0,-0,0,-0,-0,-0,0,...coordinates(8),1,2,3,4,5];
 exact(rustPDFImagePaths(input,400,600),referenceImagePaths(input,400,600));
});
it('recreates output views after memory growth and returns owned buffers',()=>{
 const grow={...core,pdf_image_paths(...args){const value=core.pdf_image_paths(...args);core.memory.grow(1);return value;}};state.core=grow;
 const actual=rustPDFImagePaths(coordinates(32),400,600);state.core=core;rustPDFImagePaths(coordinates(512),800,1200);exact(actual,referenceImagePaths(coordinates(32),400,600));
});
it('does not allocate on unavailable exports or invalid dimensions/counts',()=>{
 const alloc=vi.fn(core.alloc_f64);state.core={...core,alloc_f64:alloc,pdf_image_paths:undefined};expect(rustPDFImagePaths(coordinates(8),400,600)).toBeUndefined();
 state.core={...core,alloc_f64:alloc};for(const [w,h] of [[0,3],[-1,3],[NaN,3],[3,Infinity]])expect(rustPDFImagePaths(coordinates(8),w,h)).toBeUndefined();
 expect(rustPDFImagePaths(new Float64Array(32769*6),400,600)).toBeUndefined();expect(alloc).not.toHaveBeenCalled();
});
it('frees a rejected, throwing or successful pass exactly once',()=>{
 for(const kernel of [()=>-1,()=>0xffffffff,()=>{throw Error('interrupted');},core.pdf_image_paths]){
  const alloc=vi.fn(core.alloc_f64),free=vi.fn(core.free_f64);state.core={...core,alloc_f64:alloc,free_f64:free,pdf_image_paths:kernel};
  const result=rustPDFImagePaths(coordinates(8),400,600);if(kernel===core.pdf_image_paths)expect(result.length).toBe(64);else expect(result).toBeUndefined();
  expect(free).toHaveBeenCalledExactlyOnceWith(alloc.mock.results[0].value,112);
 }
});
function recorder(){const calls=[];const c=new Proxy({},{get:(_,key)=>(...args)=>calls.push([key,...args]),set:(_,key,value)=>{calls.push([key,value]);return true;}});return {calls,target:{width:400,height:600,getContext:()=>c}};}
it('the real theme painter preserves the complete Canvas call sequence including empty masks and recovery',()=>{
 for(const mode of ['native','missing','broken'])for(const input of [coordinates(7),coordinates(8),coordinates(32),Array(48).fill(NaN)])for(const filter of ['none','sepia(.5)','invert(.89) hue-rotate(180deg)']){
  const kernel=vi.fn(core.pdf_image_paths);state.core=mode==='missing'?null:{...core,pdf_image_paths:mode==='broken'?()=>{throw Error('lost');}:kernel};
  const actual=recorder(),expected=recorder(),source={};paintPDFTheme(source,actual.target,filter,input);referencePaintTheme(source,expected.target,filter,input);expect(actual.calls).toEqual(expected.calls);
  if(mode==='native')expect(kernel.mock.calls.length).toBe(input.length>=48&&filter!=='none'?1:0);
 }
});
