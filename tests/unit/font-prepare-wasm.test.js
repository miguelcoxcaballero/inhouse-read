// @vitest-environment node
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {beforeAll,expect,it,vi} from 'vitest';
import {rustPrepareCoverPixels} from '../../src/js/font-glyph-wasm.js';
import {referencePrepare} from './helpers/reference-cover-preparation.js';
let core;
beforeAll(async()=>{core=(await WebAssembly.instantiate(readFileSync('src/wasm/inhouse_read_core.wasm'))).instance.exports;expect(typeof core.font_prepare_pixels).toBe('function');});
const raw=(w,h,seed=17)=>{let s=seed;return Uint8ClampedArray.from({length:w*h*4},()=>{s=(Math.imul(s,1664525)+1013904223)>>>0;return s>>>24;});};
const bytes=a=>Buffer.from(a.buffer,a.byteOffset,a.byteLength);
function check(a,w,h,edges=true){const actual=rustPrepareCoverPixels(core,a,w,h,edges),expected=referencePrepare(a,w,h,edges);expect(actual).not.toBeNull();assert.deepEqual(actual.gray,expected.gray);assert.equal(actual.busy,expected.busy);if(edges)assert.deepEqual(bytes(actual.near),bytes(expected.near));else assert.equal(actual.near,null);return actual;}
for(const [w,h]of [[1,1],[1,12],[13,1],[2,2],[3,3],[7,9],[80,66],[192,288],[257,129],[512,512]])it(`keeps every gray/edge byte and fallback classification at ${w}x${h}`,()=>{const a=raw(w,h),copy=a.slice();check(a,w,h);check(a,w,h,false);assert.deepEqual(a,copy);});
it('rounds all 16777216 RGB triplets exactly like Math.round, independently of alpha',()=>{
 const a=new Uint8ClampedArray(256*256*4);for(let g=0;g<256;g++)for(let b=0;b<256;b++){const i=(g*256+b)*4;a[i+1]=g;a[i+2]=b;a[i+3]=(g+b)%256;}
 let capacity;for(let r=0;r<256;r++){for(let i=0;i<a.length;i+=4)a[i]=r;const result=rustPrepareCoverPixels(core,a,256,256,false);assert(result);for(let i=0;i<65536;i++){const at=i*4,value=Math.round(a[at]*.299+a[at+1]*.587+a[at+2]*.114);if(result.gray[i]!==value)throw Error(`RGB mismatch ${r}/${a[at+1]}/${a[at+2]}`);}if(r===0)capacity=core.memory.buffer.byteLength;assert.equal(core.memory.buffer.byteLength,capacity);}
},30000);
it('keeps quiet and busy classifications for flat fields, stripes and gradients',()=>{
 for(let k=0;k<30;k++){const w=83,h=119,a=raw(w,h,k);for(let i=0;i<w*h;i++){const x=i%w,y=Math.floor(i/w),v=k%3===0?k*8:k%3===1?(x%3===0?255:0):Math.min(255,x*2+y);a[i*4]=a[i*4+1]=a[i*4+2]=v;}check(a,w,h);}
});
it('owns both output planes after free, further calls and memory growth',()=>{const a=raw(192,288),free=vi.fn(core.free_f64),output=rustPrepareCoverPixels({...core,free_f64:free},a,192,288),expected=referencePrepare(a,192,288);expect(free).toHaveBeenCalledOnce();core.memory.grow(1);check(raw(257,129),257,129);assert.deepEqual(output,expected);});
it('releases scratch on reject or trap and leaves source intact',()=>{const a=raw(80,66),copy=a.slice();for(const operation of [()=>0,()=>3,()=>{throw Error('trap')}]){const free=vi.fn(core.free_f64);expect(rustPrepareCoverPixels({...core,font_prepare_pixels:operation,free_f64:free},a,80,66)).toBeNull();expect(free).toHaveBeenCalledOnce();}expect(rustPrepareCoverPixels({...core,alloc_f64:()=>0},a,80,66)).toBeNull();assert.deepEqual(a,copy);});
it('rejects malformed input without native allocation',()=>{const alloc=vi.fn(core.alloc_f64),engine={...core,alloc_f64:alloc},a=raw(80,66);for(const [w,h]of [[0,66],[-1,66],[80,0],[80.5,66],[Infinity,66],[80,67],[2048,2048]])expect(rustPrepareCoverPixels(engine,a,w,h)).toBeNull();expect(rustPrepareCoverPixels(engine,[],80,66)).toBeNull();expect(rustPrepareCoverPixels(null,a,80,66)).toBeNull();expect(alloc).not.toHaveBeenCalled();});
