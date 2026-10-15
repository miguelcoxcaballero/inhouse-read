// @vitest-environment node
// Compaction of an expanded sheet or an assembly (the Rust shelf module) against the frozen JavaScript original:
// attribute order, stored types, every byte and the index width. The module's own copy is called through a probe.
import * as THREE from 'three';
import {expect,it} from 'vitest';
import {needRustShelf} from '../../src/js/rust-shelf.js';
import {compactGeometry as reference} from './helpers/reference-mesh-compact.js';
import {readGeometry} from './helpers/geo-packet.js';
const shelf=needRustShelf();
const bytes=array=>Buffer.from(array.buffer,array.byteOffset,array.byteLength);
const ORDERS=['pnuc','punc'];
// Attribute order as letters: p position, n normal, u uv, c colour (left out when `colours` is false).
function fixture(count,colours=true,order='pnuc'){
 const g=new THREE.BufferGeometry(),position=new Float32Array(count*3),normal=new Float32Array(count*3),uv=new Float32Array(count*2),color=new Float32Array(count*3);
 for(let i=0;i<count;i++){const corner=[0,1,2,0,2,3][i%6],pair=Math.floor(i/6);position.set([pair*.123+corner,corner%2,i%6===3?-0:0],i*3);normal.set([.123456,.234567,.96789],i*3);uv.set([corner/3,corner/7],i*2);color.set([.5,.73,.999],i*3);}
 const made={p:['position',new THREE.BufferAttribute(position,3)],n:['normal',new THREE.BufferAttribute(normal,3)],u:['uv',new THREE.BufferAttribute(uv,2)],c:['color',new THREE.BufferAttribute(color,3)]};
 for(const letter of order)if(letter!=='c'||colours)g.setAttribute(...made[letter]);
 g.userData.order=colours?order:order.replace('c','');return g;
}
const compact=g=>shelf.probe_compact(g.userData.order,g.attributes.position.array,g.attributes.normal.array,g.attributes.uv.array,g.attributes.color?.array??new Float32Array(0));
function exact(packet,expected,label=''){
 const actual=readGeometry(packet),names=Object.keys(expected.attributes);
 expect(Object.keys(actual.attributes),label+' attribute order').toEqual(names);
 for(const name of names){
  const x=actual.attributes[name],y=expected.attributes[name];
  expect(x.itemSize,name).toBe(y.itemSize);expect(x.kind==='f32',`${name} stored as float`).toBe(!y.normalized);
  expect(x.array.constructor,name).toBe(y.array.constructor);expect(bytes(x.array).equals(bytes(y.array)),`${label} ${name} bytes`).toBe(true);
 }
 expect(actual.index.constructor,label+' index width').toBe(expected.index.array.constructor);
 expect(bytes(actual.index).equals(bytes(expected.index.array)),label+' index bytes').toBe(true);
}
for(const count of [1,5,6,12,120,600,120000])it(`preserves all attributes, pair boundaries and index width for ${count} corners`,()=>{
 for(const order of ORDERS){const g=fixture(count,true,order);exact(compact(g),reference(g),`${count}/${order}`);}
 if(count===120000)expect(readGeometry(compact(fixture(count))).index.constructor).toBe(Uint32Array);
});
it('keeps rounding ties, negative normalized values, differing seams and attribute orders',()=>{
 for(let trial=0;trial<100;trial++){
  const g=fixture(12,trial%2===0,ORDERS[trial%2]),n=g.attributes.normal.array;for(let i=0;i<n.length;i++)n[i]=Math.fround(((i%7)-3.5)/32767+trial/1234567);
  exact(compact(g),reference(g),`trial ${trial}`);
 }
});
it('keeps matching on pseudo-random attributes, including values far outside the normalised range',()=>{
 let seed=9731;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
 for(let trial=0;trial<120;trial++){
  const g=fixture(6*(1+Math.floor(random()*8)),trial%3!==0,ORDERS[trial%2]);
  for(const name of ['position','normal','uv','color'])if(g.attributes[name]){
   const a=g.attributes[name].array;for(let i=0;i<a.length;i++){const kind=random();a[i]=Math.fround(kind<.1?(random()-.5)*1e12:kind<.2?0:kind<.3?-0:kind<.4?Math.round(random()*8)/8:(random()-.5)*3);}
  }
  const half=g.attributes.position.array;for(let i=0;i+18<=half.length;i+=18)half.copyWithin(i+9,i,i+9); // repeated corners inside a pair
  exact(compact(g),reference(g),`random ${trial}`);
 }
});
