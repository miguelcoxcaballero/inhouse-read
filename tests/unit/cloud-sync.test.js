import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { LibraryStore } from '../../src/js/library-store.js'

vi.mock('../../src/js/drive-client.js', () => ({
  getDriveProfile: vi.fn(), listAllDriveBooks: vi.fn(),
  uploadDriveFile: vi.fn(), downloadDriveFile: vi.fn(),
  readDriveProgress: vi.fn(), writeDriveProgress: vi.fn()
}))

import { CloudSync } from '../../src/js/cloud-sync.js'
import * as drive from '../../src/js/drive-client.js'

let library
let sync
let dbId = 0
beforeEach(() => {
  vi.clearAllMocks()
  library = new LibraryStore(`inhouse-read-cloud-test-${++dbId}`)
  sync = new CloudSync(library)
  sync.setProfile({ id: 'account-1', email: 'miguel@example.com' })
  drive.readDriveProgress.mockResolvedValue(null)
  drive.listAllDriveBooks.mockResolvedValue([])
})
afterEach(async () => { sync.reset(); await library.close() })

describe('CloudSync', () => {
  it('vincula el libro local al de Drive sin duplicarlo y recupera su posición', async () => {
    const local = await library.addOrTouch({ sourceType: 'local', name: 'book.pdf', title: 'book', size: 123,
      content: new Blob(['pdf'], { type: 'application/pdf' }) })
    drive.listAllDriveBooks.mockResolvedValue([{ id: 'drive-1', name: 'book.pdf', size: '123', mimeType: 'application/pdf' }])
    drive.readDriveProgress.mockResolvedValue({ schemaVersion: 1, driveFileId: 'drive-1',
      fraction: .6, locator: { kind: 'pdf-page', value: 7 }, updatedAt: 1000, stateFileId: 'state-1' })
    await sync.sync()
    const books = await library.listAll()
    expect(books).toHaveLength(1)
    expect(books[0]).toMatchObject({ id: local.id, driveFileId: 'drive-1', cloudAccountId: 'account-1',
      progressFraction: .6, locator: { kind: 'pdf-page', value: 7 } })
    expect(drive.uploadDriveFile).not.toHaveBeenCalled()
  })

  it('descubre libros remotos y sube libros locales pendientes', async () => {
    await library.addOrTouch({ sourceType: 'local', name: 'local.pdf', title: 'local', size: 3,
      content: new Blob(['pdf'], { type: 'application/pdf' }) })
    drive.listAllDriveBooks.mockResolvedValue([{ id: 'remote-1', name: 'remote.epub', size: '9', mimeType: 'application/epub+zip' }])
    drive.uploadDriveFile.mockResolvedValue({ id: 'uploaded-1', name: 'local.pdf' })
    const result = await sync.sync()
    expect(result).toMatchObject({ books: 2, uploaded: 1, errors: [] })
    expect((await library.listAll()).map(book => book.driveFileId).sort()).toEqual(['remote-1', 'uploaded-1'])
  })

  it('sincroniza la posición local más reciente y conserva el locator exacto', async () => {
    const book = await library.addOrTouch({ sourceType: 'local', name: 'local.pdf', size: 3,
      driveFileId: 'drive-1', cloudAccountId: 'account-1' })
    await library.updateProgress(book.id, .75, { kind: 'pdf-page', value: 9 })
    drive.readDriveProgress.mockResolvedValue({ fraction: .25, updatedAt: 1, stateFileId: 'state-1' })
    drive.writeDriveProgress.mockResolvedValue({ id: 'state-1' })
    await sync.syncBookProgress(book.id)
    expect(drive.writeDriveProgress).toHaveBeenCalledWith('drive-1', expect.objectContaining({
      fraction: .75, locator: { kind: 'pdf-page', value: 9 }
    }), 'state-1')
    expect((await library.get(book.id)).progressDirty).toBe(false)
  })
})
