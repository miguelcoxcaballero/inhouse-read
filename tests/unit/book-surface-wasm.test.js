// @vitest-environment node
// The rasters every book shares (cloth and paper normals, the ribbon's cut, the weave's two tiles) are made
// inside the shelf module (rust-ui/src/book_tiles.rs, over rust-core/src/book_surface.rs compiled into it).
// Compared byte for byte with the JavaScript originals (helpers/reference-book-surfaces.js, reference-book-weave.js)
// and with the frozen bridges that drove the numeric core's copy of the kernels (reference-book-surface-wasm.js).
import {readFileSync} from 'node:fs';
import {beforeAll,describe,it,expect} from 'vitest';
import {rustShelf} from './helpers/rust-shelf-ready.js';
import {rustBookSurfacePixels,rustRibbonNotchPixels,rustBookWeavePixels} from './helpers/reference-book-surface-wasm.js';
import {clothNormals,paperNormals,ribbonNotch} from './helpers/reference-book-surfaces.js';
import {bookWeave} from './helpers/reference-book-weave.js';
let core;
beforeAll(async()=>{core=(await WebAssembly.instantiate(readFileSync('src/wasm/inhouse_read_core.wasm'))).instance.exports;});
const same=(a,b)=>{expect(a).toBeInstanceOf(Uint8Array);expect(a.length).toBe(b.length);expect(Buffer.compare(Buffer.from(a),Buffer.from(b))).toBe(0);};
const memory=()=>rustShelf.book_mesh_memory().buffer;
describe('book surface rasters of the shelf module',()=>{
  it.each([['cloth',clothNormals],['paper',paperNormals]])('preserves all %s normal bytes', (kind,reference)=>{
    const result=rustShelf.book_tile_normal_bytes(kind);same(result,reference());same(result,rustBookSurfacePixels(core,kind));
    expect(result.buffer).not.toBe(memory());expect(result.byteLength).toBe(result.buffer.byteLength);
  });
  it('preserves the complete ribbon cut',()=>{
    const result=rustShelf.book_ribbon_notch_bytes(16,64);same(result,ribbonNotch());same(result,rustRibbonNotchPixels(core));
    expect(result.buffer).not.toBe(memory());
  });
  it.each([[1,1],[3,7],[16,64],[511,512],[512,512]])('preserves mask boundaries at %ix%i',(w,h)=>{
    const expected=new Uint8Array(w*h*4);
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      const across=Math.abs((x+.5)/w*2-1),i=(y*w+x)*4;
      expected.fill((y+.5)/h>.2*(1-across)?255:0,i,i+4);
    }
    same(rustShelf.book_ribbon_notch_bytes(w,h),expected);same(rustRibbonNotchPixels(core,w,h),expected);
  });
  it.each(['wood','','Cloth','cloth '])('rejects unknown surface %s',kind=>{
    expect(rustShelf.book_tile_normal_bytes(kind)).toBeUndefined();expect(rustBookSurfacePixels(core,kind)).toBeNull();
  });
  it.each([0,-1,.5,513,NaN,Infinity,-Infinity,16.000001])('rejects invalid mask dimensions %s',n=>{
    expect(rustShelf.book_ribbon_notch_bytes(n,64)).toBeUndefined();expect(rustShelf.book_ribbon_notch_bytes(16,n)).toBeUndefined();
    expect(rustRibbonNotchPixels(core,n,64)).toBeNull();expect(rustRibbonNotchPixels(core,16,n)).toBeNull();
  });
  it('survives memory growth and keeps earlier pixels independent',()=>{
    const first=rustShelf.book_tile_normal_bytes('cloth'),expected=clothNormals();
    rustShelf.book_mesh_memory().grow(1);
    for(let i=0;i<12;i++)same(rustShelf.book_tile_normal_bytes('paper'),paperNormals());
    same(first,expected);same(rustShelf.book_tile_normal_bytes('cloth'),expected);
  });
});

describe('spine weave of the shelf module',()=>{
  it('matches every color and packed material byte, with independent ownership',()=>{
    const actual=rustShelf.book_weave_bytes(),expected=bookWeave(),bridged=rustBookWeavePixels(core);
    expect(actual.length).toBe(131072);expect(actual.buffer).not.toBe(memory());
    same(actual.subarray(0,65536),expected.color);same(actual.subarray(65536),expected.channels);
    same(actual.subarray(0,65536),bridged.color);same(actual.subarray(65536),bridged.channels);
  });
  it('survives memory growth and repetition without changing previous pixels',()=>{
    const first=rustShelf.book_weave_bytes(),expected=bookWeave();
    rustShelf.book_mesh_memory().grow(1);
    for(let i=0;i<8;i++){const again=rustShelf.book_weave_bytes();same(again.subarray(0,65536),expected.color);same(again.subarray(65536),expected.channels);}
    same(first.subarray(0,65536),expected.color);same(first.subarray(65536),expected.channels);
  });
});

// The frozen bridges still guard the numeric core's own copy of the kernels, which the frozen book model and
// spine (helpers/reference-book-model.js, reference-spine-surface.js) keep using.
describe('frozen bridges to the numeric core',()=>{
  it.each([null,{}, {memory:{}}])('decline unavailable kernels',engine=>{
    expect(rustBookSurfacePixels(engine,'cloth')).toBeNull();expect(rustRibbonNotchPixels(engine)).toBeNull();expect(rustBookWeavePixels(engine)).toBeNull();
  });
  it('balance every allocation across memory growth',()=>{
    let live=0,allocations=0,releases=0;const engine={...core,
      alloc_f64(n){const p=core.alloc_f64(n);if(p){live+=n;allocations++;}return p;},
      free_f64(p,n){live-=n;releases++;core.free_f64(p,n);},
      book_surface_pixels(...args){core.memory.grow(1);return core.book_surface_pixels(...args);}};
    const a=rustBookSurfacePixels(engine,'cloth');same(a,clothNormals());
    for(let i=0;i<4;i++)same(rustBookSurfacePixels(engine,'paper'),paperNormals());
    for(const [name,pixels] of Object.entries(rustBookWeavePixels(engine)))same(pixels,bookWeave()[name]);
    same(a,clothNormals());expect(live).toBe(0);expect(allocations).toBe(releases);
  });
});
