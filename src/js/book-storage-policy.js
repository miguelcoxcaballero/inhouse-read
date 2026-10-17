import { bookDataModule } from './book-data-native.js';
/** Original-byte commits, account visibility and cached revisions are owned by Rust. */
export const isBookVisible = (book, accountId) => bookDataModule().book_is_visible(book, accountId);
export const bookCloudState = (book, options = {}) => bookDataModule().book_cloud_state(book, options);
export const needsDriveDownload = book => bookDataModule().book_needs_drive_download(book);
export const storeBookFile = (library, file, fields, options = {}) => bookDataModule().book_store_file(library, file, fields, options);
