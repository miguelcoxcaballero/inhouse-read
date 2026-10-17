import { bookDataModule } from './book-data-native.js';
/** Only editable names pass through the selected-book handoff. */
export const refreshSelectedBookNames = (experience, book) => bookDataModule().book_refresh_selected_names(experience, book);
