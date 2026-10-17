import { needRustShelf, getRustShelf, requireRustShelf } from './rust-shelf.js';
import { measureFileBookLength } from './file-book-length.js';

import { lengthMetadata } from './book-length-metadata.js';
export const newContentRevision = () => lengthMetadata().length_new_revision();
export const clearBookLength = () => lengthMetadata().length_clear_count();
export const isBookLengthReady = book => lengthMetadata().length_is_ready(book);

/** Browser-owned continuations carry a JS data graph; Rust decides revisions,
 * serial work, cancellation, failures and commits. Construction starts no WASM
 * download before the shelf's first frame. */
export function createBookLengthQueue(library, { measureFile = measureFileBookLength,
  onChange = () => {}, onError = () => {} } = {}) {
  const state = { entries:new Map(), tail:Promise.resolve(), disposed:false };
  const env = { library, measureFile, onChange, onError, newRevision:newContentRevision,
    ignore:() => {}, missingRevision:current => needRustShelf().length_queue_missing_revision(current),
    makeJob:(id, entry) => () => needRustShelf().length_queue_run(state, env, id, entry),
    makeFailure:(id, entry, record) => error => needRustShelf().length_queue_failed(state, env, id, entry, record, error),
    makeActive:(id, entry) => () => needRustShelf().length_queue_active(state, id, entry),
    makeCommitGuard:(id, entry) => current => needRustShelf().length_queue_can_commit(state, id, entry, current)
  };
  return {
    async ensure(book) {
      const native = getRustShelf() || await requireRustShelf();
      return native.length_queue_ensure(state, env, book);
    },
    geometryState:book => needRustShelf().length_queue_geometry(state, book),
    cancel:id => needRustShelf().length_queue_cancel(state, id),
    retry(book) { return needRustShelf().length_queue_retry(state, env, book, this); },
    dispose() {
      const native = getRustShelf();
      if (native) native.length_queue_dispose(state);
      else state.disposed = true; // No native job can exist before the module loads.
    }
  };
}
