// Test harness: the constructor the reader experience now calls directly (reader-experience.js).
import {readerUI} from '../../../src/js/readers/rust-ui-required.js'

// The Rust controls hold the host weakly: the host owns them, not the reverse.
export class ReaderControls {
 constructor(host){
  const reference=typeof WeakRef==='function'?new WeakRef(host):{deref:()=>host}
  return new (readerUI().RustReaderControls)(()=>reference.deref(),host.panel,host.miniPlayer)
 }
}
