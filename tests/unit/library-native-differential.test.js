import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {Blob as NativeBlob,File as NativeFile} from 'node:buffer';
import {LibraryStore,idForSource} from '../../src/js/library-store.js';
import {LibraryStore as Frozen,idForSource as originalId} from './helpers/reference-library-store.js';
import {rustShelf} from './helpers/rust-shelf-ready.js';
let serial=0;const opened=[];let clock;
beforeEach(()=>{clock=1000;vi.spyOn(Date,'now').mockImplementation(()=>clock);vi.stubGlobal('Blob',NativeBlob);vi.stubGlobal('File',NativeFile);});
afterEach(async()=>{for(const store of opened.splice(0))await store.close();vi.restoreAllMocks();vi.unstubAllGlobals();});
async function snapshot(value){
 if(value instanceof NativeBlob)return{blob:[...new Uint8Array(await value.arrayBuffer())],type:value.type};
 if(Array.isArray(value))return Promise.all(value.map(snapshot));
 if(value&&typeof value==='object'){const out={};for(const key of Object.keys(value))out[key]=await snapshot(value[key]);return out;}
 return value;
}
async function session(Store){
 clock=1000;const store=new Store(`native-library-differential-${++serial}`);opened.push(store);const result=[];
 const add=async(value,options)=>{clock+=100;const next=await store.addOrTouch(value,options);result.push(await snapshot(next));return next;};
 const source={sourceType:'local',name:'story\ud800.epub',size:'4',title:'Story',author:'First',content:new NativeBlob([new Uint8Array([0,255,7,128])]),cover:new NativeBlob(['cover'],{type:'image/png'}),contentRevision:'first'};
 const first=await add(source);
 await add({id:first.id,name:source.name,sourceType:'local',content:undefined,cover:undefined,author:undefined,locator:null});
 clock+=100;result.push(await snapshot(await store.updateProgress(first.id,.6,{kind:'epub',cfi:'epubcfi(/6/4)'})));
 result.push(await snapshot(await store.patch(first.id,{title:'wrong'},{ifCurrent:record=>record.progressFraction===.2})));
 result.push(await snapshot(await store.patch(first.id,{author:null,wordCount:9000},{ifCurrent:record=>record.contentRevision==='first'})));
 clock+=100;result.push(await snapshot(await store.setCover(first.id,new NativeBlob(['new cover'],{type:'image/webp'}))));
 result.push(await snapshot(await store.get(first.id)));
 clock+=100;result.push(await snapshot(await store.removeFromShelf(first.id,{removedAt:4444})));
 result.push(await snapshot(await store.listRemoved()));result.push(await store.isRemovedFromShelf(source));
 await add({...source,title:'Must remain removed'});
 await store.rememberRemovedDriveLink(first,'remote-book','one');result.push(await snapshot(await store.listRemoved()));
 result.push(await store.isRemovedFromShelf({id:'drive:remote-book',sourceType:'drive',driveFileId:'remote-book',cloudAccountId:'two',name:source.name,size:4}));
 result.push(await store.isRemovedFromShelf({id:'drive:remote-book',sourceType:'drive',driveFileId:'remote-book',cloudAccountId:'one',name:source.name,size:4}));
 await add({...source,driveFileId:'remote-book',cloudAccountId:'one'},{restoreRemoved:true});
 await store.rememberRemovedDriveLink(first,'late-upload','one');result.push(await snapshot(await store.listRemoved()));
 result.push(await snapshot(await store.listAll()));
 result.push(await store.updateProgress('missing',.1,{}),await store.patch('missing',{title:'none'}),await store.setCover('missing',new NativeBlob(['x'])));
 await store.clear();result.push(await store.listAll(),await store.listRemoved());return result;
}
it('matches the frozen library across byte commits, guarded progress, tombstones, aliases, reimport and late uploads',async()=>{
 expect(await session(LibraryStore)).toEqual(await session(Frozen));
});
it('preserves all source-ID destructuring reads and template conversions',()=>{
 for(const source of [{sourceType:'local'}, {sourceType:'local',name:null,size:undefined},{sourceType:'local',name:'a\ud800',size:0},{sourceType:'drive',driveFileId:'remote',name:'ignored',size:10}])expect(idForSource(source)).toBe(originalId(source));
 const run=fn=>{const reads=[];const source=new Proxy({sourceType:'drive',driveFileId:'d',name:'n',size:3},{get(target,key){reads.push(key);return target[key];}});return{result:fn(source),reads};};
 expect(run(idForSource)).toEqual(run(originalId));
 expect(()=>idForSource({name:Symbol('name')})).toThrow(TypeError);
});
it('returns native handles after repeated complete and refused transactions',async()=>{
 const store=new LibraryStore(`native-library-lifetime-${++serial}`);opened.push(store);const baseline=rustShelf.shelf_live_handles(),callbacks=rustShelf.shelf_pending_callbacks();
 for(let i=0;i<30;i++){
  const book=await store.addOrTouch({id:`book:${i}`,sourceType:'local',name:`b${i}`,size:1,content:new NativeBlob(['x'])});
  await store.patch(book.id,{title:'rejected'},{ifCurrent:()=>false});await store.removeFromShelf(book.id);expect(await store.addOrTouch(book)).toBeNull();
 }
 await store.clear();expect(rustShelf.shelf_live_handles()).toBe(baseline);expect(rustShelf.shelf_pending_callbacks()).toBe(callbacks);
});
