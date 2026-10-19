import { sameBookRecords } from './library-store.js';
import { bookmarkFor } from './bookshelf-layout.js';
import { needRustShelf } from './rust-shelf.js';

// Rust decides whether a refresh can retain the exact rendered shelf. Existing
// bookmark and whole-record predicates are shared, not reimplemented.
export const canAdoptShelfMetadata = (previous, next) =>
  needRustShelf().shelf_can_adopt_metadata(previous, next, bookmarkFor, sameBookRecords);
