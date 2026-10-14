import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Blob, File } from 'node:buffer'
import { LibraryStore } from '../../src/js/library-store.js'
import { CloudSync } from '../../src/js/cloud-sync.js'
import './helpers/rust-ui-ready.js'
import { LibraryBackup } from '../../src/js/library-backup.js'

vi.mock('../../src/js/drive-client.js', () => ({
  getDriveProfile:vi.fn(), listAllDriveBooks:vi.fn(), uploadDriveFile:vi.fn(), downloadDriveFile:vi.fn(),
  readDriveProgress:vi.fn(), writeDriveProgress:vi.fn(), readDriveLibrarySnapshots:vi.fn(),
  writeDriveLibrarySnapshot:vi.fn(), uploadDriveCover:vi.fn()
}))
import * as drive from '../../src/js/drive-client.js'

let sequence = 0, stores, files, snapshots, progress
function memoryStorage() {
  const values = new Map()
  return { getItem:k => values.get(k) ?? null, setItem:(k,v) => values.set(k,String(v)), removeItem:k => values.delete(k) }
}
function device() {
  const library = new LibraryStore(`backup-${++sequence}`), storage = memoryStorage()
  stores.push(library)
  const cloud = new CloudSync(library); cloud.setProfile({ id:'account' })
  const onSettings = vi.fn()
  const backup = new LibraryBackup(library, cloud, { storage, onSettings })
  return { library, storage, cloud, backup, onSettings, sync:() => backup.sync('account') }
}
async function add(d, name = 'book.epub') {
  return d.library.addOrTouch({ sourceType:'local', name, title:'The Book', author:'Author', mimeType:'application/epub+zip',
    size:8, content:new Blob(['original']), cover:new Blob(['cover-pixels'], { type:'image/png' }), coverUpdatedAt:11,
    shelfOrder:7, shelfPosition:{ shelf:2, x:.73 }, spineTextFinish:'gold', spineColorOverride:'#127856',
    progressFraction:.5, progressUpdatedAt:100, locator:{ kind:'epub', value:'chapter-3' },
    bookmarks:[{ fraction:.5, locator:{ kind:'epub', value:'chapter-3' } }] })
}
beforeEach(() => {
  vi.stubGlobal('Blob', Blob); vi.stubGlobal('File', File)
  vi.clearAllMocks(); stores=[]; files=new Map(); snapshots=new Map(); progress=new Map()
  // Increasing time avoids accidental tie winners across simulated devices.
  let clock = 2000
  vi.spyOn(Date,'now').mockImplementation(() => ++clock)
  drive.readDriveLibrarySnapshots.mockImplementation(async () => structuredClone([...snapshots.values()]))
  drive.writeDriveLibrarySnapshot.mockImplementation(async snapshot => {
    const id = `manifest-${snapshot.deviceId}`
    snapshots.set(snapshot.deviceId, structuredClone({ ...snapshot, stateFileId:id })); return { id }
  })
  drive.uploadDriveFile.mockImplementation(async file => {
    const id = `file-${files.size}`
    files.set(id, { file, id, name:file.name, mimeType:file.type, size:file.size }); return { id, name:file.name }
  })
  drive.uploadDriveCover.mockImplementation(async file => {
    const id = `cover-${files.size}`
    files.set(id, { file, id, name:id }); return { id }
  })
  drive.downloadDriveFile.mockImplementation(async (id, options = {}) => {
    if (!files.has(id)) throw new Error('Missing file')
    const file = files.get(id).file
    return new File([await file.arrayBuffer()], options.name || file.name || id, { type:options.mimeType || file.type })
  })
  drive.listAllDriveBooks.mockImplementation(async () => [...files.values()].filter(f => f.id.startsWith('file-')))
  drive.readDriveProgress.mockImplementation(async id => structuredClone(progress.get(id) || null))
  drive.writeDriveProgress.mockImplementation(async (id, data) => {
    progress.set(id, structuredClone(data)); return { id:`progress-${id}` }
  })
})
afterEach(async () => { for (const store of stores) await store.close(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('complete Drive library backup across independent devices', () => {
  it('automatically uploads originals and restores bytes, covers, order, appearance, reading position and room', async () => {
    const a=device(), original=await add(a)
    const settings = {
      'inhouse-read-shelf-plants':'[{"key":"plant-1","shelf":2,"x":0.4}]',
      'inhouse-read-shelf-lamps':'[{"key":"light-1","shelf":1,"x":0.1}]',
      'inhouse-read-shelf-type':'billy', 'inhouse-read-theme':'dark',
      'inhouse-read-shelf-view':'isometric', 'inhouse-read-reading-preferences':'{"theme":"amoled","fontSize":22}'
    }
    for (const [key,value] of Object.entries(settings)) a.storage.setItem(key,value)
    expect(await a.sync()).toMatchObject({ uploaded:1, errors:[] })
    const b=device()
    b.storage.setItem('inhouse-read-shelf-plants','[]') // automatic empty room on first boot
    await b.sync()
    const [restored] = await b.library.listAll()
    expect(restored).toMatchObject({ title:original.title, author:original.author, shelfOrder:7,
      shelfPosition:{ shelf:2,x:.73 }, spineTextFinish:'gold', spineColorOverride:'#127856', progressFraction:.5,
      locator:original.locator, sourceType:'drive', cloudAccountId:'account' })
    expect(await restored.content.text()).toBe('original')
    expect(await restored.cover.text()).toBe('cover-pixels')
    for (const [key,value] of Object.entries(settings)) expect(b.storage.getItem(key)).toBe(value)
    expect(b.onSettings).toHaveBeenCalledOnce()
    const counts = [drive.uploadDriveFile.mock.calls.length, drive.uploadDriveCover.mock.calls.length]
    await b.sync(); await a.sync()
    expect([drive.uploadDriveFile.mock.calls.length, drive.uploadDriveCover.mock.calls.length]).toEqual(counts)
    expect(await a.library.get(original.id)).toMatchObject({ content:expect.anything() })
  })
  it('restores a changed binary cover and its revision together', async () => {
    const a=device(), book=await add(a); await a.sync()
    const b=device(); await b.sync()
    await a.library.patch(book.id, { cover:new Blob(['new-image']), coverUpdatedAt:999 })
    await a.sync(); await b.sync()
    const [saved] = await b.library.listAll()
    expect(await saved.cover.text()).toBe('new-image')
    expect(saved.coverUpdatedAt).toBe(999)
  })
  it('merges offline edits of different fields without dropping other books', async () => {
    const a=device(), book=await add(a); await a.sync()
    const b=device(); await b.sync()
    const [bBook] = await b.library.listAll()
    await a.library.patch(book.id, { title:'Changed title' })
    await b.library.patch(bBook.id, { shelfOrder:22 })
    await add(b,'second.epub')
    await a.sync(); await b.sync(); await a.sync()
    expect(await a.library.get(book.id)).toMatchObject({ title:'Changed title', shelfOrder:22 })
    expect(await b.library.get(bBook.id)).toMatchObject({ title:'Changed title', shelfOrder:22 })
    expect(await a.library.listAll()).toHaveLength(2)
  })
  it('propagates explicit removal and an empty plant collection without deleting originals from Drive', async () => {
    const a=device(), book=await add(a); await a.sync()
    const b=device(); await b.sync()
    await a.cloud.removeFromShelf(await a.library.get(book.id))
    a.storage.setItem('inhouse-read-shelf-plants','[]')
    a.storage.setItem('inhouse-read-backup-settings-changes',JSON.stringify({ 'inhouse-read-shelf-plants':Date.now() }))
    await a.sync(); await b.sync()
    expect(await b.library.listAll()).toHaveLength(0)
    expect(b.storage.getItem('inhouse-read-shelf-plants')).toBe('[]')
    expect([...files.keys()].some(id => id.startsWith('file-'))).toBe(true)
    const c=device(); await c.sync(); expect(await c.library.listAll()).toHaveLength(0)
    const [removed] = await c.library.listRemoved()
    expect(removed.removedAt).toBe((await a.library.listRemoved())[0].removedAt)
    await a.library.addOrTouch({ ...book, ...(await a.library.listRemoved())[0], content:new Blob(['original']) },{restoreRemoved:true})
    await a.sync(); await c.sync(); await b.sync()
    expect(await c.library.listAll()).toHaveLength(1)
    expect(await b.library.listAll()).toHaveLength(1)
  })
  it('does not write after a failed manifest read or a sign-out during the read', async () => {
    const a=device(); await add(a)
    drive.readDriveLibrarySnapshots.mockRejectedValueOnce(new Error('Offline'))
    await expect(a.sync()).rejects.toThrow('Offline')
    expect(drive.uploadDriveFile).not.toHaveBeenCalled()
    let finish
    drive.readDriveLibrarySnapshots.mockImplementationOnce(() => new Promise(resolve => { finish=resolve }))
    const task=a.sync(); await vi.waitFor(() => expect(finish).toBeTypeOf('function')); a.backup.reset(); finish([])
    await expect(task).rejects.toThrow('cuenta')
    expect(drive.writeDriveLibrarySnapshot).not.toHaveBeenCalled()
    expect(await a.library.listAll()).toHaveLength(1)
  })
  it('never uploads books linked to another account', async () => {
    const a=device(), book=await add(a)
    await a.library.patch(book.id, { cloudAccountId:'different-account' })
    await a.sync()
    expect(drive.uploadDriveFile).not.toHaveBeenCalled()
    expect(drive.uploadDriveCover).not.toHaveBeenCalled()
  })
  it('keeps a local edit made while the cover upload was in flight', async () => {
    const a=device(), book=await add(a)
    let finish
    drive.uploadDriveCover.mockImplementationOnce(file => new Promise(resolve => { finish=() => {
      files.set('held-cover',{ id:'held-cover',name:'held-cover',file }); resolve({id:'held-cover'})
    } }))
    const task=a.sync()
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    await a.library.patch(book.id,{title:'Edited during upload', cover:new Blob(['new local cover']),coverUpdatedAt:1000})
    finish(); await task
    expect(await a.library.get(book.id)).toMatchObject({title:'Edited during upload'})
    expect(await (await a.library.get(book.id)).cover.text()).toBe('new local cover')
    await a.sync()
    const b=device();await b.sync()
    expect((await b.library.listAll())[0].title).toBe('Edited during upload')
    expect(await (await b.library.listAll())[0].cover.text()).toBe('new local cover')
  })
  it('retries a failed cover download without overwriting it with an old local image', async () => {
    const a=device(), book=await add(a); await a.sync()
    const b=device(); await b.sync()
    await a.library.patch(book.id,{cover:new Blob(['replacement']),coverUpdatedAt:777}); await a.sync()
    const download=drive.downloadDriveFile.getMockImplementation()
    drive.downloadDriveFile.mockImplementationOnce(async () => {throw new Error('Connection lost')})
    await expect(b.sync()).rejects.toThrow('portada')
    const [unchanged]=await b.library.listAll()
    expect(await unchanged.cover.text()).toBe('cover-pixels')
    const uploads=drive.uploadDriveCover.mock.calls.length
    drive.downloadDriveFile.mockImplementation(download)
    await b.sync()
    expect(await (await b.library.listAll())[0].cover.text()).toBe('replacement')
    expect(drive.uploadDriveCover).toHaveBeenCalledTimes(uploads)
  })
  it('does not resurrect an explicit removal made during an upload', async () => {
    const a=device(), book=await add(a)
    let finish
    drive.uploadDriveCover.mockImplementationOnce(file => new Promise(resolve => {finish=()=>{
      files.set('held-cover',{id:'held-cover',name:'held-cover',file});resolve({id:'held-cover'})
    }}))
    const task=a.sync();await vi.waitFor(()=>expect(finish).toBeTypeOf('function'))
    await a.cloud.removeFromShelf(await a.library.get(book.id));finish();await task
    const b=device();await b.sync()
    expect(await a.library.listAll()).toEqual([])
    expect(await b.library.listAll()).toEqual([])
  })
})
