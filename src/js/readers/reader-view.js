import {readerUI} from './rust-ui-required.js'

export class ReaderView {
 constructor(screen,panel,mini,returnButton){return new (readerUI().RustReaderView)(screen,panel,mini,returnButton)}
}
