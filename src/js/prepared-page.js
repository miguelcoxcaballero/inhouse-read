import {getRustUI} from './rust-ui.js'
import {createLegacyPreparedPageCache,legacyPageKeyMismatch,createStageGate as createLegacyStageGate} from './prepared-page-legacy.js'
// Keep promises/idle callbacks from the existing selection. No extra task
// or download is scheduled when this native controller is not available.
export function createStageGate(settled,{idle=()=>new Promise(resolve=>setTimeout(resolve,0))}={}){
 const Native=getRustUI()?.RustStageGate
 if(!Native||!['wait','release'].every(key=>typeof Native.prototype?.[key]==='function'))return createLegacyStageGate(settled,{idle})
 let view
 try{view=new Native(settled,idle)}catch{return createLegacyStageGate(settled,{idle})}
 return{wait:()=>view.wait(),release:reason=>view.release(reason),destroy(){view?.free();view=null}}
}

export function pageKeyMismatch(prepared,wanted,{allowViewportTranslation=false}={}){
 const ui=getRustUI()
 return typeof ui?.prepared_page_mismatch==='function'
  ?ui.prepared_page_mismatch(prepared,wanted,!!allowViewportTranslation)
  :legacyPageKeyMismatch(prepared,wanted,{allowViewportTranslation})
}
// Transfer the existing ticket and opaque bitmap references atomically. No
// second preparation, clone, generation change or download waits on adoption.
export function createPreparedPageCache(){
 const legacy=createLegacyPreparedPageCache();let owner=legacy,disposed=false
 const current=()=>{
  if(owner!==legacy||disposed)return owner
  const Native=getRustUI()?.RustPreparedPageCache
  if(!Native||!['begin','isCurrent','store','take','has','peek','invalidate','ownsBook'].every(key=>typeof Native.prototype?.[key]==='function'))return owner
  let next
  try{next=new Native(legacy.transferState(),(snapshot,bounds,left,top)=>{snapshot.displayBounds={...bounds,left,top}})}catch{next?.free();return owner}
  legacy.releaseOwnedState();owner=next;return owner
 }
 return{
  begin:book=>current().begin(book),isCurrent:ticket=>current().isCurrent(ticket),
  store:(ticket,key,snapshot)=>current().store(ticket,key,snapshot),take:key=>current().take(key),
  has:book=>current().has(book),peek:()=>current().peek(),
  invalidate(reason='invalidated'){current().invalidate(reason)},
  invalidateBook(book,reason='book-changed'){
   const view=current();if(view===legacy)return legacy.invalidateBook.call(this,book,reason)
   if(view.ownsBook(book))this.invalidate(reason)
  },
  get lastDiscard(){return current().lastDiscard},
  destroy(){if(disposed)return;disposed=true;if(owner!==legacy)owner.free();legacy.releaseOwnedState();owner=legacy}
 }
}
