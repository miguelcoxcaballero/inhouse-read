/* global __SHELF_BAKE_VERSION__ */
import { getRustShelf, needRustShelf } from './rust-shelf.js';

// IndexedDB starts immediately, in parallel with library I/O and WASM loading.
// Rust adopts the raw result when the shelf first asks for it; no compilation
// or module promise delays this browser read. Rust owns validation, signatures,
// one-shot surface handoff, write deduplication and scheduling/cancellation.
const DB_NAME = 'inhouse-read-shelf-bakes', STORE = 'bakes', KEY = 'shelf';
const build = typeof __SHELF_BAKE_VERSION__ === 'string' ? __SHELF_BAKE_VERSION__ : null;
const sources = new Set();
let session;

function open(current) {
  if (current.database) return Promise.resolve(current.database);
  if (current.opening) return current.opening;
  current.opening = new Promise((resolve, reject) => {
    const request = current.factory.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => {
      const db = request.result;
      if (!current.active) { db.close(); reject(new Error('Shelf bake session closed')); return; }
      db.onversionchange = () => { db.close(); if (current.database === db) current.database = null; };
      resolve(current.database = db);
    };
    request.onerror = () => reject(request.error);
  }).finally(() => { current.opening = null; });
  return current.opening;
}

const host = {
  write: (current, value) => open(current).then(db => new Promise(resolve => {
    const transaction = db.transaction(STORE, 'readwrite');
    transaction.objectStore(STORE).put(value, KEY);
    transaction.oncomplete = () => resolve(true);
    transaction.onerror = transaction.onabort = () => resolve(false);
  })).catch(() => false),
  later: (current, epoch, delay) => setTimeout(() => needRustShelf().shelf_bake_wait(host, current, epoch), delay),
  afterSettled: (current, epoch, pending) => pending.then(() => needRustShelf().shelf_bake_idle(host, current, epoch)).catch(() => {}),
  idle: (current, epoch, timeout, delay) => {
    const callback = () => needRustShelf().shelf_bake_collect(host, current, epoch);
    return typeof requestIdleCallback === 'function' ? { idle:true, id:requestIdleCallback(callback, { timeout }) } : { idle:false, id:setTimeout(callback, delay) };
  },
  cancelIdle: token => token.idle ? cancelIdleCallback(token.id) : clearTimeout(token.id),
};

/** Starts the browser read before Rust is ready. Each session owns its request
 * callbacks, so a stale read cannot replace the next launch's cache. */
export function startShelfBakes(buildVersion = build, idb = globalThis.indexedDB) {
  if (session) {
    session.active = false;
    getRustShelf()?.shelf_bake_cancel(host, session);
    session.database?.close(); session.database = null;
  }
  const current = session = { buildVersion, factory:idb ?? null, userAgent:globalThis.navigator?.userAgent ?? '',
    sources, database:null, raw:null, ready:false, active:true };
  // This bootstrap gate also prevents opening/creating IndexedDB in dev builds.
  const reading = !buildVersion || !idb ? Promise.resolve(null) : open(current).then(db => new Promise(resolve => {
    const request = db.transaction(STORE).objectStore(STORE).get(KEY);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  })).catch(() => null);
  current.loading = reading.then(value => { current.raw = current.active ? value : null; current.ready = true; });
  return current.loading;
}

export const shelfBakesEnabled = () => needRustShelf().shelf_bake_enabled(session);
export const loadedShelfBakes = () => needRustShelf().shelf_bake_record(session);
export const savedSurface = (key, width, height) => needRustShelf().shelf_bake_surface(session, key, width, height);
export const saveShelfBakes = value => {
  try { return needRustShelf().shelf_bake_save(host, session, value); }
  catch { return Promise.resolve(false); }
};
export const scheduleShelfBakeWrite = () => needRustShelf().shelf_bake_schedule(host, session);

/** The read deadline runs while the numeric and shelf modules are loading. */
export const shelfBakesSettled = (ms = 0) => session.ready ? Promise.resolve() :
  Promise.race([session.loading, new Promise(resolve => setTimeout(resolve, ms))]);

// Sources register during module evaluation, before WASM may be available.
export const addShelfBakeSource = source => { sources.add(source); };
startShelfBakes();
