import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import * as reference from './helpers/reference-app-file-open.js';
import {rustShelf} from './helpers/rust-shelf-ready.js';
const source=readFileSync('src/js/app.js','utf8');
const actualContent=source.slice(source.indexOf('async function openFileContent('),source.indexOf('\nconst fileContentHost ='));
const actualOpen=source.slice(source.indexOf('async function openFile('),source.indexOf('\nasync function openFileContent('));
const scope=(env,fn)=>new Function('env',`with(env){return (${typeof fn==='string'?fn:fn.toString()})}`)(env);
const flush=async()=>{for(let n=0;n<40;n++)await Promise.resolve()};
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return{promise,resolve,reject}};
class UnsupportedFormatError extends Error{}
function fixture(native,options={},module=rustShelf){
 document.body.className='is-reader-focus';document.body.innerHTML='<main id="reader"><section id="viewport">old content</section></main><button id="focus"></button><nav id="toolbar"></nav><span id="badge"></span><div id="reader-loading" hidden></div><div class="reader-heading-actions"></div>';
 const events=[],reads=[],state={readerLoadGeneration:0,requestedPreparationId:'old',activePreparedBookId:'old',currentBookId:'old',restoringProgress:false,readerPreparationQueue:Promise.resolve()};
 const els={readerScreen:document.getElementById('reader'),readerViewport:document.getElementById('viewport'),readerFocus:document.getElementById('focus'),readerToolbar:document.getElementById('toolbar'),readerFormatBadge:document.getElementById('badge')};els.readerScreen.hidden=true;
 if(options.kids)els.readerScreen.classList.add('reader-kids-mode');
 const id='book:📖:\ud800';let existing={id,sourceType:'drive',driveFileId:'drive',cloudAccountId:'account',mimeType:'application/pdf',title:'Saved title',author:'Saved author',contentRevision:'revision',folderFileName:'old.pdf',pageCount:44,locator:{kind:'pdf-page',value:3},progressFraction:.4};
 if(options.existingChanges)Object.assign(existing,options.existingChanges);
 if(options.unusedTitle)Object.defineProperty(existing,'title',{get(){throw Error('unused title')}});
 if(options.unusedRevision)Object.defineProperty(existing,'contentRevision',{get(){throw Error('unused revision')}});
 if(options.traceReads)existing=new Proxy(existing,{get(target,key,receiver){if(typeof key==='string')reads.push(key);return Reflect.get(target,key,receiver)}});
 const file=new File(['exact file bytes'],'new.pdf',{type:'application/pdf'}),stored={id,title:'Stored title'};
 const readyWait=options.pendingReady?deferred():null,openWait=options.pendingOpen?deferred():null,queueWait=options.pendingQueue?deferred():null;
 if(queueWait)state.readerPreparationQueue=queueWait.promise;if(options.queueError)state.readerPreparationQueue=Promise.reject(Error('queue'));
 let active=!options.inactive,callbacks,format={label:options.label===undefined?'PDF':options.label};
 const fail=at=>{if(options.fail===at)throw options.unsupported?new UnsupportedFormatError(at):Error(at)};
 const interrupt=at=>{if(options.cancelAt===at)active=false};
 const transition=options.noTransition?undefined:{isActive:()=>active,async onReaderError(){events.push(['reader-error']);fail('transition-error')},async onReaderReady(){events.push(['reader-ready']);fail('transition-ready')}};
 if(options.noActive&&transition)delete transition.isActive;
 const env={document,els,UnsupportedFormatError,
  console:{warn:(label,error)=>events.push(['warn',label,error.message]),error:error=>events.push(['error',error.message])},
  preparedBooks:new Map([['old',true]]),
  readingExperience:{preferences:{fontSize:18},async ready(){events.push(['ready']);fail('ready');return readyWait?.promise},reset(){events.push(['reset']);fail('reset')},async open(record){events.push(['experience-open',record===stored,state.restoringProgress]);fail('experience-open');interrupt('experience-open')},voice:{browse(){events.push(['browse']);return'browsed'}},jump(...args){events.push(['jump',...args]);return'jumped'}},
  reader:{metadata:{title:'Inside title',author:'Inside author',creator:'Creator'},pageCount:options.pages===undefined?4:options.pages,
   async open(viewport,f,settings){events.push(['reader-open',viewport===els.readerViewport,f===file,{initialPage:settings.initialPage,initialLocator:settings.initialLocator,initialFraction:settings.initialFraction,preferences:settings.preferences,onRelocate:settings.onRelocate===env.onReaderRelocate}]);callbacks=settings;fail('reader-open');interrupt('reader-open');if(options.callbacks){settings.onRelocate({fraction:.2});settings.onUserNavigation();settings.onFollowLink('chapter:2');settings.onToggleChrome()};if(openWait)await openWait.promise;return format},
   close(){events.push(['reader-close']);fail('close')},async goToLocator(...args){events.push(['restore',...args,state.restoringProgress]);fail('restore');interrupt('restore')}},
  library:{async get(key){events.push(['get',key]);fail('get');interrupt('get');return options.missingExisting?null:existing}},
  supersedePreparation:reason=>{events.push(['supersede',reason]);fail('supersede')},
  showScreen:name=>{events.push(['screen',name]);els.readerScreen.hidden=name!=='reader'},
  normalizeBookTitle:(title,name)=>{events.push(['title',title,name]);return title?.trim()||name},normalizeBookAuthor:author=>{events.push(['author',author]);return typeof author==='string'?author.trim():''},
  storeBookFile:async(l,f,fields,settings)=>{events.push(['store',l===env.library,f===file,fields,settings]);fail('store');interrupt('store');return options.noStored?null:stored},
  scheduleLibraryBackup:()=>events.push(['backup']),
  wordCountQueue:{ensure(record){events.push(['count',record===stored]);fail('count-sync');return options.countError?Promise.reject(Error('count')):Promise.resolve()}},
  refreshShelf:()=>events.push(['refresh']),extractCoverInBackground:record=>events.push(['cover',record===stored]),
  onReaderRelocate:value=>events.push(['relocate',value]),setReaderChromeHidden:value=>events.push(['chrome',value]),alert:message=>events.push(['alert',message])
 };
 const settings={existingRecord:options.noExisting?undefined:existing,forcedId:options.forced?id:undefined,folderFileName:options.folder,transition,preparing:options.preparing,restoreRemoved:options.restoreRemoved,reuseStoredContent:options.reuse,onImportReady:()=>events.push(['import-ready'])};
 for(const key of Object.keys(state))Object.defineProperty(env,key,{get:()=>state[key],set:v=>state[key]=v,configurable:true});
 const host={...env,state,isUnsupportedFormatError:error=>error instanceof UnsupportedFormatError,alert:env.alert,ignoreFileOpenError:()=>{},warnFileGeometry:error=>env.console.warn('No se pudo medir el libro:',error),
  fileReaderCallbacks:()=>({onUserNavigation:()=>module.app_reader_user_navigation(host),onFollowLink:href=>module.app_reader_follow_link(host,href),onToggleChrome:()=>module.app_reader_toggle_chrome(host)})};
 env.bookDataModule=()=>{events.push(['native-module']);return module};env.fileContentHost=host;
 env.openFileContent=scope(env,native?actualContent:reference.openFileContent);
 const open=scope(env,native?actualOpen:reference.openFile);
 return{env,host,state,file,settings,readyWait,openWait,queueWait,moduleRequests:()=>events.filter(e=>e[0]==='native-module').length,open:()=>open(file,settings),
  summary:()=>({events:events.filter(e=>e[0]!=='native-module'),state:{...state,readerPreparationQueue:true},prepared:[...env.preparedBooks.keys()],screen:{hidden:els.readerScreen.hidden,className:els.readerScreen.className,busy:els.readerScreen.getAttribute('aria-busy')},toolbar:els.readerToolbar.hidden,badge:els.readerFormatBadge.textContent,viewport:els.readerViewport.innerHTML,focus:{pressed:els.readerFocus.getAttribute('aria-pressed'),label:els.readerFocus.getAttribute('aria-label')},reads:[...reads],bodyClass:document.body.className,loading:document.getElementById('reader-loading').hidden,inert:!!document.querySelector('.reader-heading-actions').inert})};
}
async function run(native,options={}){
 const f=fixture(native,options);let value,error,cause;const task=f.open();const started=f.summary();try{value=await task}catch(e){error=e.message;cause=e.cause?.message}await flush();return{started,finished:f.summary(),value,error,cause};
}
for(const options of [{},{preparing:true},{noTransition:true},{noActive:true},{noExisting:true},{noExisting:true,forced:true},{noExisting:true,forced:true,missingExisting:true},
 {reuse:true},{restoreRemoved:true},{folder:'new-folder.pdf'},{inactive:true},{queueError:true},{noStored:true},{countError:true},
 {traceReads:true},{traceReads:true,reuse:true,preparing:true},{traceReads:true,noExisting:true},{label:null},{pages:0},{pages:null},{unusedTitle:true},{unusedRevision:true},{callbacks:true},{callbacks:true,kids:true},
 {existingChanges:{author:'',locator:null,progressFraction:0,mimeType:'',sourceType:null}},{existingChanges:{author:null,locator:{kind:'epub-cfi',value:'cfi'},progressFraction:.6}},
 ...['ready','get','reset','reader-open','store','experience-open','restore','count-sync','transition-ready'].map(fail=>({fail,noExisting:fail==='get',forced:fail==='get'})),
 {fail:'reader-open',unsupported:true},{fail:'reader-open',preparing:true},{fail:'store',preparing:true},
 ...['get','reader-open','store','experience-open'].map(cancelAt=>({cancelAt,noExisting:cancelAt==='get',forced:cancelAt==='get'}))])
 it(`matches file opening, metadata and cleanup ${JSON.stringify(options)}`,async()=>expect(await run(true,options)).toEqual(await run(false,options)));
it('shows the loading state immediately while the native reader is still downloading',async()=>{
 const f=fixture(true,{pendingReady:true,noTransition:true});const task=f.open();expect(f.summary().loading).toBe(false);expect(f.summary().inert).toBe(true);expect(f.summary().screen.busy).toBe('true');
 expect(f.moduleRequests()).toBe(0);expect(f.summary().events.some(e=>e[0]==='reader-open')).toBe(false);f.readyWait.resolve();await task;expect(f.moduleRequests()).toBe(1);expect(f.summary().inert).toBe(false);expect(f.summary().loading).toBe(true);
});
it('waits for shared preparation before replacing its reader, unless only preparing',async()=>{
 const f=fixture(true,{pendingQueue:true});const task=f.open();await flush();expect(f.summary().events.some(e=>e[0]==='reader-open')).toBe(false);f.queueWait.resolve();await task;expect(f.summary().events.some(e=>e[0]==='reader-open')).toBe(true);
});
it('a superseded load cannot clear the busy state of the newer generation',async()=>{
 const f=fixture(true,{pendingOpen:true});const task=f.open();await flush();f.state.readerLoadGeneration++;f.openWait.resolve();await task;expect(f.summary().screen.busy).toBe('true');expect(f.summary().inert).toBe(true);
});
it('works with UI alone without requiring a Shelf download',async()=>{
 const{rustUI}=await import('./helpers/rust-ui-ready.js');const f=fixture(true,{callbacks:true},rustUI);expect(await f.open()).toBe(true);expect(f.state.currentBookId).toBe('book:📖:\ud800');
});
it('releases native handles after successful, cancelled and failed file ingestions',async()=>{
 await run(true);const handles=rustShelf.shelf_live_handles(),callbacks=rustShelf.shelf_pending_callbacks();for(let n=0;n<60;n++)await run(true,[{}, {fail:'reader-open'},{fail:'store'},{cancelAt:'experience-open'}][n%4]);await flush();expect(rustShelf.shelf_live_handles()).toBe(handles);expect(rustShelf.shelf_pending_callbacks()).toBe(callbacks);
});
