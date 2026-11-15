import {afterEach,beforeAll,beforeEach,describe,it,expect,vi} from 'vitest'
import {readFileSync} from 'node:fs'
import * as ui from '../../src/wasm/ui/inhouse_read_ui.js'
import {createReadingProgressQueue} from '../../src/js/reading-progress-queue.js'
import {createLegacyReadingProgressQueue} from './helpers/reference-reading-progress-queue.js'
import {rustShelf} from './helpers/rust-shelf-ready.js'
let core
beforeAll(()=>{core=ui.initSync({module:readFileSync('src/wasm/ui/inhouse_read_ui_bg.wasm')})})
afterEach(()=>{vi.restoreAllMocks()})
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {resolve,reject,promise}}
const tick=async()=>{for(let i=0;i<12;i++)await Promise.resolve()}
describe.each(['legacy','Rust'])('%s persistence queue boundaries',engine=>{
 const create=(...args)=>(engine==='Rust'?createReadingProgressQueue:createLegacyReadingProgressQueue)(...args)
 it('uses original Map key identity for objects, NaN, symbols and zero',async()=>{
  const library={updateProgress:vi.fn(async(id,fraction)=>({id,fraction}))},queue=create(library)
  const keys=[{}, {}, Symbol('a'), Symbol('a'), NaN, -0, null, undefined, 'book']
  const tasks=keys.map(id=>queue.updateProgress(id,1,{}))
  expect(queue.updateProgress(NaN,2,{})).toBe(tasks[4]);expect(queue.updateProgress(0,3,{})).toBe(tasks[5])
  const records=await Promise.all(tasks);expect(library.updateProgress).toHaveBeenCalledTimes(keys.length)
  records.forEach((record,index)=>expect(Object.is(record.id,keys[index])).toBe(true))
  expect(records[4].fraction).toBe(2);expect(records[5].fraction).toBe(3)
 })
 it('clones enumerable fields once, retaining nested references and own __proto__',async()=>{
  const nested={},fields=Object.defineProperty({nested},'__proto__',{value:nested,enumerable:true}),read=vi.fn(()=>42)
  Object.defineProperty(fields,'getter',{get:read,enumerable:true})
  const library={patch:vi.fn(async(id,value)=>value)},queue=create(library),promise=queue.patch('book',fields)
  fields.nested=null;const record=await promise
  expect(read).toHaveBeenCalledOnce();expect(record.nested).toBe(nested);expect(Object.hasOwn(record,'__proto__')).toBe(true)
  expect(Object.getPrototypeOf(record)).toBe(Object.prototype);expect(record.__proto__).toBe(nested);expect(record.getter).toBe(42)
 })
 it.each(['storage throw','storage reject','notification throw','notification reject'])('preserves %s identity and continues',async mode=>{
  const failure=new Error(mode),gate=deferred();let first=true
  const fail=()=>{if(mode.endsWith('throw'))throw failure;return Promise.reject(failure)}
  const library={updateProgress:vi.fn(()=>{if(mode.startsWith('storage')&&first){first=false;return fail()}return {ok:true}})}
  const queue=create(library,{onSaved:()=>{if(mode.startsWith('notification')&&first){first=false;return fail()}return gate.promise}})
  const failed=queue.updateProgress('book',1,{}),observed=expect(failed).rejects.toBe(failure)
  await observed;const final=queue.updateProgress('book',2,{});gate.resolve();expect(await final).toEqual({ok:true});expect(queue.get('book')).toBeUndefined()
 })
 it('allows storage callbacks to enqueue a settings barrier without borrow errors',async()=>{
  let queue,next,once=true;const events=[]
  const library={updateProgress:async()=>{events.push('position');if(once){once=false;next=queue.patch('book',{theme:'night'})}return 1},patch:async()=>{events.push('settings');return 2}}
  queue=create(library);expect(await queue.updateProgress('book',1,{})).toBe(1);expect(await next).toBe(2);expect(events).toEqual(['position','settings'])
 })
})
it('retains all pending saves after releasing the host handle',async()=>{
 const gate=deferred(),events=[],queue=new ui.RustReadingProgressQueue(async(id,f)=>{events.push(f);await gate.promise;return f},()=>{},()=>{})
 const first=queue.updateProgress('book',1,{});await tick();const second=queue.updateProgress('book',2,{})
 queue.free();gate.resolve();expect(await first).toBe(1);expect(await second).toBe(2);expect(events).toEqual([1,2])
})
it('reuses drained book slots and bounds WASM memory over thousands of identities',async()=>{
 for(let round=0;round<2;round++){
  const before=core.memory.buffer.byteLength,queue=new ui.RustReadingProgressQueue((id,f)=>f,()=>{},()=>{})
  for(let i=0;i<2000;i++)expect(await queue.updateProgress('book'+i,i,{})).toBe(i)
  queue.free();if(round)expect(core.memory.buffer.byteLength).toBe(before)
 }
})

// Whole sessions against the frozen JavaScript queue: what each book's storage and notification
// were called with, which promise every request got and how each settled, per book and in order.
const random=seed=>()=>{seed=seed+0x6D2B79F5|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}
const quiet=()=>new Promise(resolve=>setTimeout(resolve,0))
const shape=value=>value&&typeof value==='object'?Reflect.ownKeys(value).map(key=>{const own=Object.getOwnPropertyDescriptor(value,key);return[String(key),typeof key,'value'in own?own.value:'accessor',own.enumerable,own.writable,own.configurable]}).concat([[Object.getPrototypeOf(value)===Object.prototype]]):value
const KEYS=['readingTheme','returnLocation','spineColor','coverTilt','shelfSlot','pageEdgeTone','xspine','Cover','progressUpdatedAt','progressDirty','fontSize']
async function session(create,seed,totals){
 // The script draws from one stream; what a book's storage and notification answer comes from that
 // book's own stream, because books are served in parallel and their turns may interleave.
 const next=random(seed),books=['a','b',7],logs=new Map(books.map(id=>[id,[]])),mark=Symbol('mark');let clock=5000,queue
 const own=new Map(books.map((id,index)=>[id,{next:random(seed*31+index),gates:[],replies:0,promises:new Map()}]))
 const now=vi.spyOn(Date,'now').mockImplementation(()=>clock)
 const reply=(id,kind)=>{
  const book=own.get(id),mode=book.next(),n=++book.replies
  if(mode<.08){const error=new Error(kind+n);logs.get(id).push(['throws',error.message]);throw error}
  if(mode<.16)return Promise.reject(new Error(kind+n))
  if(mode<.4){let open;const gate=new Promise((yes,no)=>{open=mode<.3?()=>yes({id,n}):()=>no(new Error('late'+kind))});book.gates.push(open);return gate}
  return mode<.7?{id,n}:Promise.resolve({id,n})
 }
 const library={
  updateProgress(id,fraction,locator){logs.get(id).push(['position',this===library,fraction,locator]);totals.positions++;return reply(id,'position')},
  patch(id,fields){logs.get(id).push(['settings',this===library,shape(fields)]);totals.settings++;return reply(id,'settings')}
 }
 const onSaved=(record,id,fields)=>{
  logs.get(id).push(['saved',record,fields]);totals.saved++
  const book=own.get(id),mode=book.next()
  if(mode<.1)request(id,book.next)
  if(mode<.15)throw new Error('notify')
  if(mode<.3){let open;const gate=new Promise(yes=>{open=yes});book.gates.push(open);return gate}
 }
 const track=(id,promise)=>{
  const promises=own.get(id).promises
  if(!promises.has(promise)){
   const index=promises.size;promises.set(promise,index)
   promise.then(value=>logs.get(id).push(['resolved',index,value]),error=>logs.get(id).push(['rejected',index,error.message]))
  }
  return promises.get(promise)
 }
 function request(id,next){
  const mode=next()
  if(mode<.55){logs.get(id).push(['asked position',track(id,queue.updateProgress(id,next(),{value:next()}))]);return}
  const fields={};for(const key of KEYS)if(next()<.2)fields[key]=next()
  if(next()<.15)Object.defineProperty(fields,'__proto__',{value:{own:true},enumerable:true,writable:true,configurable:true})
  if(next()<.15)Object.defineProperty(fields,'hidden',{value:1,enumerable:false})
  if(next()<.15)Object.defineProperty(fields,'read',{get:()=>{totals.getters++;return 9},enumerable:true})
  if(next()<.15)fields[mark]='symbol'
  const sent=next()<.05?null:fields
  logs.get(id).push(['asked settings',track(id,queue.patch(id,sent))])
  fields.readingTheme='changed after';delete fields.fontSize
 }
 queue=create(library,{onSaved})
 for(let step=0;step<40;step++){
  const id=books[Math.floor(next()*3)],mode=next();clock++
  if(mode<.6)request(id,next)
  else if(mode<.75){const pending=queue.get(id);logs.get(id).push(['get',pending===undefined?undefined:own.get(id).promises.get(pending)])}
  else own.get(id).gates.shift()?.()
  if(next()<.5)await quiet()
 }
 for(let open=true;open;){open=false;for(const book of own.values())if(book.gates.length){book.gates.shift()();open=true}await quiet()}
 for(const id of books)logs.get(id).push(['left',queue.get(id)])
 now.mockRestore()
 return[...logs]
}
it('gives every book the same calls, promises and settlements as the frozen JavaScript queue',async()=>{
 const reference={positions:0,settings:0,saved:0,getters:0},production={positions:0,settings:0,saved:0,getters:0}
 const made=vi.spyOn(rustShelf.RustReadingProgressQueue,'forLibrary')
 for(let seed=1;seed<=120;seed++){
  const expected=await session(createLegacyReadingProgressQueue,seed,reference)
  const actual=await session(createReadingProgressQueue,seed,production)
  expect(actual,`seed ${seed}`).toEqual(expected)
 }
 expect(made).toHaveBeenCalledTimes(120)
 expect(production).toEqual(reference)
 expect(reference.positions).toBeGreaterThan(600);expect(reference.settings).toBeGreaterThan(400);expect(reference.saved).toBeGreaterThan(500);expect(reference.getters).toBeGreaterThan(40)
},60000)
it('keeps no handle of the module per save',async()=>{
 const queue=createReadingProgressQueue({updateProgress:(id,f)=>f,patch:(id,fields)=>fields})
 const round=async count=>{for(let i=0;i<count;i++){await queue.updateProgress('book'+i%5,i,{});await queue.patch('book'+i%5,{readingTheme:i,spineColor:i})}}
 await round(5);const before=rustShelf.shelf_live_handles();await round(400)
 expect(rustShelf.shelf_live_handles()).toBe(before)
})
