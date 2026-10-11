// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll,beforeEach,describe,expect,it,vi } from 'vitest';
import { createShelfPlacementPreview,SHELF_PREVIEW_MIN_OBJECTS,SHELF_PREVIEW_DIRECT_MOVES } from '../../src/js/shelf-placement-preview.js';
import { moveShelfDecoration } from './helpers/reference-shelf-decoration-layout.js';
import { generatePlacement } from '../helpers/shelf-placement-cases.mjs';
const observed=vi.hoisted(()=>({prepared:0,disposed:0}));
vi.mock('../../src/js/shelf-placement-wasm.js',async original=>{
  const actual=await original();return{...actual,createShelfPlacementSession(...args){
    observed.prepared++;const session=actual.createShelfPlacementSession(...args);
    return session&&{move:(...values)=>session.move(...values),dispose(){observed.disposed++;session.dispose();}};
  }};
});
let core;
beforeAll(async()=>{core=(await WebAssembly.instantiate(readFileSync(resolve('src/wasm/inhouse_read_core.wasm')))).instance.exports;expect(typeof core.shelf_place).toBe('function');});
beforeEach(()=>{observed.prepared=observed.disposed=0;});
describe('shared production drag policy with actual compiled placement',()=>{
  it('keeps the measured eligibility constants explicit',()=>{expect(SHELF_PREVIEW_MIN_OBJECTS).toBe(16);expect(SHELF_PREVIEW_DIRECT_MOVES).toBe(2);});
  for(const count of [10,16,40])for(const moves of [1,2,8])it(`preserves ${count} objects through ${moves} previews with exact bypass routing`,()=>{
    const input=generatePlacement(31,count),preview=createShelfPlacementPreview(input.objects,input.options);let calls=0,live=0;
    const tracked={...core,alloc_f64(n){const p=core.alloc_f64(n);if(p)live+=n*8;return p;},
      free_f64(p,n){core.free_f64(p,n);live-=n*8;},shelf_place(...args){calls++;return core.shelf_place(...args);}};
    for(let index=0;index<moves;index++){
      const target={shelf:index%4,x:((index*17)%101)/100};
      expect(preview.move(tracked,input.movedKey,target.shelf,target.x)).toEqual(moveShelfDecoration(input.objects,input.movedKey,target,input.options));
      if(index<2)expect(observed.prepared).toBe(0);expect(live).toBe(0);
    }
    const expected=count>=16?Math.max(0,moves-2):0;
    expect(calls).toBe(expected);expect(observed.prepared).toBe(expected?1:0);
    preview.dispose();expect(observed.disposed).toBe(expected?1:0);
    expect(preview.move(tracked,input.movedKey,1,.3)).toBeUndefined();expect(live).toBe(0);
  });
  it('never prepares a session for a core that is still unavailable',()=>{
    const input=generatePlacement(11,40),preview=createShelfPlacementPreview(input.objects,input.options);
    for(let index=0;index<8;index++)expect(preview.move(null,input.movedKey,1,.4)).toEqual(moveShelfDecoration(input.objects,input.movedKey,{shelf:1,x:.4},input.options));
    expect(observed.prepared).toBe(0);preview.dispose();expect(observed.disposed).toBe(0);
  });
  it('retains accessor semantics when preparation is declined after the two direct moves',()=>{
    const input=generatePlacement(19,20);let reads=0;
    Object.defineProperty(input.objects[0],'extra',{enumerable:true,get(){reads++;return 'kept';}});
    const preview=createShelfPlacementPreview(input.objects,input.options);
    for(let index=0;index<8;index++)preview.move(core,input.movedKey,1,.4);
    expect(reads).toBe(8);expect(observed.prepared).toBe(1);preview.dispose();expect(observed.disposed).toBe(0);
  });
});
