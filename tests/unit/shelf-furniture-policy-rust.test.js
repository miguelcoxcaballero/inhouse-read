// @vitest-environment node
import {expect,it,vi} from 'vitest';
import * as THREE from 'three';
import {createHash} from 'node:crypto';
import {createShelfFurniture,createShelfOcclusion} from '../../src/js/shelf-furniture.js';
import {createShelfFurniture as original,createShelfOcclusion as originalOcclusion} from './helpers/reference-shelf-furniture-policy.js';
import {needRustShelf} from '../../src/js/rust-shelf.js';
const hash=bytes=>createHash('sha256').update(Buffer.from(bytes.buffer,bytes.byteOffset,bytes.byteLength)).digest('hex');
const geometry=g=>({attributes:Object.entries(g.attributes).map(([key,a])=>[key,a.array.constructor.name,a.itemSize,a.normalized,hash(a.array)]),groups:g.groups,box:g.boundingBox&&[g.boundingBox.min.toArray(),g.boundingBox.max.toArray()],sphere:g.boundingSphere&&[g.boundingSphere.center.toArray(),g.boundingSphere.radius]});
const signature=group=>({name:group.name,scale:group.scale.toArray(),data:{...group.userData,disposeGeometry:null},meshes:group.children.map(m=>({name:m.name,castShadow:m.castShadow,receiveShadow:m.receiveShadow,geometry:geometry(m.geometry),material:m.material}))});
const rows=[{bottom:192,top:20},{bottom:404},{bottom:616}];
const base={width:390,height:636,depth:155,rows};
it('preserves all geometry bytes, bounds, shared-material identities and scaled metadata',()=>{
 const wood=new THREE.MeshStandardMaterial(),back=new THREE.MeshStandardMaterial(),dark=new THREE.MeshStandardMaterial();
 for(const scale of [undefined,0,-1,NaN,Infinity,'1',.325,.65,.8125,1.3])for(const materials of [{wood},{backWood:back},{darkWood:dark},{wood,backWood:wood,darkWood:wood},{wood,backWood:back,darkWood:dark}]){
  const options={...base,...materials,scale},actual=createShelfFurniture(options),expected=original(options);
  expect(signature(actual)).toEqual(signature(expected));actual.userData.disposeGeometry();expected.userData.disposeGeometry();
 }
 for(const material of [wood,back,dark])material.dispose();
});
it('preserves malformed dimensions/row normalization and leaves inputs untouched',()=>{
 const wood=new THREE.MeshStandardMaterial();
 for(const scale of [undefined,.325,1.3])for(const dimensions of [{width:'390',height:null,depth:NaN},{width:-1,height:Infinity,depth:undefined}])for(const rowList of [null,[{bottom:'192'},{bottom:null},null,{bottom:192},{bottom:192}],Array(3)]){
  const options={...base,...dimensions,wood,scale,rows:rowList};const snapshot=structuredClone(rowList),actual=createShelfFurniture(options),expected=original(options);
  expect(signature(actual)).toEqual(signature(expected));expect(rowList).toEqual(snapshot);actual.userData.disposeGeometry();expected.userData.disposeGeometry();
 }
 wood.dispose();
});
it('keeps occlusion arrays and post-scale boxes/spheres byte-exact',()=>{
 for(const scale of [undefined,0,'2',.325,.65,.8125,1.3])for(const floorLight of [undefined,null,[.4,.3,.2,.12],[NaN,0,0,.1]]){
  const options={...base,scale,floorY:-636,floorLight,footprints:[{x:250,z:-155,radius:44},{x:NaN,z:0,radius:5},{x:0,z:0,radius:-1}]};
  const actual=createShelfOcclusion(options),expected=originalOcclusion(options);expect(geometry(actual)).toEqual(geometry(expected));actual.dispose();expected.dispose();
 }
});
it('disposes owned geometry once under reentrant disposal and never disposes shared wood',()=>{
 const wood=new THREE.MeshStandardMaterial();const materialDispose=vi.spyOn(wood,'dispose');const cabinet=createShelfFurniture({...base,wood});
 let count=0;for(const mesh of cabinet.children)mesh.geometry.addEventListener('dispose',()=>{count++;cabinet.userData.disposeGeometry();});
 cabinet.userData.disposeGeometry();cabinet.userData.disposeGeometry();expect(count).toBe(cabinet.children.length);expect(materialDispose).not.toHaveBeenCalled();materialDispose.mockRestore();wood.dispose();
});
it('preserves conversion/accessor failures and releases native handles on repeated errors',()=>{
 const wood=new THREE.MeshStandardMaterial(),failure=Error('bad measure');
 const cases=[{}, {...base,wood,scale:1.3,width:1n},{...base,wood,scale:1.3,width:{valueOf(){throw failure}}},{...base,wood,scale:1.3,rows:[{get extra(){throw failure},bottom:10}]}];
 for(const options of cases){const before=needRustShelf().shelf_live_handles();for(let n=0;n<10;n++){expect(()=>createShelfFurniture(options)).toThrow();expect(()=>original(options)).toThrow();}expect(needRustShelf().shelf_live_handles()).toBe(before);}
 wood.dispose();
});
it('preserves contact-shadow errors without leaking handles across failed host calls',()=>{
 const error=Error('bad foot');
 for(const options of [{...base,footprints:null},{...base,scale:1.3,footprints:{}},{...base,scale:1.3,footprints:[null]},{...base,scale:1.3,footprints:[{get x(){throw error}}]}]){
  const before=needRustShelf().shelf_live_handles();for(let n=0;n<10;n++){expect(()=>createShelfOcclusion(options)).toThrow();expect(()=>originalOcclusion(options)).toThrow();}expect(needRustShelf().shelf_live_handles()).toBe(before);
 }
});
