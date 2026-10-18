import {getRustUI} from './rust-ui.js'
import {createLegacyReadingProgressQueue} from './reading-progress-queue-legacy.js'

// A book keeps its queue until its last write finishes. This permits late WASM
// adoption without letting a newer position overtake an in-flight local save.
export function createReadingProgressQueue(library,{onSaved=()=>{}}={}){
 const legacy=createLegacyReadingProgressQueue(library,{onSaved}),owners=new Map(),observed=new WeakSet()
 let native
 const ownerFor=id=>{
  const owner=owners.get(id)
  if(owner)return owner
  const Native=getRustUI()?.RustReadingProgressQueue
  if(Native&&!native)native=new Native(
   (id,fraction,locator)=>library.updateProgress(id,fraction,locator),
   (id,fields)=>library.patch(id,{...fields,...(Object.keys(fields).some(k=>/^(spine|cover|shelf|pageEdge)/.test(k))?{}:{progressUpdatedAt:Date.now(),progressDirty:true})}),onSaved)
  const next=native||legacy;owners.set(id,next);return next
 }
 const observe=(id,owner,promise)=>{
  if(!observed.has(promise)){
   observed.add(promise)
   const settled=()=>{if(owners.get(id)===owner&&owner.get(id)===undefined)owners.delete(id)}
   // Observe replaced positions too, retaining the original rejecting Promise.
   promise.then(settled,settled)
  }
  return promise
 }
 return {
  updateProgress(id,fraction,locator){const owner=ownerFor(id);return observe(id,owner,owner.updateProgress(id,fraction,locator))},
  patch(id,fields){const owner=ownerFor(id);return observe(id,owner,owner.patch(id,owner===native?{...fields}:fields))},
  get(id){const owner=owners.get(id),promise=owner?.get(id);if(promise===undefined)owners.delete(id);return promise}
 }
}
