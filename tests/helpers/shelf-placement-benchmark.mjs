import { placementSettings } from './shelf-placement-cases.mjs';
export const targetsFor = (fixture, input) => input.sequence
  ? Array.from({ length:input.sequence }, (_, index) => ({ shelf:index % 5, x:((index * 17) % 101) / 100 }))
  : [fixture.target];
export function placementOptions(fixture, api, target) {
  return { ...placementSettings(api), movedKey:fixture.movedKey, target };
}
export function canonicalPlacement(value) {
  const describe = value => {
    if (value === undefined) return ['undefined'];
    if (typeof value === 'number') return ['number', Number.isNaN(value) ? 'NaN' : Object.is(value,-0) ? '-0' : String(value)];
    if (Array.isArray(value)) return ['array',value.map(describe)];
    if (value && typeof value === 'object') return ['object',Object.keys(value).sort().map(key=>[key,describe(value[key])])];
    return [typeof value,value];
  };
  return JSON.stringify(describe(value));
}
export function placementChecksum(result) {
  if(result===undefined)throw new Error('Unexpected compiled placement fallback');
  const shelves=Array.isArray(result)?result:result.shelves;
  return shelves.reduce((sum,row)=>sum+row.usedWidth+row.occupiedWidth+row.freeWidth
    +row.items.reduce((sum,item)=>sum+item.left+item.center+item.x+item.shelf,0),shelves.length);
}
