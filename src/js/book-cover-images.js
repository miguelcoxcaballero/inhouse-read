import * as THREE from 'three';
import {releaseCoverRaster} from './cover-raster-cache.js';

const activeCoverImages = new Map();
export function acquireCoverImage(url, onImage, onError) {
  let entry = activeCoverImages.get(url);
  const startLoad = !entry;
  if (!entry) {
    entry = { image:null, failed:false, users:0, listeners:new Set(), timer:0 };
    activeCoverImages.set(url, entry);
  }
  const listener = { onImage, onError };
  entry.users++;
  if (entry.image) onImage(entry.image, entry);
  else if (entry.failed) onError();
  else entry.listeners.add(listener);
  const fail = () => {
    clearTimeout(entry.timer); entry.failed = true;
    if (activeCoverImages.get(url) === entry) activeCoverImages.delete(url);
    for (const waiting of entry.listeners) waiting.onError();
    entry.listeners.clear();
  };
  if (startLoad) {
    // A stalled external image must not hold the opening transition forever.
    // The failed entry is evicted so a later opening may retry the URL.
    if (!/^(blob:|data:)/i.test(url)) entry.timer = setTimeout(fail, 6000);
    new THREE.TextureLoader().load(url, map => {
      clearTimeout(entry.timer);
      if (entry.failed || !entry.users) { map.dispose(); return; }
      entry.image = map.image;
      for (const waiting of entry.listeners) waiting.onImage(entry.image, entry);
      entry.listeners.clear(); map.dispose();
    }, undefined, fail);
  }
  let released = false;
  return () => {
    if (released) return;
    released = true; entry.listeners.delete(listener); entry.users--;
    if (!entry.users) {
      releaseCoverRaster(entry);
      clearTimeout(entry.timer);
      if (activeCoverImages.get(url) === entry) activeCoverImages.delete(url);
    }
  };
}

// A lease spans initial preparation and synchronous model construction. The
// model adopts the same decoded pixels before Rust releases this extra owner.
export function warmShelfCover(url) {
  if (!url) return Promise.resolve(null);
  return new Promise(resolve => {
    let release, completed = false, result;
    const done = image => {
      completed = true;
      result = { image, release:() => release?.() };
      if (release) resolve(result);
    };
    release = acquireCoverImage(url, image => done(image), () => done(null));
    if (completed) resolve(result);
  });
}
export const loadedShelfCover = url => activeCoverImages.get(url)?.image;
