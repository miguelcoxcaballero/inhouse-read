import {afterEach,expect,it,vi} from 'vitest';
import {File,Blob} from 'node:buffer';
import {createBookLengthQueue as native} from '../../src/js/book-length-queue.js';
import {createBookLengthQueue as frozen} from './helpers/reference-book-length-queue.js';
import {completeWordCount} from './helpers/reference-book-length.js';
import {rustShelf} from './helpers/rust-shelf-ready.js';
afterEach(()=>vi.unstubAllGlobals());
async function session(create,mode){
 const log=[],records=new Map();
 for(const id of ['a\ud800','a\ud801'])records.set(id,{id,name:id+'.epub',content:new Blob(['text']),contentRevision:id});
 const library={
  async get(id){log.push(['get',id,this===library]);return records.get(id);},
  async patch(id,fields,{ifCurrent}={}){
   const current=records.get(id);log.push(['patch',id,fields,this===library]);
   if(!current||ifCurrent&&!ifCurrent(current))return null;
   const saved={...current,...fields};records.set(id,saved);return saved;
  }
 };
 let attempt=0;
 const queue=create(library,{
  async measureFile(file,{isActive}){
   log.push(['measure',file.name,file.size,file.type,isActive()]);attempt++;
   if(mode==='failure'&&attempt===1)throw new Error('parse failed');
   if(mode==='partial'&&attempt===1)return {wordCount:3};
   return completeWordCount(300*attempt);
  },
  onChange:function(record,status){log.push(['change',record?.wordCount??null,status,this===undefined]);},
  onError:function(error,record){log.push(['error',error.message,record.id,this===undefined]);}
 });
 const a=records.get('a\ud800'),b=records.get('a\ud801');
 log.push(['geometry',queue.geometryState(a),queue.geometryState(b)]);
 const first=queue.ensure(a),duplicate=queue.ensure(a),second=queue.ensure(b);
 const saved=await Promise.all([first,duplicate,second]);
 log.push(['saved',saved.map(r=>r?.wordCount??null)]);
 if(mode!=='success')await queue.retry(a.id);
 log.push(['geometry',queue.geometryState(records.get(a.id)),queue.geometryState(records.get(b.id))]);
 queue.dispose();log.push(['disposed',await queue.ensure(a)]);
 return log;
}
it('preserves serial jobs, UTF-16 identities, failure/retry, revisions and callback receivers',async()=>{
 vi.stubGlobal('File',File);vi.stubGlobal('Blob',Blob);
 for(const mode of ['success','failure','partial'])expect(await session(native,mode)).toEqual(await session(frozen,mode));
});
it('returns every native handle after repeated queue completion and disposal',async()=>{
 vi.stubGlobal('File',File);vi.stubGlobal('Blob',Blob);
 await session(native,'success');const handles=rustShelf.shelf_live_handles(),callbacks=rustShelf.shelf_pending_callbacks();
 for(let i=0;i<40;i++)await session(native,['success','failure','partial'][i%3]);
 expect(rustShelf.shelf_live_handles()).toBe(handles);expect(rustShelf.shelf_pending_callbacks()).toBe(callbacks);
});
