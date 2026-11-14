// @vitest-environment node
// A shelf plant's objects as production rebuilds them from a bake (restoreContent in src/js/shelf-plants.js)
// against the frozen three.js original: every object's and geometry's own data (the copies JSON makes of the
// bake's `userData`, which production now skips for an empty plain object), the order children joined their
// parents in, each geometry's attributes, index, groups and bounding box. A plant drawn and the same plant
// from its remembered bake, for every catalogue plant.
import {afterAll,describe,expect,it} from 'vitest';
import {createShelfPlant} from '../../src/js/shelf-plants.js';
import {createShelfPlant as original} from './helpers/reference-shelf-plants.js';
import {PLANT_CATALOG,POT_CATALOG} from '../../src/js/plant-catalog-data.js';

const counted={plants:0,objects:0,emptyData:0,filledData:0,geometries:0,attributes:0,groups:0};
afterAll(()=>{console.log('plant restore differential compared',JSON.stringify(counted));});

function shot(group){
 const rows=[];
 group.traverse(object=>{
  const row={name:object.name,type:object.type,children:object.children.map(child=>child.name),data:JSON.stringify(object.userData),plain:Object.getPrototypeOf(object.userData)===Object.prototype,
   rotation:[object.rotation.x,object.rotation.y,object.rotation.z,object.rotation.order]};
  const geometry=object.geometry;
  if(geometry){
   row.geometry={type:geometry.type,data:JSON.stringify(geometry.userData),plain:Object.getPrototypeOf(geometry.userData)===Object.prototype,
    attributes:Object.entries(geometry.attributes).map(([name,attribute])=>[name,attribute.itemSize,attribute.normalized,attribute.count,attribute.array.constructor.name]),
    index:geometry.index?[geometry.index.count,geometry.index.array.constructor.name]:null,groups:geometry.groups.map(group=>[group.start,group.count,group.materialIndex]),
    box:geometry.boundingBox?[...geometry.boundingBox.min.toArray(),...geometry.boundingBox.max.toArray()]:null};
  }
  rows.push(row);
 });
 return rows;
}
function count(rows){
 counted.plants++;
 for(const row of rows){
  counted.objects++;if(row.data==='{}')counted.emptyData++;else counted.filledData++;
  if(row.geometry){counted.geometries++;counted.attributes+=row.geometry.attributes.length;counted.groups+=row.geometry.groups.length;if(row.geometry.data==='{}')counted.emptyData++;else counted.filledData++;}
 }
}

describe('a plant rebuilt from its bake',()=>{
 it('gives every object and geometry the data, children and arrays of the original',()=>{
  PLANT_CATALOG.forEach((plant,index)=>{
   const entry={catalogId:plant.id,potId:POT_CATALOG[index%POT_CATALOG.length].id,seed:`restore-${plant.id}`,height:150+index%5*40,width:60};
   for(const round of ['drawn','remembered']){
    const mine=createShelfPlant(entry,{persist:true}),theirs=original(entry,{persist:true});
    const a=shot(mine),b=shot(theirs);
    expect(a,`${plant.id} ${round}`).toEqual(b);
    count(a);
   }
  });
  for(const variant of ['cactus','fern','palm','unknown']){
   const entry={variant,key:`plant:restore-${variant}`,height:180,width:46};
   const a=shot(createShelfPlant(entry,{persist:true})),b=shot(original(entry,{persist:true}));
   expect(a,variant).toEqual(b);count(a);
  }
  expect(counted.emptyData).toBeGreaterThan(100);expect(counted.filledData).toBeGreaterThan(15);expect(counted.groups).toBeGreaterThan(0);
 },240000);
 it('gives each plant its own copies: changing one plant\'s data changes neither the bake nor the next plant',()=>{
  const entry={catalogId:PLANT_CATALOG[0].id,potId:POT_CATALOG[0].id,seed:'restore-own',height:180,width:60};
  const first=createShelfPlant(entry,{persist:true}),before=shot(createShelfPlant(entry,{persist:true}));
  let touched=0;
  first.traverse(object=>{
   object.userData.touched=true;touched++;
   for(const value of Object.values(object.userData))if(Array.isArray(value))value.push('changed');
   if(object.geometry)object.geometry.userData.touched=true;
  });
  expect(touched).toBeGreaterThan(2);
  const second=createShelfPlant(entry,{persist:true});
  expect(shot(second)).toEqual(before);
  const seen=new Set();
  first.traverse(object=>{seen.add(object.userData);if(object.geometry)seen.add(object.geometry.userData);});
  second.traverse(object=>{expect(seen.has(object.userData)).toBe(false);if(object.geometry)expect(seen.has(object.geometry.userData)).toBe(false);});
 });
});
