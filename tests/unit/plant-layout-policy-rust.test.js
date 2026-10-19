// @vitest-environment node
import {expect,it} from 'vitest';
import * as actual from '../../src/js/plant-dimensions.js';
import * as original from './helpers/reference-plant-dimensions-policy.js';
import {placeRooftopPlants} from '../../src/js/plant-rooftop-layout.js';
import {placeRooftopPlants as originalRooftop} from './helpers/reference-plant-rooftop-layout.js';
import {needRustShelf} from '../../src/js/rust-shelf.js';
let seed=27315;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296};
it('preserves dimension lookup copies, unknown ids and physical scene sizes',()=>{
 for(const plant of [...Object.keys(actual.PLANT_SIZES),'','missing','__proto__','constructor',null,undefined,0,Symbol('plant'),{}])for(const pot of [...Object.keys(actual.POT_SIZES),'missing','__proto__',null,undefined,0,Symbol('pot')]){
  expect(actual.standardPlantClass(plant)).toEqual(original.standardPlantClass(plant));expect(actual.plantDimensions(plant,pot)).toEqual(original.plantDimensions(plant,pot));expect(actual.plantSizeLabel(plant,pot)).toBe(original.plantSizeLabel(plant,pot));
  for(const scale of [.325,.65,1.3,0,-0,NaN,Infinity,'0.5'])expect(actual.plantSceneSize(plant,pot,scale)).toEqual(original.plantSceneSize(plant,pot,scale));
 }
 const one=actual.plantDimensions('monstera','gradvis'),two=actual.plantDimensions('monstera','gradvis');expect(one).not.toBe(two);one.height=0;expect(two.height).toBeGreaterThan(0);
});
it('preserves touch dimensions, retained output identity, coercions, nonfinite edges and nearest-centre tie order',()=>{
 for(const value of [undefined,null,-1,0,599.9,600,NaN,Infinity,'599','600',600n,{valueOf:()=>601}])expect(actual.minimumBookCellWidth(value)).toBe(original.minimumBookCellWidth(value));
 for(let n=0;n<500;n++){
  const rect={left:random()*500-250,top:random()*700,width:random()*50-10,height:random()*140},min=random()*60;
  const out={keep:'yes'};expect(actual.padTapRect(rect,min,out)).toBe(out);expect(out).toEqual(original.padTapRect(rect,min,{keep:'yes'}));expect(actual.padTapSquare(rect,min)).toEqual(original.padTapSquare(rect,min));
 }
 for(const width of ['4',null,undefined,NaN,Infinity,-Infinity,-0])for(const height of [5,'5',NaN,0])for(const min of ['16',16,NaN,Infinity]){
  const rect={left:'10',top:'3',width,height};expect(actual.padTapRect(rect,min)).toEqual(original.padTapRect(rect,min));expect(actual.padTapSquare(rect,min)).toEqual(original.padTapSquare(rect,min));
 }
 const targets=Array.from({length:50},(_,id)=>({id,left:random()*300,top:random()*200,width:random()*35+1,height:random()*130+20}));
 for(let n=0;n<600;n++){const x=random()*400,y=random()*350;expect(actual.nearestTapTarget(targets,x,y)).toBe(original.nearestTapTarget(targets,x,y));}
 const a={left:0,top:0,width:20,height:50},b={...a};expect(actual.nearestTapTarget(new Set([a,b]),10,25)).toBe(a);expect(actual.nearestTapTarget([b,a],10,25)).toBe(b);expect(actual.nearestTapTarget([a],NaN,25)).toBeNull();
});
it('matches getter/coercion order, in-place rectangles and reentrant callbacks',()=>{
 function run(module){
  const calls=[],rect={get width(){calls.push('width');return {valueOf(){calls.push('width-number');return 5}}},get height(){calls.push('height');return 9},get left(){calls.push('left');return 10},get top(){calls.push('top');return 3}};
  const min={valueOf(){calls.push('minimum');module.minimumBookTapWidth(390);return 16}},out={};
  for(const key of ['left','top','width','height'])Object.defineProperty(out,key,{set(value){calls.push([key,value]);module.minimumBookCellWidth(600)}});
  module.padTapSquare(rect,min,out);return calls;
 }
 expect(run(actual)).toEqual(run(original));
 for(const name of ['padTapRect','padTapSquare']){const a={left:5,top:3,width:4,height:7},b={...a};expect(actual[name](a,16,a)).toEqual(original[name](b,16,b));}
});
function layout(type,width,count){return {shelfType:type,width,unitWidth:width,unitCount:1,rows:[{top:0,bottom:100},{top:100,bottom:200},{top:200,bottom:300}],entries:Array.from({length:count},(_,index)=>({key:`plant:${index}`,kind:'plant',shelf:index%6,x:16+random()*(width-32),width:30+random()*110,height:350,depth:70,rooftop:index%3!==1,node:{dataset:{}}}))};}
it('packs legacy rooftops exactly across cabinet types, unit widths and crowded overflow',()=>{
 for(const type of ['baggebo','walnut',undefined,'custom'])for(const width of [320,390,600,900])for(const count of [0,1,2,7,19]){
  const source=layout(type,width,count),a=structuredClone(source),b=structuredClone(source);const entries=[...a.entries],rows=a.rows;
  expect(placeRooftopPlants(a)).toBe(a);expect(originalRooftop(b)).toBe(b);expect(a).toEqual(b);expect(a.entries.every((entry,index)=>entry===entries[index])).toBe(true);expect(a.rows).toBe(rows);
 }
});
it('preserves dataset setter reentry and live annotation iteration while rooftop packing uses its original snapshot',()=>{
 function run(place){const value=layout('baggebo',390,1);value.entries[0].rooftop=false;const calls=[];
  Object.defineProperty(value.entries[0].node.dataset,'plantPlacement',{set(next){calls.push(next);value.entries.push({kind:'plant',rooftop:false,node:{dataset:{}}});actual.padTapRect({left:0,top:0,width:1,height:5},16);}});
  place(value);return {calls,appended:value.entries[1].node.dataset.plantPlacement,width:value.width,rows:value.rows};
 }
 expect(run(placeRooftopPlants)).toEqual(run(originalRooftop));
});
it('retains own symbols/proto fields in packing records and row templates, and releases handles when host callbacks throw',()=>{
 const shelf=needRustShelf(),symbol=Symbol('metadata'),value=layout('baggebo',390,1),entry=value.entries[0];entry[symbol]={kept:true};Object.defineProperty(entry,'__proto__',{value:'entry-own',enumerable:true});Object.defineProperty(value.rows[0],'__proto__',{value:'row-own',enumerable:true});
 const host={layout(objects,options){expect(objects[0][symbol]).toBe(entry[symbol]);expect(Object.hasOwn(objects[0],'__proto__')).toBe(true);expect(objects[0].__proto__).toBe('entry-own');expect(options).toEqual({shelfWidth:390,padding:16,gap:3,minShelves:1});expect(actual.minimumBookCellWidth(390)).toBe(16);return [{index:0,items:[]},{index:1,items:[{key:'roof:0',left:16,width:40}]}];}};
 shelf.plant_rooftop_layout(host,value);expect(value.rows[3].__proto__).toBe('row-own');expect(Object.getPrototypeOf(value.rows[3])).toBe(Object.prototype);expect(entry.roofUnit).toBe(1);
 const before=shelf.shelf_live_handles();for(let n=0;n<15;n++)expect(()=>shelf.plant_rooftop_layout({layout(){throw Error('callback failed')}},layout('walnut',390,1))).toThrow('callback failed');expect(shelf.shelf_live_handles()).toBe(before);
});
it('closes target iterators on abrupt completion and leaves no native handles after failed coercions/setters',()=>{
 const shelf=needRustShelf();let closed=0;function* targets(){try{yield {get left(){throw Error('target getter')}}}finally{closed++;}}
 const before=shelf.shelf_live_handles();for(let n=0;n<15;n++){
  expect(()=>actual.nearestTapTarget(targets(),1,1)).toThrow('target getter');expect(()=>actual.padTapSquare({left:0,top:0,width:4,height:5},16,Object.freeze({}))).toThrow(TypeError);
  expect(()=>actual.padTapRect({left:0,top:0,width:4,height:5},{valueOf(){throw Error('conversion')}})).toThrow('conversion');expect(()=>actual.minimumBookCellWidth(Symbol('viewport'))).toThrow(TypeError);
 }
 expect(closed).toBe(15);expect(shelf.shelf_live_handles()).toBe(before);
});
