import { getRustShelf, needRustShelf, requireRustShelf } from './rust-shelf.js';
import { getRustUI } from './rust-ui.js';
// Synchronous callers use their already-loaded module. Drive owns UI; the
// shelf owns Shelf. No extra download or await can interrupt an IDB transaction.
export const bookDataModule = () => getRustShelf() || getRustUI() || needRustShelf();

export const withBookDataModule = use => {
  const ready = getRustShelf() || getRustUI();
  return ready ? use(ready) : requireRustShelf().then(use);
};
