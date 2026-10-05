import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { LibraryStore } from '../../src/js/library-store.js'

// index.html's start-up script, run as the page runs it before the app's code.
const startup = readFileSync('index.html', 'utf8').match(/<script>([^<]*__inhouseShelfRead[^<]*)<\/script>/)[1]
const runStartup = () => new Function(startup)()
const deleteLibrary = () => new Promise((resolve, reject) => {
  const request = indexedDB.deleteDatabase('inhouse-read')
  request.onsuccess = resolve; request.onerror = () => reject(request.error)
})
const book = (id, lastOpenedAt) => ({ id, title:id, lastOpenedAt, sourceType:'local' })

describe('shelf records read before the app has loaded', () => {
  beforeEach(async () => {
    vi.resetModules()
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok:true, text:async () => '' })))
    await deleteLibrary()
  })
  afterEach(() => { delete globalThis.__inhouseShelfRead; delete globalThis.__inhouseDeployed; vi.unstubAllGlobals() })

  it('hands the first build the page\'s read, in listAll order, once', async () => {
    const store = new LibraryStore()
    await store.addOrTouch(book('older', 1)); await store.addOrTouch(book('newer', 2))
    await store.patch('older', { lastOpenedAt:1 }); await store.patch('newer', { lastOpenedAt:2 })
    await store.close()
    runStartup()
    expect((await globalThis.__inhouseShelfRead.done).map(record => record.id).sort()).toEqual(['newer', 'older'])
    const boot = await import('../../src/js/shelf-boot.js')
    expect(globalThis.__inhouseShelfRead).toBeUndefined()
    const records = await boot.takeFirstRecords()
    expect(records.map(record => record.id)).toEqual((await boot.library.listAll()).map(record => record.id))
    expect(records.map(record => record.id)).toEqual(['newer', 'older'])
    expect(boot.takeFirstRecords()).toBeNull()
    await boot.library.close()
  })

  it('leaves a library that does not exist yet to the store, without creating it', async () => {
    runStartup()
    expect(await globalThis.__inhouseShelfRead.done).toBeNull()
    expect((await indexedDB.databases()).map(database => database.name)).not.toContain('inhouse-read')
    const boot = await import('../../src/js/shelf-boot.js')
    expect(await boot.takeFirstRecords()).toEqual([])
    const database = (await indexedDB.databases()).find(entry => entry.name === 'inhouse-read')
    expect(database?.version).toBe(2)
    await boot.library.close()
  })

  it('reads the store itself when the page could not start the read', async () => {
    const store = new LibraryStore()
    await store.addOrTouch(book('only', 1)); await store.close()
    const boot = await import('../../src/js/shelf-boot.js')
    expect((await boot.takeFirstRecords()).map(record => record.id)).toEqual(['only'])
    await boot.library.close()
  })
})
