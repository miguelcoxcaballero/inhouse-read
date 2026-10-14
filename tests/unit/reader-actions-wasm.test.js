import {afterEach,beforeAll,beforeEach,describe,it,expect,vi} from 'vitest'
import {readFileSync} from 'node:fs'
import * as ui from '../../src/wasm/ui/inhouse_read_ui.js'
import {ReaderActions} from '../../src/js/readers/reader-actions.js'
import {legacyReaderActions} from './helpers/reference-reader-actions.js'
const runtime=vi.hoisted(()=>({ui:null}))
vi.mock('../../src/js/rust-ui.js',()=>({getRustUI:()=>runtime.ui}))
let core
beforeAll(()=>{core=ui.initSync({module:readFileSync('src/wasm/ui/inhouse_read_ui_bg.wasm')});runtime.ui=ui})
// 'legacy' runs the frozen original implementation directly; 'Rust' runs the production class.
let engine='Rust'
const original=host=>Object.fromEntries(Object.keys(legacyReaderActions).map(name=>[name,(...args)=>legacyReaderActions[name].call(host,...args)]))
afterEach(()=>vi.restoreAllMocks())
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve}}
const tick=async()=>{for(let i=0;i<12;i++)await Promise.resolve()}
function setup(){
 const events=[],location={locator:{kind:'pdf-page',value:3},fraction:.5},status={textContent:''}
 const host={book:{id:'book'},history:[],bookmarks:[],quotes:[],location,quoteColor:'green',selectedQuoteSelection:null,
  label:()=> 'Page 3',error:message=>events.push(['error',message]),persist:async(id,fields)=>events.push(['persist',id,fields]),
  voice:{browse:()=>events.push(['browse'])},panel:{close:()=>events.push(['close']),querySelector:()=>status},
  reader:{goToTarget:async target=>events.push(['target',target]),goToLocator:async(...args)=>events.push(['locator',...args]),getSelection:()=>null,addQuoteAnnotation:quote=>events.push(['annotation',quote.text,quote.locator]),search:async()=>[],clearSearch:()=>events.push(['clear'])},
  lists:{clearSearch:message=>events.push(['searchStatus',message]),renderSearch:(results,activate)=>{events.push(['results',results]);host.activate=activate}},
  relocate:()=>events.push(['relocate']),renderPlaces:()=>events.push(['render']),showPlaceTab:tab=>events.push(['tab',tab]),jump:place=>events.push(['jump',place])}
 const actions=engine==='legacy'?original(host):new ReaderActions(host);host.savePlaces=()=>actions.savePlaces();return{host,actions,events,status}
}
describe.each(['legacy','Rust'])('%s reader actions',name=>{
 beforeEach(()=>{engine=name;vi.spyOn(Date,'now').mockReturnValue(1234)})
 it('retains origin, waits for its commit, and forwards the exact destination',async()=>{
  const {host,actions,events}=setup(),gate=deferred(),destination={locator:{kind:'cfi',value:'target'},fraction:.8}
  host.persist=vi.fn(()=>gate.promise);const pending=actions.jump(destination,undefined,()=>true)
  await tick();expect(events).toEqual([['browse'],['error','']]);expect(host.history[0]).toEqual({...host.location,label:'Page 3',createdAt:1234})
  gate.resolve();await pending;expect(events.at(-3)).toEqual(['locator',destination.locator,.8]);expect(events.at(-3)[1]).toBe(destination.locator)
  expect(events.slice(-2)).toEqual([['relocate'],['close']])
 })
 it('does not navigate when the book changes during a history write',async()=>{
  const {host,actions,events}=setup(),gate=deferred();let current=true
  host.persist=()=>gate.promise;const pending=actions.jump({locator:null,fraction:1},undefined,()=>current)
  await tick();current=false;gate.resolve();await pending;expect(events).toEqual([['browse'],['error','']])
 })
 it('preserves the selected return record until navigation succeeds',async()=>{
  const {host,actions,events}=setup(),place={locator:host.location.locator,fraction:.1},gate=deferred();host.history=[place]
  host.reader.goToLocator=()=>gate.promise;const pending=actions.returnToReading(place,()=>true)
  await tick();expect(host.history[0]).toBe(place);gate.resolve();await pending;expect(host.history).toEqual([]);expect(events.at(-1)).toEqual(['close'])
 })
 it('retains return history and reports a failed navigation',async()=>{
  const {host,actions,events}=setup(),place={locator:null,fraction:.1};host.history=[place]
  host.reader.goToLocator=()=>{throw Error('engine')};await actions.returnToReading(place,()=>true)
  expect(host.history[0]).toBe(place);expect(events.at(-1)).toEqual(['error','No se pudo volver.'])
 })
 it('does not act on a return record removed while it waited in the navigation queue',async()=>{
  const {actions,events}=setup();await actions.returnToReading({},()=>true);expect(events).toEqual([])
 })
 it('reports a save failure without discarding the bookmark or breaking navigation',async()=>{
  const {host,actions,events}=setup();host.persist=()=>{throw Error('disk')};await actions.addBookmark()
  expect(host.bookmarks).toHaveLength(1);expect(events).toContainEqual(['error','No se pudieron guardar los marcadores.']);expect(events.at(-1)).toEqual(['tab','bookmarks'])
 })
 it('keeps the raw quote for the annotation and normalizes the persisted copy',async()=>{
  const {host,actions,events}=setup(),locator=host.location.locator
  host.reader.getSelection=()=>({text:' selected quotation ',locator});await actions.addQuote()
  expect(host.quotes[0].text).toBe('selected quotation');expect(host.selectedQuoteSelection).toBeNull()
  expect(events.find(x=>x[0]==='annotation')).toEqual(['annotation',' selected quotation ',locator]);expect(events.find(x=>x[0]==='annotation')[2]).toBe(locator)
 })
 it('uses remembered selection when opening the panel removed the live selection',async()=>{
  const {host,actions}=setup();host.selectedQuoteSelection={text:'remembered',locator:host.location.locator};await actions.addQuote();expect(host.quotes[0].text).toBe('remembered')
 })
 it('reports an empty selection without saving anything',async()=>{
  const {actions,events}=setup();await actions.addQuote();expect(events).toEqual([['error','Selecciona un texto primero.']])
 })
 it('returns search result references and preserves an explicit zero fraction',async()=>{
  const {host,actions,events}=setup(),results=[{fraction:0,locator:{kind:'pdf-page',value:1}}];host.reader.search=()=>results
  await actions.search('needle');expect(events.at(-1)[1]).toBe(results);expect(host.searchActive).toBe(true)
  host.activate(results[0]);expect(events.at(-1)).toEqual(['jump',results[0]]);expect(host.keepSearchHits).toBe(true)
  actions.endSearch();expect(events.slice(-2)).toEqual([['clear'],['searchStatus','']]);expect(host.searchActive).toBe(false);expect(host.keepSearchHits).toBe(false)
 })
 it('shows an error when result rendering fails and tolerates a missing clear method',async()=>{
  const {host,actions,status}=setup();host.reader.search=()=>[{}];host.lists.renderSearch=()=>{throw Error('render')}
  await actions.search('x');expect(status.textContent).toBe('No se pudo buscar.');host.reader.clearSearch=null;actions.endSearch();expect(host.searchActive).toBe(false)
 })
})
it('matches two hundred mixed command sequences against the original implementation',async()=>{
 vi.spyOn(Date,'now').mockReturnValue(1234)
 for(let trial=0;trial<200;trial++){
  const outcomes=[]
  for(const name of ['legacy','Rust']){
   engine=name;const {host,actions,events,status}=setup(),destination={locator:{kind:'pdf-page',value:trial+5},fraction:.8}
   if(trial%4===0)host.persist=async()=>{throw Error('disk')}
   if(trial%4===1)host.reader.goToLocator=async()=>{throw Error('navigation')}
   await actions.jump(destination,trial%3?undefined:'#target',()=>true);await actions.returnToReading(host.history[0],()=>true)
   await actions.addBookmark();await actions.addBookmark();host.reader.search=async()=>trial%2?[{fraction:0,locator:destination.locator}]:[]
   await actions.search('needle');if(trial%2)host.activate({fraction:0,locator:destination.locator});actions.endSearch()
   outcomes.push({events,history:host.history,bookmarks:host.bookmarks,status,searchActive:host.searchActive,keep:host.keepSearchHits})
  }
  expect(outcomes[1]).toEqual(outcomes[0])
 }
})
it('releases future handles without increasing WASM memory over repeated commands',async()=>{
 engine='Rust'
 for(let round=0;round<2;round++){
  const before=core.memory.buffer.byteLength
  for(let i=0;i<1000;i++){const {actions}=setup();await actions.addBookmark();await actions.search('x');actions.endSearch()}
  if(round)expect(core.memory.buffer.byteLength).toBe(before)
 }
})
