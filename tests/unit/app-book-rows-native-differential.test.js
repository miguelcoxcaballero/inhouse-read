import {it,expect,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {createShelfForRecords as referenceFactory} from './helpers/reference-app-rows.js';
import {persistBookState as referencePersist} from './helpers/reference-app-book-actions.js';
import {rustShelf} from './helpers/rust-shelf-ready.js';
import {bookDataModule} from '../../src/js/book-data-native.js';
import {normalizeShelfPosition} from '../../src/js/book-colors.js';
const source=readFileSync('src/js/app.js','utf8'),factory=source.slice(source.indexOf('function createShelfForRecords('),source.indexOf('\nconst shelfRefreshHost ='));
const scoped=(env,text)=>new Function('env',`with(env){return (${typeof text==='function'?text.toString():text})}`)(env);
const flush=async()=>{for(let n=0;n<12;n++)await Promise.resolve()};
function fixture(native,{reject=false}={}){
 const calls=[];const host={progressWrites:{patch(id,fields){calls.push(['patch',id,fields]);return reject?Promise.reject(Error('write')):Promise.resolve()}},scheduleLibraryBackup(){calls.push(['backup'])}};
 host.placementMapper=()=>row=>bookDataModule().app_placement_record(host,row);host.orderMapper=()=>row=>bookDataModule().app_order_record(host,row);
 const env={bookDataModule,shelfRefreshHost:host,normalizeShelfPosition,progressWrites:host.progressWrites,scheduleLibraryBackup:host.scheduleLibraryBackup,renderBookshelf(_root,_books,settings){return settings},els:{bookshelfRoot:'root'},openBookRecord(){},prepareBookOpen(){},dismissPreparedPage(){},handleCoverAction(){},pickLocalFile(){},preparedBooks:new Map(),wordCountQueue:{},bookCloudState(){},hasDriveSession(){},readingExperience:{}};
 env.persistBookState=scoped(env,referencePersist);
 return{calls,host,handlers:scoped(env,native?factory:referenceFactory)([])};
}
async function run(native,kind,make,options){const f=fixture(native,options),trace=[];let task,syncError,asyncError,value;try{task=f.handlers[kind](make(trace))}catch(error){syncError=error.name}if(task)await Promise.resolve(task).then(result=>{value=result},error=>{asyncError=error.message});await flush();return{calls:f.calls,trace,syncError,asyncError,value};}
it('preserves complete placement batches, invalid/reset rows, holes and failed writes',async()=>{
 const rows=[{id:'a',shelfPosition:{shelf:0,x:.3}},{id:'b',shelfPosition:{shelf:1,x:2}},{id:'reset',shelfPosition:null},{id:'invalid',shelfPosition:{shelf:1.5,x:.2}},{id:0,shelfPosition:{shelf:0,x:.1}},{id:'',shelfPosition:null},{id:'bad',shelfPosition:undefined}];
 const cases=[()=>({books:rows}),()=>({}),()=>({books:undefined}),()=>({books:[]}),()=>({books:Array(3)}),()=>({books:Object.assign(Array(3),{1:rows[0]})}),()=>({books:null}),()=>({books:'wrong'}),()=>undefined,()=>null,()=>({books:[null]})];
 for(const make of cases)for(const reject of [false,true])expect(await run(true,'onShelfPlacementChange',make,{reject})).toEqual(await run(false,'onShelfPlacementChange',make,{reject}));
});
it('preserves order batches and the SDK map method/iterator protocol and getter order',async()=>{
 const cases=[()=>[{id:'a',shelfOrder:2},{id:0,shelfOrder:0},{id:'b',shelfOrder:null},{id:'c'}],()=>Array(3),()=>null,()=>undefined,()=>({map(callback){return new Set([callback({id:'custom',shelfOrder:3}),Promise.resolve(42)])}}),()=>({map(){return 'xy'}})];
 for(const make of cases)expect(await run(true,'onBookOrderChange',make)).toEqual(await run(false,'onBookOrderChange',make));
 const traced=trace=>({get books(){trace.push('books');return new Proxy([{get id(){trace.push('id');return'a'},get shelfPosition(){trace.push('position');return{shelf:1,x:2}}}],{get(target,key,receiver){trace.push('get:'+String(key));return Reflect.get(target,key,receiver)},has(target,key){trace.push('has:'+String(key));return Reflect.has(target,key)}})}});
 expect(await run(true,'onShelfPlacementChange',traced)).toEqual(await run(false,'onShelfPlacementChange',traced));
});
it('does not retain native handles through repeated successful and rejected batches',async()=>{
 const make=()=>({books:[{id:'a',shelfPosition:{shelf:1,x:.5}},{id:'reset',shelfPosition:null}]});
 await run(true,'onShelfPlacementChange',make);const handles=rustShelf.shelf_live_handles(),callbacks=rustShelf.shelf_pending_callbacks();
 for(let n=0;n<40;n++){await run(true,'onShelfPlacementChange',make,{reject:n%2===0});await run(true,'onBookOrderChange',()=>[{id:'a',shelfOrder:2}]);}
 expect(rustShelf.shelf_live_handles()).toBe(handles);expect(rustShelf.shelf_pending_callbacks()).toBe(callbacks);
});
it('runs the placement callback in the already-loaded reader module without Shelf',async()=>{
 const {rustUI}=await import('./helpers/rust-ui-ready.js');const loader=await import('../../src/js/rust-shelf.js');const hide=vi.spyOn(loader,'getRustShelf').mockReturnValue(null);
 try{const result=await run(true,'onShelfPlacementChange',()=>({books:[{id:'a',shelfPosition:{shelf:0,x:2}}]}));expect(result.calls).toEqual([['patch','a',{shelfPosition:{shelf:0,x:1}}],['backup']]);expect(bookDataModule()).toBe(rustUI);}finally{hide.mockRestore();}
});
