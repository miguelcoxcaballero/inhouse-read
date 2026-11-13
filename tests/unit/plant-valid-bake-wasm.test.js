// @vitest-environment node
// The check a saved plant bake must pass before the shelf uses it (plant_valid_bake of the Rust shelf module)
// against the frozen original (tests/unit/helpers/reference-plant-valid-bake.js): every catalogue plant's real bake
// and tens of thousands of damaged copies of them, one or two fields replaced by junk of every kind.
import {describe,expect,it} from 'vitest';
import {createShelfPlant,shelfPlantBakeRecord} from '../../src/js/shelf-plants.js';
import {PLANT_CATALOG,POT_CATALOG} from '../../src/js/plant-catalog-data.js';
import {needRustShelf} from '../../src/js/rust-shelf.js';
import * as module from '../../src/wasm/shelf/inhouse_read_shelf.js';
import {referenceValidBake} from './helpers/reference-plant-valid-bake.js';
import {generator} from './helpers/lamp-lighting-scenarios.js';

const shelf=needRustShelf();
function realBakes(){
 const bakes=[],plants=[];
 PLANT_CATALOG.forEach((plant,index)=>{
  const made=createShelfPlant({catalogId:plant.id,potId:POT_CATALOG[index%POT_CATALOG.length].id,seed:`valid-${plant.id}`,height:150+index*10},{persist:true});
  plants.push(made);bakes.push(shelfPlantBakeRecord().models.at(-1)[1]);
 });
 for(const variant of ['cactus','upright','leafy']){const made=createShelfPlant({variant,key:`valid:${variant}`,height:180},{persist:true});plants.push(made);bakes.push(shelfPlantBakeRecord().models.at(-1)[1]);}
 for(const plant of plants)plant.userData.dispose();
 return bakes;
}
// A copy that shares the typed arrays (they are never written) and nothing else.
const copy=value=>ArrayBuffer.isView(value)?value:Array.isArray(value)?value.map(copy):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([key,item])=>[key,copy(item)])):value;
const JUNK=[undefined,null,0,-1,1,2,1.5,-0,NaN,Infinity,'','group','mesh','lines','clay','needles','0','1','-1','XYZ',true,false,[],[0,0,0],[0,0,0,1],[0,0,0,'XYZ'],[1,2,NaN],[1,2,Infinity],['a',1,2],
 [1,2],[1,2,3,4,5,6],[null,null,null],{},{length:3},{0:0,1:0,2:0,length:3},new Float32Array(3),new Float32Array(9),new Float64Array(3),new Uint16Array(3),new Uint32Array(6),new Uint8Array(4),new Int8Array(6),
 new Int16Array(3),new Int32Array(3),new Uint8ClampedArray(3),new String('mesh'),new Number(0),['clay'],['group'],[[new Float32Array(3),3,false]],[new Float32Array(6),3,false],[new Float32Array(6),2],
 [new Float32Array(6),0],[new Float32Array(6),-3],[new Float32Array(6),1.5],[new Float32Array(6),'3'],[new Uint8Array(6),3],[new Int16Array(6),3],[[1,2,3],3],[null,3],[],
 {position:[new Float32Array(6),3,false]},{position:[new Float32Array(6),3,false],normal:5},{position:[new Float32Array(6),3,false],uv:[new Float32Array(4),2,false]},{position:5},{position:'abc'},
 {position:[{length:6},3]},{normal:[new Float32Array(6),3,false]},1e21,2**53,-1.5,'group ',{kind:'group'}];
const OBJECT_FIELDS=['kind','name','position','scale','quaternion','rotation','place','parent','role','geometry','castShadow','userData'];
const GEOMETRY_FIELDS=['type','attributes','index','groups','userData','box'];
function damage(bake,random){
 const pick=list=>list[Math.floor(random()*list.length)],junk=()=>pick(JUNK);
 const steps=random()<.25?2:1;
 for(let step=0;step<steps;step++){
  const object=pick(bake.objects),meshes=bake.objects.filter(item=>item&&item.geometry&&typeof item.geometry==='object'),mesh=meshes.length?pick(meshes):null;
  switch(Math.floor(random()*14)){
   case 0:bake[pick(['parts','objects'])]=junk();return;
   case 1:bake.objects[Math.floor(random()*bake.objects.length)]=junk();break;
   case 2:case 3:case 4:if(object&&typeof object==='object')object[pick(OBJECT_FIELDS)]=junk();break;
   case 5:case 6:if(mesh)mesh.geometry[pick(GEOMETRY_FIELDS)]=junk();break;
   case 7:case 8:if(mesh?.geometry.attributes&&typeof mesh.geometry.attributes==='object')mesh.geometry.attributes[pick([...Object.keys(mesh.geometry.attributes),'extra'])]=junk();break;
   case 9:if(mesh?.geometry.attributes&&typeof mesh.geometry.attributes==='object'){const names=Object.keys(mesh.geometry.attributes),entry=mesh.geometry.attributes[pick(names)];if(Array.isArray(entry))entry[Math.floor(random()*3)]=junk();}break;
   case 10:if(object&&typeof object==='object'&&Array.isArray(object[pick(['position','scale','quaternion','rotation'])])){const field=pick(['position','scale','quaternion','rotation']);if(Array.isArray(object[field]))object[field][Math.floor(random()*5)]=junk();}break;
   case 11:if(object&&typeof object==='object')delete object[pick(OBJECT_FIELDS)];break;
   case 12:if(mesh)delete mesh.geometry[pick(GEOMETRY_FIELDS)];break;
   case 13:bake.objects.push(junk());break;
  }
 }
}
// The original threw a TypeError on some malformed records (an attribute that is not a list); the module answers false.
const original=bake=>{try{return referenceValidBake(bake);}catch{return 'threw';}};

describe('the saved-bake check of the Rust shelf module',()=>{
 const bakes=realBakes();
 it('accepts every real bake, like the original',()=>{
  expect(bakes.length).toBeGreaterThanOrEqual(11);
  for(const bake of bakes){expect(referenceValidBake(bake)).toBe(true);expect(shelf.plant_valid_bake(bake)).toBe(true);expect(shelf.plant_valid_bake(copy(bake))).toBe(true);}
  expect(bakes.some(bake=>bake.objects.some(object=>object.kind==='lines'))).toBe(true);expect(bakes.some(bake=>bake.objects.some(object=>object.kind==='group'))).toBe(true);
 });
 it('answers like the original for anything that is not a bake',()=>{
  for(const value of [...JUNK,{parts:[],objects:[]},{parts:[],objects:[null]},{parts:{},objects:[]},{parts:[],objects:{length:0}}]){
   if(typeof value==='symbol'||typeof value==='function')continue;
   expect(shelf.plant_valid_bake(value),String(JSON.stringify(value))).toBe(original(value)===true);
  }
 });
 it('answers like the original for damaged bakes',()=>{
  const random=generator(20261113),tally={cases:0,accepted:0,rejected:0,threw:0,differences:[]};let digest=0;
  for(let round=0;round<60000;round++){
   const bake=copy(bakes[round%bakes.length]);damage(bake,random);
   const expected=original(bake),answer=shelf.plant_valid_bake(bake);
   tally.cases++;if(expected==='threw')tally.threw++;else if(expected)tally.accepted++;else tally.rejected++;
   digest=(Math.imul(digest,31)+(answer?1:0))>>>0;
   if(answer!==(expected===true)&&tally.differences.length<12)tally.differences.push(`round ${round}: ${answer} / ${expected}`);
  }
  console.log('plant_valid_bake differential',JSON.stringify({...tally,digest}));
  expect(tally.differences).toEqual([]);
  // Not an empty comparison: damage is sometimes harmless (a field the check does not read) and usually fatal.
  expect(tally.accepted).toBeGreaterThan(5000);expect(tally.rejected).toBeGreaterThan(30000);expect(tally.threw).toBeGreaterThan(50);
 },120000);
 it('leaves no handles behind',()=>{
  const random=generator(7),before=module.shelf_live_handles();
  for(let round=0;round<3000;round++){const bake=copy(bakes[round%bakes.length]);if(round%2)damage(bake,random);shelf.plant_valid_bake(bake);}
  expect(module.shelf_live_handles()).toBe(before);
 });
});
