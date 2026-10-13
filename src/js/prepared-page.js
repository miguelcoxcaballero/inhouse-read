import {getRustUI} from './rust-ui.js'
import {createLegacyPreparedPageCache,legacyPageKeyMismatch} from './prepared-page-legacy.js'
export {createStageGate} from './prepared-page-legacy.js'

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
  try{next=new Native(legacy.transferState(),(bounds,left,top)=>({...bounds,left,top}))}catch{next?.free();return owner}
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
