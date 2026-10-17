import {afterEach, expect, it, vi} from 'vitest';
import * as THREE from 'three';
import {acquireCoverImage, loadedShelfCover, warmShelfCover} from '../../src/js/book-cover-images.js';

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

it('hands the same decoded photo to the first model without a second load, retaining it until the last owner leaves', async () => {
  let complete;
  const loader = vi.spyOn(THREE.TextureLoader.prototype, 'load').mockImplementation((_url, ready) => { complete = ready; });
  const task = warmShelfCover('blob:first-photo');
  const photo = {naturalWidth:600, naturalHeight:900};
  const map = new THREE.Texture(photo), dispose = vi.spyOn(map, 'dispose');
  complete(map);
  const lease = await task, render = vi.fn();
  const overlapping = await warmShelfCover('blob:first-photo');
  expect(overlapping.image).toBe(photo);
  overlapping.release(); overlapping.release();
  const releaseModel = acquireCoverImage('blob:first-photo', render, vi.fn());
  expect(loader).toHaveBeenCalledOnce();
  expect(render).toHaveBeenCalledWith(photo, expect.any(Object));
  expect(dispose).toHaveBeenCalledOnce();
  lease.release(); lease.release();
  expect(loadedShelfCover('blob:first-photo')).toBe(photo);
  releaseModel();
  expect(loadedShelfCover('blob:first-photo')).toBeUndefined();
  const secondLease = warmShelfCover('blob:first-photo');
  complete(new THREE.Texture(photo));
  (await secondLease).release();
  expect(loader).toHaveBeenCalledTimes(2);
});

it('settles a failed warm-up and permits retry instead of retaining a failed image', async () => {
  let fail;
  const loader = vi.spyOn(THREE.TextureLoader.prototype, 'load').mockImplementation((_url, _ready, _progress, error) => { fail = error; });
  const task = warmShelfCover('blob:broken-photo'); fail();
  const lease = await task;
  expect(lease.image).toBeNull(); expect(loadedShelfCover('blob:broken-photo')).toBeUndefined();
  lease.release();
  const retry = warmShelfCover('blob:broken-photo'); fail(); (await retry).release();
  expect(loader).toHaveBeenCalledTimes(2);
});

it('releases a stalled remote preparation and disposes its late texture without reviving the image', async () => {
  vi.useFakeTimers();
  let complete;
  vi.spyOn(THREE.TextureLoader.prototype, 'load').mockImplementation((_url, ready) => { complete = ready; });
  const task = warmShelfCover('https://example.test/stalled-cover.png');
  await vi.advanceTimersByTimeAsync(6000);
  const lease = await task;
  expect(lease.image).toBeNull();
  lease.release();
  const late = new THREE.Texture({naturalWidth:600, naturalHeight:900}), dispose = vi.spyOn(late, 'dispose');
  complete(late);
  expect(dispose).toHaveBeenCalledOnce();
  expect(loadedShelfCover('https://example.test/stalled-cover.png')).toBeUndefined();
});
