// @vitest-environment node
import {readFileSync} from 'node:fs';
import {beforeAll,afterEach,it,expect,vi} from 'vitest';
const state=vi.hoisted(()=>({core:null}));
vi.mock('../../src/js/rust-core.js',()=>({getRustCore:()=>state.core}));
import {sniffBytes,detectFormat} from '../../src/js/format-detect.js';
import {sniffBytes as original,detectFormat as originalDetect} from './helpers/reference-format-detect.js';
import {rustBookFormat} from '../../src/js/book-format-wasm.js';
let core;
beforeAll(async()=>{
 core=(await WebAssembly.instantiate(readFileSync('src/wasm/inhouse_read_core.wasm'))).instance.exports;
 expect(typeof core.sniff_book_format).toBe('function');state.core=core;
});
afterEach(()=>{state.core=core});
const ascii=s=>Uint8Array.from(s,c=>c.charCodeAt(0));
const pdb=type=>{const bytes=new Uint8Array(68);bytes.set(ascii(type),60);return bytes;};
const fixtures=[new Uint8Array(),ascii('%PDF-1.7'),Uint8Array.of(80,75,3,4),pdb('BOOKMOBI'),pdb('TEXtREAd'),
 ascii('<?xml version="1.0"?><FictionBook/>'),ascii('<FiCtIoNbOoK><?XmL'),ascii('not a book'),new Uint8Array(5000)];
it('matches every original result for signatures, offsets, partial headers and binary data',()=>{
 for(const bytes of fixtures){
  expect(sniffBytes(bytes)).toEqual(original(bytes));
  expect(sniffBytes(bytes.buffer)).toEqual(original(bytes.buffer));
  for(let n=0;n<Math.min(bytes.length,201);n++)expect(sniffBytes(bytes.subarray(0,n))).toEqual(original(bytes.subarray(0,n)));
  const offset=new Uint8Array(bytes.length+33);offset.set(bytes,17);
  expect(sniffBytes(offset.subarray(17,17+bytes.length))).toEqual(original(bytes));
 }
 let seed=6749;const next=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed;};
 for(let n=0;n<4000;n++){
  const bytes=Uint8Array.from({length:next()%250},()=>next()%256);
  if(n%3===0&&bytes.length>40){bytes.set(ascii('<?xml'),next()%12);bytes.set(ascii('FictionBook'),15+next()%10);}
  expect(sniffBytes(bytes)).toEqual(original(bytes));
 }
});
it('keeps prefix fast paths allocation-free and uses compiled Rust for PalmDOC/FB2/unknown',()=>{
 const call=vi.fn(core.sniff_book_format),alloc=vi.fn(core.alloc_f64);state.core={...core,sniff_book_format:call,alloc_f64:alloc};
 sniffBytes(ascii('%PDF-'));sniffBytes(Uint8Array.of(80,75,3,4));expect(call).not.toHaveBeenCalled();expect(alloc).not.toHaveBeenCalled();
 for(const data of [pdb('BOOKMOBI'),ascii('<?xml <FictionBook>'),ascii('unknown')])expect(sniffBytes(data)).toEqual(original(data));
 expect(call).toHaveBeenCalledTimes(3);expect(alloc).toHaveBeenCalledTimes(3);
});
it('retains extension precedence, misleading names and bounded Blob reads',async()=>{
 for(const name of ['PDF.epub','epub.CBZ','wrong.pdf','book.azw3','title.KF8','book.fb2',' unknown ','.mobi','noextension','name.pdf\n'])
 for(const bytes of fixtures){
  const file=Object.assign(new Blob([bytes]),{name});
  const read=vi.spyOn(file,'arrayBuffer');
  expect(await detectFormat(file)).toEqual(await originalDetect(file));
  expect(read).not.toHaveBeenCalled();
 }
});
it('scans only 200 bytes and frees a bounded arena before the next import',()=>{
 const alloc=vi.fn(core.alloc_f64),free=vi.fn(core.free_f64);state.core={...core,alloc_f64:alloc,free_f64:free};
 const bytes=new Uint8Array(1000000);bytes.set(ascii('<?xml <FictionBook>'),250);
 expect(rustBookFormat(bytes)).toBe(0);expect(alloc).toHaveBeenLastCalledWith(25);expect(free).toHaveBeenCalledOnce();
 const capacity=core.memory.buffer.byteLength;
 for(let i=0;i<200;i++)rustBookFormat(bytes);
 expect(core.memory.buffer.byteLength).toBe(capacity);expect(free).toHaveBeenCalledTimes(201);
});
it('falls back on cold/old/invalid cores and retains original argument handling',()=>{
 for(const value of [null,{}, {...core,sniff_book_format:()=>99}, {...core,alloc_f64:()=>0}, {...core,sniff_book_format:()=>{throw Error('rejected')}}]){
  state.core=value;for(const bytes of fixtures)expect(sniffBytes(bytes)).toEqual(original(bytes));
 }
 state.core=core;
 for(const value of [null,undefined,200,[],[70,71],new Uint16Array([400,13,8])])expect(sniffBytes(value)).toEqual(original(value));
 expect(()=>sniffBytes(-1)).toThrow(RangeError);expect(core.sniff_book_format(0,5)).toBe(0);
});
