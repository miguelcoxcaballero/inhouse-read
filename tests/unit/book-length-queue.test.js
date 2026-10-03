import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Blob as NativeBlob, File as NativeFile } from 'node:buffer';
import { LibraryStore } from '../../src/js/library-store.js';
import { storeBookFile } from '../../src/js/book-storage-policy.js';
import { createBookLengthQueue, isBookLengthReady } from '../../src/js/book-length-queue.js';
import { completeWordCount } from '../../src/js/book-length.js';

let library,queue,serial=0;
beforeEach(()=>{vi.stubGlobal('Blob',NativeBlob);vi.stubGlobal('File',NativeFile);library=new LibraryStore(`word-count-${++serial}`);});
afterEach(async()=>{queue?.dispose();queue=null;await library.close();vi.unstubAllGlobals();});
const importBook=(text='file',fields={})=>storeBookFile(library,new File([text],fields.name||'words.epub'),
  {sourceType:'local',name:fields.name||'words.epub',size:text.length,...fields});

describe('durable full-book word count queue',()=>{
  it('original bytes commit first, with stable pending geometry until a complete count commits',async()=>{
    const book=await importBook();let finish;
    const measure=vi.fn(()=>new Promise(resolve=>{finish=resolve;}));
    queue=createBookLengthQueue(library,{measureFile:measure});
    const task=queue.ensure(book);
    await vi.waitFor(()=>expect(measure).toHaveBeenCalledOnce());
    expect(queue.geometryState(await library.get(book.id))).toBe('pending');
    expect(await (await library.get(book.id)).content.text()).toBe('file');
    finish(completeWordCount(120_000));const saved=await task;
    expect(saved.wordCountContentRevision).toBe(saved.contentRevision);
    expect(queue.geometryState(saved)).toBe('ready');
    expect(isBookLengthReady(saved)).toBe(true);
  });
  it('reuses a complete cached count on a cold reopen without importing another parser',async()=>{
    const book=await importBook();queue=createBookLengthQueue(library,{measureFile:async()=>completeWordCount(90_000)});
    await queue.ensure(book);queue.dispose();
    const measure=vi.fn();queue=createBookLengthQueue(library,{measureFile:measure});
    const reopened=await queue.ensure(book.id);
    expect(reopened.wordCount).toBe(90_000);expect(queue.geometryState(reopened)).toBe('ready');
    expect(measure).not.toHaveBeenCalled();
  });
  it('deduplicates requests and parses separate books serially',async()=>{
    const a=await importBook('aaa',{name:'a.epub'}),b=await importBook('bbb',{name:'b.epub'});
    const finishes=[];let live=0,maxLive=0;
    const measure=vi.fn(()=>{live++;maxLive=Math.max(live,maxLive);return new Promise(resolve=>finishes.push(value=>{live--;resolve(value);}));});
    queue=createBookLengthQueue(library,{measureFile:measure});
    const first=queue.ensure(a),duplicate=queue.ensure(a.id),second=queue.ensure(b);
    await vi.waitFor(()=>expect(measure).toHaveBeenCalledTimes(1));
    finishes.shift()(completeWordCount(30_000));
    expect((await first).wordCount).toBe(30_000);expect((await duplicate).wordCount).toBe(30_000);
    await vi.waitFor(()=>expect(measure).toHaveBeenCalledTimes(2));
    finishes.shift()(completeWordCount(120_000));await second;expect(maxLive).toBe(1);
  });
  it('a late count cannot overwrite a new import of equal name and byte size',async()=>{
    const book=await importBook('old');let finish;
    const measure=vi.fn().mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}))
      .mockResolvedValueOnce(completeWordCount(120_000));
    queue=createBookLengthQueue(library,{measureFile:measure});const oldTask=queue.ensure(book);
    await vi.waitFor(()=>expect(measure).toHaveBeenCalledTimes(1));
    const replacement=await importBook('new',{id:book.id});
    expect(replacement.contentRevision).not.toBe(book.contentRevision);
    expect(replacement.wordCount).toBeNull();const newTask=queue.ensure(replacement);
    finish(completeWordCount(30_000));expect(await oldTask).toBeNull();
    expect((await newTask).wordCount).toBe(120_000);
    expect(await (await library.get(book.id)).content.text()).toBe('new');
  });
  it('navigation-independent jobs retain appearance/progress and a cached reopen preserves the count',async()=>{
    let book=await importBook();book=await library.patch(book.id,{spineColorOverride:'#234567',spineTitleOverride:'Manual',
      spineFontSize:42,spineAuthorFontSize:30,spineFinish:'gold',locator:{kind:'pdf-page',value:9},progressFraction:.4});
    queue=createBookLengthQueue(library,{measureFile:async()=>completeWordCount(60_000)});
    const counted=await queue.ensure(book);
    const reopened=await storeBookFile(library,new File([counted.content],counted.name),
      {id:counted.id,contentRevision:counted.contentRevision},{reuseStoredContent:true});
    expect(reopened).toMatchObject({wordCount:60_000,spineColorOverride:'#234567',spineTitleOverride:'Manual',
      spineFontSize:42,spineAuthorFontSize:30,spineFinish:'gold',locator:{kind:'pdf-page',value:9},progressFraction:.4});
    expect(isBookLengthReady(reopened)).toBe(true);
  });
  it('removal cancels the job without recreating a removed record',async()=>{
    const book=await importBook();let finish;
    const measure=vi.fn(()=>new Promise(resolve=>{finish=resolve;}));queue=createBookLengthQueue(library,{measureFile:measure});
    const task=queue.ensure(book);await vi.waitFor(()=>expect(measure).toHaveBeenCalledOnce());
    queue.cancel(book.id);await library.removeFromShelf(book.id);finish(completeWordCount(90_000));
    expect(await task).toBeNull();expect(await library.get(book.id)).toBeNull();
  });
  it('never renders legacy, partial, damaged or missing-source counts as final geometry',async()=>{
    const book=await importBook();const changed=vi.fn();
    const measure=vi.fn().mockResolvedValueOnce({wordCount:1200,lengthSource:'text'})
      .mockResolvedValueOnce(completeWordCount(90_000));
    queue=createBookLengthQueue(library,{measureFile:measure,onChange:changed});
    expect(await queue.ensure(book)).toBeNull();
    expect(queue.geometryState(await library.get(book.id))).toBe('failed');
    expect((await queue.retry(book.id)).wordCount).toBe(90_000);
    expect(queue.geometryState({id:'legacy',wordCount:90000})).toBe('needs-source');
    expect(changed).toHaveBeenCalledWith(null,{id:book.id,status:'failed'});
  });
  it('upgrades a legacy Blob revision once, measuring its entire content',async()=>{
    const legacy=await library.addOrTouch({sourceType:'local',name:'legacy.pdf',size:4,content:new Blob(['file']),pageCount:1000});
    const measure=vi.fn(async()=>completeWordCount(30000));queue=createBookLengthQueue(library,{measureFile:measure});
    const counted=await queue.ensure(legacy);expect(counted.contentRevision).toBeTruthy();
    expect(counted.wordCountContentRevision).toBe(counted.contentRevision);expect(counted.pageCount).toBe(1000);
    await queue.ensure(counted);expect(measure).toHaveBeenCalledOnce();
  });
});
