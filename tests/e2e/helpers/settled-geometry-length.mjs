import { readFileSync } from 'node:fs';
import * as native from '../../../src/wasm/shelf/inhouse_read_shelf.js';
import { loadRustShelf } from '../../../src/js/rust-shelf.js';
// This fixture is evaluated in the Playwright Node process, outside the page.
// Use the same compiled metadata policy now that its owner is Rust.
native.initSync({ module:readFileSync('src/wasm/shelf/inhouse_read_shelf_bg.wasm') });
await loadRustShelf();
import { completeWordCount } from '../../../src/js/book-length.js';

/** Scene/lighting/motion fixtures define an already measured paper volume.
 * Their tiny real PDFs supply reader/cover content, not that synthetic volume.
 * Real PDF/EPUB extraction and pending migration are tested separately. */
export function settledGeometryLength(words, revision = 'settled-geometry-fixture') {
  return { ...completeWordCount(words), contentRevision:revision,
    wordCountContentRevision:revision };
}
