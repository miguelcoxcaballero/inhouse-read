import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { createShelfPlant } from '../../src/js/shelf-plants.js';

function triangleCount(group) {
  let count = 0;
  group.traverse(object => { if (object.isMesh) count += (object.geometry.index?.count ?? object.geometry.attributes.position.count) / 3; });
  return count;
}

describe('botanical shelf models', () => {
  it('upgrades plant and pot maps for inspection while sharing geometry proportions', () => {
    const entry = {catalogId:'monstera',variant:'monstera',potId:'muskot',width:70,height:100,seed:'detail-test'};
    const shelf = createShelfPlant(entry), detail = createShelfPlant({...entry,inspectionResolution:256});
    expect(detail.getObjectByName('ceramic-pot').material.map.image).toMatchObject({width:256,height:512});
    expect(shelf.getObjectByName('ceramic-pot').material.map.image).toMatchObject({width:128,height:256});
    const a = new THREE.Box3().setFromObject(shelf), b = new THREE.Box3().setFromObject(detail);
    expect(a.min.distanceTo(b.min)).toBe(0); expect(a.max.distanceTo(b.max)).toBe(0);
    shelf.userData.dispose(); detail.userData.dispose();
  });

  for (const variant of ['upright','sansevieria','cactus','succulent','suculenta','leafy','pothos','monstera']) {
    it(`${variant} fits its collision envelope and mobile geometry budget`, () => {
      const plant = createShelfPlant({ width:42, height:67, variant, seed:'botanical-fixture' });
      const bounds = new THREE.Box3().setFromObject(plant);
      expect(bounds.min.y).toBeCloseTo(-33.5, 4);
      expect(bounds.max.y).toBeCloseTo(33.5, 4);
      expect(Math.max(Math.abs(bounds.min.x), Math.abs(bounds.max.x))).toBeLessThanOrEqual(21.0001);
      expect(Math.max(Math.abs(bounds.min.z), Math.abs(bounds.max.z))).toBeLessThanOrEqual(14.7001);
      expect(triangleCount(plant)).toBeGreaterThan(3000);
      expect(triangleCount(plant)).toBeLessThan(14000);
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

  it('upgrades legacy variants to current catalog geometry and rejects the old plant photo atlas', () => {
    const atlas = new THREE.Texture();
    for (const [variant,catalogId] of [['upright','sansevieria'],['sansevieria','sansevieria'],['leafy','hedera'],
      ['pothos','hedera'],['succulent','succulent'],['suculenta','succulent'],['monstera','monstera'],
      ['palm','chamaedorea'],['fern','nephrolepis'],['ivy','hedera'],['zz','zamioculcas'],['unknown','monstera']]) {
      const plant = createShelfPlant({ width:46,height:72,variant }, { leafTexture:atlas });
      const leaf = plant.getObjectByName('leaf-0');
      expect(plant.userData.catalogId).toBe(catalogId);
      expect(plant.userData.potId).not.toBeNull();
      expect(plant.userData.atlasQuadrant).toBeUndefined();
      expect(leaf.material.map).not.toBe(atlas);
      expect(leaf.material.map.image.width).toBe(128);
      expect(leaf.material.alphaTest).toBe(0);
      expect(leaf.material.alphaToCoverage).toBe(false);
      expect([...leaf.geometry.attributes.uv.array].every(Number.isFinite)).toBe(true);
      plant.userData.dispose();
    }
  });

  it('shares one texture upload between identical pots and refines it once, after the build', async () => {
    // A fresh module, so no surface has been painted by an earlier test.
    vi.resetModules();
    const { createShelfPlant, plantSurfacesReady } = await import('../../src/js/shelf-plants.js');
    const entry = seed => ({ catalogId:'hedera', potId:'gradvis', width:48, height:106, seed });
    const a = createShelfPlant(entry('share:a')), redraw = vi.fn(), gone = vi.fn();
    a.userData.invalidate = redraw;
    const map = a.getObjectByName('ceramic-pot').material.map, version = map.source.version, texture = map.version;
    const b = createShelfPlant(entry('share:b')), c = createShelfPlant(entry('share:c'));
    c.userData.invalidate = gone; c.userData.dispose();
    const other = b.getObjectByName('ceramic-pot').material.map;
    // A clone must not raise the shared Source's version, or every plant re-uploads it.
    expect(other.source).toBe(map.source);
    expect(map.source.version).toBe(version);
    await plantSurfacesReady();
    expect(map.source.version).toBe(version + 1);
    expect(map.version).toBe(texture + 1);
    expect(redraw).toHaveBeenCalled(); expect(gone).not.toHaveBeenCalled();
    const d = createShelfPlant(entry('share:d'));
    expect(d.getObjectByName('ceramic-pot').material.map.source.version).toBe(version + 1);
    for (const model of [a,b,d]) model.userData.dispose();
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
