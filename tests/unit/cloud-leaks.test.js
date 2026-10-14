import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { Blob as NodeBlob, File as NodeFile } from 'node:buffer'
import * as ui from '../../src/wasm/ui/inhouse_read_ui.js'
import { collect } from './helpers/collect.js'

// The cloud and folder ports hand callbacks and host objects to Rust. Whatever they retain must be
// released when the work ends: an importer that is stopped, a sync that is reset, a client that is dropped,
// and every call that simply completes. After a real garbage collection the module must hold exactly
// the handles it held before, and its linear memory must not keep growing from one round to the next.
let wasm
let baseline
const memory = () => wasm.memory.buffer.byteLength
const tick = () => new Promise(resolve => setTimeout(resolve, 0))

beforeAll(async () => {
  wasm = ui.initSync({ module: readFileSync('src/wasm/ui/inhouse_read_ui_bg.wasm') })
  // The futures executor of the module keeps a few handles for good once asynchronous Rust has run.
  await ui.restoreLegacyBookBytes({}, { supported: () => false })
  await tick()
  await collect()
  baseline = ui.ui_live_handles()
})

/** Runs `round` many times, then again as many times: handles back at the baseline, memory flat in the second half. */
async function steady(round, { rounds = 200, slack = 0 } = {}) {
  for (let index = 0; index < rounds; index++) await round(index)
  await tick(); await collect()
  const grown = memory()
  for (let index = 0; index < rounds; index++) await round(index)
  await tick(); await collect()
  expect(ui.ui_live_handles()).toBe(baseline)
  expect(memory() - grown).toBeLessThanOrEqual(slack)
}

const file = (name, text, type = 'application/pdf') => new NodeFile([text], name, { type })

describe('the Rust cloud ports leave nothing behind', () => {
  it('restoreLegacyBookBytes releases its handles, restored or not', async () => {
    const handle = { queryPermission: async () => 'granted' }
    await steady(async index => {
      const books = [
        { id: `a${index}`, sourceType: 'local', folderFileName: 'a.pdf', size: 3, mimeType: 'application/pdf' },
        { id: `b${index}`, sourceType: 'local', folderFileName: 'b.pdf', size: 9 },
        { id: `c${index}`, sourceType: 'drive', driveFileId: 'x' }
      ]
      const patches = []
      const restored = await ui.restoreLegacyBookBytes(
        { listAll: async () => books, patch: async (id, fields) => { patches.push([id, fields]); return {} } },
        { supported: () => true, getHandle: async () => handle, readFile: async (_, name) => name === 'a.pdf' ? file('a.pdf', 'abc') : null,
          clearBookLength: () => ({ lengthDirty: true }), newContentRevision: () => 'revision' })
      expect(restored).toBe(1)
      expect(patches).toHaveLength(1)
    })
  })

  it('the folder store releases what each call touched, including failures', async () => {
    const names = new Map()
    const folder = {
      queryPermission: async () => 'prompt',
      requestPermission: async () => 'granted',
      getFileHandle: async (name, options) => {
        if (!names.has(name)) {
          if (!options?.create) throw new DOMException('missing', 'NotFoundError')
          names.set(name, '')
        }
        return {
          getFile: async () => file(name, names.get(name)),
          createWritable: async () => ({ write: async data => { names.set(name, 'written'.repeat(Number(data.size || 1))) }, close: async () => {} })
        }
      }
    }
    await steady(async index => {
      names.clear()
      const sanitize = text => String(text).replace(/[\\/:*?"<>|]+/g, '_')
      const first = await ui.saveFileIntoFolder(folder, file('book: one?.pdf', 'content'), sanitize)
      const second = await ui.saveFileIntoFolder(folder, file('book: one?.pdf', 'other content!'), sanitize)
      expect(second).not.toBe(first)
      expect(await ui.resolveNonCollidingName(folder, first, 1)).not.toBe(first)
      expect(await ui.readFileFromFolder(folder, first)).toBeTruthy()
      expect(await ui.readFileFromFolder(folder, `gone${index}.pdf`)).toBeNull()
      expect(await ui.ensureFolderPermission(folder)).toBe(true)
      expect(await ui.ensureFolderPermission(null)).toBe(false)
      expect(await ui.getOrChooseFolder(async () => folder, async () => { throw new Error('not needed') })).toBe(folder)
      const refused = { ...folder, requestPermission: async () => { throw new Error('needs a gesture') } }
      expect(await ui.getOrChooseFolder(async () => refused, async () => folder)).toBe(folder)
    }, { rounds: 100 })
  })

  it('a stopped Android importer releases its timer, its listener and its callbacks', async () => {
    const live = new Set()
    const listeners = new Set()
    const chunk = btoa('hello')
    let imported = 0
    await steady(async () => {
      const host = {
        bridge: {
          pending: () => JSON.stringify([{ id: 'one', size: 5, name: 'one.pdf', mimeType: 'application/pdf' }]),
          readChunk: () => chunk,
          acknowledge: () => {}
        },
        onFile: async () => { imported++ }, onError: () => {}, onActivity: () => {}, canImport: () => true, pollMs: 1000,
        hidden: () => false, yieldTask: () => Promise.resolve(),
        interval: callback => { live.add(callback); return callback },
        clearInterval: callback => { live.delete(callback) },
        listen: callback => { listeners.add(callback); return () => listeners.delete(callback) }
      }
      const importer = new ui.RustAndroidImports(host)
      await tick(); await tick()
      importer.stop()
      importer.free()
    })
    expect(imported).toBeGreaterThan(0)
    expect(live.size).toBe(0)
    expect(listeners.size).toBe(0)
  })

  it('a reset sync drops its timers and a dropped one is collected', async () => {
    const records = new Map()
    const library = {
      listAll: async () => [...records.values()],
      get: async id => records.get(id) ?? null,
      isRemovedFromShelf: async () => false,
      addOrTouch: async entry => { const record = { id: `drive:${entry.driveFileId}`, ...entry }; records.set(record.id, record); return record },
      patch: async (id, fields, options) => {
        const current = records.get(id)
        if (!current || (options?.ifCurrent && !options.ifCurrent(current))) return null
        const next = { ...current, ...fields, id }; records.set(id, next); return next
      },
      removeFromShelf: async book => { records.delete(book.id); return book },
      rememberRemovedDriveLink: async () => {}
    }
    let statuses = 0
    const pending = []
    await steady(async index => {
      records.clear()
      const host = {
        library, onStatus: () => { statuses++ }, onChange: () => {},
        getDriveProfile: async () => ({ id: 'account' }),
        listAllDriveBooks: async () => [{ id: `f${index}`, name: `f${index}.pdf`, size: '3', mimeType: 'application/pdf', md5Checksum: 'a'.repeat(32) }],
        uploadDriveFile: async () => ({ id: 'up' }),
        downloadDriveFile: async (_, { name }) => file(name, 'abc'),
        readDriveProgress: async () => ({ fraction: 0.5, updatedAt: 10, stateFileId: 's' }),
        writeDriveProgress: async () => ({ id: 's' }),
        spineCustomization: () => ({}), normalizeBookTitle: name => name, cleanPlaces: list => list ?? [], cleanQuotes: list => list ?? [],
        driveBookLength: () => null, wordCountFromDrive: () => null, clearBookLength: () => ({}), newContentRevision: () => 'r'
      }
      const sync = new ui.RustCloudSync(host, { id: 'account' })
      const result = await sync.sync()
      expect(result.books).toBe(1)
      sync.scheduleProgress(`drive:f${index}`)
      sync.scheduleProgress('other')
      await sync.removeFromShelf({ id: `drive:f${index}` })
      sync.reset()
      sync.free()
      pending.push(index)
    }, { rounds: 60 })
    expect(statuses).toBeGreaterThan(0)
  })

  it('the library backup is collected when dropped, finished or reset', async () => {
    const books = [{ id: 'local:a', sourceType: 'drive', driveFileId: 'drive-a', cloudAccountId: 'account', title: 'A', progressFraction: 0.2, addedAt: 5 }]
    const library = {
      listAll: async () => books, listRemoved: async () => [], get: async id => books.find(book => book.id === id) ?? null,
      patch: async (id, fields) => ({ ...books[0], ...fields, id }), addOrTouch: async entry => entry
    }
    const values = new Map()
    let device = 0, checkpoints = 0
    await steady(async index => {
      const backup = new ui.RustLibraryBackup({
        library, cloud: { uploadBook: async book => book },
        storage: { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)), removeItem: key => values.delete(key) },
        onSettings() {}, onChange() {}, onStatus() {}, settings: ['inhouse-read-theme'],
        withLock: (name, run) => run(), randomUUID: () => `device-${device++}`,
        readDriveLibrarySnapshots: async () => [], writeDriveLibrarySnapshot: async () => ({ id: 'snapshot' }),
        uploadDriveCover: async () => ({ id: 'cover' }), downloadDriveFile: async () => file('x', 'x'),
        readBackupCheckpoint: async () => ({ books: {}, settings: {} }), saveBackupCheckpoint: async () => { checkpoints++ },
        spineCustomization: () => ({})
      })
      const first = backup.sync('account')
      if (index % 2) backup.reset()
      await first.catch(() => {})
      await backup.sync('account').catch(() => {})
      backup.reset()
      backup.free()
    }, { rounds: 80 })
    // The syncs really ran to their end.
    expect(checkpoints).toBeGreaterThan(80)
  })

  it('the Drive client is collected when dropped', async () => {
    const store = new Map()
    const host = () => ({
      session: { token: () => 'token', restore: () => 'token', save() {}, clear() {} },
      storage: { getItem: key => store.get(key) ?? null, setItem: (key, value) => store.set(key, String(value)), removeItem: key => store.delete(key) },
      androidClientId: 'client', fetch: async () => new Response(JSON.stringify({ user: { permissionId: 'p', displayName: 'N', emailAddress: 'e@example.test' } }), { status: 200 }),
      randomBytes: length => new Uint8Array(length), sha256: async () => new ArrayBuffer(32), randomUUID: () => 'uuid',
      google: () => undefined, bridge: () => undefined, userAgent: () => 'test', offline: () => false, assign() {}, emit() {}, warn() {},
      remembered: () => null, spineCustomization: () => ({}), cleanQuotes: list => list ?? [], normalizeDriveBookLength: value => value
    })
    await steady(async () => {
      const client = new ui.RustDriveClient(host())
      const profile = await client.getDriveProfile()
      expect(profile.email).toBe('e@example.test')
      client.cancelDriveConnection('done')
      client.free()
    }, { rounds: 80 })
  })
})
