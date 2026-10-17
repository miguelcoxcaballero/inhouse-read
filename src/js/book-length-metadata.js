import { getRustShelf, needRustShelf } from './rust-shelf.js';
import { getRustUI } from './rust-ui.js';
// Synchronous callers use their already-loaded module. Drive owns UI; the
// shelf owns Shelf. No extra download or await can interrupt an IDB transaction.
export const lengthMetadata = () => getRustShelf() || getRustUI() || needRustShelf();
