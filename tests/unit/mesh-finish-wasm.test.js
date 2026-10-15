// @vitest-environment node
// Physical paint UVs and the smooth wall normals of the rounded posts (Rust shelf module) against the frozen
// JavaScript original, on the real post and shelf-pan geometry and on adversarial fixtures.
import * as THREE from 'three';
import {RoundedBoxGeometry} from 'three/addons/geometries/RoundedBoxGeometry.js';
import {expect,it} from 'vitest';
import {needRustShelf} from '../../src/js/rust-shelf.js';
import {physicalPaintUVs,smoothPostNormals} from './helpers/reference-mesh-finish.js';
import {uprightProfile,extrudedSheet} from './helpers/reference-baggebo-model.js';
const shelf=needRustShelf();
const bytes=array=>Buffer.from(array.buffer,array.byteOffset,array.byteLength);
function post(side=-1,front=1){const {points}=uprightProfile();return extrudedSheet(points.map(p=>[side*(300-p.x),(front>0?0:-250)-front*p.y]),[],1160,0);}
const paintUVs=(g,normal=g.attributes.normal.array)=>shelf.probe_finish(0,g.attributes.position.array,normal);
const postNormals=g=>shelf.probe_finish(1,g.attributes.position.array,g.attributes.normal.array);
for(const segments of [1,3,8])it(`keeps physical paint UVs on curved/folded geometry at detail ${segments}`,()=>{
 const a=new RoundedBoxGeometry(200,15,230,segments,.6),b=a.clone();physicalPaintUVs(b);
 expect(bytes(paintUVs(a)).equals(bytes(b.attributes.uv.array))).toBe(true);
});
for(const side of [-1,1])for(const front of [-1,1])it(`keeps smooth walls and independent caps at ${side}/${front}`,()=>{
 const a=post(side,front),b=a.clone();smoothPostNormals(b);
 expect(bytes(postNormals(a)).equals(bytes(b.attributes.normal.array))).toBe(true);
 physicalPaintUVs(b);expect(bytes(paintUVs(a,postNormals(a))).equals(bytes(b.attributes.uv.array))).toBe(true); // the paint follows the smoothed normals
});
it('keeps zero-sign grouping, dominant-axis ties and fractional normals',()=>{
 for(let trial=0;trial<100;trial++){
  const a=new THREE.BufferGeometry(),p=new Float32Array(90),n=new Float32Array(90),uv=new Float32Array(60);
  for(let i=0;i<30;i++){p.set([i%2?-0:0,i,Math.floor(i/6)*.123],i*3);n.set([Math.sin(i+trial),i%7===0?.50001:0,Math.cos(i-trial)],i*3);}
  a.setAttribute('position',new THREE.BufferAttribute(p,3));a.setAttribute('normal',new THREE.BufferAttribute(n,3));a.setAttribute('uv',new THREE.BufferAttribute(uv,2));
  const b=a.clone();smoothPostNormals(b);expect(bytes(postNormals(a)).equals(bytes(b.attributes.normal.array)),`normals ${trial}`).toBe(true);
  physicalPaintUVs(b);expect(bytes(paintUVs(a,postNormals(a))).equals(bytes(b.attributes.uv.array)),`uv ${trial}`).toBe(true);
 }
});
it('keeps matching on pseudo-random vertices and ties between the dominant axes',()=>{
 let seed=4421;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
 for(let trial=0;trial<100;trial++){
  const count=3*(1+Math.floor(random()*40)),p=new Float32Array(count*3),n=new Float32Array(count*3);
  for(let i=0;i<p.length;i++){const kind=random();p[i]=Math.fround(kind<.2?0:kind<.3?-0:kind<.5?Math.round(random()*6)-3:(random()-.5)*600);n[i]=Math.fround(kind<.15?.5:kind<.3?-.5:kind<.45?1:kind<.5?0:random()*2-1);}
  const a=new THREE.BufferGeometry();a.setAttribute('position',new THREE.BufferAttribute(p,3));a.setAttribute('normal',new THREE.BufferAttribute(n,3));a.setAttribute('uv',new THREE.BufferAttribute(new Float32Array(count*2),2));
  const b=a.clone();smoothPostNormals(b);physicalPaintUVs(b);
  expect(bytes(postNormals(a)).equals(bytes(b.attributes.normal.array)),`normals ${trial}`).toBe(true);
  expect(bytes(paintUVs(a,postNormals(a))).equals(bytes(b.attributes.uv.array)),`uv ${trial}`).toBe(true);
 }
});
