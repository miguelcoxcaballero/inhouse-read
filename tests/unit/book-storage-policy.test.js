import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Blob as NativeBlob, File as NativeFile } from 'node:buffer'
import { LibraryStore } from '../../src/js/library-store.js'
import { isBookVisible, bookCloudState, storeBookFile } from '../../src/js/book-storage-policy.js'

const stores = []
let serial = 0
function library() { const store = new LibraryStore(`book-storage-policy-${++serial}`); stores.push(store); return store }
beforeEach(() => { vi.stubGlobal('Blob', NativeBlob); vi.stubGlobal('File', NativeFile) })
afterEach(async () => { for (const store of stores.splice(0)) await store.close(); vi.unstubAllGlobals() })

describe('local original book bytes', () => {
  it.each(['local', 'drive'])('commits exact %s bytes and progress for an offline cold reopen', async sourceType => {
    const store = library()
    const bytes = new Uint8Array([0, 255, 37, 80, 68, 70, 0, 128])
    const file = new File([bytes], 'original.pdf', { type:'application/pdf' })
    const book = await storeBookFile(store, file, { sourceType, name:file.name,
      size:file.size, driveFileId:sourceType === 'drive' ? 'saved-drive' : undefined })
    await store.updateProgress(book.id, .75, { kind:'pdf-page', value:3 })
    // Opening another connection models a fresh reader process, not a kept File.
    const next = new LibraryStore(`book-storage-policy-${serial}`); stores.push(next)
    const saved = await next.get(book.id)
    expect([...new Uint8Array(await saved.content.arrayBuffer())]).toEqual([...bytes])
    expect(saved.locator).toEqual({ kind:'pdf-page', value:3 })
    expect(isBookVisible(saved, null)).toBe(true)
  })
  it('does not retry a quota failure as metadata-only success', async () => {
    const store = { addOrTouch:vi.fn().mockRejectedValue(new DOMException('Full', 'QuotaExceededError')) }
    await expect(storeBookFile(store, new File(['exact'], 'book.epub'), { sourceType:'local' }))
      .rejects.toMatchObject({ code:'LOCAL_BOOK_STORAGE_FAILED', cause:{ name:'QuotaExceededError' } })
    expect(store.addOrTouch).toHaveBeenCalledTimes(1)
    expect(store.addOrTouch.mock.calls[0][0].content.size).toBe(5)
  })
  it('replaces original bytes when a newly imported file has the same name and size', async () => {
    const store = library()
    const old = await storeBookFile(store, new File(['old'], 'same.epub'), { sourceType:'local', name:'same.epub', size:3 })
    await storeBookFile(store, new File(['new'], 'same.epub'), { id:old.id, sourceType:'local', name:'same.epub', size:3 },
      { retainedContent:old.content })
    expect(await (await store.get(old.id)).content.text()).toBe('new')
  })
  it('invalidates the previous Drive byte identity on reimport but preserves it on a cached reopen', async () => {
    const store=library(), checksum='a'.repeat(32)
    const old=await store.addOrTouch({ sourceType:'local',name:'same.epub',size:3,content:new Blob(['old']),
      contentRevision:'old-revision',driveFileId:'saved',driveContentChecksum:checksum,contentDriveChecksum:checksum })
    await storeBookFile(store,new File([old.content],old.name),{ id:old.id,name:old.name,size:3,
      contentRevision:old.contentRevision },{ reuseStoredContent:true })
    expect((await store.get(old.id)).contentDriveChecksum).toBe(checksum)
    await storeBookFile(store,new File(['new'],old.name),{ id:old.id,name:old.name,size:3 })
    expect(await store.get(old.id)).toMatchObject({ driveFileId:'saved',driveContentChecksum:checksum,contentDriveChecksum:null })
  })
  it('does not erase a saved file, Drive link or position through undefined reopen fields', async () => {
    const store = library()
    const book = await store.addOrTouch({ sourceType:'local', name:'keep.pdf', size:5,
      content:new Blob(['bytes']), driveFileId:'saved', cloudAccountId:'account', locator:{ page:3 } })
    await store.addOrTouch({ id:book.id, driveFileId:undefined, content:undefined, locator:undefined })
    expect(await store.get(book.id)).toMatchObject({ driveFileId:'saved', content:{ size:5 }, locator:{ page:3 } })
    await store.addOrTouch({ id:book.id, locator:null })
    expect((await store.get(book.id)).locator).toBeNull()
  })
  it('checks a progress update against the latest record within its write transaction', async () => {
    const store = library()
    const book = await store.addOrTouch({ sourceType:'local', name:'progress.pdf', size:4, progressUpdatedAt:200, locator:{ page:8 } })
    expect(await store.patch(book.id, { locator:{ page:2 } }, { ifCurrent:record => record.progressUpdatedAt === 100 })).toBeNull()
    expect((await store.get(book.id)).locator).toEqual({ page:8 })
  })
})

describe('local shelf and optional cloud action', () => {
  it('keeps downloaded Drive books visible after sign-out or switching account', () => {
    const downloaded = { sourceType:'drive', cloudAccountId:'one', content:new Blob(['original']) }
    expect(isBookVisible(downloaded, null)).toBe(true)
    expect(isBookVisible(downloaded, 'two')).toBe(true)
    expect(isBookVisible({ ...downloaded, content:null }, null)).toBe(false)
    expect(isBookVisible({ ...downloaded, content:null }, 'two')).toBe(false)
    expect(isBookVisible({ ...downloaded, content:null }, 'one')).toBe(true)
  })
  it('offers cloud upload only with a connection while retaining saved state without login', () => {
    expect(bookCloudState({}, { connected:false })).toEqual({ connected:false, saved:false })
    expect(bookCloudState({}, { connected:true })).toEqual({ connected:true, saved:false })
    expect(bookCloudState({ driveFileId:'existing' })).toEqual({ connected:false, saved:true })
  })
})
