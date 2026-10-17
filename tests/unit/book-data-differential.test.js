import {beforeEach,afterEach,expect,it,vi} from 'vitest';
import {Blob as NativeBlob,File as NativeFile} from 'node:buffer';
import * as native from '../../src/js/book-storage-policy.js';
import * as frozen from './helpers/reference-book-storage-policy.js';
import {refreshSelectedBookNames as refresh} from '../../src/js/selected-book-names.js';
import {refreshSelectedBookNames as originalRefresh} from './helpers/reference-selected-book-names.js';
import {rustShelf} from './helpers/rust-shelf-ready.js';
const tag=Symbol('tag');
beforeEach(()=>{vi.stubGlobal('Blob',NativeBlob);vi.stubGlobal('File',NativeFile);vi.stubGlobal('crypto',{randomUUID(){return 'fixed-revision';}});});
afterEach(()=>vi.unstubAllGlobals());
const order=value=>Reflect.ownKeys(value).map(key=>typeof key==='symbol'?`symbol:${key.description}`:key);
async function storeSession(module,reuse,fail){
 const log=[],cause=new Error('quota or accessor failure');
 const file=new NativeFile([new Uint8Array([0,255,3,128])],'source.epub',{type:'application/epub+zip'});
 let revision=0;
 const base={id:'book\ud800',wordCount:3000,wordCountVersion:2,wordCountComplete:true,contentDriveChecksum:'old',author:'Author',[tag]:{kept:true}};
 Object.defineProperty(base,'__proto__',{enumerable:true,value:{ordinary:true}});
 Object.defineProperty(base,'hidden',{enumerable:false,value:'skip'});
 Object.defineProperty(base,'contentRevision',{enumerable:true,get(){log.push('revision');return `r${++revision}`;}});
 const fields=new Proxy(base,{ownKeys(target){log.push('keys');return Reflect.ownKeys(target);},getOwnPropertyDescriptor(target,key){log.push(`descriptor:${String(key)}`);return Reflect.getOwnPropertyDescriptor(target,key);},get(target,key){log.push(`get:${String(key)}`);return Reflect.get(target,key);}});
 let payload,options;
 const library={async addOrTouch(record,settings){log.push(this===library?'receiver:library':'receiver:wrong');payload=record;options=settings;if(fail)throw cause;return record;}};
 const task=module.storeBookFile(library,file,fields,{restoreRemoved:'restore',reuseStoredContent:reuse});
 const synchronous=[...log];let error=null,result;
 try{result=await task;}catch(value){error={message:value.message,code:value.code,sameCause:value.cause===cause};}
 const {content,...rest}=payload;
 return{log,synchronous,rest,order:order(payload),options,bytes:[...new Uint8Array(await content.arrayBuffer())],type:content.type,plain:Object.getPrototypeOf(payload)===Object.prototype,sameResult:result===payload,error};
}
it('preserves original bytes, lazy getters, symbols, __proto__, field order and storage failure causes',async()=>{
 for(const reuse of [false,true])for(const fail of [false,true])expect(await storeSession(native,reuse,fail)).toEqual(await storeSession(frozen,reuse,fail));
});
it('preserves visibility and cloud state, including short circuiting and thrown getters',()=>{
 for(const book of [undefined,null,false,0,'',{sourceType:'local'},{sourceType:'drive'},{sourceType:'drive',cloudAccountId:'one'},{sourceType:'drive',cloudAccountId:'one',content:{size:1}}]){
  for(const account of [null,'one','two'])expect(native.isBookVisible(book,account)).toBe(frozen.isBookVisible(book,account));
  expect(native.needsDriveDownload(book)).toBe(frozen.needsDriveDownload(book));
  for(const connected of [false,true,null,0,'yes'])expect(native.bookCloudState(book,{connected})).toEqual(frozen.bookCloudState(book,{connected}));
 }
 const run=module=>{const reads=[];const book=new Proxy({sourceType:'drive',cloudAccountId:'one'},{get(target,key){reads.push(key);return target[key];}});return{result:module.isBookVisible(book,'one'),reads};};
 expect(run(native)).toEqual(run(frozen));
 const bad={get content(){throw Error('content getter');}};expect(()=>native.isBookVisible(bad,'one')).toThrow('content getter');
});
function namesSession(run,present){
 const calls=[];let title=0,author=0,id=0;
 const book={get id(){calls.push('id');return `book\ud800:${++id}`;},get spineTitleOverride(){calls.push('title');return `Title ${++title}`;},get author(){calls.push('author');return `Author ${++author}`;}};
 const experience={get refreshNames(){calls.push('method');return present?function(key,fields){calls.push({receiver:this===experience,key,fields});return 'returned';}:null;}};
 return{result:run(experience,book),calls};
}
it('keeps both selected-name getter passes, callback receiver and optional-call evaluation order',()=>{
 for(const present of [false,true])expect(namesSession(refresh,present)).toEqual(namesSession(originalRefresh,present));
 const book=Object.assign(Object.create({author:'inherited'}),{id:'x',spineTitleOverride:null});
 const a=[],b=[];refresh({refreshNames(...args){a.push(args);}},book);originalRefresh({refreshNames(...args){b.push(args);}},book);expect(a).toEqual(b);
});
it('returns native handles after repeated storage success, failures and selected-name calls',async()=>{
 const baseline=rustShelf.shelf_live_handles(),callbacks=rustShelf.shelf_pending_callbacks();
 for(let i=0;i<50;i++){await storeSession(native,i%2===0,i%3===0);namesSession(refresh,i%2===0);}
 expect(rustShelf.shelf_live_handles()).toBe(baseline);expect(rustShelf.shelf_pending_callbacks()).toBe(callbacks);
});
