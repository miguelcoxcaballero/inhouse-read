import { spineStylesFor } from './bookshelf-layout.js'

// All the shelf's spine styles in one Rust call. The call site keeps the
// "prepared styles" hook; there is no per-book JavaScript path behind it.
export const batchSpineStyles = (books, options = {}) => Array.isArray(books) ? spineStylesFor(books, options) : []
