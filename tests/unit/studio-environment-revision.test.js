import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';

const wait = () => new Promise(resolve => setTimeout(resolve, 60));
const database = () => new Promise((resolve, reject) => {
  const request = indexedDB.open('inhouse-read-studio', 1);
  request.onupgradeneeded = () => request.result.createObjectStore('atlas');
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});
async function stored() {
  const db = await database();
  try { return await new Promise(resolve => {
    const request = db.transaction('atlas').objectStore('atlas').get('studio');
    request.onsuccess = () => resolve(request.result);
  }); } finally { db.close(); }
}
const start = async revision => {
  vi.stubGlobal('__STUDIO_ENVIRONMENT_VERSION__', revision);
  vi.resetModules();
  const cache = await import('../../src/js/studio-environment-cache.js');
  await wait();
  return cache;
};
async function bake(cache) {
  const target = new THREE.WebGLRenderTarget(4, 4, { type:THREE.HalfFloatType, format:THREE.RGBAFormat });
  target.texture.mapping = THREE.CubeUVReflectionMapping;
  cache.prepareStudioEnvironmentCache({ readRenderTargetPixelsAsync:async (_t,_x,_y,_w,_h,data) => {
    data.fill(0x3c00); data[5] = 0x3555; return data;
  } }, target);
  await wait(); await wait(); target.dispose();
}
beforeEach(async () => {
  await new Promise(resolve => {
    const request = indexedDB.deleteDatabase('inhouse-read-studio');
    request.onsuccess = request.onerror = resolve;
  });
  vi.stubEnv('PROD', true);
  vi.stubGlobal('requestIdleCallback', callback => setTimeout(callback, 0));
});
afterEach(async () => { await wait(); vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('studio environment revision independent of the app entry filename', () => {
  it('keys actual stored halves by the generated studio revision and browser', async () => {
    await bake(await start('studio-revision-one'));
    const value = await stored();
    expect(value.key).toBe(`studio-revision-one|${navigator.userAgent}`);
    expect(value.data[5]).toBe(0x3555);
  });
  it('invalidates a stored atlas when the generating code revision changes', async () => {
    await bake(await start('studio-revision-one'));
    const next = await start('studio-revision-two');
    expect(next.cachedStudioEnvironment()).toBeNull();
    await bake(next);
    expect((await stored()).key).toBe(`studio-revision-two|${navigator.userAgent}`);
  });
  it('restores the same revision with every half float and sampler property intact', async () => {
    await bake(await start('studio-revision-one'));
    const original = await stored(), put = vi.spyOn(IDBObjectStore.prototype, 'put');
    const next = await start('studio-revision-one'), texture = next.cachedStudioEnvironment();
    expect(texture.image.data).toEqual(original.data);
    expect(texture.image.width).toBe(original.width);
    expect(texture.image.height).toBe(original.height);
    for (const [name, value] of Object.entries(original.settings)) expect(texture[name]).toBe(value);
    expect(put).not.toHaveBeenCalled(); texture.dispose();
  });
  it('never restores a production atlas in development', async () => {
    await bake(await start('studio-revision-one'));
    vi.stubEnv('PROD', false);
    const next = await start('studio-revision-one');
    expect(next.cachedStudioEnvironment()).toBeNull();
  });
});
