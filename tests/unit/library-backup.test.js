import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Blob, File } from 'node:buffer'
import { LibraryStore } from '../../src/js/library-store.js'
import { CloudSync } from '../../src/js/cloud-sync.js'
import {rustUI} from './helpers/rust-ui-ready.js'
import { LibraryBackup } from '../../src/js/library-backup.js'

vi.mock('../../src/js/drive-client.js', () => ({
  getDriveProfile:vi.fn(), listAllDriveBooks:vi.fn(), uploadDriveFile:vi.fn(), downloadDriveFile:vi.fn(),
  readDriveProgress:vi.fn(), writeDriveProgress:vi.fn(), readDriveLibrarySnapshots:vi.fn(), readDriveLibraryRevision:vi.fn(),
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

it('polls only lightweight revisions while the room is unchanged, and retries a locally dirty sync',async()=>{
 const a=device();await add(a);drive.readDriveLibraryRevision.mockResolvedValue('revision-one')
 await a.backup.poll('account');const reads=drive.readDriveLibrarySnapshots.mock.calls.length,full=drive.listAllDriveBooks.mock.calls.length
 await a.backup.poll('account');await a.backup.poll('account')
 expect(drive.readDriveLibrarySnapshots).toHaveBeenCalledTimes(reads);expect(drive.listAllDriveBooks).toHaveBeenCalledTimes(full)
 drive.readDriveLibraryRevision.mockRejectedValueOnce(new Error('offline'))
 await expect(a.backup.poll('account')).rejects.toThrow('offline')
 await a.sync();await a.backup.poll('account');expect(drive.readDriveLibrarySnapshots.mock.calls.length).toBeGreaterThan(reads)
})
it('restores a changed revision immediately through the same merge and keeps shared book appearance identities',async()=>{
 const a=device(),first=await add(a);await a.sync();const b=device()
 drive.readDriveLibraryRevision.mockImplementation(async()=>JSON.stringify([...snapshots.values()]))
 await b.backup.poll('account');const [restored]=await b.library.listAll();expect(restored.shelfVisualId).toBe(first.id)
 await a.library.patch(first.id,{shelfPosition:{shelf:1,x:.31},spineColorOverride:'#123456'});await a.sync()
 await b.backup.poll('account');expect(await b.library.get(restored.id)).toMatchObject({shelfPosition:{shelf:1,x:.31},spineColorOverride:'#123456',shelfVisualId:first.id})
})
it('backs up portable settled poses with Drive IDs instead of another device local IDs',async()=>{
 const a=device(),book=await add(a)
 const pose=[2,[1000,1],[['book:'+book.id,0,[.1,-.2,2,1000],[.02,.2,.15],[.02,.58,-.3,-.01],.15,-.24,-.4,null]]]
 a.storage.setItem('inhouse-read-shelf-physics-v1',JSON.stringify(pose));await a.sync()
 const [source]=await a.library.listAll(),remote=[...snapshots.values()][0].settings['inhouse-read-shelf-physics-v1'].value
 expect(JSON.parse(remote)[2][0][0]).toBe('book:drive:'+source.driveFileId)
 const b=device();await b.sync();const [restored]=await b.library.listAll()
 const local=JSON.parse(b.storage.getItem('inhouse-read-shelf-physics-v1'));expect(local[0]).toBe(2);expect(local[2][0][0]).toBe('book:'+restored.id);expect(local[2][0][7]).toBe(-.4)
 const register=structuredClone([...snapshots.values()][0].settings['inhouse-read-shelf-physics-v1'])
 await b.sync();await a.sync();await b.sync()
 for(const manifest of snapshots.values())expect(manifest.settings['inhouse-read-shelf-physics-v1']).toEqual(register)
 const settled=drive.writeDriveLibrarySnapshot.mock.calls.length;await a.sync();await b.sync();expect(drive.writeDriveLibrarySnapshot).toHaveBeenCalledTimes(settled)
})
it('retries a failed original upload even when the remote revision did not change',async()=>{
 const a=device();await add(a);drive.readDriveLibraryRevision.mockResolvedValue('same-revision');drive.uploadDriveFile.mockRejectedValueOnce(new Error('temporary failure'))
 expect((await a.backup.poll('account')).errors.length).toBeGreaterThan(0)
 await a.backup.poll('account');expect(drive.uploadDriveFile).toHaveBeenCalledTimes(2);expect((await a.library.listAll())[0].driveFileId).toBeTruthy()
})

describe('direct room delivery without waiting for Drive',()=>{
 it('captures explicit edits locally and applies them on another device without network reads or writes',async()=>{
  const a=device(),original=await add(a);await a.sync();const b=device();await b.sync();const [remote]=await b.library.listAll()
  await a.library.patch(original.id,{spineColorOverride:'#112233',shelfPosition:{shelf:1,x:.21}})
  expect(a.backup.markBookChanged('account',original.id,['spineColorOverride','shelfPosition'])).toBe(true)
  const before=[drive.readDriveLibrarySnapshots.mock.calls.length,drive.writeDriveLibrarySnapshot.mock.calls.length]
  const snapshot=await a.backup.captureRoom('account');expect(snapshot.books[0].fields.spineColorOverride.value).toBe('#112233')
  await b.backup.receiveSnapshot('account',snapshot)
  expect(await b.library.get(remote.id)).toMatchObject({spineColorOverride:'#112233',shelfPosition:{shelf:1,x:.21}})
  expect([drive.readDriveLibrarySnapshots.mock.calls.length,drive.writeDriveLibrarySnapshot.mock.calls.length]).toEqual(before)
 })
 it('applies a peer edit while its older Drive write is still pending and does not revert it',async()=>{
  const a=device(),original=await add(a);await a.sync();const b=device();await b.sync();const [remote]=await b.library.listAll()
  let release,started;const waiting=new Promise(r=>release=r),writing=new Promise(r=>started=r)
  const write=drive.writeDriveLibrarySnapshot.getMockImplementation()
  drive.writeDriveLibrarySnapshot.mockImplementationOnce(async(...args)=>{started();await waiting;return write(...args)})
  // Force a real unrelated durable write on b, then leave its network request open.
  await b.library.patch(remote.id,{title:'Other title'});const pending=b.sync();await writing
  await a.library.patch(original.id,{spineColorOverride:'#445566'});a.backup.markBookChanged('account',original.id,['spineColorOverride']);const snapshot=await a.backup.captureRoom('account')
  await b.backup.receiveSnapshot('account',snapshot)
  expect((await b.library.get(remote.id)).spineColorOverride).toBe('#445566')
  release();await pending;await b.sync();expect((await b.library.get(remote.id)).spineColorOverride).toBe('#445566')
 })
 it('queues peer data until a concurrent local edit is captured, preserving both fields',async()=>{
  const a=device(),original=await add(a);await a.sync();const b=device();await b.sync();const [remote]=await b.library.listAll()
  await a.library.patch(original.id,{spineColorOverride:'#abcdef'});a.backup.markBookChanged('account',original.id,['spineColorOverride']);const incoming=await a.backup.captureRoom('account')
  await b.library.patch(remote.id,{spineTextFinish:'silver'});b.backup.markBookChanged('account',remote.id,['spineTextFinish']);await b.backup.receiveSnapshot('account',incoming)
  expect((await b.library.get(remote.id)).spineColorOverride).not.toBe('#abcdef')
  await b.backup.captureRoom('account');await b.backup.drainLive('account')
  expect(await b.library.get(remote.id)).toMatchObject({spineColorOverride:'#abcdef',spineTextFinish:'silver'})
 })
 it('rejects direct delivery after signout',async()=>{
  const a=device();await add(a);await a.sync();const snapshot=[...snapshots.values()][0];a.backup.reset()
  await expect(a.backup.receiveSnapshot('account',snapshot)).rejects.toThrow('Invalid live room')
  expect(a.backup.markBookChanged('account','id',['title'])).toBe(false)
 })
})

it('does not let a pre-existing slow Drive read overwrite a new direct edit',async()=>{
 const a=device(),original=await add(a);await a.sync();const b=device();await b.sync();const [remote]=await b.library.listAll()
 const read=drive.readDriveLibrarySnapshots.getMockImplementation();let release,entered
 const ready=new Promise(r=>entered=r),blocked=new Promise(r=>release=r),old=await read()
 drive.readDriveLibrarySnapshots.mockImplementationOnce(async()=>{entered();await blocked;return old})
 const task=b.sync();await ready
 await a.library.patch(original.id,{spineColorOverride:'#987654'});a.backup.markBookChanged('account',original.id,['spineColorOverride'])
 await b.backup.receiveSnapshot('account',await a.backup.captureRoom('account'))
 expect((await b.library.get(remote.id)).spineColorOverride).toBe('#987654')
 release();await task;expect((await b.library.get(remote.id)).spineColorOverride).toBe('#987654')
})

it('shares verified paper volume and retains it when downloading the same original',async()=>{
 const upload=drive.uploadDriveFile.getMockImplementation()
 drive.uploadDriveFile.mockImplementation(async(...args)=>{const result=await upload(...args);files.get(result.id).md5Checksum='a'.repeat(32);return {...result,md5Checksum:'a'.repeat(32)}})
 const a=device(),original=await add(a)
 await a.library.patch(original.id,{wordCount:78000,wordCountVersion:2,wordCountComplete:true,contentRevision:'verified-original',wordCountContentRevision:'verified-original'})
 expect(rustUI.length_is_ready(await a.library.get(original.id))).toBe(true)
 await a.sync();expect([...snapshots.values()][0].books[0].fields.bookLength.value).toMatchObject({wordCount:78000,md5Checksum:'a'.repeat(32),byteLength:8})
 const b=device();await b.sync();const [copy]=await b.library.listAll()
 expect(copy).toMatchObject({wordCount:78000,wordCountVersion:2,wordCountComplete:true});expect(copy.wordCountContentRevision).toBe(copy.contentRevision);expect(await copy.content.text()).toBe('original')
})

it('does not restamp a physical room merely because another viewport rounded its placement anchor',async()=>{
 const a=device(),original=await add(a),key='inhouse-read-shelf-physics-v1'
 a.storage.setItem(key,JSON.stringify([2,[20261018,0],[[`book:${original.id}`,0,[.3,.1,1,1],[.02,.2,.15],[0,.6,0,.3],.3,.1,.2,null]]]))
 await a.sync();const b=device();await b.sync();const anchored=JSON.parse(b.storage.getItem(key));anchored[2][0][2][0]+=.00044;b.storage.setItem(key,JSON.stringify(anchored))
 await b.sync();const before=[...snapshots.values()].find(v=>v.deviceId===b.backup.device).settings[key]
 await b.sync();const after=[...snapshots.values()].find(v=>v.deviceId===b.backup.device).settings[key]
 expect(after).toEqual(before);expect(after.value).toBe([...snapshots.values()].find(v=>v.deviceId===a.backup.device).settings[key].value)
})

it('does not overwrite a newer locally completed count while applying a remote count',async()=>{
 const upload=drive.uploadDriveFile.getMockImplementation()
 drive.uploadDriveFile.mockImplementation(async(...args)=>{const result=await upload(...args);files.get(result.id).md5Checksum='a'.repeat(32);return {...result,md5Checksum:'a'.repeat(32)}})
 const a=device(),original=await add(a)
 await a.library.patch(original.id,{...rustUI.length_complete_count(78000),contentRevision:'original',wordCountContentRevision:'original'});await a.sync()
 const b=device(),patch=b.library.patch.bind(b.library);let intervened=false
 vi.spyOn(b.library,'patch').mockImplementation(async(id,fields,options)=>{
  if(!intervened&&fields.wordCount===78000){intervened=true;const latest=await b.library.get(id);await patch(id,{...rustUI.length_complete_count(79000),wordCountContentRevision:latest.contentRevision})}
  return patch(id,fields,options)
 })
 await b.sync();expect(intervened).toBe(true);expect((await b.library.listAll())[0].wordCount).toBe(79000)
})

it('sends an atomic reading position directly without waiting for Drive and keeps backward reading',async()=>{
 const a=device(),original=await add(a);await a.sync();const b=device();await b.sync();const [remote]=await b.library.listAll()
 const before=[drive.readDriveLibrarySnapshots.mock.calls.length,drive.writeDriveLibrarySnapshot.mock.calls.length]
 await a.library.updateProgress(original.id,.82,{kind:'pdf-page',value:82})
 a.backup.markBookChanged('account',original.id,['progressFraction','locator','progressUpdatedAt'])
 const forward=await a.backup.captureRoom('account');expect(forward.books[0].fields.readingPosition.value).toMatchObject({fraction:.82,locator:{value:82}})
 await b.backup.receiveSnapshot('account',forward)
 expect(await b.library.get(remote.id)).toMatchObject({progressFraction:.82,locator:{value:82}})
 await b.library.updateProgress(remote.id,.23,{kind:'pdf-page',value:23});b.backup.markBookChanged('account',remote.id,['progressFraction','locator','progressUpdatedAt'])
 await a.backup.receiveSnapshot('account',await b.backup.captureRoom('account'))
 expect(await a.library.get(original.id)).toMatchObject({progressFraction:.23,locator:{value:23}})
 expect([drive.readDriveLibrarySnapshots.mock.calls.length,drive.writeDriveLibrarySnapshot.mock.calls.length]).toEqual(before)
 await b.backup.receiveSnapshot('account',forward);expect((await b.library.get(remote.id)).progressFraction).toBe(.23)
})
it('does not republish a passive stale page with a new timestamp after a direct progress update',async()=>{
 const a=device(),original=await add(a);await a.sync();const b=device();await b.sync();const [remote]=await b.library.listAll()
 await a.library.patch(original.id,{progressFraction:.7,locator:{kind:'pdf-page',value:70},progressUpdatedAt:10000})
 a.backup.markBookChanged('account',original.id,['progressFraction','locator','progressUpdatedAt'])
 const snapshot=await a.backup.captureRoom('account');await b.backup.receiveSnapshot('account',snapshot)
 // An older legacy progress file or an in-flight local read must not gain authority merely by syncing now.
 await b.library.patch(remote.id,{progressFraction:.1,locator:{kind:'pdf-page',value:10},progressUpdatedAt:100})
 await b.sync();await a.sync();expect(await b.library.get(remote.id)).toMatchObject({progressFraction:.7,locator:{value:70}})
 expect(await a.library.get(original.id)).toMatchObject({progressFraction:.7,locator:{value:70}})
})

it('does not publish passive physics recalculation over a shared room, but accepts a real local gesture',async()=>{
 const key='inhouse-read-shelf-physics-v1',a=device(),original=await add(a)
 const raw=[2,[1000,1],[['book:'+original.id,0,[.1,-.2,2,1000],[.02,.2,.15],[.02,.58,-.3,-.01],.15,-.24,-.4,null]]]
 a.storage.setItem(key,JSON.stringify(raw));await a.sync();const b=device();await b.sync()
 const before=structuredClone([...snapshots.values()][0].settings[key]),changed=JSON.parse(b.storage.getItem(key));changed[2][0][7]+=.00002
 b.storage.setItem(key,JSON.stringify(changed));await b.sync()
 expect([...snapshots.values()].every(s=>JSON.stringify(s.settings[key])===JSON.stringify(before))).toBe(true)
 expect(JSON.parse(b.storage.getItem(key))[2][0][7]).toBe(-.4)
 const gesture=JSON.parse(b.storage.getItem(key));gesture[2][0][7]=-.7;b.storage.setItem(key,JSON.stringify(gesture));b.backup.markSettingChanged('account',key)
 const snapshot=await b.backup.captureRoom('account');expect(JSON.parse(snapshot.settings[key].value)[2][0][7]).toBe(-.7)
 await a.backup.receiveSnapshot('account',snapshot);expect(JSON.parse(a.storage.getItem(key))[2][0][7]).toBe(-.7)
})
it('retains a received room for retry after a transient local storage failure',async()=>{
 const a=device(),b=device();await add(a);await a.sync();await b.sync()
 const key='inhouse-read-shelf-lamps',value='[{"key":"lamp:one","isOn":false}]'
 a.storage.setItem(key,value);a.backup.markSettingChanged('account',key)
 const snapshot=await a.backup.captureRoom('account')
 const write=vi.spyOn(b.storage,'setItem')
 write.mockImplementationOnce(()=>{throw Error('temporary storage failure')})
 await expect(b.backup.receiveSnapshot('account',snapshot)).rejects.toThrow('temporary storage failure')
 write.mockRestore()
 await b.backup.drainLive('account')
 expect(b.storage.getItem(key)).toBe(value)
})
