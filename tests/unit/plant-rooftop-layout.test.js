import { expect, it } from 'vitest';
import { baggeboLayout } from '../../src/js/shelf-model-layout.js';
import { placeRooftopPlants } from '../../src/js/plant-rooftop-layout.js';

it('fits tall plants into their saved bays without adding a rooftop collection', () => {
 const entries=[0,1,2,3].map(shelf=>({kind:'plant',key:`p${shelf}`,shelf,x:150,height:350,width:260,depth:182}));
 const layout=placeRooftopPlants(baggeboLayout({width:600,rows:[{},{},{},{}],entries}));
 expect(layout.unitCount).toBe(2);expect(layout.rows).toHaveLength(6);
 for(const entry of layout.entries){
  const row=layout.rows[entry.shelf];
  expect(entry.rooftop).toBe(false);expect(entry.roofUnit).toBeUndefined();
  expect(entry.height).toBeCloseTo(row.bottom-row.top-4);
  expect(entry.width/entry.height).toBeCloseTo(260/350);
  expect(entry.depth/entry.height).toBeCloseTo(182/350);
  expect(entry.y+entry.height/2).toBe(row.bottom);
 }
});
it('does not add furniture for tall plants and leaves book bays intact',()=>{
 const book={kind:'book',shelf:1,x:50,width:80,height:172,style:{heightRatio:1}};
 const plants=Array.from({length:5},(_,i)=>({kind:'plant',shelf:0,x:100,key:`p${i}`,height:350,width:260,depth:180}));
 const layout=placeRooftopPlants(baggeboLayout({width:600,rows:[{},{},{}],entries:[book,...plants]}));
 expect(layout.unitCount).toBe(1);expect(layout.width).toBe(600);expect(layout.entries[0].shelf).toBe(1);
 expect(layout.entries.slice(1).every(entry=>!entry.rooftop&&entry.roofUnit===undefined)).toBe(true);
});
