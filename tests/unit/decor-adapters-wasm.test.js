import { describe,it,expect } from 'vitest';
import * as geometry from '../../src/js/decor-geometry-spec.js';
import * as layout from '../../src/js/shelf-decoration-layout.js';
import * as reference from './helpers/reference-decor-adapters.js';
import { PLANT_CATALOG,POT_CATALOG } from '../../src/js/plant-catalog-data.js';
import { LAMP_CATALOG } from '../../src/js/lamp-catalog-data.js';
import { needRustShelf } from '../../src/js/rust-shelf.js';

const random = seed => () => ((seed=Math.imul(seed,1664525)+1013904223>>>0)/4294967296);
describe('compiled decorative geometry and mounting composition', () => {
 it('preserves fitted dimensions, defaults and referenced catalogue objects', () => {
  const heights=[undefined,null,0,-0,-20,1,80,290,NaN,Infinity,-Infinity,'260','bad'];
  for(const plant of [...PLANT_CATALOG,{id:'unknown'},{}])for(const pot of [...POT_CATALOG,{id:'unknown'},{}])for(const height of heights){
   const entry={catalogId:plant.id,potId:pot.id,height};
   const actual=geometry.plantGeometrySpec(entry),expected=reference.plantGeometrySpec(entry);
   expect(actual).toEqual(expected);expect(actual.catalogPlant).toBe(expected.catalogPlant);
  }
  for(const lamp of [...LAMP_CATALOG,{id:'unknown'},{}])for(const width of heights)for(const height of heights){
   const options={lampId:lamp.id,width,height};
   const actual=geometry.lampGeometrySpec(options),expected=reference.lampGeometrySpec(options);
   expect(actual).toEqual(expected);expect(actual.lamp).toBe(expected.lamp);expect(actual.native).toBe(expected.native);
  }
  for(const api of [geometry,reference]){
   expect(api.lampGeometrySpec()).toEqual(api.lampGeometrySpec({}));
   expect(()=>api.lampGeometrySpec(null)).toThrow(TypeError);
   expect(()=>api.plantGeometrySpec(undefined)).toThrow(TypeError);
  }
 });

 it('matches 1200 mixed-surface layouts and moves exactly, preserving object metadata and shared row arrays', () => {
  const next=random(106);
  for(let round=0;round<1200;round++){
   const metadata={tag:round}, symbol=Symbol('decor-metadata');
   const objects=Array.from({length:Math.floor(next()*28)},(_,i)=>{
    const kind=next()<.5?'book':next()<.5?'plant':'lamp';
    return { key:`${kind}:${i}`,kind,mount:next()<.5?'undershelf':'standing',width:next()*90+5,
      shelf:Math.floor(next()*5),x:next()<.2?undefined:next(),metadata,[symbol]:metadata };
   });
   const options={shelfWidth:160+next()*500,padding:next()*25,gap:next()*5,minShelves:Math.floor(next()*5),physicalPlacement:round%2===0};
   if(round%11===0&&objects.length)objects.push({...objects[0],mount:'undershelf',kind:'lamp'});
   const key=objects[Math.floor(next()*objects.length)]?.key||'missing';
   const target={shelf:Math.floor(next()*6),x:next()};
   const expected=reference.layoutShelfDecorations(objects,options), actual=layout.layoutShelfDecorations(objects,options);
   expect(actual).toEqual(expected);
   const moved=layout.moveShelfDecoration(objects,key,target,options);
   expect(moved).toEqual(reference.moveShelfDecoration(objects,key,target,options));
   for(const row of moved.shelves){expect(row.items).toBe(row.objects);for(const item of row.items){
    expect(item.metadata).toBe(metadata);expect(item[symbol]).toBe(metadata);
   }}
  }
 });

 it('preserves sequential accessor effects and permits reentrant placement during metadata hydration', () => {
  function run(api,move){
   const log=[],objects=[];let nested=false;
   for(let i=0;i<4;i++)objects.push({key:`item:${i}`,get kind(){log.push(`kind:${i}`);return i%2?'lamp':'book';},
    get mount(){log.push(`mount:${i}`);return 'undershelf';},width:40,shelf:0,x:.2+i*.2,
    get metadata(){log.push(`metadata:${i}`);if(!nested){nested=true;
     log.push(api.layoutShelfDecorations([{key:'nested',kind:'book',width:20}],{minShelves:1})[0].items[0].key);
     objects.push({key:'late',kind:'lamp',mount:'undershelf',width:10,shelf:1,x:.5});
    }return `tag:${i}`;}});
   const result=move?api.moveShelfDecoration(objects,'item:1',{shelf:2,x:.8},{minShelves:2}):api.layoutShelfDecorations(objects,{minShelves:2});
   return {log,result};
  }
  for(const move of [false,true])expect(run(layout,move)).toEqual(run(reference,move));
 });

 it('preserves sparse arrays, invalid inputs, extreme positions and special dictionary keys', () => {
  const objects=Array(3);objects[1]={key:'__proto__',kind:'book',width:20,shelf:0,x:.5};
  expect(layout.layoutShelfDecorations(objects)).toEqual(reference.layoutShelfDecorations(objects));
  for(const api of [layout,reference])expect(()=>api.moveShelfDecoration(objects,'__proto__',{shelf:0,x:.8})).toThrow(TypeError);
  for(const objects of [null,undefined,[null],[undefined]])for(const api of [layout,reference])expect(()=>api.layoutShelfDecorations(objects)).toThrow(TypeError);
  const entry={key:'__proto__',kind:'lamp',mount:'undershelf',width:30,shelf:4,x:.5};
  const actual=layout.moveShelfDecoration([entry],entry.key,{shelf:999,x:1},{minShelves:0});
  expect(actual).toEqual(reference.moveShelfDecoration([entry],entry.key,{shelf:999,x:1},{minShelves:0}));
  expect(Object.hasOwn(actual.placements,'__proto__')).toBe(true);
  expect(Object.getPrototypeOf(actual.placements)).toBe(Object.prototype);
 });

 it('retains no native handles after repeated geometry and placement calls', () => {
  const rust=needRustShelf();
  const run=()=>{geometry.plantGeometrySpec({catalogId:'monstera'});geometry.lampGeometrySpec();layout.moveShelfDecoration([{key:'book:a',kind:'book',width:30}], 'book:a',{shelf:0,x:.5});};
  run();const before=rust.shelf_live_handles();
  for(let i=0;i<200;i++)run();
  expect(rust.shelf_live_handles()).toBe(before);
 });
});
