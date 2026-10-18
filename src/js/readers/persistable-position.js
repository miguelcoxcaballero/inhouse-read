import {bookDataModule} from '../book-data-native.js';
// Invoked by the already-native reader or shelf. Preserve exact JS/UTF-16 values.
export const persistablePosition = location => bookDataModule().reader_persistable_position(location);
export const persistableRelocation = (relocation, engine) => bookDataModule().reader_persistable_relocation(relocation, engine);
