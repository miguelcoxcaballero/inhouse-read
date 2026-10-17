import { lengthMetadata } from './book-length-metadata.js';
/** Shared complete-text metadata policy; Drive and Blob I/O stay with their owners. */
export const driveBookLength = book => lengthMetadata().length_drive_metadata(book);
export const normalizeDriveBookLength = value => lengthMetadata().length_normalize_drive_metadata(value);
export const wordCountFromDrive = (book, value) => lengthMetadata().length_count_from_drive(book, value);
