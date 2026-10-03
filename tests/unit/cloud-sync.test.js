import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { LibraryStore } from '../../src/js/library-store.js'
import { Blob as NativeBlob, File as NativeFile } from 'node:buffer'

vi.mock('../../src/js/drive-client.js', () => ({
  getDriveProfile: vi.fn(), listAllDriveBooks: vi.fn(),
  uploadDriveFile: vi.fn(), downloadDriveFile: vi.fn(),
  readDriveProgress: vi.fn(), writeDriveProgress: vi.fn()
}))

import { CloudSync } from '../../src/js/cloud-sync.js'
import * as drive from '../../src/js/drive-client.js'
import { completeWordCount } from '../../src/js/book-length.js'
import { driveBookLength } from '../../src/js/book-length-drive.js'

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
  drive.downloadDriveFile.mockImplementation(async (id, { name, mimeType }) => new File(['downloaded'], name || id, { type:mimeType }))
})
afterEach(async () => { sync.reset(); await library.close() })

describe('CloudSync', () => {
  it('persists a complete word count even when the book has no reading progress yet', async () => {
    const book=await library.addOrTouch({sourceType:'local',name:'counted.pdf',size:4,content:new NativeBlob(['file']),
      driveFileId:'word-drive',cloudAccountId:'account-1',contentRevision:'v1',wordCountContentRevision:'v1',
      driveContentChecksum:'a'.repeat(32),contentDriveChecksum:'a'.repeat(32),...completeWordCount(120_000),lengthDirty:true})
    drive.writeDriveProgress.mockResolvedValue({id:'length-state'})
    await sync.syncBookProgress(book.id)
    expect(drive.writeDriveProgress).toHaveBeenCalledWith('word-drive',expect.objectContaining({bookLength:driveBookLength(book),fraction:0}),undefined)
    expect(await library.get(book.id)).toMatchObject({wordCount:120_000,lengthDirty:false,progressStateFileId:'length-state'})
    expect(drive.uploadDriveFile).not.toHaveBeenCalled()
  })
  it('publishes local word metadata while preserving newer progress and appearance from another device', async () => {
    const book=await library.addOrTouch({sourceType:'local',name:'counted.pdf',size:4,content:new NativeBlob(['file']),
      driveFileId:'word-drive',cloudAccountId:'account-1',contentRevision:'v1',wordCountContentRevision:'v1',
      driveContentChecksum:'a'.repeat(32),contentDriveChecksum:'a'.repeat(32),...completeWordCount(90_000),lengthDirty:true,
      progressFraction:.2,locator:{kind:'pdf-page',value:2},progressUpdatedAt:100,progressDirty:false})
    drive.readDriveProgress.mockResolvedValue({fraction:.8,locator:{kind:'pdf-page',value:8},appearance:{spineColorOverride:'#123456'},
      updatedAt:200,stateFileId:'remote-state'})
    drive.writeDriveProgress.mockResolvedValue({id:'remote-state'})
    await sync.syncBookProgress(book.id)
    expect(drive.writeDriveProgress).toHaveBeenCalledWith('word-drive',expect.objectContaining({bookLength:driveBookLength(book),
      fraction:.8,locator:{kind:'pdf-page',value:8},appearance:{spineColorOverride:'#123456'},updatedAt:200}),'remote-state')
    expect(await library.get(book.id)).toMatchObject({wordCount:90_000,lengthDirty:false,progressFraction:.8,
      locator:{kind:'pdf-page',value:8},spineColorOverride:'#123456'})
  })
  it('receives verified complete text volume on a fresh device with the same Drive original', async () => {
    const book=await library.addOrTouch({sourceType:'drive',name:'same.pdf',size:4,content:new NativeBlob(['file']),
      driveFileId:'word-drive',cloudAccountId:'account-1',contentRevision:'second',driveContentChecksum:'a'.repeat(32),contentDriveChecksum:'a'.repeat(32)})
    const length=driveBookLength({...book,...completeWordCount(120_000),wordCountContentRevision:'second'})
    drive.readDriveProgress.mockResolvedValue({fraction:.5,locator:{kind:'pdf-page',value:5},bookLength:length,updatedAt:200,stateFileId:'length-state'})
    await sync.syncBookProgress(book.id)
    expect(await library.get(book.id)).toMatchObject({...completeWordCount(120_000),wordCountContentRevision:'second',lengthDirty:false})
    expect(drive.writeDriveProgress).not.toHaveBeenCalled()
  })
  it('retira el libro sin borrar Drive y no lo redescubre en siguientes sincronizaciones', async () => {
    const book = await library.addOrTouch({ sourceType:'local', name:'keep-drive.pdf', size:4,
      content:new Blob(['file']), cover:new Blob(['cover']), driveFileId:'keep-drive', cloudAccountId:'account-1' })
    drive.listAllDriveBooks.mockResolvedValue([{ id:'keep-drive', name:'keep-drive.pdf', size:'4', mimeType:'application/pdf' }])
    await sync.removeFromShelf(book)
    await sync.sync()
    sync = new CloudSync(library)
    sync.setProfile({ id:'account-1' })
    await sync.sync()
    expect(await library.listAll()).toEqual([])
    expect(await library.get(book.id)).toBeNull()
    expect(drive.uploadDriveFile).not.toHaveBeenCalled()
    expect(drive.downloadDriveFile).not.toHaveBeenCalled()
    expect(drive.readDriveProgress).not.toHaveBeenCalled()
    expect(drive.writeDriveProgress).not.toHaveBeenCalled()
  })

  it('no restaura un libro si su subida termina después de soltarlo en la papelera', async () => {
    const book = await library.addOrTouch({ sourceType:'local', name:'late-upload.pdf', size:4, content:new Blob(['file']) })
    let finishUpload
    drive.uploadDriveFile.mockImplementation(() => new Promise(resolve => { finishUpload = resolve }))
    const uploading = sync.uploadBook(book)
    await vi.waitFor(() => expect(drive.uploadDriveFile).toHaveBeenCalledTimes(1))
    await sync.removeFromShelf(book)
    finishUpload({ id:'late-drive', name:'late-upload.pdf' })
    expect(await uploading).toBeNull()
    drive.listAllDriveBooks.mockResolvedValue([{ id:'late-drive', name:'renamed.pdf', size:'4', mimeType:'application/pdf' }])
    await sync.sync()
    expect(await library.listAll()).toEqual([])
    expect(await library.isRemovedFromShelf({ driveFileId:'late-drive', cloudAccountId:'account-1' })).toBe(true)
  })

  it('descarta la descarga pendiente y no vuelve a guardar los bytes de un libro retirado', async () => {
    const book = await library.addOrTouch({ sourceType:'drive', name:'late-download.pdf', size:4,
      driveFileId:'download-drive', cloudAccountId:'account-1' })
    let finishDownload
    drive.downloadDriveFile.mockImplementation(() => new Promise(resolve => { finishDownload = resolve }))
    const downloading = sync.downloadForOffline(book)
    await vi.waitFor(() => expect(drive.downloadDriveFile).toHaveBeenCalledTimes(1))
    await sync.removeFromShelf(book)
    finishDownload(new File(['file'], 'late-download.pdf', { type:'application/pdf' }))
    expect(await downloading).toBeNull()
    expect(await library.listAll()).toEqual([])
    expect(await library.get(book.id)).toBeNull()
  })

  it('no sincroniza progreso pendiente cuando el libro ya ha sido retirado', async () => {
    const book = await library.addOrTouch({ sourceType:'local', name:'late-progress.pdf', size:4,
      driveFileId:'progress-drive', cloudAccountId:'account-1' })
    await library.updateProgress(book.id, .8, { kind:'pdf-page', value:8 })
    let finishRead
    drive.readDriveProgress.mockImplementation(() => new Promise(resolve => { finishRead = resolve }))
    const progress = sync.syncBookProgress(book.id)
    await vi.waitFor(() => expect(drive.readDriveProgress).toHaveBeenCalledTimes(1))
    await sync.removeFromShelf(book)
    finishRead(null)
    await progress
    await sync.flushProgress(book.id)
    expect(drive.writeDriveProgress).not.toHaveBeenCalled()
    expect(await library.listAll()).toEqual([])
  })

  it('una escritura antigua de progreso no modifica una reimportación explícita', async () => {
    const book = await library.addOrTouch({ sourceType:'local', name:'new-copy.pdf', size:4,
      driveFileId:'same-drive', cloudAccountId:'account-1' })
    await library.updateProgress(book.id, .2, { kind:'pdf-page', value:2 })
    let finishWrite
    drive.writeDriveProgress.mockImplementation(() => new Promise(resolve => { finishWrite = resolve }))
    const progress = sync.syncBookProgress(book.id)
    await vi.waitFor(() => expect(drive.writeDriveProgress).toHaveBeenCalledTimes(1))
    await sync.removeFromShelf(book)
    await library.addOrTouch({ ...book, content:new Blob(['new']), progressDirty:true,
      progressFraction:.9, locator:{ kind:'pdf-page', value:9 }, progressUpdatedAt:900 }, { restoreRemoved:true })
    finishWrite({ id:'stale-progress-state' })
    await progress
    expect(await library.get(book.id)).toMatchObject({ progressFraction:.9,
      locator:{ kind:'pdf-page', value:9 }, progressDirty:true, progressUpdatedAt:900 })
    expect((await library.get(book.id)).progressStateFileId).toBeUndefined()
  })

  it('no resucita el libro si una búsqueda de Drive que ya estaba en curso lo devuelve', async () => {
    const book = await library.addOrTouch({ sourceType:'drive', name:'listed.pdf', size:4,
      driveFileId:'listed-drive', cloudAccountId:'account-1' })
    let finishList
    drive.listAllDriveBooks.mockImplementation(() => new Promise(resolve => { finishList = resolve }))
    const syncing = sync.sync()
    await vi.waitFor(() => expect(drive.listAllDriveBooks).toHaveBeenCalledTimes(1))
    await sync.removeFromShelf(book)
    finishList([{ id:'listed-drive', name:'listed.pdf', size:'4', mimeType:'application/pdf' }])
    await syncing
    expect(await library.listAll()).toEqual([])
    expect(drive.readDriveProgress).not.toHaveBeenCalled()
  })

  it('no inicia una cola de subidas locales y mantiene retirado un libro durante discovery', async () => {
    const first = await library.addOrTouch({ sourceType:'local', name:'first.pdf', size:4, content:new Blob(['file']) })
    await new Promise(resolve => setTimeout(resolve, 2))
    const queued = await library.addOrTouch({ sourceType:'local', name:'queued.pdf', size:4, content:new Blob(['file']) })
    // Sync uses most-recent first, so the queued record is deliberately older.
    await library.patch(first.id, { lastOpenedAt:Date.now() + 1000 })
    let finishList
    drive.listAllDriveBooks.mockImplementation(() => new Promise(resolve => { finishList = resolve }))
    const syncing = sync.sync()
    await vi.waitFor(() => expect(drive.listAllDriveBooks).toHaveBeenCalledTimes(1))
    await sync.removeFromShelf(queued)
    finishList([])
    await syncing
    expect(drive.uploadDriveFile).not.toHaveBeenCalled()
    expect(await library.get(queued.id)).toBeNull()
    expect((await library.listAll()).map(book => book.id)).toEqual([first.id])
  })

  it('permite otra subida tras reimportar sin reutilizar ni aplicar el trabajo cancelado', async () => {
    const book = await library.addOrTouch({ sourceType:'local', name:'again.pdf', size:4, content:new Blob(['file']) })
    const resolvers = []
    drive.uploadDriveFile.mockImplementation(() => new Promise(resolve => resolvers.push(resolve)))
    const oldUpload = sync.uploadBook(book)
    await vi.waitFor(() => expect(resolvers).toHaveLength(1))
    await sync.removeFromShelf(book)
    const restored = await library.addOrTouch(book, { restoreRemoved:true })
    const newUpload = sync.uploadBook(restored)
    await vi.waitFor(() => expect(resolvers).toHaveLength(2))
    resolvers[0]({ id:'old-drive', name:'again.pdf' })
    expect(await oldUpload).toBeNull()
    const deduplicated = sync.uploadBook(restored)
    resolvers[1]({ id:'new-drive', name:'again.pdf' })
    expect(await newUpload).toMatchObject({ driveFileId:'new-drive' })
    expect(await deduplicated).toMatchObject({ driveFileId:'new-drive' })
    expect(drive.uploadDriveFile).toHaveBeenCalledTimes(2)
    expect(await library.isRemovedFromShelf(restored)).toBe(false)
    expect(await library.get(book.id)).toMatchObject({ driveFileId:'new-drive' })
  })

  it('syncs free shelf placement with appearance and restores it on another device', async () => {
    const book = await library.addOrTouch({ sourceType:'local', name:'placed.pdf', size:5,
      driveFileId:'placed-drive', cloudAccountId:'account-1' })
    await library.patch(book.id, { shelfPosition:{ shelf:2, x:.72 }, progressDirty:true, progressUpdatedAt:100 })
    drive.writeDriveProgress.mockResolvedValue({ id:'placed-state' })
    await sync.syncBookProgress(book.id)
    expect(drive.writeDriveProgress.mock.calls[0][1]).toMatchObject({
      appearance:{ shelfPosition:{ shelf:2, x:.72 } }, updatedAt:100
    })
    expect((await library.get(book.id)).progressDirty).toBe(false)
    drive.readDriveProgress.mockResolvedValue({ fraction:0, locator:null,
      appearance:{ shelfPosition:{ shelf:1, x:.25 } }, updatedAt:200, stateFileId:'placed-state' })
    await sync.syncBookProgress(book.id)
    expect((await library.get(book.id)).shelfPosition).toEqual({ shelf:1, x:.25 })
    drive.readDriveProgress.mockResolvedValue({ fraction:0, locator:null,
      appearance:{ shelfPosition:null }, updatedAt:300, stateFileId:'placed-state' })
    await sync.syncBookProgress(book.id)
    expect((await library.get(book.id)).shelfPosition).toBeNull()
  })
  it('keeps a shelf move dirty when another move occurs during its Drive upload', async () => {
    const book = await library.addOrTouch({ sourceType:'local', name:'moving.pdf', size:5,
      driveFileId:'moving-drive', cloudAccountId:'account-1' })
    await library.patch(book.id, { shelfPosition:{ shelf:0, x:.1 }, progressDirty:true, progressUpdatedAt:100 })
    let finishUpload
    drive.writeDriveProgress.mockImplementation(() => new Promise(resolve => { finishUpload = resolve }))
    const firstSync = sync.syncBookProgress(book.id)
    await vi.waitFor(() => expect(drive.writeDriveProgress).toHaveBeenCalledTimes(1))
    await library.patch(book.id, { shelfPosition:{ shelf:2, x:.9 }, progressDirty:true, progressUpdatedAt:100 })
    finishUpload({ id:'moving-state' })
    await firstSync
    expect(await library.get(book.id)).toMatchObject({ shelfPosition:{ shelf:2, x:.9 }, progressDirty:true })
    drive.writeDriveProgress.mockResolvedValue({ id:'moving-state' })
    await sync.flushProgress(book.id)
    expect(drive.writeDriveProgress.mock.calls[1][1].appearance.shelfPosition).toEqual({ shelf:2, x:.9 })
    expect((await library.get(book.id)).progressDirty).toBe(false)
  })
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
  it('no vincula por nombre y tamaño un libro local que no se ha subido explícitamente', async () => {
    const local = await library.addOrTouch({ sourceType: 'local', name: 'book.pdf', title: 'book', size: 123,
      content: new Blob(['pdf'], { type: 'application/pdf' }) })
    drive.listAllDriveBooks.mockResolvedValue([{ id: 'drive-1', name: 'book.pdf', size: '123', mimeType: 'application/pdf' }])
    drive.readDriveProgress.mockResolvedValue({ schemaVersion: 1, driveFileId: 'drive-1',
      fraction: .6, locator: { kind: 'pdf-page', value: 7 }, updatedAt: 1000, stateFileId: 'state-1' })
    await sync.sync()
    const books = await library.listAll()
    expect(books).toHaveLength(2)
    expect(await library.get(local.id)).toMatchObject({ progressFraction:0 })
    expect((await library.get(local.id)).driveFileId).toBeUndefined()
    expect(books.find(book => book.driveFileId === 'drive-1')).toMatchObject({
      progressFraction:.6, locator:{ kind:'pdf-page', value:7 } })
    expect(drive.uploadDriveFile).not.toHaveBeenCalled()
  })

  it('descubre libros remotos sin subir libros locales al iniciar sesión o sincronizar', async () => {
    await library.addOrTouch({ sourceType: 'local', name: 'local.pdf', title: 'local', size: 3,
      content: new NativeBlob(['pdf'], { type: 'application/pdf' }) })
    drive.listAllDriveBooks.mockResolvedValue([{ id: 'remote-1', name: 'remote.epub', size: '9', mimeType: 'application/epub+zip' }])
    drive.uploadDriveFile.mockResolvedValue({ id: 'uploaded-1', name: 'local.pdf' })
    const result = await sync.sync()
    expect(result).toMatchObject({ books:1, uploaded:0, errors:[] })
    expect(await library.listAll()).toHaveLength(2)
    expect(drive.uploadDriveFile).not.toHaveBeenCalled()
    const local = (await library.listAll()).find(book => book.sourceType === 'local')
    expect(local.content.size).toBe(3)
    expect(local.driveFileId).toBeUndefined()
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

  it('keeps a newer local position saved while reading old remote progress', async () => {
    const book = await library.addOrTouch({ sourceType:'local', name:'close.pdf', size:3,
      driveFileId:'saved-drive', cloudAccountId:'account-1', progressFraction:.2,
      locator:{ kind:'pdf-page', value:2 }, progressUpdatedAt:100, progressDirty:true })
    let finishRead
    drive.readDriveProgress.mockImplementation(() => new Promise(resolve => { finishRead = resolve }))
    const pending = sync.syncBookProgress(book.id)
    await vi.waitFor(() => expect(drive.readDriveProgress).toHaveBeenCalledOnce())
    await library.patch(book.id, { progressFraction:.8, locator:{ kind:'pdf-page', value:8 },
      progressUpdatedAt:300, progressDirty:true })
    drive.writeDriveProgress.mockResolvedValue({ id:'state' })
    finishRead({ fraction:.4, locator:{ kind:'pdf-page', value:4 }, updatedAt:200, stateFileId:'state' })
    await pending
    expect(await library.get(book.id)).toMatchObject({ progressFraction:.8, locator:{ kind:'pdf-page', value:8 } })
    expect(drive.writeDriveProgress).toHaveBeenCalledWith('saved-drive', expect.objectContaining({ fraction:.8 }), 'state')
  })

  it('uploads only on explicit request and preserves original local bytes after success', async () => {
    vi.stubGlobal('Blob', NativeBlob); vi.stubGlobal('File', NativeFile)
    try {
      const bytes = new Uint8Array([0,255,37,80,68,70])
      const book = await library.addOrTouch({ sourceType:'local', name:'exact.pdf', size:bytes.length,
        content:new NativeBlob([bytes], { type:'application/pdf' }) })
      await sync.sync()
      expect(drive.uploadDriveFile).not.toHaveBeenCalled()
      drive.uploadDriveFile.mockResolvedValue({ id:'explicit-drive', name:'exact.pdf' })
      const saved = await sync.uploadBook(book)
      expect(saved.driveFileId).toBe('explicit-drive')
      expect([...new Uint8Array(await drive.uploadDriveFile.mock.calls[0][0].arrayBuffer())]).toEqual([...bytes])
      expect([...new Uint8Array(await (await library.get(book.id)).content.arrayBuffer())]).toEqual([...bytes])
    } finally { vi.unstubAllGlobals() }
  })

  it('persists downloaded bytes for a cold offline reopen without another account or network request', async () => {
    vi.stubGlobal('Blob', NativeBlob); vi.stubGlobal('File', NativeFile)
    try {
      const bytes = new Uint8Array([0,255,37,80,68,70])
      const book = await library.addOrTouch({ sourceType:'drive', driveFileId:'remote', cloudAccountId:'account-1',
        name:'exact.pdf', size:bytes.length, mimeType:'application/pdf' })
      drive.downloadDriveFile.mockResolvedValue(new NativeFile([bytes], 'exact.pdf', { type:'application/pdf' }))
      const first = await sync.downloadForOffline(book)
      expect([...new Uint8Array(await first.arrayBuffer())]).toEqual([...bytes])
      sync.reset()
      sync = new CloudSync(library)
      drive.getDriveProfile.mockRejectedValue(new Error('Offline'))
      drive.downloadDriveFile.mockRejectedValue(new Error('Offline'))
      const next = await sync.downloadForOffline(await library.get(book.id))
      expect([...new Uint8Array(await next.arrayBuffer())]).toEqual([...bytes])
      expect(drive.getDriveProfile).not.toHaveBeenCalled()
      expect(drive.downloadDriveFile).toHaveBeenCalledOnce()
    } finally { vi.unstubAllGlobals() }
  })

  it('does not claim a downloaded file is cached when its local transaction fails', async () => {
    const book = await library.addOrTouch({ sourceType:'drive', driveFileId:'remote', cloudAccountId:'account-1', name:'exact.pdf' })
    drive.downloadDriveFile.mockResolvedValue(new File(['bytes'], 'exact.pdf'))
    vi.spyOn(library, 'patch').mockRejectedValueOnce(new DOMException('Full', 'QuotaExceededError'))
    await expect(sync.downloadForOffline(book)).rejects.toMatchObject({ code:'LOCAL_BOOK_STORAGE_FAILED' })
    expect((await library.get(book.id)).content).toBeUndefined()
  })

  it('does not apply a remote snapshot if a local close commits just before its transaction', async () => {
    const book = await library.addOrTouch({ sourceType:'local', name:'late-close.pdf', size:3,
      driveFileId:'saved-drive', cloudAccountId:'account-1', progressFraction:.2,
      locator:{ page:2 }, progressUpdatedAt:100, progressDirty:true })
    drive.readDriveProgress.mockResolvedValue({ fraction:.4, locator:{ page:4 }, updatedAt:200, stateFileId:'state' })
    const patch = library.patch.bind(library)
    vi.spyOn(library, 'patch').mockImplementationOnce(async (id, fields, options) => {
      await patch(id, { progressFraction:.8, locator:{ page:8 }, progressUpdatedAt:300, progressDirty:true })
      return patch(id, fields, options)
    })
    await sync.syncBookProgress(book.id)
    expect(await library.get(book.id)).toMatchObject({ progressFraction:.8, locator:{ page:8 }, progressDirty:true })
  })
  it('does not clear a dirty local change committed just before the upload completion transaction', async () => {
    const book = await library.addOrTouch({ sourceType:'local', name:'late-write.pdf', size:3,
      driveFileId:'saved-drive', cloudAccountId:'account-1', progressFraction:.2,
      locator:{ page:2 }, progressUpdatedAt:100, progressDirty:true })
    drive.writeDriveProgress.mockResolvedValue({ id:'state' })
    const patch = library.patch.bind(library)
    vi.spyOn(library, 'patch').mockImplementationOnce(async (id, fields, options) => {
      await patch(id, { progressFraction:.8, locator:{ page:8 }, progressUpdatedAt:300, progressDirty:true })
      return patch(id, fields, options)
    })
    await sync.syncBookProgress(book.id)
    expect(await library.get(book.id)).toMatchObject({ progressFraction:.8, locator:{ page:8 }, progressDirty:true })
    expect((await library.get(book.id)).progressStateFileId).toBeUndefined()
  })

  it('hydrates discovered and legacy Drive files serially and commits every original locally', async () => {
    vi.stubGlobal('Blob', NativeBlob); vi.stubGlobal('File', NativeFile)
    try {
      const legacy = await library.addOrTouch({ sourceType:'drive', driveFileId:'moved-drive', cloudAccountId:'account-1', name:'legacy.epub' })
      drive.listAllDriveBooks.mockResolvedValue([{ id:'discovered', name:'new.epub', size:'3', mimeType:'application/epub+zip' }])
      const finishes = []
      drive.downloadDriveFile.mockImplementation((id, options) => new Promise(resolve => { finishes.push(() => resolve(new NativeFile([id], options.name))) }))
      const task = sync.sync()
      await vi.waitFor(() => expect(finishes).toHaveLength(1))
      expect(drive.downloadDriveFile.mock.calls[0][0]).toBe('discovered')
      finishes[0]()
      await vi.waitFor(() => expect(finishes).toHaveLength(2))
      expect(await (await library.get('drive:discovered')).content.text()).toBe('discovered')
      finishes[1]()
      expect(await task).toMatchObject({ downloaded:2, uploaded:0, errors:[] })
      expect(await (await library.get(legacy.id)).content.text()).toBe('moved-drive')
      expect(drive.uploadDriveFile).not.toHaveBeenCalled()
      sync.reset(); sync = new CloudSync(library); sync.setProfile({ id:'account-1' })
      drive.downloadDriveFile.mockRejectedValue(new Error('Offline'))
      await sync.sync()
      expect(drive.downloadDriveFile).toHaveBeenCalledTimes(2)
    } finally { vi.unstubAllGlobals() }
  })

  it('reports hydration quota failure while preserving the local library and never uploading it', async () => {
    const local = await library.addOrTouch({ sourceType:'local', name:'kept.epub', content:new NativeBlob(['local']) })
    drive.listAllDriveBooks.mockResolvedValue([{ id:'remote', name:'cloud.epub', size:'3' }])
    const patch = library.patch.bind(library)
    vi.spyOn(library, 'patch').mockImplementation((id, fields, options) => fields.content
      ? Promise.reject(new DOMException('Full', 'QuotaExceededError')) : patch(id, fields, options))
    const result = await sync.sync()
    expect(result.errors[0]).toMatch(/guardar.*dispositivo|Libera espacio/)
    expect(await (await library.get(local.id)).content.text()).toBe('local')
    expect((await library.get('drive:remote')).content).toBeUndefined()
    expect(drive.uploadDriveFile).not.toHaveBeenCalled()
  })

  it('allows a fresh sync after reconnect and ignores the old account result', async () => {
    let finishOld
    drive.listAllDriveBooks.mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve }))
    const old = sync.sync()
    await vi.waitFor(() => expect(drive.listAllDriveBooks).toHaveBeenCalledOnce())
    sync.reset(); sync.setProfile({ id:'account-2' })
    drive.listAllDriveBooks.mockResolvedValue([])
    expect(await sync.sync()).toMatchObject({ books:0, errors:[] })
    finishOld([{ id:'old-account-book', name:'old.pdf' }])
    await old
    expect(await library.listAll()).toEqual([])
    expect(drive.downloadDriveFile).not.toHaveBeenCalled()
  })
  it('does not replace the new account with a profile request that finishes after reset', async () => {
    sync.reset()
    let finish
    drive.getDriveProfile.mockImplementation(() => new Promise(resolve => { finish = resolve }))
    const old = sync.sync()
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    sync.reset(); sync.setProfile({ id:'account-2' })
    finish({ id:'account-1' })
    await old
    expect(drive.listAllDriveBooks).not.toHaveBeenCalled()
    const book = await library.addOrTouch({ sourceType:'local', name:'new-account.pdf', content:new Blob(['new']) })
    drive.uploadDriveFile.mockResolvedValue({ id:'new-drive', name:'new-account.pdf' })
    expect(await sync.uploadBook(book)).toMatchObject({ cloudAccountId:'account-2' })
  })
})
