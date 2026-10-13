// @vitest-environment node
import {readFileSync} from 'node:fs';
import {beforeAll,afterEach,it,expect,vi} from 'vitest';
const state=vi.hoisted(()=>({core:null}));
vi.mock('../../src/js/rust-core.js',()=>({getRustCore:()=>state.core}));
import {rustSpineNumbers} from '../../src/js/spine-seed-wasm.js';
import {SPINE_PALETTE,SPINE_TEXTURES,spineStyleFor,pick,unit,seedFor,hashString} from '../../src/js/bookshelf-layout.js';
let core;
beforeAll(async()=>{
 core=(await WebAssembly.instantiate(readFileSync('src/wasm/inhouse_read_core.wasm'))).instance.exports;
 expect(typeof core.spine_style_numbers).toBe('function');
});
afterEach(()=>{state.core=null});
// Frozen copy of the original JS: palette/texture/height straight from unit().
const original=seed=>({palette:SPINE_PALETTE.indexOf(pick(SPINE_PALETTE,seed,'palette')),
 texture:SPINE_TEXTURES.indexOf(pick(SPINE_TEXTURES,seed,'texture')),height:unit(seed,'height')});
const seeds=()=>{
 const list=['','a','local:libro.pdf:12345','drive:1AbC_dEf-GhI','Título|Autor','ñandú ✓','😀 emoji 😀 \ud800 lone','\u0000￿','x'.repeat(5000),'\\'];
 let s=7919;const next=()=>{s=(Math.imul(s,1664525)+1013904223)>>>0;return s;};
 for(let n=0;n<6000;n++)list.push(String.fromCharCode(...Array.from({length:next()%40},()=>next()%65536)));
 for(let n=0;n<2000;n++)list.push(`local:${next().toString(36)}.epub:${next()%9999999}`);
 return list;
};
it('returns exactly the original palette, texture and height for every seed shape',()=>{
 state.core=core;
 for(const seed of seeds()){
  const got=rustSpineNumbers(seed);
  expect(got,seed.slice(0,30)).toEqual(original(seed));
 }
});
it('produces identical spine styles with and without the compiled hash',()=>{
 const books=[{id:'a'},{id:'local:b.pdf:9',title:'B',pageCount:300},{path:'/x/y.epub'},{title:'Sin id',author:'Z'},null,{id:'😀'}];
 for(const book of books)for(const options of [{},{pageThickness:.2,bindingThickness:3}]){
  state.core=null;const reference=spineStyleFor(book,options);
  state.core=core;expect(spineStyleFor(book,options)).toEqual(reference);
 }
});
it('uses the original code when Rust is absent, incomplete, throws or answers out of range',()=>{
 expect(rustSpineNumbers('a')).toBeUndefined();
 state.core={...core,spine_style_numbers:undefined};expect(rustSpineNumbers('a')).toBeUndefined();
 state.core={...core,spine_style_numbers:()=>{throw new Error('trap')}};expect(rustSpineNumbers('a')).toBeUndefined();
 state.core={...core,spine_style_numbers:()=>0};expect(rustSpineNumbers('a')).toBeUndefined();
 state.core={...core,spine_style_numbers:(u,l,out)=>{new Float64Array(core.memory.buffer,out,3).set([12,0,.5]);return 1}};expect(rustSpineNumbers('a')).toBeUndefined();
 state.core={...core,spine_style_numbers:(u,l,out)=>{new Float64Array(core.memory.buffer,out,3).set([1,1,1]);return 1}};expect(rustSpineNumbers('a')).toBeUndefined();
 state.core=core;expect(rustSpineNumbers(undefined)).toBeUndefined();expect(rustSpineNumbers('x'.repeat(65537))).toBeUndefined();
});
it('rejects misaligned or null requests and leaks no arena memory',()=>{
 expect(core.spine_style_numbers(0,3,8)).toBe(0);
 const arena=core.alloc_f64(8);expect(core.spine_style_numbers(arena+1,2,arena)).toBe(0);expect(core.spine_style_numbers(arena,70000,arena)).toBe(0);
 expect(core.spine_style_numbers(arena,0,arena+4)).toBe(0);core.free_f64(arena,8);
 state.core=core;const before=core.memory.buffer.byteLength;
 for(let n=0;n<20000;n++)rustSpineNumbers('local:book'+n);
 expect(core.memory.buffer.byteLength).toBe(before);
 expect(hashString('abc')).toBe(hashString('abc'));
});
