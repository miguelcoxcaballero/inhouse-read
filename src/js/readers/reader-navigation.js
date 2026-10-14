import {readerUI} from './rust-ui-required.js'

export class ReaderNavigation{
 constructor(){return new (readerUI().RustReaderNavigation)()}
}
