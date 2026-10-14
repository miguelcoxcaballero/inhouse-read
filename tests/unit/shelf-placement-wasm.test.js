// @vitest-environment node
import { readFileSync } from 'node:fs';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ core:null }));
vi.mock('../../src/js/rust-core.js', async original => {
  const actual = await original(); return { ...actual, getRustCore:() => state.core || actual.getRustCore() };
});
import { loadRustCore } from '../../src/js/rust-core.js';
import { rustShelfPlacement } from '../../src/js/shelf-placement-wasm.js';
import * as production from '../../src/js/shelf-placement.js';
import * as productionDecoration from '../../src/js/shelf-decoration-layout.js';
import * as frozen from './helpers/reference-shelf-placement.js';
import * as frozenDecoration from './helpers/reference-shelf-decoration-layout.js';
import { generatePlacement, placementApis, placementSettings, originalPlacement } from '../helpers/shelf-placement-cases.mjs';

let core, stats;
function tracked(overrides = {}) {
  return { ...core,
    alloc_f64(n) { const pointer=core.alloc_f64(n); if(pointer){stats.live+=n*8;stats.peak=Math.max(stats.peak,stats.live);stats.allocations++;}return pointer; },
    free_f64(pointer,n) { core.free_f64(pointer,n);stats.live-=n*8;stats.releases++; },
    shelf_place(...args) { stats.calls++;return core.shelf_place(...args); }, ...overrides };
}
const settings = (input, api, target = input.target) => ({ ...placementSettings(api), movedKey:input.movedKey, target });
function compare(input, api) {
  const before = structuredClone(input);
  const expected = originalPlacement(frozen, frozenDecoration, input, api);
  const actual = rustShelfPlacement(state.core,input.objects,input.options,settings(input,api));
  expect(actual,`${api} used compiled core`).not.toBeUndefined();
  expect(actual).toEqual(expected);expect(input).toEqual(before);
  // Index the original references once. Scanning all 8192 inputs for every
  // output made this identity assertion quadratic; retain every duplicate-key
  // candidate and the same identity checks without that test-only cost.
  const sources = new Map();
  for (const value of Array.isArray(input.objects) ? input.objects : []) {
    if (!value) continue;
    const matching = sources.get(value.key) || [];
    matching.push(value); sources.set(value.key, matching);
  }
  const rows = Array.isArray(actual) ? actual : actual.shelves;
  for(const row of rows) {
    expect(row.objects).toBe(row.items);
    for(const item of row.items) {
      const matching = sources.get(item.key) || [];
      expect(matching.some(value=>value.metadata===item.metadata&&value.book===item.book)).toBe(true);
    }
  }
  if(!Array.isArray(actual)) expect(actual.objects).toEqual(rows.flatMap(row=>row.items));
  return actual;
}
beforeAll(async()=>{
  core=await loadRustCore({bytes:readFileSync(new URL('../../src/wasm/inhouse_read_core.wasm',import.meta.url))});
  expect(typeof core?.shelf_place).toBe('function');
});
beforeEach(()=>{stats={live:0,peak:0,calls:0,allocations:0,releases:0};state.core=tracked();});
afterEach(()=>{expect(stats.live).toBe(0);expect(stats.allocations).toBe(stats.releases);state.core=null;});

describe('compiled complete shelf placement, movement and mounting surfaces',()=>{
  for(const api of placementApis) it(`matches full ${api} output over stable-order seeded layouts`,()=>{
    for(let seed=0;seed<160;seed++) compare(generatePlacement(seed,(seed*17)%93,{unusual:true}),api);
    expect(stats.calls).toBeGreaterThan(0);
  });
  for(const count of [0,1,1000,8192])it(`preserves complete layout and metadata for ${count} objects`,()=>{
    const input=generatePlacement(2,count);compare(input,'decorations');compare(input,'move-decorations');
  });
  it('matches finite edge arithmetic, defaults and rejected numeric fields exactly',()=>{
    const base=generatePlacement(3,12);
    const values=[undefined,null,'390',NaN,Infinity,-Infinity,-5,-0,Number.MIN_VALUE,.25,1,31.999999999999996,32,32.00000000000001,390,Number.MAX_VALUE];
    for(const field of ['shelfWidth','padding','gap','minShelves'])for(const value of values){
      const input={...base,options:{...base.options,[field]:value}};
      compare(input,'layout');compare(input,'move-decorations');
    }
    for(const options of [
      {shelfWidth:Number.MIN_VALUE,padding:0,gap:0,minShelves:0},
      {shelfWidth:.25,padding:0,gap:0,minShelves:0},
      {shelfWidth:Number.MAX_VALUE,padding:0,gap:Number.MAX_VALUE,minShelves:0},
      {shelfWidth:1,padding:0,gap:1e-7,minShelves:0},
    ]){compare({...base,options},'layout');compare({...base,options},'move');}
  });
  it('keeps duplicates independently on floor and ceiling, last-key snapshot wins',()=>{
    const input=generatePlacement(9,0);
    input.objects=[{key:'shared',kind:'book',width:40,x:.4,metadata:{id:'floor'}},
      {key:'shared',kind:'lamp',mount:'undershelf',width:90,x:.7,metadata:{id:'ceiling'}},
      {key:'shared',kind:'plant',width:15,x:.1,metadata:{id:'filtered'}},
      {key:'other',kind:'lamp',mount:'undershelf',width:20,shelf:5,metadata:{id:'high'}}];
    input.movedKey='shared';input.target={shelf:2,x:.6};
    compare(input,'decorations');compare(input,'move-decorations');
  });
  it('keeps opaque string IDs including prototype names, whitespace and UTF-16 units',()=>{
    const input=generatePlacement(5,0);
    const ids=['__proto__','constructor','toString',' ','0','árbol','🪴','\ud800','árbol'];
    input.objects=ids.map((key,index)=>({key,kind:'book',width:20,shelf:0,x:.5,metadata:{index}}));
    input.options.placements=Object.fromEntries(ids.map((key,index)=>[key,{shelf:index%3,x:.3}]));
    input.movedKey='__proto__';input.target={shelf:1,x:.4};
    compare(input,'layout');compare(input,'move-decorations');
  });
  it('retains ties, zero gaps, pinned side reversal and requestedX without drift',()=>{
    let input=generatePlacement(31,30);
    input.options={shelfWidth:320,padding:16,gap:0,minShelves:3};
    input.objects.forEach((object,index)=>{object.width=index%2?31:52;object.x=.5;object.shelf=index%3;});
    for(let step=0;step<60;step++){
      input={...input,movedKey:input.objects[(step*11)%input.objects.length].key,target:{shelf:step%5,x:((step*17)%101)/100}};
      const moved=compare(input,'move-decorations');
      const restored={...input,options:{...input.options,placements:moved.placements}};
      compare(restored,'decorations');input={...input,objects:moved.objects};
    }
  });
  it('honours invalid, absent and boundary targets and row safeguards',()=>{
    const input=generatePlacement(8,20);
    for(const target of [undefined,null,{}, {shelf:-1,x:.2},{shelf:NaN,x:.2},{shelf:1,x:Infinity},
      {shelf:0,x:-0},{shelf:9999.7,x:3},{shelf:998.9,x:-4}])compare({...input,target},'move-decorations');
    compare({...input,movedKey:'missing'},'move');
    compare({...input,objects:[false,null,undefined,...input.objects]},'layout');
    compare({...input,objects:null},'layout');
  });
  it('runs the public APIs through the compiled core and returns the frozen original result',()=>{
    // The JavaScript packing is gone: the public layout and move APIs are the core's, one job per surface.
    const input=generatePlacement(77,35);
    for(const api of placementApis){
      const before=stats.calls;
      expect(originalPlacement(production,productionDecoration,input,api)).toEqual(originalPlacement(frozen,frozenDecoration,input,api));
      expect(stats.calls-before).toBe(api.includes('decorations')?2:1);
    }
  });
  it('retains the original accessor order across surfaces before normalizing the next one',()=>{
    const factory=()=>{
      const input=generatePlacement(7,0),trace=[];
      const lamp={key:'lamp',kind:'lamp',mount:'undershelf',width:20,x:.6};
      const book={key:'book',kind:'book',width:32,x:.4};
      Object.defineProperty(book,'extra',{enumerable:true,get(){trace.push('book');lamp.width=77;return 'kept';}});
      Object.defineProperty(lamp,'extra',{enumerable:true,get(){trace.push('lamp');return 'kept';}});
      input.objects=[book,lamp];input.movedKey='lamp';input.target={shelf:1,x:.5};
      return{input,trace};
    };
    for(const api of ['decorations','move-decorations']){
      const expected=factory(),actual=factory(),calls=stats.calls,allocations=stats.allocations;
      expect(rustShelfPlacement(state.core,actual.input.objects,actual.input.options,settings(actual.input,api))).toBeUndefined();
      expect(actual.trace).toEqual([]);expect(stats.calls).toBe(calls);expect(stats.allocations).toBe(allocations);
      const want=originalPlacement(frozen,frozenDecoration,expected.input,api);
      const got=originalPlacement(production,productionDecoration,actual.input,api);
      expect(got).toEqual(want);expect(actual.trace).toEqual(expected.trace);
      expect(actual.trace).toEqual(api==='decorations'?['book','lamp']:['lamp','book']);
      if(api==='decorations')expect(got.flatMap(row=>row.items).find(item=>item.key==='lamp').width).toBe(77);
    }
  });
  it('does not read accessors while rejecting inherited fields, positions or array entries',()=>{
    const variants=[
      (input,trace)=>{input.options=Object.create({get shelfWidth(){trace.push('shelfWidth');return 360;}});},
      (input,trace)=>{input.objects[0]=Object.assign(Object.create({get width(){trace.push('width');return 42;}}),{key:'book',kind:'book'});},
      (input,trace)=>{delete input.objects[0].width;input.objects[0].style=Object.create({get width(){trace.push('style.width');return 39;}});},
      (input,trace)=>{input.movedKey='missing';Object.defineProperty(input.options.placements,input.objects[0].key,{get(){trace.push('placements');return {shelf:0,x:.4};}});},
      (input,trace)=>{input.movedKey='missing';input.options.placements[input.objects[0].key]=Object.assign(Object.create({get x(){trace.push('placement.x');return .4;}}),{shelf:0});},
      (input,trace)=>{input.target=Object.assign(Object.create({get shelf(){trace.push('target.shelf');return 1;}}),{x:.4});},
      (input,trace)=>{Object.defineProperty(input.objects[0],Symbol.for('metadata-accessor'),{enumerable:true,get(){trace.push('symbol');return 'kept';}});},
      (input,trace)=>{const object=input.objects[0];Object.defineProperty(input.objects,0,{get(){trace.push('array[0]');return object;},enumerable:true});},
    ];
    for(const variant of variants){
      const factory=()=>{const input=generatePlacement(9,1),trace=[];variant(input,trace);return{input,trace};};
      const expected=factory(),actual=factory(),calls=stats.calls,allocations=stats.allocations;
      expect(rustShelfPlacement(state.core,actual.input.objects,actual.input.options,settings(actual.input,'move'))).toBeUndefined();
      expect(actual.trace).toEqual([]);expect(stats.calls).toBe(calls);expect(stats.allocations).toBe(allocations);
      const want=originalPlacement(frozen,frozenDecoration,expected.input,'move');
      const got=originalPlacement(production,productionDecoration,actual.input,'move');
      expect(got).toEqual(want);expect(actual.trace).toEqual(expected.trace);
    }
  });
  it('retains separate configuration reads and values for each mounting surface',()=>{
    const factory=()=>{
      const input=generatePlacement(4,2),trace=[];
      input.objects[0].kind='book';delete input.objects[0].mount;
      input.objects[1].kind='lamp';input.objects[1].mount='undershelf';
      Object.defineProperty(input.options,'shelfWidth',{enumerable:true,get(){trace.push('width');return 320+trace.length*8;}});
      return{input,trace};
    };
    for(const api of ['decorations','move-decorations']){
      const expected=factory(),actual=factory();
      expect(rustShelfPlacement(state.core,actual.input.objects,actual.input.options,settings(actual.input,api))).toBeUndefined();
      expect(actual.trace).toEqual([]);
      const want=originalPlacement(frozen,frozenDecoration,expected.input,api);
      const got=originalPlacement(production,productionDecoration,actual.input,api);
      expect(got).toEqual(want);expect(actual.trace).toEqual(expected.trace);expect(actual.trace.length).toBeGreaterThan(3);
    }
  });
  it('propagates a one-shot getter error once instead of swallowing and retrying it',()=>{
    for(const api of placementApis){
      const input=generatePlacement(9,1),error=new Error('metadata accessor failed');let reads=0;
      Object.defineProperty(input.objects[0],'extra',{enumerable:true,get(){if(++reads===1)throw error;return 'retried';}});
      expect(()=>originalPlacement(production,productionDecoration,input,api)).toThrow(error);
      expect(reads).toBe(1);
    }
  });
  it('keeps accessor-backed reentrancy in the original path without duplicate getter calls',()=>{
    const factory=()=>{
      const input=generatePlacement(7,4),observed={reads:0,nested:null};
      Object.defineProperty(input.objects[0],'extra',{enumerable:true,get(){
        observed.reads++;core.memory.grow(1);
        observed.nested=rustShelfPlacement(state.core,[{key:'nested',width:12}],{shelfWidth:200});return 'kept';
      }});
      return{input,state:observed};
    };
    const expected=factory(),actual=factory();
    expect(rustShelfPlacement(state.core,actual.input.objects,actual.input.options,settings(actual.input,'decorations'))).toBeUndefined();
    expect(actual.state.reads).toBe(0);
    const got=originalPlacement(production,productionDecoration,actual.input,'decorations');
    const want=originalPlacement(frozen,frozenDecoration,expected.input,'decorations');
    expect(got).toEqual(want);expect(actual.state.reads).toBe(1);expect(expected.state.reads).toBe(1);
    expect(actual.state.nested).not.toBeUndefined();expect(stats.live).toBe(0);
    core.memory.grow(1);expect(got.flatMap(row=>row.items).find(item=>item.key===actual.input.objects[0].key).extra).toBe('kept');
  });
  it('does not catch host normalization or hydration errors as WASM failures',()=>{
    const normalizationError=new Error('normalization'),hydrationError=new Error('hydration');let reads=0;
    // Arbitrary proxies are outside the data-record fast-path contract. This
    // specifically checks that a host exception is not swallowed and retried.
    const options=new Proxy({shelfWidth:360},{get(target,key,receiver){
      if(key==='shelfWidth'){reads++;throw normalizationError;}return Reflect.get(target,key,receiver);
    }});
    expect(()=>production.layoutShelvedObjects([{key:'book',width:32}],options)).toThrow(normalizationError);
    expect(reads).toBe(1);
    const object={key:'book',width:32};let hydrationReads=0;
    state.core=tracked({shelf_place(...args){
      stats.calls++;const result=core.shelf_place(...args);
      Object.defineProperty(object,'extra',{enumerable:true,get(){hydrationReads++;throw hydrationError;}});
      return result;
    }});
    expect(()=>rustShelfPlacement(state.core,[object],{shelfWidth:360})).toThrow(hydrationError);
    expect(hydrationReads).toBe(1);expect(stats.live).toBe(0);
  });
  it('recreates output views after kernel allocation grows WASM memory',()=>{
    state.core=tracked({shelf_place(...args){stats.calls++;core.memory.grow(1);return core.shelf_place(...args);}});
    compare(generatePlacement(5,40),'move-decorations');
  });
  it('releases rejected jobs and permits cold/allocation/unsupported fallback',()=>{
    const input=generatePlacement(2,20);
    expect(rustShelfPlacement(null,input.objects,input.options)).toBeUndefined();
    for(const alloc_f64 of [()=>0,()=>{throw new RangeError('allocation');}]){
      expect(rustShelfPlacement({...core,alloc_f64},input.objects,input.options)).toBeUndefined();
    }
    for(const shelf_place of [()=>0,()=>{throw new WebAssembly.RuntimeError('trap');}]){
      expect(rustShelfPlacement(tracked({shelf_place}),input.objects,input.options)).toBeUndefined();expect(stats.live).toBe(0);
    }
    const tooMany=Array.from({length:8193},(_,index)=>({key:`limit:${index}`,width:20}));
    const allocations=stats.allocations;
    expect(rustShelfPlacement(state.core,tooMany,input.options)).toBeUndefined();expect(stats.allocations).toBe(allocations);
    compare(input,'move');
  });
});
