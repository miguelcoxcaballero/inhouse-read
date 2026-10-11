// @vitest-environment node
import { readFileSync } from 'node:fs';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { loadRustCore } from '../../src/js/rust-core.js';
import { createShelfPlacementSession } from '../../src/js/shelf-placement-wasm.js';
import { moveShelfDecoration } from './helpers/reference-shelf-decoration-layout.js';
import { generatePlacement } from '../helpers/shelf-placement-cases.mjs';

let core, tracked, stats;
beforeAll(async()=>{
  core=await loadRustCore({bytes:readFileSync(new URL('../../src/wasm/inhouse_read_core.wasm',import.meta.url))});
  expect(typeof core?.shelf_place).toBe('function');
});
beforeEach(()=>{
  stats={calls:0,allocations:0,releases:0,live:0};
  tracked={...core,
    alloc_f64(n){const p=core.alloc_f64(n);if(p){stats.allocations++;stats.live+=n*8;}return p;},
    free_f64(p,n){core.free_f64(p,n);stats.releases++;stats.live-=n*8;},
    shelf_place(...args){stats.calls++;return core.shelf_place(...args);}};
});
afterEach(()=>{expect(stats.live).toBe(0);expect(stats.allocations).toBe(stats.releases);});
describe('actual compiled shelf placement within an owned drag snapshot',()=>{
  it('preserves complete output across repeated moves without repeated host normalization',()=>{
    for(let seed=0;seed<60;seed++){
      const input=generatePlacement(seed,(seed*11)%87,{unusual:true});
      const session=createShelfPlacementSession(input.objects,input.options);
      expect(session).not.toBeNull();
      for(let step=0;step<16;step++){
        const key=step%4===0?'missing':input.objects[(step*7)%Math.max(1,input.objects.length)]?.key;
        const target={shelf:step%6,x:((step*17)%101)/100};
        const expected=moveShelfDecoration(input.objects,key,target,input.options);
        const actual=session.move(tracked,key,target.shelf,target.x);
        expect(actual).toEqual(expected);
        for(const row of actual.shelves)expect(row.objects).toBe(row.items);
      }
      session.dispose();expect(session.move(tracked,input.movedKey,0,.5)).toBeUndefined();
    }
  });
  it('preserves numeric edge values and independent duplicate keys on each mounting surface',()=>{
    const objects=[{key:'same',kind:'lamp',mount:'undershelf',width:70,x:.6},
      {key:'same',kind:'book',width:42,x:.5},{key:'same',kind:'plant',width:20,x:.2},
      {key:'other',kind:'book',width:55,shelf:2,x:.4}];
    for(const options of [{shelfWidth:320,padding:16,gap:3,minShelves:3},
      {shelfWidth:.25,padding:0,gap:0,minShelves:0},
      {shelfWidth:Number.MAX_VALUE,padding:0,gap:Number.MAX_VALUE,minShelves:0}]){
      const session=createShelfPlacementSession(objects,options);expect(session).not.toBeNull();
      for(const shelf of [undefined,NaN,Infinity,-Infinity,-1,-0,0,9999.8])for(const x of [undefined,NaN,Infinity,-Infinity,-0,0,.5,1,2]){
        const expected=moveShelfDecoration(objects,'same',{shelf,x},options);
        expect(session.move(tracked,'same',shelf,x)).toEqual(expected);
      }
      session.dispose();
    }
  });
  it('copies the source instead of treating a previously inspected mutable object as trusted',()=>{
    const input=generatePlacement(12,10),before=structuredClone(input);
    const session=createShelfPlacementSession(input.objects,input.options);
    let reads=0;
    Object.defineProperty(input.objects[0],'width',{get(){reads++;throw new Error('changed source');},configurable:true});
    input.objects[1].x=.999;input.options.shelfWidth=120;
    expect(session.move(tracked,before.movedKey,1,.4)).toEqual(moveShelfDecoration(before.objects,before.movedKey,{shelf:1,x:.4},before.options));
    expect(reads).toBe(0);
    session.dispose();expect(createShelfPlacementSession(input.objects,input.options)).toBeNull();expect(reads).toBe(0);
    expect(session.move(tracked,before.movedKey,2,.4)).toBeUndefined();
  });
  it('rejects accessors before reading them and keeps opaque metadata references',()=>{
    const input=generatePlacement(3,3);let reads=0;
    Object.defineProperty(input.objects[0],'extra',{enumerable:true,get(){reads++;return 'value';}});
    expect(createShelfPlacementSession(input.objects,input.options)).toBeNull();expect(reads).toBe(0);expect(stats.allocations).toBe(0);
    const plain=generatePlacement(5,4),session=createShelfPlacementSession(plain.objects,plain.options);
    expect(stats.allocations).toBe(0);
    const actual=session.move(tracked,plain.movedKey,1,.4);
    for(const item of actual.objects){const source=plain.objects.find(object=>object.key===item.key);expect(item.metadata).toBe(source.metadata);expect(item.book).toBe(source.book);}
    expect(stats.live).toBe(0);session.dispose();
  });
  it('releases all buffers on reentrancy, cancellation, rejection and memory growth',()=>{
    const input=generatePlacement(4,40),session=createShelfPlacementSession(input.objects,input.options);
    const sibling=createShelfPlacementSession([{key:'other',kind:'book',width:20}],{shelfWidth:320});
    let nested,other;
    const reentrant={...tracked,shelf_place(...args){
      nested=session.move(tracked,input.movedKey,0,.3);
      other=sibling.move(tracked,'other',0,.4);
      core.memory.grow(1);return tracked.shelf_place(...args);
    }};
    expect(session.move(reentrant,input.movedKey,1,.4)).toEqual(moveShelfDecoration(input.objects,input.movedKey,{shelf:1,x:.4},input.options));
    expect(nested).toBeUndefined();expect(other).not.toBeUndefined();expect(stats.live).toBe(0);
    for(const shelf_place of [()=>0,()=>{throw new WebAssembly.RuntimeError('trap');}]){
      expect(session.move({...tracked,shelf_place},input.movedKey,1,.4)).toBeUndefined();expect(stats.live).toBe(0);
    }
    expect(session.move({...tracked,alloc_f64:()=>0},input.movedKey,1,.4)).toBeUndefined();
    const cancelled={...tracked,shelf_place(...args){session.dispose();return tracked.shelf_place(...args);}};
    expect(session.move(cancelled,input.movedKey,1,.4)).toBeUndefined();expect(stats.live).toBe(0);
    expect(session.move(tracked,input.movedKey,1,.4)).toBeUndefined();sibling.dispose();
  });
  it('re-prepares from current source and configuration after a snapshot is invalidated',()=>{
    const input=generatePlacement(14,20);let session=createShelfPlacementSession(input.objects,input.options);
    session.move(tracked,input.movedKey,1,.4);session.dispose();
    input.objects=input.objects.map((object,index)=>({...object,width:30+index,shelf:index%4}));
    input.options={...input.options,shelfWidth:600,padding:24};
    session=createShelfPlacementSession(input.objects,input.options);
    expect(session.move(tracked,input.movedKey,2,.75)).toEqual(moveShelfDecoration(input.objects,input.movedKey,{shelf:2,x:.75},input.options));
    session.dispose();
  });
});
