import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Blob as NodeBlob, File as NodeFile } from 'node:buffer'
import './helpers/rust-ui-ready.js'

// The Rust CloudSync / LibraryBackup against the frozen JavaScript originals. Two complete worlds
// (devices with their own IndexedDB library, localStorage and checkpoint store, one shared simulated
// Drive) receive the same seeded sequence of edits, syncs, removals, uploads, downloads and Drive
// failures, with an increasing fake clock and a counting uuid. After every step the whole
// observable state must be equal: every Drive call with its arguments, every record (blobs by
// content), every localStorage entry, every checkpoint, every result, error and notification.
vi.mock('../../src/js/drive-client.js', () => ({
  getDriveProfile: vi.fn(), listAllDriveBooks: vi.fn(), uploadDriveFile: vi.fn(), downloadDriveFile: vi.fn(),
  readDriveProgress: vi.fn(), writeDriveProgress: vi.fn(), readDriveLibrarySnapshots: vi.fn(),
  writeDriveLibrarySnapshot: vi.fn(), uploadDriveCover: vi.fn()
}))
const worlds = vi.hoisted(() => ({ current: null }))
vi.mock('../../src/js/cloud-backup-state.js', () => ({
  readBackupCheckpoint: async key => structuredClone(worlds.current.checkpoints.get(key) || { books: {}, settings: {} }),
  saveBackupCheckpoint: async (key, value) => { worlds.current.checkpoints.set(key, structuredClone(value)) }
}))
import * as drive from '../../src/js/drive-client.js'
import { LibraryStore } from '../../src/js/library-store.js'
import { CloudSync } from '../../src/js/cloud-sync.js'
import { LibraryBackup } from '../../src/js/library-backup.js'
import { CloudSync as ReferenceCloudSync } from './helpers/reference-cloud-sync.js'
import { LibraryBackup as ReferenceLibraryBackup } from './helpers/reference-library-backup.js'

const realNow = Date.now.bind(Date)
function random(seed) {
  let state = seed >>> 0
  return () => { state = (state + 0x6D2B79F5) >>> 0; let t = state; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296 }
}
const pick = (rng, list) => list[Math.floor(rng() * list.length)]

const SETTINGS = ['inhouse-read-shelf-plants', 'inhouse-read-shelf-lamps', 'inhouse-read-shelf-type',
  'inhouse-read-shelf-view', 'inhouse-read-theme', 'inhouse-read-reading-preferences']
const CHANGES = 'inhouse-read-backup-settings-changes'

function memoryStorage() {
  const values = new Map()
  return { values, getItem: k => values.get(k) ?? null, setItem: (k, v) => values.set(k, String(v)), removeItem: k => values.delete(k) }
}

// Blobs by content, so two worlds can be compared.
async function plain(value) {
  if (value instanceof NodeBlob || (typeof Blob !== 'undefined' && value instanceof Blob)) {
    return { blob: await value.text(), type: value.type, size: value.size, name: value.name }
  }
  if (Array.isArray(value)) return Promise.all(value.map(plain))
  if (value && typeof value === 'object') {
    const result = {}
    for (const key of Object.keys(value).sort()) result[key] = await plain(value[key])
    return result
  }
  return value
}

async function makeWorld(kind, scenario) {
  const world = { kind, scenario, files: new Map(), snapshots: new Map(), progress: new Map(), checkpoints: new Map(),
    log: [], clock: 5000, uuid: 0, devices: [], failures: {}, events: [] }
  bind(world)
  const Cloud = kind === 'reference' ? ReferenceCloudSync : CloudSync
  const Backup = kind === 'reference' ? ReferenceLibraryBackup : LibraryBackup
  for (let index = 0; index < 3; index++) {
    const storage = memoryStorage()
    const library = new LibraryStore(`diff-${kind}-${scenario}-${index}`)
    const cloud = new Cloud(library, {
      onStatus: (...args) => world.events.push(['status', index, ...args]),
      onChange: (...args) => world.events.push(['change', index, args.length])
    })
    cloud.setProfile({ id: 'account' })
    const backup = new Backup(library, cloud, {
      storage, onSettings: () => world.events.push(['settings', index]),
      onChange: () => world.events.push(['backup-change', index]),
      onStatus: (...args) => world.events.push(['backup-status', index, ...args])
    })
    world.devices.push({ library, storage, cloud, backup })
    // The original stores its device id when it is constructed; the Rust object is created at the first
    // sync. Creating it now keeps the random ids and the clock in step. Nothing else is observable.
    if (kind !== 'reference') await backup.sync('').catch(() => {})
  }
  return world
}

function bind(world) {
  worlds.current = world
  const fail = name => { if (world.failures[name] > 0) { world.failures[name]--; throw new Error(`injected ${name}`) } }
  const note = async (name, ...args) => world.log.push([name, await plain(args)])
  drive.getDriveProfile.mockImplementation(async () => { await note('profile'); fail('profile'); return { id: 'account', email: 'a@example.com' } })
  drive.readDriveLibrarySnapshots.mockImplementation(async () => {
    await note('readSnapshots'); fail('snapshots'); return structuredClone([...world.snapshots.values()])
  })
  drive.writeDriveLibrarySnapshot.mockImplementation(async (snapshot, stateFileId) => {
    await note('writeSnapshot', snapshot, stateFileId); fail('writeSnapshot')
    const id = stateFileId || `manifest-${snapshot.deviceId}`
    world.snapshots.set(snapshot.deviceId, structuredClone({ ...snapshot, stateFileId: id })); return { id }
  })
  drive.uploadDriveFile.mockImplementation(async file => {
    await note('uploadFile', file); fail('upload')
    const id = `file-${world.files.size}`
    world.files.set(id, { file, id, name: file.name, mimeType: file.type, size: file.size, md5Checksum: world.files.size % 2 ? 'a'.repeat(32) : undefined })
    return { id, name: file.name, md5Checksum: world.files.get(id).md5Checksum }
  })
  drive.uploadDriveCover.mockImplementation(async (file, name) => {
    await note('uploadCover', file, name); fail('cover')
    const id = `cover-${world.files.size}`
    world.files.set(id, { file, id, name: id }); return { id }
  })
  drive.downloadDriveFile.mockImplementation(async (id, options = {}) => {
    await note('download', id, options); fail('download')
    if (!world.files.has(id)) throw new Error('Missing file')
    const file = world.files.get(id).file
    return new NodeFile([await file.arrayBuffer()], options.name || file.name || id, { type: options.mimeType || file.type })
  })
  drive.listAllDriveBooks.mockImplementation(async () => {
    await note('list'); fail('list')
    return [...world.files.values()].filter(f => f.id.startsWith('file-')).map(f => ({ id: f.id, name: f.name, mimeType: f.mimeType, size: String(f.size), md5Checksum: f.md5Checksum }))
  })
  drive.readDriveProgress.mockImplementation(async id => { await note('readProgress', id); fail('readProgress'); return structuredClone(world.progress.get(id) || null) })
  drive.writeDriveProgress.mockImplementation(async (id, data, stateFileId) => {
    await note('writeProgress', id, data, stateFileId); fail('writeProgress')
    world.progress.set(id, { ...structuredClone(data), stateFileId: stateFileId || `progress-${id}` }); return { id: stateFileId || `progress-${id}` }
  })
  // The fake IndexedDB stamps its events with the clock whenever its own scheduler runs; those reads
  // do not belong to the code under test and must not move the fake clock.
  vi.spyOn(Date, 'now').mockImplementation(() => /fake-indexeddb/.test(new Error().stack) ? realNow() : ++world.clock)
  vi.stubGlobal('crypto', { randomUUID: () => `uuid-${++world.uuid}` })
}

async function stateOf(world) {
  const devices = []
  for (const device of world.devices) {
    devices.push({
      books: await plain(await device.library.listAll()),
      removed: await plain(await device.library.listRemoved()),
      storage: Object.fromEntries([...device.storage.values.entries()].sort()),
      task: Boolean(device.backup.task)
    })
  }
  return {
    devices, events: world.events.splice(0), log: world.log.splice(0),
    files: await plain([...world.files.values()].map(({ file, ...entry }) => ({ ...entry, content: file }))),
    snapshots: [...world.snapshots.entries()], progress: [...world.progress.entries()], checkpoints: [...world.checkpoints.entries()],
    clock: world.clock, uuid: world.uuid
  }
}

const TITLES = ['Alpha', 'Beta', 'Gamma']
function plan(rng, steps) {
  const ops = []
  for (let step = 0; step < steps; step++) {
    const device = Math.floor(rng() * 3)
    const kind = pick(rng, ['add', 'add', 'edit', 'edit', 'edit', 'cover', 'progress', 'remove', 'setting', 'setting', 'sync', 'sync', 'sync', 'sync',
      'cloudSync', 'cloudSync', 'bookProgress', 'bookProgress', 'upload', 'download', 'fail', 'resetBackup', 'resetCloud', 'restore'])
    ops.push({ kind, device, a: rng(), b: rng(), c: rng(), d: Math.floor(rng() * 1000) })
  }
  return ops
}

async function perform(world, op) {
  const device = world.devices[op.device]
  const books = await device.library.listAll()
  const book = books.length ? books[Math.floor(op.a * books.length)] : null
  const outcome = {}
  try {
    switch (op.kind) {
      case 'add':
        await device.library.addOrTouch({ sourceType: 'local', name: `book-${op.d % 5}.epub`, title: TITLES[op.d % 3], author: op.b < .5 ? 'Writer' : undefined,
          mimeType: 'application/epub+zip', size: 8, content: new NodeBlob([`original-${op.d % 5}`]), shelfOrder: op.d % 7,
          progressFraction: op.b > .7 ? op.c : 0, progressUpdatedAt: op.b > .7 ? 100 + op.d : undefined, addedAt: 50 + op.d,
          ...(op.c < .5 ? { cover: new NodeBlob([`cover-${op.d}`], { type: 'image/png' }), coverUpdatedAt: 10 + op.d } : {}) },
          { restoreRemoved: op.c > .9 })
        break
      case 'edit':
        if (book) await device.library.patch(book.id, { [pick(() => op.b, ['title', 'shelfOrder', 'author', 'spineColorOverride', 'spineTextFinish', 'pageCount'])]:
          op.c < .3 ? TITLES[op.d % 3] : op.d % 11, ...(op.c > .8 ? { shelfPosition: { shelf: op.d % 3, x: op.b } } : {}) })
        break
      case 'cover':
        if (book) await device.library.patch(book.id, { cover: new NodeBlob([`cover-${op.d}`], { type: 'image/webp' }), coverUpdatedAt: 100 + op.d })
        break
      case 'progress':
        if (book) await device.library.updateProgress(book.id, op.b, { kind: 'epub', value: `c${op.d % 9}` })
        break
      case 'remove':
        if (book) await device.cloud.removeFromShelf(book, op.c > .6 ? { removedAt: 200 + op.d } : undefined)
        break
      case 'setting': {
        const key = SETTINGS[op.d % SETTINGS.length]
        device.storage.setItem(key, op.c < .2 ? '[]' : `value-${op.d % 4}`)
        if (op.b < .6) device.storage.setItem(CHANGES, JSON.stringify({ ...JSON.parse(device.storage.getItem(CHANGES) || '{}'), [key]: op.b < .3 ? Date.now() : 1 }))
        break
      }
      case 'sync': outcome.value = await device.backup.sync(op.b < .05 ? '' : 'account'); break
      case 'cloudSync': outcome.value = await device.cloud.sync(); break
      case 'bookProgress': if (book) outcome.value = await device.cloud.syncBookProgress(op.b < .2 ? book.id : book); break
      case 'upload': if (book) outcome.value = await device.cloud.uploadBook(book); break
      case 'download': if (book) outcome.value = await device.cloud.downloadForOffline(book); break
      case 'fail': world.failures[pick(() => op.b, ['profile', 'snapshots', 'writeSnapshot', 'upload', 'cover', 'download', 'list', 'readProgress', 'writeProgress'])] = 1; break
      case 'resetBackup': device.backup.reset(); break
      case 'resetCloud': device.cloud.reset(); device.cloud.setProfile(op.b < .5 ? { id: 'account' } : null); break
      case 'restore': if (book) await device.library.addOrTouch({ ...book, content: new NodeBlob(['again']) }, { restoreRemoved: true }); break
    }
  } catch (error) { outcome.error = error.message }
  return { outcome: await plain(outcome), state: await stateOf(world) }
}

const SCENARIOS = Number(process.env.CLOUD_DIFFERENTIAL_SCENARIOS || 70)
beforeEach(() => { vi.stubGlobal('Blob', NodeBlob); vi.stubGlobal('File', NodeFile); vi.clearAllMocks() })
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('CloudSync and LibraryBackup (Rust) against the originals', () => {
  it(`keep identical state, Drive traffic and results through ${SCENARIOS} seeded scenarios`, async () => {
    let syncs = 0, uploads = 0, restores = 0, errors = 0
    for (let scenario = 1; scenario <= SCENARIOS; scenario++) {
      const ops = plan(random(scenario * 7919), 26)
      const reference = await makeWorld('reference', scenario), native = await makeWorld('rust', scenario)
      try {
        for (let index = 0; index < ops.length; index++) {
          bind(reference); const expected = await perform(reference, ops[index])
          bind(native); const actual = await perform(native, ops[index])
          // Library names differ per world; everything else must match.
          expect(actual, `scenario ${scenario}, step ${index} (${ops[index].kind})`).toEqual(expected)
          if (ops[index].kind === 'sync') syncs++
          if (expected.state.log.some(entry => entry[0] === 'uploadFile')) uploads++
          if (expected.state.devices.some(device => device.books.some(book => book.sourceType === 'drive' && book.content))) restores++
          if (expected.outcome.error) errors++
        }
      } finally { for (const world of [reference, native]) for (const device of world.devices) await device.library.close() }
    }
    expect(syncs).toBeGreaterThan(SCENARIOS * 3)
    expect(uploads).toBeGreaterThan(SCENARIOS / 3)
    expect(restores).toBeGreaterThan(SCENARIOS / 4)
    expect(errors).toBeGreaterThan(SCENARIOS / 4)
  }, 280_000)
})
