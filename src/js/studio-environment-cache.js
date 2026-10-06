/* global __STUDIO_ENVIRONMENT_VERSION__ */
import * as THREE from 'three';

// Both persistent renderers use the same immutable studio. Its CubeUV atlas
// contains every roughness level already, so a bit-exact half-float transfer
// avoids generating the room and filtering it again in the second context.
// Never wait for this optional transfer in selection, reading or animation.
const MAX_BYTES = 8 * 1024 * 1024;
const properties = ['mapping','minFilter','magFilter','generateMipmaps','colorSpace','flipY','wrapS','wrapT'];
let attempted = false, atlas = null;

// The same bytes also persist on this device, so a later start reads them
// while the app loads instead of baking the room before its first frame.
// Generating code, Three and browser key them. An unrelated app update keeps
// the exact atlas. Development and isolated builds retain the URL fallback.
const DB = 'inhouse-read-studio', STORE = 'atlas', RECORD = 'studio';
const revision = typeof __STUDIO_ENVIRONMENT_VERSION__ === 'string'
  ? __STUDIO_ENVIRONMENT_VERSION__ : new URL(import.meta.url).pathname;
const persistKey = import.meta.env.PROD && typeof indexedDB !== 'undefined'
  ? `${revision}|${globalThis.navigator?.userAgent ?? ''}` : null;
const usable = ({ data, width, height, settings }) => Object.prototype.toString.call(data) === '[object Uint16Array]' &&
  Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0 && width * height * 8 <= MAX_BYTES &&
  data.length === width * height * 4 && properties.every(key => key in Object(settings));

function openStore() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
// A read resolves on its request's success, a task before its transaction
// completes: the scene may already be built in between.
function withStore(mode, use) {
  return openStore().then(db => new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, mode), request = use(transaction.objectStore(STORE));
    if (mode === 'readonly') request.onsuccess = () => resolve(request.result);
    else transaction.oncomplete = () => resolve(request.result);
    transaction.onerror = transaction.onabort = () => reject(transaction.error);
  }).finally(() => db.close()));
}
// Resolves true when this device already holds the current atlas.
const stored = persistKey && withStore('readonly', store => store.get(RECORD)).then(record => {
  if (record?.key !== persistKey || !usable(record)) return false;
  atlas ||= { data:record.data, width:record.width, height:record.height, settings:record.settings };
  return true;
}).catch(() => false);
function persist({ data, width, height, settings }) {
  if (!stored) return;
  const write = () => stored.then(current => current ||
    withStore('readwrite', objects => objects.put({ key:persistKey, data, width, height, settings }, RECORD))).catch(() => {});
  if (typeof requestIdleCallback === 'function') requestIdleCallback(write, { timeout:5000 }); else setTimeout(write, 1000);
}

export function prepareStudioEnvironmentCache(renderer, target) {
  if (attempted || typeof renderer?.readRenderTargetPixelsAsync !== 'function' ||
    !target?.isWebGLRenderTarget || target.texture?.type !== THREE.HalfFloatType ||
    target.texture.format !== THREE.RGBAFormat || target.texture.mapping !== THREE.CubeUVReflectionMapping) return;
  const {width,height} = target;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 || width * height * 8 > MAX_BYTES) return;
  attempted = true;
  const data = new Uint16Array(width * height * 4);
  const settings = Object.fromEntries(properties.map(key => [key,target.texture[key]]));
  // Async PBO/fence read restores the driver's framebuffer before yielding.
  // Unsupported reads, context loss or empty output retain the original bake.
  try {
    Promise.resolve(renderer.readRenderTargetPixelsAsync(target,0,0,width,height,data))
      .then(result => {
        if (result !== data) return;
        // One plain pass over the 3M halves: callbacks cost a long task.
        let lit = false;
        for (let index = 0; index < data.length; index++) {
          const value = data[index];
          if ((value & 0x7c00) === 0x7c00) return;
          if (value !== 0) lit = true;
        }
        if (!lit) return;
        atlas = {data,width,height,settings};
        persist(atlas);
      }).catch(() => {});
  } catch { /* The studio remains available through its existing GPU texture. */ }
}

export function cachedStudioEnvironment() {
  if (!atlas) return null;
  const texture = new THREE.DataTexture(atlas.data,atlas.width,atlas.height,THREE.RGBAFormat,THREE.HalfFloatType);
  Object.assign(texture,atlas.settings);
  texture.needsUpdate = true;
  return texture;
}
