import {afterEach,expect,it,vi} from 'vitest'
import {rustUI as ui} from './helpers/rust-ui-ready.js'
import {referenceExperiencePolicy} from './helpers/reference-reader-experience-policy.js'
import {normalizeReadingPreferences,rateLabel} from '../../src/js/readers/reading-preferences.js'
import {clonePlace} from '../../src/js/readers/reading-state.js'
import {isBookmarked} from '../../src/js/readers/reading-places.js'
import {displayBookTitle} from '../../src/js/book-title.js'
import {readerIcon} from '../../src/js/readers/reader-interface.js'

const Reference=referenceExperiencePolicy({normalizeReadingPreferences,clonePlace,isBookmarked,displayBookTitle,rateLabel,readerIcon,readerUI:()=>ui})
const kit={title:displayBookTitle,rate:rateLabel,icon:readerIcon,
 metadata:(host,value,record,epoch)=>Promise.resolve(value).then(value=>ui.reader_experience_metadata(host,record,epoch,value)).catch(()=>{}),
 current:(host,book,generation)=>()=>ui.reader_experience_current(host,book,generation),
 returnAction:(host,place)=>current=>host.actions.returnToReading(place,current),
 labels:(host,places)=>places.map(place=>ui.reader_experience_place_label(host,place)),
 select:(host,name)=>(index,place)=>ui.reader_experience_select_place(host,name,index,place),
 remove:(host,name,places)=>async index=>ui.reader_experience_remove_place(host,name,places,index),
 toc:host=>href=>host.jump(null,href),revoker:url=>()=>URL.revokeObjectURL(url)}
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return {promise,resolve,reject}}
const flush=async()=>{for(let n=0;n<8;n++)await Promise.resolve()}
function setup(native=true){
 const events=[],host=new Reference()
 Object.assign(host,{book:{id:'a',title:'Test'},preferences:normalizeReadingPreferences(),history:[],bookmarks:[],quotes:[],lengthMetadata:{wordCount:21600,wordCountComplete:true},
  reader:{epoch:4,s:{},location:{fraction:.25,locator:{kind:'cfi',value:'here'},section:'Chapter',page:'2'},pageCount:23,toc:[],
   next:()=>events.push(['next']),prev:()=>events.push(['prev']),removeQuoteAnnotation:quote=>events.push(['removeQuote',quote])},
  voice:{state:'stopped',browsing:false,continueFromPage:action=>{events.push(['continue']);return action()}},
  navigation:{generation:7,enqueue:(action,current)=>{events.push(['enqueue',current()]);host.pendingCurrent=current;return action(current)}},
  actions:{returnToReading:(place,current)=>events.push(['return',place,current()])},
  view:Object.fromEntries(['relocate','updateReadingMetrics','showTab','showPlaceTab','updateMiniPlayer','updateBookmarkButton','updateReturnButton'].map(name=>[name,(...args)=>events.push([name,...args])])),
  onLengthMetadata:(...args)=>events.push(['metadata',...args]),endSearch:()=>events.push(['endSearch']),applyPreferences:()=>events.push(['applyPreferences']),
  panel:{close:()=>events.push(['close'])},error:message=>events.push(['error',message])})
 host.location=clonePlace(host.reader.location)
 if(native){Object.assign(host,{
  resetAppearance:()=>ui.reader_experience_reset_appearance(host,normalizeReadingPreferences),
  open:record=>ui.reader_experience_open(host,record,kit),relocate:()=>ui.reader_experience_relocate(host,clonePlace),
  readingMetrics:()=>ui.reader_experience_metrics(host),updateReadingMetrics:()=>ui.reader_experience_update_metrics(host),
  label:place=>ui.reader_experience_label(host,place),showTab:name=>ui.reader_experience_show_tab(host,name),showPlaceTab:name=>ui.reader_experience_place_tab(host,name),
  updateMiniPlayer:(state=host.voice?.state,message='')=>ui.reader_experience_mini_player(host,state,message,kit),
  updateBookmarkButton:()=>ui.reader_experience_bookmark(host,isBookmarked),queueNavigation:action=>ui.reader_experience_queue(host,action,kit),
  returnToReading:(index=0)=>ui.reader_experience_return(host,index,kit),formatSize:(bytes=0)=>ui.reader_experience_size(bytes),
  renderPlaces:()=>ui.reader_experience_places(host,kit),renderToc:()=>ui.reader_experience_toc(host,kit),
  step:direction=>host.queueNavigation(()=>host.voice.continueFromPage(()=>ui.reader_experience_page_step(host,direction))),
  updateReturnButton:()=>ui.reader_experience_return_button(host),
  rotateReading:async()=>ui.reader_experience_rotate(host),shareBook:async()=>ui.reader_experience_share(host,kit),
 })}
 return {host,events}
}
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();localStorage.clear();document.body.innerHTML=''})

it.each(['{}','{"theme":"amoled","margin":0,"voice":"invalid"}','broken','null','0'])('initializes stored preferences without starting any browser work: %s',value=>{
 localStorage.setItem('inhouse-read-reading-preferences',value)
 const host={};ui.reader_experience_init(host,normalizeReadingPreferences);ui.reader_experience_selection_init(host)
 let preferences;try{preferences=normalizeReadingPreferences(JSON.parse(value))}catch{preferences=normalizeReadingPreferences()}
 expect(host).toEqual({history:[],bookmarks:[],quotes:[],location:{fraction:0,locator:null},preferences,selectedQuoteSelection:null,quoteColor:'yellow'})
})
it('falls back after storage access or normalization fails, and propagates a failing fallback',()=>{
 const error=Error('blocked'),normalize=vi.fn().mockImplementationOnce(()=>{throw error}).mockReturnValue({fallback:true})
 const host={};ui.reader_experience_init(host,normalize);expect(normalize.mock.calls).toEqual([[{}],[]]);expect(host.preferences).toEqual({fallback:true})
 expect(()=>ui.reader_experience_init({},()=>{throw error})).toThrow(error)
})
it('preserves audio choices when resetting appearance',()=>{
 const outputs=[]
 for(const native of [false,true]){const {host,events}=setup(native);host.preferences={...host.preferences,theme:'amoled',margin:0,rate:1.5,voiceLang:'en'};host.resetAppearance();outputs.push({preferences:host.preferences,events})}
 expect(outputs[1]).toEqual(outputs[0])
})
it.each(['keep','different-book','same-book-new-epoch','null','metadata-failed','callback-failed','complete'])('preserves opening identity and session ownership: %s',async mode=>{
 const outputs=[]
 for(const native of [false,true]){
  const {host,events}=setup(native),count=deferred(),opening=deferred(),record={id:'fresh',wordCountComplete:mode==='complete'}
  host.lifecycle={open:record=>{events.push(['open']);host.book=record;return opening.promise}}
  host.reader.getLengthMetadata=()=>{events.push(['count']);return count.promise}
  host.relocate=()=>events.push(['relocate'])
  if(mode==='callback-failed')host.onLengthMetadata=()=>{events.push(['metadata-failed']);throw Error('persist failed')}
  expect(host.open(record)).toBe(opening.promise);expect(host.lengthMetadata).toBe(record)
  const synchronous=[...events]
  if(mode==='different-book')host.book={id:'other'}
  if(mode==='same-book-new-epoch')host.reader.epoch++
  if(mode==='metadata-failed')count.reject(Error('count failed'));else count.resolve(mode==='null'?null:{wordCount:600,wordCountComplete:true})
  await flush();outputs.push({synchronous,events,lengthMetadata:host.lengthMetadata});opening.resolve()
 }
 expect(outputs[1]).toEqual(outputs[0])
})
it('merges late metadata without changing the record prototype, symbols or UTF-16 strings',()=>{
 const {host,events}=setup(),symbol=Symbol('metadata'),record={id:'\ud800',old:1},metadata={...JSON.parse('{"__proto__":{"safe":true}}'),[symbol]:'\ud801'}
 host.book=record;host.relocate=()=>events.push(['relocate'])
 ui.reader_experience_metadata(host,record,host.reader.epoch,metadata)
 expect(Object.getPrototypeOf(host.lengthMetadata)).toBe(Object.prototype);expect(Object.hasOwn(host.lengthMetadata,'__proto__')).toBe(true)
 expect(host.lengthMetadata[symbol]).toBe('\ud801');expect(record).toEqual({id:'\ud800',old:1})
})
it.each([
 {locator:{kind:'pdf-page',value:3}}, {locator:{kind:'pdf-page',value:'\ud800'}},
 {section:'Capítulo',page:12}, {section:'\ud800',page:0}, {section:'',fraction:.349}, {fraction:NaN},
 {fraction:-.005}, {fraction:'0.42'}, {fraction:Infinity}, {fraction:null}, {fraction:undefined},
])('keeps exact location labels %#',place=>{
 const {host:legacy}=setup(false),{host:native}=setup()
 expect(native.label(place)).toBe(legacy.label(place))
})
it('converts labels in template evaluation order and propagates a Symbol error without retaining handles',()=>{
 for(const native of [false,true]){
  const {host}=setup(native),seen=[]
  const place={locator:{kind:'pdf-page',value:{toString(){seen.push('page');return '3'}}}}
  Object.defineProperty(host.reader,'pageCount',{get(){seen.push('count');return 8}})
  expect(host.label(place)).toBe('Página 3 de 8');expect(seen).toEqual(['page','count','count'])
 }
 const {host}=setup();host.label({fraction:.5});const count=ui.ui_live_handles()
 for(let n=0;n<100;n++)expect(()=>host.label({section:Symbol()})).toThrow(TypeError)
 expect(ui.ui_live_handles()).toBe(count)
})
it.each([0,1,1024,1536,1048575,1048576,10485760,-300,NaN,Infinity,-Infinity,'2000',null,undefined])('keeps size formatting for %s',bytes=>{
 expect(setup().host.formatSize(bytes)).toBe(setup(false).host.formatSize(bytes))
})
it('retains numeric coercion and errors for sizes and direction',async()=>{
 const outputs=[]
 for(const native of [false,true]){
  const {host,events}=setup(native);let conversions=0
  const size=host.formatSize({valueOf(){conversions++;return 2048}})
  for(const direction of [-1,0,1,'2',NaN,2n,-2n])await host.step(direction)
  expect(()=>host.formatSize(2n)).toThrow(TypeError);expect(()=>host.formatSize({valueOf:()=>2n})).toThrow(TypeError)
  outputs.push({size,conversions,events})
 }
 expect(outputs[1]).toEqual(outputs[0])
})
it('preserves relocation, metrics, bookmark state and player messages across reading/audio states',()=>{
 const outputs=[]
 for(const native of [false,true]){
  const {host,events}=setup(native);host.bookmarks=[clonePlace(host.reader.location)]
  for(const state of ['stopped','playing','paused','loading',undefined]){
   host.voice.state=state;host.relocate();host.updateMiniPlayer(state,'Loading natural voice…');host.updateReturnButton()
  }
  host.showTab('search');host.showTab('audio');host.showPlaceTab('quotes');outputs.push({location:host.location,events})
 }
 expect(outputs[1]).toEqual(outputs[0])
})
it('keeps queued navigation tied to book identity and the cancellation generation',async()=>{
 for(const native of [false,true]){
  const {host}=setup(native),book=host.book,action=vi.fn(()=>42)
  expect(host.queueNavigation(action)).toBe(42);expect(host.pendingCurrent()).toBe(true)
  host.book={...book};expect(host.pendingCurrent()).toBe(false);host.book=book;expect(host.pendingCurrent()).toBe(true)
  host.navigation.generation++;expect(host.pendingCurrent()).toBe(false)
  host.book=null;expect(await host.queueNavigation(action)).toBeUndefined();expect(action).toHaveBeenCalledOnce()
  expect(await host.returnToReading(17)).toBeUndefined()
 }
})
it('renders list snapshots and preserves selection and removal save ordering',async()=>{
 const outputs=[]
 for(const native of [false,true]){
  const {host,events}=setup(native),saved=deferred(),callbacks=new Map()
  host.history=[{label:'History',fraction:.2}];host.bookmarks=[{fraction:.3}];host.quotes=[{label:'Quote',text:'A quote'}]
  host.lists={renderPlaces:(name,places,labels,select,remove,icon)=>{events.push(['list',name,[...places],labels,icon]);callbacks.set(name,{select,remove})}}
  host.savePlaces=()=>{events.push(['save']);return saved.promise};host.jump=(...args)=>events.push(['jump',...args])
  host.renderPlaces();callbacks.get('history').select(0,host.history[0]);callbacks.get('bookmarks').select(0,host.bookmarks[0])
  const pending=callbacks.get('quotes').remove(0);expect(host.quotes).toEqual([])
  expect(events.at(-2)).toEqual(['removeQuote',{label:'Quote',text:'A quote'}]);expect(events.at(-1)).toEqual(['save'])
  const beforeSave=events.length;await flush();expect(events).toHaveLength(beforeSave)
  saved.resolve();await pending;outputs.push(events)
 }
 expect(outputs[1]).toEqual(outputs[0])
})
it('does not rerender a removed quote when persistence fails',async()=>{
 for(const native of [false,true]){
  const {host}=setup(native),failure=Error('write failed');host.quotes=[{text:'Quote'}]
  let remove;host.lists={renderPlaces:(name,_places,_labels,_select,callback)=>{if(name==='quotes')remove=callback}}
  host.savePlaces=()=>Promise.reject(failure);host.renderPlaces();host.renderPlaces=vi.fn()
  await expect(remove(0)).rejects.toBe(failure);expect(host.renderPlaces).not.toHaveBeenCalled();expect(host.quotes).toEqual([])
 }
})
it.each([false,true])('keeps the available table-of-contents tab and hyperlink adapter: %s',available=>{
 const outputs=[]
 for(const native of [false,true]){const {host,events}=setup(native);host.jump=(...args)=>events.push(['jump',...args]);host.lists={renderToc:(toc,select)=>{select('chapter.xhtml');return available}};host.renderToc();outputs.push(events)}
 expect(outputs[1]).toEqual(outputs[0])
})
it('only remembers nonempty selections belonging to the reader and retains quote identity',()=>{
 document.body.innerHTML='<section><button>Inside</button><p>Text</p></section><button id="outside">Outside</button>'
 const {host}=setup();host.screen=document.querySelector('section');ui.reader_experience_selection_init(host)
 host.reader.getSelection=vi.fn(()=> 'Selected text');document.querySelector('#outside').focus()
 vi.spyOn(window,'getSelection').mockReturnValue({anchorNode:{parentElement:document.body}})
 ui.reader_experience_selection_changed(host);expect(host.reader.getSelection).not.toHaveBeenCalled()
 document.querySelector('section button').focus();ui.reader_experience_selection_changed(host)
 expect(host.selectedQuoteSelection).toEqual({text:'Selected text',locator:host.reader.location.locator})
 const quote={text:'Quote',locator:{kind:'cfi',value:'\ud800'}};host.reader.getSelection.mockReturnValue(quote)
 ui.reader_experience_selection_changed(host);expect(host.selectedQuoteSelection).toBe(quote)
 ui.reader_experience_remember_selection(host,{text:''});expect(host.selectedQuoteSelection).toBe(quote)
})
it.each(['portrait-primary','landscape-primary','missing','reject'])('preserves rotation API behavior and errors: %s',async mode=>{
 const outputs=[]
 for(const native of [false,true]){
  const {host,events}=setup(native),lock=deferred()
  vi.stubGlobal('screen',{orientation:mode==='missing'?undefined:{type:mode,lock:target=>{events.push(['lock',target]);return lock.promise}}})
  const pending=host.rotateReading();const synchronous=[...events]
  if(mode==='reject')lock.reject(Error('unsupported'));else lock.resolve()
  await pending;outputs.push({synchronous,events})
 }
 expect(outputs[1]).toEqual(outputs[0])
})
it.each(['no-content','native','abort','failure','download'])('preserves sharing and download behavior: %s',async mode=>{
 const outputs=[]
 for(const native of [false,true]){
  const {host,events}=setup(native),share=deferred();let revoke
  host.book={title:'Títulø',format:'EPUB',content:mode==='no-content'?undefined:new Blob(['book bytes'],{type:'application/epub+zip'})}
  vi.stubGlobal('navigator',{canShare:({files})=>{events.push(['canShare',files[0].name,files[0].type,files[0].size]);return mode!=='download'},share:({title,files})=>{events.push(['share',title,files[0].name]);return share.promise}})
  vi.stubGlobal('URL',{createObjectURL:file=>{events.push(['url',file.name]);return 'blob:test'},revokeObjectURL:url=>events.push(['revoke',url])})
  const timeout=vi.spyOn(globalThis,'setTimeout').mockImplementation((fn,ms)=>{revoke=fn;events.push(['timeout',ms]);return 17})
  const click=vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(function(){events.push(['click',this.href,this.download])})
  const pending=host.shareBook(),synchronous=[...events]
  if(mode==='abort')share.reject(Object.assign(Error('cancelled'),{name:'AbortError'}));else if(mode==='failure')share.reject(Error('share failed'));else share.resolve()
  await pending;revoke?.();outputs.push({synchronous,events});timeout.mockRestore();click.mockRestore()
 }
 expect(outputs[1]).toEqual(outputs[0])
})
it('keeps a fresh sharing file list and catches a failed panel lookup after native sharing',async()=>{
 const outputs=[]
 for(const native of [false,true]){
  const {host,events}=setup(native);host.book={title:'Book',content:new Blob(['book'])}
  vi.stubGlobal('navigator',{canShare:({files})=>{files.length=0;return true},share:async({files})=>events.push(['files',files.length])})
  Object.defineProperty(host,'panel',{get(){throw Error('panel closed')}})
  await host.shareBook();outputs.push(events)
 }
 expect(outputs[1]).toEqual(outputs[0]);expect(outputs[1]).toEqual([['files',1],['error','No se pudo compartir.']])
})
it('releases completed and failed policy calls without retaining JS handles or callback closures',async()=>{
 async function run(){
  const {host}=setup();host.relocate();host.updateMiniPlayer();host.queueNavigation(()=>undefined)
  host.history=[{label:'Return'}];host.returnToReading();host.updateReturnButton()
  const failure=Error('conversion');for(let n=0;n<4;n++)expect(()=>host.formatSize({valueOf(){throw failure}})).toThrow(failure)
  const places=[{}];host.savePlaces=()=>Promise.resolve();host.renderPlaces=()=>{}
  await ui.reader_experience_remove_place(host,'history',places,0);await flush()
 }
 await run();const baseline=ui.ui_live_handles();for(let n=0;n<100;n++)await run();await flush();expect(ui.ui_live_handles()).toBe(baseline)
})
