// @vitest-environment node
// The image-region bridge moved from pdf-images-wasm.js to rust-ui pdf_core_bridge.rs. Both sides run
// the same compiled rust-core kernel; this compares every answer, refusal and error of the frozen
// JavaScript bridge with the Rust one, including replaced, failing and absent cores.
import {readFileSync} from 'node:fs';
import {beforeAll,afterEach,expect,it,vi} from 'vitest';
const state=vi.hoisted(()=>({core:null}));
vi.mock('../../src/js/rust-core.js',()=>({getRustCore:()=>state.core}));
import * as bridge from '../../src/js/readers/pdf-images-wasm.js';
import * as frozen from './helpers/reference-pdf-images-bridge.js';
let core;
beforeAll(async()=>{core=(await WebAssembly.instantiate(readFileSync('src/wasm/inhouse_read_core.wasm'))).instance.exports;state.core=core;});
afterEach(()=>{state.core=core;});
const outcome=run=>{try{const value=run();return {value:value instanceof Float64Array?['f64',Array.from(value)]:value};}catch(error){return {error:String(error?.message)};}};
const same=(name,...args)=>{
 const expected=outcome(()=>frozen[name](...args)),actual=outcome(()=>bridge[name](...args));
 expect(actual).toEqual(expected);
 if(expected.value&&typeof expected.value==='object'&&!Array.isArray(expected.value))return;
 for(const [key,value] of Object.entries(expected.value??{}))if(Object.is(value,-0))expect(Object.is(actual.value[key],-0)).toBe(true);
};
let seed=0x51a7e;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
function coordinates(count,kind){
 const values=Array.from({length:count*6+(kind==='ragged'?3:0)},()=>random()*1.4-.2);
 if(kind==='strings')values[Math.floor(random()*values.length)]=String(values[0]);
 if(kind==='holes')values[Math.floor(random()*values.length)]=NaN;
 if(kind==='f32')return Float32Array.from(values);
 if(kind==='f64')return Float64Array.from(values);
 if(kind==='i16')return Int16Array.from(values.map(value=>value*3));
 return values;
}
const names=['rustPDFImageRects','rustPDFImagePaths','pdfImageRects','pdfImagePaths'];
it('answers like the frozen bridge for every coordinate kind and page size',()=>{
 for(const kind of ['plain','strings','holes','f32','f64','i16','ragged'])for(const count of [0,1,3,17,120])
  for(const [width,height] of [[1024,2048],[1,1],[0,10],[10,-1],[NaN,5],['640',800],[Infinity,3],[612.5,792.25]]){
   const input=coordinates(count,kind);for(const name of names)same(name,input,width,height);
  }
});
it('splits more pictures than one kernel call accepts exactly like the frozen bridge',()=>{
 for(const kind of ['f64','plain'])same('pdfImagePaths',coordinates(32768*2+5,kind),900,1200);
 same('rustPDFImagePaths',coordinates(32769,'f64'),900,1200);
});
it('refuses, reports and releases like the frozen bridge when the core is absent, failing or replaced',()=>{
 const input=coordinates(12,'plain');
 for(const replacement of [null,{},{...core,pdf_image_rects:undefined,pdf_image_paths:undefined},
  {...core,alloc_f64:()=>0},{...core,alloc_f64:()=>{throw new Error('no memory');}},
  {...core,pdf_image_rects:()=>-1,pdf_image_paths:()=>13},{...core,pdf_image_rects:()=>1.5,pdf_image_paths:()=>'2'},
  {...core,pdf_image_rects:()=>{throw new WebAssembly.RuntimeError('trap');},pdf_image_paths:()=>{throw new WebAssembly.RuntimeError('trap');}}]){
  state.core=replacement;for(const name of names)same(name,input,800,600);
 }
 let frees=0;state.core={...core,free_f64:(...args)=>{frees++;core.free_f64(...args);},pdf_image_rects:()=>{throw new Error('x');}};
 bridge.rustPDFImageRects(input,800,600);const native=frees;frees=0;frozen.rustPDFImageRects(input,800,600);expect(native).toBe(frees);
});
