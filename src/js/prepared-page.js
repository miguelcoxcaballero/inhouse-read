import {getRustUI,loadRustUI} from './rust-ui.js'
import {onRustUIReady} from './rust-ui-readiness.js'
// The prepared page is an optimisation that starts only after the lifted book has
// settled, so it can wait for the Rust UI module (bounded by the same deadline as
// the reader). Until then nothing was ever prepared, so every query is empty and
// an invalidation has nothing to discard; the tap computes the page as before.
const CACHE=['begin','isCurrent','store','take','has','peek','invalidate','ownsBook']
const rebase=(snapshot,bounds,left,top)=>{snapshot.displayBounds={...bounds,left,top}}

export function createStageGate(settled,{idle=()=>new Promise(resolve=>setTimeout(resolve,0))}={}){
 let view=null,skipped=false,destroyed=false,released=false,reason
 const build=ui=>{
  if(view||skipped||destroyed)return view
  if(!ui){skipped=true;return null}
  const Native=ui.RustStageGate
  if(!Native||!['wait','release'].every(key=>typeof Native.prototype?.[key]==='function')){skipped=true;return null}
  try{view=new Native(settled,idle)}catch{skipped=true;return null}
  if(released)view.release(reason)
  return view
 }
 const loaded=getRustUI()
 if(loaded)build(loaded)
 return{
  // No module yet: the work is not started for this selection (false means skip), exactly like a dismissed one.
  wait:()=>view?view.wait():skipped||destroyed?Promise.resolve(false):loadRustUI().then(ui=>{const gate=build(ui);return gate?gate.wait():false}),
  release(why){if(view)view.release(why);else if(!released){released=true;reason=why}},
  destroy(){destroyed=true;view?.free();view=null}
 }
}

export function pageKeyMismatch(prepared,wanted,{allowViewportTranslation=false}={}){
 const ui=getRustUI()
 if(typeof ui?.prepared_page_mismatch!=='function')throw new Error('La página preparada necesita el módulo Rust de interfaz')
 return ui.prepared_page_mismatch(prepared,wanted,!!allowViewportTranslation)
}

export function createPreparedPageCache(){
 let owner=null,failed=false,disposed=false,unsubscribe=null
 const adopt=ui=>{
  if(owner||failed||disposed||!ui)return owner
  const Native=ui.RustPreparedPageCache
  if(!Native||!CACHE.every(key=>typeof Native.prototype?.[key]==='function')){failed=true;return null}
  try{owner=new Native({generation:0,entry:null,lastBookId:null,lastDiscard:null},rebase)}catch{failed=true}
  return owner
 }
 const ui=getRustUI()
 if(ui)adopt(ui);else unsubscribe=onRustUIReady(adopt)
 return{
  isReady:()=>owner!==null,
  // Resolves true once preparation can begin; false when the module did not arrive in time or is unusable.
  whenReady:()=>owner?Promise.resolve(true):failed||disposed?Promise.resolve(false):loadRustUI().then(ui=>adopt(ui)!==null),
  begin(book){if(!owner)throw new Error('La página preparada necesita el módulo Rust de interfaz');return owner.begin(book)},
  isCurrent:ticket=>owner?owner.isCurrent(ticket):false,
  store:(ticket,key,snapshot)=>owner?owner.store(ticket,key,snapshot):false,
  take:key=>owner?owner.take(key):null,
  has:book=>owner?owner.has(book):book===undefined,
  peek:()=>owner?owner.peek():null,
  invalidate(why='invalidated'){owner?.invalidate(why)},
  invalidateBook(book,why='book-changed'){if(owner?.ownsBook(book))this.invalidate(why)},
  get lastDiscard(){return owner?owner.lastDiscard:null},
  destroy(){if(disposed)return;disposed=true;unsubscribe?.();owner?.free();owner=null}
 }
}
