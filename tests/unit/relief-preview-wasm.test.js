// @vitest-environment node
import {readFileSync} from 'node:fs';
import {beforeAll,afterEach,expect,it,vi} from 'vitest';
const state=vi.hoisted(()=>({core:null}));
vi.mock('../../src/js/rust-core.js',()=>({getRustCore:()=>state.core,loadRustCore:async()=>state.core}));
import {shadePreview} from '../../src/js/cover-relief.js';
import {shadePreview as reference} from './helpers/reference-relief-preview.js';
let core;
beforeAll(async()=>{core=(await WebAssembly.instantiate(readFileSync('src/wasm/inhouse_read_core.wasm'))).instance.exports;expect(typeof core.relief_preview_rows).toBe('function');state.core=core;});
afterEach(()=>{state.core=core;});
function drain(task){let yields=0;for(;;){const step=task.next();if(step.done)return {out:step.value,yields};yields++;}}
function exact(a,b){expect(a.yields).toBe(b.yields);expect(a.out.constructor).toBe(Uint8ClampedArray);expect(a.out.length).toBe(b.out.length);for(let i=0;i<b.out.length;i++)if(a.out[i]!==b.out[i])throw Error(`pixel byte[${i}]: ${a.out[i]} / ${b.out[i]}`);}
function fixture(w,h,mw=w,mh=h,preserve=false,seed=17){
 const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed>>>24;};
 const image={width:w,height:h,data:Uint8ClampedArray.from({length:w*h*4},random)};
 const maps={width:mw,height:mh,heightMap:Uint8Array.from({length:mw*mh},random),foil:Uint8Array.from({length:mw*mh},random),gloss:Uint8Array.from({length:mw*mh},random),mask:Uint8Array.from({length:mw*mh},()=>random()>90?255:0),preserveInk:preserve};return {image,maps};
}
for(const [w,h,mw,mh] of [[1,1,1,1],[17,7,19,11],[17,8,9,5],[19,17,23,11],[288,384,512,512],[512,512,288,384]])for(const preserve of [false,true])it(`keeps every RGBA byte and safe point ${w}x${h}/${mw}x${mh}, ink ${preserve}`,()=>{
 const {image,maps}=fixture(w,h,mw,mh,preserve),call=vi.fn(core.relief_preview_rows);state.core={...core,relief_preview_rows:call};const expected=drain(reference(image,maps)),actual=drain(shadePreview(image,maps));exact(actual,expected);expect(call).toHaveBeenCalledTimes(Math.ceil(h/8));expect(actual.yields).toBe(Math.floor(h/8));
});
for(const slope of [0,2.2,7,-1,1000])it(`preserves highlights and resampled borders at slope ${slope}`,()=>{for(let seed=0;seed<20;seed++){const {image,maps}=fixture(1+seed*3,1+seed%17,7+seed,5+seed%13,seed%2===0,seed);exact(drain(shadePreview(image,maps,{slope})),drain(reference(image,maps,{slope})));}});
it('preserves original transparent ink byte-for-byte when no pigment is selected',()=>{
 const {image,maps}=fixture(127,33,45,55,true);maps.mask.fill(0);const out=drain(shadePreview(image,maps));exact(out,{out:image.data,yields:4});
});
it('frees cancelled generators and copies results across interleaved jobs and growth',()=>{
 const free=vi.fn(core.free_f64);state.core={...core,free_f64:free};const first=fixture(127,33,45,55,true),second=fixture(45,55,129,17,false);
 const cancelled=shadePreview(first.image,first.maps);expect(cancelled.next().done).toBe(false);expect(free).not.toHaveBeenCalled();cancelled.return();expect(free).toHaveBeenCalledOnce();free.mockClear();
 const tasks=[shadePreview(first.image,first.maps),shadePreview(second.image,second.maps)],results=[null,null],counts=[0,0];
 while(results.some(v=>v===null))for(let i=0;i<2;i++)if(results[i]===null){const step=tasks[i].next();if(step.done)results[i]={out:step.value,yields:counts[i]};else{counts[i]++;core.memory.grow(1);}}
 exact(results[0],drain(reference(first.image,first.maps)));exact(results[1],drain(reference(second.image,second.maps)));expect(free).toHaveBeenCalledTimes(2);const saved=results[0].out.slice();drain(shadePreview(second.image,second.maps));exact(results[0],{out:saved,yields:counts[0]});
});
it('reports an error without leaking scratch space when the native pass is unavailable or rejected',()=>{
 // The JavaScript shading pass is gone (frozen in helpers/reference-relief-preview.js): a core that cannot
 // run is a clear error, and the scratch space of a kernel that did start is released.
 const {image,maps}=fixture(19,17,23,11,true);
 for(const engine of [null,{}, {...core,alloc_f64:()=>0},{...core,relief_preview_rows:()=>0},{...core,relief_preview_rows:()=>{throw Error('trap');}}]){
  const free=vi.fn(core.free_f64);state.core=engine?{...engine,free_f64:free}:null;expect(()=>drain(shadePreview(image,maps))).toThrow();if(engine?.relief_preview_rows&&engine.alloc_f64===core.alloc_f64)expect(free).toHaveBeenCalledOnce();
 }
});
