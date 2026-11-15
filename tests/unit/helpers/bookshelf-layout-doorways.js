// src/js/bookshelf-layout.js plus three doorways only tests went through: the app asks the Rust modules for a book's
// seed, progress and "in progress" where it needs them, never by these names, so they left the app's source.
export * from '../../../src/js/bookshelf-layout.js';
import { core } from '../../../src/js/catalogue-core.js';
import { bookDataModule } from '../../../src/js/book-data-native.js';

/**
 * Semilla estable de un libro. Se prefiere el id del store (`local:name:size`
 * o `drive:fileId`), que sobrevive a renombrados de la entrada de biblioteca.
 */
export function seedFor(book) {
  return bookDataModule().book_seed_for(book);
}

const progressRaw = book => Number(book?.progressFraction ?? book?.progress);

/** Progreso 0..1 del libro, aceptando los dos nombres que circulan. */
export const progressOf = book => core.progress_of(progressRaw(book));

/** Un libro "en curso" es el que se ha empezado y no se ha terminado. */
export const isInProgress = book => core.book_in_progress(progressRaw(book), book?.lastOpenedAt != null ? 1 : 0) === 1;
