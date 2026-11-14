// src/js/library-store.js plus the one doorway only tests went through: the Rust store makes a record's id itself
// (rust-ui/src/library_store.rs); nothing in the app asks for it by this name.
export * from '../../../src/js/library-store.js'
import { bookDataModule } from '../../../src/js/book-data-native.js'

export const idForSource = source => bookDataModule().library_id_for_source(source)
