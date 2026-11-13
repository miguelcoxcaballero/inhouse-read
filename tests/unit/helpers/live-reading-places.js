// Test harness: the forwarders src/js/readers used to hold. Production calls the Rust export directly.
import {readerUI} from '../../../src/js/readers/rust-ui-required.js'

export function isBookmarked(bookmarks,location){return readerUI().reading_marked(bookmarks,location)}
export function toggleBookmark(bookmarks,location,create){return readerUI().reading_toggle(bookmarks,location,create)}
export function prependHistory(history,origin){return readerUI().reading_history(history,origin)}
