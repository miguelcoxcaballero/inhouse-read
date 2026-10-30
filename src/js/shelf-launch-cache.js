// The last settled room is a temporary, non-interactive first paint. It never
// supplies layout/physics state. A changed library, account, viewport, theme,
// furniture, lights or build rejects it before any pixels are displayed.
import { version } from '../../package.json';
const DB = 'inhouse-read-launch', STORE = 'frame';
const MAX_BYTES = 6 * 1024 * 1024;
// Cloud acknowledgements never alter a painted book. Keep unknown fields,
// locators and bookmarks conservative so future visual changes invalidate.
const NONVISUAL = new Set(['content', 'progressUpdatedAt', 'progressDirty', 'progressStateFileId', 'lengthDirty', 'readingHistory', 'quotes']);

export function launchState(books, storage = localStorage, viewport = window, root = document.documentElement) {
  const settings = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (/^inhouse-read-(?:shelf|theme)/.test(key) || key === 'ihr_drive_profile_v2') settings.push([key, storage.getItem(key)]);
  }
  settings.sort(([a], [b]) => a.localeCompare(b));
  // Binary book contents do not affect a settled shelf. Cover bytes do: hash
  // those too, so replacing a JPEG by another of the same size cannot reuse it.
  const covers = [];
  const records = books.map(book => Object.fromEntries(Object.keys(book).sort().filter(key => !NONVISUAL.has(key)).map(key => {
    const value = book[key];
    if (value instanceof Blob) {
      if (/^cover(?:Blob)?$/.test(key)) covers.push(value);
      return [key, { size:value.size, type:value.type, modified:value.lastModified ?? null }];
    }
    return [key, value];
  })));
  return { text:JSON.stringify([version, viewport.innerWidth, viewport.innerHeight, viewport.devicePixelRatio || 1,
    root.style.getPropertyValue('--ihr-safe-top'), root.dataset?.theme, records, settings]), covers };
}
export async function launchKey(state) {
  const hash = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(x => x.toString(16).padStart(2, '0')).join('');
  return hash(new TextEncoder().encode(state.text + JSON.stringify(await Promise.all(state.covers.map(async blob => hash(await blob.arrayBuffer()))))));
}
function store(mode, use) {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB, 1);
    open.onupgradeneeded = () => open.result.createObjectStore(STORE);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      try {
        const tx = db.transaction(STORE, mode), request = use(tx.objectStore(STORE));
        tx.oncomplete = () => { db.close(); resolve(request.result); };
        tx.onerror = tx.onabort = () => { db.close(); reject(tx.error); };
      } catch (error) { db.close(); reject(error); }
    };
  });
}
export const readLaunchFrame = () => store('readonly', store => store.get('latest'));
const writeLaunchFrame = frame => store('readwrite', store => store.put(frame, 'latest'));
export function validLaunchFrame(frame, key, width, height) {
  return frame?.key === key && frame.image instanceof Blob && frame.image.type === 'image/png' && frame.image.size > 0 && frame.image.size <= MAX_BYTES &&
    [frame.x, frame.y, frame.width, frame.height].every(Number.isFinite) && frame.width > 0 && frame.height > 0 &&
    frame.x >= -1 && frame.y >= 0 && frame.x + frame.width <= width + 1 && frame.y + frame.height <= height + 1;
}

// `shelfModule` returns the shelf module (passed in: the preview's own module graph must not load it).
export function rememberLaunchFrames(root, { books, idle, isIdle, shelfModule }) {
  // The observer, its timer, the page listeners and the save (is the canvas settled and unused, the key, the
  // PNG, the checks after every wait) are rust-ui/src/launch_frames.rs; this keeps the store and the state.
  const shelf = shelfModule();
  return shelf.shelf_remember_launch_frames({ root, generation:0, stopped:false, isIdle, books, launchState, launchKey,
    validLaunchFrame, writeLaunchFrame }, idle, shelf);
}
