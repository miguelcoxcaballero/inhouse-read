import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { createShelfPlant } from '../../src/js/shelf-plants.js';

function triangleCount(group) {
  let count = 0;
  group.traverse(object => { if (object.isMesh) count += (object.geometry.index?.count ?? object.geometry.attributes.position.count) / 3; });
  return count;
}

describe('botanical shelf models', () => {
  for (const variant of ['upright','sansevieria','cactus','succulent','suculenta','leafy','pothos','monstera']) {
    it(`${variant} fits its collision envelope and mobile geometry budget`, () => {
      const plant = createShelfPlant({ width:42, height:67, variant, seed:'botanical-fixture' });
      const bounds = new THREE.Box3().setFromObject(plant);
      expect(bounds.min.y).toBeCloseTo(-33.5, 4);
      expect(bounds.max.y).toBeCloseTo(33.5, 4);
      expect(Math.max(Math.abs(bounds.min.x), Math.abs(bounds.max.x))).toBeLessThanOrEqual(21.0001);
      expect(Math.max(Math.abs(bounds.min.z), Math.abs(bounds.max.z))).toBeLessThanOrEqual(14.7001);
      expect(triangleCount(plant)).toBeGreaterThan(1700);
      expect(triangleCount(plant)).toBeLessThan(5000);
      expect(plant.getObjectByName('ceramic-pot').geometry.type).toBe('LatheGeometry');
      plant.traverse(object => { if (object.isMesh) { expect(object.castShadow).toBe(true); expect(object.receiveShadow).toBe(true); } });
      plant.userData.dispose();
    });
  }

  it('has stable leaf geometry for a saved seed and different silhouettes for other seeds', () => {
    const a = createShelfPlant({ width:46,height:72,variant:'pothos',seed:'plant:3' });
    const b = createShelfPlant({ width:46,height:72,variant:'pothos',seed:'plant:3' });
    const c = createShelfPlant({ width:46,height:72,variant:'pothos',seed:'plant:4' });
    expect([...a.getObjectByName('leaf-0').geometry.attributes.position.array]).toEqual([...b.getObjectByName('leaf-0').geometry.attributes.position.array]);
    expect([...a.getObjectByName('leaf-0').geometry.attributes.position.array]).not.toEqual([...c.getObjectByName('leaf-0').geometry.attributes.position.array]);
    for (const model of [a,b,c]) model.userData.dispose();
  });

  it('samples each leaf from its own inset atlas quadrant', () => {
    const atlas = new THREE.Texture();
    for (const [variant,u,v] of [['upright',0,.5],['leafy',.5,.5],['succulent',0,0],['monstera',.5,0]]) {
      const plant = createShelfPlant({ width:46,height:72,variant }, { leafTexture:atlas });
      const leaf = plant.getObjectByName('leaf-0');
      expect(leaf.material.map).toBe(atlas);
      const values = leaf.geometry.attributes.uv.array;
      for (let i = 0; i < values.length; i += 2) {
        expect(values[i]).toBeGreaterThan(u); expect(values[i]).toBeLessThan(u+.5);
        expect(values[i+1]).toBeGreaterThan(v); expect(values[i+1]).toBeLessThan(v+.5);
      }
      plant.userData.dispose();
    }
  });

  it('disposes owned geometry, materials and procedural maps exactly once, preserving the shared atlas', () => {
    const atlas = new THREE.Texture(), atlasDispose = vi.spyOn(atlas,'dispose');
    const plant = createShelfPlant({ width:46,height:72,variant:'monstera' }, { leafTexture:atlas });
    const pot = plant.getObjectByName('ceramic-pot');
    const geometryDispose = vi.spyOn(pot.geometry,'dispose'), materialDispose = vi.spyOn(pot.material,'dispose'), mapDispose = vi.spyOn(pot.material.map,'dispose');
    plant.userData.dispose(); plant.userData.dispose();
    expect(geometryDispose).toHaveBeenCalledTimes(1); expect(materialDispose).toHaveBeenCalledTimes(1); expect(mapDispose).toHaveBeenCalledTimes(1);
    expect(atlasDispose).not.toHaveBeenCalled();
  });
});
