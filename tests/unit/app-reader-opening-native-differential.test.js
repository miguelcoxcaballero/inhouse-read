import {it,expect} from 'vitest';
import * as reference from './helpers/reference-app-reader-opening.js';
import {rustShelf} from './helpers/rust-shelf-ready.js';
const scope=(env,fn)=>new Function('env',`with(env){return (${fn.toString()})}`)(env);
const flush=async()=>{for(let n=0;n<40;n++)await Promise.resolve()};
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return{promise,resolve,reject}};
function fixture(native,options={},module=rustShelf){
 document.body.className='';document.body.innerHTML='<main id="reader"><div class="pdf-page-wrap"><canvas class="pdf-page-canvas"></canvas></div></main><nav id="toolbar"></nav>';
 const events=[],timers=[],listeners=new Map(),state={activeOpeningContext:null,pendingLocalReopenId:null,pendingReaderTransition:null,currentBookId:'book:📖:\ud800',activePreparedBookId:'book:📖:\ud800'};
 const screen=document.getElementById('reader'),toolbar=document.getElementById('toolbar');screen.hidden=!!options.hidden;toolbar.hidden=true;
 const book={id:state.currentBookId,title:'Selected title',name:'stored.pdf',mimeType:'application/pdf',sourceType:options.source||'local',content:options.noContent?null:new Blob(['saved'],{type:'application/pdf'}),folderFileName:options.folder?'folder.pdf':null,driveFileId:options.drive?'drive-file':null};
 const record={...book,title:'Latest title'};let active=!options.inactive,cancel,openCount=0,transition,flight;
 if(options.namesGetter)Object.defineProperty(book,'title',{get(){throw Error('unused title getter')}});
 const interrupt=at=>{if(options.cancelAt===at)active=false;if(options.switchAt===at)state.currentBookId='other';if(options.newOwnerAt===at)state.activeOpeningContext={newer:true}};
 const failure=at=>{if(options.fail===at)throw Error(at)};
 const bounds={left:12,top:40,width:360,height:600},snapshot=options.noSnapshot?null:{sourceType:'pdf-canvas',displayBounds:bounds};
 const revealWait=options.pendingReveal?deferred():null,preparedWait=options.pendingPrepared?deferred():null;
 const ctx={isActive:()=>active,onCancel(callback){events.push(['onCancel']);failure('onCancel');cancel=callback},async finish(settings){events.push(['finish',settings.pageSnapshot===snapshot,typeof settings.animatePage]);failure('finish');interrupt('finish');return !options.finishFalse},close(settings){events.push(['close',settings]);failure('close');active=false;return'closed'}};
 if(options.noActive)delete ctx.isActive;if(options.noFinish)delete ctx.finish;if(options.noOnCancel)delete ctx.onCancel;
 if(options.preparedMismatch)state.activePreparedBookId='other';
 const env={document,book,ctx,els:{readerScreen:screen,readerToolbar:toolbar,filePicker:{click(){events.push(['picker']);failure('picker')}}},
  readingExperience:{},preparedBooks:new Map(),console:{warn:(label,error)=>events.push(['warn',label,error.message])},
  window:{addEventListener(name,callback,settings){events.push(['listen',name,settings]);listeners.set(name,callback)},removeEventListener(name,callback){events.push(['unlisten',name]);if(listeners.get(name)===callback)listeners.delete(name)}},
  requestAnimationFrame:callback=>{events.push(['raf']);queueMicrotask(()=>callback());return 1},setTimeout:(callback,delay)=>{events.push(['timer',delay]);timers.push({callback,delay});return timers.length},
  showScreen:name=>events.push(['screen',name]),refreshSelectedBookNames:(experience,b)=>events.push(['names',experience===env.readingExperience,b===book]),
  revealPreparedReader:()=>{events.push(['reveal']);failure('reveal');interrupt('reveal');return revealWait?.promise??Promise.resolve()},
  library:{async get(id){events.push(['get',id]);failure('get');interrupt('get');return options.missingRecord?null:record}},
  markTiming:name=>events.push(['timing',name]),
  openingPageSnapshot:async(id,r)=>{events.push(['snapshot',id,r===record?'latest':'selected']);failure('snapshot');interrupt('snapshot');return snapshot},
  releasePageGate:(...args)=>events.push(['gate',...args]),extractCoverInBackground:r=>{events.push(['cover',r===record]);failure('cover')},
  needsDriveDownload:b=>{events.push(['needs-download',b===book]);return!!options.download},
  openFile:async(file,settings)=>{openCount++;transition=settings.transition;events.push(['open',file.name,file.type,file.size,{id:settings.existingRecord.id,latest:settings.existingRecord===record,forcedId:settings.forcedId,reuse:settings.reuseStoredContent},settings.transition.isActive()]);failure('open');if(options.firstOpenFails&&openCount===1)throw Error('first-open');interrupt('open');if(options.fireError)settings.transition.onReaderError();else if(options.fireReady)await settings.transition.onReaderReady();return true},
  isFolderApiSupported:()=>{events.push(['folder-api']);return !options.noFolderApi},
  getSavedFolderHandle:async()=>{events.push(['folder-handle']);failure('folder-handle');return options.noFolderHandle?null:{folder:true}},
  ensureFolderPermission:async h=>{events.push(['permission',h.folder]);failure('permission');return !options.denied},
  readFileFromFolder:async(h,name)=>{events.push(['folder-file',h.folder,name]);failure('folder-file');interrupt('folder-file');return options.missingFile?null:new File(['folder'],'folder.pdf',{type:'application/pdf'})},
  cloudSync:{async downloadForOffline(b){events.push(['download',b===book]);failure('download');interrupt('download');return new File(['remote'],'remote.pdf',{type:'application/pdf'})}},
  alert:message=>events.push(['alert',message])
 };
 for(const key of Object.keys(state))Object.defineProperty(env,key,{get:()=>state[key],set:v=>state[key]=v,configurable:true});
 const host={...env,state,
  openingCallbacks:f=>{flight=f;return{isActive:()=>module.app_opening_is_active(f),onReaderReady:()=>module.app_reader_ready(host,f),onReaderError:()=>module.app_close_reader_opening(host,f)}},
  openingCancellation:f=>()=>module.app_cancel_reader_opening(host,f),
  revealReaderToolbar:()=>module.app_reveal_reader_toolbar(host),settleReaderToolbar:()=>module.app_settle_reader_toolbar(host),
  pickerCancellation:f=>()=>module.app_cancel_opening_picker(host,f),
  filePickerFocusListener:f=>function onFocusBack(){env.window.removeEventListener('focus',onFocusBack);module.app_schedule_picker_cancel(host,f)},
  readerPageFrames:()=>new Promise(resolve=>env.requestAnimationFrame(()=>env.requestAnimationFrame(resolve)))
 };
 env.animateReaderPageFromBook=native?settings=>module.app_animate_reader_page(host,settings):scope(env,reference.animateReaderPageFromBook);host.animateReaderPageFromBook=env.animateReaderPageFromBook;
 const open=native?()=>module.app_open_book_record(host,book,ctx):()=>scope(env,reference.openBookRecord)(book,ctx);
 if(options.prepared)env.preparedBooks.set(book.id,preparedWait?.promise??(options.prepared==='error'?Promise.reject(Error('prepared')):Promise.resolve(options.prepared!=='false')));
 return{open,env,host,state,book,ctx,snapshot,timers,listeners,revealWait,preparedWait,cancel:()=>cancel?.(),
  summary:()=>({events:[...events],state:{...state,activeOpeningContext:state.activeOpeningContext===ctx?'own':state.activeOpeningContext?'newer':null,pendingReaderTransition:!!state.pendingReaderTransition},prepared:[...env.preparedBooks.keys()],screenClass:screen.className,bodyClass:document.body.className,openingBook:screen.dataset.openingBook,toolbar:{hidden:toolbar.hidden,className:toolbar.className}})};
}
async function run(native,options={}){
 const f=fixture(native,options);let error,value;const task=f.open();const started=f.summary();try{value=await task}catch(e){error=e.message}await flush();
 return{started,finished:f.summary(),value,error};
}
for(const options of [{},{fireReady:true},{noActive:true,fireReady:true},{noFinish:true,fireReady:true},{noOnCancel:true},
 {prepared:'ready'},{prepared:'false'},{prepared:'error'},{prepared:'ready',preparedMismatch:true},
 {noContent:true},{noContent:true,folder:true},{noContent:true,folder:true,noFolderApi:true},
 {noContent:true,folder:true,noFolderHandle:true},{noContent:true,folder:true,denied:true},{noContent:true,folder:true,missingFile:true},
 {firstOpenFails:true,folder:true},{source:'drive',drive:true,download:true},{source:'local',drive:true,download:true},
 {source:'other'},{namesGetter:true},{inactive:true},{missingRecord:true,fireReady:true},{finishFalse:true,fireReady:true},{noSnapshot:true,fireReady:true},{fireError:true},
 ...['reveal','get','snapshot','finish'].map(fail=>({fail,fireReady:true,source:'drive',drive:true})),
 ...['folder-handle','permission','folder-file'].map(fail=>({fail,noContent:true,folder:true})),
 ...['download','open','get'].map(fail=>({fail,source:'drive',drive:true})),
 ...['reveal','get','snapshot'].map(cancelAt=>({cancelAt,fireReady:true})),
 {cancelAt:'download',source:'drive',drive:true},{cancelAt:'folder-file',noContent:true,folder:true},
 {switchAt:'get',fireReady:true},{newOwnerAt:'snapshot',fireReady:true},
 {prepared:'ready',fail:'snapshot'},{prepared:'ready',cancelAt:'reveal'}])
 it(`matches the complete opening coordinator ${JSON.stringify(options)}`,async()=>expect(await run(true,options)).toEqual(await run(false,options)));
it('cancels a local picker once and clears its record identity before closing the cover',async()=>{
 const run=async native=>{const f=fixture(native,{noContent:true});await f.open();f.listeners.get('focus')();expect(f.timers[0].delay).toBe(400);f.timers[0].callback();return f.summary()};expect(await run(true)).toEqual(await run(false));
});
it('a late picker focus cannot cancel a newer selection or reuse its id',async()=>{
 for(const change of ['transition','id','owner','active']){
  const run=async native=>{const f=fixture(native,{noContent:true});await f.open();f.listeners.get('focus')();if(change==='transition')f.state.pendingReaderTransition={};else if(change==='id')f.state.pendingLocalReopenId='other';else if(change==='owner')f.state.activeOpeningContext={};else f.ctx.isActive=()=>false;f.timers[0].callback();return f.summary()};expect(await run(true)).toEqual(await run(false));
 }
});
it('cancelling an opening releases its own chrome without clearing the new owner',async()=>{
 for(const newer of [false,true]){
  const run=async native=>{const f=fixture(native,{noContent:true});await f.open();if(newer)f.state.activeOpeningContext={};f.cancel();return f.summary()};expect(await run(true)).toEqual(await run(false));
 }
});
it('does not finish a stale ready callback after an async reveal is cancelled',async()=>{
 const f=fixture(true,{fireReady:true,pendingReveal:true});const task=f.open();await flush();f.cancel();f.ctx.isActive=()=>false;f.revealWait.resolve();await task;expect(f.state.activeOpeningContext).toBeNull();expect(f.env.els.readerToolbar.hidden).toBe(true);expect(f.summary().events.some(e=>e[0]==='finish')).toBe(false);
});
it('supports opening with the reader UI module alone',async()=>{
 const{rustUI}=await import('./helpers/rust-ui-ready.js');const f=fixture(true,{fireReady:true},rustUI);await f.open();expect(f.env.els.readerToolbar.hidden).toBe(false);
});
it('releases native handles after completed, cancelled and failed openings',async()=>{
 await run(true,{fireReady:true});const handles=rustShelf.shelf_live_handles(),callbacks=rustShelf.shelf_pending_callbacks();
 for(let n=0;n<60;n++)await run(true,[{fireReady:true},{fail:'download',source:'drive',drive:true},{cancelAt:'snapshot',fireReady:true},{prepared:'ready'}][n%4]);
 await flush();expect(rustShelf.shelf_live_handles()).toBe(handles);expect(rustShelf.shelf_pending_callbacks()).toBe(callbacks);
});
for(const options of [{},{source:'epub'},{measured:true},{hidden:true},{missingScreen:true},{inactive:true},{invalidBounds:true},{cancelAfterFlight:true},{flightError:true}])
it(`matches the page flight and final two-frame handover ${JSON.stringify(options)}`,async()=>{
 const run=async native=>{
  const f=fixture(native,{hidden:options.hidden});let active=!options.inactive;
  if(options.missingScreen)f.env.els.readerScreen=null;
  if(options.source)f.snapshot.sourceType=options.source;
  if(options.invalidBounds)f.snapshot.displayBounds={width:0,height:600};
  if(options.measured)document.querySelector('canvas').getBoundingClientRect=()=>({left:20,top:50,width:320,height:520});
  let target,error;
  try{await f.env.animateReaderPageFromBook({duration:420,pageSnapshot:f.snapshot,isActive:()=>active,animateBookToPage:async bounds=>{target=bounds;if(options.cancelAfterFlight)active=false;if(options.flightError)throw Error('flight')}})}catch(e){error=e.message}
  await flush();return{...f.summary(),target,error};
 };expect(await run(true)).toEqual(await run(false));
});
