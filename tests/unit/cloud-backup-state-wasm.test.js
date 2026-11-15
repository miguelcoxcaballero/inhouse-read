// The sync checkpoints of a device (rust-ui/src/backup_state.rs behind src/js/cloud-backup-state.js) against
// the frozen JavaScript store (tests/unit/helpers/reference-cloud-backup-state.js), both on the same
// IndexedDB database (fake-indexeddb), each under its own keys.
import {expect,it,vi} from 'vitest'
import {rustUI as ui} from './helpers/rust-ui-ready.js'
import * as production from '../../src/js/cloud-backup-state.js'
import * as reference from './helpers/reference-cloud-backup-state.js'

const random=seed=>()=>{seed=seed+0x6D2B79F5|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}
const outcome=promise=>promise.then(value=>['ok',value&&typeof value.type==='string'&&'target' in value?{event:value.type,store:value.target?.objectStoreNames?.[0]}:value],error=>['error',error?.name,error?.message])
const FIELDS=['title','author','progressFraction','spineColor','readingTheme'],BOOKS=['drive-1','drive-2','árbol 🌳','__proto__','constructor']
function checkpoint(next,poison){
 const stamp=()=>({value:next()<.2?{nested:[next(),'x']}:next()<.5?Math.floor(next()*5):'v'+Math.floor(next()*5),at:Math.floor(next()*6),device:'device-'+Math.floor(next()*3)})
 const fields=()=>{const out={};for(const field of FIELDS)if(next()<.5)out[field]=stamp();return out}
 const books={};for(const id of BOOKS)if(next()<.45)Object.defineProperty(books,id,{value:fields(),enumerable:true,writable:true,configurable:true})
 const value={books,settings:fields()}
 if(next()<.1)delete value.books;if(next()<.1)delete value.settings
 // Something IndexedDB cannot store: the write fails inside its transaction.
 if(poison)(value.settings||=({})).poison={value:()=>{},at:99,device:'device-z'}
 return value
}
async function session(store,prefix,seed,totals){
 const next=random(seed),keys=['a','b','c'].map(key=>`${prefix}:${seed}:${key}`),log=[]
 for(let step=0;step<14;step++){
  // A group of calls made in the same turn: their transactions are served in the order they were made.
  const group=[]
  for(let count=1+Math.floor(next()*4);count>0;count--){
   const key=keys[Math.floor(next()*keys.length)],mode=next(),poison=next()<.08
   totals.calls++
   if(mode<.3)group.push(outcome(store.readBackupCheckpoint(key)))
   else if(mode<.6){totals.saves++;group.push(outcome(store.saveBackupCheckpoint(key,checkpoint(next,poison))))}
   else if(mode<.95){totals.merges++;group.push(outcome(store.mergeBackupCheckpoint(key,checkpoint(next,poison))))}
   // A key IndexedDB refuses.
   else group.push(outcome(mode<.97?store.readBackupCheckpoint({bad:1}):store.saveBackupCheckpoint([{}],checkpoint(next,false))))
  }
  const settled=await Promise.all(group);for(const result of settled)if(result[0]==='error')totals.errors++
  log.push(settled,await Promise.all(keys.map(key=>store.readBackupCheckpoint(key))))
 }
 return log
}
// First in the file: neither store has opened the database yet.
it('forgets an open that failed and tries again; then opens the database once',async()=>{
 const blocked=()=>{const request={};queueMicrotask(()=>{request.error=new DOMException('blocked','UnknownError');request.onerror(new Event('error'))});return request}
 for(const store of [reference,production]){
  const open=vi.spyOn(indexedDB,'open').mockImplementationOnce(blocked)
  await expect(store.readBackupCheckpoint('open')).rejects.toMatchObject({name:'UnknownError',message:'blocked'})
  expect(await store.readBackupCheckpoint('open')).toEqual({books:{},settings:{}})
  await store.saveBackupCheckpoint('open',{books:{},settings:{}});await store.mergeBackupCheckpoint('open',{books:{},settings:{}})
  expect(open).toHaveBeenCalledTimes(2);expect(open).toHaveBeenLastCalledWith('inhouse-read-cloud-state',1);open.mockRestore()
 }
})
it('reads, replaces and merges checkpoints as the frozen JavaScript store does',async()=>{
 const expected={calls:0,saves:0,merges:0,errors:0},actual={calls:0,saves:0,merges:0,errors:0}
 for(let seed=1;seed<=60;seed++){
  const frozen=await session(reference,'frozen',seed,expected)
  const made=await session(production,'rust',seed,actual)
  expect(made,`seed ${seed}`).toEqual(frozen)
 }
 expect(actual).toEqual(expected)
 expect(expected.calls).toBeGreaterThan(1800);expect(expected.saves).toBeGreaterThan(500);expect(expected.merges).toBeGreaterThan(600);expect(expected.errors).toBeGreaterThan(150)
},120000)
it('answers an empty checkpoint for an unknown key, resolves a save with its completion event and a merge with what it stored',async()=>{
 for(const [store,key] of [[reference,'shape:frozen'],[production,'shape:rust']]){
  expect(await store.readBackupCheckpoint(key)).toEqual({books:{},settings:{}})
  const saved=await store.saveBackupCheckpoint(key,{books:{file:{title:{value:'old',at:1,device:'a'}}},settings:{}})
  expect(saved.type).toBe('complete');expect(saved.target.objectStoreNames[0]).toBe('checkpoints')
  const merged=await store.mergeBackupCheckpoint(key,{books:{file:{title:{value:'new',at:2,device:'b'}}},settings:{theme:{value:'dark',at:1,device:'b'}}})
  expect(merged).toEqual({books:{file:{title:{value:'new',at:2,device:'b'}}},settings:{theme:{value:'dark',at:1,device:'b'}}})
  expect(await store.readBackupCheckpoint(key)).toEqual(merged)
  // An older write merged afterwards does not take a newer field back.
  await store.mergeBackupCheckpoint(key,{books:{file:{title:{value:'older',at:1,device:'a'}}},settings:{}})
  expect((await store.readBackupCheckpoint(key)).books.file.title.value).toBe('new')
  // A failed write leaves what was there.
  await expect(store.mergeBackupCheckpoint(key,{books:{},settings:{bad:{value:()=>{},at:9,device:'a'}}})).rejects.toMatchObject({name:'DataCloneError'})
  await expect(store.saveBackupCheckpoint(key,{books:()=>{}})).rejects.toMatchObject({name:'DataCloneError'})
  expect(await store.readBackupCheckpoint(key)).toEqual(merged)
 }
})
it('keeps no handle of the module after its calls settle, failed ones included',async()=>{
 const round=async count=>{for(let i=0;i<count;i++){
  await production.saveBackupCheckpoint('level',{books:{},settings:{n:{value:i,at:i,device:'a'}}});await production.mergeBackupCheckpoint('level',{books:{},settings:{m:{value:i,at:i,device:'a'}}});await production.readBackupCheckpoint('level')
  await production.mergeBackupCheckpoint('level',{books:{},settings:{bad:{value:()=>{},at:1e9,device:'a'}}}).catch(()=>{});await production.saveBackupCheckpoint('level',{books:()=>{}}).catch(()=>{});await production.readBackupCheckpoint({bad:1}).catch(()=>{})
 }}
 await round(3);const before=ui.ui_live_handles();await round(40);expect(ui.ui_live_handles()).toBe(before)
})
