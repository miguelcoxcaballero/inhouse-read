import {beforeAll,it,expect} from 'vitest'
import {readFileSync} from 'node:fs'
import * as ui from '../../src/wasm/ui/inhouse_read_ui.js'
import {rustShelf} from './helpers/rust-shelf-ready.js'
import {nativePreparedPage} from './helpers/prepared-page-native.js'
import {createLegacyPreparedPageCache,legacyPageKeyMismatch} from './helpers/reference-prepared-page.js'
// The prepared page is a record the application's state holds (state.preparedPage) and the flows of
// rust-ui/src/prepared_page.rs work on. Both modules that may run the flows are compared here with the
// frozen JavaScript cache: every answer and the whole record after every operation.
beforeAll(()=>ui.initSync({module:readFileSync('src/wasm/ui/inhouse_read_ui_bg.wasm')}))
const modules=[['shelf',()=>rustShelf,()=>rustShelf.shelf_live_handles()],['ui',()=>ui,()=>ui.ui_live_handles()]]
const key=overrides=>({bookId:'book',epoch:3,locator:null,fraction:.5,location:{page:2},viewport:{left:0,top:20,width:390,height:800},pixelRatio:2,preferences:'paper',theme:'light',filter:'none',...overrides})
const page=()=>({source:{pixels:new Uint8Array([1,2,3])},displayBounds:{left:10,top:30,width:200,height:400}})
function random(seed){let s=seed>>>0;return()=>{s=(s+0x6D2B79F5)>>>0;let t=s;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return((t^(t>>>14))>>>0)/4294967296}}
const state=record=>({generation:record.generation,entry:record.entry,lastBookId:record.lastBookId,lastDiscard:record.lastDiscard})

for(const [name,module,handles] of modules){
 it(`${name}: random scripts answer and leave the record exactly as the frozen cache does`,()=>{
  const before=handles();let compared=0,rebased=0,taken=0
  for(let script=0;script<400;script++){
   const next=random(script*7919+11),pick=list=>list[Math.floor(next()*list.length)]
   const native=nativePreparedPage(module()).createPreparedPageCache(),frozen=createLegacyPreparedPageCache()
   const books=['a','a','b',undefined,null,0,''],tickets=[[null,null]]
   const anyKey=()=>key({bookId:pick(books),epoch:pick([3,3,3,3,4]),fraction:pick([.5,.5,.5,'0.5',.5+1e-12,.6,NaN]),locator:pick([null,null,null,undefined,{cfi:'x'}]),
    viewport:pick([{left:0,top:20,width:390,height:800},{left:0,top:20,width:390,height:800},{left:14,top:5,width:390.3,height:800},{left:0,top:20,width:400,height:800},{left:NaN,top:20,width:390,height:800},{left:Infinity,top:20,width:390,height:800}]),
    theme:pick(['light','light','light','dark']),pixelRatio:pick([2,2,2,2,1])})
   const anyPage=()=>pick([page,page,page,page,()=>({source:{},displayBounds:{left:1,top:2,width:0,height:5}}),()=>({source:{}}),()=>({source:{},displayBounds:{left:'1',top:2,width:3,height:4}}),()=>null])()
   for(let step=0;step<30;step++){
    const op=pick(['begin','begin','isCurrent','store','store','store','store','take','take','take','has','peek','invalidate','invalidateBook'])
    let a,b
    if(op==='begin'){const book=pick(books);a=native.begin(book);b=frozen.begin(book);tickets.push([a,b])}
    else if(op==='isCurrent'){const [x,y]=pick(tickets);a=native.isCurrent(x);b=frozen.isCurrent(y)}
    else if(op==='store'){const [x,y]=tickets[pick([tickets.length-1,tickets.length-1,tickets.length-1,Math.floor(next()*tickets.length)])],k=next()<.6?key():anyKey();if(next()<.8)k.bookId=y?.bookId;const snapshot=anyPage();a=native.store(x,k,snapshot);b=frozen.store(y,k,snapshot)}
    else if(op==='take'){
     // The two caches hold the same snapshot object: the frozen one's rebase is undone before the Rust takes it.
     const k=next()<.75&&frozen.transferState().entry?{...frozen.transferState().entry.key,viewport:pick([frozen.transferState().entry.key.viewport,{left:14,top:5,width:390.3,height:800}])}:anyKey()
     const held=frozen.peek(),bounds=held?.displayBounds;b=frozen.take(k);const moved=held?.displayBounds;if(held&&moved!==bounds)held.displayBounds=bounds
     a=native.take(k);if(b)taken++
     if(held&&moved!==bounds){rebased++;expect(held.displayBounds).toEqual(moved);expect(held.displayBounds).not.toBe(bounds);expect(Object.keys(held.displayBounds)).toEqual(Object.keys(moved))}else if(held)expect(held.displayBounds).toBe(bounds)
    }
    else if(op==='has'){const book=pick(books);a=native.has(book);b=frozen.has(book)}
    else if(op==='peek'){a=native.peek();b=frozen.peek()}
    else if(op==='invalidate'){const why=pick(['resize',undefined,'theme']);a=native.invalidate(why);b=frozen.invalidate(why)}
    else{const book=pick(books),why=pick(['removed',undefined]);a=native.invalidateBook(book,why);b=frozen.invalidateBook(book,why)}
    expect(a,`${script}/${step} ${op}`).toEqual(b);if(a&&typeof a==='object'&&op!=='begin')expect(a).toBe(b)
    expect(state(native.record),`${script}/${step} ${op}`).toEqual(frozen.transferState());compared++
   }
  }
  expect(compared).toBe(12000);expect(taken).toBeGreaterThan(100);expect(rebased).toBeGreaterThan(30);expect(handles()).toBe(before)
 })
 it(`${name}: rebases only the destination, keeping the bitmap, symbols, extra fields and their order`,()=>{
  const {createPreparedPageCache}=nativePreparedPage(module())
  for(const make of [createPreparedPageCache,createLegacyPreparedPageCache]){
   const cache=make(),snapshot=page(),symbol=Symbol('destination'),extra={flag:true};snapshot.displayBounds={top:30,extra,left:10,width:200,height:400,[symbol]:extra}
   Object.defineProperty(snapshot.displayBounds,'hidden',{value:1,enumerable:false});Object.defineProperty(snapshot.displayBounds,'computed',{get:()=>7,enumerable:true,configurable:true})
   const original=snapshot.displayBounds,source=snapshot.source;cache.store(cache.begin('book'),key(),snapshot)
   expect(cache.take(key({viewport:{left:30,top:15,width:390,height:800}}))).toBe(snapshot);expect(snapshot.source).toBe(source);expect(snapshot.displayBounds).not.toBe(original)
   expect(Reflect.ownKeys(snapshot.displayBounds)).toEqual(['top','extra','left','width','height','computed',symbol])
   expect(Object.getOwnPropertyDescriptor(snapshot.displayBounds,'computed')).toEqual({value:7,writable:true,enumerable:true,configurable:true})
   expect(snapshot.displayBounds[symbol]).toBe(extra);expect(snapshot.displayBounds.extra).toBe(extra);expect(snapshot.displayBounds.left).toBe(40);expect(snapshot.displayBounds.top).toBe(25)
  }
 })
 it.each(['frozen','getter-only'])(`${name}: keeps the assignment error for a %s snapshot`,kind=>{
  for(const make of [nativePreparedPage(module()).createPreparedPageCache,createLegacyPreparedPageCache]){
   const cache=make(),snapshot=page();if(kind==='frozen')Object.freeze(snapshot);else{const bounds=snapshot.displayBounds;Object.defineProperty(snapshot,'displayBounds',{get:()=>bounds})}
   cache.store(cache.begin('book'),key(),snapshot);expect(()=>cache.take(key({viewport:{left:30,top:15,width:390,height:800}}))).toThrow(TypeError);expect(cache.peek()).toBeNull()
  }
 })
 it(`${name}: keeps the answers for absent book ids and the default reasons`,()=>{
  for(const make of [nativePreparedPage(module()).createPreparedPageCache,createLegacyPreparedPageCache]){
   const cache=make();expect(cache.has(undefined)).toBe(true);expect(cache.has('book')).toBe(false);const ticket=cache.begin(undefined);cache.invalidateBook(undefined);expect(cache.isCurrent(ticket)).toBe(false)
   cache.store(cache.begin('book'),key(),page());cache.invalidate(undefined);expect(cache.lastDiscard).toBe('invalidated')
   cache.store(cache.begin('book'),key(),page());cache.invalidateBook('book');expect(cache.lastDiscard).toBe('book-changed')
  }
 })
 it(`${name}: preserves mismatch priority, coercion and JSON errors`,()=>{
  const {pageKeyMismatch}=nativePreparedPage(module())
  for(const translation of [false,true])for(const change of [{},{bookId:'other'},{epoch:4},{fraction:'0.5'},{fraction:NaN},{locator:{a:1}},{location:{page:3}},{viewport:{left:0,top:20,width:NaN,height:800}},{viewport:{left:9,top:2,width:390,height:800}},{viewport:null},{pixelRatio:1},{preferences:'other'},{theme:'dark'},{filter:'sepia'}])
   expect(pageKeyMismatch(key(),key(change),{allowViewportTranslation:translation})).toBe(legacyPageKeyMismatch(key(),key(change),{allowViewportTranslation:translation}))
  for(const [a,b] of [[null,key()],[key(),undefined],[0,key()],['',key()]])expect(pageKeyMismatch(a,b)).toBe(legacyPageKeyMismatch(a,b))
  const circular={};circular.self=circular;expect(()=>pageKeyMismatch(key({locator:circular}),key())).toThrow(TypeError);expect(()=>pageKeyMismatch(key({fraction:Symbol('fraction')}),key())).toThrow(TypeError)
 })
 it(`${name}: the application's record is made once, on the state, the first time a flow asks for it`,()=>{
  const before=handles(),state={preparationGeneration:0,pageGate:null},host={state}
  module().app_dismiss_prepared_page(host);const record=state.preparedPage
  expect(record).toEqual({generation:1,entry:null,lastBookId:null,lastDiscard:null});expect(Object.keys(record)).toEqual(['generation','entry','lastBookId','lastDiscard'])
  module().app_supersede_preparation(host,'reader-closed');expect(state.preparedPage).toBe(record);expect(record.generation).toBe(2);expect(state.preparationGeneration).toBe(1)
  // A record somebody put there is the one used.
  const own={generation:41,entry:{key:key(),snapshot:page()},lastBookId:'book',lastDiscard:null},other={state:{pageGate:null,preparedPage:own}}
  module().app_dismiss_prepared_page(other);expect(other.state.preparedPage).toBe(own);expect(own).toEqual({generation:42,entry:null,lastBookId:'book',lastDiscard:'dismissed'})
  expect(handles()).toBe(before)
 })
 it(`${name}: two hundred complete lifetimes leave nothing of the page in the module`,()=>{
  const before=handles(),{createPreparedPageCache}=nativePreparedPage(module())
  for(let i=0;i<200;i++){const cache=createPreparedPageCache(),snapshot=page(),ticket=cache.begin('book');cache.store(ticket,key(),snapshot);expect(cache.take(key())).toBe(snapshot);expect(handles()).toBe(before)}
 })
 it(`${name}: an unknown operation is refused`,()=>{expect(()=>module().prepared_page('nothing')).toThrow(TypeError)})
}
