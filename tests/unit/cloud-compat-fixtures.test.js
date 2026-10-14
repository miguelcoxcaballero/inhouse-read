import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Blob as NodeBlob, File as NodeFile } from 'node:buffer'
import './helpers/rust-ui-ready.js'

// Compatibility with data that older versions wrote. The expected values below were produced by the
// JavaScript implementation before its port (the frozen copies in helpers/): an old per-device
// library manifest merged into a new device, with a tombstone, a hostile id and unknown fields, and the
// exact reading-state file the old client uploaded for a given book. The formats must not move.
vi.mock('../../src/js/drive-client.js', () => ({
  getDriveProfile: vi.fn(), listAllDriveBooks: vi.fn(), uploadDriveFile: vi.fn(), downloadDriveFile: vi.fn(),
  readDriveProgress: vi.fn(), writeDriveProgress: vi.fn(), readDriveLibrarySnapshots: vi.fn(),
  writeDriveLibrarySnapshot: vi.fn(), uploadDriveCover: vi.fn()
}))
vi.mock('../../src/js/cloud-backup-state.js', () => ({
  readBackupCheckpoint: async () => ({ books: {}, settings: {} }), saveBackupCheckpoint: async () => {}
}))
import * as drive from '../../src/js/drive-client.js'
import { LibraryStore } from '../../src/js/library-store.js'
import { CloudSync } from '../../src/js/cloud-sync.js'
import { LibraryBackup } from '../../src/js/library-backup.js'

const FIXTURE = {
 "result": {
  "books": 0,
  "uploaded": 0,
  "downloaded": 1,
  "errors": []
 },
 "books": [
  {
   "progressFraction": 0.25,
   "spineColorOverride": "#224466",
   "author": "Herbert",
   "title": "Dune",
   "shelfOrder": 3,
   "locator": {
    "kind": "epub",
    "value": "cfi-1"
   },
   "sourceType": "drive",
   "driveFileId": "drive-1",
   "cloudAccountId": "account",
   "id": "drive:drive-1",
   "addedAt": 9014,
   "lastOpenedAt": 9014,
   "wordCount": null,
   "wordCountVersion": null,
   "wordCountComplete": false,
   "wordCountContentRevision": null,
   "lengthSource": null,
   "estimatedPageCount": null,
   "contentDriveChecksum": null,
   "progressDirty": false,
   "progressUpdatedAt": 9039,
   "lengthDirty": false,
   "progressStateFileId": "state-1"
  }
 ],
 "removed": [
  {
   "id": "drive:drive-2",
   "name": "",
   "size": 0,
   "driveFileId": "drive-2",
   "cloudAccountId": "account",
   "removedAt": 1400
  }
 ],
 "writes": [
  [
   {
    "schemaVersion": 1,
    "deviceId": "new-tablet",
    "books": [
     {
      "driveFileId": "drive-1",
      "fields": {
       "title": {
        "value": "Dune",
        "at": 1000,
        "device": "old-phone"
       },
       "author": {
        "value": "Herbert",
        "at": 1000,
        "device": "old-phone"
       },
       "shelfOrder": {
        "value": 3,
        "at": 1100,
        "device": "old-phone"
       },
       "visible": {
        "value": true,
        "at": 1000,
        "device": "old-phone"
       },
       "progressFraction": {
        "value": 0.25,
        "at": 1200,
        "device": "old-phone"
       },
       "locator": {
        "value": {
         "kind": "epub",
         "value": "cfi-1"
        },
        "at": 1200,
        "device": "old-phone"
       },
       "spineColorOverride": {
        "value": "#224466",
        "at": 1300,
        "device": "old-phone"
       }
      }
     },
     {
      "driveFileId": "drive-2",
      "fields": {
       "title": {
        "value": "Gone",
        "at": 900,
        "device": "old-phone"
       },
       "visible": {
        "value": false,
        "at": 1400,
        "device": "old-phone"
       }
      }
     }
    ],
    "settings": {
     "inhouse-read-shelf-type": {
      "value": "billy",
      "at": 1500,
      "device": "old-phone"
     },
     "inhouse-read-theme": {
      "value": "dark",
      "at": 1500,
      "device": "old-phone"
     }
    }
   },
   null
  ]
 ],
 "storage": {
  "inhouse-read-backup-device": "new-tablet",
  "inhouse-read-shelf-type": "billy",
  "inhouse-read-theme": "dark"
 }
}
const READING_STATE = "{\"schemaVersion\":1,\"driveFileId\":\"book-1\",\"fraction\":1,\"locator\":{\"kind\":\"epub\",\"value\":\"cfi-9\"},\"appearance\":{\"spineColorOverride\":\"#112233\",\"spineTextFinish\":\"gold\"},\"bookLength\":{\"schemaVersion\":1,\"driveFileId\":\"book-1\",\"md5Checksum\":\"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\",\"byteLength\":5,\"wordCount\":100,\"wordCountVersion\":2,\"wordCountComplete\":true},\"readingHistory\":[{\"fraction\":0,\"locator\":{\"kind\":\"epub\",\"value\":\"c0\"}},{\"fraction\":0.025,\"locator\":{\"kind\":\"epub\",\"value\":\"c1\"}},{\"fraction\":0.05,\"locator\":{\"kind\":\"epub\",\"value\":\"c2\"}},{\"fraction\":0.075,\"locator\":{\"kind\":\"epub\",\"value\":\"c3\"}},{\"fraction\":0.1,\"locator\":{\"kind\":\"epub\",\"value\":\"c4\"}},{\"fraction\":0.125,\"locator\":{\"kind\":\"epub\",\"value\":\"c5\"}},{\"fraction\":0.15,\"locator\":{\"kind\":\"epub\",\"value\":\"c6\"}},{\"fraction\":0.175,\"locator\":{\"kind\":\"epub\",\"value\":\"c7\"}},{\"fraction\":0.2,\"locator\":{\"kind\":\"epub\",\"value\":\"c8\"}},{\"fraction\":0.225,\"locator\":{\"kind\":\"epub\",\"value\":\"c9\"}},{\"fraction\":0.25,\"locator\":{\"kind\":\"epub\",\"value\":\"c10\"}},{\"fraction\":0.275,\"locator\":{\"kind\":\"epub\",\"value\":\"c11\"}},{\"fraction\":0.3,\"locator\":{\"kind\":\"epub\",\"value\":\"c12\"}},{\"fraction\":0.325,\"locator\":{\"kind\":\"epub\",\"value\":\"c13\"}},{\"fraction\":0.35,\"locator\":{\"kind\":\"epub\",\"value\":\"c14\"}},{\"fraction\":0.375,\"locator\":{\"kind\":\"epub\",\"value\":\"c15\"}},{\"fraction\":0.4,\"locator\":{\"kind\":\"epub\",\"value\":\"c16\"}},{\"fraction\":0.425,\"locator\":{\"kind\":\"epub\",\"value\":\"c17\"}},{\"fraction\":0.45,\"locator\":{\"kind\":\"epub\",\"value\":\"c18\"}},{\"fraction\":0.475,\"locator\":{\"kind\":\"epub\",\"value\":\"c19\"}}],\"bookmarks\":[{\"fraction\":0.5,\"locator\":{\"kind\":\"epub\",\"value\":\"b\"}}],\"quotes\":[],\"updatedAt\":123}"

describe('data written by older versions', () => {
  beforeEach(() => { vi.stubGlobal('Blob', NodeBlob); vi.stubGlobal('File', NodeFile) })
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

  it('merges an old per-device manifest into a new device exactly as before', async () => {
    let clock = 9000
    vi.spyOn(Date, 'now').mockImplementation(() => ++clock)
    const oldManifest = { schemaVersion: 1, deviceId: 'old-phone', stateFileId: 'manifest-old', books: [
      { driveFileId: 'drive-1', fields: {
        title: { value: 'Dune', at: 1000, device: 'old-phone' }, author: { value: 'Herbert', at: 1000, device: 'old-phone' },
        shelfOrder: { value: 3, at: 1100, device: 'old-phone' }, visible: { value: true, at: 1000, device: 'old-phone' },
        progressFraction: { value: 0.25, at: 1200, device: 'old-phone' }, locator: { value: { kind: 'epub', value: 'cfi-1' }, at: 1200, device: 'old-phone' },
        spineColorOverride: { value: '#224466', at: 1300, device: 'old-phone' } } },
      { driveFileId: 'drive-2', fields: { title: { value: 'Gone', at: 900, device: 'old-phone' }, visible: { value: false, at: 1400, device: 'old-phone' } } },
      { driveFileId: '__proto__', fields: { title: { value: 'Attack', at: 1, device: 'x' } } }
    ], settings: { 'inhouse-read-shelf-type': { value: 'billy', at: 1500, device: 'old-phone' }, 'inhouse-read-theme': { value: 'dark', at: 1500, device: 'old-phone' } } }
    const writes = []
    drive.readDriveLibrarySnapshots.mockResolvedValue([oldManifest])
    drive.writeDriveLibrarySnapshot.mockImplementation(async (snapshot, id) => { writes.push([snapshot, id]); return { id: 'manifest-new' } })
    drive.listAllDriveBooks.mockResolvedValue([])
    drive.downloadDriveFile.mockImplementation(async (id, { name, mimeType } = {}) => new NodeFile(['bytes'], name || id, { type: mimeType }))
    drive.readDriveProgress.mockResolvedValue(null)
    drive.writeDriveProgress.mockResolvedValue({ id: 'state-1' })
    const values = new Map([['inhouse-read-backup-device', 'new-tablet']])
    const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)), removeItem: key => values.delete(key) }
    const library = new LibraryStore('compat-manifest')
    const cloud = new CloudSync(library); cloud.setProfile({ id: 'account' })
    const backup = new LibraryBackup(library, cloud, { storage })
    const result = await backup.sync('account')
    const books = (await library.listAll()).map(book => { const { content, cover, contentRevision, ...rest } = book; expect(content).toBeTruthy(); expect(contentRevision).toBeTruthy(); return rest })
    // The fixture went through JSON, which turns the `undefined` state-file id of a first write into null.
    expect(JSON.parse(JSON.stringify({ result, books, removed: await library.listRemoved(), writes, storage: Object.fromEntries(values) }))).toEqual(FIXTURE)
    await library.close()
  })

  it('writes the reading-state file byte for byte as the old client did', async () => {
    vi.resetModules()
    localStorage.setItem('ihr_drive_session_v2', JSON.stringify({ accessToken: 'fixture-token', expiresAt: Date.now() + 3_600_000 }))
    const bodies = []
    vi.stubGlobal('fetch', vi.fn(async (_url, options) => { bodies.push(await options.body.text()); return new Response(JSON.stringify({ id: 'state-1' })) }))
    const { rustUiMock } = await import('./helpers/rust-ui-real.js')
    vi.doMock('../../src/js/rust-ui.js', () => rustUiMock())
    vi.doUnmock('../../src/js/drive-client.js')
    const real = await import('../../src/js/drive-client.js')
    const history = Array.from({ length: 25 }, (_, i) => ({ fraction: i / 40, locator: { kind: 'epub', value: `c${i}` } }))
    await real.writeDriveProgress('book-1', {
      fraction: 1.7, locator: { kind: 'epub', value: 'cfi-9' }, appearance: { spineColorOverride: '#112233', spineTextFinish: 'gold', junk: 1 },
      bookLength: { schemaVersion: 1, driveFileId: 'book-1', md5Checksum: 'A'.repeat(32), byteLength: 5, wordCount: 100, wordCountVersion: 2, wordCountComplete: true },
      readingHistory: history, bookmarks: [{ fraction: .5, locator: { kind: 'epub', value: 'b' } }], quotes: [], updatedAt: 123
    }, 'state-1')
    expect(bodies[0].split('\r\n\r\n')[2].split('\r\n--')[0]).toBe(READING_STATE)
    expect(JSON.parse(READING_STATE).readingHistory).toHaveLength(20)
  })
})
