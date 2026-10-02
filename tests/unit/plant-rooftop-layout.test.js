import { expect, it } from 'vitest';
import { baggeboLayout } from '../../src/js/shelf-model-layout.js';
import { placeRooftopPlants } from '../../src/js/plant-rooftop-layout.js';

it('packs tall plants from different bays on actual roof surfaces, preserving their dimensions', () => {
  const entries = [0,1,2,3].map(shelf => ({ kind:'plant', key:`p${shelf}`, shelf, x:150,
    height:350, width:260, depth:182 }));
  const layout = placeRooftopPlants(baggeboLayout({ width:600, rows:[{}, {}, {}, {}], entries }));
  expect(layout.unitCount).toBe(2);
  expect(layout.rows).toHaveLength(6);
  for (const entry of layout.entries) {
    expect(entry).toMatchObject({ height:350,width:260,depth:182,rooftop:true });
    expect(entry.y + entry.height/2).toBe(0);
    const left=entry.roofUnit*624;
    expect(entry.x-entry.width/2).toBeGreaterThanOrEqual(left+16);
    expect(entry.x+entry.width/2).toBeLessThanOrEqual(left+584);
  }
  for (const unit of [0,1]) {
    const group=layout.entries.filter(entry=>entry.roofUnit===unit).sort((a,b)=>a.x-b.x);
    expect(group).toHaveLength(2);
    expect(group[1].x-group[0].x).toBeGreaterThanOrEqual(263);
  }
});

it('adds complete units when a migrated roof collection overflows, without changing book bays', () => {
  const book={kind:'book',shelf:1,x:50,width:80,height:172,style:{heightRatio:1}};
  const plants=Array.from({length:5},(_,i)=>({kind:'plant',shelf:0,x:100,key:`p${i}`,height:350,width:260,depth:180}));
  const layout=placeRooftopPlants(baggeboLayout({width:600,rows:[{},{},{}],entries:[book,...plants]}));
  expect(layout.unitCount).toBe(3);
  expect(layout.width).toBe(1848);
  expect(layout.entries[0].shelf).toBe(1);
  expect(new Set(layout.entries.slice(1).map(entry=>entry.roofUnit)).size).toBe(3);
});
