import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {performShelfRefresh as frozen} from './helpers/reference-app-refresh.js';
import {rustShelf} from './helpers/rust-shelf-ready.js';
import {normalizeBookTitle,normalizeBookAuthor} from '../../src/js/book-title.js';
import {sameBookRecords,libraryHost} from '../../src/js/library-store.js';
import {isBookVisible,bookCloudState} from '../../src/js/book-storage-policy.js';
import {normalizeShelfPosition} from '../../src/js/book-colors.js';
const original=frozen.toString();
const body=original.slice(original.indexOf('  const normalizedBooks = '),original.lastIndexOf('}'));
const source=readFileSync('src/js/app.js','utf8');
const factory=source.slice(source.indexOf('function createShelfForRecords('),source.indexOf('\nconst shelfRefreshHost ='));
const scoped=(env,text)=>new Function('env',`with(env){return (${text})}`)(env);
const ids=books=>books.map(book=>book.id);
const summary=options=>Object.fromEntries(Object.entries(options).map(([key,value])=>[key,typeof value==='function'?'[function]':value]));
const records=()=>[{id:'local',sourceType:'local',title:'the_book.epub',author:{name:'Writer'}},{id:'owned',sourceType:'drive',cloudAccountId:'me',title:'Owned'},{id:'other',sourceType:'drive',cloudAccountId:'other',title:'Other'},{id:'saved',sourceType:'drive',cloudAccountId:'other',content:new Blob(['x']),title:'Saved'}];
function fixture(options={}){
 const events=[],stored=options.empty?[]:records(),ready=stored.map(book=>({...book,title:normalizeBookTitle(book.title||book.name),author:normalizeBookAuthor(book.author)||null}));
 const shelf={isInteracting:!!options.interacting,prepareCloudRoom(){events.push(['cloud-room'])},destroy(){events.push(['destroy'])},update(books){events.push(['update',ids(books)])},queueRefresh:options.noQueue?undefined:function(books){events.push(['queue',ids(books)])}};
 const state={appDisposed:false,closingReader:!!options.closing,cloudRoomChanged:!!options.roomChanged,shelf:options.create?null:shelf,shelfRecords:options.equal?ready.filter(book=>isBookVisible(book,options.account)):null,lengthStatusVersion:2,shelfLengthStatusVersion:options.versionChanged?1:2};
 if(options.equal){stored.splice(0,stored.length,...ready);}
 const queue={ensure(book){events.push(['count',book.id]);return options.countError?Promise.reject(Error('count')):Promise.resolve()},geometryState:()=>({}),retry:id=>id,cancel:id=>id};
 const env={normalizeBookTitle,normalizeBookAuthor,isBookVisible,sameBookRecords,bookCloudState,normalizeShelfPosition,els:{bookshelfRoot:'root',readerScreen:{hidden:!options.readerVisible}},wordCountQueue:queue,nativeImportShelfGate:{deferRefresh(){events.push(['gate']);return !!options.defer}},console:{warn(label,error){events.push(['warning',label,error.message])}},preparedBooks:new Map(),hasDriveSession:()=>false,
  library:{patch(id,patch){events.push(['patch',id,patch]);if(options.patchError)return Promise.reject(Error('patch'));return Promise.resolve().then(()=>{if(options.disposeDuringPatch)state.appDisposed=true;return options.disappears?null:{...stored.find(book=>book.id===id),...patch}})}},
  renderBookshelf(root,books,settings){events.push(['create',root,ids(books),summary(settings)]);return shelf},
  openBookRecord(){},prepareBookOpen(){},dismissPreparedPage(){},handleCoverAction(){},pickLocalFile(){},persistBookState(){},removeBookFromShelf(){},scheduleLibraryBackup(){},releasePageGate(){},preparedPages:{},readingExperience:{}
 };
 for(const key of Object.keys(state))Object.defineProperty(env,key,{get:()=>state[key],set:value=>{state[key]=value},configurable:true});
 const host={state,els:env.els,library:env.library,wordCountQueue:queue,nativeImportShelfGate:env.nativeImportShelfGate,libraryHost,createShelf:scoped(env,factory),warnPreparation:(error)=>env.console.warn('Preparación del grosor:',error)};
 return {stored,host,env,events,state,snapshot(){return {events,appDisposed:state.appDisposed,roomChanged:state.cloudRoomChanged,hasShelf:!!state.shelf,recordIds:state.shelfRecords&&ids(state.shelfRecords),version:state.shelfLengthStatusVersion}}};
}
async function run(native,options){const f=fixture(options);let error;try{if(native)await rustShelf.app_refresh_after_load(f.host,f.stored,options.account,!!options.immediate);else await scoped(f.env,`async function(storedBooks,accountId,immediate){${body}}`)(f.stored,options.account,!!options.immediate)}catch(failure){error={name:failure.name,message:failure.message}}await Promise.resolve();await Promise.resolve();return{...f.snapshot(),error};}
it('matches complete refresh sessions including account changes, normalization, reuse and errors',async()=>{
 const cases=[{}, {create:true},{create:true,empty:true},{account:'me'},{account:'other'},{account:'me',equal:true},{account:'me',equal:true,versionChanged:true},{immediate:true},{noQueue:true},{roomChanged:true},{roomChanged:true,closing:true},{roomChanged:true,readerVisible:true},{interacting:true},{roomChanged:true,interacting:true},{disposeDuringPatch:true},{defer:true},{patchError:true},{disappears:true},{countError:true}];
 for(const options of cases)expect(await run(true,options),JSON.stringify(options)).toEqual(await run(false,options));
});
it('keeps native handles and callbacks stable through completed and rejected refreshes',async()=>{
 await run(true,{create:true});const handles=rustShelf.shelf_live_handles(),callbacks=rustShelf.shelf_pending_callbacks();
 for(let n=0;n<40;n++){
  expect((await run(true,{create:n%2===0,equal:n%3===0,account:'me'})).error).toBeUndefined();
  expect((await run(true,{patchError:true})).error.message).toBe('patch');
 }
 expect(rustShelf.shelf_live_handles()).toBe(handles);expect(rustShelf.shelf_pending_callbacks()).toBe(callbacks);
});
it('retains a pending cloud room while held and applies it after the gesture finishes',async()=>{
 const f=fixture({roomChanged:true,interacting:true})
 await rustShelf.app_refresh_after_load(f.host,f.stored,undefined,false)
 expect(f.state.cloudRoomChanged).toBe(true);expect(f.events.some(e=>['destroy','create','queue','update'].includes(e[0]))).toBe(false)
 f.state.shelf.isInteracting=false
 await rustShelf.app_refresh_after_load(f.host,f.stored,undefined,false)
 expect(f.state.cloudRoomChanged).toBe(false);expect(f.events.some(e=>e[0]==='cloud-room')).toBe(true);expect(f.events.some(e=>e[0]==='destroy'||e[0]==='create')).toBe(false)
})
