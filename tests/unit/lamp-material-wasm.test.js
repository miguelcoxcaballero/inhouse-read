// @vitest-environment node
import { expect, it } from 'vitest';
import * as THREE from 'three';
import { createShelfLamp } from '../../src/js/shelf-lamps.js';
import { createShelfLamp as original } from './helpers/reference-shelf-lamps.js';
import { needRustShelf } from '../../src/js/rust-shelf.js';
import { core, scratch, scratchPointer } from '../../src/js/decor-catalogue.js';

it('preserves every custom shader byte and material optics at both resolutions and fitted sizes', () => {
  for (const lampId of ['mittled','tripod','tarnaby']) for (const quality of ['low','high']) {
    const options = {lampId,quality,width:73.125,height:169.875};
    const actual = createShelfLamp(options), expected = original(options);
    try {
      for (const mesh of actual.children) {
        const a = mesh.material, b = expected.getObjectByName(mesh.name).material;
        for (const field of ['type','color','emissive','emissiveIntensity','roughness','metalness','ior','clearcoat','clearcoatRoughness',
          'envMapIntensity','side','depthWrite','transparent','opacity','transmission','thickness','attenuationDistance','blending','blendSrc','blendDst','toneMapped','bumpScale']) {
          expect(a[field],`${lampId}/${quality}/${mesh.name}/${field}`).toEqual(b[field]);
        }
        const shaderA = {fragmentShader:THREE.ShaderLib.standard.fragmentShader};
        const shaderB = {fragmentShader:THREE.ShaderLib.standard.fragmentShader};
        a.onBeforeCompile(shaderA); b.onBeforeCompile(shaderB);
        expect(shaderA.fragmentShader, `${mesh.name} shader`).toBe(shaderB.fragmentShader);
        expect(a.customProgramCacheKey(),`${mesh.name} program key`).toBe(b.customProgramCacheKey());
        expect(a.emissiveMap === a.map, `${mesh.name} map sharing`).toBe(b.emissiveMap === b.map);
      }
    } finally { actual.dispose(); expected.dispose(); }
  }
});
it('updates power and tint absolutely with the same float values, without replacing resources', () => {
  for (const lampId of ['mittled','tripod','tarnaby']) {
    const actual = createShelfLamp({lampId,quality:'low'}), expected = original({lampId,quality:'low'});
    const identities = actual.children.map(mesh=>[mesh.material,mesh.geometry]);
    try {
      for (const power of [0,.3,1,-0,-1,4,NaN,Infinity,-Infinity,'0.5',undefined,null]) {
        expect(Object.is(actual.userData.setPower(power), expected.userData.setPower(power))).toBe(true);
        for (const tint of [[1,1,1],[.37,1.27,.82],[0,-0,.5],[NaN,Infinity,-2],['1','1','1'],[1,1,1,4]]) {
          actual.userData.setTint(tint); expected.userData.setTint(tint);
          expect(actual.userData.lightEmitter).toEqual(expected.userData.lightEmitter);
          actual.children.forEach((mesh,i)=>{
            expect(mesh.material).toBe(identities[i][0]);expect(mesh.geometry).toBe(identities[i][1]);
            expect(mesh.material.emissive).toEqual(expected.children[i].material.emissive);
            expect(Object.is(mesh.material.emissiveIntensity,expected.children[i].material.emissiveIntensity)).toBe(true);
          });
        }
      }
    } finally { actual.dispose(); expected.dispose(); }
  }
});
it('rejects an oversized emission count without writes and retains independently owned plans', () => {
  const shelf=needRustShelf(), marker=scratch();marker.fill(123.5);
  expect(Number.isNaN(core.lamp_emission_power(scratchPointer,5,.5))).toBe(true);
  expect(core.lamp_emission_tint(scratchPointer,5,1,1,1)).toBe(0);
  expect(Array.from(marker)).toEqual(new Array(16).fill(123.5));
  const plan=shelf.lamp_material_layout(1,false,.5), snapshot=plan.slice();
  shelf.lamp_material_layout(2,true,2);
  expect(plan).toEqual(snapshot); expect(plan[0]).toBe(72);expect(plan[2]).toBe(.08);
});

it('reacquires the shared emission arena after decor memory grows', () => {
  const actual=createShelfLamp({lampId:'tripod',quality:'low'}), expected=original({lampId:'tripod',quality:'low'});
  try {
    actual.userData.setPower(.7);expected.userData.setPower(.7);core.memory.grow(1);
    actual.userData.setPower(.25);expected.userData.setPower(.25);
    actual.userData.setTint([.8,1.1,.2]);expected.userData.setTint([.8,1.1,.2]);
    actual.children.forEach((mesh,i)=>{
      expect(mesh.material.emissive).toEqual(expected.children[i].material.emissive);
      expect(mesh.material.emissiveIntensity).toEqual(expected.children[i].material.emissiveIntensity);
    });
  } finally {actual.dispose();expected.dispose();}
});
