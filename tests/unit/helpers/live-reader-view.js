// Test harness: the constructor the reader experience now calls directly (reader-experience.js).
import {readerUI} from '../../../src/js/readers/rust-ui-required.js'

export class ReaderView {
 constructor(screen,panel,mini,returnButton){return new (readerUI().RustReaderView)(screen,panel,mini,returnButton)}
}
