// The live shelf is built with the shelf module already in (its first render awaits it): a fixture page that
// builds books, spines or relief imports this module first, as the unit tests do with rust-shelf-ready.js.
import { requireRustShelf } from '/inhouse-read/src/js/rust-shelf.js';
export const shelf = await requireRustShelf();
