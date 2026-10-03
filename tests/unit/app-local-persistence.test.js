import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { Blob as NativeBlob, File as NativeFile } from 'node:buffer'

const state = vi.hoisted(() => ({ connected:false, serial:0 }))
vi.mock('../../src/js/library-store.js', async importOriginal => {
  const actual = await importOriginal()
  return { ...actual, LibraryStore:class extends actual.LibraryStore {
    constructor() { super(`app-local-persistence-${++state.serial}`); state.library = this }
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
      this.open = vi.fn(async (element, file, options) => { state.openedFile = file; state.readerOptions = options; return { label:'PDF' } })
      this.close = vi.fn(); this.goToLocator = vi.fn(); this.getCoverBlob = vi.fn()
      this.getPageSnapshot = vi.fn(async () => ({ location:this.location }))
      this.getLengthMetadata = vi.fn(async () => null)
    }
  }
}))
vi.mock('../../src/js/readers/reader-experience.js', () => ({ ReaderExperience:class {
  constructor(reader, options) {
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
  await state.library?.close()
  for (const [target, type, callback, options] of listeners.splice(0)) target.removeEventListener(type, callback, options)
  vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.innerHTML = ''
  state.options = null
})
const file = () => new NativeFile([new Uint8Array([0, 255, 37, 80, 68, 70, 0, 128])], 'original.pdf', { type:'application/pdf' })
async function importBook() { await state.imports.onFile(file()); return (await state.library.listAll())[0] }

describe('app import and optional Drive upload', () => {
  it('commits original native-import bytes without launching Google or asking for a folder', async () => {
    const book = await importBook()
    const drive = await import('../../src/js/drive-client.js')
    const folder = await import('../../src/js/local-folder-store.js')
    expect([...new Uint8Array(await book.content.arrayBuffer())]).toEqual([0,255,37,80,68,70,0,128])
    expect(drive.requestDriveAccess).not.toHaveBeenCalled()
    expect(folder.getOrChooseFolder).not.toHaveBeenCalled()
    expect(state.cloud.uploadBook).not.toHaveBeenCalled()
    expect(document.getElementById('drive-upload-screen').hidden).toBe(true)
  })
  it('does not upload an imported local book even with Google connected', async () => {
    state.connected = true
    const book = await importBook()
    expect(book.driveFileId).toBeUndefined()
    expect(state.cloud.uploadBook).not.toHaveBeenCalled()
    expect(state.options.getBookCloudState(book)).toEqual({ connected:true, saved:false })
  })
  it('replaces explicit upload with a non-button saved status without waiting for progress network', async () => {
    state.connected = true
    const book = await importBook()
    state.cloud.flushProgress.mockReturnValue(new Promise(() => {}))
    const button = document.createElement('button'); button.textContent = 'Subir a Google Drive'; document.body.append(button)
    await state.options.onBookAction('drive', book, button)
    expect(state.cloud.uploadBook).toHaveBeenCalledWith(book)
    expect(button.isConnected).toBe(false)
    const status = document.querySelector('.ihr-flyout__cloud-saved')
    expect(status.tagName).toBe('SPAN')
    expect(status.textContent).toBe('Guardado en Google Drive')
    expect(document.getElementById('drive-upload-screen').hidden).toBe(true)
    expect((await state.library.get(book.id)).driveFileId).toBe('uploaded')
  })
  it('does not launch OAuth when a stale upload button is clicked after sign-out', async () => {
    const book = await importBook()
    const button = document.createElement('button'); button.textContent = 'Subir a Google Drive'
    await state.options.onBookAction('drive', book, button)
    const drive = await import('../../src/js/drive-client.js')
    expect(drive.requestDriveAccess).not.toHaveBeenCalled()
    expect(state.cloud.uploadBook).not.toHaveBeenCalled()
    expect(button.disabled).toBe(false)
  })
  it('rejects local storage failure rather than treating metadata-only import as ready', async () => {
    vi.spyOn(state.library, 'addOrTouch').mockRejectedValue(new DOMException('Full', 'QuotaExceededError'))
    await expect(state.imports.onFile(file())).rejects.toMatchObject({ code:'LOCAL_BOOK_STORAGE_FAILED' })
    expect(await state.library.listAll()).toEqual([])
    expect(document.body.classList.contains('is-reading')).toBe(false)
    expect(state.reader.close).toHaveBeenCalled()
    expect(state.cloud.uploadBook).not.toHaveBeenCalled()
  })
})

describe('local reopen and closing progress', () => {
  it('prepares a downloaded Drive book offline without waiting for remote progress', async () => {
    const book = await state.library.addOrTouch({ sourceType:'drive', driveFileId:'remote',
      cloudAccountId:'account', name:'original.pdf', mimeType:'application/pdf', content:file(), size:file().size,
      locator:{ kind:'pdf-page', value:2 }, progressFraction:.5 })
    state.cloud.syncBookProgress.mockReturnValue(new Promise(() => {}))
    await state.options.onPrepareBook(book, { settled:Promise.resolve() })
    expect(state.reader.open).toHaveBeenCalledOnce()
    expect(state.reader.goToLocator).toHaveBeenCalledWith(book.locator, .5)
    expect(state.cloud.downloadForOffline).not.toHaveBeenCalled()
    expect(state.cloud.syncBookProgress).not.toHaveBeenCalled()
    expect([...new Uint8Array(await state.openedFile.arrayBuffer())]).toEqual([0,255,37,80,68,70,0,128])
  })
  it('saves final progress locally before the return flight, without any account', async () => {
    const book = await importBook()
    state.reader.location = { fraction:.5, locator:{ kind:'pdf-page', value:2 } }
    state.shelf.returnToShelf.mockImplementation(async id => {
      expect(await state.library.get(id)).toMatchObject({ progressFraction:.5, locator:{ kind:'pdf-page', value:2 } })
    })
    document.getElementById('reader-back').click()
    await vi.waitFor(() => expect(state.shelf.returnToShelf).toHaveBeenCalledOnce())
    await vi.waitFor(() => expect(document.body.classList.contains('is-closing-reader')).toBe(false))
    expect(state.cloud.flushProgress).not.toHaveBeenCalled()
    expect((await state.library.get(book.id)).content.size).toBe(8)
  })
  it('returns a linked book while the Drive progress request is still pending', async () => {
    state.connected = true
    const book = await importBook()
    await state.library.patch(book.id, { driveFileId:'already-saved', cloudAccountId:'account' })
    state.reader.location = { fraction:.5, locator:{ kind:'pdf-page', value:2 } }
    state.cloud.flushProgress.mockReturnValue(new Promise(() => {}))
    document.getElementById('reader-back').click()
    await vi.waitFor(() => expect(state.shelf.returnToShelf).toHaveBeenCalledOnce())
    await vi.waitFor(() => expect(document.body.classList.contains('is-closing-reader')).toBe(false))
    expect(state.cloud.flushProgress).toHaveBeenCalledWith(book.id)
    expect((await state.library.get(book.id)).locator).toEqual({ kind:'pdf-page', value:2 })
  })
})
