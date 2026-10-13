import {readerUI} from './rust-ui-required.js'

export class ReaderLists {
 constructor(panel){return new (readerUI().RustReaderLists)(panel)}
}
