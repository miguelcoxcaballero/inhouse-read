import {it,expect} from 'vitest';
import {closeReader as reference} from './helpers/reference-app-reader-close.js';
import {rustShelf} from './helpers/rust-shelf-ready.js';
const scope=(env,fn)=>new Function('env',`with(env){return (${fn.toString()})}`)(env);
const flush=async()=>{for(let n=0;n<40;n++)await Promise.resolve()};
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return{promise,resolve,reject}};
function fixture(native,options={},module=rustShelf){
 document.body.className='';
 document.body.innerHTML='<main id="reader"></main><nav id="toolbar"></nav>';
 const events=[],state={closingReader:!!options.closing,currentBookId:options.noBook?null:'book:📖:\ud800',requestedPreparationId:'requested',activePreparedBookId:'prepared',cloudRoomChanged:!!options.roomChanged,shelf:null};
 const screen=document.getElementById('reader'),toolbar=document.getElementById('toolbar');toolbar.hidden=false;
 const source=document.createElement('canvas');source.dataset.source='exact-page';
 const snapshot=options.noSnapshot?null:{source:options.noSource?null:source,displayBounds:options.noBounds?null:{left:8,top:40,width:390,height:600},location:options.noPosition?null:{fraction:.32,locator:{kind:'pdf-page',value:7}}};
 const book={id:state.currentBookId,title:'Saved book'};
 const snapshotWait=options.pendingSnapshot?deferred():null,progressWait=options.pendingProgress?deferred():null,returnWait=options.pendingReturn?deferred():null;
 let still=null,fade=null,flight=null;
 const fail=(name)=>{if(options.fail===name)throw Error(name)};
 const documentHost={body:document.body,createElement(tag){still=document.createElement(tag);still.animate=(frames,settings)=>{events.push(['fade',frames,settings]);fail('animate');fade={finished:Promise.resolve(),cancel(){events.push(['cancel-fade']);fail('cancel-fade')}};return fade};return still}};
 const env={document:documentHost,console:{warn:(label,error)=>{events.push(['warn',label,error.message.replace(/^shelf\?\./,'')]);fail('warn')}},els:{readerScreen:screen,readerToolbar:toolbar},
  coverUpgrades:new Map(),progressWrites:{get(id){events.push(['pending',id]);fail('pending');return progressWait?.promise??(options.progressError?Promise.reject(Error('progress')):undefined)}},
  reader:{getPageSnapshot(settings){events.push(['snapshot',settings,state.closingReader]);fail('snapshot-sync');return snapshotWait?.promise??(options.fail==='snapshot'?Promise.reject(Error('snapshot')):Promise.resolve(snapshot))},close(){events.push(['reader-close',state.currentBookId]);fail('close')}},
  readingExperience:{closeVoice:options.legacyVoice?undefined:()=>{events.push(['voice-close']);fail('voice')},voice:{stop(){events.push(['voice-stop']);fail('voice')}},panel:{close(){events.push(['panel-close']);fail('panel')}},reset(){events.push(['reset']);fail('reset')}},
  library:{async updateProgress(...args){events.push(['save',...args]);fail('save')},async get(id){events.push(['get',id]);fail('get');return options.missingBook?null:book}},
  cloudSync:{scheduleProgress(id){events.push(['schedule',id]);fail('schedule')},async flushProgress(id){events.push(['flush',id]);fail('flush')}},
  preparedBooks:new Map([['book',Promise.resolve(true)]]),
  persistablePosition:location=>{events.push(['position',location]);return location},
  hasDriveSession:()=>!options.signedOut,
  setDriveSyncStatus:message=>events.push(['status',message]),
  supersedePreparation:reason=>{events.push(['supersede',reason]);fail('supersede')},
  showScreen:name=>{events.push(['screen',name]);fail('screen')},
  refreshShelf:settings=>{events.push(['refresh',settings]);if(options.fail==='refresh-sync')throw Error('refresh-sync');return options.fail==='refresh'?Promise.reject(Error('refresh')):Promise.resolve()},
  isBookLengthReady:b=>{events.push(['geometry',b?.id]);fail('geometry');return !options.unmeasured},
  readerReturnCanvas:(image,settings)=>{events.push(['pixels',image===source,settings]);fail('pixels');return image},
  getComputedStyle:node=>{events.push(['style',node===screen]);fail('style');return{backgroundColor:'rgb(1, 2, 3)',backgroundImage:'linear-gradient(red, blue)'}},
  matchMedia:query=>{events.push(['media',query]);return{matches:!!options.reduced}}
 };
 if(options.cover)env.coverUpgrades.set(state.currentBookId,{firstCover:options.cover==='first',controller:{abort(){events.push(['abort-cover']);fail('abort')}}});
 if(!options.noShelf)state.shelf={setReturningBook(id){events.push(['returning',id]);fail('returning')},hasReaderOrigin(id){events.push(['origin',id]);fail('origin');return !options.noOrigin},async returnToShelf(id,settings){events.push(['return',id,settings.book===book,settings.pageSnapshot===snapshot]);fail('return');if(!options.noHandoff)settings.onPageReady();if(options.doubleHandoff)settings.onPageReady();return returnWait?.promise??!options.notReturned}};
 if(options.noOriginMethod)delete state.shelf.hasReaderOrigin;
 if(options.noReturnMethod)delete state.shelf.returnToShelf;
 for(const key of Object.keys(state))Object.defineProperty(env,key,{get:()=>state[key],set:v=>state[key]=v,configurable:true});
 const host={...env,state,ignoreCloseError:()=>{},
  closeHandoff:f=>{flight=f;return()=>module.app_return_page_handoff(host,f)},
  closeStillRemoval:f=>()=>module.app_remove_return_page(f),
  closeProgressFlush:id=>()=>module.app_flush_closed_progress(host,id),
  warnClosedProgress:error=>module.app_warn_closed_progress(host,error),
  warnPendingShelf:error=>env.console.warn('Estantería pendiente:',error)};
 const close=native?()=>module.app_close_reader(host):scope(env,reference);
 return{events,state,snapshot,snapshotWait,progressWait,returnWait,close,host,
  summary:()=>({// Native await resumes through the WASM executor. The independent Drive
  // lane may interleave with final cleanup; preserve order and content within
  // both lanes, and assert actual progress-before-close separately below.
  events:events.filter(e=>!['status','flush'].includes(e[0])),background:events.filter(e=>['status','flush'].includes(e[0])),state:{...state,shelf:!!state.shelf},prepared:[...env.preparedBooks.keys()],coverRetained:env.coverUpgrades.get(book.id)?.retainedOnClose,toolbar:toolbar.hidden,classes:document.body.className,still:still?{html:still.outerHTML,connected:still.isConnected}:null,handed:flight?.handedOff})};
}
async function run(native,options={}){
 const f=fixture(native,options);let error;const task=f.close();const started=f.summary();try{await task}catch(e){error=e.message}await flush();
 // The reference keeps its flight lexical; its observable handoff is the fade.
 const summary=f.summary();delete summary.handed;delete started.handed;
 return{started,finished:summary,error};
}
for(const options of [{},{signedOut:true},{legacyVoice:true},{cover:'first'},{cover:'upgrade'},
 {closing:true},{noBook:true},{noSnapshot:true},{noSource:true},{noBounds:true},{noPosition:true},{missingBook:true},
 {noOrigin:true},{unmeasured:true},{noShelf:true},{notReturned:true},{noHandoff:true,notReturned:true},{doubleHandoff:true},{reduced:true},
 {roomChanged:true},{progressError:true},{noOriginMethod:true},{noReturnMethod:true},{fail:'abort',cover:'upgrade'},
 ...['voice','panel','snapshot','snapshot-sync','save','get','pixels','style','supersede','geometry','origin','return','animate','flush','schedule','refresh','refresh-sync'].map(fail=>({fail,noOrigin:fail.startsWith('refresh')}))])
 it(`matches the complete reader return coordinator ${JSON.stringify(options)}`,async()=>{
  const actual=await run(true,options),expected=await run(false,options);
  expect(actual).toEqual(expected);
 });
it('guards duplicate closes synchronously while waiting for the current-page snapshot',async()=>{
 const f=fixture(true,{pendingSnapshot:true});const a=f.close();expect(f.state.closingReader).toBe(true);await f.close();expect(f.events.filter(e=>e[0]==='snapshot')).toHaveLength(1);
 f.snapshotWait.resolve(f.snapshot);await a;expect(f.state.closingReader).toBe(false);
});
it('waits for the last local progress write before closing, without waiting for Drive',async()=>{
 const f=fixture(true,{pendingProgress:true});const task=f.close();await flush();expect(f.events.some(e=>e[0]==='reader-close')).toBe(false);
 f.progressWait.resolve();await task;await flush();expect(f.events.findIndex(e=>e[0]==='save')).toBeLessThan(f.events.findIndex(e=>e[0]==='reader-close'));expect(f.events.some(e=>e[0]==='flush')).toBe(true);
});
it('retains the same pixels until the physical shelf destination hands them off',async()=>{
 const f=fixture(true,{pendingReturn:true,noHandoff:true});const task=f.close();await flush();expect(document.querySelector('.ihr-reader-return-page')).not.toBeNull();
 expect(f.state.closingReader).toBe(true);f.returnWait.resolve(false);await task;await flush();expect(document.querySelector('.ihr-reader-return-page')).toBeNull();expect(f.state.closingReader).toBe(false);
});
it('supports the reader UI module when Shelf has not been downloaded',async()=>{
 const {rustUI}=await import('./helpers/rust-ui-ready.js');const f=fixture(true,{},rustUI);await f.close();expect(f.state.currentBookId).toBeNull();expect(f.state.closingReader).toBe(false);
});
it('releases native handles after repeated successful and failed returns',async()=>{
 await run(true);const handles=rustShelf.shelf_live_handles(),callbacks=rustShelf.shelf_pending_callbacks();
 for(let n=0;n<60;n++)await run(true,[{}, {fail:'snapshot'},{fail:'get'},{notReturned:true},{noSnapshot:true}][n%5]);
 await flush();expect(rustShelf.shelf_live_handles()).toBe(handles);expect(rustShelf.shelf_pending_callbacks()).toBe(callbacks);
});
