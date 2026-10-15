// @vitest-environment node
// Real expanded-metal sheets (Rust shelf module) against the frozen JavaScript original: apertures, pressed
// facets, flat normals, and the compacted form the shelf stores.
import {expect,it} from 'vitest';
import {needRustShelf} from '../../src/js/rust-shelf.js';
import {expandedMetal as reference} from './helpers/reference-metal-sheet.js';
import {compactGeometry} from './helpers/reference-mesh-compact.js';
import {readGeometry} from './helpers/geo-packet.js';
const shelf=needRustShelf();
const bytes=array=>Buffer.from(array.buffer,array.byteOffset,array.byteLength);
const native=(bounds,kind=0,z=0,compact=false)=>shelf.probe_sheet(Float64Array.of(...bounds,13.2,7.2,.9,.65,z),kind,compact);
function original(bounds,kind=0,z=0){return reference(...bounds,kind===0?(u,v,n)=>[u,n,-v]:(u,v,n)=>[v,-u,z+n]);}
function exact(packet,expected,label){
 const actual=readGeometry(packet);expect(actual.index).toBeNull();
 expect(Object.keys(actual.attributes),label).toEqual(Object.keys(expected.attributes));
 for(const name of Object.keys(expected.attributes)){
  expect(actual.attributes[name].itemSize).toBe(expected.attributes[name].itemSize);
  expect(bytes(actual.attributes[name].array).equals(bytes(expected.attributes[name].array)),`${label} ${name}`).toBe(true);
 }
}
for(const bounds of [[-283.75,283.75,15,235],[24,1140,-100,100],[-10,10,-10,10],[0,1,0,1],[-.001,.001,-.001,.001]])for(const kind of [0,1])it(`preserves cut apertures and pressed facets ${bounds} orientation ${kind}`,()=>{
 exact(native(bounds,kind,-249),original(bounds,kind,-249),`${bounds}/${kind}`);
});
it('keeps one hundred fractional cuts byte identical',()=>{
 let seed=438451;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
 for(let i=0;i<100;i++){const x=random()*40-20,y=random()*40-20,bounds=[x,x+random()*100+.1,y,y+random()*200+.1],kind=i%2,z=random()*100-50;exact(native(bounds,kind,z),original(bounds,kind,z),`cut ${i}`);}
});
it('stores the production sheets in the compacted form the shelf uses',()=>{
 for(const [bounds,kind,z] of [[[-283.75,283.75,15,235],0,0],[[376.51,696.51,-108,108],1,-249]]){
  const packet=readGeometry(native(bounds,kind,z,true)),expected=compactGeometry(original(bounds,kind,z));
  expect(Object.keys(packet.attributes)).toEqual(Object.keys(expected.attributes));
  for(const name of Object.keys(expected.attributes))expect(bytes(packet.attributes[name].array).equals(bytes(expected.attributes[name].array)),name).toBe(true);
  expect(bytes(packet.index).equals(bytes(expected.index.array))).toBe(true);expect(packet.index.constructor).toBe(expected.index.array.constructor);
 }
});
