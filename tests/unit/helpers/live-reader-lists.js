// Test harness: the constructor the reader experience now calls directly (reader-experience.js).
import {readerUI} from '../../../src/js/readers/rust-ui-required.js'

export class ReaderLists {
 constructor(panel){return new (readerUI().RustReaderLists)(panel)}
}
