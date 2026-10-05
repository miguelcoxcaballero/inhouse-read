/* global __SHELF_BAKE_VERSION__ */
// Plants and lamp surfaces are pure functions of their records, the code that
// makes them and the JS engine. What the last shelf needed (plant meshes and
// the final paint of plant and lamp surfaces) is kept in one record, so the
// next launch draws them complete in its first frame instead of generating
// them inside it. The read starts as soon as this module is evaluated, in
// parallel with the library read; any failure means they are generated as
// before.
const DB_NAME = 'inhouse-read-shelf-bakes', STORE = 'bakes', KEY = 'shelf';

// Only production builds define a version (a hash of the generators' sources
// and the three.js release); the engine joins it, as Math may change with it.
const build = typeof __SHELF_BAKE_VERSION__ === 'string' ? __SHELF_BAKE_VERSION__ : null;

let factory = null, version = null, record = null, settled = true, loading = Promise.resolve(), database = null;
let surfaces = new Map(), signature = '', writeTimer = 0;
const sources = new Set();

function open() {
  if (database) return Promise.resolve(database);
  return new Promise((resolve, reject) => {
    const request = factory.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => { db.close(); if (database === db) database = null; };
      resolve(database = db);
    };
    request.onerror = () => reject(request.error);
  });
}

const keysOf = value => JSON.stringify([value.models.map(([key, , keys]) => [key, [...keys].sort()]).sort((a, b) => a[0] < b[0] ? -1 : 1),
  value.surfaces.map(([key]) => key).sort()]);

function accept(value) {
  if (value?.version !== version || !Array.isArray(value.models) || !Array.isArray(value.surfaces)) return null;
  const models = value.models.filter(item => Array.isArray(item) && typeof item[0] === 'string' && Array.isArray(item[2]));
  const painted = value.surfaces.filter(item => Array.isArray(item) && typeof item[0] === 'string' && item[1]);
  return { models, surfaces:painted };
}

/** Starts reading the saved bakes of `buildVersion` (tests pass their own). */
export function startShelfBakes(buildVersion = build, idb = globalThis.indexedDB) {
  clearTimeout(writeTimer);
  record = null; database = null; factory = idb ?? null; surfaces = new Map(); signature = '';
  version = buildVersion && factory ? `${buildVersion}|${globalThis.navigator?.userAgent ?? ''}` : null;
  if (!version) { settled = true; loading = Promise.resolve(); return loading; }
  settled = false;
  loading = new Promise(resolve => {
    const done = value => {
      if (settled) return;
      settled = true; record = value;
      if (value) { surfaces = new Map(value.surfaces); signature = keysOf(value); }
      resolve();
    };
    try {
      open().then(db => {
        const get = db.transaction(STORE).objectStore(STORE).get(KEY);
        get.onsuccess = () => done(accept(get.result));
        get.onerror = () => done(null);
      }).catch(() => done(null));
    } catch { done(null); }
  });
  return loading;
}

export const shelfBakesEnabled = () => Boolean(version);

/** The saved shelf record, once read (null when absent, stale or unreadable). */
export const loadedShelfBakes = () => record;

/** Resolves when the read has settled, or after `ms` at most. */
export function shelfBakesSettled(ms = 0) {
  if (settled) return Promise.resolve();
  return Promise.race([loading, new Promise(resolve => setTimeout(resolve, ms))]);
}

const isTyped = (value, type) => Object.prototype.toString.call(value) === `[object ${type}]`;

/** The saved final paint of a surface (RGBA pigment and data bytes), taken once. */
export function savedSurface(key, width, height) {
  const saved = surfaces.get(key);
  if (!saved) return null;
  surfaces.delete(key);
  const length = width * height * 4;
  return saved.width === width && saved.height === height && isTyped(saved.pigment, 'Uint8Array') && isTyped(saved.data, 'Uint8Array') &&
    saved.pigment.length === length && saved.data.length === length ? saved : null;
}

/** Replaces the saved shelf record. Failures (quota, private mode) are ignored. */
export function saveShelfBakes(value) {
  if (!version) return Promise.resolve(false);
  return open().then(db => new Promise(resolve => {
    const transaction = db.transaction(STORE, 'readwrite');
    transaction.objectStore(STORE).put({ ...value, version }, KEY);
    transaction.oncomplete = () => resolve(true);
    transaction.onerror = transaction.onabort = () => resolve(false);
  })).catch(() => false);
}

/** A generator that keeps bakes: `collect()` returns what it would save now,
 * `settled()` resolves once its surfaces have their final paint. */
export function addShelfBakeSource(source) { sources.add(source); }

const idle = callback => typeof requestIdleCallback === 'function' ? requestIdleCallback(callback, { timeout:1000 }) : setTimeout(callback, 50);

/** Saves the shelf well after start-up, once every surface is final, and only when it changed. */
export function scheduleShelfBakeWrite() {
  if (!version) return;
  clearTimeout(writeTimer);
  const current = version;
  writeTimer = setTimeout(() => Promise.all([...sources].map(source => source.settled())).then(() => idle(() => {
    if (version !== current) return;
    const next = { models:[], surfaces:[] };
    for (const source of sources) {
      const part = source.collect();
      next.models.push(...part.models ?? []); next.surfaces.push(...part.surfaces ?? []);
    }
    const keys = keysOf(next);
    if (keys === signature) return;
    signature = keys;
    saveShelfBakes(next);
  })), 2000);
}

startShelfBakes();
