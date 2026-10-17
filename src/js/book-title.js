import { bookDataModule } from './book-data-native.js'

// The loaded reader/shelf module owns metadata decisions.
export const normalizeBookTitle = (value, fallback = '') => bookDataModule().book_normalize_title(value, fallback)
export const normalizeBookAuthor = value => bookDataModule().book_normalize_author(value)
export const displayBookTitle = book => bookDataModule().book_display_title(book)
