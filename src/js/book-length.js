/** Complete text volume and bounded counting are owned by the shelf's native module.
 * The host connects DOM/Intl responses and the browser's idle timer. */
import { needRustShelf, getRustShelf, requireRustShelf } from './rust-shelf.js';
import { lengthMetadata } from './book-length-metadata.js';
import { packSegments } from './word-segments-host.js';
export const WORDS_PER_PRINT_PAGE = 300;
export const DEFAULT_PRINT_PAGES = 320;
export const WORD_COUNT_VERSION = 2;
const pause = () => new Promise(resolve => setTimeout(resolve, 0));
export const textLengthHost = { pause, packSegments, acceptNode: node => needRustShelf().length_accept_node(node) };
export const hasCompleteWordCount = book => lengthMetadata().length_has_complete_count(book);
export const completeWordCount = words => lengthMetadata().length_complete_count(words);
export const printedPageCount = book => lengthMetadata().length_printed_pages(book);
export function createWordCounter(language, options = {}) {
  const native = needRustShelf(), state = native.length_create_counter(language, options, textLengthHost);
  return { add:text => native.length_counter_add(state, text), finish:() => native.length_counter_finish(state) };
}
export function countTextWords(text, options = {}) {
  const native = getRustShelf();
  return native ? native.length_count_text(text, options, textLengthHost)
    : requireRustShelf().then(native => native.length_count_text(text, options, textLengthHost));
}
export function measureBookLength(book, options = {}) {
  const native = getRustShelf();
  return native ? native.length_measure_book(book, options, textLengthHost)
    : requireRustShelf().then(native => native.length_measure_book(book, options, textLengthHost));
}
