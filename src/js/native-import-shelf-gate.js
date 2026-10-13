import {getRustUI} from './rust-ui.js'
import {createLegacyNativeImportShelfGate} from './native-import-shelf-gate-legacy.js'
// Adopt current transfer/reader flags without calling either callback. The
// active import never acquires a second gate or releases its room early.
export function createNativeImportShelfGate({isReaderVisible,refresh}){
 const legacy=createLegacyNativeImportShelfGate({isReaderVisible,refresh});let owner=legacy,disposed=false
 const current=()=>{
  if(owner!==legacy||disposed)return owner
  const Native=getRustUI()?.RustImportShelfGate
  if(!Native||!['setActive','deferRefresh'].every(key=>typeof Native.prototype?.[key]==='function'))return owner
  let next
  try{next=new Native(...legacy.transferState(),isReaderVisible,refresh)}catch{next?.free();return owner}
  legacy.releaseOwnedState();owner=next;return owner
 }
 return{setActive:value=>current().setActive(value),deferRefresh:()=>current().deferRefresh(),
  destroy(){if(disposed)return;disposed=true;if(owner!==legacy)owner.free();legacy.releaseOwnedState();owner=legacy}}
}
