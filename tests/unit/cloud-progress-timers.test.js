import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Blob as NodeBlob, File as NodeFile } from 'node:buffer'
import './helpers/rust-ui-ready.js'

// The debounce of reading-state uploads (1.8 s), flushing, resetting and trashing a book while its
// upload is waiting, and the status line when the upload fails: the Rust CloudSync against the
// frozen original, with fake timers.
vi.mock('../../src/js/drive-client.js', () => ({
  getDriveProfile: vi.fn(), listAllDriveBooks: vi.fn(), uploadDriveFile: vi.fn(), downloadDriveFile: vi.fn(),
  readDriveProgress: vi.fn(), writeDriveProgress: vi.fn()
}))
import * as drive from '../../src/js/drive-client.js'
import { LibraryStore } from '../../src/js/library-store.js'
import { CloudSync } from '../../src/js/cloud-sync.js'
import { CloudSync as OriginalCloudSync } from './helpers/reference-cloud-sync.js'

let serial = 0
beforeEach(() => { vi.stubGlobal('Blob', NodeBlob); vi.stubGlobal('File', NodeFile); vi.clearAllMocks() })
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

async function scenario(Sync, script) {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  const log = []
  const library = new LibraryStore(`timers-${Sync === CloudSync ? 'rust' : 'js'}-${++serial}`)
  const sync = new Sync(library, { onStatus: (...args) => log.push(['status', ...args]), onChange: (...args) => log.push(['change', args.length]) })
  sync.setProfile({ id: 'account' })
  drive.readDriveProgress.mockImplementation(async id => { log.push(['read', id]); return null })
  drive.writeDriveProgress.mockImplementation(async (id, data, state) => {
    log.push(['write', id, data.fraction, state])
    if (scenarioFailure.on) throw new Error('Drive is away')
    return { id: `state-${id}` }
  })
  const scenarioFailure = { on: false }
  const book = await library.addOrTouch({ sourceType: 'drive', name: 'a.epub', size: 5, driveFileId: 'drive-a', cloudAccountId: 'account' })
  await library.updateProgress(book.id, .4, { kind: 'epub', value: 'x' })
  const other = await library.addOrTouch({ sourceType: 'drive', name: 'b.epub', size: 5, driveFileId: 'drive-b', cloudAccountId: 'account' })
  await library.updateProgress(other.id, .6, { kind: 'epub', value: 'y' })
  const step = async ms => { await vi.advanceTimersByTimeAsync(ms); await vi.advanceTimersByTimeAsync(0) }
  await script({ sync, book, other, library, step, log, failure: scenarioFailure })
  await step(5000)
  log.push(['library', (await library.listAll()).map(record => [record.driveFileId, record.progressDirty, record.progressStateFileId]).sort()])
  sync.reset()
  await library.close()
  vi.useRealTimers()
  return log
}

const SCRIPTS = {
  'waits 1.8 seconds, then uploads once': async ({ sync, book, step, log }) => {
    sync.scheduleProgress(book.id); await step(1799); log.push(['mid']); await step(1); log.push(['after'])
  },
  'a second request restarts the wait': async ({ sync, book, step, log }) => {
    sync.scheduleProgress(book.id); await step(1000); sync.scheduleProgress(book.id); await step(1500); log.push(['mid']); await step(400); log.push(['after'])
  },
  'two books wait independently': async ({ sync, book, other, step, log }) => {
    sync.scheduleProgress(book.id); await step(900); sync.scheduleProgress(other.id); await step(1000); log.push(['mid']); await step(900); log.push(['after'])
  },
  'flushing uploads at once and cancels the wait': async ({ sync, book, step, log }) => {
    sync.scheduleProgress(book.id); await step(500); await sync.flushProgress(book.id); log.push(['flushed']); await step(3000)
  },
  'resetting cancels every wait': async ({ sync, book, other, step }) => {
    sync.scheduleProgress(book.id); sync.scheduleProgress(other.id); await step(500); sync.reset(); sync.setProfile({ id: 'account' }); await step(4000)
  },
  'trashing the book cancels its wait': async ({ sync, book, other, step, log }) => {
    sync.scheduleProgress(book.id); sync.scheduleProgress(other.id); await step(500); await sync.removeFromShelf(book); log.push(['removed']); await step(4000)
  },
  'a missing id schedules nothing': async ({ sync, step }) => {
    sync.scheduleProgress(''); sync.scheduleProgress(undefined); sync.scheduleProgress(0); await step(4000)
  },
  'a failed upload is reported on the status line': async ({ sync, book, step, failure }) => {
    failure.on = true; sync.scheduleProgress(book.id); await step(1800); await step(10)
  },
  'a request made during an upload queues behind it': async ({ sync, book, step, log }) => {
    sync.scheduleProgress(book.id); await step(1800); sync.scheduleProgress(book.id); await step(1800); log.push(['twice'])
  }
}

describe('progress upload timers (Rust) against the original', () => {
  for (const [name, script] of Object.entries(SCRIPTS)) {
    it(name, async () => {
      const expected = await scenario(OriginalCloudSync, script)
      const actual = await scenario(CloudSync, script)
      expect(actual).toEqual(expected)
      expect(expected.length).toBeGreaterThanOrEqual(1)
    })
  }
  it('the timer really uploads: the wait ends with exactly one write', async () => {
    const log = await scenario(CloudSync, SCRIPTS['waits 1.8 seconds, then uploads once'])
    expect(log.filter(entry => entry[0] === 'write')).toHaveLength(1)
    expect(log.findIndex(entry => entry[0] === 'mid')).toBeLessThan(log.findIndex(entry => entry[0] === 'write'))
  })
})
