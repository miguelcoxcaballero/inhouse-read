import {it,expect,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import * as reference from './helpers/reference-app-book-actions.js';
import {rustShelf} from './helpers/rust-shelf-ready.js';
import {bookDataModule} from '../../src/js/book-data-native.js';
const scoped=(env,fn)=>new Function('env',`with(env){return (${typeof fn==='function'?fn.toString():fn})}`)(env);
const source=readFileSync('src/js/app.js','utf8');
const factory=source.slice(source.indexOf('function createShelfForRecords('),source.indexOf('\nconst shelfRefreshHost ='));
const flush=async()=>{for(let n=0;n<12;n++)await Promise.resolve()};
function fixture(native,options={}){
 const events=[],book={id:'book',title:'A Book'},state={requestedPreparationId:options.notOwned?'other':options.activeOnly?null:'book',activePreparedBookId:options.notOwned?'other':'book',preparationGeneration:5,currentBookId:'book',shelfRecords:[book,{id:'other'}]};
 let cloudResolve,cloudReject,prepareResolve,prepareReject;
 state.readerPreparationQueue=new Promise((resolve,reject)=>{prepareResolve=resolve;prepareReject=reject});
 const cloud=new Promise((resolve,reject)=>{cloudResolve=resolve;cloudReject=reject});
 const screen=document.createElement('section'),viewport=document.createElement('div');screen.classList.toggle('is-preparing',!options.notPreparing);viewport.innerHTML='prepared';
 const env={preparedBooks:new Map([['book','prepared']]),coverUpgrades:new Map([['book','cover']]),els:{bookshelfRoot:'root',readerScreen:screen,readerViewport:viewport},
  progressWrites:{patch(id,fields){events.push(['progress',id,fields]);return options.persistError?Promise.reject(Error('persist')):Promise.resolve({id})}},
  library:{patch(id,fields){events.push(['library',id,fields]);return options.coverError?Promise.reject(Error('cover')):Promise.resolve({id,...fields})}},
  wordCountQueue:{cancel(id){events.push(['cancel',id]);if(options.cancelError)throw Error('cancel')}},preparedPages:{invalidateBook(id,reason){events.push(['invalidate',id,reason])}},
  releasePageGate(...args){events.push(['gate',...args])},cloudSync:{removeFromShelf(record){events.push(['remove',record.id]);return cloud}},scheduleLibraryBackup(){events.push(['backup'])},
  reader:{close(){events.push(['close'])}},readingExperience:{reset(){events.push(['reset'])},refreshNames(id,fields){events.push(['names',id,fields])}},console:{warn(label,error){events.push(['warning',label,error.message])}},
  renderBookshelf(_root,_books,settings){return settings},openBookRecord(){},prepareBookOpen(){},dismissPreparedPage(){},handleCoverAction(){},pickLocalFile(){},bookCloudState(){},hasDriveSession(){},normalizeShelfPosition(){},
 };
 for(const key of Object.keys(state))Object.defineProperty(env,key,{get:()=>state[key],set:value=>{state[key]=value},configurable:true});
 const host={...env,state,ignoreRemovalPreparationError:()=>{},warnRemovalPreparation:error=>env.console.warn('No se pudo liberar la preparación del libro retirado:',error),removedPreparationCleanup:(record,generation)=>()=>rustShelf.app_finish_removed_preparation(host,record,generation)};
 env.bookDataModule=bookDataModule;env.shelfRefreshHost=host;
 env.persistBookState=native?(id,fields)=>rustShelf.app_persist_book_state(host,id,fields):scoped(env,reference.persistBookState);
 env.removeBookFromShelf=native?record=>rustShelf.app_remove_from_shelf(host,record):scoped(env,reference.removeBookFromShelf);
 const handlers=scoped(env,native?factory:reference.createShelfForRecords)([]);
 return {events,env,host,state,book,handlers,cloudResolve,cloudReject,prepareResolve,prepareReject,
  snapshot(){return{events:[...events],requested:state.requestedPreparationId,active:state.activePreparedBookId,generation:state.preparationGeneration,current:state.currentBookId,records:state.shelfRecords?.map(book=>book.id),prepared:env.preparedBooks.has('book'),cover:env.coverUpgrades.has('book'),hidden:screen.hidden,preparing:screen.classList.contains('is-preparing'),html:viewport.innerHTML}}};
}
async function remove(native,options={}){
 const f=fixture(native,options);let task,syncError,asyncError,removal;
 try{task=f.handlers.onBookRemove(f.book)}catch(error){syncError=error.message}
 const completed=task&&Promise.resolve(task).then(value=>{removal=value},error=>{asyncError=error.message});
 const started=f.snapshot();if(options.cloudError)f.cloudReject(Error('cloud'));else f.cloudResolve({id:'book',removedAt:1});
 // A failure before starting the cloud request leaves its mock promise unused.
 if(options.cancelError&&options.cloudError)f.env.cloudSync.removeFromShelf().catch(()=>{});
 await completed;const landed=f.snapshot();
 if(options.newGeneration)f.state.preparationGeneration++;
 if(options.newSelection)f.state.requestedPreparationId='new';
 if(options.newCurrent)f.state.currentBookId='new';
 if(options.prepareError)f.prepareReject(Error('preparation'));else f.prepareResolve();
 await flush();return{started,landed,finished:f.snapshot(),syncError,asyncError,removal};
}
it('matches removal ownership and returns before a pending reader preparation completes',async()=>{
 for(const options of [{},{activeOnly:true},{notOwned:true},{notPreparing:true},{newGeneration:true},{newSelection:true},{newCurrent:true},{prepareError:true},{cloudError:true},{cancelError:true}])expect(await remove(true,options),JSON.stringify(options)).toEqual(await remove(false,options));
});
it('preserves customization/cover persistence, backup ordering and thrown errors',async()=>{
 const run=async(native,options)=>{const f=fixture(native,options);let error,cover;
  try{await f.handlers.onBookCustomizationChange(f.book,{author:'New author',spineTitleOverride:'Edited'});await f.handlers.onBookCustomizationChange(f.book,{spineColorOverride:'#ff0000'});cover=await f.handlers.onCoverAppearance(f.book,{palette:['#ffffff']},'paint-v1')}catch(failure){error=failure.message}
  return{events:f.events,error,cover};};
 for(const options of [{},{persistError:true},{coverError:true}])expect(await run(true,options)).toEqual(await run(false,options));
});
it('drops handles after repeated guarded removals and failed writes',async()=>{
 await remove(true);const handles=rustShelf.shelf_live_handles(),callbacks=rustShelf.shelf_pending_callbacks();
 for(let n=0;n<30;n++){await remove(true,{newSelection:n%2===0});const f=fixture(true,{persistError:true});await expect(f.handlers.onBookCustomizationChange(f.book,{author:'A'})).rejects.toThrow('persist');}
 expect(rustShelf.shelf_live_handles()).toBe(handles);expect(rustShelf.shelf_pending_callbacks()).toBe(callbacks);
});
it('persists reader-only changes using UI when Shelf is unavailable',async()=>{
 const {rustUI}=await import('./helpers/rust-ui-ready.js');const loader=await import('../../src/js/rust-shelf.js');const hide=vi.spyOn(loader,'getRustShelf').mockReturnValue(null);
 try{const events=[],host={progressWrites:{patch:async(...args)=>events.push(['patch',...args])},scheduleLibraryBackup:()=>events.push(['backup'])};await bookDataModule().app_persist_book_state(host,'reader',{author:'A'});expect(events).toEqual([['patch','reader',{author:'A'}],['backup']]);expect(bookDataModule()).toBe(rustUI);}finally{hide.mockRestore();}
});

it('retains synchronous getter failures before a cover write starts',async()=>{
 const run=async native=>{const f=fixture(native),book={get id(){throw Error('id getter')}};let syncError,asyncError,task;try{task=f.handlers.onCoverAppearance(book,{},'key')}catch(error){syncError=error.message}await Promise.resolve(task).catch(error=>{asyncError=error.message});return{syncError,asyncError,events:f.events}};
 expect(await run(true)).toEqual(await run(false));
});
it('keeps cover fields as own data without invoking inherited setters',async()=>{
 const descriptor=Object.getOwnPropertyDescriptor(Object.prototype,'coverAppearance');let calls=0;
 Object.defineProperty(Object.prototype,'coverAppearance',{configurable:true,set(){calls++}});
 try{const f=fixture(true);const appearance={palette:['#123456']};const record=await f.handlers.onCoverAppearance(f.book,appearance,'v1');expect(calls).toBe(0);expect(Object.hasOwn(record,'coverAppearance')).toBe(true);expect(record.coverAppearance).toBe(appearance);}finally{if(descriptor)Object.defineProperty(Object.prototype,'coverAppearance',descriptor);else delete Object.prototype.coverAppearance;}
});
