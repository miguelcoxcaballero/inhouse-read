import {beforeAll,beforeEach,it,expect,vi} from 'vitest'
import {readFileSync} from 'node:fs'
import * as THREE from 'three'
import {rustStudioHalfScan,legacyStudioHalfScan} from '../../src/js/studio-scan-wasm.js'
const runtime=vi.hoisted(()=>({core:null}))
vi.mock('../../src/js/studio-scan-state.js',()=>({getStudioScanCore:()=>runtime.core}))
let core
beforeAll(async()=>{core=(await WebAssembly.instantiate(readFileSync('src/wasm/inhouse_read_core.wasm'))).instance.exports})
beforeEach(()=>{runtime.core=core})
it('classifies all 65536 original half encodings including signed zero',()=>{
 const n=16384,p=core.alloc_f64(n),view=new Uint16Array(core.memory.buffer,p,65536)
 try{for(let value=0;value<65536;value++){view[0]=value;expect(core.studio_half_scan(p,1)).toBe((value&0x7c00)===0x7c00?0:value===0?1:2)}}finally{core.free_f64(p,n)}
})
it('checks every half encoding in every lane of the packed four-word path',()=>{
 const n=32,p=core.alloc_f64(n),view=new Uint16Array(core.memory.buffer,p,4);let cases=0
 try{for(let lane=0;lane<4;lane++)for(let value=0;value<65536;value++){view.fill(0x3c00);view[lane]=value;const result=core.studio_half_scan(p,4),expected=(value&0x7c00)===0x7c00?0:2;if(result!==expected)throw Error(`Lane ${lane}, half ${value}: ${result} instead of ${expected}`);cases++}expect(cases).toBe(262144)}finally{core.free_f64(p,n)}
})
it('keeps unaligned four-word reads and every partial tail exact',()=>{
 const n=32,p=core.alloc_f64(n)
 try{for(const offset of [0,2,4,6])for(let length=1;length<=9;length++){const view=new Uint16Array(core.memory.buffer,p+offset,length);for(let i=0;i<length;i++)view[i]=[0,0x3c00,1,0x7bff,0x8000][i%5];expect(core.studio_half_scan(p+offset,length)).toBe(legacyStudioHalfScan(view)?2:1);view[length-1]=0x7c01;expect(core.studio_half_scan(p+offset,length)).toBe(0)}}finally{core.free_f64(p,n)}
})
it('matches complete packets and chunk edges without modifying any source word',()=>{
 for(const n of [65536,65537,131072,3145728]){
  for(const value of [0,1,0x3c00,0x7bff,0x8000,0xfc00,0x7fff]){const data=new Uint16Array(n);data.fill(value);expect(rustStudioHalfScan(core,data)).toBe(legacyStudioHalfScan(data));expect(data.every(v=>v===value)).toBe(true)}
  for(const offset of [0,65535,65536,n-1])if(offset<n){const data=new Uint16Array(n);data.fill(0x3c00);data[offset]=0x7c01;expect(rustStudioHalfScan(core,data)).toBe(false);expect(data[offset]).toBe(0x7c01)}
 }
})
it('keeps source offsets and partial final chunks',()=>{
 const buffer=new ArrayBuffer(65538*2),data=new Uint16Array(buffer,2,65537);data.fill(0x3555)
 expect(rustStudioHalfScan(core,data)).toBe(true);expect(new Uint16Array(buffer)[0]).toBe(0)
 data[65536]=0xfc00;expect(rustStudioHalfScan(core,data)).toBe(false)
})
it('retains short, unsupported, subclassed and shared inputs on their original path',()=>{
 expect(rustStudioHalfScan({},new Uint16Array(65536))).toBeNull();expect(rustStudioHalfScan(core,new Uint16Array(10))).toBeNull()
 expect(rustStudioHalfScan(core,new(class extends Uint16Array{})(65536))).toBeNull()
 expect(rustStudioHalfScan(core,new Uint16Array(new SharedArrayBuffer(131072)))).toBeNull()
})
it('frees one bounded scratch allocation on success, invalid data, throws and bad protocol results',()=>{
 const data=new Uint16Array(131073);data.fill(0x3c00)
 for(const mode of ['valid','invalid','throw','protocol']){
  const allocated=vi.fn(n=>core.alloc_f64(n)),freed=vi.fn((...a)=>core.free_f64(...a)),scan=vi.fn((...a)=>mode==='valid'?core.studio_half_scan(...a):mode==='invalid'?0:mode==='protocol'?99:(()=>{throw Error('lost')})())
  const result=rustStudioHalfScan({...core,alloc_f64:allocated,free_f64:freed,studio_half_scan:scan},data)
  expect(result).toBe(mode==='valid'?true:mode==='invalid'?false:null);expect(allocated).toHaveBeenCalledExactlyOnceWith(16384);expect(freed).toHaveBeenCalledExactlyOnceWith(allocated.mock.results[0].value,16384)
 }
})
it('keeps allocation failure on the original path without freeing an absent pointer',()=>{
 for(const alloc_f64 of [()=>0,()=>{throw Error('full')}]){const free_f64=vi.fn();expect(rustStudioHalfScan({...core,alloc_f64,free_f64},new Uint16Array(65536))).toBeNull();expect(free_f64).not.toHaveBeenCalled()}
})
it('bounds retained memory over two hundred full studio-sized scans',()=>{
 const data=new Uint16Array(3145728);data.fill(0x3c00);expect(rustStudioHalfScan(core,data)).toBe(true);const capacity=core.memory.buffer.byteLength
 for(let i=0;i<200;i++){expect(rustStudioHalfScan(core,data)).toBe(true);expect(core.memory.buffer.byteLength).toBe(capacity)}
})
it.each(['valid','empty','infinity','nan'])('the cache receives the original GPU read result and sampler settings after a native %s scan',async mode=>{
 vi.resetModules();const scan=vi.fn((...args)=>core.studio_half_scan(...args));runtime.core={...core,studio_half_scan:scan}
 const cache=await import('../../src/js/studio-environment-cache.js'),target=new THREE.WebGLRenderTarget(129,128,{type:THREE.HalfFloatType,format:THREE.RGBAFormat})
 target.texture.mapping=THREE.CubeUVReflectionMapping;let data
 cache.prepareStudioEnvironmentCache({readRenderTargetPixelsAsync:async(_t,_x,_y,_w,_h,value)=>{data=value;data.fill(mode==='empty'?0:0x3c00);if(mode==='infinity')data[data.length-1]=0xfc00;if(mode==='nan')data[data.length-1]=0x7c01;return data}},target)
 for(let i=0;i<5;i++)await Promise.resolve()
 expect(scan).toHaveBeenCalledTimes(2);const texture=cache.cachedStudioEnvironment()
 if(mode==='valid'){expect(texture.image.data).toBe(data);expect(texture.image.width).toBe(129);expect(texture.image.height).toBe(128);for(const key of ['mapping','minFilter','magFilter','generateMipmaps','colorSpace','flipY','wrapS','wrapT'])expect(texture[key]).toBe(target.texture[key]);expect(data.every(value=>value===0x3c00)).toBe(true);texture.dispose()}
 else expect(texture).toBeNull()
 target.dispose()
})
