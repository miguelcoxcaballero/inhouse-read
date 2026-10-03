import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import * as THREE from 'three';

let createShelfPlant, jobs, models;
const entry = { catalogId:'nephrolepis', potId:'muskot', height:130, seed:'quality-reuse' };
const plant = (options = {}) => { const model = createShelfPlant({ ...entry, ...options }); models.push(model); return model; };
const finishSurfaces = async () => {
  while (jobs.length) jobs.shift()({ timeRemaining:() => 100 });
  await Promise.resolve();
};
const meshes = model => { const result = []; model.traverse(object => { if (object.geometry && object.material) result.push(object); }); return result; };
const shape = model => meshes(model).map(mesh => {
  const hash = createHash('sha256');
  for (const attribute of [mesh.geometry.index, ...Object.values(mesh.geometry.attributes)].filter(Boolean))
    hash.update(new Uint8Array(attribute.array.buffer, attribute.array.byteOffset, attribute.array.byteLength));
  return { name:mesh.name, hash:hash.digest('hex'), matrix:mesh.matrix.toArray(), world:mesh.matrixWorld.toArray() };
});
const maps = model => [...new Set(meshes(model).flatMap(mesh => ['map','bumpMap','roughnessMap'].map(key => mesh.material[key]).filter(Boolean)))];

beforeEach(async () => {
  vi.resetModules(); jobs = []; models = [];
  vi.stubGlobal('requestIdleCallback', callback => { jobs.push(callback); return jobs.length; });
  ({ createShelfPlant } = await import('../../src/js/shelf-plants.js'));
});
afterEach(async () => {
  for (const model of models) model.userData.dispose();
  await finishSurfaces();
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});

describe('plant inspection surface quality without rebuilding geometry', () => {
  it('retains every mesh, vertex, normal, material and transform through a full detail upgrade and downgrade', async () => {
    const model = plant(); await finishSurfaces(); model.updateMatrixWorld(true);
    const objects = meshes(model), originalShape = shape(model), materials = objects.map(mesh => mesh.material);
    const geometries = objects.map(mesh => mesh.geometry), dispose = geometries.map(geometry => vi.spyOn(geometry,'dispose'));
    const versions = materials.map(material => material.version), oldMaps = maps(model);
    const oldDisposal = oldMaps.map(map => vi.spyOn(map,'dispose'));
    for (const map of oldMaps) map.anisotropy = 16;
    const potMap = model.getObjectByName('ceramic-pot').material.map;
    const repeat = potMap.repeat.toArray(), offset = potMap.offset.toArray();
    const plan = model.userData.prepareSurfaceQuality(256);
    expect(plan.apply()).toBe(false);
    expect(maps(model)).toEqual(oldMaps);
    expect(model.userData.inspectionResolution).toBe(0);
    await finishSurfaces(); expect(await plan.ready).toBe(true);
    expect(plan.apply()).toBe(true);
    expect(model.userData.inspectionResolution).toBe(256);
    expect(model.getObjectByName('ceramic-pot').material.map.image).toMatchObject({ width:256, height:512 });
    expect(model.getObjectByName('leaf-0').material.map.image).toMatchObject({ width:256, height:256 });
    expect(model.getObjectByName('potting-soil').material.map.image).toMatchObject({ width:256, height:256 });
    expect(model.getObjectByName('ceramic-pot').material.map.repeat.toArray()).toEqual(repeat);
    expect(model.getObjectByName('ceramic-pot').material.map.offset.toArray()).toEqual(offset);
    expect(maps(model).every(map => map.anisotropy === 16)).toBe(true);
    expect(meshes(model)).toEqual(objects);
    expect(objects.map(mesh => mesh.geometry)).toEqual(geometries);
    expect(objects.map(mesh => mesh.material)).toEqual(materials);
    expect(materials.map(material => material.version)).toEqual(versions);
    expect(shape(model)).toEqual(originalShape);
    for (const spy of dispose) expect(spy).not.toHaveBeenCalled();
    for (const spy of oldDisposal) expect(spy).toHaveBeenCalledTimes(1);
    const detailMaps = maps(model), detailDisposal = detailMaps.map(map => vi.spyOn(map,'dispose'));
    plan.dispose(); plan.dispose(); expect(plan.apply()).toBe(false);
    for (const spy of detailDisposal) expect(spy).not.toHaveBeenCalled();
    const down = model.userData.prepareSurfaceQuality(0); await finishSurfaces();
    expect(await down.ready).toBe(true); expect(down.apply()).toBe(true);
    expect(model.getObjectByName('ceramic-pot').material.map.image).toMatchObject({ width:128, height:256 });
    expect(shape(model)).toEqual(originalShape);
    for (const spy of detailDisposal) expect(spy).toHaveBeenCalledTimes(1);
    model.userData.dispose(); model.userData.dispose();
    for (const spy of dispose) expect(spy).toHaveBeenCalledTimes(1);
    for (const spy of oldDisposal) expect(spy).toHaveBeenCalledTimes(1);
  });

  it.each(['monstera','hedera','sansevieria','nephrolepis','chamaedorea','zamioculcas','succulent','cactus'])('uses the exact original high resolution artwork for %s', async catalogId => {
    const model = plant({ catalogId }), reference = plant({ catalogId, inspectionResolution:256 });
    const plan = model.userData.prepareSurfaceQuality(256); await finishSurfaces(); await plan.ready;
    expect(plan.apply()).toBe(true);
    const actual = maps(model), expected = maps(reference);
    expect(actual.length).toBe(expected.length);
    actual.forEach((map, index) => {
      expect(map.source === expected[index].source, `shared source ${index}`).toBe(true);
      expect(createHash('sha256').update(map.image.data).digest('hex')).toBe(createHash('sha256').update(expected[index].image.data).digest('hex'));
      expect(map.image.width).toBe(expected[index].image.width);
      expect(map.image.height).toBe(expected[index].image.height);
      expect(map.repeat.toArray()).toEqual(expected[index].repeat.toArray());
      expect(map.offset.toArray()).toEqual(expected[index].offset.toArray());
      expect(map.colorSpace).toBe(expected[index].colorSpace);
      expect(map.minFilter).toBe(expected[index].minFilter);
      expect(map.generateMipmaps).toBe(expected[index].generateMipmaps);
    });
    model.updateMatrixWorld(true); reference.updateMatrixWorld(true);
    expect(shape(model)).toEqual(shape(reference));
  });

  it('disposes cancelled pending maps once and never replaces visible maps with an obsolete request', async () => {
    const model = plant(), original = maps(model); await finishSurfaces();
    const clone = vi.spyOn(THREE.Texture.prototype,'clone');
    const stale = model.userData.prepareSurfaceQuality(256);
    const provisional = clone.mock.results.map(result => result.value);
    const disposed = provisional.map(map => vi.spyOn(map,'dispose'));
    const versions = provisional.map(map => map.version);
    stale.dispose(); stale.dispose();
    for (const spy of disposed) expect(spy).toHaveBeenCalledTimes(1);
    await finishSurfaces(); expect(await stale.ready).toBe(false); expect(stale.apply()).toBe(false);
    expect(provisional.map(map => map.version)).toEqual(versions);
    expect(maps(model)).toEqual(original);
    const latest = model.userData.prepareSurfaceQuality(256); await finishSurfaces();
    expect(await latest.ready).toBe(true); expect(latest.apply()).toBe(true);
    expect(stale.apply()).toBe(false);
    for (const spy of disposed) expect(spy).toHaveBeenCalledTimes(1);
  });

  it('supersedes pending preparation and releases its maps on deep disposal', async () => {
    const model = plant(); await finishSurfaces();
    const clone = vi.spyOn(THREE.Texture.prototype,'clone');
    const first = model.userData.prepareSurfaceQuality(256);
    const firstTextures = clone.mock.results.map(result => result.value), firstDisposal = firstTextures.map(map => vi.spyOn(map,'dispose'));
    clone.mockClear();
    const second = model.userData.prepareSurfaceQuality(0);
    const secondDisposal = clone.mock.results.map(result => vi.spyOn(result.value,'dispose'));
    for (const spy of firstDisposal) expect(spy).toHaveBeenCalledTimes(1);
    model.userData.dispose(); model.userData.dispose();
    await finishSurfaces();
    expect(await first.ready).toBe(false); expect(await second.ready).toBe(false);
    expect(first.apply()).toBe(false); expect(second.apply()).toBe(false);
    for (const spy of [...firstDisposal,...secondDisposal]) expect(spy).toHaveBeenCalledTimes(1);
  });
});
