import {getRustUI} from '../rust-ui.js'
import {onRustUIReady} from '../rust-ui-readiness.js'
import {LegacyReaderControls} from './reader-controls-legacy.js'

// Only weak references enter the readiness registry or WASM listener heap.
function watch(owner,reference){
 return ui=>{
  const controls=owner.deref(),host=reference.deref()
  if(!controls||!host||controls.disposed)return
  if(!host.panel.isConnected||!host.miniPlayer.isConnected){controls.free();return}
  const Native=ui?.RustReaderControls
  if(!Native)return
  try{
   const native=new Native(()=>reference.deref(),host.panel,host.miniPlayer)
   // Native properties now replace the old ones. Dispose only handlers still
   // owned by the fallback, and remove its addEventListener registrations.
   LegacyReaderControls.prototype.free.call(controls)
   controls.native=native;controls.unsubscribe?.();controls.unsubscribe=null
  }catch{
   // Partial native construction releases itself. Restore the working handlers
   // without replacing nodes, selection, focus or book layout.
   LegacyReaderControls.prototype.free.call(controls)
   const replacement=new LegacyReaderControls(host)
   controls.listeners=replacement.listeners;controls.properties=replacement.properties
  }
 }
}
class PendingReaderControls extends LegacyReaderControls {
 constructor(host){
  super(host);this.native=null;this.disposed=false
  const reference=new WeakRef(host),owner=new WeakRef(this)
  this.unsubscribe=onRustUIReady(watch(owner,reference))
 }
 free(){
  if(this.disposed)return
  this.disposed=true;this.unsubscribe?.();this.unsubscribe=null
  this.native?.free();this.native=null;super.free()
 }
}
export class ReaderControls {
 constructor(host){
  if(typeof WeakRef!=='function')return new LegacyReaderControls(host)
  const Native=getRustUI()?.RustReaderControls
  if(!Native)return new PendingReaderControls(host)
  const reference=new WeakRef(host)
  return new Native(()=>reference.deref(),host.panel,host.miniPlayer)
 }
}
