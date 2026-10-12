import {getRustUI} from '../rust-ui.js'
import {LegacyReaderControls} from './reader-controls-legacy.js'

export class ReaderControls {
 constructor(host){
  const Native=getRustUI()?.RustReaderControls
  if(!Native||typeof WeakRef!=='function')return new LegacyReaderControls(host)
  // The listeners must not retain their controller through the WASM heap.
  const reference=new WeakRef(host)
  return new Native(()=>reference.deref(),host.panel,host.miniPlayer)
 }
}
