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

// The length queue's `onChange`: the same seeded hosts, records with and without a Drive file.
const changes = [null, undefined, {}, { id:'a' }, { id:'b', driveFileId:'drive' }, { id:'c', driveFileId:'' }]
async function changeScript(implementation, seed) {
  const w = world(seed), results = []
  for (let step = 0; step < 6; step++) {
    if (w.chance(.1)) w.app.appDisposed = !w.app.appDisposed
    if (w.chance(.2)) w.host.els.readerScreen.hidden = !w.host.els.readerScreen.hidden
    results.push(await outcome(() => implementation(w, changes[Math.floor(w.pick() * changes.length)])))
    if (w.chance(.5)) { await vi.advanceTimersByTimeAsync(100); await flush() }
    w.log.push(['timer', w.app.lengthRefreshTimer === null ? null : 'set', w.app.lengthStatusVersion])
  }
  await vi.advanceTimersByTimeAsync(200); await flush()
  return { results, log:w.log, app:{ ...w.app, lengthRefreshTimer:w.app.lengthRefreshTimer === null ? null : 'set' } }
}

// The Android import's `onFile`: an open shelf whose close resolves, rejects or throws, a pending
// progress write that resolves or rejects, and an openFile that answers, rejects or throws.
async function importScript(implementation, seed) {
  const w = world(seed), results = []
  const settle = (name, value) => {
    const roll = w.pick()
    if (roll < .1) throw new Error(`${name} threw`)
    if (roll < .2) return Promise.reject(new Error(`${name} rejected`))
    return roll < .6 ? Promise.resolve(value) : value
  }
  const writes = new Map()
  w.host.progressWrites = { get:id => { w.log.push(['write', id]); return writes.get(id) } }
  w.host.openFile = (file, options) => { w.log.push(['open', file, options]); return settle('open', { opened:file }) }
  for (let step = 0; step < 5; step++) {
    w.app.shelf = w.chance(.25) ? null : { close:() => { w.log.push(['close']); return settle('close', undefined) } }
    w.app.currentBookId = w.chance(.3) ? null : `book-${step}`
    writes.clear()
    // A failed write the import never reaches must not count as an unhandled rejection.
    const failed = () => { const write = Promise.reject(new Error('write failed')); write.catch(() => {}); return write }
    if (w.chance(.6)) writes.set(w.app.currentBookId, w.chance(.4) ? failed() : Promise.resolve({ saved:true }))
    results.push(await outcome(() => implementation(w, `file-${step}`)))
  }
  return { results, log:w.log }
}

// The listeners app.js hands over: pagehide (persisted or not, every disposer able to throw, a pending
// Drive poll), the first visibilitychange's length refresh, a room setting change and a storage event.
async function listenerScript(implementation, seed) {
  const w = world(seed), results = [], { pick, chance, log, app, host } = w
  const disposer = name => ({ [name === 'queue' ? 'dispose' : 'destroy']:() => { log.push([name]); if (chance(.05)) throw new Error(`${name} failed`) } })
  Object.assign(host, {
    profileView:disposer('profile'), readingStreak:disposer('streak'), nativeImportShelfGate:disposer('gate'),
    shelfRefreshQueue:{ dispose:() => { log.push(['refreshQueue']); if (chance(.05)) throw new Error('refreshQueue failed') } },
    wordCountQueue:{ ...host.wordCountQueue, dispose:() => { log.push(['wordQueue']) } },
    liveRoom:disposer('live'),
    releaseShelfSoundPreference:() => { log.push(['sound']) },
    releasePositionGuard:() => { log.push(['guardFree']) },
    libraryBackup:{ markSettingChanged:(account, detail) => { log.push(['mark', account, detail]); if (chance(.05)) throw new Error('mark failed'); return chance(.6) } },
    scheduleRoomCapture:(...args) => { log.push(['capture', args]) },
    applyCloudSettings:keys => { log.push(['settings', keys]) }
  })
  host.driveActions = { state:app, document:host.document, online:() => chance(.8), hasDriveSession:() => chance(.5),
    getRememberedDriveProfile:() => null, cancelDrivePoll:timer => { log.push(['cancelPoll', timer === null ? null : typeof timer]); clearTimeout(timer) },
    armDrivePoll:(generation, delay) => { log.push(['armPoll', generation, delay]); return setTimeout(() => {}, delay) } }
  w.env.bookDataModule = () => rustShelf
  Object.assign(w.env, { profileView:host.profileView, releaseShelfSoundPreference:host.releaseShelfSoundPreference, readingStreak:host.readingStreak,
    nativeImportShelfGate:host.nativeImportShelfGate, shelfRefreshQueue:host.shelfRefreshQueue, wordCountQueue:host.wordCountQueue,
    driveActionsHost:host.driveActions, releasePositionGuard:host.releasePositionGuard, liveRoom:host.liveRoom, document:host.document,
    libraryBackup:host.libraryBackup, scheduleRoomCapture:host.scheduleRoomCapture, applyCloudSettings:host.applyCloudSettings })
  for (const timer of ['backupTimer', 'roomCaptureTimer', 'roomRefreshRetry']) app[timer] = chance(.5) ? setTimeout(() => log.push(['fired', timer]), 50) : null
  app.drivePollTimer = chance(.4) ? setTimeout(() => log.push(['fired', 'poll']), 50) : null
  app.drivePollGeneration = 3
  app.lengthRefreshTimer = chance(.5) ? setTimeout(() => log.push(['fired', 'length']), 50) : null
  app.shelfLengthStatusVersion = Math.floor(pick() * 3)
  const profiles = [null, {}, { id:'' }, { id:'account' }]
  const events = [{}, { key:null, storageArea:localStorage }, { key:'inhouse-read-shelf-plants', storageArea:localStorage },
    { key:'inhouse-read-shelf-lamps', storageArea:sessionStorage }, { key:'other', storageArea:localStorage }, { key:'inhouse-read-shelf-', storageArea:null }]
  for (let step = 0; step < 8; step++) {
    const roll = pick()
    if (roll < .3) results.push(await outcome(() => implementation.length(w)))
    else if (roll < .5) { app.driveProfile = profiles[Math.floor(pick() * profiles.length)]; results.push(await outcome(() => implementation.setting(w, { detail:{ key:`k${step}` } }))) }
    else if (roll < .7) results.push(await outcome(() => implementation.storage(w, events[Math.floor(pick() * events.length)])))
    else if (roll < .8) host.document.hidden = !host.document.hidden
    else results.push(await outcome(() => implementation.hide(w, { persisted:chance(.3) })))
    log.push(['state', app.appDisposed, app.lengthRefreshTimer === null ? null : 'set', app.drivePollTimer === null ? null : 'set', app.drivePollGeneration])
  }
  await vi.advanceTimersByTimeAsync(200); await flush()
  return { results, log }
}
const referenceListeners = {
  length:w => reference.lengthVisibility(w.env), setting:(w, e) => reference.roomSettingChanged(w.env, e),
  storage:(w, e) => reference.storageChanged(w.env, e), hide:(w, e) => reference.pageHide(w.env, e)
}
const rustListeners = {
  length:w => rustShelf.app_length_visibility(w.host), setting:(w, e) => rustShelf.app_room_setting_changed(w.host, e.detail),
  storage:(w, e) => rustShelf.app_storage_changed(w.host, e), hide:(w, e) => rustShelf.app_page_hide(w.host, e)
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
    it(`length queue change, seeded host ${seed}`, async () => {
      const expected = await changeScript((w, record) => reference.onLengthChange(w.env, record), seed)
      const actual = await changeScript((w, record) => rustShelf.app_length_change(w.host, record), seed)
      expect(actual).toEqual(expected)
    })
    it(`pagehide, visibility, room setting and storage listeners, seeded host ${seed}`, async () => {
      const expected = await listenerScript(referenceListeners, seed)
      const actual = await listenerScript(rustListeners, seed)
      expect(actual).toEqual(expected)
    })
    it(`Android file import, seeded host ${seed}`, async () => {
      const expected = await importScript((w, file) => reference.importFile({ app:w.app, progressWrites:w.host.progressWrites, openFile:w.host.openFile }, file), seed)
      const actual = await importScript((w, file) => rustShelf.app_import_file(w.host, file), seed)
      expect(actual).toEqual(expected)
    })
  }
  it('covers changes, imports and their failures', async () => {
    const log = [], results = []
    for (let seed = 1; seed <= 40; seed++) {
      log.push(...(await changeScript((w, record) => reference.onLengthChange(w.env, record), seed)).log)
      const run = await importScript((w, file) => reference.importFile({ app:w.app, progressWrites:w.host.progressWrites, openFile:w.host.openFile }, file), seed)
      log.push(...run.log); results.push(...run.results)
    }
    for (const kind of ['cloud', 'backup', 'refresh', 'close', 'write', 'open']) expect(log.some(entry => entry[0] === kind)).toBe(true)
    for (const message of ['close threw', 'close rejected', 'open threw', 'open rejected']) expect(results.some(([, value]) => value === message)).toBe(true)
    expect(results.some(([kind]) => kind === 'ok')).toBe(true)
  })
  it('covers every listener branch', async () => {
    const log = []
    for (let seed = 1; seed <= 40; seed++) log.push(...(await listenerScript(referenceListeners, seed)).log)
    for (const kind of ['profile', 'sound', 'streak', 'gate', 'refreshQueue', 'wordQueue', 'guardFree', 'live', 'cancelPoll', 'mark', 'capture', 'settings', 'refresh'])
      expect(log.some(entry => entry[0] === kind), kind).toBe(true)
    expect(log.some(entry => entry[0] === 'settings' && entry[1][0] === 'inhouse-read-shelf-plants')).toBe(true)
  })
  it('covers patches, cancellations, cloud schedules and refreshes', async () => {
    const all = []
    for (let seed = 1; seed <= 40; seed++) all.push(...(await lengthScript((w, ...args) => reference.onLengthMetadata(w.env, ...args), seed)).log)
    for (const kind of ['patch', 'cancel', 'cloud', 'backup', 'refresh']) expect(all.some(entry => entry[0] === kind)).toBe(true)
    const saved = []
    for (let seed = 1; seed <= 40; seed++) saved.push(...(await savedScript((w, ...args) => reference.onSaved(w.env, ...args), seed)).log)
    for (const kind of ['remember', 'room', 'cloud', 'backup']) expect(saved.some(entry => entry[0] === kind)).toBe(true)
  })
})
