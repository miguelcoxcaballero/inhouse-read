// Differential test: two decisions app.js handed to rust-ui/src/app_controller.rs (the follow-up of a saved
// position and the adoption of the open reader's word count) against the frozen JavaScript they replaced
// (helpers/reference-app-controller.js). Both run on the same seeded hosts; every host call, the shared
// state, the length refresh timer and every thrown or rejected error are compared.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as reference from './helpers/reference-app-controller.js'
import { rustShelf } from './helpers/rust-shelf-ready.js'

const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve() }
function random(seed) {
  let value = seed >>> 0
  return () => { value = (value * 1103515245 + 12345) >>> 0; return value / 2 ** 32 }
}

function world(seed) {
  const pick = random(seed), log = [], chance = p => pick() < p
  const fail = name => { if (chance(.08)) throw new Error(`${name} failed`) }
  const app = { appDisposed:chance(.15), lengthStatusVersion:Math.floor(pick() * 4), shelfLengthStatusVersion:0, lengthRefreshTimer:null }
  const readerScreen = { hidden:!chance(.15) }
  const host = {
    state:app, els:{ readerScreen }, document:{ hidden:chance(.1) },
    readerPositionGuard:() => { log.push(['guard']); fail('guard'); return { remember:(id, position) => { log.push(['remember', id, position]); fail('remember') } } },
    onLocalBookChange:(id, fields) => { log.push(['room', id, fields]); fail('room') },
    hasDriveSession:() => { log.push(['session']); return chance(.6) },
    cloudSync:{ scheduleProgress:id => { log.push(['cloud', id]); fail('cloud') } },
    scheduleLibraryBackup:() => { log.push(['backup']); fail('backup') },
    wordCountQueue:{ cancel:id => { log.push(['cancel', id]); fail('cancel') } },
    refreshShelf:() => { log.push(['refresh']); return chance(.2) ? Promise.reject(new Error('refresh failed')) : Promise.resolve() },
    library:{ patch:(id, fields, options) => {
      log.push(['patch', id, fields])
      const current = [null, { content:true, contentRevision:'r1' }, { content:true, contentRevision:'r2' }, { contentRevision:'r1' }, {}][Math.floor(pick() * 5)]
      log.push(['ifCurrent', options.ifCurrent(current)])
      if (chance(.1)) throw new Error('patch threw')
      const saved = chance(.25) ? null : { id:`saved-${id}`, driveFileId:chance(.5) ? 'drive' : undefined }
      return chance(.15) ? Promise.reject(new Error('patch rejected')) : chance(.5) ? Promise.resolve(saved) : saved
    } }
  }
  const env = { app, readerPositionGuard:host.readerPositionGuard, localRoomBookChanged:host.onLocalBookChange, hasDriveSession:host.hasDriveSession,
    cloudSync:host.cloudSync, scheduleLibraryBackup:host.scheduleLibraryBackup, library:host.library, wordCountQueue:host.wordCountQueue,
    isBookLengthReady:book => rustShelf.length_is_ready(book), scheduleLengthRefresh:() => rustShelf.app_schedule_length_refresh(host) }
  return { pick, chance, log, app, host, env }
}

const outcome = async run => {
  try { const value = await run(); return ['ok', value] } catch (error) { return ['error', error?.message ?? String(error)] }
}
const records = [null, undefined, { id:'a' }, { id:'b', progressFraction:.5, locator:{ cfi:'x' }, driveFileId:'d' }, { id:'c', driveFileId:'' }]
const fieldSets = [undefined, [], ['progressFraction'], ['spineColor', 'progressFraction'], ['coverFinish']]

async function savedScript(implementation, seed) {
  const w = world(seed), results = []
  for (let step = 0; step < 6; step++) {
    const record = records[Math.floor(w.pick() * records.length)], fields = fieldSets[Math.floor(w.pick() * fieldSets.length)]
    if (w.chance(.1)) w.app.appDisposed = !w.app.appDisposed
    results.push(await outcome(() => implementation(w, record, record?.id ?? 'id', fields)))
  }
  return { results, log:w.log, app:{ ...w.app } }
}

const books = [{ id:'a', contentRevision:'r1', format:'epub' }, { id:'b', contentRevision:'', format:'pdf' }, { id:'c', format:'epub' },
  { id:'e', contentRevision:'r2', content:{ size:10 }, format:'epub' }, { id:'f', contentRevision:'r1', format:'pdf', driveFileId:'drive' },
  { id:'d', contentRevision:'r1', format:'epub', wordCount:12, wordCountComplete:true, wordCountVersion:1, wordCountContentRevision:'r0' }]
const metadataSets = [{ wordCount:120, wordCountComplete:true, wordCountVersion:2 }, { wordCount:90, wordCountComplete:true, wordCountVersion:2 },
  { wordCount:40, wordCountComplete:false, wordCountVersion:2 }, { wordCount:120, wordCountComplete:true, wordCountVersion:3 },
  { wordCount:-1, wordCountComplete:true, wordCountVersion:2 }, {}]

async function lengthScript(implementation, seed) {
  const w = world(seed), results = []
  for (let step = 0; step < 6; step++) {
    const record = books[Math.floor(w.pick() * books.length)], metadata = metadataSets[Math.floor(w.pick() * metadataSets.length)]
    results.push(await outcome(() => implementation(w, record, metadata)))
    await flush()
    if (w.chance(.5)) { await vi.advanceTimersByTimeAsync(100); await flush() }
    w.log.push(['timer', w.app.lengthRefreshTimer === null ? null : 'set', w.app.lengthStatusVersion])
  }
  await vi.advanceTimersByTimeAsync(200); await flush()
  return { results, log:w.log, app:{ ...w.app, lengthRefreshTimer:w.app.lengthRefreshTimer === null ? null : 'set' } }
}

beforeEach(() => { vi.useFakeTimers(); vi.spyOn(console, 'warn').mockImplementation(() => {}) })
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

describe('app.js decisions in rust-ui/src/app_controller.rs against the frozen JavaScript', () => {
  for (let seed = 1; seed <= 40; seed++) {
    it(`saved position follow-up, seeded host ${seed}`, async () => {
      const expected = await savedScript((w, ...args) => reference.onSaved(w.env, ...args), seed)
      const actual = await savedScript((w, ...args) => rustShelf.app_progress_saved(w.host, ...args), seed)
      expect(actual).toEqual(expected)
    })
    it(`reader word count adoption, seeded host ${seed}`, async () => {
      const expected = await lengthScript((w, ...args) => reference.onLengthMetadata(w.env, ...args), seed)
      const actual = await lengthScript((w, ...args) => rustShelf.app_length_metadata(w.host, ...args), seed)
      expect(actual).toEqual(expected)
    })
  }
  it('covers patches, cancellations, cloud schedules and refreshes', async () => {
    const all = []
    for (let seed = 1; seed <= 40; seed++) all.push(...(await lengthScript((w, ...args) => reference.onLengthMetadata(w.env, ...args), seed)).log)
    for (const kind of ['patch', 'cancel', 'cloud', 'backup', 'refresh']) expect(all.some(entry => entry[0] === kind)).toBe(true)
    const saved = []
    for (let seed = 1; seed <= 40; seed++) saved.push(...(await savedScript((w, ...args) => reference.onSaved(w.env, ...args), seed)).log)
    for (const kind of ['remember', 'room', 'cloud', 'backup']) expect(saved.some(entry => entry[0] === kind)).toBe(true)
  })
})
