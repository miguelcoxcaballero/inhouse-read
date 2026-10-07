import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { Blob as NativeBlob, File as NativeFile } from 'node:buffer'

const state = vi.hoisted(() => ({ connected:false, serial:0 }))
// These tests deliberately import invalid eight-byte PDF fixtures to check
// original-byte persistence. Text extraction is covered with real documents
// separately; this new background dependency must not parse those fixtures.
vi.mock('../../src/js/file-book-length.js', () => ({
  measureFileBookLength:vi.fn((...args) => state.measureFileLength(...args))
}))
vi.mock('../../src/js/library-store.js', async importOriginal => {
  const actual = await importOriginal()
  return { ...actual, LibraryStore:class extends actual.LibraryStore {
    constructor() { super(`app-cover-close-${++state.serial}`); state.library = this }
  } }
})
vi.mock('../../src/js/bookshelf.js', () => ({ renderBookshelf:vi.fn((container, books, options) => {
  state.options = options; state.books = books
  state.shelf = { close:vi.fn(), hasReaderOrigin:vi.fn(() => true),
    update:vi.fn(next => { state.books = next }), prepareOpeningPage:vi.fn(), returnToShelf:vi.fn() }
  return state.shelf
}) }))
vi.mock('../../src/js/readers/reader-controller.js', () => ({ UnsupportedFormatError:class extends Error {},
  ReaderController:class {
    constructor() {
      state.reader = this
      this.epoch = 1; this.pageCount = 2; this.format = { engine:'pdf' }
      this.metadata = { title:'Original book' }; this.location = { fraction:0, locator:null }
      this.open = vi.fn(async (element, file, options) => { ++this.epoch; state.openedFile = file; state.readerOptions = options; return { label:'PDF' } })
      this.close = vi.fn(() => { ++this.epoch }); this.goToLocator = vi.fn(); this.getCoverBlob = vi.fn()
      this.getPageSnapshot = vi.fn(async () => ({ location:this.location }))
      this.getLengthMetadata = vi.fn(async () => null)
    }
  }
}))
vi.mock('../../src/js/readers/reader-experience.js', () => ({ ReaderExperience:class {
  constructor(reader, options) {
    state.experience = this
    state.persist = options.persist
    this.voice = { stop:vi.fn() }; this.panel = { close:vi.fn(), open:false }
    this.preferences = {}; this.open = vi.fn(); this.reset = vi.fn(); this.relocate = vi.fn(); this.step = vi.fn()
  }
} }))
vi.mock('../../src/js/drive-client.js', () => ({ isDriveConfigured:() => true,
  hasDriveSession:() => state.connected,
  getDriveProfile:vi.fn(async () => ({ id:'account', name:'Reader', email:'reader@example.com' })),
  getRememberedDriveProfile:() => state.connected ? { id:'account' } : null,
  requestDriveAccess:vi.fn(async () => { state.connected = true }),
  listAllDriveBooks:vi.fn(async () => []), signOutDrive:vi.fn(() => { state.connected = false }), cancelDriveConnection:vi.fn()
}))
vi.mock('../../src/js/cloud-sync.js', () => ({ CloudSync:class {
  constructor(library) {
    state.cloud = this
    this.reset = vi.fn(); this.setProfile = vi.fn(); this.sync = vi.fn(async () => {})
    this.scheduleProgress = vi.fn(); this.syncBookProgress = vi.fn(async () => {})
    this.flushProgress = vi.fn(async () => {})
    this.downloadForOffline = vi.fn(async book => new NativeFile([book.content], book.name, { type:book.mimeType }))
    this.uploadBook = vi.fn(async book => library.patch(book.id, { driveFileId:'uploaded', cloudAccountId:'account' }))
  }
} }))
vi.mock('../../src/js/local-folder-store.js', () => ({ isFolderApiSupported:() => true,
  getSavedFolderHandle:vi.fn(), getOrChooseFolder:vi.fn(), ensureFolderPermission:vi.fn(),
  saveFileIntoFolder:vi.fn(), readFileFromFolder:vi.fn()
}))
vi.mock('../../src/js/legacy-book-recovery.js', () => ({ restoreLegacyBookBytes:vi.fn() }))
vi.mock('../../src/js/android-update.js', () => ({ initAndroidUpdateChecks:vi.fn(), offerAvailableAndroidUpdate:vi.fn() }))
vi.mock('../../src/js/content-freshness.js', () => ({ initContentFreshnessChecks:vi.fn() }))
vi.mock('../../src/js/reading-display.js', () => ({ initReadingDisplay:vi.fn() }))
vi.mock('../../src/js/android-file-import.js', () => ({ initAndroidFileImports:options => { state.imports = options } }))

let listeners = []
beforeEach(async () => {
  vi.resetModules(); vi.clearAllMocks(); state.connected = false
  state.measureFileLength = vi.fn(async () => ({ wordCount:600, wordCountVersion:2,
    wordCountComplete:true, estimatedPageCount:2, lengthSource:'text' }))
  vi.stubGlobal('Blob', NativeBlob); vi.stubGlobal('File', NativeFile)
  vi.stubGlobal('navigator', { userAgent:'InhouseReadApp/1.1.3', onLine:true })
  vi.stubGlobal('alert', vi.fn())
  vi.stubGlobal('MutationObserver', class { observe() {} disconnect() {} })
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  vi.stubGlobal('matchMedia', () => ({ matches:false, addEventListener() {}, removeEventListener() {} }))
  document.documentElement.innerHTML = readFileSync('index.html', 'utf8').replace(/<!doctype html>|<html[^>]*>|<\/html>/gi, '')
  localStorage.clear()
  for (const target of [document, globalThis]) {
    const add = target.addEventListener.bind(target)
    vi.spyOn(target, 'addEventListener').mockImplementation((type, callback, options) => {
      listeners.push([target, type, callback, options]); return add(type, callback, options)
    })
  }
  await import('../../src/js/app.js')
  await vi.waitFor(() => expect(state.options).toBeTruthy())
})
afterEach(async () => {
  window.dispatchEvent(new Event('pagehide'))
  await state.library?.close()
  for (const [target, type, callback, options] of listeners.splice(0)) target.removeEventListener(type, callback, options)
  vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.innerHTML = ''
  state.options = null
})
const file = () => new NativeFile([new Uint8Array([0, 255, 37, 80, 68, 70, 0, 128])], 'original.pdf', { type:'application/pdf' })
async function importBook() { await state.imports.onFile(file()); return (await state.library.listAll())[0] }


async function savedBook() {
  const source = Object.assign(document.createElement('canvas'), { width:144, height:218 });
  state.reader.getPageSnapshot.mockResolvedValue({ source, width:144, height:218,
    displayBounds:{ left:0, top:0, width:144, height:218 }, location:state.reader.location });
  return state.library.addOrTouch({ id:'pending-cover', title:'Original book', author:'Reader',
    name:'original.pdf', format:'PDF', mimeType:'application/pdf', sourceType:'local',
    content:new NativeBlob(['%PDF-original'], { type:'application/pdf' }),
    cover:new NativeBlob(['small-existing-cover'], { type:'image/jpeg' }),
    wordCount:600, wordCountVersion:2, wordCountComplete:true });
}
const context = finish => ({ isActive:() => true, finish, close:vi.fn() });
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};
async function openSelected(book) {
  await state.options.onPrepareBook(book, { settled:Promise.resolve(true) });
  await state.options.onBookOpen(book, context(vi.fn(async () => true)));
}
const back = () => document.getElementById('reader-back').click();
async function finishClose(snapshot) {
  snapshot.resolve(null);
  await vi.waitFor(() => expect(document.body.classList.contains('is-closing-reader')).toBe(false));
}

describe('optional cover extraction yields to closing the reader', () => {
  it('aborts before the closing snapshot settles and refuses a late cover commit', async () => {
    const book = await savedBook(), cover = deferred();
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width:200, height:300, close:vi.fn() })));
    state.reader.getCoverBlob.mockReturnValue(cover.promise);
    await openSelected(book);
    await vi.waitFor(() => expect(state.reader.getCoverBlob).toHaveBeenCalledOnce());
    const signal = state.reader.getCoverBlob.mock.calls[0][0]?.signal;
    const snapshot = deferred();
    state.reader.getPageSnapshot.mockReturnValueOnce(snapshot.promise);
    const epoch = state.reader.epoch;
    back();
    expect(state.reader.epoch).toBe(epoch);
    expect(state.reader.close).not.toHaveBeenCalled();
    cover.resolve(new NativeBlob(['obsolete-HD-cover'], { type:'image/jpeg' }));
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(await (await state.library.get(book.id)).cover.text()).toBe('small-existing-cover');
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal.aborted).toBe(true);
    await finishClose(snapshot);
    expect(state.reader.close).toHaveBeenCalledOnce();
    expect(state.shelf.returnToShelf).toHaveBeenCalledOnce();
  });

  it('closes a late size-check bitmap without starting a PDF render during close', async () => {
    const book = await savedBook(), size = deferred(), bitmapClose = vi.fn();
    vi.stubGlobal('createImageBitmap', vi.fn(() => size.promise));
    await openSelected(book);
    await vi.waitFor(() => expect(createImageBitmap).toHaveBeenCalledOnce());
    const snapshot = deferred();
    state.reader.getPageSnapshot.mockReturnValueOnce(snapshot.promise);
    back();
    size.resolve({ width:200, height:300, close:bitmapClose });
    await vi.waitFor(() => expect(bitmapClose).toHaveBeenCalledOnce());
    expect(state.reader.getCoverBlob).not.toHaveBeenCalled();
    expect(await (await state.library.get(book.id)).cover.text()).toBe('small-existing-cover');
    await finishClose(snapshot);
  });

  it('keeps the stored cover and original bytes, then retries full quality on the next opening', async () => {
    const book = await savedBook(), upgraded = new NativeBlob(['full-quality-cover'], { type:'image/jpeg' });
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width:200, height:300, close:vi.fn() })));
    state.reader.getCoverBlob.mockImplementationOnce(({ signal }) => new Promise(resolve => {
      signal.addEventListener('abort', () => resolve(null), { once:true });
    })).mockResolvedValueOnce(upgraded);
    await openSelected(book);
    await vi.waitFor(() => expect(state.reader.getCoverBlob).toHaveBeenCalledOnce());
    const firstSignal = state.reader.getCoverBlob.mock.calls[0][0].signal;
    const snapshot = deferred();
    state.reader.getPageSnapshot.mockReturnValueOnce(snapshot.promise);
    back(); await finishClose(snapshot);
    const kept = await state.library.get(book.id);
    expect(await kept.cover.text()).toBe('small-existing-cover');
    expect(kept.content.size).toBe(book.content.size);
    await openSelected(kept);
    await vi.waitFor(async () => expect(await (await state.library.get(book.id)).cover.text()).toBe('full-quality-cover'));
    expect(state.reader.getCoverBlob).toHaveBeenCalledTimes(2);
    const secondSignal = state.reader.getCoverBlob.mock.calls[1][0].signal;
    expect(firstSignal.aborted).toBe(true);
    expect(secondSignal).not.toBe(firstSignal);
    expect(secondSignal.aborted).toBe(false);
    expect((await state.library.get(book.id)).content.size).toBe(book.content.size);
  });
});


describe('first cover survives close without delaying the return',()=>{
  async function initialBook(){vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockImplementation(()=>({drawImage:vi.fn()}));const book=await savedBook(),revision='initial-cover-content';return state.library.patch(book.id,{cover:null,wordCount:600,wordCountVersion:2,wordCountComplete:true,contentRevision:revision,wordCountContentRevision:revision});}
  it('commits the first cover after reader.close while retaining original bytes and progress',async()=>{
    const book=await initialBook(),cover=deferred(); state.reader.getCoverBlob.mockReturnValue(cover.promise);
    await openSelected(book); await vi.waitFor(()=>expect(state.reader.getCoverBlob).toHaveBeenCalledOnce());
    const options=state.reader.getCoverBlob.mock.calls[0][0],returnToShelf=state.shelf.returnToShelf;
    back(); await vi.waitFor(()=>expect(document.body.classList.contains('is-closing-reader')).toBe(false));
    expect(state.reader.close).toHaveBeenCalledOnce(); expect(returnToShelf).toHaveBeenCalledOnce();
    cover.resolve(new NativeBlob(['first-full-quality-cover'],{type:'image/jpeg'}));
    await new Promise(resolve=>setTimeout(resolve,30));
    expect(options.signal.aborted).toBe(false); expect(options.retainOnClose).toBe(true);
    await vi.waitFor(async()=>expect(await (await state.library.get(book.id)).cover?.text()).toBe('first-full-quality-cover'));
    expect((await state.library.get(book.id)).content.size).toBe(book.content.size);
  });
  it('does not replace a cover installed after the first extraction began',async()=>{
    const book=await initialBook(),cover=deferred(); state.reader.getCoverBlob.mockReturnValue(cover.promise);
    await openSelected(book); await vi.waitFor(()=>expect(state.reader.getCoverBlob).toHaveBeenCalledOnce());
    await state.library.patch(book.id,{cover:new NativeBlob(['newer-cover'],{type:'image/jpeg'})});
    cover.resolve(new NativeBlob(['older-extraction'],{type:'image/jpeg'}));
    await new Promise(resolve=>setTimeout(resolve,30));
    expect(await (await state.library.get(book.id)).cover.text()).toBe('newer-cover');
  });
  it('never recreates a deleted book when a retained first cover finishes',async()=>{
    const book=await initialBook(),cover=deferred(); state.reader.getCoverBlob.mockReturnValue(cover.promise);
    await openSelected(book); await vi.waitFor(()=>expect(state.reader.getCoverBlob).toHaveBeenCalledOnce());
    back(); await vi.waitFor(()=>expect(document.body.classList.contains('is-closing-reader')).toBe(false));
    await state.library.remove(book.id); cover.resolve(new NativeBlob(['late-cover'],{type:'image/jpeg'}));
    await new Promise(resolve=>setTimeout(resolve,30)); expect(await state.library.get(book.id)).toBeNull();
  });
});


describe('first cover is tied to its original stored bytes',()=>{
 it('discards the old cover after the same book id receives a different content revision',async()=>{
  vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockImplementation(()=>({drawImage:vi.fn()}));
  const source=await savedBook();
  const book=await state.library.patch(source.id,{cover:null,contentRevision:'cover-source',wordCountContentRevision:'cover-source'});
  const cover=deferred();state.reader.getCoverBlob.mockReturnValue(cover.promise);
  await openSelected(book);await vi.waitFor(()=>expect(state.reader.getCoverBlob).toHaveBeenCalledOnce());
  const replacement=new NativeBlob(['replacement-document'],{type:'application/pdf'});
  await state.library.patch(book.id,{content:replacement,contentRevision:'replacement-source',cover:null});
  cover.resolve(new NativeBlob(['wrong-old-cover'],{type:'image/jpeg'}));
  await new Promise(resolve=>setTimeout(resolve,30));
  const latest=await state.library.get(book.id);
  expect(latest.cover).toBeNull();expect(await latest.content.text()).toBe('replacement-document');
 });
});
