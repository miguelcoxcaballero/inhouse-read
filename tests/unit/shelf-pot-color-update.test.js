import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { POT_CATALOG, getPotColors } from '../../src/js/plant-catalog-data.js';

let createShelfPlant, jobs, models;
const entry = { catalogId:'succulent', potId:'muskot', seed:'pot-color-fixture' };
const make = (options = {}) => {
  const model = createShelfPlant({ ...entry, ...options }); models.push(model); return model;
};
const finish = async () => {
  while (jobs.length) jobs.shift()({ timeRemaining:() => 100 });
  await Promise.resolve();
};
const pot = model => model.getObjectByName('ceramic-pot');
const meshes = model => {
  const result = []; model.traverse(object => { if (object.isMesh) result.push(object); }); return result;
};
const digest = data => createHash('sha256').update(new Uint8Array(data.buffer, data.byteOffset, data.byteLength)).digest('hex');
const geometry = model => meshes(model).map(object => ({
  name:object.name, index:object.geometry.index && digest(object.geometry.index.array),
  attributes:Object.fromEntries(Object.entries(object.geometry.attributes).map(([name, attribute]) => [name,digest(attribute.array)])),
  matrix:object.matrix.toArray(), matrixWorld:object.matrixWorld.toArray(),
  castShadow:object.castShadow, receiveShadow:object.receiveShadow
}));
const mapProperties = map => ({
  offset:map.offset.toArray(), repeat:map.repeat.toArray(), center:map.center.toArray(), rotation:map.rotation,
  matrix:map.matrix.toArray(), matrixAutoUpdate:map.matrixAutoUpdate, width:map.image.width, height:map.image.height,
  ...Object.fromEntries(['colorSpace','generateMipmaps','wrapS','wrapT','magFilter','minFilter','anisotropy','channel','flipY','premultiplyAlpha','unpackAlignment'].map(name => [name,map[name]]))
});
const paletteCases = POT_CATALOG.flatMap(item => getPotColors(item.id).flatMap(color => [0,256].map(resolution => [item.id,color.id,resolution])));

beforeEach(async () => {
  vi.resetModules(); jobs = []; models = [];
  vi.stubGlobal('requestIdleCallback', callback => { jobs.push(callback); return jobs.length; });
  ({ createShelfPlant } = await import('../../src/js/shelf-plants.js'));
});
afterEach(async () => {
  for (const model of models) model.userData.dispose();
  await finish(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});

describe('pot palette changes on the existing botanical model', () => {
  it.each(paletteCases)('%s / %s at detail %s uses the original painter pair without changing geometry or finish', async (potId,potColorId,inspectionResolution) => {
    const colors = getPotColors(potId), first = colors.find(color => color.id !== potColorId);
    const model = make({ potId,potColorId:first.id,inspectionResolution });
    const fresh = make({ potId,potColorId,inspectionResolution });
    await finish(); model.updateMatrixWorld(true); fresh.updateMatrixWorld(true);
    const objects = meshes(model), geometries = objects.map(object => object.geometry), materials = objects.map(object => object.material);
    const before = geometry(model), versions = materials.map(material => material.version);
    const soil = model.getObjectByName('potting-soil').material.map;
    const leaf = model.getObjectByName('leaf-0').material.map;
    const initialPair = [pot(model).material.map,pot(model).material.bumpMap];
    const disposal = initialPair.map(map => vi.spyOn(map,'dispose'));
    expect(typeof model.userData.updatePotColor).toBe('function');
    expect(model.userData.updatePotColor(potColorId)).toBe(true);
    await finish();
    const actual = pot(model).material, expected = pot(fresh).material;
    expect(model.userData.potColorId).toBe(potColorId);
    expect(model.userData.inspectionResolution).toBe(inspectionResolution);
    expect(actual.roughnessMap).toBe(actual.bumpMap);
    for (const name of ['map','bumpMap']) {
      expect(actual[name].source).toBe(expected[name].source);
      expect(digest(actual[name].image.data)).toBe(digest(expected[name].image.data));
      expect(mapProperties(actual[name])).toEqual(mapProperties(expected[name]));
    }
    for (const name of ['roughness','metalness','clearcoat','clearcoatRoughness','bumpScale','vertexColors']) expect(actual[name]).toBe(expected[name]);
    expect(meshes(model)).toEqual(objects);
    expect(objects.map(object => object.geometry)).toEqual(geometries);
    expect(objects.map(object => object.material)).toEqual(materials);
    expect(materials.map(material => material.version)).toEqual(versions);
    expect(geometry(model)).toEqual(before);
    expect(geometry(model)).toEqual(geometry(fresh));
    expect(model.getObjectByName('potting-soil').material.map).toBe(soil);
    expect(model.getObjectByName('leaf-0').material.map).toBe(leaf);
    for (const spy of disposal) expect(spy).toHaveBeenCalledTimes(1);
    if (potId === 'muskotblomma') expect(model.getObjectByName('terracotta-saucer')?.material || model.getObjectByName('terracotta-batch')?.material).toBe(actual);
    if (potId === 'akerbar') expect(model.getObjectByName('steel-folded-seam')?.material).toBe(actual);
  });

  it('retains all 666 fern leaves, merged buffers, materials, shadows and transforms through repeated colors', async () => {
    const model = make({ catalogId:'nephrolepis',potId:'akerbar',seed:'fern-color-retained' }); await finish();
    model.updateMatrixWorld(true);
    expect(model.userData.parts.filter(name => /^leaf-\d+$/.test(name))).toHaveLength(666);
    expect(model.userData.parts.filter(name => name.startsWith('fern-rachis-'))).toHaveLength(18);
    const objects = meshes(model), before = geometry(model), materials = objects.map(object => object.material);
    const geometries = objects.map(object => object.geometry), releases = [...new Set([...materials,...geometries])].map(resource => vi.spyOn(resource,'dispose'));
    for (const color of getPotColors('akerbar')) { expect(model.userData.updatePotColor(color.id)).toBe(true); await finish(); }
    expect(meshes(model)).toEqual(objects); expect(geometry(model)).toEqual(before);
    expect(objects.map(object => object.material)).toEqual(materials);
    expect(objects.map(object => object.geometry)).toEqual(geometries);
    for (const release of releases) expect(release).not.toHaveBeenCalled();
  });

  it('does no work for the same normalized color and rejects updates after disposal', async () => {
    const model = make({ potColorId:'ivory' }); await finish();
    const pair = [pot(model).material.map,pot(model).material.bumpMap], clone = vi.spyOn(THREE.Texture.prototype,'clone');
    const invalidate = vi.fn(); model.userData.invalidate = invalidate;
    expect(model.userData.updatePotColor('ivory')).toBe(true);
    expect(model.userData.updatePotColor('not-in-the-palette')).toBe(true);
    expect(clone).not.toHaveBeenCalled(); expect(invalidate).not.toHaveBeenCalled();
    expect([pot(model).material.map,pot(model).material.bumpMap]).toEqual(pair);
    model.userData.dispose(); expect(model.userData.updatePotColor('blue')).toBe(false);
    expect(clone).not.toHaveBeenCalled();
  });

  it('copies UV placement, sampling, unpack flags and anisotropy independently for both maps', async () => {
    const model = make({ inspectionResolution:256 }); await finish();
    const material = pot(model).material;
    for (const [index,map] of [material.map,material.bumpMap].entries()) {
      map.offset.set(.17 + index*.1,.23); map.repeat.set(3 + index,1.8); map.center.set(.31,.42);
      map.rotation=.19 + index*.03; map.updateMatrix(); map.matrixAutoUpdate=false;
      map.wrapT=THREE.MirroredRepeatWrapping; map.anisotropy=16 - index; map.channel=1;
      map.flipY=true; map.premultiplyAlpha=true; map.unpackAlignment=8;
    }
    const before = [material.map,material.bumpMap].map(mapProperties);
    expect(model.userData.updatePotColor('blue')).toBe(true); await finish();
    expect([material.map,material.bumpMap].map(mapProperties)).toEqual(before);
    expect(material.map.image).toMatchObject({ width:256,height:512 });
    expect(material.bumpMap.image).toMatchObject({ width:256,height:512 });
  });

  it('supersedes a prepared old-color upgrade and future quality preparation uses the last palette', async () => {
    const model = make(); await finish(); const clone = vi.spyOn(THREE.Texture.prototype,'clone');
    const old = model.userData.prepareSurfaceQuality(256);
    const oldMaps = clone.mock.results.map(result => result.value), release = oldMaps.map(map => vi.spyOn(map,'dispose'));
    expect(model.userData.updatePotColor('sage')).toBe(true);
    expect(model.userData.updatePotColor('charcoal')).toBe(true);
    await finish(); expect(await old.ready).toBe(false); expect(old.apply()).toBe(false);
    for (const spy of release) expect(spy).toHaveBeenCalledTimes(1);
    expect(model.userData.potColorId).toBe('charcoal'); expect(model.userData.inspectionResolution).toBe(0);
    const next = model.userData.prepareSurfaceQuality(256), fresh = make({ potColorId:'charcoal',inspectionResolution:256 });
    await finish(); expect(await next.ready).toBe(true); expect(next.apply()).toBe(true);
    for (const name of ['map','bumpMap']) expect(digest(pot(model).material[name].image.data)).toBe(digest(pot(fresh).material[name].image.data));
    expect(model.userData.inspectionResolution).toBe(256);
  });

  it('cancels an old-color downgrade while retaining detail and then downgrades the new color exactly', async () => {
    const model = make({ inspectionResolution:256 }); await finish();
    const old = model.userData.prepareSurfaceQuality(0);
    expect(model.userData.updatePotColor('blue')).toBe(true); await finish();
    expect(await old.ready).toBe(false); expect(old.apply()).toBe(false);
    expect(pot(model).material.map.image.width).toBe(256);
    const next = model.userData.prepareSurfaceQuality(0), fresh = make({ potColorId:'blue' });
    await finish(); expect(await next.ready).toBe(true); expect(next.apply()).toBe(true);
    expect(model.userData.potColorId).toBe('blue'); expect(pot(model).material.map.image.width).toBe(128);
    expect(digest(pot(model).material.map.image.data)).toBe(digest(pot(fresh).material.map.image.data));
  });

  it('releases every replaced pair exactly once and deep disposal owns only the current pair', async () => {
    const model = make(); await finish(); const resources = [];
    const observe = () => { for (const map of [pot(model).material.map,pot(model).material.bumpMap]) resources.push({ map,dispose:vi.spyOn(map,'dispose') }); };
    observe();
    for (const colorId of ['sage','blue','charcoal']) { expect(model.userData.updatePotColor(colorId)).toBe(true); observe(); }
    const current = resources.slice(-2), released = resources.slice(0,-2);
    for (const {dispose} of released) expect(dispose).toHaveBeenCalledTimes(1);
    for (const {dispose} of current) expect(dispose).not.toHaveBeenCalled();
    const versions = current.map(({map}) => map.version), invalidation = vi.fn(); model.userData.invalidate=invalidation;
    model.userData.dispose(); model.userData.dispose(); await finish();
    for (const {dispose} of resources) expect(dispose).toHaveBeenCalledTimes(1);
    expect(current.map(({map}) => map.version)).toEqual(versions);
    expect(invalidation).not.toHaveBeenCalled();
  });

  it('keeps another model and the shared procedural source alive when the former clone is replaced', async () => {
    const a = make(), b = make(); await finish();
    const source = pot(b).material.map.source, map = pot(b).material.map, dispose = vi.spyOn(map,'dispose');
    expect(pot(a).material.map.source).toBe(source);
    expect(a.userData.updatePotColor('sage')).toBe(true); a.userData.dispose(); await finish();
    expect(pot(b).material.map).toBe(map); expect(pot(b).material.map.source).toBe(source);
    expect(dispose).not.toHaveBeenCalled();
    const fresh = make(); await finish(); expect(pot(fresh).material.map.source).toBe(source);
    expect(digest(map.image.data)).toBe(digest(pot(fresh).material.map.image.data));
  });
});
