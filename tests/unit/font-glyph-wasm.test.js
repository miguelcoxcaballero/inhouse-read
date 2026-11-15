// @vitest-environment node
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {beforeAll,expect,it,vi,afterEach} from 'vitest';
import {rustGlyphMask} from '../../src/js/font-glyph-wasm.js';
import {glyphMask as reference} from './helpers/reference-cover-appearance.js';
const state=vi.hoisted(()=>({core:null}));
vi.mock('../../src/js/rust-core.js',()=>({getRustCore:()=>state.core,loadRustCore:async()=>state.core,requireRustCore:async()=>state.core,loadedRustCore:()=>{if(!state.core)throw Error("Core unavailable");return state.core;}}));
let core;
beforeAll(async()=>{core=(await WebAssembly.instantiate(readFileSync('src/wasm/inhouse_read_core.wasm'))).instance.exports;expect(typeof core.font_glyph_mask).toBe('function');});
afterEach(()=>vi.unstubAllGlobals());
const raster=(w,h,seed=1)=>{let s=seed;const a=new Uint8ClampedArray(w*h*4);for(let y=0;y<h;y++)for(let x=0;x<w;x++){s=(Math.imul(s,1664525)+1013904223)>>>0;const at=(y*w+x)*4;a[at]=s>>>24;a[at+1]=19;a[at+2]=250;a[at+3]=x>1&&y>1&&x<w-2&&y<h-2?[0,99,100,101,255][s%5]:0;}return a;};
for(const [w,h] of [[1,1],[2,19],[19,2],[7,7],[30,22],[80,66],[192,176],[384,352],[1024,1024]])it(`matches every alpha, ordered point, area and crop at ${w}x${h}`,()=>{
 const a=raster(w,h,19),copy=a.slice();for(const stride of [w,3,65535])assert.deepEqual(rustGlyphMask(core,a,w,h,stride),reference(a,w,h,stride));assert.deepEqual(a,copy);
});
it('matches thin-sampling boundaries, tiny perimeters and all alpha thresholds',()=>{
 for(let n=0;n<50;n++){const w=20+n,h=30+n%13,a=raster(w,h,n+1);assert.deepEqual(rustGlyphMask(core,a,w,h,120),reference(a,w,h,120));}
 for(const alpha of [0,99,100,101,255]){const a=new Uint8ClampedArray(50*40*4).fill(alpha);assert.deepEqual(rustGlyphMask(core,a,50,40),reference(a,50,40));}
});
it('preserves ownership after scratch is freed and memory grows',()=>{
 const a=raster(192,176),free=vi.fn(core.free_f64),output=rustGlyphMask({...core,free_f64:free},a,192,176);assert.deepEqual(output,reference(a,192,176));expect(free).toHaveBeenCalledOnce();core.memory.grow(1);rustGlyphMask(core,raster(512,512),512,512);assert.deepEqual(output,reference(a,192,176));
});
it('frees rejected or trapped work and distinguishes valid null from unavailable',()=>{
 const a=raster(80,66);for(const run of [()=>0,()=>{throw Error('trap')}]){const free=vi.fn(core.free_f64);expect(rustGlyphMask({...core,font_glyph_mask:run,free_f64:free},a,80,66)).toBeUndefined();expect(free).toHaveBeenCalledOnce();}
 expect(rustGlyphMask({...core,alloc_f64:()=>0},a,80,66)).toBeUndefined();expect(rustGlyphMask(null,a,80,66)).toBeUndefined();expect(rustGlyphMask(core,new Uint8ClampedArray(80*66*4),80,66)).toBeNull();
});
it('rejects malformed dimensions without allocating or touching input',()=>{
 const alloc=vi.fn(core.alloc_f64),engine={...core,alloc_f64:alloc},a=raster(80,66);
 for(const [w,h,stride] of [[0,66,80],[80,0,80],[-1,66,80],[Infinity,66,80],[80.2,66,80],[80,66,0],[80,66,65536],[2048,2048,2048],[81,66,80]])expect(rustGlyphMask(engine,a,w,h,stride)).toBeUndefined();expect(alloc).not.toHaveBeenCalled();
});

it('routes the real analyzer through Rust and reports unavailable core instead of running a JavaScript twin',async()=>{
 const call=vi.fn(core.font_glyph_mask);state.core={...core,font_glyph_mask:call};
 vi.stubGlobal('Image',class{decode(){return Promise.reject(Error('bad image'));}});vi.stubGlobal('document',{});
 const {analyzeCoverAppearance,glyphMask}=await import('../../src/js/cover-appearance.js');
 await analyzeCoverAppearance('invalid-test-image');const raw=raster(192,176);
 await vi.waitFor(()=>{assert.deepEqual(glyphMask(raw,192,176),reference(raw,192,176));expect(call).toHaveBeenCalled();});
 state.core=null;expect(()=>glyphMask(raw,192,176)).toThrow("Core unavailable");
});
