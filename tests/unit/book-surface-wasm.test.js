// @vitest-environment node
import {readFileSync} from 'node:fs';
import {beforeAll,describe,it,expect,vi} from 'vitest';
import {rustBookSurfacePixels,rustRibbonNotchPixels,rustBookWeavePixels} from '../../src/js/book-surface-wasm.js';
import {clothNormals,paperNormals,ribbonNotch} from './helpers/reference-book-surfaces.js';
import {bookWeave} from './helpers/reference-book-weave.js';
let core;
beforeAll(async()=>{core=(await WebAssembly.instantiate(readFileSync('src/wasm/inhouse_read_core.wasm'))).instance.exports;});
const same=(a,b)=>{expect(a).toBeInstanceOf(Uint8Array);expect(Buffer.compare(Buffer.from(a),Buffer.from(b))).toBe(0);};
describe('real compiled book surface rasters',()=>{
  it.each([['cloth',clothNormals],['paper',paperNormals]])('preserves all %s normal bytes', (kind,reference)=>{
    const result=rustBookSurfacePixels(core,kind);same(result,reference());expect(result.buffer).not.toBe(core.memory.buffer);
  });
  it('preserves the complete ribbon cut',()=>same(rustRibbonNotchPixels(core),ribbonNotch()));
  it.each([[1,1],[3,7],[16,64],[511,512]])('preserves mask boundaries at %ix%i',(w,h)=>{
    const expected=new Uint8Array(w*h*4);
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      const across=Math.abs((x+.5)/w*2-1),i=(y*w+x)*4;
      expected.fill((y+.5)/h>.2*(1-across)?255:0,i,i+4);
    }
    same(rustRibbonNotchPixels(core,w,h),expected);
  });
  it.each([null,{}, {memory:{}}])('declines unavailable kernels without allocating',engine=>{
    expect(rustBookSurfacePixels(engine,'cloth')).toBeNull();expect(rustRibbonNotchPixels(engine)).toBeNull();
  });
  it.each(['wood','',null,0])('rejects unknown surface %s',kind=>{
    const alloc=vi.fn(core.alloc_f64);expect(rustBookSurfacePixels({...core,alloc_f64:alloc},kind)).toBeNull();expect(alloc).not.toHaveBeenCalled();
  });
  it.each([0,-1,.5,513,NaN,Infinity,'16',null])('rejects invalid mask dimensions %s',n=>{
    const alloc=vi.fn(core.alloc_f64),engine={...core,alloc_f64:alloc};
    expect(rustRibbonNotchPixels(engine,n,64)).toBeNull();expect(rustRibbonNotchPixels(engine,16,n)).toBeNull();expect(alloc).not.toHaveBeenCalled();
  });
  it.each(['surface','ribbon'])('releases the arena on %s failure',kind=>{
    const free=vi.fn(core.free_f64),engine={...core,free_f64:free};
    const name=kind==='surface'?'book_surface_pixels':'book_ribbon_notch';
    engine[name]=()=>{throw new Error('synthetic kernel failure')};
    expect(kind==='surface'?rustBookSurfacePixels(engine,'paper'):rustRibbonNotchPixels(engine)).toBeNull();expect(free).toHaveBeenCalledTimes(1);
  });
  it('survives memory growth, retains independent pixels and balances every allocation',()=>{
    let live=0,allocations=0,releases=0;const engine={...core,
      alloc_f64(n){const p=core.alloc_f64(n);if(p){live+=n;allocations++;}return p;},
      free_f64(p,n){live-=n;releases++;core.free_f64(p,n);},
      book_surface_pixels(...args){core.memory.grow(1);return core.book_surface_pixels(...args);}};
    const a=rustBookSurfacePixels(engine,'cloth');same(a,clothNormals());
    for(let i=0;i<12;i++)same(rustBookSurfacePixels(engine,'paper'),paperNormals());
    same(a,clothNormals());expect(live).toBe(0);expect(allocations).toBe(releases);
  });
  it.each([()=>0,()=>{throw new Error('synthetic allocation failure')}])('does not free a failed allocation',alloc=>{
    const free=vi.fn(),engine={...core,alloc_f64:alloc,free_f64:free};
    expect(rustBookSurfacePixels(engine,'cloth')).toBeNull();expect(rustRibbonNotchPixels(engine)).toBeNull();expect(free).not.toHaveBeenCalled();
  });
});

describe('real compiled spine weave',()=>{
  it('matches every color and packed material byte, with independent ownership',()=>{
    const actual=rustBookWeavePixels(core),expected=bookWeave();
    for(const name of ['color','channels']){same(actual[name],expected[name]);expect(actual[name].buffer).not.toBe(core.memory.buffer);}
    expect(actual.color.buffer).toBe(actual.channels.buffer);
  });
  it.each([null,{}, {memory:{}}])('declines unavailable cores',engine=>expect(rustBookWeavePixels(engine)).toBeNull());
  it.each([()=>0,()=>{throw new Error('synthetic allocation failure')}])('does not free failed allocations',alloc=>{
    const free=vi.fn(),engine={...core,alloc_f64:alloc,free_f64:free};
    expect(rustBookWeavePixels(engine)).toBeNull();expect(free).not.toHaveBeenCalled();
  });
  it.each([()=>0,()=>{throw new Error('synthetic kernel failure')}])('frees the arena when the kernel rejects',kernel=>{
    const free=vi.fn(core.free_f64),engine={...core,book_weave_pixels:kernel,free_f64:free};
    expect(rustBookWeavePixels(engine)).toBeNull();expect(free).toHaveBeenCalledTimes(1);
    expect(free.mock.calls[0][1]*8).toBe(147584); // 4 sines, their 4 requests, the field and both tiles
  });
  it('survives memory growth and reuse without leaking or changing previous pixels',()=>{
    let live=0,peak=0,allocations=0,releases=0;const engine={...core,
      alloc_f64(n){const p=core.alloc_f64(n);if(p){live+=n*8;peak=Math.max(peak,live);allocations++;}return p;},
      free_f64(p,n){live-=n*8;releases++;core.free_f64(p,n);},
      book_weave_pixels(...args){core.memory.grow(1);return core.book_weave_pixels(...args);}};
    const first=rustBookWeavePixels(engine),expected=bookWeave();
    for(let i=0;i<16;i++)for(const [name,pixels] of Object.entries(rustBookWeavePixels(engine)))same(pixels,expected[name]);
    for(const name of ['color','channels'])same(first[name],expected[name]);
    expect(live).toBe(0);expect(peak).toBe(147584);expect(allocations).toBe(releases);
  });
});
