import {it,expect} from 'vitest';
import * as THREE from 'three';
import './helpers/rust-shelf-ready.js';
import {shelfBookSlot,shelfBookInsertion} from '../../src/js/bookshelf-return.js';
it('returns through the exact translated and tilted physical matrix instead of the nominal upright slot',()=>{
 const entry={x:120,y:160,width:100,height:200,thickness:20};
 const physical=new THREE.Matrix4().compose(new THREE.Vector3(-47.375,-143.125,-61.75),new THREE.Quaternion().setFromEuler(new THREE.Euler(0,Math.PI/2,.438,'ZYX')),new THREE.Vector3(1,1,1));
 for(const input of [physical.elements,Float64Array.from(physical.elements)]){
  const slot=shelfBookSlot(entry,390,input);expect(slot.elements).toEqual(physical.elements);
  expect(shelfBookInsertion(slot,entry.width,1).elements).toEqual(physical.elements);
  expect(shelfBookInsertion(slot,entry.width,0).elements[13]).toBe(physical.elements[13]+6);
 }
 expect(shelfBookSlot(entry,390).elements).not.toEqual(physical.elements);
});
it('rejects incomplete or nonfinite physical matrices without corrupting the existing nominal contract',()=>{
 const entry={x:120,y:160,width:100,height:200,thickness:20},nominal=shelfBookSlot(entry,390).elements;
 for(const invalid of [[],[1,2],new Array(16).fill(NaN)])expect(shelfBookSlot(entry,390,invalid).elements).toEqual(nominal);
});
