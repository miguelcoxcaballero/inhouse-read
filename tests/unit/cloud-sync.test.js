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
  it('carries bookmarks and the pre-jump reading position between devices', async () => {
    const book = await library.addOrTouch({ sourceType:'local', name:'places.pdf', size:5, driveFileId:'places-drive', cloudAccountId:'account-1' })
    const readingHistory = [{fraction:.25,locator:{kind:'pdf-page',value:2},label:'Página 2',createdAt:50}]
    const bookmarks = [{fraction:.5,locator:{kind:'pdf-page',value:3},label:'Página 3',createdAt:60}]
    const quotes = [{id:'q1',text:'A saved passage',fraction:.75,locator:{kind:'pdf-page',value:4},label:'Página 4',color:'gold',createdAt:70}]
    await library.updateProgress(book.id,.75,{kind:'pdf-page',value:4})
    await library.patch(book.id,{readingHistory,bookmarks,quotes})
    drive.writeDriveProgress.mockResolvedValue({id:'places-state'})
    await sync.syncBookProgress(book.id)
    expect(drive.writeDriveProgress.mock.calls[0][1]).toMatchObject({readingHistory,bookmarks,quotes:[{...quotes[0],color:'yellow'}]})
    drive.readDriveProgress.mockResolvedValue({fraction:.9,locator:{kind:'pdf-page',value:5},readingHistory,bookmarks,quotes,updatedAt:Date.now()+10000,stateFileId:'places-state'})
    await library.patch(book.id,{readingHistory:[],bookmarks:[],quotes:[]})
    await sync.syncBookProgress(book.id)
    expect(await library.get(book.id)).toMatchObject({readingHistory,bookmarks,quotes:[{...quotes[0],color:'yellow'}],locator:{kind:'pdf-page',value:5}})
  })
  it('syncs custom ink, metallic finishes and engraved text, including automatic reset', async () => {
    const book=await library.addOrTouch({sourceType:'local',name:'gold.pdf',size:5,driveFileId:'gold-drive',cloudAccountId:'account-1'})
    const appearance={spineColorOverride:'#245536',spineTextColor:null,spineTextFinish:'gold',spineEngraved:true,author:'Ursula Le Guin'}
    await library.patch(book.id,{...appearance,progressDirty:true,progressUpdatedAt:100})
    drive.writeDriveProgress.mockResolvedValue({id:'gold-state'})
    await sync.syncBookProgress(book.id)
    expect(drive.writeDriveProgress.mock.calls[0][1]).toMatchObject({appearance})
    drive.readDriveProgress.mockResolvedValue({fraction:0,locator:null,appearance:{...appearance,spineTextFinish:'silver'},updatedAt:200,stateFileId:'gold-state'})
    await sync.syncBookProgress(book.id)
    expect(await library.get(book.id)).toMatchObject({...appearance,spineTextFinish:'silver'})
  })
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

  it('prefiere el avance local cuando el reloj y el avance remoto coinciden en el mismo milisegundo', async () => {
    const book = await library.addOrTouch({ sourceType: 'local', name: 'tie.pdf', size: 3,
      driveFileId: 'drive-tie', cloudAccountId: 'account-1' })
    await library.updateProgress(book.id, .8, { kind: 'pdf-page', value: 8 })
    const local = await library.get(book.id)
    drive.readDriveProgress.mockResolvedValue({ fraction: .6, locator: { kind: 'pdf-page', value: 6 },
      updatedAt: local.progressUpdatedAt, stateFileId: 'state-1' })
    drive.writeDriveProgress.mockResolvedValue({ id: 'state-1' })

    await sync.syncBookProgress(book.id)

    expect(drive.writeDriveProgress).toHaveBeenCalledWith('drive-tie', expect.objectContaining({
      fraction: .8, locator: { kind: 'pdf-page', value: 8 }
    }), 'state-1')
    expect((await library.get(book.id)).locator).toEqual({ kind: 'pdf-page', value: 8 })
  })

  it('no borra un avance nuevo que llega mientras se sube el avance anterior', async () => {
    const book = await library.addOrTouch({ sourceType: 'local', name: 'race.pdf', size: 3,
      driveFileId: 'drive-race', cloudAccountId: 'account-1' })
    await library.updateProgress(book.id, .2, { kind: 'pdf-page', value: 2 })
    let finishUpload
    drive.writeDriveProgress.mockImplementation(() => new Promise(resolve => { finishUpload = resolve }))
    const firstSync = sync.syncBookProgress(book.id)
    await vi.waitFor(() => expect(drive.writeDriveProgress).toHaveBeenCalledTimes(1))

    await library.updateProgress(book.id, .8, { kind: 'pdf-page', value: 8 })
    finishUpload({ id: 'state-race' })
    await firstSync

    expect(await library.get(book.id)).toMatchObject({ progressFraction: .8,
      locator: { kind: 'pdf-page', value: 8 }, progressDirty: true })

    drive.writeDriveProgress.mockResolvedValue({ id: 'state-race' })
    await sync.flushProgress(book.id)
    expect(drive.writeDriveProgress).toHaveBeenCalledTimes(2)
    expect(drive.writeDriveProgress.mock.calls[1][1]).toMatchObject({
      fraction: .8, locator: { kind: 'pdf-page', value: 8 }
    })
    expect((await library.get(book.id)).progressDirty).toBe(false)
  })
})
