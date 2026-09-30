import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { PLANT_CATALOG, POT_CATALOG, getCatalogPlant, getCatalogPot } from '../../src/js/plant-catalog-data.js';
import { createShelfPlant } from '../../src/js/shelf-plants.js';

// Each case builds whole detailed plants; a loaded CI machine needs more than 5 s.
vi.setConfig({ testTimeout:20000 });

function statistics(model) {
  let triangles = 0, draws = 0;
  model.traverse(object => {
    if (object.isMesh || object.isLineSegments) draws++;
    if (object.isMesh) triangles += (object.geometry.index?.count ?? object.geometry.attributes.position.count) / 3;
  });
  return { triangles,draws };
}

describe('IKEA referenced plant catalog', () => {
  it('defines eight distinct species and four independently selectable pots with product references', () => {
    expect(PLANT_CATALOG).toHaveLength(8); expect(POT_CATALOG).toHaveLength(4);
    expect(new Set(PLANT_CATALOG.map(item => item.id)).size).toBe(8);
    expect(new Set(POT_CATALOG.map(item => item.id)).size).toBe(4);
    for (const item of PLANT_CATALOG) {
      expect(getCatalogPlant(item.id)).toBe(item); expect(getCatalogPot(item.defaultPotId)).not.toBeNull();
      expect(item.referenceUrl).toMatch(/^https:\/\/www\.ikea\.com\/es\/es\/p\//);
      expect(item.width).toBeGreaterThan(45); expect(item.height).toBeLessThanOrEqual(140);
      expect(Object.isFrozen(item)).toBe(true);
    }
    for (const item of POT_CATALOG) expect(new URL(item.referenceUrl).hostname).toMatch(/^www\.ikea\.com(?:\.tr)?$/);
    expect(getCatalogPlant('missing')).toBeNull(); expect(getCatalogPot('missing')).toBeNull();
  });

  for (const species of PLANT_CATALOG) for (const pot of POT_CATALOG) {
    it(`${species.id} / ${pot.id} keeps detailed geometry within the mobile budget and saved collision dimensions`, () => {
      const model = createShelfPlant({ catalogId:species.id,potId:pot.id,seed:'ikea:model:fixture' });
      const box = new THREE.Box3().setFromObject(model), counts = statistics(model);
      expect(model.userData.catalogId).toBe(species.id); expect(model.userData.potId).toBe(pot.id);
      expect(box.min.y).toBeCloseTo(-species.height/2,4); expect(box.max.y).toBeCloseTo(species.height/2,4);
      expect(Math.max(Math.abs(box.min.x),Math.abs(box.max.x))).toBeLessThanOrEqual(species.width/2+.0001);
      expect(Math.max(Math.abs(box.min.z),Math.abs(box.max.z))).toBeLessThanOrEqual(species.width*.35+.0001);
      expect(counts.triangles).toBeGreaterThan(3000); expect(counts.triangles).toBeLessThan(14000);
      expect(counts.draws).toBeLessThanOrEqual(8);
      expect(model.getObjectByName('ceramic-pot').geometry.type).toBe('LatheGeometry');
      model.traverse(object => {
        if (!object.isMesh) return;
        expect(object.castShadow).toBe(true); expect(object.receiveShadow).toBe(true);
        for (const value of object.geometry.attributes.position.array) expect(Number.isFinite(value)).toBe(true);
      });
      model.userData.dispose();
    });
  }

  it('builds species specific branch structures, lobed ivy, real fern pinnae and thick leaves', () => {
    const expectedParts = {
      chamaedorea:['palm-rachis-',230], nephrolepis:['fern-rachis-',666],
      hedera:['ivy-vine-',108], zamioculcas:['zamioculcas-stem-',66],
    };
    for (const [catalogId,[stemPrefix,leafCount]] of Object.entries(expectedParts)) {
      const model = createShelfPlant({catalogId,seed:'botanical-detail'});
      expect(model.userData.parts.some(name => name.startsWith(stemPrefix))).toBe(true);
      expect(model.userData.parts.filter(name => /^leaf-\d+$/.test(name))).toHaveLength(leafCount);
      const leaf = model.getObjectByName('leaf-0'), geometry = leaf.geometry;
      geometry.computeBoundingBox();
      expect(geometry.boundingBox.max.z - geometry.boundingBox.min.z).toBeGreaterThan(.02);
      expect(leaf.material.map.image.width).toBe(128);
      expect(leaf.material.alphaTest).toBe(0);
      if (catalogId === 'hedera') {
        const ys = [...geometry.attributes.position.array].filter((_,index) => index % 3 === 1);
        expect(new Set(ys).size).toBeGreaterThan(10);
      }
      model.userData.dispose();
    }
  });

  it('uses opaque own leaf textures for every catalog species, keeping whole plant atlas cutouts out of the leaves', () => {
    const atlas = new THREE.Texture();
    for (const item of PLANT_CATALOG.filter(item => item.id !== 'cactus')) {
      const model = createShelfPlant({catalogId:item.id},{leafTexture:atlas});
      const leaf = model.getObjectByName('leaf-0');
      expect(leaf.material.map).not.toBe(atlas);
      expect(leaf.material.map.image.width).toBe(128);
      expect(leaf.material.alphaTest).toBe(0);
      expect(leaf.material.alphaToCoverage).toBe(false);
      model.userData.dispose();
    }
  });

  it('has heart shaped Monstera fenestrations, broad sword leaves and a layered succulent rosette', () => {
    const monstera = createShelfPlant({catalogId:'monstera'}), snake = createShelfPlant({catalogId:'sansevieria'}), rosette = createShelfPlant({catalogId:'succulent'});
    expect(monstera.getObjectByName('leaf-0').geometry.userData.fenestrations).toBe(4);
    const sword = snake.getObjectByName('leaf-0').geometry; sword.computeBoundingBox();
    expect(sword.boundingBox.max.x - sword.boundingBox.min.x).toBeGreaterThan(12);
    expect(rosette.userData.parts.filter(name => /^leaf-\d+$/.test(name))).toHaveLength(27);
    for (const model of [monstera,snake,rosette]) model.userData.dispose();
  });

  it('keeps the pot form and material properties distinct instead of recoloring one generic pot', () => {
    const models = POT_CATALOG.map(pot => createShelfPlant({catalogId:'monstera',potId:pot.id,seed:'same-seed'}));
    const pots = models.map(model => model.getObjectByName('ceramic-pot'));
    expect(new Set(pots.map(pot => [...pot.geometry.attributes.position.array].join(','))).size).toBe(4);
    expect(pots[0].material.clearcoat).toBeGreaterThan(.2);
    expect(pots[1].material.roughness).toBeGreaterThan(.9);
    expect(models[1].userData.parts).toContain('terracotta-saucer');
    expect(pots[2].material.metalness).toBeGreaterThan(.8);
    expect(models[2].userData.parts).toContain('steel-folded-seam');
    const positions = pots[3].geometry.attributes.position;
    const n = pots[3].geometry.parameters.points.length, outerRow = 5;
    const radius = segment => Math.hypot(positions.getX(segment*n+outerRow),positions.getZ(segment*n+outerRow));
    expect(Math.abs(radius(0)-radius(1))).toBeGreaterThan(.1);
    for (const model of models) model.userData.dispose();
  });

  it('disposes every merged resource exactly once and never disposes the shared atlas', () => {
    const atlas = new THREE.Texture(), sharedDispose = vi.spyOn(atlas,'dispose');
    for (const item of PLANT_CATALOG) {
      const model = createShelfPlant({catalogId:item.id},{leafTexture:atlas});
      const resources = new Set();
      model.traverse(object => {
        if (!object.geometry) return;
        resources.add(object.geometry); resources.add(object.material);
        for (const key of ['map','roughnessMap','bumpMap']) if (object.material[key] && object.material[key] !== atlas) resources.add(object.material[key]);
      });
      const disposals = [...resources].map(resource => vi.spyOn(resource,'dispose'));
      model.userData.dispose(); model.userData.dispose();
      for (const disposal of disposals) expect(disposal).toHaveBeenCalledTimes(1);
    }
    expect(sharedDispose).not.toHaveBeenCalled();
  });
});
