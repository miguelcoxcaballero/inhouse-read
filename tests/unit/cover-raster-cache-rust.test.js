import { describe, expect, it, vi } from 'vitest';
import { needRustShelf } from '../../src/js/rust-shelf.js';
import * as reference from './helpers/reference-cover-raster-cache.js';

function texture(width,height,id,log) {
  return {map:{image:{width,height},source:{version:4},dispose(){log.push(id);},clone(){this.source.version++;return{image:this.image,source:this.source};}},bounds:{id}};
}
describe('Rust cover raster retention policy',()=>{
  it('matches the original cache across repeated hits, replacements, failures, releases and budget evictions',()=>{
    const native=new (needRustShelf().RustCoverRasterCache)(), owners=Array.from({length:7},()=>({}));
    const logs=[[],[]];let seed=7;
    const random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);
    for(let step=0;step<1000;step++) {
      const owner=owners[Math.floor(random()*owners.length)],key=Math.floor(random()*4);
      if(step%7===0){native.release(owner);reference.releaseCoverRaster(owner);}
      else {
        const [width,height]=[[1024,1024],[660,1024],[1024,2048],[2048,2048],[0,10],[1.25,2]][Math.floor(random()*6)];
        const builds=[vi.fn(()=>texture(width,height,step,logs[0])),vi.fn(()=>texture(width,height,step,logs[1]))];
        const actual=native.reuse(owner,key,builds[0]),expected=reference.reuseCoverRaster(owner,key,builds[1]);
        expect(builds[0].mock.calls.length).toBe(builds[1].mock.calls.length);
        expect(actual.bounds).toEqual(expected.bounds);expect(actual.map.image).toEqual(expected.map.image);
        expect(actual.map.source.version).toBe(expected.map.source.version);
      }
      expect(logs[0]).toEqual(logs[1]);
    }
    for(const owner of owners){native.release(owner);reference.releaseCoverRaster(owner);}
    expect(logs[0]).toEqual(logs[1]);native.free();
  });
  it('releases Rust borrows before texture disposal callbacks reenter the cache',()=>{
    const native=new (needRustShelf().RustCoverRasterCache)(), first={},second={},log=[];
    const a=texture(1024,1024,'a',log),b=texture(1024,1024,'b',log);
    const dispose=a.map.dispose;
    a.map.dispose=()=>{dispose();native.release(second);};
    native.reuse(first,'a',()=>a);native.reuse(second,'b',()=>b);
    native.release(first);expect(log).toEqual(['a','b']);
    native.release(first);native.release(second);expect(log).toHaveLength(2);native.free();
  });
  it('releases retained browser handles after repeated cache ownership cycles',()=>{
    const shelf=needRustShelf(),cycle=()=>{
      const native=new shelf.RustCoverRasterCache(),owner={};
      native.reuse(owner,'image',()=>texture(32,32,1,[]));
      native.release(owner);native.free();
    };
    cycle();const baseline=shelf.shelf_live_handles();
    const native=new shelf.RustCoverRasterCache(),owner={};
    native.reuse(owner,'image',()=>texture(32,32,1,[]));
    expect(shelf.shelf_live_handles()).toBeGreaterThan(baseline);
    native.release(owner);native.free();
    for(let index=0;index<100;index++)cycle();
    expect(shelf.shelf_live_handles()).toBe(baseline);
  });
});
