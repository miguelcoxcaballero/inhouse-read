import { afterEach, expect, it, vi } from 'vitest';
import { Blob as NativeBlob, File as NativeFile } from 'node:buffer';
import { LibraryStore } from '../../src/js/library-store.js';
import { spineCustomization } from '../../src/js/book-colors.js';

const selection={layers:[{id:'color-1',color:'#d4a93c',tolerance:4,strength:.25},
  {id:'color-1',color:'#2350b5',tolerance:3,strength:.8}]};
afterEach(()=>{vi.unstubAllGlobals();localStorage.clear();});

it('reopens the real IndexedDB store with both colour identities and separate intensities',async()=>{
  const name='multicolour-persistence-'+crypto.randomUUID();let store=new LibraryStore(name);
  const book=await store.addOrTouch({sourceType:'local',name:'Original.epub',size:120,title:'Original',format:'EPUB'});
  await store.patch(book.id,spineCustomization({coverRelief:selection}));store.close();
  store=new LibraryStore(name);
  try {
    const reopened=await store.get(book.id);expect(reopened.coverRelief).toEqual(selection);
    await store.patch(book.id,spineCustomization({coverRelief:{layers:[selection.layers[0],{...selection.layers[1],strength:.1}]}}));
    const updated=await store.get(book.id);
    expect(updated.coverRelief.layers[0]).toEqual(selection.layers[0]);expect(updated.coverRelief.layers[1].strength).toBe(.1);
  } finally {store.close();}
});

it('writes only portable multicolour records through the existing Drive progress API',async()=>{
  vi.resetModules();vi.stubGlobal('Blob',NativeBlob);vi.stubGlobal('File',NativeFile);
  localStorage.setItem('ihr_drive_session_v2',JSON.stringify({accessToken:'test-token',expiresAt:Date.now()+3600000}));
  let body;
  vi.stubGlobal('fetch',vi.fn(async(_url,options)=>{body=await options.body.text();return new Response(JSON.stringify({id:'state-colours'}));}));
  const drive=await import('../../src/js/drive-client.js');
  await drive.writeDriveProgress('book-colours',{fraction:.4,appearance:{coverRelief:{layers:
    selection.layers.map(layer=>({...layer,mask:new Uint8Array([1]),normal:'discard'}))}},updatedAt:123},'state-colours');
  const payload=JSON.parse(body.split('\r\n\r\n').at(-1).split('\r\n--')[0]);
  expect(payload.appearance).toEqual({coverRelief:selection});expect(payload.updatedAt).toBe(123);
  expect(fetch).toHaveBeenCalledOnce();expect(fetch.mock.calls[0][1].method).toBe('PATCH');
});
