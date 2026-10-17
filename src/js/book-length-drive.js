import { bookDataModule } from './book-data-native.js';
/** Shared complete-text metadata policy; Drive and Blob I/O stay with their owners. */
export const driveBookLength = book => bookDataModule().length_drive_metadata(book);
export const normalizeDriveBookLength = value => bookDataModule().length_normalize_drive_metadata(value);
export const wordCountFromDrive = (book, value) => bookDataModule().length_count_from_drive(book, value);
