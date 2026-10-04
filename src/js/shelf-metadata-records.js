import { sameBookRecords } from './library-store.js';
import { bookmarkFor } from './bookshelf-layout.js';

// These fields do not change a shelf's layout, materials, availability or text.
// A locator may change only while its actual rendered bookmark stays identical.
// Every other property, including unknown future fields, keeps the full path.
const METADATA_FIELDS = new Set(['progressUpdatedAt', 'progressDirty', 'progressStateFileId',
  'lengthDirty', 'readingHistory', 'bookmarks', 'quotes', 'locator']);
const withoutMetadata = record => Object.fromEntries(Object.entries(record)
  .filter(([key]) => !METADATA_FIELDS.has(key)));
const isBlob = value => /^\[object (Blob|File)\]$/.test(Object.prototype.toString.call(value));
function identicalBlobs(before, after) {
  if (Object.is(before, after)) return true;
  if (isBlob(before) || isBlob(after)) return false;
  if (!before || !after || typeof before !== 'object' || typeof after !== 'object') return true;
  return Object.keys(before).every(key => identicalBlobs(before[key], after[key]));
}
function committedBlobInputs(before, after) {
  for (const [key, value] of Object.entries(before)) {
    if (METADATA_FIELDS.has(key) || Object.is(value, after[key])) continue;
    if (isBlob(value) && isBlob(after[key])) {
      // IndexedDB reconstructs Blob objects. Trust only the existing explicit
      // committed-byte markers: size/type alone never authorize this path.
      if (key === 'content' && typeof before.contentRevision === 'string' && before.contentRevision.trim() &&
          before.contentRevision === after.contentRevision) continue;
      if ((key === 'cover' || key === 'coverBlob') && Number.isFinite(before.coverUpdatedAt) && before.coverUpdatedAt > 0 &&
          before.coverUpdatedAt === after.coverUpdatedAt) continue;
    }
    if (!identicalBlobs(value, after[key])) return false;
  }
  return true;
}

export function canAdoptShelfMetadata(previous, next) {
  if (!Array.isArray(previous) || !Array.isArray(next) || !previous.length || previous.length !== next.length)
    return false;
  const ids = new Set();
  for (let index = 0; index < previous.length; index++) {
    const before = previous[index], after = next[index];
    if (!before || !after || Object.getPrototypeOf(before) !== Object.prototype || Object.getPrototypeOf(after) !== Object.prototype ||
        !before.id || before.id !== after.id || ids.has(String(before.id))) return false;
    ids.add(String(before.id));
    if (!committedBlobInputs(before, after)) return false;
    if (JSON.stringify(bookmarkFor(before)) !== JSON.stringify(bookmarkFor(after))) return false;
  }
  // Preserve the existing whole-record predicate and the original identical
  // refresh behavior; this branch requires a real explicit metadata change.
  return !sameBookRecords(previous, next) && sameBookRecords(previous.map(withoutMetadata), next.map(withoutMetadata));
}
